"use client";

import type {
  PatientRosterBucket,
  PatientRosterImportResult,
  PatientRosterMapping,
  PatientRosterPreview,
} from "@/lib/offline/patient-roster";

function rosterWorker() {
  return new Worker(new URL("../../workers/patient-roster.worker.ts", import.meta.url));
}

export async function previewPatientRosterFile(file: File) {
  const worker = rosterWorker();
  const buffer = await file.arrayBuffer();
  return new Promise<PatientRosterPreview>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<{ type: string; preview?: PatientRosterPreview; error?: string }>) => {
      if (event.data.type === "preview-result" && event.data.preview) {
        worker.terminate();
        resolve(event.data.preview);
      } else if (event.data.type === "error") {
        worker.terminate();
        reject(new Error(event.data.error ?? "No se pudo leer el archivo."));
      }
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error("No se pudo iniciar el lector de Excel."));
    };
    worker.postMessage({ type: "preview", buffer, fileName: file.name }, [buffer]);
  });
}

export async function streamPatientRosterFile(input: {
  file: File;
  mapping: PatientRosterMapping;
  onBatch(buckets: PatientRosterBucket[]): Promise<void>;
  onProgress?(progress: { processed: number; total: number; imported: number; failed: number }): void;
}) {
  const worker = rosterWorker();
  const buffer = await input.file.arrayBuffer();
  return new Promise<PatientRosterImportResult>((resolve, reject) => {
    let settled = false;
    const fail = (reason: unknown) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      reject(reason instanceof Error ? reason : new Error("No se pudo importar el archivo."));
    };
    worker.onmessage = (event: MessageEvent<{
      type: string;
      batchId?: number;
      buckets?: PatientRosterBucket[];
      processed?: number;
      total?: number;
      imported?: number;
      failed?: number;
      result?: PatientRosterImportResult;
      error?: string;
    }>) => {
      const message = event.data;
      if (message.type === "batch" && message.batchId !== undefined && message.buckets) {
        void input.onBatch(message.buckets)
          .then(() => worker.postMessage({ type: "ack", batchId: message.batchId }))
          .catch(fail);
      } else if (message.type === "progress") {
        input.onProgress?.({
          processed: message.processed ?? 0,
          total: message.total ?? 0,
          imported: message.imported ?? 0,
          failed: message.failed ?? 0,
        });
      } else if (message.type === "import-result" && message.result) {
        settled = true;
        worker.terminate();
        resolve(message.result);
      } else if (message.type === "error") {
        fail(new Error(message.error ?? "No se pudo procesar el archivo."));
      }
    };
    worker.onerror = () => fail(new Error("El lector de Excel se detuvo inesperadamente."));
    worker.postMessage({ type: "import", buffer, mapping: input.mapping }, [buffer]);
  });
}
