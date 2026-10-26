import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement, ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import FieldLabelElement from "../../../../UI/Components/Forms/Fields/FieldLabel";

/*
 * ONE "(OPTIONAL)" PER FIELD, THE SAME ON EVERY FIELD.
 *
 * The maintainer's follow-ups: "Some field titles carry (Optional) themselves
 * and show it twice: DNS Server (Optional) (Optional), Budgets' Service
 * (optional) (Optional)." FieldLabel adds the small grey mark to every field
 * that is not required. A title that says it itself is drawn without those
 * words and with the label's own mark in their place (Forms/Utils/
 * OptionalMark), so it reads like every other optional field on the form:
 * kept in the title's own words, the budgets form read "Service (optional)"
 * beside "Daily Budget (USD) (Optional)", and in French "(facultatif)"
 * beside "(Optionnel)" - two marks for one thing. In every language,
 * whatever word the title's translation uses for it.
 */

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

const LANGUAGES: ReadonlyArray<string> = [
  "de",
  "fr",
  "it",
  "ja",
  "ko",
  "fa",
  "zh-TW",
];
const instances: Record<string, i18n> = {};

function readLocale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

beforeAll(async () => {
  for (const language of LANGUAGES) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: language,
      resources: {
        [language]: {
          translation: readLocale(language),
        },
      },
      interpolation: { escapeValue: false },
    });

    instances[language] = instance;
  }
});

afterEach(() => {
  cleanup();
});

function renderLabel(
  props: {
    title: string;
    required?: boolean;
    hideOptionalLabel?: boolean;
    description?: string;
    descriptionId?: string;
  },
  language?: string,
  id: string = "the-label",
): HTMLElement {
  const Wrapper: (wrapperProps: {
    children?: ReactNode;
  }) => ReactElement = (wrapperProps: {
    children?: ReactNode;
  }): ReactElement => {
    return language ? (
      <I18nextProvider i18n={instances[language]!}>
        {wrapperProps.children}
      </I18nextProvider>
    ) : (
      <>{wrapperProps.children}</>
    );
  };

  render(<FieldLabelElement id={id} {...props} />, {
    wrapper: Wrapper,
  });

  return document.getElementById(id)!;
}

// The grey marks a label draws: the spans in the mark's own style.
function marksOf(label: HTMLElement): Array<string> {
  return Array.from(label.querySelectorAll("span.text-gray-400"))
    .map((element: Element): string => {
      return (element.textContent || "").trim();
    })
    .filter((text: string): boolean => {
      return text.length > 0;
    });
}

const WHITESPACE: RegExp = /\s+/g;
const TWO_MARKS: RegExp = /\(optional\).*\(optional\)/i;

function textOf(label: HTMLElement): string {
  return (label.textContent || "").replace(WHITESPACE, " ").trim();
}

describe("a title that says (Optional) itself, in English", () => {
  test.each([
    ["DNS Server (Optional)", "DNS Server (Optional)"],
    ["Service (optional)", "Service (Optional)"],
    ["Field Path (Optional)", "Field Path (Optional)"],
    ["Target Prefix (optional)", "Target Prefix (Optional)"],
  ])(
    "%p reads %p, its mark drawn once, grey",
    (title: string, read: string) => {
      const label: HTMLElement = renderLabel({ title });

      expect(textOf(label)).toBe(read);
      expect(marksOf(label)).toHaveLength(1);
      expect(textOf(label)).not.toMatch(TWO_MARKS);
    },
  );

  test("its mark is the label's own, worded as every other field's", () => {
    const label: HTMLElement = renderLabel({ title: "Service (optional)" });

    expect(marksOf(label)).toEqual(["(Optional)"]);
    expect(textOf(label)).not.toContain("(optional)");
  });

  test("its title is drawn in the title's weight without the words", () => {
    const label: HTMLElement = renderLabel({ title: "DNS Server (Optional)" });
    const titleSpan: Element = label.firstElementChild!;

    // The title, then the grey mark inside the same span.
    expect(titleSpan.childNodes[0]?.textContent).toBe("DNS Server");
    expect(marksOf(label)).toEqual(["(Optional)"]);
  });

  test("even on a field marked required or told to hide the mark, the mark the title asks for is drawn", () => {
    expect(
      textOf(renderLabel({ title: "DNS Server (Optional)", required: true })),
    ).toBe("DNS Server (Optional)");
    cleanup();
    expect(
      textOf(
        renderLabel({
          title: "Service (optional)",
          hideOptionalLabel: true,
        }),
      ),
    ).toBe("Service (Optional)");
  });
});

describe("every other field keeps the mark it had", () => {
  test("an optional field: its title and one grey (Optional)", () => {
    const label: HTMLElement = renderLabel({ title: "Port" });

    expect(textOf(label)).toBe("Port (Optional)");
    expect(marksOf(label)).toEqual(["(Optional)"]);
  });

  test("a required field: its title alone", () => {
    const label: HTMLElement = renderLabel({ title: "Name", required: true });

    expect(textOf(label)).toBe("Name");
    expect(marksOf(label)).toEqual([]);
  });

  test("a field told to hide the mark: its title alone", () => {
    const label: HTMLElement = renderLabel({
      title: "Labels",
      hideOptionalLabel: true,
    });

    expect(textOf(label)).toBe("Labels");
  });

  test("a title with brackets of its own that are not the mark is left whole", () => {
    const label: HTMLElement = renderLabel({ title: "Timeout (seconds)" });

    expect(textOf(label)).toBe("Timeout (seconds) (Optional)");
    expect(marksOf(label)).toEqual(["(Optional)"]);
  });
});

describe("in the reader's language: the language's own mark, once", () => {
  test.each([
    ["de", "DNS-Server (Optional)"],
    ["fr", "Serveur DNS (Optionnel)"],
    ["ja", "DNS サーバー （任意）"],
    ["ko", "DNS 서버 (선택 사항)"],
  ])("%s: DNS Server reads %p, one mark", (language: string, read: string) => {
    const label: HTMLElement = renderLabel(
      { title: "DNS Server (Optional)" },
      language,
    );

    expect(textOf(label)).toBe(read);
    expect(marksOf(label)).toHaveLength(1);
  });

  test("French: the mark every French field has, not the title's own word", () => {
    const label: HTMLElement = renderLabel(
      { title: "DNS Server (Optional)" },
      "fr",
    );

    expect(marksOf(label)).toEqual(["(Optionnel)"]);
    expect(textOf(label)).not.toContain("(facultatif)");
  });

  test("Persian: the budgets' Service, one mark", () => {
    const label: HTMLElement = renderLabel(
      { title: "Service (optional)" },
      "fa",
    );

    expect(marksOf(label)).toEqual(["(اختیاری)"]);
    expect(textOf(label)).toBe("سرویس (اختیاری)");
  });

  test("an ordinary optional field still gets the language's mark", () => {
    const label: HTMLElement = renderLabel({ title: "Port" }, "fr");

    expect(marksOf(label)).toEqual(["(Optionnel)"]);
  });

  /*
   * The budgets form: titles that carry the mark beside one that does not.
   * Each language's translations word the titles' marks their own way -
   * "(opzionale)" beside "(Facoltativo)", "（選用）" beside "（選填）" - and
   * the form shows one of them on every field.
   */
  test.each(
    LANGUAGES.map((language: string): [string] => {
      return [language];
    }),
  )(
    "%s: every optional field on the budgets form has the same mark",
    (language: string) => {
      const locale: Record<string, string> = readLocale(language);
      const marks: Array<string> = [];

      [
        "Service (optional)",
        "LLM Provider (optional)",
        "LLM Model (optional)",
        "Daily Budget (USD)",
      ].forEach((title: string, index: number) => {
        marks.push(
          ...marksOf(renderLabel({ title }, language, `budget-${index}`)),
        );
      });

      expect(marks).toHaveLength(4);
      expect(new Set(marks)).toEqual(new Set([locale["(Optional)"]]));
    },
  );

  test("a translation that left the mark out still gets the language's mark", async () => {
    const instance: i18n = createInstance();

    await instance.init({
      lng: "xx",
      fallbackLng: "xx",
      resources: {
        xx: {
          translation: {
            "Service (optional)": "Dienst",
            "(Optional)": "(Optional)",
          },
        },
      },
      interpolation: { escapeValue: false },
    });

    render(
      <I18nextProvider i18n={instance}>
        <FieldLabelElement id="left-out" title="Service (optional)" />
      </I18nextProvider>,
    );

    const label: HTMLElement = document.getElementById("left-out")!;

    expect(textOf(label)).toBe("Dienst (Optional)");
    expect(marksOf(label)).toEqual(["(Optional)"]);
  });
});

describe("the description's id", () => {
  test("is the id the field's control is described by", () => {
    renderLabel({
      title: "Promo Code",
      description: "If you have one, from an offer or a reseller.",
      descriptionId: "promo-description",
    });

    expect(document.getElementById("promo-description")).toHaveTextContent(
      "If you have one, from an offer or a reseller.",
    );
  });

  test("is not drawn without a description", () => {
    renderLabel({ title: "Promo Code", descriptionId: "promo-description" });

    expect(document.getElementById("promo-description")).toBeNull();
    expect(screen.getByText("Promo Code")).toBeInTheDocument();
  });
});
