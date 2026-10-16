/*
 * The value picker's badge for a value that can be of any type - the
 * "Run Custom JavaScript" step's Value - in each of the Dashboard's
 * seventeen languages.
 *
 * The badge used to say "Any", the key the Dashboard also draws as a monitor
 * criteria's Match Condition (all filters, or any one of them). Korean,
 * French, Dutch and Persian now say "one or more" / "at least one" for that,
 * which would read wrong on a value's type. The badge says "Any type", a key
 * of its own, and each language draws it in its own words.
 *
 * Built from the real step definition, so the badge is what the picker
 * would show; i18next is set up here the way the Dashboard sets it up.
 */

jest.mock("../../../../../Models/DatabaseModels/Index", () => {
  return { __esModule: true, default: [] };
});

import ValuePickerMenu from "../../../../../UI/Components/Workflow/ValuePicker/ValuePickerMenu";
import { buildStepValueGroups } from "../../../../../UI/Components/Workflow/ValuePicker/StepValueSource";
import {
  ValueSuggestion,
  ValueSuggestionGroup,
  typeLabelForInputType,
} from "../../../../../UI/Components/Workflow/ValuePicker/ValueSuggestion";
import { withPicker } from "./ValuePickerTestUtils";
import { SUPPORTED_DASHBOARD_LANGUAGE_CODES } from "../../../../../Types/Dashboard/DashboardLanguage";
import ComponentMetadata, {
  ComponentInputType,
  NodeDataProp,
  NodeType,
} from "../../../../../Types/Workflow/Component";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import Components from "../../../../../Types/Workflow/Components";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import React from "react";
import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../../../App/FeatureSet/Dashboard/src/Locales",
);

const LOCALES: Record<string, Record<string, string>> = {};

for (const code of SUPPORTED_DASHBOARD_LANGUAGE_CODES) {
  LOCALES[code] = JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8"),
  ) as Record<string, string>;
}

// What the Dashboard draws for this English text in this language.
function drawn(code: string, english: string): string {
  const value: string | undefined = LOCALES[code]?.[english];

  return typeof value === "string" && value.trim() ? value : english;
}

const ANY_TYPE: string = "Any type";

const JAVASCRIPT_VALUE: string =
  "{{local.components.javascript-1.returnValues.returnValue}}";

function javascriptStep(): NodeDataProp {
  const metadata: ComponentMetadata = Components.find(
    (component: ComponentMetadata): boolean => {
      return component.id === ComponentID.JavaScriptCode;
    },
  ) as ComponentMetadata;

  return {
    error: "",
    id: "javascript-1",
    nodeType: NodeType.Node,
    metadata: metadata,
    metadataId: metadata.id,
    internalId: "javascript-1-internal",
    arguments: {},
    returnValues: {},
    componentType: metadata.componentType,
  };
}

function javascriptGroups(): Array<ValueSuggestionGroup> {
  return buildStepValueGroups({ upstreamComponents: [javascriptStep()] });
}

// The badge drawn on the step's Value.
function valueBadge(): HTMLElement {
  const option: HTMLElement = screen
    .getAllByRole("option")
    .find((candidate: HTMLElement): boolean => {
      return candidate.getAttribute("data-reference") === JAVASCRIPT_VALUE;
    }) as HTMLElement;

  expect(option).toBeTruthy();

  return option.querySelector('[data-part="kind"]') as HTMLElement;
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> =
    {};

  for (const code of SUPPORTED_DASHBOARD_LANGUAGE_CODES) {
    resources[code] = { translation: LOCALES[code]! };
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: resources,
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterAll(async () => {
  await i18next.changeLanguage("en");
});

afterEach(() => {
  cleanup();
});

describe("a value of any type", () => {
  test("is labelled Any type, not the Match Condition's bare Any", () => {
    expect(typeLabelForInputType(ComponentInputType.AnyValue)).toBe(ANY_TYPE);
    expect(typeLabelForInputType(ComponentInputType.AnyValue)).not.toBe("Any");
  });

  test("is what the JavaScript step's Value is, beside its Error as text", () => {
    const items: Array<ValueSuggestion> = javascriptGroups()[0]!.items;
    const value: ValueSuggestion | undefined = items.find(
      (item: ValueSuggestion): boolean => {
        return item.reference === JAVASCRIPT_VALUE;
      },
    );

    expect(value?.typeLabel).toBe(ANY_TYPE);
    expect(
      items
        .filter((item: ValueSuggestion): boolean => {
          return item.reference !== JAVASCRIPT_VALUE;
        })
        .map((item: ValueSuggestion): string | undefined => {
          return item.typeLabel;
        }),
    ).not.toContain(ANY_TYPE);
  });

  test.each(SUPPORTED_DASHBOARD_LANGUAGE_CODES)(
    "%s draws the badge in its own words, apart from the Match Condition's Any",
    async (code: string) => {
      await i18next.changeLanguage(code);

      render(
        withPicker(<ValuePickerMenu hasSearchBox={false} onPick={() => {}} />, {
          groups: javascriptGroups(),
        }),
      );

      const badge: HTMLElement = valueBadge();

      expect(badge).toHaveTextContent(drawn(code, ANY_TYPE));
      expect(badge.textContent).not.toBe(drawn(code, "Any"));

      if (code !== "en") {
        // Translated: the key the badge uses is the one the locale has.
        expect(within(badge).queryByText(ANY_TYPE)).toBeNull();
      }
    },
  );
});
