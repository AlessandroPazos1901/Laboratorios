export type ResultFlag = "normal" | "low" | "high" | "critical" | "unreviewed";

export type Patient = {
  id: number;
  documentNumber: string;
  fullName: string;
  birthDate: string;
  sex: "F" | "M" | "X" | "U";
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
  analysts: Analyst[];
  trend: { date: string; value: number }[];
  summary: AnalyticsSummary;
  reportSettings?: { tradeName: string; footer: string };
};

export type Analyst = {
  id: string;
  fullName: string;
  active: boolean;
};

export type ResultValue = {
  id: string;
  orderAnalysisId: string;
  analysisVersionId?: string;
  batchId: string;
  registeredAt: string;
  analyte: string;
  analysisCode?: string;
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
  analystId?: string;
  performedBy: string;
  qualitativeOptions?: string[];
};

export type LabOrder = {
  id: string;
  revisionId: string;
  lockVersion: number;
  revisionNumber?: number;
  code: string;
  patientId: number;
  patientName: string;
  documentNumber: string;
  patientBirthDate: string;
  patientSex: Patient["sex"];
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
