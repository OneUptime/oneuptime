// UX rule: Docs/ux/README.md#in-every-language
import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * TWO PICKERS PUT AN ENGLISH WORD INSIDE A LABEL THE READER OTHERWISE READS
 * IN THEIR LANGUAGE (#8297).
 *
 * - An archived SLO a dashboard widget or variable still points at was
 *   labelled with its name and an English " (archived)" glued on, and drawn
 *   as written: a Spanish reader saw "Checkout latency (archived)".
 * - An ingestion key with no name that is refused (turned off, expired) was
 *   labelled with a translated sentence holding the English "Unnamed Key",
 *   and the option said it was not the reader's words, so the Dropdown
 *   looked the translated sentence up a second time.
 *
 * Each label is now one sentence in the reader's language, with the name -
 * or the reader's word for "Unnamed Key" - inside it, drawn as given.
 */

const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("44444444-4444-4444-8444-444444444444");
      },
    },
  };
});

import EntityFilterDropdown, {
  ARCHIVED_SLO_LABEL,
  getUnpickableOption,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/EntityFilterDropdown";
import {
  getIngestionKeyOption,
  UNNAMED_KEY,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/IngestionKeySelector";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import { EntityFilterModelType } from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import ObjectID from "../../../Types/ObjectID";
import { Translator } from "../../../Types/Translator";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import {
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

const LANGUAGES: ReadonlyArray<string> = ["en", "es", "de", "ar", "fa"];

const NOW: Date = new Date("2026-11-15T10:00:00.000Z");

const SLO_ID: string = "55555555-5555-4555-8555-555555555555";

const instanceFor: (language: string) => i18n = (language: string): i18n => {
  const instance: i18n = createInstance();

  instance.init({
    lng: language,
    fallbackLng: "en",
    resources: {
      en: { translation: readDashboardLocale("en") },
      [language]: { translation: readDashboardLocale(language) },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
    initImmediate: false,
  });

  return instance;
};

const keyOf: (data: {
  name?: string | undefined;
  isEnabled?: boolean | undefined;
  expiresAt?: Date | undefined;
}) => TelemetryIngestionKey = (data: {
  name?: string | undefined;
  isEnabled?: boolean | undefined;
  expiresAt?: Date | undefined;
}): TelemetryIngestionKey => {
  const key: TelemetryIngestionKey = new TelemetryIngestionKey();
  key.id = new ObjectID("66666666-6666-4666-8666-666666666666");

  if (data.name !== undefined) {
    key.name = data.name;
  }

  if (data.isEnabled !== undefined) {
    key.isEnabled = data.isEnabled;
  }

  if (data.expiresAt) {
    key.expiresAt = data.expiresAt;
  }

  return key;
};

beforeEach(() => {
  getListMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("the words the cases below lean on", () => {
  test.each(["es", "de", "ar", "fa"])(
    "%s words the archived label and an unnamed key its own way",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);

      expect(words[ARCHIVED_SLO_LABEL]).toBeDefined();
      expect(words[ARCHIVED_SLO_LABEL]).not.toBe(ARCHIVED_SLO_LABEL);
      expect(words[UNNAMED_KEY]).not.toBe(UNNAMED_KEY);
    },
  );
});

describe("an archived SLO's option", () => {
  test.each(LANGUAGES)(
    "%s: its name inside a sentence of the reader's language, drawn as given",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);
      const option: DropdownOption = getUnpickableOption(
        { value: SLO_ID, label: "Checkout latency", isUserContent: true },
        ARCHIVED_SLO_LABEL,
        translator,
      );

      expect(option.value).toBe(SLO_ID);
      expect(option.isUserContent).toBe(true);
      expect(withoutIsolateMarks(option.label)).toBe(
        withoutIsolateMarks(
          translator.translateTemplate(ARCHIVED_SLO_LABEL, {
            name: "Checkout latency",
          }),
        ),
      );
      expect(withoutIsolateMarks(option.label)).toContain("Checkout latency");

      if (language === "en") {
        expect(option.label).toBe("Checkout latency (archived)");
      } else {
        expect(option.label).not.toContain("archived");
      }
    },
  );

  test("keeps the option's colour and value", () => {
    const option: DropdownOption = getUnpickableOption(
      { value: SLO_ID, label: "Latency", isUserContent: false },
      ARCHIVED_SLO_LABEL,
      dashboardTranslator("es"),
    );

    expect(option.value).toBe(SLO_ID);
    // The sentence is the reader's already: it is never looked up again.
    expect(option.isUserContent).toBe(true);
  });

  test("Spanish: the picker draws the archived SLO a widget still points at in Spanish", async () => {
    getListMock.mockImplementation((request: unknown) => {
      const query: Record<string, unknown> =
        (request as { query?: Record<string, unknown> }).query || {};

      // A search leaves archived SLOs out; the read by id finds it.
      if (query["isArchived"] === false) {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 50 });
      }

      return Promise.resolve({
        data: [{ _id: SLO_ID, name: "Checkout latency", isArchived: true }],
        count: 1,
        skip: 0,
        limit: 1,
      });
    });

    const element: ReactElement = (
      <I18nextProvider i18n={instanceFor("es")}>
        <EntityFilterDropdown
          entityFilterModelType={EntityFilterModelType.ServiceLevelObjective}
          isMultiSelect={false}
          value={SLO_ID}
          onChange={() => {}}
        />
      </I18nextProvider>
    );

    render(element);

    /*
     * The SLO picker searches the server (#10580), and no search offers an
     * archived SLO: the one the widget holds is read by its id and drawn as
     * the picker's value.
     */
    const value: HTMLElement = await screen.findByTestId(
      "entity-dropdown-value",
    );
    const label: string = withoutIsolateMarks((value.textContent || "").trim());

    expect(label).toBe(
      withoutIsolateMarks(
        dashboardTranslator("es").translateTemplate(ARCHIVED_SLO_LABEL, {
          name: "Checkout latency",
        }),
      ),
    );
    expect(label).not.toContain("archived");
  });
});

describe("an ingestion key's option", () => {
  test.each(LANGUAGES)(
    "%s: an unnamed refused key reads the reader's word for Unnamed Key inside the refusal",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);

      for (const key of [
        keyOf({ isEnabled: false }),
        keyOf({ expiresAt: new Date("2026-01-01T00:00:00.000Z") }),
      ]) {
        const option: DropdownOption = getIngestionKeyOption(
          key,
          NOW,
          translator,
        );

        // The sentence is translated here: drawn as given, never again.
        expect(option.isUserContent).toBe(true);
        expect(withoutIsolateMarks(option.label)).toContain(
          translator.translateText(UNNAMED_KEY) || UNNAMED_KEY,
        );

        if (language !== "en") {
          expect(option.label).not.toContain(UNNAMED_KEY);
        }
      }
    },
  );

  test.each(LANGUAGES)(
    "%s: a named refused key keeps its name as written in the sentence",
    (language: string) => {
      const option: DropdownOption = getIngestionKeyOption(
        keyOf({ name: "prod-collector", isEnabled: false }),
        NOW,
        dashboardTranslator(language),
      );

      expect(option.isUserContent).toBe(true);
      expect(withoutIsolateMarks(option.label)).toContain("prod-collector");
    },
  );

  test("a usable key reads its name as written, and a usable unnamed key the product's word, looked up by the Dropdown", () => {
    expect(
      getIngestionKeyOption(
        keyOf({ name: "prod-collector" }),
        NOW,
        dashboardTranslator("es"),
      ),
    ).toEqual({
      value: "66666666-6666-4666-8666-666666666666",
      label: "prod-collector",
      isUserContent: true,
    });
    expect(
      getIngestionKeyOption(keyOf({}), NOW, dashboardTranslator("es")),
    ).toEqual({
      value: "66666666-6666-4666-8666-666666666666",
      label: UNNAMED_KEY,
      isUserContent: false,
    });
  });

  test("English reads as it did", () => {
    expect(
      getIngestionKeyOption(
        keyOf({ isEnabled: false }),
        NOW,
        dashboardTranslator("en"),
      ).label,
    ).toBe("Unnamed Key (turned off)");
    expect(
      getIngestionKeyOption(
        keyOf({
          name: "prod",
          expiresAt: new Date("2026-01-01T00:00:00.000Z"),
        }),
        NOW,
        dashboardTranslator("en"),
      ).label,
    ).toBe("prod (expired)");
  });
});
