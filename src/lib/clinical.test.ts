import { describe, expect, it } from "vitest";
import { calculateAgeAt, flagNumericResult, isValidDni, normalizeDocument } from "./clinical";

describe("calculateAgeAt", () => {
  it("calcula la edad en la fecha de la orden y no con la fecha actual", () => {
    expect(calculateAgeAt("2000-08-01", "2026-07-24")).toEqual({ years: 25, months: 11 });
  });
  it("respeta el día del cumpleaños", () => {
    expect(calculateAgeAt("2000-07-24", "2026-07-24")).toEqual({ years: 26, months: 0 });
  });
});

describe("flagNumericResult", () => {
  const limits = { low: 70, high: 100, criticalLow: 40, criticalHigh: 250 };
  it.each([
    [39, "critical"], [40, "critical"], [69, "low"], [70, "normal"],
    [100, "normal"], [101, "high"], [250, "critical"],
  ])("clasifica %s como %s", (value, flag) => {
    expect(flagNumericResult(value as number, limits)).toBe(flag);
  });
});

describe("DNI", () => {
  it("normaliza separadores y limita longitud", () => {
    expect(normalizeDocument("70.421-856abc")).toBe("70421856");
  });
  it("acepta exactamente ocho dígitos", () => {
    expect(isValidDni("70421856")).toBe(true);
    expect(isValidDni("7042185")).toBe(false);
  });
});
