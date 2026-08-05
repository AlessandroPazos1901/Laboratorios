export function formatDni(patientId: number) {
  return String(patientId).padStart(8, "0");
}

export function patientIdFromDni(dni: string) {
  return /^\d{8}$/.test(dni) ? Number(dni) : null;
}
