import { describe, expect, it } from "vitest";
import { matchChoiceOption, resultStorageValue, sanitizeResultInput } from "./result-presentation";

// Los tres análisis que se teclean en escala abreviada, con el rango tal como
// está guardado en el catálogo del laboratorio.
const LEUCOCITOS = { decimals: 0, analysisCode: "HEM-WBC", unit: "/µL", high: 10_000 };
const PLAQUETAS = { decimals: 0, analysisCode: "HEM-PLT", unit: "/µL", high: 450_000 };
const HEMATIES = { decimals: 2, analysisCode: "HEM-RBC", unit: "millones/µL", high: 5.9 };

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
    expect(sanitizeResultInput("numeric", "1.239", { decimals: 2 })).toBe("1.23");
    expect(sanitizeResultInput("numeric", "1.239", { decimals: 0 })).toBe("1");
    expect(sanitizeResultInput("numeric", "1.239")).toBe("1.239");
  });

  it("deja escribir decimales donde la casilla se teclea en miles", () => {
    // HEM-WBC guarda enteros (/µL) pero se teclea en 10³/µL: «8.35» son 8350.
    expect(sanitizeResultInput("numeric", "8.35", LEUCOCITOS)).toBe("8.35");
    expect(sanitizeResultInput("numeric", "8.", LEUCOCITOS)).toBe("8.");
    expect(resultStorageValue(sanitizeResultInput("numeric", "8.35", LEUCOCITOS), "HEM-WBC")).toBe("8350");
    expect(sanitizeResultInput("numeric", "250.5", PLAQUETAS)).toBe("250.5");
    // El cuarto decimal ya no cabe: guardado sería 8356.7, y el catálogo pide entero.
    expect(sanitizeResultInput("numeric", "8.3567", LEUCOCITOS)).toBe("8.356");
    // Un análisis normal con decimals 0 sigue sin admitir punto.
    expect(sanitizeResultInput("numeric", "8.35", { decimals: 0, analysisCode: "BIO-GLU" })).toBe("8");
  });

  it("corta los dígitos enteros de más en las casillas de escala abreviada", () => {
    // 150000 en una casilla 10³/µL son 150 mil millones de plaquetas: es la
    // cifra absoluta escrita en el campo equivocado.
    expect(sanitizeResultInput("numeric", "150000", PLAQUETAS)).toBe("150");
    // El caso del laboratorio: rango 4.5 - 10, «8456» no puede entrar entero.
    expect(sanitizeResultInput("numeric", "8456", LEUCOCITOS)).toBe("845");
    expect(sanitizeResultInput("numeric", "5300000", HEMATIES)).toBe("530");
    // Los valores normales caben enteros, con sus decimales.
    expect(sanitizeResultInput("numeric", "8.456", LEUCOCITOS)).toBe("8.456");
    expect(sanitizeResultInput("numeric", "5.3", HEMATIES)).toBe("5.3");
    // Una casilla en unidad absoluta no tiene tope de dígitos.
    expect(sanitizeResultInput("numeric", "150000", { decimals: 0, analysisCode: "BIO-GLU", unit: "mg/dL", high: 110 })).toBe("150000");
  });

  it("el tope de dígitos sale del rango, pero nunca por debajo de tres", () => {
    // Plaquetas: rango hasta 450 en 10³ -> tres dígitos.
    expect(sanitizeResultInput("numeric", "9999", PLAQUETAS)).toBe("999");
    // Leucocitos: el rango llega a 10 (dos dígitos), pero una leucocitosis de
    // leucemia son 300 ×10³ y tiene que poder registrarse.
    expect(sanitizeResultInput("numeric", "300", LEUCOCITOS)).toBe("300");
    // Un rango alto de cuatro dígitos abre la casilla a cuatro.
    expect(sanitizeResultInput("numeric", "9999", { ...PLAQUETAS, high: 1_200_000 })).toBe("9999");
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
