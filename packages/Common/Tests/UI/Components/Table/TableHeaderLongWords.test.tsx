import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render } from "@testing-library/react";
import React from "react";
import Table from "../../../../UI/Components/Table/Table";
import Columns from "../../../../UI/Components/Table/Types/Columns";
import FieldType from "../../../../UI/Components/Types/FieldType";
import {
  TABLE_HEADER_HYPHENATED_WORD_LENGTH,
  TABLE_HEADER_LONG_WORD_CLASS_NAME,
  TABLE_HEADER_LONG_WORDS,
} from "../../../../UI/Components/Table/TableLayout";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import GenericObject from "../../../../Types/GenericObject";
import IconProp from "../../../../Types/Icon/IconProp";
import { ButtonStyleType } from "../../../../UI/Components/Button/Button";

/*
 * "Alerts in German at 1280px still scroll: folded and given way, the list
 * is about 40px too wide (Warnungsnummer is one word)" - #5485's follow-ups.
 *
 * A header's names break between their words once the table would
 * otherwise run past its card (TableLayout's TABLE_HEADER_WRAP_ATTRIBUTE).
 * A German compound is one word: "Warnungsnummer" (Alert Number) held its
 * column at its whole width over values a third as wide ("ALT-10"), and the
 * state pills beside it were squeezed to "E." to make room. A long word in
 * the reader's language now breaks where that language hyphenates it - the
 * name is drawn in its language (lang) and its long words alone carry
 * hyphens: auto, as a side menu's titles do (HyphenatedWords) - while a
 * name left in English never is.
 *
 * jsdom hyphenates nothing: the markup is asserted here, and the
 * ModelTables offline suite measures the German alerts list in Chromium.
 */

const GERMAN: Record<string, string> = {
  "Alert Number": "Warnungsnummer",
  Title: "Titel",
  "Affected Resources": "Betroffene Ressourcen",
  "Notification Logs": "Benachrichtigungsprotokolle der Regel",
  Actions: "Aktionen",
};

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return GERMAN[key] ?? opts?.defaultValue ?? key;
        },
        i18n: { language: "de", resolvedLanguage: "de" },
      };
    },
  };
});

interface Alert extends GenericObject {
  _id: string;
  number: string;
  title: string;
  resources: string;
  logs: string;
  code: string;
}

const COLUMNS: Columns<Alert> = [
  { key: "number", title: "Alert Number", type: FieldType.Text },
  { key: "title", title: "Title", type: FieldType.Text },
  { key: "resources", title: "Affected Resources", type: FieldType.Text },
  { key: "logs", title: "Notification Logs", type: FieldType.Text },
  // No German for it: drawn as written, in the page's own English.
  { key: "code", title: "Correlation Identifier", type: FieldType.Text },
  { title: "Actions", type: FieldType.Actions },
];

const drawTable: () => void = (): void => {
  render(
    <Table<Alert>
      id="alerts-table"
      data={[
        {
          _id: "10000000-0000-4000-8000-000000000021",
          number: "ALT-10",
          title: "High Node Memory Utilization",
          resources: "oneuptime-test",
          logs: "3",
          code: "c-1",
        },
      ]}
      columns={COLUMNS}
      singularLabel="Alert"
      pluralLabel="Alerts"
      currentPageNumber={1}
      totalItemsCount={1}
      itemsOnPage={10}
      error=""
      isLoading={false}
      onNavigateToPage={(): void => {}}
      sortOrder={SortOrder.Descending}
      sortBy={null}
      onSortChanged={(): void => {}}
      actionButtons={[
        {
          title: "View",
          buttonStyleType: ButtonStyleType.NORMAL,
          icon: IconProp.ChevronRight,
          onClick: () => {},
        },
      ]}
    />,
  );
};

// The element a header cell draws its name in.
const titleOf: (text: string) => HTMLElement = (text: string): HTMLElement => {
  const found: HTMLElement | undefined = Array.from(
    document.querySelectorAll<HTMLElement>("thead th span"),
  ).find((span: HTMLElement): boolean => {
    return (
      span.textContent === text &&
      !span.parentElement?.closest(`span[lang], span.sr-only`)
    );
  });

  if (!found) {
    throw new Error(`No header names ${text}`);
  }

  return found;
};

const longWordSpans: (element: HTMLElement) => Array<string> = (
  element: HTMLElement,
): Array<string> => {
  return Array.from(element.querySelectorAll("span"))
    .filter((span: Element): boolean => {
      return span.className === TABLE_HEADER_LONG_WORD_CLASS_NAME;
    })
    .map((span: Element): string => {
      return span.textContent || "";
    });
};

afterEach(() => {
  cleanup();
});

describe("a header's long words, in the reader's language", () => {
  test("a name of one long German word is drawn in German and may be hyphenated as a whole", () => {
    drawTable();

    const title: HTMLElement = titleOf("Warnungsnummer");

    expect(title).toHaveAttribute("lang", "de");
    expect(title.className).toContain(TABLE_HEADER_LONG_WORD_CLASS_NAME);
  });

  test("a long word beside shorter ones is hyphenated on its own: the short words only ever wrap whole", () => {
    drawTable();

    const title: HTMLElement = titleOf("Benachrichtigungsprotokolle der Regel");

    expect(title).toHaveAttribute("lang", "de");
    expect(title.className).not.toContain(TABLE_HEADER_LONG_WORD_CLASS_NAME);
    expect(longWordSpans(title)).toEqual(["Benachrichtigungsprotokolle"]);
  });

  test("a name of short words is drawn in German and is never hyphenated: 'Betroffene / Ressourcen' wraps between them", () => {
    drawTable();

    const title: HTMLElement = titleOf("Betroffene Ressourcen");

    expect(title).toHaveAttribute("lang", "de");
    expect(title.className).not.toContain("hyphens-auto");
    expect(longWordSpans(title)).toEqual([]);
  });

  test("a name left in English carries no language, and is never hyphenated: English names were written to fit", () => {
    drawTable();

    const title: HTMLElement = titleOf("Correlation Identifier");

    expect(title).not.toHaveAttribute("lang");
    expect(title.className).not.toContain("hyphens-auto");
    expect(longWordSpans(title)).toEqual([]);
  });

  test("the Actions column's name is for a screen reader alone, as before", () => {
    drawTable();

    const actions: HTMLElement | null = document.querySelector(
      "thead th span.sr-only[lang], thead th span.sr-only",
    );

    expect(
      Array.from(document.querySelectorAll("thead th span.sr-only")).map(
        (span: Element): string => {
          return span.textContent || "";
        },
      ),
    ).toContain("Aktionen");
    expect(actions).not.toBeNull();
    expect(document.querySelector("thead th span.sr-only[lang]")).toBeNull();
  });
});

describe("the rule a header's long words are hyphenated by", () => {
  test("a word of 12 letters or more - 'Vorfallnummer' (13), 'Warnungsnummer' (14) - and five letters at least either side of the hyphen, for Chrome and Firefox and for Safari", () => {
    expect(TABLE_HEADER_HYPHENATED_WORD_LENGTH).toBe(12);
    expect(TABLE_HEADER_LONG_WORDS).toEqual({
      minimumWordLength: TABLE_HEADER_HYPHENATED_WORD_LENGTH,
      longWordClassName: TABLE_HEADER_LONG_WORD_CLASS_NAME,
    });
    expect(TABLE_HEADER_LONG_WORD_CLASS_NAME.split(" ")).toEqual([
      "hyphens-auto",
      `[hyphenate-limit-chars:${TABLE_HEADER_HYPHENATED_WORD_LENGTH}_5_5]`,
      "[-webkit-hyphenate-limit-before:5]",
      "[-webkit-hyphenate-limit-after:5]",
    ]);
  });
});
