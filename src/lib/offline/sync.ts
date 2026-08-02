import type { OfflineOperation } from "@/lib/offline/types";

export function orderOperationsByDependencies<T extends { operation: OfflineOperation }>(values: T[]) {
  const pendingIds = new Set(values.map((item) => item.operation.clientMutationId));
  const sorted: T[] = [];
  const remaining = [...values].sort((a, b) => a.operation.createdAt.localeCompare(b.operation.createdAt));
  while (remaining.length) {
    const index = remaining.findIndex(({ operation }) => operation.dependencies.every((id) =>
      !pendingIds.has(id) || sorted.some((item) => item.operation.clientMutationId === id)));
    sorted.push(...remaining.splice(index >= 0 ? index : 0, 1));
  }
  return sorted;
}
