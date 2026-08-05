export const CATALOG_GROUPS = [
  { name: "HEMATOLOGÍA", order: 10, analyses: [
    "HEMATIES", "HEMOGLOBINA", "HEMATOCRITO", "LEUCOCITOS", "ABASTONADOS",
    "SEGMENTADOS", "EOSINOFILOS", "BASOFILOS", "MONOCITOS", "LINFOCITOS",
    "PLAQUETAS", "GRUPO Y FACTOR", "T.C.", "T.S.", "V.S.G.",
  ] },
  { name: "BIOQUÍMICA", order: 20, analyses: [
    "GLUCOSA", "UREA", "CREATININA", "COLESTEROL TOTAL", "HDL COLESTEROL",
    "LDL COLESTEROL", "TRIGLICERIDOS", "TGO", "TGP", "B.TOTAL", "B.DIRECTA",
    "B.INDIRECTA", "ÁCIDO ÚRICO", "AMILASA", "DOSAJE HB",
  ] },
  { name: "INMUNOLOGÍA", order: 30, analyses: [
    "F.REUMATOIDEO", "PCR", "RPR O VDRL", "PR HVB", "PR HIV", "PR SIFILIS",
    "PSA", "PR THEVENON", "HELICOBACTER P.", "PR HVC", "HCG (SANGRE)",
    "AGLUTINACIONES TIFICO \"O\"", "AGLUTINACIONES TIFICO \"H\"",
    "AGLUTINACIONES PARATIFICO \"A\"", "AGLUTINACIONES PARATIFICO \"B\"",
    "AGLUTINACIONES BRUCELLAS \"Br\"",
  ] },
  { name: "UROANÁLISIS", order: 40, analyses: [
    "COLOR", "ASPECTO", "PH", "DENSIDAD", "GLUCOSA", "CETONAS", "PROTEÍNAS",
    "BILIRRUBINA", "SANGRE", "NITRITOS", "UROBILINOGENO", "A.ASCORBICO",
    "C.EPITELIALES", "HEMATIES", "LEUCOCITOS", "PIOCITOS", "GÉRMENES",
    "PROTEINURA", "CRISTALES", "CILINDROS", "OTROS", "OTROS",
  ] },
  { name: "PARASITOLOGÍA", order: 50, analyses: [
    "COLOR", "CONSISTENCIA", "ASPECTO", "MOCO", "HUEVO", "LARVA", "QUISTE",
    "TROFOZOITO", "RX INFLAMATORIA", "TEST GRAHAM", "THEVENON", "N° MUESTRA 1°",
    "N° MUESTRA 2°", "N° MUESTRA 3°", "METODO DIRECTO", "METODO TSR",
  ] },
  { name: "OTROS", order: 60, analyses: [
    "LEISHMANIASIS", "GOTA GRUESA", "TEST HELECHO", "COLORACIÓN GRAM",
  ] },
] as const;

function normalizeCatalogLabel(value: string) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase().replace(/\s+/g, " ").trim();
}

const groupOrder = new Map(CATALOG_GROUPS.map((group) => [normalizeCatalogLabel(group.name), group.order]));
const analysisOrder = new Map<string, number>();
CATALOG_GROUPS.forEach((group) => group.analyses.forEach((analysis, index) => {
  const key = `${normalizeCatalogLabel(group.name)}\u0000${normalizeCatalogLabel(analysis)}`;
  if (!analysisOrder.has(key)) analysisOrder.set(key, (index + 1) * 10);
}));

export function canonicalGroupOrder(group: string) {
  return groupOrder.get(normalizeCatalogLabel(group)) ?? 999;
}

export function canonicalAnalysisOrder(group: string, analysis: string) {
  return analysisOrder.get(`${normalizeCatalogLabel(group)}\u0000${normalizeCatalogLabel(analysis)}`) ?? 999;
}

export function compareCatalogEntries(
  left: { group: string; analysis: string },
  right: { group: string; analysis: string },
) {
  return canonicalGroupOrder(left.group) - canonicalGroupOrder(right.group)
    || canonicalAnalysisOrder(left.group, left.analysis) - canonicalAnalysisOrder(right.group, right.analysis)
    || left.analysis.localeCompare(right.analysis, "es");
}
