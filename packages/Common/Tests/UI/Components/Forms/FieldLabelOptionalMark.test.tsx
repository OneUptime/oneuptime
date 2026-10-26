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
 * ONE "(OPTIONAL)" PER FIELD.
 *
 * The maintainer's follow-ups: "Some field titles carry (Optional) themselves
 * and show it twice: DNS Server (Optional) (Optional), Budgets' Service
 * (optional) (Optional)." FieldLabel adds the small grey mark to every field
 * that is not required; a title that says it itself now has its own words
 * drawn as that mark, and no second one (Forms/Utils/OptionalMark) - in
 * every language, whatever word the translation uses for it.
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

const LANGUAGES: ReadonlyArray<string> = ["de", "fr", "ja", "ko", "fa"];
const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const language of LANGUAGES) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: language,
      resources: {
        [language]: {
          translation: JSON.parse(
            fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
          ) as Record<string, string>,
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

  render(<FieldLabelElement id="the-label" {...props} />, {
    wrapper: Wrapper,
  });

  return document.getElementById("the-label")!;
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

function textOf(label: HTMLElement): string {
  return (label.textContent || "").replace(/\s+/g, " ").trim();
}

describe("a title that says (Optional) itself, in English", () => {
  test.each([
    ["DNS Server (Optional)", "DNS Server (Optional)"],
    ["Service (optional)", "Service (optional)"],
    ["Field Path (Optional)", "Field Path (Optional)"],
  ])(
    "%p reads %p, its mark drawn once, grey",
    (title: string, read: string) => {
      const label: HTMLElement = renderLabel({ title });

      expect(textOf(label)).toBe(read);
      expect(marksOf(label)).toHaveLength(1);
      expect(textOf(label)).not.toMatch(/\(optional\).*\(optional\)/i);
    },
  );

  test("its mark is the title's own words, as written", () => {
    const label: HTMLElement = renderLabel({ title: "Service (optional)" });

    expect(marksOf(label)).toEqual(["(optional)"]);
  });

  test("even on a field marked required or told to hide the mark, the title is read whole", () => {
    expect(
      textOf(renderLabel({ title: "DNS Server (Optional)", required: true })),
    ).toBe("DNS Server (Optional)");
    cleanup();
    expect(
      textOf(
        renderLabel({
          title: "DNS Server (Optional)",
          hideOptionalLabel: true,
        }),
      ),
    ).toBe("DNS Server (Optional)");
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
});

describe("in the reader's language, with the translation's own word for it", () => {
  test.each([
    ["de", "DNS-Server (Optional)"],
    ["fr", "Serveur DNS (facultatif)"],
    ["ja", "DNS サーバー（任意）"],
    ["ko", "DNS 서버(선택 사항)"],
  ])("%s: DNS Server reads %p, one mark", (language: string, read: string) => {
    const label: HTMLElement = renderLabel(
      { title: "DNS Server (Optional)" },
      language,
    );

    expect(textOf(label)).toBe(read);
    expect(marksOf(label)).toHaveLength(1);
  });

  test("French: the translation's own word, not a second French mark beside it", () => {
    const label: HTMLElement = renderLabel(
      { title: "DNS Server (Optional)" },
      "fr",
    );

    expect(marksOf(label)).toEqual(["(facultatif)"]);
    expect(textOf(label)).not.toContain("(Optionnel)");
  });

  test("Persian: the budgets' Service, one mark", () => {
    const label: HTMLElement = renderLabel(
      { title: "Service (optional)" },
      "fa",
    );

    expect(marksOf(label)).toEqual(["(اختیاری)"]);
  });

  test("an ordinary optional field still gets the language's mark", () => {
    const label: HTMLElement = renderLabel({ title: "Port" }, "fr");

    expect(marksOf(label)).toEqual(["(Optionnel)"]);
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
