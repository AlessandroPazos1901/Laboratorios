import { describe, expect, it } from "vitest";
import { matchChoiceOption, resultStorageValue, sanitizeResultInput } from "./result-presentation";

describe("validación de lo que se teclea en un resultado", () => {
  it("un campo numérico no deja escribir ni una letra", () => {
    expect(sanitizeResultInput("numeric", "12a3b")).toBe("123");
    expect(sanitizeResultInput("numeric", "abc")).toBe("");
    expect(sanitizeResultInput("numeric", "1,5")).toBe("1.5");
    expect(sanitizeResultInput("numeric", "-2.7")).toBe("-2.7");
    // Un solo separador: "1.2.3" es un tecleo, no un número.
    expect(sanitizeResultInput("numeric", "1.2.3")).toBe("1.23");
  });

  it("respeta los decimales aprobados en el catálogo", () => {
    expect(sanitizeResultInput("numeric", "1.239", 2)).toBe("1.23");
    expect(sanitizeResultInput("numeric", "1.239", 0)).toBe("1");
    expect(sanitizeResultInput("numeric", "1.239")).toBe("1.239");
  });

  it("deja escribir decimales donde la casilla se teclea en miles", () => {
    // HEM-WBC guarda enteros (/µL) pero se teclea en 10³/µL: «8.35» son 8350.
    expect(sanitizeResultInput("numeric", "8.35", 0, "HEM-WBC")).toBe("8.35");
    expect(sanitizeResultInput("numeric", "8.", 0, "HEM-WBC")).toBe("8.");
    expect(resultStorageValue(sanitizeResultInput("numeric", "8.35", 0, "HEM-WBC"), "HEM-WBC")).toBe("8350");
    expect(sanitizeResultInput("numeric", "250.5", 0, "HEM-PLT")).toBe("250.5");
    // El cuarto decimal ya no cabe: guardado sería 8356.7, y el catálogo pide entero.
    expect(sanitizeResultInput("numeric", "8.3567", 0, "HEM-WBC")).toBe("8.356");
    // Un análisis normal con decimals 0 sigue sin admitir punto.
    expect(sanitizeResultInput("numeric", "8.35", 0, "BIO-GLU")).toBe("8");
  });

  it("no toca los campos de texto ni los de lista", () => {
    expect(sanitizeResultInput("text", "Color ámbar 3+")).toBe("Color ámbar 3+");
    expect(sanitizeResultInput("qualitative", "POSITIVO 2 (+)")).toBe("POSITIVO 2 (+)");
  });

  it("ajusta lo tecleado a la opción exacta que espera la base", () => {
    const options = ["NO SE OBSERVA", "POSITIVO 1 (+)", "POSITIVO 2 (+)"];
    expect(matchChoiceOption(options, "POSITIVO 1 (+)")).toBe("POSITIVO 1 (+)");
    // Sin esto llegaría en minúscula y la base respondería
    // `qualitative_option_not_allowed` con la tanda entera ya escrita.
    expect(matchChoiceOption(options, "  positivo 1 (+) ")).toBe("POSITIVO 1 (+)");
    expect(matchChoiceOption(options, "")).toBe("");
  });

  it("rechaza lo que no está en la lista", () => {
    expect(matchChoiceOption(["NEGATIVO", "POSITIVO"], "quizás")).toBeNull();
  });
});
