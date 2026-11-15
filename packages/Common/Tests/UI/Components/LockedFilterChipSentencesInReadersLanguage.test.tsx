// UX rule: Docs/ux/README.md#in-every-language
import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";
import { buildAttributeFilterChips } from "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsAttributeFilterChips";
import AttributeFilterSentences from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorSteps/AttributeFilterSentences";
import Includes from "../../../Types/BaseDatabase/Includes";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import Search from "../../../Types/BaseDatabase/Search";
import Wildcard from "../../../Types/BaseDatabase/Wildcard";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import { getListSeparator } from "../../../Types/Translator";
import { DictionaryEntryValue } from "../../../UI/Components/Dictionary/DictionaryFilterOperator";
import { formatDictionaryFilterSentence } from "../../../UI/Components/Dictionary/DictionaryFilterSentence";
import ActiveFilterChips from "../../../UI/Components/LogsViewer/components/ActiveFilterChips";
import { ActiveFilter } from "../../../UI/Components/LogsViewer/types";
import {
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * A LOG MONITOR'S CRITERIA CHIPS AND A MONITOR'S DETAILS SAY AN ATTRIBUTE
 * FILTER IN THE READER'S LANGUAGE (#8309).
 *
 * The log monitor's criteria preview pins its attribute filters as locked
 * chips (buildAttributeFilterChips, ActiveFilterChips, LockedFilterChip),
 * and a monitor's detail page lists them under its criteria. Both drew the
 * value through formatDictionaryValueForDisplay, which glues the
 * operator's English label before it: a German chip read "http.route:
 * matches /api/*" under a form that said "stimmt überein", and a Persian
 * page set English words in a right-to-left line.
 *
 * Each now says a filter that holds an operator as one sentence, the one
 * the filter bar says (DictionaryFilterSentence), its key and value as
 * written: "http.route stimmt mit /api/* überein". A bare value (=) keeps
 * its "key: value" chip, and a page's own name for a value is drawn as
 * the page names it. Rendered through i18next with the Dashboard's own
 * locale files, in English, German, Persian and Arabic.
 */

const RENDERED: ReadonlyArray<string> = ["en", "de", "fa", "ar"];

// The operators' English labels, which no translated line may say.
const ENGLISH_OPERATOR: RegExp =
  /(^|\s)(matches|contains|is any of|is none of|is empty|is not empty)(\s|:|$)/;

const languages: Record<string, i18n> = {};

beforeAll(async () => {
  for (const code of RENDERED) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: code,
      fallbackLng: "en",
      resources: { [code]: { translation: readDashboardLocale(code) } },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    languages[code] = instance;
  }
});

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("dir");
});

function withLanguage(code: string, element: React.ReactElement): void {
  if (code === "fa" || code === "ar") {
    document.documentElement.setAttribute("dir", "rtl");
  }

  render(
    <I18nextProvider i18n={languages[code] as i18n}>{element}</I18nextProvider>,
  );
}

function renderChips(code: string, filters: Array<ActiveFilter>): void {
  withLanguage(
    code,
    <ActiveFilterChips
      filters={filters}
      onRemove={() => {}}
      onClearAll={() => {}}
    />,
  );
}

// The sentence the language says for a filter, as the page says it.
function sentence(code: string, attributeKey: string, value: unknown): string {
  return withoutIsolateMarks(
    formatDictionaryFilterSentence({
      attributeKey,
      value,
      translator: dashboardTranslator(code),
    }),
  );
}

function chipTexts(): Array<string> {
  return screen
    .getAllByTestId("locked-filter-chip")
    .map((chip: HTMLElement): string => {
      return withoutIsolateMarks(chip.textContent || "");
    });
}

const PINNED: Dictionary<DictionaryEntryValue> = {
  "http.route": new Wildcard(["/api/*"]),
  tier: new Includes(["web", "api"]),
  "trace.id": new IsNull(),
  logtype: new Search<string>("web"),
};

describe("the log monitor's criteria chips", () => {
  test("a filter that holds an operator hands the chip its stored value; a bare value and a page's own name do not", () => {
    const chips: Array<ActiveFilter> = buildAttributeFilterChips(
      {
        ...PINNED,
        "service.name": "checkout",
        "resource.host.name": new Includes(["host-1"]),
      },
      { displayValues: { "resource.host.name": "web-01" } },
    );
    const byKey: Record<string, ActiveFilter> = Object.fromEntries(
      chips.map((chip: ActiveFilter): [string, ActiveFilter] => {
        return [chip.facetKey, chip];
      }),
    );

    expect(byKey["attributes.http.route"]!.filterValue).toBe(
      PINNED["http.route"],
    );
    expect(byKey["attributes.trace.id"]!.filterValue).toBe(PINNED["trace.id"]);
    // A bare value (=) keeps its "key: value" chip.
    expect(byKey["attributes.service.name"]!.filterValue).toBeUndefined();
    // The page names the value itself: drawn as it names it.
    expect(byKey["attributes.resource.host.name"]!.filterValue).toBeUndefined();
    expect(byKey["attributes.resource.host.name"]!.displayValue).toBe("web-01");
  });

  test("in English each reads as the filter bar says it", () => {
    renderChips("en", buildAttributeFilterChips(PINNED));

    expect(chipTexts()).toEqual([
      "http.route matches /api/*",
      "tier is any of: web, api",
      "trace.id is empty",
      "logtype contains web",
    ]);
  });

  test.each(["de", "fa", "ar"])(
    "in %s each says the language's sentence, never the English operator",
    (code: string) => {
      renderChips(code, buildAttributeFilterChips(PINNED));

      const texts: Array<string> = chipTexts();

      expect(texts).toEqual([
        sentence(code, "http.route", PINNED["http.route"]),
        sentence(code, "tier", PINNED["tier"]),
        sentence(code, "trace.id", PINNED["trace.id"]),
        sentence(code, "logtype", PINNED["logtype"]),
      ]);

      for (const text of texts) {
        expect(text).not.toMatch(ENGLISH_OPERATOR);
      }

      // The values are the language's own list, as written.
      expect(texts[1]).toContain(`web${getListSeparator(code)}api`);
    },
  );

  test("German says the verb its picker says, in German order", () => {
    renderChips(
      "de",
      buildAttributeFilterChips({ "http.route": PINNED["http.route"]! }),
    );

    expect(chipTexts()).toEqual(["http.route stimmt mit /api/* überein"]);
  });

  test("a friendly key a page gives is said in the language too", () => {
    const words: Record<string, string> = readDashboardLocale("de");

    renderChips(
      "de",
      buildAttributeFilterChips({ "resource.host.name": new NotNull() }),
    );

    // "Host" is the chip's own label for the key, looked up once.
    expect(chipTexts()).toEqual([
      sentence("de", words["Host"] || "Host", new NotNull()),
    ]);
  });

  test.each(["en", "de", "fa", "ar"])(
    "in %s a bare value keeps its key: value chip",
    (code: string) => {
      renderChips(code, buildAttributeFilterChips({ "service.name": "web" }));

      expect(chipTexts()).toEqual(["service.name:web"]);
      expect(screen.queryByTestId("locked-filter-chip-sentence")).toBeNull();
    },
  );

  test.each(["de", "fa", "ar"])(
    "in %s the chip's title and accessible name say the sentence in the language",
    (code: string) => {
      const words: Record<string, string> = readDashboardLocale(code);
      const said: string = sentence(code, "logtype", PINNED["logtype"]);

      // Without search syntax: a plain pill whose title says it.
      renderChips(
        code,
        buildAttributeFilterChips({ logtype: PINNED["logtype"]! }),
      );

      expect(
        withoutIsolateMarks(
          screen.getByTestId("locked-filter-chip").getAttribute("title") || "",
        ),
      ).toBe(words["{{filter}} (applied filter)"]!.replace("{{filter}}", said));

      cleanup();

      // With search syntax: a button whose name says it, and the copy hint.
      renderChips(code, [
        {
          ...buildAttributeFilterChips({ logtype: PINNED["logtype"]! })[0]!,
          lockedDetail: { searchToken: "@logtype:*web*" },
        },
      ]);

      const button: HTMLElement = screen.getByRole("button");

      expect(withoutIsolateMarks(button.getAttribute("aria-label") || "")).toBe(
        words[
          "{{filter}}, locked filter. Press Enter to copy its search syntax."
        ]!.replace("{{filter}}", said),
      );
      expect(button.getAttribute("aria-label")).not.toMatch(ENGLISH_OPERATOR);
    },
  );

  test("a removable chip whose value is an operator's says it too, with its remove button", () => {
    const words: Record<string, string> = readDashboardLocale("de");
    const said: string = sentence("de", "logtype", PINNED["logtype"]);

    renderChips("de", [
      {
        facetKey: "attributes.logtype",
        value: PINNED["logtype"] as unknown as string,
        displayKey: "logtype",
        displayValue: PINNED["logtype"] as unknown as string,
      },
    ]);

    const remove: HTMLElement = document.querySelector("[title]")!;

    expect(withoutIsolateMarks(remove.getAttribute("title") || "")).toBe(
      words["Remove {{filter}}"]!.replace("{{filter}}", said),
    );
    expect(document.body.textContent).not.toMatch(ENGLISH_OPERATOR);
  });

  test("the chip's sentence keys are worded in every language the test reads (control)", () => {
    for (const code of ["de", "fa", "ar"]) {
      const words: Record<string, string> = readDashboardLocale(code);

      for (const key of [
        "{{filter}} (applied filter)",
        "{{filter}}, locked filter",
        "{{filter}}, locked filter. Press Enter to copy its search syntax.",
      ]) {
        expect(words[key]).toBeDefined();
        expect(words[key]).not.toBe(key);
      }
    }
  });
});

describe("a monitor's detail page", () => {
  const STORED: JSONObject = {
    "http.route": new Wildcard(["/api/*"]).toJSON(),
    tier: new Includes(["web", "api"]).toJSON(),
    "trace.id": new IsNull().toJSON(),
    "service.name": "checkout",
  } as unknown as JSONObject;

  function filterTexts(): Array<string> {
    return screen
      .getAllByTestId("monitor-step-attribute-filter")
      .map((line: HTMLElement): string => {
        return withoutIsolateMarks(line.textContent || "");
      });
  }

  test("in English each filter is one line, as the filter bar says it", () => {
    withLanguage("en", <AttributeFilterSentences filters={STORED} />);

    expect(filterTexts()).toEqual([
      "http.route matches /api/*",
      "tier is any of: web, api",
      "trace.id is empty",
      "service.name = checkout",
    ]);
  });

  test.each(["de", "fa", "ar"])(
    "in %s each line is the language's sentence, from the step as stored",
    (code: string) => {
      withLanguage(code, <AttributeFilterSentences filters={STORED} />);

      const texts: Array<string> = filterTexts();

      expect(texts).toEqual(
        Object.keys(STORED).map((key: string): string => {
          return sentence(code, key, STORED[key]);
        }),
      );

      for (const text of texts) {
        expect(text).not.toMatch(ENGLISH_OPERATOR);
      }
    },
  );

  test.each(["fa", "ar"])(
    "in %s the key and value read as typed, each set apart",
    (code: string) => {
      withLanguage(
        code,
        <AttributeFilterSentences
          filters={{ "http.route": STORED["http.route"]! } as JSONObject}
        />,
      );

      const line: HTMLElement = screen.getByTestId(
        "monitor-step-attribute-filter",
      );

      expect(
        Array.from(line.querySelectorAll<HTMLElement>("bdi")).map(
          (isolate: HTMLElement): string => {
            return isolate.textContent || "";
          },
        ),
      ).toEqual(["http.route", "/api/*"]);
      expect(line.textContent).toMatch(/[؀-ۿ]/u);
    },
  );
});
