import { z } from "zod";
import { assertSameOrigin, offlineApiResponse, requireActiveOfflineUser } from "@/lib/offline/api-server";
import type { SyncPushResult } from "@/lib/offline/types";

const operationSchema = z.object({
  clientMutationId: z.string().uuid(),
  deviceId: z.string().uuid(),
  actorId: z.string().uuid(),
  kind: z.enum(["patient.upsert", "patient.update", "analysis.register", "results.save"]),
  createdAt: z.string().datetime(),
  dependencies: z.array(z.string().uuid()).max(20),
  baseVersion: z.number().int().positive().optional(),
  payload: z.record(z.string(), z.unknown()),
});
const schema = z.object({ deviceId: z.string().uuid(), operations: z.array(operationSchema).min(1).max(50) });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const input = schema.parse(await request.json());
    if (input.operations.some((operation) => operation.deviceId !== input.deviceId)) {
      return Response.json({ error: "La cola contiene operaciones de otro equipo." }, { status: 400 });
    }
    const { supabase, user } = await requireActiveOfflineUser();
    if (input.operations.some((operation) => operation.actorId !== user.id)) {
      return Response.json({ error: "La cola contiene operaciones de otro usuario." }, { status: 403 });
    }

    const results: SyncPushResult[] = [];
    const batchIds = new Set(input.operations.map((operation) => operation.clientMutationId));
    const appliedIds = new Set<string>();
    for (const operation of input.operations) {
      if (operation.dependencies.some((dependency) => batchIds.has(dependency) && !appliedIds.has(dependency))) {
        results.push({
          clientMutationId: operation.clientMutationId,
          status: "blocked",
          error: "dependency_not_applied",
        });
        continue;
      }
      const { data, error } = operation.kind === "analysis.register"
        ? await supabase.rpc("apply_offline_analysis_registration", {
            target_device: input.deviceId,
            target_mutation: operation.clientMutationId,
            operation_payload: operation.payload,
          })
        : await supabase.rpc("apply_offline_operation", {
            target_device: input.deviceId,
            target_mutation: operation.clientMutationId,
            operation_kind: operation.kind,
            operation_payload: operation.payload,
            base_version: operation.baseVersion ?? null,
          });
      if (error) {
        results.push({
          clientMutationId: operation.clientMutationId,
          status: "blocked",
          error: error.message,
        });
      } else {
        const result = data as SyncPushResult;
        results.push(result);
        if (result.status === "applied") appliedIds.add(operation.clientMutationId);
      }
    }
    return Response.json({ results }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return offlineApiResponse(error);
  }
}
