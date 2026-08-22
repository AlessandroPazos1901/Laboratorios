import { z } from "zod";

/**
 * Forma de una edición del catálogo. La comparten tres sitios y por eso vive
 * aquí y no dentro de la ruta: /api/catalog la valida al recibirla, la cola
 * offline la guarda tal cual en IndexedDB, y `apply_catalog_operation` la
 * reparte en la base. Una sola definición para las tres.
 *
 * Los campos `groupId`/`subsectionId`/`newAnalysisId`/`newVersionId` de las
 * acciones que crean filas los genera el equipo. Sin conexión hacen falta para
 * poder referenciar lo recién creado antes de sincronizar; con conexión son
 * opcionales y la base genera el id.
 */
const uuid = z.string().uuid();
const name = z.string().trim().min(2).max(80);

export const catalogOperationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("group.create"), name, groupId: uuid.optional() }),
  z.object({ action: z.literal("group.rename"), groupId: uuid, name }),
  z.object({ action: z.literal("group.archive"), groupId: uuid }),
  z.object({ action: z.literal("subsection.create"), groupId: uuid, name, subsectionId: uuid.optional() }),
  z.object({ action: z.literal("subsection.rename"), subsectionId: uuid, name }),
  z.object({ action: z.literal("subsection.renameLegacy"), groupId: uuid, currentName: name, name }),
  z.object({ action: z.literal("subsection.delete"), subsectionId: uuid }),
  z.object({ action: z.literal("subsection.deleteLegacy"), groupId: uuid, currentName: name }),
  z.object({ action: z.literal("subsection.reorder"), groupId: uuid, subsectionIds: z.array(uuid) }),
  z.object({
    action: z.literal("layout.save"), groupId: uuid,
    items: z.array(z.object({
      analysisId: uuid,
      subsection: z.string().trim().max(80).nullable(),
      displayOrder: z.number().int().positive(),
    })),
  }),
  z.object({
    action: z.literal("analysis.save"), analysisId: uuid.nullable(), groupId: uuid,
    subsection: z.string().trim().max(80).nullable(), name: z.string().trim().min(2).max(120),
    resultType: z.enum(["numeric", "qualitative", "text"]), sampleType: z.string().trim().min(2).max(80),
    method: z.string().trim().max(120).nullable(), unit: z.string().trim().max(40).nullable(),
    decimals: z.number().int().min(0).max(8).nullable(),
    qualitativeOptions: z.array(z.string().trim().min(1).max(80)).nullable(),
    referenceRanges: z.array(z.record(z.string(), z.union([z.string(), z.number()]))),
    criticalLimits: z.record(z.string(), z.number()),
    newAnalysisId: uuid.optional(),
    newVersionId: uuid.optional(),
  }),
  z.object({ action: z.literal("analysis.archive"), analysisId: uuid }),
]);

export type CatalogOperation = z.infer<typeof catalogOperationSchema>;

export function catalogFriendlyError(message: string) {
  if (message.includes("owner_required") || message.includes("not_authorized")) return "Esta acción requiere autorización.";
  if (message.includes("duplicate key")) return "Ya existe una sección o subgrupo con ese nombre.";
  if (message.includes("group_not_found")) return "La sección ya no existe. Actualiza el catálogo.";
  if (message.includes("subsection_not_found")) return "El subgrupo ya no existe. Actualiza el catálogo.";
  if (message.includes("analysis_not_found")) return "El análisis ya no existe. Actualiza el catálogo.";
  if (message.includes("reference_range_required")) return "Indica el intervalo de referencia.";
  if (message.includes("qualitative_options_required")) return "Agrega las opciones válidas del resultado cualitativo.";
  if (message.includes("unsupported_catalog_action")) return "Esta versión del sistema no reconoce ese cambio de catálogo.";
  // Sin la causa real un fallo aquí es indiagnosticable; fuera de producción se muestra.
  return process.env.NODE_ENV === "production" ? "No se pudo guardar el catálogo." : `No se pudo guardar el catálogo: ${message}`;
}
