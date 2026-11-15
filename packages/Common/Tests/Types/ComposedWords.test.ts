import {
  composeWords,
  composedWordsOf,
  fillComposedWords,
} from "../../Types/ComposedWords";
import { createTranslator, Translator } from "../../Types/Translator";
import { describe, expect, test } from "@jest/globals";

/*
 * WORDS BUILT FROM A NAME, LOOKED UP AS THE SENTENCE THEY WERE BUILT FROM
 * (#8642): composeWords builds the English as it always was and remembers
 * the sentence; a Translator with no wording of its own for that English
 * words the sentence, the names as its terms.
 */

const GERMAN: Record<string, string> = {
  "Find a {{thing}} by name": "{{thing}} nach Namen suchen",
  "Every {{thing}} of the {{place}}": "Jedes {{thing}} von {{place}}",
  Widget: "Bauteil",
  Garage: "Werkstatt",
  "Already worded": "Schon übersetzt",
};

function germanTranslator(): Translator {
  return createTranslator((text: string): string | undefined => {
    return GERMAN[text];
  }, "de");
}

describe("composeWords", () => {
  test("builds the English the template reads with the names, as written", () => {
    expect(composeWords("Find a {{thing}} by name", { thing: "Widget" })).toBe(
      "Find a Widget by name",
    );
    expect(fillComposedWords("{{a}} and {{b}}", { a: "One" })).toBe(
      "One and {{b}}",
    );
  });

  test("remembers the sentence and the names it was built from", () => {
    composeWords(
      "Every {{thing}} of the {{place}}",
      { thing: "Widget", place: "Garage" },
      { inSentence: true },
    );

    expect(composedWordsOf("Every Widget of the Garage")).toEqual({
      template: "Every {{thing}} of the {{place}}",
      terms: { thing: "Widget", place: "Garage" },
      inSentence: true,
    });
    expect(composedWordsOf("Something nobody composed")).toBeUndefined();
  });

  test("a template with no names in it is not remembered", () => {
    expect(composeWords("Already worded", {})).toBe("Already worded");
    expect(composedWordsOf("Already worded")).toBeUndefined();
  });

  test("the first sentence that builds an English keeps it", () => {
    composeWords("{{x}} first", { x: "Same" });
    composeWords("Same {{y}}", { y: "first" });

    expect(composedWordsOf("Same first")?.template).toBe("{{x}} first");
  });
});

describe("a Translator words composed words", () => {
  test("in the reader's language: the sentence's wording, the names as its terms", () => {
    const english: string = composeWords("Find a {{thing}} by name", {
      thing: "Widget",
    });

    expect(germanTranslator().translateText(english)).toBe(
      "Bauteil nach Namen suchen",
    );
    expect(germanTranslator().hasTranslation(english)).toBe(true);
  });

  test("in a sentence of its own, through a term", () => {
    const english: string = composeWords("Find a {{thing}} by name", {
      thing: "Widget",
    });
    const translator: Translator = createTranslator(
      (text: string): string | undefined => {
        return text === "Look: {{what}}" ? "Schau: {{what}}" : GERMAN[text];
      },
      "de",
    );

    expect(
      translator.translateTemplate("Look: {{what}}", {
        what: { translatableTerm: english },
      } as never),
    ).toBe("Schau: Bauteil nach Namen suchen");
  });

  test("a language that has not worded the sentence keeps the English, word for word", () => {
    const english: string = composeWords("Find a {{thing}} by name", {
      thing: "Widget",
    });
    const french: Translator = createTranslator(
      (text: string): string | undefined => {
        return text === "Widget" ? "Composant" : undefined;
      },
      "fr",
    );

    expect(french.translateText(english)).toBe("Find a Widget by name");
    expect(french.hasTranslation(english)).toBe(false);
  });

  test("English, and a Translator with no locale, read the English", () => {
    const english: string = composeWords("Find a {{thing}} by name", {
      thing: "Widget",
    });

    expect(createTranslator(undefined, "en").translateText(english)).toBe(
      english,
    );
    expect(
      createTranslator((text: string): string => {
        return text;
      }, "en").translateText(english),
    ).toBe(english);
  });

  test("a wording of the English itself wins over the sentence", () => {
    const english: string = composeWords("Find a {{thing}} by name", {
      thing: "Widget",
    });
    const translator: Translator = createTranslator(
      (text: string): string | undefined => {
        return text === english ? "Eigene Worte" : GERMAN[text];
      },
      "de",
    );

    expect(translator.translateText(english)).toBe("Eigene Worte");
  });
});
