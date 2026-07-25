export type OrderStatus =
  | "draft"
  | "pending_validation"
  | "validated"
  | "delivered"
  | "cancelled";

export type ResultFlag = "normal" | "low" | "high" | "critical" | "unreviewed";

export type Patient = {
  id: string;
  documentNumber: string;
  fullName: string;
  birthDate: string;
  sex: "F" | "M" | "X" | "U";
  phone?: string;
};

export type AnalyticsSummary = {
  orders: number;
  analyses: number;
  patients: number;
  delivered: number;
  pendingValidation: number;
  criticalValues: number;
  medianTurnaroundMinutes: number | null;
};

export type LabData = {
  patients: Patient[];
  orders: LabOrder[];
  analyses: AnalysisDefinition[];
  auditEvents: AuditEvent[];
  trend: { date: string; value: number }[];
  summary: AnalyticsSummary;
};

export type ResultValue = {
  id: string;
  orderAnalysisId: string;
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
  qualitativeOptions?: string[];
};

export type LabOrder = {
  id: string;
  revisionId: string;
  lockVersion: number;
  code: string;
  patientId: string;
  patientName: string;
  documentNumber: string;
  createdAt: string;
  status: OrderStatus;
  groups: string[];
  responsible: string;
  turnaroundMinutes?: number;
  results: ResultValue[];
};

export type AuditEvent = {
  id: string;
  occurredAt: string;
  actor: string;
  action: string;
  entity: string;
  summary: string;
  reason?: string;
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
};
