import {
  FIRST_STRONG_ISOLATE,
  POP_DIRECTIONAL_ISOLATE,
  getCallTranslator,
  getServerTranslator,
} from "../../../Server/Utils/ServerTranslation";
import { Translator } from "../../../Types/Translator";
import { describe, expect, test } from "@jest/globals";

/*
 * THE TRANSLATOR A CALL'S WORDS ARE WRITTEN WITH (#11066).
 *
 * The server's sentences, as a text message's are, but heard rather than
 * read: no value goes into a call's sentence between isolate marks - a
 * voice would meet them as characters - and English looks nothing up.
 */

describe("getCallTranslator", () => {
  test("English fills its templates as they are written", () => {
    const english: Translator = getCallTranslator("en");

    expect(english.language).toBe("en");
    expect(
      english.translateTemplate("This is a call from {{project}}.", {
        project: "Acme",
      }),
    ).toBe("This is a call from Acme.");
    expect(english.translateText("That key does nothing.")).toBe(
      "That key does nothing.",
    );
  });

  test("a language OneUptime writes in words the call in it", () => {
    expect(
      getCallTranslator("de").translateTemplate(
        "This is a call from {{project}}.",
        { project: "Acme" },
      ),
    ).toBe("Dies ist ein Anruf von Acme.");
    expect(getCallTranslator("de-AT").language).toBe("de");
  });

  test("a language OneUptime does not write in, or none, is English", () => {
    for (const language of [undefined, null, "", "tlh", "xx-YY"]) {
      expect(getCallTranslator(language).language).toBe("en");
    }
  });

  test("Arabic's values go in as they are, where a message to read sets them apart", () => {
    const values: { project: string } = { project: "Acme (EU)" };
    const call: string = getCallTranslator("ar").translateTemplate(
      "This is a call from {{project}}.",
      values,
    );
    const read: string = getServerTranslator("ar").translateTemplate(
      "This is a call from {{project}}.",
      values,
    );

    expect(call).toBe("هذه مكالمة من Acme (EU).");
    expect(call).not.toContain(FIRST_STRONG_ISOLATE);
    expect(call).not.toContain(POP_DIRECTIONAL_ISOLATE);
    // A message to read, by contrast, isolates the value.
    expect(read).toContain(
      `${FIRST_STRONG_ISOLATE}Acme (EU)${POP_DIRECTIONAL_ISOLATE}`,
    );
  });

  test("is made once for each language", () => {
    expect(getCallTranslator("ja")).toBe(getCallTranslator("ja"));
    expect(getCallTranslator("ja")).not.toBe(getServerTranslator("ja"));
  });
});
