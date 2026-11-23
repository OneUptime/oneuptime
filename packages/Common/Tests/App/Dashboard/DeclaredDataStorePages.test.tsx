import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import { act, cleanup, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * THE PAGES OF A STORE ONEUPTIME DECLARES, AND THE RECORD THAT LISTS IT
 * (#10398).
 *
 * Security Events, Network Flows and Security Address Vault are never
 * scanned or checked, so their pages say what OneUptime declares of them:
 * what each holds, why, for how long and who can read it - OneUptime's
 * purpose and retention, saying so, until the team writes its own - and
 * keep only the pages that mean something for them. The record of
 * processing on Compliance lists them beside the stores Data Security
 * found, marked Declared by OneUptime.
 *
 * Only the network and the signed-in user's permissions are stubbed.
 */

const getItemMock: MockFunction = getJestMockFunction();

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
        i18n: { language: "en" },
      };
    },
  };
});

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

import DataSecurityApi from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/DataSecurityApi";
import DeclaredStoreOverview from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/DeclaredStoreOverview";
import RecordOfProcessingCard from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/RecordOfProcessingCard";
import DataStoreSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/DataSecurity/StoreView/Settings";
import DataStoreViewSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/DataSecurity/StoreView/SideMenu";
import { DataStoreViewOutletContext } from "../../../../App/FeatureSet/Dashboard/src/Pages/DataSecurity/StoreView/DataStoreViewContext";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import ComplianceFramework from "../../../Types/DataSecurity/ComplianceFramework";
import DataCategory from "../../../Types/DataSecurity/DataCategory";
import {
  DataSecurityDeclaredStore,
  DataSecurityDeclaredStoreResponse,
  DataSecurityRecordOfProcessingRow,
} from "../../../Types/DataSecurity/DataSecurityApiTypes";
import DataSensitivity from "../../../Types/DataSecurity/DataSensitivity";
import {
  DataStoreKind,
  DataStoreProvider,
} from "../../../Types/DataSecurity/DataStoreKind";
import {
  DeclaredStoreReaders,
  DeclaredStoreRetentionBasis,
} from "../../../Types/DataSecurity/DeclaredDataStore";
import ObjectID from "../../../Types/ObjectID";
import Permission, { PermissionHelper } from "../../../Types/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import { PROJECT_ID, goTo, renderMenu, titlesInMenu } from "./SideMenuHarness";

const STORE_ID: string = "9b9b9b9b-0000-4000-8000-000000010398";

const SECURITY_READERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.SecurityViewer,
  Permission.ReadSecurityEvent,
];

function declaredOf(
  overrides: Partial<DataSecurityDeclaredStore> = {},
): DataSecurityDeclaredStore {
  return {
    kind: DataStoreKind.SecurityEvents,
    purpose: "Network and information security (GDPR Recital 49)",
    retentionInDays: 15,
    retentionBasis: DeclaredStoreRetentionBasis.SecurityEvents,
    retentionText: "15 days",
    isPurposeTheTeams: false,
    isRetentionTheTeams: false,
    readers: DeclaredStoreReaders.Roles,
    readPermissions: [...SECURITY_READERS],
    readerNames: PermissionHelper.getPermissionTitles(SECURITY_READERS),
    dataTypeNames: ["IP address", "Username", "Email address"],
    fields: ["principalIp", "targetIp"],
    ...overrides,
  };
}

const VAULT: DataSecurityDeclaredStore = declaredOf({
  kind: DataStoreKind.SecurityAddressVault,
  retentionInDays: 30,
  retentionBasis: DeclaredStoreRetentionBasis.AddressVault,
  retentionText: "30 days after an address was last seen",
  readers: DeclaredStoreReaders.SecurityEventsScansOnly,
  readPermissions: [],
  readerNames: [],
  dataTypeNames: ["IP address"],
});

let storeColumns: Record<string, unknown> = {};

function storeOf(): DataStore {
  const store: DataStore = new DataStore();
  store._id = STORE_ID;
  store.kind = DataStoreKind.SecurityEvents;
  store.name = "Security Events";
  store.provider = DataStoreProvider.OneUptime;
  Object.assign(store, storeColumns);
  return store;
}

// A page of a store, drawn inside its layout's context, as the store view draws it.
async function renderInStore(element: ReactElement): Promise<void> {
  const context: DataStoreViewOutletContext = {
    dataStoreId: new ObjectID(STORE_ID),
    dataStore: storeOf(),
    refresh: (): void => {
      // Nothing to read again here.
    },
  };

  await act(async () => {
    render(
      <MemoryRouter initialEntries={[`/data-stores/${STORE_ID}/page`]}>
        <Routes>
          <Route path="/data-stores/:id" element={<Outlet context={context} />}>
            <Route path="page" element={element} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
  });

  await flush();
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let index: number = 0; index < 20; index++) {
      await Promise.resolve();
    }
  });
}

function answerOf(
  declared: DataSecurityDeclaredStore,
  columns: { purpose?: string; retention?: string } = {},
): DataSecurityDeclaredStoreResponse {
  return {
    declared,
    purpose: columns.purpose || declared.purpose,
    retention: columns.retention || declared.retentionText,
  };
}

beforeEach(() => {
  PermissionGate.clearPermissionPropsCache();
  storeColumns = {};
  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<unknown> => {
    return storeOf();
  });
  goTo(`/dashboard/${PROJECT_ID}/data-security/stores/${STORE_ID}`);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a declared store's Settings", () => {
  test("keep its name and its record only: nothing to classify or scan", async () => {
    jest
      .spyOn(DataSecurityApi, "getDeclaredStore")
      .mockResolvedValue(answerOf(declaredOf()));

    await renderInStore(
      <DataStoreSettings
        pageRoute={undefined as never}
        currentProject={null}
        hasPaymentMethod={true}
      />,
    );

    expect(screen.getByText("Data Store Details")).toBeInTheDocument();
    expect(screen.getByText("Record of Processing")).toBeInTheDocument();
    expect(screen.queryByText("Classification")).not.toBeInTheDocument();
    expect(screen.queryByText("Content Scans")).not.toBeInTheDocument();
  });

  test("say OneUptime's purpose and the retention it reads now, each saying where it comes from", async () => {
    const asked: SpyInstance<typeof DataSecurityApi.getDeclaredStore> = jest
      .spyOn(DataSecurityApi, "getDeclaredStore")
      .mockResolvedValue(answerOf(declaredOf()));

    await renderInStore(
      <DataStoreSettings
        pageRoute={undefined as never}
        currentProject={null}
        hasPaymentMethod={true}
      />,
    );

    expect(asked).toHaveBeenCalledTimes(1);
    expect(asked.mock.calls[0]![0].toString()).toBe(STORE_ID);
    expect(
      screen.getByText("Network and information security (GDPR Recital 49)"),
    ).toBeInTheDocument();
    // Its purpose, and its legal basis (#10375): legitimate interests until the team picks one.
    expect(screen.getAllByText("Filled in by OneUptime")).toHaveLength(2);
    expect(screen.getByText("Legitimate interests")).toBeInTheDocument();
    expect(screen.getByText("15 days")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Follows Telemetry Data Retention in your project's Settings.",
      ),
    ).toBeInTheDocument();
  });

  test("say the team's own purpose and retention as written, and that they are the team's", async () => {
    storeColumns = {
      purpose: "Detecting and blocking attacks on our shop",
      retention: "A year",
    };
    jest.spyOn(DataSecurityApi, "getDeclaredStore").mockResolvedValue(
      answerOf(
        declaredOf({ isPurposeTheTeams: true, isRetentionTheTeams: true }),
        {
          purpose: "Detecting and blocking attacks on our shop",
          retention: "A year",
        },
      ),
    );

    await renderInStore(
      <DataStoreSettings
        pageRoute={undefined as never}
        currentProject={null}
        hasPaymentMethod={true}
      />,
    );

    expect(
      screen.getByText("Detecting and blocking attacks on our shop"),
    ).toBeInTheDocument();
    expect(screen.getByText("A year")).toBeInTheDocument();
    expect(screen.getAllByText("Written by your team")).toHaveLength(2);
    expect(
      screen.queryByText("Network and information security (GDPR Recital 49)"),
    ).not.toBeInTheDocument();
  });

  test("a store Data Security found keeps every card", async () => {
    storeColumns = {
      kind: DataStoreKind.AwsS3Bucket,
      provider: DataStoreProvider.Aws,
      name: "customer-exports",
    };
    const asked: SpyInstance<typeof DataSecurityApi.getDeclaredStore> =
      jest.spyOn(DataSecurityApi, "getDeclaredStore");

    // It holds no personal data: its record card is the plain one (#10375).
    jest
      .spyOn(DataSecurityApi, "getRecordOfProcessing")
      .mockResolvedValue({ rows: [] });

    await renderInStore(
      <DataStoreSettings
        pageRoute={undefined as never}
        currentProject={null}
        hasPaymentMethod={true}
      />,
    );

    expect(screen.getByText("Classification")).toBeInTheDocument();
    expect(screen.getByText("Content Scans")).toBeInTheDocument();
    expect(screen.getByText("Record of Processing")).toBeInTheDocument();
    expect(asked).not.toHaveBeenCalled();
  });
});

describe("a declared store's Overview", () => {
  test("says what it holds, why, for how long and who can read it", async () => {
    jest
      .spyOn(DataSecurityApi, "getDeclaredStore")
      .mockResolvedValue(answerOf(declaredOf()));

    await act(async () => {
      render(
        <MemoryRouter>
          <DeclaredStoreOverview
            dataStoreId={new ObjectID(STORE_ID)}
            kind={DataStoreKind.SecurityEvents}
          />
        </MemoryRouter>,
      );
    });
    await flush();

    expect(screen.getByText("Declared by OneUptime")).toBeInTheDocument();
    expect(screen.getByTestId("declared-store-holds")).toHaveTextContent(
      "IP address",
    );
    expect(screen.getByTestId("declared-store-holds")).toHaveTextContent(
      "Username",
    );
    expect(screen.getByTestId("declared-store-purpose")).toHaveTextContent(
      "Network and information security (GDPR Recital 49)",
    );
    expect(screen.getByTestId("declared-store-retention")).toHaveTextContent(
      "15 days",
    );

    for (const title of PermissionHelper.getPermissionTitles(
      SECURITY_READERS,
    )) {
      expect(screen.getByTestId("declared-store-readers")).toHaveTextContent(
        title,
      );
    }

    // Its record is written in Settings.
    expect(screen.getByText("Edit in Settings")).toBeInTheDocument();
  });

  test("the vault is read by nobody but Security Events' scans", async () => {
    jest
      .spyOn(DataSecurityApi, "getDeclaredStore")
      .mockResolvedValue(answerOf(VAULT));

    await act(async () => {
      render(
        <MemoryRouter>
          <DeclaredStoreOverview
            dataStoreId={new ObjectID(STORE_ID)}
            kind={DataStoreKind.SecurityAddressVault}
          />
        </MemoryRouter>,
      );
    });
    await flush();

    expect(screen.getByTestId("declared-store-readers")).toHaveTextContent(
      "Only Security Events' scans, inside OneUptime. No person, page, export, API or AI tool can read it.",
    );
    expect(screen.getByTestId("declared-store-retention")).toHaveTextContent(
      "30 days after an address was last seen",
    );
  });
});

describe("a declared store's side menu", () => {
  test("has only the pages that say something about it", async () => {
    await renderMenu(
      <DataStoreViewSideMenu
        modelId={new ObjectID(STORE_ID)}
        kind={DataStoreKind.SecurityEvents}
      />,
    );

    const titles: Array<string> = titlesInMenu();

    expect(titles).toEqual([
      "Overview",
      "Timeline",
      "Owners",
      "Settings",
      "Audit Logs",
    ]);
  });

  test("a store Data Security found keeps every page", async () => {
    await renderMenu(
      <DataStoreViewSideMenu
        modelId={new ObjectID(STORE_ID)}
        kind={DataStoreKind.AwsS3Bucket}
      />,
    );

    expect(titlesInMenu()).toEqual(
      expect.arrayContaining([
        "What's Inside",
        "Who Can Reach It",
        "Issues",
        "Scans",
        "Delete Data Store",
      ]),
    );
  });
});

describe("the record of processing on Compliance", () => {
  function rowOf(
    overrides: Partial<DataSecurityRecordOfProcessingRow>,
  ): DataSecurityRecordOfProcessingRow {
    return {
      dataStoreId: ObjectID.generate().toString(),
      name: "crm-exports",
      kind: DataStoreKind.AwsS3Bucket,
      provider: "aws",
      region: "eu-west-1",
      environment: "Production",
      sensitivity: DataSensitivity.Confidential,
      dataCategories: [DataCategory.ContactAndIdentity],
      dataTypeNames: ["Email address"],
      owners: [],
      purpose: "Customer support exports",
      retention: "90 days",
      frameworks: [ComplianceFramework.GDPR],
      ...overrides,
    };
  }

  test("lists the stores OneUptime declares beside the ones found, marked, with who can read each", async () => {
    jest.spyOn(DataSecurityApi, "getRecordOfProcessing").mockResolvedValue({
      rows: [
        rowOf({
          name: "Security Events",
          kind: DataStoreKind.SecurityEvents,
          provider: "oneuptime",
          purpose: "Network and information security (GDPR Recital 49)",
          retention: "15 days",
          declared: declaredOf(),
        }),
        rowOf({}),
        rowOf({
          name: "Security Address Vault",
          kind: DataStoreKind.SecurityAddressVault,
          provider: "oneuptime",
          purpose: "Network and information security (GDPR Recital 49)",
          retention: "30 days after an address was last seen",
          declared: VAULT,
        }),
      ],
    });

    await act(async () => {
      render(
        <MemoryRouter>
          <RecordOfProcessingCard />
        </MemoryRouter>,
      );
    });
    await flush();

    const card: HTMLElement = screen.getByTestId(
      "data-security-record-of-processing-card",
    );

    expect(screen.getByText("Record of Processing")).toBeInTheDocument();
    // Both declared stores are marked; the found one is not.
    expect(screen.getAllByText("Declared by OneUptime")).toHaveLength(2);
    expect(card).toHaveTextContent("crm-exports");
    expect(card).toHaveTextContent("Customer support exports");
    expect(card).toHaveTextContent("15 days");
    expect(card).toHaveTextContent("30 days after an address was last seen");
    expect(card).toHaveTextContent("Security Viewer");
    expect(card).toHaveTextContent(
      "Only Security Events' scans, inside OneUptime.",
    );
    // A found store's access is its own page's.
    expect(screen.getByText("Who Can Reach It")).toBeInTheDocument();
    // The CSV in sight; the JSON in the header's menu.
    expect(screen.getByText("Export CSV")).toBeInTheDocument();
  });

  test("a project with no personal data says so, with nothing to export", async () => {
    jest
      .spyOn(DataSecurityApi, "getRecordOfProcessing")
      .mockResolvedValue({ rows: [] });

    await act(async () => {
      render(
        <MemoryRouter>
          <RecordOfProcessingCard />
        </MemoryRouter>,
      );
    });
    await flush();

    expect(
      screen.getByText("No personal data recorded yet"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Export CSV")).not.toBeInTheDocument();
  });
});
