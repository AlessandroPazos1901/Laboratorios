import type { AnalysisDefinition, AuditEvent, LabOrder, Patient } from "@/lib/types";

export const patients: Patient[] = [
  { id: "b7fc5ef4-42a7-48d9-bbe1-cf7569512179", documentNumber: "70421856", fullName: "María Elena Salazar", birthDate: "1987-04-18", sex: "F", phone: "999 000 221" },
  { id: "c8b74cb8-df7b-45c9-b1a6-b5a344143366", documentNumber: "45120987", fullName: "Carlos Huamán Rojas", birthDate: "1972-11-03", sex: "M", phone: "988 440 120" },
  { id: "1eae37e9-6043-4e4e-81e7-3ef50c046af2", documentNumber: "72814062", fullName: "Lucía Ramos Díaz", birthDate: "2001-07-24", sex: "F" },
  { id: "4b7b305d-23f2-49a1-b571-1336bd56a68d", documentNumber: "60933528", fullName: "Jorge Vidal Torres", birthDate: "1994-01-15", sex: "M" },
];

const baseResults = [
  { id: "r-hemoglobina", orderAnalysisId: "oa-hb", resultType: "numeric" as const, analyte: "Hemoglobina", group: "Hematología", value: "11.2", numericValue: 11.2, unit: "g/dL", reference: "12.0 – 16.0", low: 12, high: 16, criticalLow: 7, criticalHigh: 20, flag: "low" as const, method: "Impedancia" },
  { id: "r-leucocitos", orderAnalysisId: "oa-leu", resultType: "numeric" as const, analyte: "Leucocitos", group: "Hematología", value: "7.8", numericValue: 7.8, unit: "10³/µL", reference: "4.5 – 11.0", low: 4.5, high: 11, criticalLow: 2, criticalHigh: 30, flag: "normal" as const, method: "Impedancia" },
  { id: "r-glucosa", orderAnalysisId: "oa-glu", resultType: "numeric" as const, analyte: "Glucosa", group: "Bioquímica", value: "286", numericValue: 286, unit: "mg/dL", reference: "70 – 100", low: 70, high: 100, criticalLow: 40, criticalHigh: 250, flag: "critical" as const, method: "Enzimático" },
  { id: "r-creatinina", orderAnalysisId: "oa-cre", resultType: "numeric" as const, analyte: "Creatinina", group: "Bioquímica", value: "0.9", numericValue: 0.9, unit: "mg/dL", reference: "0.5 – 1.1", low: 0.5, high: 1.1, criticalHigh: 7, flag: "normal" as const, method: "Jaffé cinético" },
];

export const orders: LabOrder[] = [
  { id: "d2b76da6-931f-44bc-8fcc-b1b6c65ba147", revisionId: "rev-demo-1", lockVersion: 1, code: "ORD-2026-04668", patientId: patients[0].id, patientName: patients[0].fullName, documentNumber: patients[0].documentNumber, createdAt: "2026-07-24T09:42:00-05:00", status: "pending_validation", groups: ["Hematología", "Bioquímica"], responsible: "Ana Abad", turnaroundMinutes: 54, results: baseResults },
  { id: "0db324c3-3e83-412a-94ca-e4be03009a02", revisionId: "rev-demo-2", lockVersion: 1, code: "ORD-2026-04667", patientId: patients[1].id, patientName: patients[1].fullName, documentNumber: patients[1].documentNumber, createdAt: "2026-07-24T09:18:00-05:00", status: "draft", groups: ["Uroanálisis"], responsible: "José Sacramento", results: [] },
  { id: "0f7c5abc-232f-4ab4-9fae-9c90ff52b6ee", revisionId: "rev-demo-3", lockVersion: 1, code: "ORD-2026-04666", patientId: patients[2].id, patientName: patients[2].fullName, documentNumber: patients[2].documentNumber, createdAt: "2026-07-24T08:47:00-05:00", status: "validated", groups: ["Inmunología"], responsible: "Yesenia Toledo", turnaroundMinutes: 43, results: [] },
  { id: "e39e94ca-e8be-49fd-a49a-df1f5f56dc86", revisionId: "rev-demo-4", lockVersion: 1, code: "ORD-2026-04665", patientId: patients[3].id, patientName: patients[3].fullName, documentNumber: patients[3].documentNumber, createdAt: "2026-07-24T08:15:00-05:00", status: "delivered", groups: ["Parasitología"], responsible: "Ruth Herrera", turnaroundMinutes: 69, results: [] },
];

export const analyses: AnalysisDefinition[] = [
  { id: "a-1", versionId: "av-1", code: "HEM-HB", name: "Hemoglobina", group: "Hematología", resultType: "numeric", unit: "g/dL", method: "Impedancia", reference: "F: 12–16 / M: 13–17", active: true },
  { id: "a-2", versionId: "av-2", code: "BIO-GLU", name: "Glucosa", group: "Bioquímica", resultType: "numeric", unit: "mg/dL", method: "Enzimático", reference: "70–100", active: true },
  { id: "a-3", versionId: "av-3", code: "INM-PCR", name: "Proteína C reactiva", group: "Inmunología", resultType: "numeric", unit: "mg/L", method: "Inmunoturbidimetría", reference: "< 5", active: true },
  { id: "a-4", versionId: "av-4", code: "URO-PRO", name: "Proteínas en orina", group: "Uroanálisis", resultType: "qualitative", unit: "", method: "Tira reactiva", reference: "Negativo", active: true },
  { id: "a-5", versionId: "av-5", code: "PAR-DIR", name: "Examen directo de heces", group: "Parasitología", resultType: "text", unit: "", method: "Microscopía", reference: "No se observan parásitos", active: true },
];

export const auditEvents: AuditEvent[] = [
  { id: "ev-1", occurredAt: "2026-07-24T10:36:00-05:00", actor: "Ana Abad", action: "Resultado registrado", entity: "ORD-2026-04668", summary: "Glucosa: vacío → 286 mg/dL · Crítico" },
  { id: "ev-2", occurredAt: "2026-07-24T10:31:00-05:00", actor: "José Sacramento", action: "Registro creado", entity: "ORD-2026-04667", summary: "Uroanálisis solicitado" },
  { id: "ev-3", occurredAt: "2026-07-24T09:42:00-05:00", actor: "Yesenia Toledo", action: "Resultado impreso", entity: "ORD-2026-04666", summary: "3 análisis impresos · revisión 1" },
  { id: "ev-4", occurredAt: "2026-07-24T08:10:00-05:00", actor: "Usuario", action: "Catálogo actualizado", entity: "BIO-GLU", summary: "Nuevo intervalo de referencia desde 2026-07-24", reason: "Actualización de inserto del reactivo" },
];

export const trend = [
  { date: "2025-01-14", value: 92 },
  { date: "2025-05-02", value: 104 },
  { date: "2025-10-21", value: 126 },
  { date: "2026-02-09", value: 118 },
  { date: "2026-07-24", value: 286 },
];
