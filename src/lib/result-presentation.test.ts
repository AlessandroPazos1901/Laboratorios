import { describe, expect, it } from "vitest";
import { matchChoiceOption, sanitizeResultInput } from "./result-presentation";

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
