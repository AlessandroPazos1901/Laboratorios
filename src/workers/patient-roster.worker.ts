/// <reference lib="webworker" />

import * as XLSX from "xlsx";
import {
  normalizePatientRosterRow,
  patientRosterBucketKeys,
  PATIENT_ROSTER_BUCKET_BATCH_ITEMS,
  PATIENT_ROSTER_FAILURE_LIMIT,
  type PatientRosterBucket,
  type PatientRosterFailure,
  type PatientRosterMapping,
  type PatientRosterPatient,
} from "@/lib/offline/patient-roster";

type StartMessage =
  | { type: "preview"; buffer: ArrayBuffer; fileName: string }
  | { type: "import"; buffer: ArrayBuffer; mapping: PatientRosterMapping }
  | { type: "ack"; batchId: number };

const worker = self as unknown as DedicatedWorkerGlobalScope;
const batchAcks = new Map<number, () => void>();

function cellAt(sheet: XLSX.WorkSheet, row: number, column: number) {
  const dense = (sheet as XLSX.WorkSheet & { "!data"?: XLSX.CellObject[][] })["!data"];
  return dense?.[row]?.[column] ?? sheet[XLSX.utils.encode_cell({ r: row, c: column })];
}

function sheetRange(sheet: XLSX.WorkSheet) {
  const reference = (sheet as XLSX.WorkSheet & { "!fullref"?: string })["!fullref"] ?? sheet["!ref"];
  return reference ? XLSX.utils.decode_range(reference) : null;
}

async function preview(buffer: ArrayBuffer, fileName: string) {
  const workbook = XLSX.read(buffer, { type: "array", dense: true, sheetRows: 7, cellDates: true });
  const sheets = workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    const range = sheetRange(sheet);
    if (!range) return { name, rows: 0, headers: [], sampleRows: [] };
    const headers = Array.from({ length: range.e.c - range.s.c + 1 }, (_, offset) => {
      const cell = cellAt(sheet, range.s.r, range.s.c + offset);
      return cell ? XLSX.utils.format_cell(cell).trim() : "";
    });
    const lastSampleRow = Math.min(range.e.r, range.s.r + 5);
    const sampleRows = Array.from({ length: Math.max(0, lastSampleRow - range.s.r) }, (_, rowOffset) =>
      headers.map((_, columnOffset) => {
        const cell = cellAt(sheet, range.s.r + rowOffset + 1, range.s.c + columnOffset);
        return cell ? XLSX.utils.format_cell(cell).trim() : "";
      }));
    return { name, rows: Math.max(0, range.e.r - range.s.r), headers, sampleRows };
  });
  worker.postMessage({ type: "preview-result", preview: { file: fileName, warning: null, sheets } });
}

function sendBatch(batchId: number, buckets: PatientRosterBucket[]) {
  return new Promise<void>((resolve) => {
    batchAcks.set(batchId, resolve);
    worker.postMessage({ type: "batch", batchId, buckets });
  });
}

async function importPatients(buffer: ArrayBuffer, mapping: PatientRosterMapping) {
  const workbook = XLSX.read(buffer, {
    type: "array",
    dense: true,
    cellDates: true,
    sheets: [mapping.sheetName],
  });
  const sheet = workbook.Sheets[mapping.sheetName];
  const range = sheet && sheetRange(sheet);
  if (!sheet || !range) throw new Error("La hoja seleccionada no contiene datos.");

  const seen = new Set<string>();
  const failures: PatientRosterFailure[] = [];
  const patientBuckets = new Map<string, PatientRosterPatient[]>();
  const nameBuckets = new Map<string, string[]>();
  let imported = 0;
  let failed = 0;
  let duplicates = 0;
  let batchId = 0;
  const total = Math.max(0, range.e.r - range.s.r);

  for (let row = range.s.r + 1; row <= range.e.r; row += 1) {
    const read = (oneBasedColumn: number) => cellAt(sheet, row, range.s.c + oneBasedColumn - 1)?.v;
    const normalized = normalizePatientRosterRow({
      dni: read(mapping.dniColumn),
      fullName: read(mapping.nameColumn),
      birthDate: read(mapping.birthDateColumn),
      sex: read(mapping.sexColumn),
    });
    if (!normalized.patient) {
      failed += 1;
      if (failures.length < PATIENT_ROSTER_FAILURE_LIMIT) failures.push({ row: row + 1, reason: normalized.reason ?? "Fila inválida." });
    } else if (seen.has(normalized.patient.documentNumber)) {
      duplicates += 1;
    } else {
      seen.add(normalized.patient.documentNumber);
      const bucketKeys = patientRosterBucketKeys(normalized.patient);
      const dniBucket = bucketKeys.dni.slice(4);
      const patients = patientBuckets.get(dniBucket) ?? [];
      patients.push(normalized.patient);
      patientBuckets.set(dniBucket, patients);
      for (const term of bucketKeys.names) {
        const documentNumbers = nameBuckets.get(term) ?? [];
        documentNumbers.push(normalized.patient.documentNumber);
        nameBuckets.set(term, documentNumbers);
      }
      imported += 1;
    }
  }

  const totalBucketItems = imported + [...nameBuckets.values()].reduce((sum, values) => sum + values.length, 0);
  let persistedItems = 0;
  let batchItems = 0;
  let bucketBatch: PatientRosterBucket[] = [];
  const flush = async () => {
    if (!bucketBatch.length) return;
    batchId += 1;
    const current = bucketBatch;
    const currentItems = batchItems;
    bucketBatch = [];
    batchItems = 0;
    await sendBatch(batchId, current);
    persistedItems += currentItems;
    const ratio = totalBucketItems ? persistedItems / totalBucketItems : 1;
    worker.postMessage({
      type: "progress",
      processed: Math.min(total, Math.round(total * ratio)),
      total,
      imported: Math.min(imported, Math.round(imported * ratio)),
      failed,
    });
  };
  const enqueueBucket = async (bucket: PatientRosterBucket) => {
    const size = bucket.kind === "patients" ? bucket.patients.length : bucket.documentNumbers.length;
    if (bucketBatch.length && batchItems + size > PATIENT_ROSTER_BUCKET_BATCH_ITEMS) await flush();
    bucketBatch.push(bucket);
    batchItems += size;
  };
  for (const [prefix, patients] of patientBuckets) {
    await enqueueBucket({ key: `dni:${prefix}`, kind: "patients", patients });
    patientBuckets.delete(prefix);
  }
  for (const [term, documentNumbers] of nameBuckets) {
    await enqueueBucket({ key: term as `name:${string}`, kind: "names", documentNumbers });
    nameBuckets.delete(term);
  }
  await flush();
  worker.postMessage({ type: "progress", processed: total, total, imported, failed });
  worker.postMessage({ type: "import-result", result: { imported, failed, duplicates, total, failures } });
}

worker.onmessage = (event: MessageEvent<StartMessage>) => {
  const message = event.data;
  if (message.type === "ack") {
    batchAcks.get(message.batchId)?.();
    batchAcks.delete(message.batchId);
    return;
  }
  const action = message.type === "preview"
    ? preview(message.buffer, message.fileName)
    : importPatients(message.buffer, message.mapping);
  void action.catch((reason) => worker.postMessage({
    type: "error",
    error: reason instanceof Error ? reason.message : "No se pudo procesar el archivo.",
  }));
};

export {};
