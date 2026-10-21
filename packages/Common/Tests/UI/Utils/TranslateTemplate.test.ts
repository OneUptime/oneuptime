import {
  TemplateAround,
  fillTemplate,
  getTemplatePlaceholders,
  translateTemplate,
  translateTemplateAround,
} from "../../../UI/Utils/TranslateTemplate";
import i18next from "i18next";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";

/*
 * A sentence with a name in it is translated as a whole - "Are you sure you
 * want to delete {{name}}?" is the key, and each locale puts {{name}} where
 * its own grammar wants it - and the name itself never passes through the
 * translation. These run the real i18next, first uninitialised (a front end
 * without locales, every other unit test) and then set up with a German
 * resource the way the Dashboard sets it up.
 */

const QUESTION: string = "Are you sure you want to delete {{name}}?";

describe("fillTemplate", () => {
  test("fills each placeholder", () => {
    expect(fillTemplate(QUESTION, { name: "Notify on-call" })).toBe(
      "Are you sure you want to delete Notify on-call?",
    );
  });

  test("fills a placeholder each time it appears, and tolerates spaces", () => {
    expect(
      fillTemplate("{{a}} and {{ a }}, then {{b}}", { a: 1, b: "x" }),
    ).toBe("1 and 1, then x");
  });

  test("leaves a placeholder with no value as it is", () => {
    expect(fillTemplate(QUESTION, {})).toBe(QUESTION);
  });

  test("puts a value in literally, braces and all", () => {
    expect(fillTemplate(QUESTION, { name: "{{name}} $t(x)" })).toBe(
      "Are you sure you want to delete {{name}} $t(x)?",
    );
  });
});

describe("getTemplatePlaceholders", () => {
  test("names each placeholder once, in the order it first appears", () => {
    expect(
      getTemplatePlaceholders(
        "Turn on {{enabled}} and point {{endpoints}} at {{enabled}}'s {{address}}.",
      ),
    ).toEqual(["enabled", "endpoints", "address"]);
  });

  test("reads placeholders the way fillTemplate fills them: spaces and dotted names", () => {
    const template: string = "{{ name }} saw {{service.name}} at {{count}}";

    expect(getTemplatePlaceholders(template)).toEqual([
      "name",
      "service.name",
      "count",
    ]);
    expect(
      fillTemplate(template, { name: "A", "service.name": "api", count: 2 }),
    ).toBe("A saw api at 2");
  });

  test("a template without placeholders has none", () => {
    expect(
      getTemplatePlaceholders("No etcd metrics from this cluster"),
    ).toEqual([]);
    expect(getTemplatePlaceholders("{single} or {{}}")).toEqual([]);
  });
});

describe("before i18next is set up", () => {
  test("translateTemplate fills the English template", () => {
    expect(i18next.isInitialized).toBeFalsy();
    expect(translateTemplate(QUESTION, { name: "Checkout API" })).toBe(
      "Are you sure you want to delete Checkout API?",
    );
  });

  test("translateTemplateAround cuts the English sentence around the slot", () => {
    const around: TemplateAround = translateTemplateAround(QUESTION, "name");

    expect(around).toEqual({
      before: "Are you sure you want to delete ",
      after: "?",
    });
  });

  test("a template without the slot comes back whole, with nothing after it", () => {
    expect(translateTemplateAround("Delete it?", "name")).toEqual({
      before: "Delete it?",
      after: "",
    });
  });
});

describe("with i18next set up", () => {
  beforeAll(async () => {
    await i18next.init({
      lng: "de",
      fallbackLng: "en",
      interpolation: { escapeValue: false },
      resources: {
        de: {
          translation: {
            [QUESTION]: "Möchten Sie {{name}} wirklich löschen?",
            "Lost its slot {{name}}.": "Der Name ist verloren gegangen.",
            "Twice {{name}}.": "{{name}} und noch einmal {{name}}.",
            "and {{remaining}} more": "und {{remaining}} weitere",
          },
        },
      },
    });
  });

  afterAll(async () => {
    await i18next.changeLanguage("en");
  });

  test("uses the translation, with the name where German puts it", () => {
    expect(translateTemplate(QUESTION, { name: "Notify on-call" })).toBe(
      "Möchten Sie Notify on-call wirklich löschen?",
    );
  });

  test("falls back to English for a sentence the locale does not have", () => {
    expect(
      translateTemplate("Type {{name}} to confirm.", { name: "Acme" }),
    ).toBe("Type Acme to confirm.");
  });

  test("fills a count the same way", () => {
    expect(
      translateTemplate("and {{remaining}} more", { remaining: "1,204" }),
    ).toBe("und 1,204 weitere");
  });

  test("does not escape a name: React draws it as text", () => {
    expect(translateTemplate(QUESTION, { name: "<b>Ops</b> & Co" })).toBe(
      "Möchten Sie <b>Ops</b> & Co wirklich löschen?",
    );
  });

  test("cuts the translated sentence around the slot", () => {
    expect(translateTemplateAround(QUESTION, "name")).toEqual({
      before: "Möchten Sie ",
      after: " wirklich löschen?",
    });
  });

  /*
   * A broken translation must not cost the dialog its name: the English
   * sentence, with the name in it, is better than a German one without.
   */
  test("falls back to English when a translation lost the slot", () => {
    expect(translateTemplateAround("Lost its slot {{name}}.", "name")).toEqual({
      before: "Lost its slot ",
      after: ".",
    });
  });

  test("falls back to English when a translation repeats the slot", () => {
    expect(translateTemplateAround("Twice {{name}}.", "name")).toEqual({
      before: "Twice ",
      after: ".",
    });
  });

  test("still fills the other placeholders around the slot", () => {
    expect(
      translateTemplateAround("Remove {{name}} from {{place}}.", "name", {
        place: "this incident",
      }),
    ).toEqual({ before: "Remove ", after: " from this incident." });
  });
});
