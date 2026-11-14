import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import DataCheckFactsLine, {
  DATA_CHECK_FACT_CLASS_NAME,
  DATA_CHECK_FACTS_LINE_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/DataCheckFactsLine";

/*
 * THE LINE UNDER A DATA CHECK'S NAME WRAPS BETWEEN ITS FACTS.
 *
 * What a check measures, the column it reads, how it is split and where it
 * came from - "Anzahl verwaister Zeilen · customer_account_reference_id ·
 * Aus einer Datei" in German - was one line cut short with an ellipsis: on
 * a phone and at 768px the Checks list lost "Aus einer Datei" (the check is
 * kept in a file), and at 1280px the line held the Name column at its 20rem
 * cap: the table ran 219px past its card, 46px now. Each fact is a box of its own
 * now, its mark after it: the line wraps only between two facts, never
 * inside one and never before a mark, and a fact too long for a line alone
 * ends in "...". The Checks list and Suggested Checks draw it.
 *
 * What a browser makes of the classes was measured in Chromium (the
 * review's screenshots at 390, 768, 1024 and 1280px, in German, Arabic and
 * Persian); here, that each fact is drawn in its box, and that the boxes
 * keep the classes that were measured.
 */

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const language of ["en", "de", "fa"]) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: { [language]: { translation: {} } },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    instances[language] = instance;
  }
});

afterEach(() => {
  cleanup();
});

// The line for `facts` on a page in `language`.
const draw: (language: string, facts: Array<string>) => HTMLElement = (
  language: string,
  facts: Array<string>,
): HTMLElement => {
  const element: ReactElement = (
    <DataCheckFactsLine facts={facts} dataTestId="facts" />
  );

  render(
    <I18nextProvider i18n={instances[language]!}>{element}</I18nextProvider>,
  );

  return screen.getByTestId("facts");
};

// The line's children, by tag: a box per fact, a <wbr> between two.
const tagsOf: (line: HTMLElement) => Array<string> = (
  line: HTMLElement,
): Array<string> => {
  return Array.from(line.children).map((child: Element): string => {
    return child.tagName;
  });
};

// Each fact's box: its text, the mark after the fact included.
const boxesOf: (line: HTMLElement) => Array<HTMLElement> = (
  line: HTMLElement,
): Array<HTMLElement> => {
  return Array.from(line.children).filter((child: Element): boolean => {
    return child.tagName === "SPAN";
  }) as Array<HTMLElement>;
};

const classesOf: (className: string) => Array<string> = (
  className: string,
): Array<string> => {
  return className.split(" ").filter(Boolean);
};

describe("the facts under a data check's name", () => {
  test("each fact is a box of its own with its mark after it, and the line may wrap only between two boxes", () => {
    const line: HTMLElement = draw("de", [
      "Anzahl verwaister Zeilen",
      "customer_account_reference_id",
      "Aus einer Datei",
    ]);

    expect(tagsOf(line)).toEqual(["SPAN", "WBR", "SPAN", "WBR", "SPAN"]);

    const boxes: Array<HTMLElement> = boxesOf(line);

    expect(
      boxes.map((box: HTMLElement): string => {
        return box.textContent || "";
      }),
    ).toEqual([
      "Anzahl verwaister Zeilen · ",
      "customer_account_reference_id · ",
      "Aus einer Datei",
    ]);

    for (const box of boxes) {
      expect(box.className).toBe(DATA_CHECK_FACT_CLASS_NAME);
      // The fact reads its own way, the mark after it the page's.
      expect(box.firstElementChild?.tagName).toBe("BDI");
    }

    expect(
      boxes.map((box: HTMLElement): string => {
        return box.firstElementChild?.textContent || "";
      }),
    ).toEqual([
      "Anzahl verwaister Zeilen",
      "customer_account_reference_id",
      "Aus einer Datei",
    ]);

    // Read or copied, the line says what it always said.
    expect(line.textContent).toBe(
      "Anzahl verwaister Zeilen · customer_account_reference_id · Aus einer Datei",
    );
    expect(line.className).toBe(DATA_CHECK_FACTS_LINE_CLASS_NAME);
  });

  test("on a Persian page, the mark after each fact is the bullet the page sets facts apart with", () => {
    const line: HTMLElement = draw("fa", ["تعداد سطرها", "به ازای tenant_id"]);

    expect(
      boxesOf(line).map((box: HTMLElement): string => {
        return box.textContent || "";
      }),
    ).toEqual(["تعداد سطرها • ", "به ازای tenant_id"]);
  });

  test("a check with one fact draws one box, with no mark and nowhere to wrap", () => {
    const line: HTMLElement = draw("en", ["Row Count"]);

    expect(tagsOf(line)).toEqual(["SPAN"]);
    expect(line.textContent).toBe("Row Count");
  });

  test("the line wraps, where a table's cell keeps its words on one line, and is never cut short", () => {
    const classes: Array<string> = classesOf(DATA_CHECK_FACTS_LINE_CLASS_NAME);

    expect(classes).toEqual(
      expect.arrayContaining(["block", "whitespace-normal"]),
    );
    expect(classes).not.toContain("truncate");
    expect(classes).not.toContain("whitespace-nowrap");
  });

  test("a fact is kept whole on its line, no wider than the line, its spaces as written", () => {
    const classes: Array<string> = classesOf(DATA_CHECK_FACT_CLASS_NAME);

    // A box the line wraps around, cut short with "..." only past the line.
    expect(classes).toEqual(
      expect.arrayContaining([
        "inline-block",
        "max-w-full",
        "overflow-hidden",
        "text-ellipsis",
        "align-top",
      ]),
    );

    /*
     * whitespace-pre, not truncate's whitespace-nowrap: at the end of a
     * box of its own, nowrap drops the space after the mark, and the next
     * fact stood against it ("Zeilen ·customer_id").
     */
    expect(classes).toContain("whitespace-pre");
    expect(classes).not.toContain("truncate");
    expect(classes).not.toContain("whitespace-nowrap");
  });
});
