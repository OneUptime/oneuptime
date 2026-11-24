import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import i18next from "i18next";
import React from "react";
import { initReactI18next } from "react-i18next";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A DATA STORE'S TEST ENVIRONMENT, AS A NOUN, IN EVERY LANGUAGE (#8342).
 *
 * A store's environment is stored as its English word, and its Overview,
 * its Settings and the Data Stores list drew it by looking that word up.
 * "Test" is the Test buttons' key, which most languages word as the verb:
 * a German store's Test environment read "Testen" beside "Produktion", a
 * Spanish one "Probar" ("to try"). The environments are drawn from titles
 * of their own now (DATA_STORE_ENVIRONMENT_TITLES): the test environment's
 * is "Test (environment)", worded as the noun an environment is named with,
 * which English reads as "Test". The stored value stays "Test".
 *
 * The real Overview and Settings pages are drawn, over a fake ModelAPI, in
 * English, German, Spanish, Arabic and Persian.
 */

const getItemMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      getList: async (): Promise<unknown> => {
        return { data: [], count: 0, skip: 0, limit: 0 };
      },
      count: async (): Promise<number> => {
        return 0;
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/DataSecurityApi",
  () => {
    return {
      __esModule: true,
      default: {
        scanNow: async (): Promise<void> => {
          return undefined;
        },
        checkNow: async (): Promise<void> => {
          return undefined;
        },
        // Settings' record of processing (#10375): this store is not in it.
        getRecordOfProcessing: async (): Promise<{ rows: Array<never> }> => {
          return { rows: [] };
        },
      },
    };
  },
);

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return ["ProjectAdmin"];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

import {
  DATA_SECURITY_CATALOG_TERMS,
  DATA_STORE_ENVIRONMENT_TITLES,
  getDataStoreEnvironmentTitle,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/DataSecurityCatalogTerms";
import { STORE_ENVIRONMENT_OPTIONS } from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/StoreFieldOptions";
import DataStoreOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/DataSecurity/StoreView/Overview";
import DataStoreSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/DataSecurity/StoreView/Settings";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import DataStoreEnvironment, {
  ALL_DATA_STORE_ENVIRONMENTS,
} from "../../../Types/DataSecurity/DataStoreEnvironment";
import {
  DataStoreKind,
  DataStoreProvider,
} from "../../../Types/DataSecurity/DataStoreKind";
import { getWordOfMeaningKey, MEANING_KEYS } from "../../../Types/MeaningKeys";
import ObjectID from "../../../Types/ObjectID";
import { Translator } from "../../../Types/Translator";
import {
  DropdownOption,
  getDropdownOptionText,
} from "../../../UI/Components/Dropdown/Dropdown";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

const STORE_ID: string = "83420000-0000-4000-8000-000000000001";
const PROJECT_ID: string = "83420000-0000-4000-8000-000000000002";
const TEST_ENVIRONMENT: string = "Test (environment)";

// The Test buttons' verb, and the test environment's noun, where a language words them apart.
const VERB_AND_NOUN: Record<string, { verb: string; noun: string }> = {
  de: { verb: "Testen", noun: "Test" },
  es: { verb: "Probar", noun: "Pruebas" },
  fr: { verb: "Tester", noun: "Test" },
  nl: { verb: "Testen", noun: "Test" },
  sv: { verb: "Testa", noun: "Test" },
  pt: { verb: "Testar", noun: "Teste" },
};

let environment: string | undefined = DataStoreEnvironment.Test;

function storeOf(): DataStore {
  const store: DataStore = new DataStore();
  store._id = STORE_ID;
  Object.assign(store, {
    name: "orders-test-db",
    kind: DataStoreKind.PostgreSql,
    provider: DataStoreProvider.SelfManaged,
    projectId: new ObjectID(PROJECT_ID),
    isContentScanEnabled: false,
    isArchived: false,
    findingCount: 0,
    openIssueCount: 0,
    riskScore: 0,
    environment: environment,
  });

  return store;
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: Object.fromEntries(
      ["en", "de", "es", "ar", "fa"].map(
        (
          language: string,
        ): [string, { translation: Record<string, string> }] => {
          return [language, { translation: readDashboardLocale(language) }];
        },
      ),
    ),
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(() => {
  PermissionGate.clearPermissionPropsCache();
  environment = DataStoreEnvironment.Test;
  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<unknown> => {
    return storeOf();
  });
});

afterEach(async () => {
  cleanup();
  jest.restoreAllMocks();
  await i18next.changeLanguage("en");
});

afterAll(async () => {
  await i18next.changeLanguage("en");
});

async function flush(): Promise<void> {
  await act(async () => {
    for (let index: number = 0; index < 25; index++) {
      await Promise.resolve();
    }
  });
}

async function renderPage(
  page: "overview" | "settings",
  language: string,
): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });

  const Page: typeof DataStoreOverview =
    page === "overview" ? DataStoreOverview : DataStoreSettings;

  render(
    <MemoryRouter initialEntries={[`/data-stores/${STORE_ID}`]}>
      <Routes>
        <Route
          path="/data-stores/:id"
          element={
            <Page
              pageRoute={undefined as never}
              currentProject={null}
              hasPaymentMethod={true}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
  await flush();
}

// What the page's Environment field says, by its label in `language`.
async function environmentField(language: string): Promise<string> {
  const label: string = readDashboardLocale(language)["Environment"]!;

  await screen.findAllByTestId("detail-field");

  const fields: Array<HTMLElement> = screen
    .getAllByTestId("detail-field")
    .filter((field: HTMLElement): boolean => {
      return (
        withoutIsolateMarks(
          within(field).queryByTestId("detail-label")?.textContent || "",
        ).trim() === label
      );
    });

  expect({ language, fields: fields.length }).toEqual({ language, fields: 1 });

  return withoutIsolateMarks(
    within(fields[0]!).getByTestId("detail-value").textContent || "",
  ).trim();
}

describe("the environments' titles", () => {
  test("every environment a store serves has one, in the order the form offers them", () => {
    expect(Object.keys(DATA_STORE_ENVIRONMENT_TITLES).sort()).toEqual(
      [...ALL_DATA_STORE_ENVIRONMENTS].sort(),
    );
    expect(
      STORE_ENVIRONMENT_OPTIONS.map((option: DropdownOption): unknown => {
        return option.value;
      }),
    ).toEqual([...ALL_DATA_STORE_ENVIRONMENTS]);
  });

  test("the form's and the list's options are labelled by the titles, never the stored value", () => {
    for (const option of STORE_ENVIRONMENT_OPTIONS) {
      expect({ value: option.value, label: option.label }).toEqual({
        value: option.value,
        label:
          DATA_STORE_ENVIRONMENT_TITLES[option.value as DataStoreEnvironment],
      });
      expect(option.isUserContent).toBeFalsy();
    }

    expect(DATA_STORE_ENVIRONMENT_TITLES[DataStoreEnvironment.Test]).toBe(
      TEST_ENVIRONMENT,
    );
  });

  test("the test environment's title is a key that names its meaning, which English reads as Test", () => {
    expect(MEANING_KEYS).toContain(TEST_ENVIRONMENT);
    expect(getWordOfMeaningKey(TEST_ENVIRONMENT)).toBe("Test");
    // Production, Staging, Development and Unknown mean one thing everywhere.
    for (const environment of [
      DataStoreEnvironment.Production,
      DataStoreEnvironment.Staging,
      DataStoreEnvironment.Development,
      DataStoreEnvironment.Unknown,
    ]) {
      expect(DATA_STORE_ENVIRONMENT_TITLES[environment]).toBe(environment);
    }
  });

  test("every title is registered for translation, and the bare Test is not", () => {
    for (const title of Object.values(DATA_STORE_ENVIRONMENT_TITLES)) {
      expect(DATA_SECURITY_CATALOG_TERMS).toContain(title);
    }

    expect(DATA_SECURITY_CATALOG_TERMS).not.toContain("Test");
  });

  test("each is worded in every language the Dashboard is read in", () => {
    for (const title of Object.values(DATA_STORE_ENVIRONMENT_TITLES)) {
      for (const language of DASHBOARD_LANGUAGES) {
        expect({
          title,
          language,
          worded: isWordedInDashboardLocale(title, language),
        }).toEqual({ title, language, worded: true });
      }
    }
  });

  test.each(Object.keys(VERB_AND_NOUN))(
    "in %s, the test environment is the noun, never the Test buttons' verb",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);

      expect({
        verb: words["Test"],
        noun: words[TEST_ENVIRONMENT],
      }).toEqual(VERB_AND_NOUN[language]);
    },
  );

  test("in no language is the test environment worded as a Test button where the two differ", () => {
    for (const language of Object.keys(VERB_AND_NOUN)) {
      const words: Record<string, string> = readDashboardLocale(language);

      expect(words[TEST_ENVIRONMENT]).not.toBe(words["Test"]);
    }
  });
});

describe("getDataStoreEnvironmentTitle", () => {
  test("in English, reads each environment as it is stored", () => {
    const english: Translator = dashboardTranslator("en");

    for (const environment of ALL_DATA_STORE_ENVIRONMENTS) {
      expect(getDataStoreEnvironmentTitle(english, environment)).toBe(
        environment,
      );
    }
  });

  test.each([
    ["de", "Test", "Produktion"],
    ["es", "Pruebas", "Producción"],
    ["fr", "Test", "Production"],
    ["pt", "Teste", "Produção"],
    ["ar", "الاختبار", "الإنتاج"],
    ["fa", "آزمایش", "تولید"],
  ])(
    "in %s, a test store reads %s beside %s",
    (language: string, test: string, production: string) => {
      const translator: Translator = dashboardTranslator(language);

      expect(
        getDataStoreEnvironmentTitle(translator, DataStoreEnvironment.Test),
      ).toBe(test);
      expect(
        getDataStoreEnvironmentTitle(
          translator,
          DataStoreEnvironment.Production,
        ),
      ).toBe(production);
    },
  );

  test("a value it does not know is drawn as stored, and none as nothing", () => {
    const german: Translator = dashboardTranslator("de");

    expect(getDataStoreEnvironmentTitle(german, "qa-eu-2")).toBe("qa-eu-2");
    // A look-alike of a key is no environment: as stored.
    expect(getDataStoreEnvironmentTitle(german, TEST_ENVIRONMENT)).toBe(
      TEST_ENVIRONMENT,
    );
    expect(getDataStoreEnvironmentTitle(german, "constructor")).toBe(
      "constructor",
    );
    expect(getDataStoreEnvironmentTitle(german, "")).toBe("");
    expect(getDataStoreEnvironmentTitle(german, null)).toBe("");
    expect(getDataStoreEnvironmentTitle(german, undefined)).toBe("");
  });

  test("a dropdown option reads the same as the store's page: German Test, never Testen", () => {
    const german: Translator = dashboardTranslator("de");
    const option: DropdownOption = STORE_ENVIRONMENT_OPTIONS.find(
      (candidate: DropdownOption): boolean => {
        return candidate.value === DataStoreEnvironment.Test;
      },
    )!;

    expect(
      getDropdownOptionText(option, (text: string | undefined) => {
        return german.translateText(text);
      }),
    ).toBe("Test");
    expect(
      getDropdownOptionText(option, (text: string | undefined) => {
        return dashboardTranslator("en").translateText(text);
      }),
    ).toBe("Test");
  });
});

describe("a store's Overview and Settings draw its environment", () => {
  test.each([
    ["en", "Test"],
    ["de", "Test"],
    ["es", "Pruebas"],
    ["ar", "الاختبار"],
    ["fa", "آزمایش"],
  ])(
    "on the %s Overview, a test store's environment reads %s",
    async (language: string, expected: string) => {
      await renderPage("overview", language);

      expect(await environmentField(language)).toBe(expected);
    },
  );

  test.each([
    ["en", "Test"],
    ["de", "Test"],
    ["es", "Pruebas"],
    ["ar", "الاختبار"],
    ["fa", "آزمایش"],
  ])(
    "on the %s Settings page, a test store's environment reads %s",
    async (language: string, expected: string) => {
      await renderPage("settings", language);

      expect(await environmentField(language)).toBe(expected);
    },
  );

  test("the German Overview never reads the Test buttons' verb (the bug)", async () => {
    await renderPage("overview", "de");

    expect(await environmentField("de")).not.toBe("Testen");
    expect(screen.queryByText("Testen")).not.toBeInTheDocument();
  });

  test("the other environments read as before: German Produktion", async () => {
    environment = DataStoreEnvironment.Production;

    await renderPage("overview", "de");

    expect(await environmentField("de")).toBe("Produktion");
  });

  test("a store with no environment shows the quiet dash, not a word", async () => {
    environment = undefined;

    await renderPage("settings", "de");

    expect(await environmentField("de")).not.toMatch(/Test|Unbekannt/);
  });
});
