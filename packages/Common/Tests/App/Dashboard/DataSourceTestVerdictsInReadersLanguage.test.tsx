import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * THE DATA SOURCE TEST'S VERDICT, IN THE READER'S LANGUAGE (#7586).
 *
 * A data source is tested from two places: a row's Test under Dashboards >
 * Settings > Data Sources, and the Test on a data source's own page. Both
 * open the Test Data Source dialog, which says what the server said. When
 * the server's answer carries no message, the verdict is the test's own
 * (TestDataSource): "Connection successful." or "Connection failed." Both
 * were English in 11 of the Dashboard's languages. Drawn here from the real
 * pages and the real locale files, through a real i18next instance, in
 * three of those languages: the dialog says the verdict in the reader's
 * language. The server's own word for a pass is the same sentence, and
 * reads the same.
 *
 * The table and the detail card are captured instead of drawn: their Test
 * buttons are what is pressed. Every language is held at the files by
 * App/Tests/Dashboard/DataSourceTestVerdictsInEveryLanguage.
 */

const mockTables: Array<Record<string, unknown>> = [];
const mockDetails: Array<Record<string, unknown>> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): null => {
      mockTables.push(props);
      return null;
    },
  };
});

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): null => {
      mockDetails.push(props);
      return null;
    },
  };
});

jest.mock("../../../UI/Components/ModelDelete/ModelDelete", () => {
  return {
    __esModule: true,
    default: (): null => {
      return null;
    },
  };
});

import DataSourcesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Dashboards/Settings/DataSources";
import DataSourceViewPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Dashboards/Settings/DataSourceView";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import DataSource from "../../../Models/DatabaseModels/DataSource";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import ActionButtonSchema from "../../../UI/Components/ActionButton/ActionButtonSchema";
import { CardButtonSchema } from "../../../UI/Components/Card/Card";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const DATA_SOURCE_ID: string = "44444444-4444-4444-8444-444444444444";

const PROJECT_HEADERS: Record<string, string> = { tenantid: PROJECT_ID };

// The test's own verdicts, for an answer that says nothing (TestDataSource).
const PASSED: string = "Connection successful.";
const FAILED: string = "Connection failed.";

// Three of the languages that read both in English before #7586.
const LANGUAGES: Array<string> = ["it", "ru", "zh-CN"];

type Place = "a row's Test" | "a data source's own page";

const PLACES: Array<Place> = ["a row's Test", "a data source's own page"];

let fetchMock: MockFunction;

// An i18next instance like the Dashboard's: one language, English as the fallback.
function instanceFor(code: string): i18n {
  const instance: i18n = createInstance();

  instance.init({
    lng: code,
    fallbackLng: "en",
    resources: {
      en: { translation: readDashboardLocale("en") },
      [code]: { translation: readDashboardLocale(code) },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
    initImmediate: false,
  });

  return instance;
}

// The server's answer: whether the connection worked, and its own words if any.
function answer(ok: boolean, message?: string): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(
    200,
    message === undefined ? { ok } : { ok, message },
    {},
  );
}

function rowTest(): ActionButtonSchema<DataSource> {
  // The table as the page last drew it.
  const table: Record<string, unknown> | undefined = [...mockTables]
    .reverse()
    .find((props: Record<string, unknown>) => {
      return props["id"] === "data-sources-table";
    });

  const button: ActionButtonSchema<DataSource> | undefined = (
    (table?.["actionButtons"] || []) as Array<ActionButtonSchema<DataSource>>
  ).find((action: ActionButtonSchema<DataSource>) => {
    return action.title === "Test";
  });

  if (!button) {
    throw new Error("The data sources table has no Test action.");
  }

  return button;
}

function cardTest(): CardButtonSchema {
  const detail: Record<string, unknown> | undefined =
    mockDetails[mockDetails.length - 1];

  const button: CardButtonSchema | undefined = (
    ((detail?.["cardProps"] as JSONObject | undefined)?.["buttons"] ||
      []) as unknown as Array<CardButtonSchema>
  ).find((each: CardButtonSchema) => {
    return each.title === "Test";
  });

  if (!button) {
    throw new Error("The data source's card has no Test button.");
  }

  return button;
}

// Tests the data source from `place`, read in `code`, until the dialog has its answer.
async function testFrom(place: Place, code: string): Promise<void> {
  const props: PageComponentProps = {} as unknown as PageComponentProps;

  render(
    <I18nextProvider i18n={instanceFor(code)}>
      {place === "a row's Test" ? (
        <DataSourcesPage {...props} />
      ) : (
        <DataSourceViewPage {...props} />
      )}
    </I18nextProvider>,
  );

  await act(async () => {
    if (place === "a row's Test") {
      rowTest().onClick(
        new DataSource(new ObjectID(DATA_SOURCE_ID)),
        () => {},
        () => {},
      );
    } else {
      cardTest().onClick();
    }
  });

  // The dialog is done testing once its Close can be pressed.
  await waitFor(() => {
    expect(screen.getByTestId("modal-footer-submit-button")).toBeEnabled();
  });

  expect(fetchMock).toHaveBeenCalledTimes(1);
}

// What the dialog says for a pass: its description.
function passShown(): string {
  return withoutIsolateMarks(
    screen.getByTestId("confirm-modal-description").textContent || "",
  );
}

// What it says for a failure: its error, above the description.
function failureShown(): string {
  return withoutIsolateMarks(
    screen.getByTestId("modal-error").textContent || "",
  );
}

beforeEach(() => {
  mockTables.length = 0;
  mockDetails.length = 0;

  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockReturnValue(new ObjectID(DATA_SOURCE_ID));
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue(PROJECT_HEADERS);

  fetchMock = getJestMockFunction();
  jest
    .spyOn(API, "fetch")
    .mockImplementation(fetchMock as unknown as typeof API.fetch);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe.each(PLACES)("testing a data source from %s", (place: Place) => {
  test("English reads the test's own verdict for a pass as it is written", async () => {
    fetchMock.mockResolvedValue(answer(true) as never);
    await testFrom(place, "en");

    expect(passShown()).toBe(PASSED);
  });

  test("English reads the test's own verdict for a failure as it is written", async () => {
    fetchMock.mockResolvedValue(answer(false) as never);
    await testFrom(place, "en");

    expect(failureShown()).toBe(FAILED);
  });

  test.each(LANGUAGES)(
    "%s: a pass the server says nothing about reads the verdict in the language",
    async (code: string) => {
      fetchMock.mockResolvedValue(answer(true) as never);
      await testFrom(place, code);

      const worded: string | undefined = readDashboardLocale(code)[PASSED];

      expect({ code, worded: worded !== PASSED, shown: passShown() }).toEqual({
        code,
        worded: true,
        shown: worded,
      });
    },
  );

  test.each(LANGUAGES)(
    "%s: a failure the server says nothing about reads the verdict in the language",
    async (code: string) => {
      fetchMock.mockResolvedValue(answer(false) as never);
      await testFrom(place, code);

      const worded: string | undefined = readDashboardLocale(code)[FAILED];

      expect({
        code,
        worded: worded !== FAILED,
        shown: failureShown(),
      }).toEqual({ code, worded: true, shown: worded });
    },
  );
});

describe("the server's own word for a pass", () => {
  test("is the same sentence, and reads in the language too", async () => {
    fetchMock.mockResolvedValue(answer(true, PASSED) as never);
    await testFrom("a data source's own page", "it");

    expect(passShown()).toBe(readDashboardLocale("it")[PASSED]);
    expect(passShown()).not.toBe(PASSED);
  });
});
