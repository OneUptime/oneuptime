import "@testing-library/jest-dom";
import React, { ReactElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import Pagination from "../../../UI/Components/Pagination/Pagination";
import BulkUpdateForm from "../../../UI/Components/BulkUpdate/BulkUpdateForm";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import Pill from "../../../UI/Components/Pill/Pill";
import StatusBadge from "../../../UI/Components/StatusBadge/StatusBadge";
import MoreMenuItem from "../../../UI/Components/MoreMenu/MoreMenuItem";
import TranslatedSentence from "../../../UI/Components/TranslatedSentence/TranslatedSentence";
import { getEmptyTableMessage } from "../../../UI/Components/Table/EmptyTableMessage";
import {
  createTranslator,
  translatableTerm,
} from "../../../UI/Utils/TranslateTemplate";
import { Green } from "../../../Types/BrandColors";

/*
 * The shared components put their text props and their own sentences on the
 * screen in the reader's language: whole sentences with the values in them,
 * the model's name translated with the sentence, the count picking the
 * language's plural form. A locale that lacks a sentence shows it wholly in
 * English, and so does a front end with no i18next at all.
 *
 * The test locale is German, keyed by the English text exactly as
 * App/FeatureSet/Dashboard/src/Locales/de.json is. Each instance reaches the
 * components through I18nextProvider only, so nothing leaks into the
 * global instance other suites in this worker use.
 */

const GERMAN: Record<string, string> = {
  // Pagination
  "Showing {{range}} of {{total}} {{itemsName}}":
    "{{range}} von {{total}} {{itemsName}}",
  "Showing {{range}} of {{total}} {{itemsName}}_one":
    "{{range}} von {{total}} {{itemName}}",
  "No {{itemsName}}": "Keine {{itemsName}}",
  "Page {{page}}": "Seite {{page}}",
  "Go to page {{page}}": "Zu Seite {{page}}",
  "Pagination for {{itemsName}}": "Seitennavigation für {{itemsName}}",
  "Rows per page": "Zeilen pro Seite",
  Monitors: "Monitore",
  // Bulk actions
  "{{count}} {{itemsName}} Selected": "{{count}} {{itemsName}} ausgewählt",
  "{{count}} {{itemsName}} Selected_one": "{{count}} {{itemName}} ausgewählt",
  "Select All {{itemsName}}": "Alle {{itemsName}} auswählen",
  "Clear Selection": "Auswahl aufheben",
  Archive: "Archivieren",
  // Text props
  Operational: "Betriebsbereit",
  Active: "Aktiv",
  Duplicate: "Duplizieren",
  // Sentences with elements in them
  "{{field}} contains {{value}}": "{{field}} enthält {{value}}",
  "{{field}} is {{value}}": "{{field}} ist",
  // An empty table
  "No {{itemsName}} yet.": "Noch keine {{itemsName}}.",
};

// German that has the nouns but none of the sentences.
const GERMAN_WORDS_ONLY: Record<string, string> = {
  Monitors: "Monitore",
  Monitor: "Monitor",
};

const german: i18n = createInstance();
const germanWordsOnly: i18n = createInstance();

beforeAll(async () => {
  for (const [instance, translations] of [
    [german, GERMAN],
    [germanWordsOnly, GERMAN_WORDS_ONLY],
  ] as Array<[i18n, Record<string, string>]>) {
    await instance.init({
      lng: "de",
      resources: { de: { translation: translations } },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
  }
});

afterEach(() => {
  cleanup();
});

const inLocale: (instance: i18n, element: ReactElement) => void = (
  instance: i18n,
  element: ReactElement,
): void => {
  render(<I18nextProvider i18n={instance}>{element}</I18nextProvider>);
};

const pagination: (totalItemsCount: number) => ReactElement = (
  totalItemsCount: number,
): ReactElement => {
  return (
    <Pagination
      currentPageNumber={1}
      totalItemsCount={totalItemsCount}
      itemsOnPage={10}
      onNavigateToPage={() => {}}
      isLoading={false}
      isError={false}
      singularLabel="Monitor"
      pluralLabel="Monitors"
      dataTestId="pagination"
    />
  );
};

describe("Pagination", () => {
  test("says how many there are in one German sentence, the name in German", () => {
    inLocale(german, pagination(1234));

    expect(screen.getByTestId("pagination-summary")).toHaveTextContent(
      "1-10 von 1.234 Monitore",
    );
  });

  test("uses the German one form for one item, with the name German shares with English", () => {
    inLocale(german, pagination(1));

    expect(screen.getByTestId("pagination-summary")).toHaveTextContent(
      "1 von 1 Monitor",
    );
  });

  test("an empty list", () => {
    inLocale(german, pagination(0));

    expect(screen.getByTestId("pagination-summary")).toHaveTextContent(
      "Keine Monitore",
    );
  });

  test("its labels for screen readers and its controls", () => {
    inLocale(german, pagination(30));

    expect(screen.getByTestId("pagination")).toHaveAttribute(
      "aria-label",
      "Seitennavigation für Monitore",
    );
    expect(screen.getByTestId("pagination-page-1")).toHaveAttribute(
      "aria-label",
      "Seite 1",
    );
    expect(screen.getByTestId("pagination-page-2")).toHaveAttribute(
      "aria-label",
      "Zu Seite 2",
    );
    expect(screen.getByText("Zeilen pro Seite")).toBeInTheDocument();
  });

  test("a locale without the sentence reads it wholly in English", () => {
    inLocale(germanWordsOnly, pagination(240));

    expect(screen.getByTestId("pagination-summary")).toHaveTextContent(
      "Showing 1-10 of 240 monitors",
    );
  });

  test("a front end with no i18next reads English", () => {
    render(pagination(1));

    expect(screen.getByTestId("pagination-summary")).toHaveTextContent(
      "Showing 1 of 1 monitor",
    );
  });
});

interface Row {
  _id: string;
}

const bulkForm: (selected: number) => ReactElement = (
  selected: number,
): ReactElement => {
  return (
    <BulkUpdateForm<Row>
      selectedItems={Array.from(
        { length: selected },
        (_x: unknown, i: number) => {
          return { _id: `row-${i}` };
        },
      )}
      isAllItemsSelected={false}
      onSelectAllClick={() => {}}
      onClearSelectionClick={() => {}}
      singularLabel="Monitor"
      pluralLabel="Monitors"
      buttons={[
        {
          title: "Archive",
          buttonStyleType: ButtonStyleType.NORMAL,
          onClick: (): Promise<void> => {
            return Promise.resolve();
          },
        },
      ]}
    />
  );
};

describe("BulkUpdateForm", () => {
  test("counts the selection in German, in its plural and its one form", () => {
    inLocale(german, bulkForm(3));

    expect(screen.getByText("3 Monitore ausgewählt")).toBeInTheDocument();
    expect(screen.getByText("Alle Monitore auswählen")).toBeInTheDocument();
    expect(screen.getByText("Auswahl aufheben")).toBeInTheDocument();

    cleanup();
    inLocale(german, bulkForm(1));

    expect(screen.getByText("1 Monitor ausgewählt")).toBeInTheDocument();
  });

  test("reads English with no i18next", () => {
    render(bulkForm(1));

    expect(screen.getByText("1 Monitor Selected")).toBeInTheDocument();
    expect(screen.getByText("Select All Monitors")).toBeInTheDocument();
  });
});

describe("text props", () => {
  test("a Pill, a StatusBadge and a menu item translate their text", () => {
    inLocale(
      german,
      <>
        <Pill text="Operational" color={Green} />
        <StatusBadge text="Active" />
        <MoreMenuItem text="Duplicate" onClick={() => {}} />
      </>,
    );

    expect(screen.getByTestId("pill")).toHaveTextContent("Betriebsbereit");
    expect(screen.getByText("Aktiv")).toBeInTheDocument();
    expect(screen.getByText("Duplizieren")).toBeInTheDocument();
  });

  test("text the locale does not have, and a name typed by a user, stay as they are", () => {
    inLocale(
      german,
      <>
        <Pill text="payments-api" color={Green} />
        <StatusBadge text="Degraded" />
      </>,
    );

    expect(screen.getByTestId("pill")).toHaveTextContent("payments-api");
    expect(screen.getByText("Degraded")).toBeInTheDocument();
  });
});

describe("TranslatedSentence", () => {
  test("lets the locale place the elements, and draws them as given", () => {
    inLocale(
      german,
      <p data-testid="sentence">
        <TranslatedSentence
          template="{{field}} contains {{value}}"
          slots={{
            field: <strong>Name</strong>,
            value: <strong>api</strong>,
          }}
        />
      </p>,
    );

    expect(screen.getByTestId("sentence")).toHaveTextContent(
      "Name enthält api",
    );
    expect(screen.getByText("api").tagName).toBe("STRONG");
  });

  test("a translation that lost an element falls back to the English sentence", () => {
    inLocale(
      german,
      <p data-testid="sentence">
        <TranslatedSentence
          template="{{field}} is {{value}}"
          slots={{
            field: <strong>Status</strong>,
            value: <strong>Offline</strong>,
          }}
        />
      </p>,
    );

    expect(screen.getByTestId("sentence")).toHaveTextContent(
      "Status is Offline",
    );
  });

  test("fills the other values, with a count picking the form", () => {
    render(
      <p data-testid="sentence">
        <TranslatedSentence
          template={{
            one: "{{count}} {{itemName}} matches {{query}}",
            other: "{{count}} {{itemsName}} match {{query}}",
          }}
          count={2}
          slots={{ query: <code>api</code> }}
          values={{
            itemName: translatableTerm("Monitor", { inSentence: true }),
            itemsName: translatableTerm("Monitors", { inSentence: true }),
          }}
        />
      </p>,
    );

    expect(screen.getByTestId("sentence")).toHaveTextContent(
      "2 monitors match api",
    );
  });
});

describe("the empty-table sentence", () => {
  const lookup: (text: string) => string = (text: string): string => {
    return GERMAN[text] ?? text;
  };

  test("is the German template with the German name in it", () => {
    expect(
      getEmptyTableMessage({
        pluralLabel: "Monitors",
        isFiltered: false,
        translate: lookup,
        translator: createTranslator(lookup, "de"),
      }),
    ).toBe("Noch keine Monitore.");
  });

  test("keeps the capital of a German noun spelled as in English", () => {
    expect(
      getEmptyTableMessage({
        pluralLabel: "Labels",
        isFiltered: false,
        translate: lookup,
        translator: createTranslator(lookup, "de"),
      }),
    ).toBe("Noch keine Labels.");
  });

  test("is English where nothing is translated", () => {
    const english: (text: string) => string = (text: string): string => {
      return text;
    };

    expect(
      getEmptyTableMessage({
        pluralLabel: "API Keys",
        isFiltered: false,
        translate: english,
        translator: createTranslator(english, "en"),
      }),
    ).toBe("No API keys yet.");
  });
});
