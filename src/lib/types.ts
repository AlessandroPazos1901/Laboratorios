export type OrderStatus =
  | "draft"
  | "pending_validation"
  | "validated"
  | "delivered"
  | "cancelled";

export type ResultFlag = "normal" | "low" | "high" | "critical";

export type Patient = {
  id: string;
  documentNumber: string;
  fullName: string;
  birthDate: string;
  sex: "F" | "M";
  phone?: string;
};

export type ResultValue = {
  id: string;
  analyte: string;
  group: string;
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
};

export type LabOrder = {
  id: string;
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
  code: string;
  name: string;
  group: string;
  resultType: "numeric" | "qualitative" | "text";
  unit: string;
  method: string;
  reference: string;
  active: boolean;
};
