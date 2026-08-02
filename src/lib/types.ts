export type ResultFlag = "normal" | "low" | "high" | "critical" | "unreviewed";

export type Patient = {
  id: string;
  documentNumber: string;
  fullName: string;
  birthDate: string;
  birthAt: string;
  sex: "F" | "M" | "X" | "U";
  phone?: string;
  syncVersion?: number;
  syncState?: "synced" | "pending" | "conflict";
  clientMutationId?: string;
};

export type AnalyticsSummary = {
  orders: number;
  analyses: number;
  patients: number;
  criticalValues: number;
};

export type LabData = {
  patients: Patient[];
  orders: LabOrder[];
  analyses: AnalysisDefinition[];
  trend: { date: string; value: number }[];
  summary: AnalyticsSummary;
  reportSettings?: { tradeName: string; footer: string };
};

export type ResultValue = {
  id: string;
  orderAnalysisId: string;
  analysisVersionId?: string;
  batchId: string;
  registeredAt: string;
  analyte: string;
  group: string;
  resultType: "numeric" | "qualitative" | "text";
  value: string;
  numericValue?: number;
  unit: string;
  reference: string;
  low?: number;
  high?: number;
  criticalLow?: number;
  criticalHigh?: number;
  flag: ResultFlag;
  method: string;
  performedBy: string;
  qualitativeOptions?: string[];
};

export type LabOrder = {
  id: string;
  revisionId: string;
  lockVersion: number;
  revisionNumber?: number;
  code: string;
  patientId: string;
  patientName: string;
  documentNumber: string;
  patientBirthAt: string;
  patientSex: Patient["sex"];
  patientPhone?: string;
  createdAt: string;
  groups: string[];
  responsible: string;
  results: ResultValue[];
  syncState?: "synced" | "pending" | "conflict";
  clientMutationId?: string;
};

export type AnalysisDefinition = {
  id: string;
  versionId: string;
  code: string;
  name: string;
  group: string;
  resultType: "numeric" | "qualitative" | "text";
  unit: string;
  method: string;
  reference: string;
  active: boolean;
  sampleType?: string;
  decimals?: number;
  qualitativeOptions?: string[];
  low?: number;
  high?: number;
  criticalLow?: number;
  criticalHigh?: number;
  subsection?: string;
  common?: boolean;
  pickerOrder?: number;
};
