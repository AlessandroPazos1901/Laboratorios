import type { AnalysisDefinition } from "@/lib/types";
import { canonicalAnalysisOrder, canonicalGroupOrder } from "@/lib/catalog-order";

type GroupPreset = {
  group: string;
  order: number;
  common: string[];
  subsections?: Record<string, string>;
};

export type PickerAnalysis = AnalysisDefinition & {
  common: boolean;
  subsection?: string;
  pickerOrder: number;
};

export type PickerGroup = {
  group: string;
  items: PickerAnalysis[];
  commonItems: PickerAnalysis[];
  extraItems: PickerAnalysis[];
};

const GROUP_PRESETS: GroupPreset[] = [
  {
    group: "Hematologia",
    order: 10,
    common: [
      "Globulos rojos (hematies)",
      "Hemoglobina",
      "Hematocrito",
      "Globulos blancos (leucocitos)",
      "Plaquetas",
      "Linfocitos",
    ],
  },
  {
    group: "Bioquimica",
    order: 20,
    common: [
      "Glucosa",
      "Urea",
      "Creatinina",
      "Colesterol total",
      "Trigliceridos",
      "Hb. glicosilada",
    ],
  },
  {
    group: "Inmunologia",
    order: 30,
    common: [
      "FR",
      "PCR",
      "RPR",
      "HCG (orina)",
      "HCG (sangre)",
      "Aglutinaciones",
    ],
    subsections: {
      "HBsAG (hepatitis B)": "Inmunocromatografia",
      "HIV (SIDA)": "Inmunocromatografia",
      "Sifilis (PR)": "Inmunocromatografia",
      "PSA (prostata)": "Inmunocromatografia",
      "Thevenon": "Inmunocromatografia",
      "H. pylori": "Inmunocromatografia",
      "Tifico \"O\"": "Aglutinaciones",
      "Tifico \"H\"": "Aglutinaciones",
      "Paratifico \"A\"": "Aglutinaciones",
      "Paratifico \"B\"": "Aglutinaciones",
      "Brucellas": "Aglutinaciones",
    },
  },
  {
    group: "Uroanalisis",
    order: 40,
    common: [
      "Color",
      "Aspecto",
      "pH",
      "Densidad",
      "Proteinas",
      "Leucocitos",
    ],
    subsections: {
      "Color": "Examen fisico",
      "Aspecto": "Examen fisico",
      "pH": "Examen fisico",
      "Densidad": "Examen fisico",
      "Glucosa": "Examen bioquimico",
      "Cetonas": "Examen bioquimico",
      "Proteinas": "Examen bioquimico",
      "Bilirrubina": "Examen bioquimico",
      "Sangre": "Examen bioquimico",
      "Nitritos": "Examen bioquimico",
      "Urobilinogeno": "Examen bioquimico",
      "Acido ascorbico": "Examen bioquimico",
      "Celulas": "Examen microscopico",
      "Hematies": "Examen microscopico",
      "Leucocitos": "Examen microscopico",
      "Piocitos": "Examen microscopico",
      "Germenes": "Examen microscopico",
      "Cristales": "Examen microscopico",
      "Cilindros": "Examen microscopico",
      "Otros": "Examen microscopico",
      "Proteinuria": "Examen microscopico",
    },
  },
  {
    group: "Parasitologia",
    order: 50,
    common: [
      "Color",
      "Consistencia",
      "Aspecto",
      "Moco",
      "Huevo",
      "Quistes",
    ],
  },
  {
    group: "Heces",
    order: 50,
    common: ["Color", "Consistencia", "Aspecto", "Moco", "pH", "Parásitos"],
  },
  {
    group: "Microbiología",
    order: 60,
    common: ["Leishmania", "Gota gruesa", "Test helecho", "Hongos (KOH)"],
  },
  {
    group: "Secreción vaginal",
    order: 70,
    common: ["Test de aminas", "pH", "Trichomonas", "Hongos (KOH)", "H. Ducrey", "Diplococos intracelulares (GN)"],
  },
  {
    group: "Otros",
    order: 60,
    common: [
      "Rx. inflamatoria",
      "Test graham",
      "Thevenon",
      "Leishmaniasis",
      "Gota gruesa",
      "Test de helecho",
    ],
  },
];

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("es")
    .replace(/\s+/g, " ")
    .trim();
}

function compareAnalyses(left: PickerAnalysis, right: PickerAnalysis) {
  const leftOrder = left.pickerOrder === 999 ? canonicalAnalysisOrder(left.group, left.name) : left.pickerOrder;
  const rightOrder = right.pickerOrder === 999 ? canonicalAnalysisOrder(right.group, right.name) : right.pickerOrder;
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  return left.name.localeCompare(right.name, "es");
}

function getPreset(group: string) {
  const normalized = normalizeText(group);
  return GROUP_PRESETS.find((preset) => normalizeText(preset.group) === normalized) ?? null;
}

function getSubsection(analysis: AnalysisDefinition, preset: GroupPreset | null) {
  if (analysis.subsection) return analysis.subsection;
  if (!preset?.subsections) return undefined;
  return preset.subsections[analysis.name] ?? preset.subsections[normalizeLabel(analysis.name)];
}

function normalizeLabel(label: string) {
  return label.replace(/\s+/g, " ").trim();
}

function isCommonAnalysis(analysis: AnalysisDefinition, preset: GroupPreset | null) {
  if (typeof analysis.common === "boolean") return analysis.common;
  if (!preset) return false;
  const known = new Set(preset.common.map((entry) => normalizeText(entry)));
  return known.has(normalizeText(analysis.name));
}

export function enrichAnalysis(analysis: AnalysisDefinition): PickerAnalysis {
  const preset = getPreset(analysis.group);
  return {
    ...analysis,
    common: isCommonAnalysis(analysis, preset),
    subsection: getSubsection(analysis, preset),
    pickerOrder: analysis.pickerOrder ?? 999,
  };
}

export function buildPickerGroups(analyses: AnalysisDefinition[]) {
  const buckets = new Map<string, PickerAnalysis[]>();

  analyses
    .filter((analysis) => analysis.active && analysis.versionId)
    .map(enrichAnalysis)
    .forEach((analysis) => {
      const current = buckets.get(analysis.group) ?? [];
      current.push(analysis);
      buckets.set(analysis.group, current);
    });

  return [...buckets.entries()]
    .map(([group, items]): PickerGroup => {
      const sorted = [...items].sort(compareAnalyses);
      const commonItems = sorted.filter((item) => item.common);
      return {
        group,
        items: sorted,
        commonItems: commonItems.length ? commonItems : sorted.slice(0, Math.min(6, sorted.length)),
        extraItems: sorted.filter((item) => !commonItems.includes(item)),
      };
    })
    .sort((left, right) => {
      const leftPreset = getPreset(left.group);
      const rightPreset = getPreset(right.group);
      return (leftPreset?.order ?? canonicalGroupOrder(left.group))
        - (rightPreset?.order ?? canonicalGroupOrder(right.group))
        || left.group.localeCompare(right.group, "es");
    });
}

export function filterPickerAnalyses(items: PickerAnalysis[], query: string) {
  const normalized = normalizeText(query);
  if (!normalized) return items;
  return items.filter((item) =>
    normalizeText(`${item.code} ${item.name} ${item.group} ${item.subsection ?? ""}`).includes(normalized),
  );
}
