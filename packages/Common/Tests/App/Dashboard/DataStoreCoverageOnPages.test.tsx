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
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import i18next from "i18next";
import React, { ReactElement } from "react";
import { initReactI18next } from "react-i18next";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * WHAT ONEUPTIME CHECKS ON A STORE, SAID WHERE A PERSON LOOKS (#11140).
 *
 * A customer running Elasticsearch, OpenSearch and other stores of their
 * own found the product quiet about what it checks on them: a Connection
 * String shown for every kind and read for three, and an exposure of
 * "Unknown" that read the same before any check as for a kind nothing
 * could check. Each page says it now, from one list:
 *
 *   - adding a store: once a kind is picked, what OneUptime will and will
 *     not check on it, and only the fields that kind reads;
 *   - its Settings: the same list, and what Scan Content does for it;
 *   - its Overview: "Not checked yet" told apart from "Can't be checked"
 *     and from an Unknown read, and where a store you run was asked.
 *
 * The real components are drawn; only the network, the signed-in user's
 * permissions and whether this is OneUptime Cloud are stubbed.
 */

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const checkNowMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
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
        checkNow: (...args: Array<unknown>): unknown => {
          return checkNowMock(...args);
        },
        // Settings' record of processing (#10375): this store is not in it.
        getRecordOfProcessing: async (): Promise<{ rows: Array<never> }> => {
          return { rows: [] };
        },
        // A declared store's record, still being read.
        getDeclaredStore: (): Promise<never> => {
          return new Promise<never>(() => {
            // Never answers: the page waits.
          });
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

/*
 * Whether this is OneUptime Cloud, pinned by the suite rather than read
 * from the environment (CI exports BILLING_ENABLED=true; a bare run leaves
 * it unset). A getter, so each test chooses.
 */
let isOneUptimeCloudForTest: boolean = false;

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;
  const mocked: Record<string, unknown> = { ...actual };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return isOneUptimeCloudForTest;
    },
  });

  return mocked;
});

import StoreCoverageList from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/StoreCoverageList";
import {
  CONNECTION_STRING_EXAMPLES,
  getStoreKindField,
  getStoreScanMethodFields,
  isProbeScannableKind,
  keepScanFieldsTheKindReads,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/StoreScanMethodFields";
import { SELF_MANAGED_STORE_KIND_OPTIONS } from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/StoreFieldOptions";
import { getPostureFactLines } from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/StorePostureChecklist";
import DataStoreOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/DataSecurity/StoreView/Overview";
import DataStoreSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/DataSecurity/StoreView/Settings";
import { DataStoreViewOutletContext } from "../../../../App/FeatureSet/Dashboard/src/Pages/DataSecurity/StoreView/DataStoreViewContext";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import Probe, {
  ProbeConnectionStatus,
} from "../../../Models/DatabaseModels/Probe";
import { DataSecurityCheckStatus } from "../../../Types/DataSecurity/DataSecurityCheckCatalog";
import {
  DataStoreKind,
  DataStoreProvider,
  PROBE_SCANNABLE_DATA_STORE_KINDS,
} from "../../../Types/DataSecurity/DataStoreKind";
import {
  DataStoreExposure,
  DataStorePostureFacts,
  DataStorePostureReadFrom,
} from "../../../Types/DataSecurity/DataStorePosture";
import ObjectID from "../../../Types/ObjectID";
import Field from "../../../UI/Components/Forms/Types/Field";
import Fields from "../../../UI/Components/Forms/Types/Fields";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import { Translator } from "../../../UI/Utils/TranslateTemplate";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import {
  DATA_STORE_COVERAGE_ITEMS,
  DataStoreCoverageItem,
} from "../../../Utils/DataSecurity/DataStoreCoverage";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

const STORE_ID: string = "11140000-0000-4000-8000-000000000001";
const PROJECT_ID: string = "11140000-0000-4000-8000-000000000002";
const PROBE_ID: string = "11140000-0000-4000-8000-000000000003";
const READ_AT: string = "2026-11-20T08:00:00.000Z";

// The words the coverage lines say, as they are written.
const INDICES: string = "Sensitive data in its indices";
const ANSWERS: string =
  "Whether it answers without credentials, and requires TLS";
const INTERNET: string = "Whether the internet reaches it";
const CONFIGURATION: string = "Encryption, backups and access logging";
const FROM_CLOUD_SERVERS: string =
  "OneUptime's servers reach it over the internet when they scan it.";
const NOT_FROM_INSIDE: string =
  "Can't be known from inside your network, where the scan runs.";
const NOT_VISIBLE: string =
  "Not visible from its address, and no cloud OneUptime reads holds them.";

// An English translator, as the form builders take one.
const ENGLISH: Translator = {
  translateText: (text: string): string => {
    return text;
  },
} as unknown as Translator;

let storeColumns: Record<string, unknown> = {};

function storeOf(): DataStore {
  const store: DataStore = new DataStore();
  store._id = STORE_ID;
  Object.assign(store, {
    name: "search-cluster",
    projectId: new ObjectID(PROJECT_ID),
    isArchived: false,
    findingCount: 0,
    openIssueCount: 0,
    riskScore: 0,
    ...storeColumns,
  });

  if (store.scanProbeId) {
    const probe: Probe = new Probe();
    probe._id = PROBE_ID;
    probe.name = "Datacenter probe";
    probe.isGlobalProbe = false;
    probe.projectId = new ObjectID(PROJECT_ID);
    probe.connectionStatus = ProbeConnectionStatus.Connected;
    store.scanProbe = probe;
  }

  return store;
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let index: number = 0; index < 25; index++) {
      await Promise.resolve();
    }
  });
}

function coverageLine(container: HTMLElement, key: string): HTMLElement | null {
  return container.querySelector(`[data-testid="data-store-coverage-${key}"]`);
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: Object.fromEntries(
      ["en", "de", "ar"].map(
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
  isOneUptimeCloudForTest = false;
  storeColumns = {};

  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<unknown> => {
    return storeOf();
  });
  getListMock.mockReset();
  getListMock.mockImplementation(async (): Promise<unknown> => {
    return { data: [], count: 0, skip: 0, limit: 0 };
  });
  checkNowMock.mockReset();
  checkNowMock.mockImplementation(async (): Promise<void> => {
    return undefined;
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

describe("the coverage list: what OneUptime checks on a kind, and what it cannot", () => {
  test("an Elasticsearch cluster OneUptime Cloud's workers scan: its indices, whether it answers without credentials, and that the internet reaches it", () => {
    const { container } = render(
      <StoreCoverageList
        kind={DataStoreKind.Elasticsearch}
        isOneUptimeCloud={true}
      />,
    );

    const lines: Array<HTMLElement> = Array.from(
      container.querySelectorAll("li"),
    );

    expect(
      lines.map((line: HTMLElement): string => {
        return line.getAttribute("data-testid") || "";
      }),
    ).toEqual([
      "data-store-coverage-content",
      "data-store-coverage-credentials",
      "data-store-coverage-internet",
      "data-store-coverage-configuration",
    ]);
    expect(coverageLine(container, "content")).toHaveTextContent(INDICES);
    expect(coverageLine(container, "content")).toHaveAttribute(
      "data-checked",
      "true",
    );
    expect(coverageLine(container, "credentials")).toHaveTextContent(ANSWERS);
    expect(coverageLine(container, "credentials")).toHaveTextContent(
      "Asked with each content scan, from where the scan runs. Nothing is written to it.",
    );
    expect(coverageLine(container, "internet")).toHaveTextContent(
      FROM_CLOUD_SERVERS,
    );
    expect(coverageLine(container, "internet")).toHaveAttribute(
      "data-checked",
      "true",
    );
    // Its encryption at rest and backups are its servers' own: not visible from its address.
    expect(coverageLine(container, "configuration")).toHaveTextContent(
      CONFIGURATION,
    );
    expect(coverageLine(container, "configuration")).toHaveTextContent(
      NOT_VISIBLE,
    );
    expect(coverageLine(container, "configuration")).toHaveAttribute(
      "data-checked",
      "false",
    );
  });

  test.each([
    [
      "scanned from one of your probes, on OneUptime Cloud",
      { isScannedFromProbe: true, isOneUptimeCloud: true },
    ],
    [
      "scanned from the workers of a OneUptime you host",
      { isScannedFromProbe: false, isOneUptimeCloud: false },
    ],
  ])(
    "an OpenSearch cluster %s: whether the internet reaches it can't be known from there",
    (
      _name: string,
      where: { isScannedFromProbe: boolean; isOneUptimeCloud: boolean },
    ) => {
      const { container } = render(
        <StoreCoverageList kind={DataStoreKind.OpenSearch} {...where} />,
      );

      expect(coverageLine(container, "internet")).toHaveTextContent(INTERNET);
      expect(coverageLine(container, "internet")).toHaveTextContent(
        NOT_FROM_INSIDE,
      );
      expect(coverageLine(container, "internet")).toHaveAttribute(
        "data-checked",
        "false",
      );
      // What it answers without credentials is asked from wherever the scan runs.
      expect(coverageLine(container, "credentials")).toHaveAttribute(
        "data-checked",
        "true",
      );
    },
  );

  test("a MongoDB database: nothing samples it or checks its exposure, and adding it still tracks it", () => {
    const { container } = render(
      <StoreCoverageList
        kind={DataStoreKind.MongoDb}
        isOneUptimeCloud={true}
      />,
    );

    expect(coverageLine(container, "content")).toHaveTextContent(
      "OneUptime cannot sample this kind of store's content yet.",
    );
    expect(coverageLine(container, "exposure")).toHaveTextContent(
      "OneUptime has no way to check this kind of store, so its exposure reads Can't be checked.",
    );
    expect(coverageLine(container, "configuration")).toHaveTextContent(
      "OneUptime does not read this kind of store's settings, so they are not checked.",
    );
    expect(coverageLine(container, "tracking")).toHaveTextContent(
      "Its owners, labels and sensitivity",
    );

    for (const key of ["content", "exposure", "configuration"]) {
      expect(coverageLine(container, key)).toHaveAttribute(
        "data-checked",
        "false",
      );
    }

    expect(coverageLine(container, "tracking")).toHaveAttribute(
      "data-checked",
      "true",
    );
    // Nothing that is not checked is drawn as broken: grey, never red.
    expect(container.innerHTML).not.toMatch(/text-red-/);
  });

  test("a PostgreSQL database: its tables are sampled, and nothing reads its exposure", () => {
    const { container } = render(
      <StoreCoverageList
        kind={DataStoreKind.PostgreSql}
        isOneUptimeCloud={true}
      />,
    );

    expect(coverageLine(container, "content")).toHaveTextContent(
      "A few rows of each table, read with a read-only connection string.",
    );
    expect(coverageLine(container, "exposure")).toHaveAttribute(
      "data-checked",
      "false",
    );
    // A kind that is sampled does not need the line that says it is at least tracked.
    expect(coverageLine(container, "tracking")).toBeNull();
  });

  test("an S3 bucket: its files, and its exposure and configuration from its cloud", () => {
    const { container } = render(
      <StoreCoverageList kind={DataStoreKind.AwsS3Bucket} />,
    );

    expect(coverageLine(container, "content")).toHaveTextContent(
      "Sensitive data in its files",
    );
    expect(coverageLine(container, "exposure")).toHaveTextContent(
      "Read from its cloud's own settings, through a cloud connection with Data Security turned on.",
    );
    expect(coverageLine(container, "configuration")).toHaveAttribute(
      "data-checked",
      "true",
    );
    expect(coverageLine(container, "credentials")).toBeNull();
  });

  test("a service's logs: OneUptime holds them, so only your members reach them", () => {
    const { container } = render(
      <StoreCoverageList kind={DataStoreKind.TelemetryLogs} />,
    );

    expect(coverageLine(container, "content")).toHaveTextContent(
      "Sensitive data in what your services send",
    );
    expect(coverageLine(container, "exposure")).toHaveTextContent(
      "OneUptime holds it: only your project's members reach it, through OneUptime.",
    );
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  test("a kind it does not know, or none: nothing is drawn", () => {
    const { container: unknown } = render(
      <StoreCoverageList kind="Not a kind" />,
    );
    const { container: none } = render(<StoreCoverageList kind={undefined} />);

    expect(unknown.querySelector("ul")).toBeNull();
    expect(none.querySelector("ul")).toBeNull();
  });

  test("whether the internet reaches it follows the build when the page does not say: OneUptime Cloud's workers reach it over the internet", () => {
    isOneUptimeCloudForTest = true;

    const { container } = render(
      <StoreCoverageList kind={DataStoreKind.Elasticsearch} />,
    );

    expect(coverageLine(container, "internet")).toHaveTextContent(
      FROM_CLOUD_SERVERS,
    );
  });

  test("in German and Arabic every line is in the reader's language", async () => {
    for (const language of ["de", "ar"]) {
      await act(async () => {
        await i18next.changeLanguage(language);
      });

      const locale: Record<string, string> = readDashboardLocale(language);
      const { container, unmount } = render(
        <StoreCoverageList
          kind={DataStoreKind.Elasticsearch}
          isOneUptimeCloud={true}
        />,
      );
      const text: string = withoutIsolateMarks(container.textContent || "");

      expect(text).toContain(locale[INDICES]);
      expect(text).toContain(locale[ANSWERS]);
      expect(text).toContain(locale[FROM_CLOUD_SERVERS]);
      expect(text).not.toContain(INDICES);
      expect(text).not.toContain(FROM_CLOUD_SERVERS);

      unmount();
    }
  });

  test("every line a coverage list can draw is worded in every language the Dashboard ships", () => {
    for (const language of [
      "de",
      "fr",
      "es",
      "ja",
      "zh-CN",
      "hi",
      "fa",
      "ar",
    ]) {
      const locale: Record<string, string> = readDashboardLocale(language);

      for (const item of DATA_STORE_COVERAGE_ITEMS) {
        for (const words of [item.label, item.detail]) {
          expect([language, words, locale[words] !== words]).toEqual([
            language,
            words,
            true,
          ]);
        }
      }
    }
  });
});

describe("adding a store you run: the Kind, and only the fields that kind reads", () => {
  const kindField: Field<DataStore> = getStoreKindField({
    translator: ENGLISH,
  });

  function footerOf(values: Partial<DataStore>): ReactElement | undefined {
    return kindField.getFooterElement!(values as FormValues<DataStore>);
  }

  test("the Kind names what it is for, and offers Elasticsearch and OpenSearch", () => {
    expect(kindField.description).toBe(
      "What it runs, such as PostgreSQL or Elasticsearch.",
    );
    expect(kindField.placeholder).toBe("Choose what it runs");
    expect(
      SELF_MANAGED_STORE_KIND_OPTIONS.map((option: { value: unknown }) => {
        return option.value;
      }),
    ).toEqual(
      expect.arrayContaining([
        DataStoreKind.Elasticsearch,
        DataStoreKind.OpenSearch,
        DataStoreKind.PostgreSql,
        DataStoreKind.MongoDb,
      ]),
    );
  });

  test("before a kind is picked, nothing is said of what is checked", () => {
    expect(footerOf({})).toBeUndefined();
  });

  test("once a kind is picked, what OneUptime checks on it shows under the Kind", () => {
    isOneUptimeCloudForTest = true;

    render(<>{footerOf({ kind: DataStoreKind.Elasticsearch })}</>);

    const panel: HTMLElement = screen.getByTestId("data-store-kind-coverage");

    expect(panel).toHaveTextContent("What OneUptime checks on it");
    expect(panel).toHaveTextContent(INDICES);
    expect(panel).toHaveTextContent(FROM_CLOUD_SERVERS);
  });

  test("picking a probe says the internet can't be known from there", () => {
    isOneUptimeCloudForTest = true;

    render(
      <>
        {footerOf({
          kind: DataStoreKind.Elasticsearch,
          scanProbe: new Probe(),
        })}
      </>,
    );

    expect(screen.getByTestId("data-store-kind-coverage")).toHaveTextContent(
      NOT_FROM_INSIDE,
    );
  });

  const MORE_FIELDS: { id: string; title: string } = {
    id: "more-fields",
    title: "More fields",
  };

  const scanFields: Fields<DataStore> = getStoreScanMethodFields({
    collapsibleSection: MORE_FIELDS,
    kindOf: (values: FormValues<DataStore>): string | undefined => {
      return values.kind as string | undefined;
    },
    translator: ENGLISH,
  });

  /*
   * Folded with the fields beside them: Add a Store You Run is then three
   * rows - Name, Kind and More fields - as the form steps guard counts it.
   */
  test("every scan field folds into the section it is handed, none of its own", () => {
    expect(scanFields).toHaveLength(3);

    for (const field of scanFields) {
      expect(field.collapsibleSection).toBe(MORE_FIELDS);
    }
  });

  function fieldOf(name: string): Field<DataStore> {
    return scanFields.find((field: Field<DataStore>): boolean => {
      return Object.keys(field.field || {})[0] === name;
    })!;
  }

  function shows(name: string, values: Partial<DataStore>): boolean {
    return fieldOf(name).showIf!(values as FormValues<DataStore>);
  }

  test.each([
    [DataStoreKind.PostgreSql, true, true],
    [DataStoreKind.MySql, true, true],
    [DataStoreKind.SqlServer, true, true],
    [DataStoreKind.Elasticsearch, true, true],
    [DataStoreKind.OpenSearch, true, true],
    // Saved and never read, the Connection String is not shown for these.
    [DataStoreKind.MongoDb, false, false],
    [DataStoreKind.Redis, false, false],
  ])(
    "%s: Scan From Probe shown: %s; Connection String shown: %s",
    (kind: DataStoreKind, probe: boolean, connectionString: boolean) => {
      expect(shows("scanProbe", { kind: kind })).toBe(probe);
      expect(shows("connectionString", { kind: kind })).toBe(connectionString);
      // The probe's variable only once a probe is picked.
      expect(shows("probeConnectionVariable", { kind: kind })).toBe(false);
      expect(
        shows("probeConnectionVariable", {
          kind: kind,
          scanProbe: new Probe(),
        }),
      ).toBe(probe);
    },
  );

  test("a store a probe scans asks no connection string: the probe reads its own", () => {
    expect(
      shows("connectionString", {
        kind: DataStoreKind.Elasticsearch,
        scanProbe: new Probe(),
      }),
    ).toBe(false);
  });

  test("the probe-scannable kinds are the ones a probe's samplers read", () => {
    for (const kind of PROBE_SCANNABLE_DATA_STORE_KINDS) {
      expect(isProbeScannableKind(kind)).toBe(true);
    }

    expect(isProbeScannableKind(DataStoreKind.MongoDb)).toBe(false);
    expect(isProbeScannableKind(DataStoreKind.AwsS3Bucket)).toBe(false);
    expect(isProbeScannableKind(undefined)).toBe(false);
  });

  test.each([
    [
      DataStoreKind.Elasticsearch,
      "The cluster's address, with a read-only user or ?api_key= in it. For example:",
    ],
    [DataStoreKind.OpenSearch, "The cluster's address"],
    [DataStoreKind.PostgreSql, "For example:"],
    [DataStoreKind.MySql, "For example:"],
    [DataStoreKind.SqlServer, "For example:"],
  ])(
    "%s: the example under the Connection String is the kind's own",
    (kind: DataStoreKind, words: string) => {
      render(
        <>
          {fieldOf("connectionString").getFooterElement!({
            kind: kind,
          } as FormValues<DataStore>)}
        </>,
      );

      const example: HTMLElement = screen.getByTestId(
        "connection-string-example",
      );

      expect(example).toHaveTextContent(words);
      expect(example).toHaveTextContent(CONNECTION_STRING_EXAMPLES[kind]!);
      // The address reads left to right on a page read from the right.
      expect(example.querySelector("code")).toHaveAttribute("dir", "ltr");
    },
  );

  test("the search clusters' example is an address with a read-only user, never a database's", () => {
    expect(CONNECTION_STRING_EXAMPLES[DataStoreKind.Elasticsearch]).toMatch(
      /^https:\/\/reader:/,
    );
    expect(CONNECTION_STRING_EXAMPLES[DataStoreKind.OpenSearch]).toMatch(
      /^https:\/\/reader:/,
    );
  });

  test("no example for a kind that takes no connection string", () => {
    expect(
      fieldOf("connectionString").getFooterElement!({
        kind: DataStoreKind.MongoDb,
      } as FormValues<DataStore>),
    ).toBeUndefined();
  });

  function kept(
    values: Record<string, unknown>,
    kind: DataStoreKind,
  ): Array<string> {
    const item: DataStore = new DataStore();
    Object.assign(item, values);

    const saved: Record<string, unknown> = keepScanFieldsTheKindReads(
      item,
      kind,
    ) as unknown as Record<string, unknown>;

    // What the form would save: the scan fields still holding a value.
    return [
      "connectionString",
      "scanProbe",
      "scanProbeId",
      "probeConnectionVariable",
    ]
      .filter((key: string): boolean => {
        return saved[key] !== undefined && saved[key] !== null;
      })
      .sort();
  }

  test("a connection string typed for one kind is not saved with another that never reads it", () => {
    expect(
      kept(
        { connectionString: "mongodb://reader:secret@db:27017" },
        DataStoreKind.MongoDb,
      ),
    ).toEqual([]);
  });

  test("a store a probe scans keeps its probe and variable, and drops a connection string the workers would have used", () => {
    expect(
      kept(
        {
          connectionString: "https://reader:secret@search:9200",
          scanProbe: new ObjectID(PROBE_ID),
          probeConnectionVariable: "SEARCH_URL",
        },
        DataStoreKind.Elasticsearch,
      ),
    ).toEqual(["probeConnectionVariable", "scanProbe"]);
  });

  test("without a probe, a variable left behind is dropped and the connection string kept", () => {
    expect(
      kept(
        {
          connectionString: "https://reader:secret@search:9200",
          probeConnectionVariable: "SEARCH_URL",
        },
        DataStoreKind.OpenSearch,
      ),
    ).toEqual(["connectionString"]);
  });

  test("a probe picked for a kind no probe scans is not saved", () => {
    expect(
      kept(
        {
          scanProbe: new ObjectID(PROBE_ID),
          probeConnectionVariable: "CACHE_URL",
        },
        DataStoreKind.Redis,
      ),
    ).toEqual([]);
  });
});

describe("a store's Settings: What OneUptime Checks, and what Scan Content does", () => {
  async function renderSettings(): Promise<void> {
    const context: DataStoreViewOutletContext = {
      dataStoreId: new ObjectID(STORE_ID),
      dataStore: storeOf(),
      refresh: (): void => {
        // Nothing to read again in a test.
      },
    };

    render(
      <MemoryRouter initialEntries={[`/data-stores/${STORE_ID}/settings`]}>
        <Routes>
          <Route path="/data-stores/:id" element={<Outlet context={context} />}>
            <Route
              path="settings"
              element={
                <DataStoreSettings
                  pageRoute={undefined as never}
                  currentProject={null}
                  hasPaymentMethod={true}
                />
              }
            />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    await flush();
  }

  // What the Scan Content switch says it does, as Edit Content Scans shows it.
  async function scanContentDescription(): Promise<string> {
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Edit Content Scans/ }),
      );
    });
    await flush();

    return screen.getByRole("dialog").textContent || "";
  }

  test("an Elasticsearch cluster: the card lists what is checked on it, and Scan Content says the credentials check stops with the scans", async () => {
    storeColumns = {
      kind: DataStoreKind.Elasticsearch,
      provider: DataStoreProvider.SelfManaged,
      isContentScanEnabled: true,
    };

    await renderSettings();

    expect(screen.getByText("What OneUptime Checks")).toBeInTheDocument();
    expect(
      screen.getByText(
        "On a store of this kind, and what it cannot check, with why.",
      ),
    ).toBeInTheDocument();

    const coverage: HTMLElement = screen.getByTestId("data-store-coverage");

    expect(coverage).toHaveTextContent(INDICES);
    expect(coverage).toHaveTextContent(ANSWERS);
    // A OneUptime you host runs inside a network: the internet can't be known from it.
    expect(coverage).toHaveTextContent(NOT_FROM_INSIDE);
    expect(await scanContentDescription()).toContain(
      "Sample its content for sensitive data. Whether it answers without credentials is asked with each scan, so it stops with them.",
    );
  });

  test("an OpenSearch cluster a probe scans: the card says so of the internet", async () => {
    isOneUptimeCloudForTest = true;
    storeColumns = {
      kind: DataStoreKind.OpenSearch,
      provider: DataStoreProvider.SelfManaged,
      isContentScanEnabled: true,
      scanProbeId: new ObjectID(PROBE_ID),
      probeConnectionVariable: "SEARCH_URL",
    };

    await renderSettings();

    expect(screen.getByTestId("data-store-coverage")).toHaveTextContent(
      NOT_FROM_INSIDE,
    );
  });

  test("an S3 bucket: its configuration is checked either way", async () => {
    storeColumns = {
      kind: DataStoreKind.AwsS3Bucket,
      provider: DataStoreProvider.Aws,
      isContentScanEnabled: true,
    };

    await renderSettings();

    expect(await scanContentDescription()).toContain(
      "Sample this store's content to find sensitive data in it. Its configuration is checked either way.",
    );
  });

  test("a MongoDB database: the card says nothing reads its exposure, and Scan Content claims no configuration check", async () => {
    storeColumns = {
      kind: DataStoreKind.MongoDb,
      provider: DataStoreProvider.SelfManaged,
      isContentScanEnabled: true,
    };

    await renderSettings();

    expect(screen.getByTestId("data-store-coverage")).toHaveTextContent(
      "OneUptime has no way to check this kind of store, so its exposure reads Can't be checked.",
    );
    const said: string = await scanContentDescription();

    expect(said).toContain(
      "Sample this store's content to find sensitive data in it.",
    );
    expect(said).not.toContain("Its configuration is checked");
  });

  test("a declared store has no such card: OneUptime holds it", async () => {
    storeColumns = {
      kind: DataStoreKind.SecurityEvents,
      provider: DataStoreProvider.OneUptime,
    };

    await renderSettings();

    expect(screen.queryByText("What OneUptime Checks")).toBeNull();
  });
});

describe("a store's Overview: what its exposure and configuration say, and where it was asked", () => {
  async function renderOverview(): Promise<void> {
    render(
      <MemoryRouter initialEntries={[`/data-stores/${STORE_ID}`]}>
        <Routes>
          <Route
            path="/data-stores/:id"
            element={
              <DataStoreOverview
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

  function configurationNotRead(): string {
    return screen.getByTestId("data-store-configuration-not-read")
      .textContent as string;
  }

  const ELASTICSEARCH: Record<string, unknown> = {
    kind: DataStoreKind.Elasticsearch,
    provider: DataStoreProvider.SelfManaged,
    isContentScanEnabled: true,
  };

  test("an Elasticsearch cluster not checked yet: Not checked yet, asked with its next content scan", async () => {
    storeColumns = { ...ELASTICSEARCH, exposure: DataStoreExposure.NotChecked };

    await renderOverview();

    expect(screen.getByText("Not checked yet")).toBeInTheDocument();
    expect(
      screen.getByText("Asked with its next content scan"),
    ).toBeInTheDocument();
    expect(configurationNotRead()).toBe(
      "Not checked yet: whether it answers without credentials, and whether it requires TLS, is asked with its first content scan.",
    );
    // Never the cloud's words: it has no cloud connection to read.
    expect(screen.queryByText(/cloud connection/)).toBeNull();
  });

  test("an Elasticsearch cluster whose scans are off: asked with scans that don't run now", async () => {
    storeColumns = {
      ...ELASTICSEARCH,
      isContentScanEnabled: false,
      exposure: DataStoreExposure.NotChecked,
    };

    await renderOverview();

    expect(
      screen.getByText("Asked with its content scans, which don't run now"),
    ).toBeInTheDocument();
    expect(configurationNotRead()).toBe(
      "Not checked: whether it answers without credentials, and whether it requires TLS, is asked with its content scans, and none runs now.",
    );
  });

  test("a MongoDB database: Can't be checked, and why", async () => {
    storeColumns = {
      kind: DataStoreKind.MongoDb,
      provider: DataStoreProvider.SelfManaged,
      exposure: DataStoreExposure.CannotBeChecked,
    };

    await renderOverview();

    expect(screen.getByText("Can't be checked")).toBeInTheDocument();
    expect(
      screen.getByText("OneUptime has no way to check this kind of store"),
    ).toBeInTheDocument();
    expect(configurationNotRead()).toBe(
      "OneUptime has no way to read this kind of store's configuration, so its exposure reads Can't be checked. Its Settings say what is checked.",
    );
  });

  test("an S3 bucket not read yet: read from a cloud connection", async () => {
    storeColumns = {
      kind: DataStoreKind.AwsS3Bucket,
      provider: DataStoreProvider.Aws,
      exposure: DataStoreExposure.NotChecked,
    };

    await renderOverview();

    expect(
      screen.getByText("Read from a cloud connection with Data Security on"),
    ).toBeInTheDocument();
    expect(configurationNotRead()).toBe(
      "OneUptime has not read this store's configuration yet. It is read from a cloud connection with Data Security turned on.",
    );
  });

  test("an OpenSearch cluster a probe asked: credentials asked for, the internet can't be known, and where it was asked", async () => {
    const posture: DataStorePostureFacts = {
      readAt: READ_AT,
      readFrom: DataStorePostureReadFrom.Network,
      anonymousRead: false,
      anonymousWrite: false,
      publicRead: false,
      publicWrite: false,
      publicNetworkAccess: null,
      openToAllAddresses: null,
      encryptionInTransitEnforced: true,
      minimumTlsVersion: null,
      unknowableFacts: [
        "publicNetworkAccess",
        "openToAllAddresses",
        "minimumTlsVersion",
      ],
    };

    storeColumns = {
      kind: DataStoreKind.OpenSearch,
      provider: DataStoreProvider.SelfManaged,
      isContentScanEnabled: true,
      scanProbeId: new ObjectID(PROBE_ID),
      probeConnectionVariable: "SEARCH_URL",
      exposure: DataStoreExposure.Unknown,
      posture: posture,
    };

    await renderOverview();

    expect(
      screen.getByText("Can't be known from inside your network"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("store-posture-anonymousRead")).toHaveTextContent(
      "It asks for credentials before anyone reads it",
    );
    expect(screen.getByTestId("store-posture-anonymousRead")).toHaveTextContent(
      "Pass",
    );
    expect(
      screen.getByTestId("store-posture-anonymousWrite"),
    ).toHaveTextContent("Pass");
    // Not a failed read: from inside a network nothing could tell.
    expect(
      screen.getByTestId("store-posture-publicNetworkAccess"),
    ).toHaveTextContent("Can't be checked");
    expect(
      screen.getByTestId("store-posture-minimumTlsVersion"),
    ).toHaveTextContent("Can't be checked");
    expect(
      withoutIsolateMarks(
        screen.getByTestId("data-store-posture-asked-from").textContent || "",
      ),
    ).toBe(
      "Asked without credentials from Datacenter probe in your network, with its last content scan.",
    );
  });

  test("an Elasticsearch cluster OneUptime Cloud reached that answers anyone: the lines fail, asked over the internet", async () => {
    storeColumns = {
      ...ELASTICSEARCH,
      exposure: DataStoreExposure.InternetReachable,
      posture: {
        readAt: READ_AT,
        readFrom: DataStorePostureReadFrom.Internet,
        anonymousRead: true,
        anonymousWrite: true,
        publicRead: null,
        publicWrite: null,
        publicNetworkAccess: true,
        openToAllAddresses: null,
        encryptionInTransitEnforced: false,
        unknowableFacts: ["publicRead", "publicWrite", "openToAllAddresses"],
      } as DataStorePostureFacts,
    };

    await renderOverview();

    expect(screen.getByTestId("store-posture-anonymousRead")).toHaveTextContent(
      "Fail",
    );
    expect(
      screen.getByTestId("store-posture-anonymousWrite"),
    ).toHaveTextContent("Fail");
    expect(screen.getByTestId("store-posture-publicRead")).toHaveTextContent(
      "Can't be checked",
    );
    expect(
      screen.getByTestId("data-store-posture-asked-from"),
    ).toHaveTextContent(
      "Asked without credentials from OneUptime's servers, over the internet, with its last content scan.",
    );
  });

  test("a cluster a OneUptime you host asked from its own workers: asked from its servers in your network", async () => {
    storeColumns = {
      ...ELASTICSEARCH,
      exposure: DataStoreExposure.Private,
      posture: {
        readAt: READ_AT,
        readFrom: DataStorePostureReadFrom.Network,
        anonymousRead: false,
        anonymousWrite: false,
        publicRead: false,
        publicWrite: false,
        publicNetworkAccess: null,
        unknowableFacts: ["publicNetworkAccess"],
      } as DataStorePostureFacts,
    };

    await renderOverview();

    expect(
      screen.getByTestId("data-store-posture-asked-from"),
    ).toHaveTextContent(
      "Asked without credentials from OneUptime's servers in your network, with its last content scan.",
    );
  });

  test("a cloud's store, its configuration read from the cloud: no line says where it was asked", async () => {
    storeColumns = {
      kind: DataStoreKind.AwsS3Bucket,
      provider: DataStoreProvider.Aws,
      exposure: DataStoreExposure.Private,
      posture: {
        readAt: READ_AT,
        publicRead: false,
        publicWrite: false,
        blockPublicAccess: true,
      } as DataStorePostureFacts,
    };

    await renderOverview();

    expect(screen.getByTestId("store-posture-publicRead")).toHaveTextContent(
      "Pass",
    );
    expect(screen.queryByTestId("data-store-posture-asked-from")).toBeNull();
  });

  test.each([
    [
      "an Elasticsearch cluster",
      ELASTICSEARCH,
      "Its checks run again now. Whether it answers without credentials is asked again with its next content scan: Scan Now runs one.",
    ],
    [
      "a MongoDB database",
      {
        kind: DataStoreKind.MongoDb,
        provider: DataStoreProvider.SelfManaged,
      },
      "Its checks run again on what OneUptime knows of it. Its issues update in a minute or two.",
    ],
    [
      "an S3 bucket",
      { kind: DataStoreKind.AwsS3Bucket, provider: DataStoreProvider.Aws },
      "This store's configuration is being read again and its checks run. Its issues update in a minute or two.",
    ],
  ])(
    "Check Now on %s says what it does for that kind",
    async (_name: string, columns: Record<string, unknown>, said: string) => {
      storeColumns = columns;

      await renderOverview();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /Check Now/ }));
      });
      await flush();

      expect(checkNowMock).toHaveBeenCalledTimes(1);
      expect(screen.getByText(said)).toBeInTheDocument();
    },
  );
});

describe("the checklist's lines for a store you run", () => {
  test("asked without credentials and refused: both lines pass", () => {
    const lines: Array<{ key: string; status: string }> = getPostureFactLines({
      readAt: READ_AT,
      anonymousRead: false,
      anonymousWrite: false,
    });

    expect(lines).toEqual([
      {
        key: "anonymousRead",
        label: "It asks for credentials before anyone reads it",
        status: DataSecurityCheckStatus.Pass,
      },
      {
        key: "anonymousWrite",
        label: "It asks for credentials before anyone changes it",
        status: DataSecurityCheckStatus.Pass,
      },
    ]);
  });

  test("a write it could not try without writing: Can't be checked, never Unknown", () => {
    const lines: Array<{ key: string; status: string }> = getPostureFactLines({
      readAt: READ_AT,
      anonymousRead: true,
      anonymousWrite: null,
      unknowableFacts: ["anonymousWrite"],
    });

    expect(
      lines.map((line: { key: string; status: string }) => {
        return [line.key, line.status];
      }),
    ).toEqual([
      ["anonymousRead", DataSecurityCheckStatus.Fail],
      ["anonymousWrite", "Can't be checked"],
    ]);
  });

  test("an answer it could not read: Unknown", () => {
    expect(
      getPostureFactLines({ readAt: READ_AT, anonymousRead: null })[0]!.status,
    ).toBe(DataSecurityCheckStatus.Unknown);
  });

  test("every coverage line is one of the items the guards hold", () => {
    expect(
      new Set(
        DATA_STORE_COVERAGE_ITEMS.map((item: DataStoreCoverageItem) => {
          return item.key;
        }),
      ),
    ).toEqual(
      new Set([
        "content",
        "exposure",
        "credentials",
        "internet",
        "configuration",
        "tracking",
      ]),
    );
  });
});
