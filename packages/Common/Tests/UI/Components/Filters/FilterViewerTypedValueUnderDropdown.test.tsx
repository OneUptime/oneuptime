import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { Mock } from "jest-mock";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";
import EndsWith from "../../../../Types/BaseDatabase/EndsWith";
import EqualTo from "../../../../Types/BaseDatabase/EqualTo";
import Includes from "../../../../Types/BaseDatabase/Includes";
import NotContains from "../../../../Types/BaseDatabase/NotContains";
import NotEqual from "../../../../Types/BaseDatabase/NotEqual";
import NotEqualOrNull from "../../../../Types/BaseDatabase/NotEqualOrNull";
import Search from "../../../../Types/BaseDatabase/Search";
import StartsWith from "../../../../Types/BaseDatabase/StartsWith";
import GenericObject from "../../../../Types/GenericObject";
import { JSONObject } from "../../../../Types/JSON";
import JSONFunctions from "../../../../Types/JSONFunctions";
import FilterViewer from "../../../../UI/Components/Filters/FilterViewer";
import Filter from "../../../../UI/Components/Filters/Types/Filter";
import FilterData from "../../../../UI/Components/Filters/Types/FilterData";
import buildQueryFromFilterData, {
  sanitizeFilterData,
} from "../../../../UI/Components/ModelTable/FilterDataToQuery";
import { withoutIsolateMarks } from "../../../Helpers/IsolateMarks";
import FieldType from "../../../../UI/Components/Types/FieldType";
import {
  readDashboardLocale,
  readDashboardLocaleAsDrawn,
} from "../../../Helpers/DashboardLocales";

/*
 * A VALUE TYPED WHILE A FILTER WAS TEXT, KEPT BY A LINK OR A SAVED VIEW,
 * STILL SAYS WHAT IT NARROWS THE LIST BY (#8321).
 *
 * The audit log's Resource Type was a text filter, and became a dropdown of
 * the stored types (#7580). A saved view or a bookmarked link from before
 * holds what was typed then, a Search ({"_type":"Search","value":"Monitor"}).
 * Restored onto the dropdown, it still narrowed the list (sanitizeFilterData
 * only checks the key: resourceType ILIKE '%Monitor%'), but FilterViewer's
 * dropdown branch read lists and values and nothing else: no chip, and with
 * no other filter set, no Clear Filters either. The list read filtered with
 * nothing saying why, and no way out but editing the address.
 *
 * Such a value is drawn as the text filter drew it, "Resource Type contains
 * Monitor", the value as it was typed, in the reader's language, and Clear
 * Filters clears it. It is shown rather than dropped: a saved view keeps
 * narrowing the list as it was saved, and now says so.
 */

type Row = GenericObject & {
  resourceType?: string;
  monitor?: string;
};

const RESOURCE_TYPE: string = "Resource Type";

const FILTERS: Array<Filter<Row>> = [
  {
    key: "resourceType",
    title: RESOURCE_TYPE,
    type: FieldType.Dropdown,
    filterDropdownOptions: [
      { label: "Monitor", value: "Monitor" },
      { label: "Incident", value: "Incident" },
    ],
  },
  {
    key: "monitor",
    title: "Monitor",
    type: FieldType.Entity,
    filterDropdownOptions: [{ label: "API", value: "monitor-1" }],
  },
] as unknown as Array<Filter<Row>>;

const LANGUAGES: ReadonlyArray<string> = ["en", "de", "ar", "fa"];

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const code of LANGUAGES) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: code,
      fallbackLng: "en",
      resources: {
        [code]: { translation: readDashboardLocaleAsDrawn(code) },
        en: { translation: readDashboardLocale("en") },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    instances[code] = instance;
  }
});

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("dir");
});

function renderViewer(
  code: string,
  filterData: FilterData<Row>,
  onFilterChanged?: (filterData: FilterData<Row>) => void,
): void {
  if (code === "ar" || code === "fa") {
    document.documentElement.setAttribute("dir", "rtl");
  }

  render(
    <I18nextProvider i18n={instances[code] as i18n}>
      <FilterViewer<Row>
        id="audit-logs"
        filters={FILTERS}
        filterData={filterData}
        showFilterModal={false}
        onFilterChanged={onFilterChanged}
      />
    </I18nextProvider>,
  );
}

// The chips over the list, as their text reads.
function chipTexts(): Array<string> {
  return Array.from(
    document.querySelectorAll('[data-testid="applied-filter-chip"]'),
  ).map((chip: Element): string => {
    // A right-to-left sentence sets its values apart with isolate marks.
    return withoutIsolateMarks(chip.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
  });
}

// A chip's sentence as the locale words it, its field and value filled in.
function sentence(
  code: string,
  template: string,
  values: Record<string, string>,
): string {
  const words: Record<string, string> = readDashboardLocaleAsDrawn(code);
  let text: string = words[template] || template;

  for (const name of Object.keys(values)) {
    text = text.split(`{{${name}}}`).join(values[name] as string);
  }

  return text.replace(/\s+/g, " ").trim();
}

function titleIn(code: string, title: string): string {
  return readDashboardLocaleAsDrawn(code)[title] || title;
}

describe("a value typed while the filter was text, under a dropdown", () => {
  test("the saved view's value, restored from its JSON, still narrows the list", () => {
    // What a saved view or a link holds from before the filter was a dropdown.
    const saved: JSONObject = JSONFunctions.deserialize({
      resourceType: { _type: "Search", value: "Monitor" },
    } as unknown as JSONObject);

    expect(saved["resourceType"]).toBeInstanceOf(Search);

    // The list's filters as the table declares them: by field.
    const tableFilters: never = [
      {
        field: { resourceType: true },
        title: RESOURCE_TYPE,
        type: FieldType.Dropdown,
      },
    ] as never;
    const kept: JSONObject = sanitizeFilterData<never>({
      filterData: saved as never,
      filters: tableFilters,
    }) as unknown as JSONObject;

    expect(kept["resourceType"]).toBeInstanceOf(Search);

    // resourceType ILIKE '%Monitor%': the list is narrowed by it.
    const query: JSONObject = buildQueryFromFilterData<never>({
      filterData: kept as never,
      filters: tableFilters,
    }) as unknown as JSONObject;

    expect(query["resourceType"]).toBeInstanceOf(Search);
    expect(String(query["resourceType"])).toBe("Monitor");
  });

  test.each(LANGUAGES)(
    "%s: it draws its chip, as the text filter did, the value as typed",
    (code: string) => {
      renderViewer(code, {
        resourceType: new Search("Monitor"),
      } as FilterData<Row>);

      expect(chipTexts()).toEqual([
        sentence(code, "{{field}} contains {{value}}", {
          field: titleIn(code, RESOURCE_TYPE),
          value: "Monitor",
        }),
      ]);
      // Clear Filters is there to clear it, in the reader's words.
      expect(
        screen.getByRole("button", {
          name: titleIn(code, "Clear Filters"),
        }),
      ).toBeInTheDocument();
    },
  );

  test("in German, word for word", () => {
    renderViewer("de", {
      resourceType: new Search("Monitor"),
    } as FilterData<Row>);

    expect(chipTexts()).toEqual(["Ressourcentyp enthält Monitor"]);
    expect(
      screen.getByRole("button", { name: "Filter löschen" }),
    ).toBeInTheDocument();
  });

  test.each([
    ["contains", new Search("Mon"), "{{field}} contains {{value}}", "Mon"],
    [
      "does not contain",
      new NotContains("Mon"),
      "{{field}} does not contain {{value}}",
      "Mon",
    ],
    [
      "starts with",
      new StartsWith("Mon"),
      "{{field}} starts with {{value}}",
      "Mon",
    ],
    [
      "ends with",
      new EndsWith("itor"),
      "{{field}} ends with {{value}}",
      "itor",
    ],
    ["equals", new EqualTo("Monitor"), "{{field}} equals {{value}}", "Monitor"],
    [
      "does not equal",
      new NotEqual("Monitor"),
      "{{field}} does not equal {{value}}",
      "Monitor",
    ],
    // What "Not equal to" writes since #10581: the empty rows kept.
    [
      "does not equal, the empty kept",
      new NotEqualOrNull("Monitor"),
      "{{field}} does not equal {{value}}",
      "Monitor",
    ],
  ])(
    "%s: the operator the text filter saved is the chip's sentence",
    (_name: string, value: unknown, template: string, typed: string) => {
      renderViewer("en", { resourceType: value } as FilterData<Row>);

      expect(chipTexts()).toEqual([
        sentence("en", template, { field: RESOURCE_TYPE, value: typed }),
      ]);
    },
  );

  test("an entity filter draws a typed value too", () => {
    renderViewer("en", { monitor: new Search("api") } as FilterData<Row>);

    expect(chipTexts()).toEqual(["Monitor contains api"]);
  });

  test("Clear Filters clears it", () => {
    const onFilterChanged: Mock<(filterData: FilterData<Row>) => void> =
      jest.fn<(filterData: FilterData<Row>) => void>();

    renderViewer(
      "en",
      { resourceType: new Search("Monitor") } as FilterData<Row>,
      onFilterChanged,
    );

    fireEvent.click(screen.getByRole("button", { name: "Clear Filters" }));

    expect(onFilterChanged).toHaveBeenCalledWith({});
  });
});

describe("what a dropdown drew before is drawn as before", () => {
  test("a picked value reads as its option, one or several", () => {
    renderViewer("en", {
      resourceType: ["Monitor"],
    } as unknown as FilterData<Row>);
    expect(chipTexts()).toEqual(["Resource Type is Monitor"]);

    cleanup();

    renderViewer("en", {
      resourceType: new Includes(["Monitor", "Incident"]),
    } as FilterData<Row>);
    expect(chipTexts()).toEqual(["Resource Type is any of: Monitor, Incident"]);
  });

  test("an entity's id reads as its option's label", () => {
    renderViewer("en", {
      monitor: ["monitor-1"],
    } as unknown as FilterData<Row>);

    expect(chipTexts()).toEqual(["Monitor is API"]);
  });

  test("no filter, no chips and no Clear Filters", () => {
    renderViewer("en", {} as FilterData<Row>);

    expect(chipTexts()).toEqual([]);
    expect(screen.queryByRole("button", { name: "Clear Filters" })).toBeNull();
  });
});
