import type { Patient } from "@/lib/types";

export const PATIENT_ROSTER_BUCKET_BATCH_ITEMS = 20_000;
export const PATIENT_ROSTER_FAILURE_LIMIT = 100;

export type PatientRosterPatient = Pick<Patient, "documentNumber" | "fullName" | "birthDate"> & {
  sex: "F" | "M";
};

export type PatientRosterBucket =
  | { key: `dni:${string}`; kind: "patients"; patients: PatientRosterPatient[] }
  | { key: `name:${string}`; kind: "names"; documentNumbers: string[] };

export type PatientRosterSheet = {
  name: string;
  rows: number;
  headers: string[];
  sampleRows: string[][];
};

export type PatientRosterPreview = {
  file: string;
  warning: string | null;
  sheets: PatientRosterSheet[];
};

export type PatientRosterMapping = {
  sheetName: string;
  dniColumn: number;
  nameColumn: number;
  birthDateColumn: number;
  sexColumn: number;
};

export type PatientRosterFailure = { row: number; reason: string };

export type PatientRosterImportResult = {
  imported: number;
  failed: number;
  duplicates: number;
  total: number;
  failures: PatientRosterFailure[];
};

export type PatientRosterMetadata = {
  rosterId: string;
  fileName: string;
  sheetName: string;
  count: number;
  sourceRows: number;
  importedAt: string;
  format?: "buckets-v1";
};

export function normalizePatientSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleUpperCase("es")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizePatientDni(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const digits = String(Math.trunc(value));
    return digits.length <= 8 ? digits.padStart(8, "0") : digits;
  }
  const text = String(value ?? "").trim();
  if (/^\d+(?:\.0+)?$/.test(text)) {
    const digits = text.replace(/\.0+$/, "");
    return digits.length <= 8 ? digits.padStart(8, "0") : digits;
  }
  return text.replace(/\D/g, "");
}

export function normalizePatientName(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

export function normalizePatientSex(value: unknown): "F" | "M" | null {
  const normalized = normalizePatientSearch(String(value ?? ""));
  if (["F", "FEMENINO", "FEMALE", "MUJER", "2"].includes(normalized)) return "F";
  if (["M", "MASCULINO", "MALE", "HOMBRE", "1"].includes(normalized)) return "M";
  return null;
}

function validIsoDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  if (date.getTime() > Date.now()) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function normalizePatientBirthDate(value: unknown): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return validIsoDate(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86_400_000);
    return validIsoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }
  const text = String(value ?? "").trim();
  let match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (match) return validIsoDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (match) return validIsoDate(Number(match[3]), Number(match[2]), Number(match[1]));
  return null;
}

export function normalizePatientRosterRow(input: {
  dni: unknown;
  fullName: unknown;
  birthDate: unknown;
  sex: unknown;
}): { patient: PatientRosterPatient | null; reason?: string } {
  const documentNumber = normalizePatientDni(input.dni);
  if (!/^\d{8}$/.test(documentNumber)) return { patient: null, reason: "DNI inválido; debe tener 8 dígitos." };
  const fullName = normalizePatientName(input.fullName);
  if (fullName.length < 2) return { patient: null, reason: "Nombre completo vacío o inválido." };
  const birthDate = normalizePatientBirthDate(input.birthDate);
  if (!birthDate) return { patient: null, reason: "Fecha de nacimiento inválida." };
  const sex = normalizePatientSex(input.sex);
  if (!sex) return { patient: null, reason: "Sexo inválido; debe corresponder a M o F." };
  return { patient: { documentNumber, fullName, birthDate, sex } };
}

export function patientSearchTerms(patient: PatientRosterPatient) {
  const nameTerms = normalizePatientSearch(patient.fullName)
    .split(" ")
    .filter((term) => term.length >= 4)
    .map((term) => `name:${term.slice(0, 4)}`);
  return [...new Set([`dni:${patient.documentNumber.slice(0, 4)}`, ...nameTerms])];
}

export function patientRosterBucketKeys(patient: PatientRosterPatient) {
  return {
    dni: `dni:${patient.documentNumber.slice(0, 4)}` as const,
    names: patientSearchTerms(patient).filter((term): term is `name:${string}` => term.startsWith("name:")),
  };
}

export function patientQueryTerms(query: string) {
  const normalized = normalizePatientSearch(query);
  if (/^\d{4,8}$/.test(normalized)) return [`dni:${normalized.slice(0, 4)}`];
  const words = normalized.split(" ").filter((word) => word.length >= 4);
  return [...new Set(words.map((word) => `name:${word.slice(0, 4)}`))];
}

export function patientMatchesQuery(patient: PatientRosterPatient, query: string) {
  const normalized = normalizePatientSearch(query);
  if (!normalized) return false;
  if (/^\d+$/.test(normalized)) return patient.documentNumber.includes(normalized);
  const haystack = normalizePatientSearch(patient.fullName);
  return normalized.split(" ").every((word) => haystack.includes(word));
}
