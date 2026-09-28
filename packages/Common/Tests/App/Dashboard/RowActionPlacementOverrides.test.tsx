import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * THE TABLES THAT HAD TO SAY WHICH ACTION IS THE ROW'S BUTTON.
 *
 * Every row now shows one action as a button and folds the rest into a ⋯ menu
 * (SplitActionButtons). The split reads the choice off each action's style, and
 * on most tables that is the right choice. On these it is not, so the page
 * marks the action itself:
 *
 *   - the notification method tables (Email, SMS, Call, WhatsApp, Telegram and
 *     incoming call numbers) mark Verify Primary. Left to the style, the
 *     NORMAL-styled Resend Code / Rotate Code would take the button and an
 *     unverified row - which is waiting on exactly one thing, the code - would
 *     hide Verify in the menu;
 *   - a project's custom probes mark Show ID and Key MoreMenu. It is NORMAL
 *     styled, so whenever View is not on offer it would take the button;
 *   - discovery scans mark Review Results Primary. Edit sits ahead of it and is
 *     just as NORMAL, so without the mark a scan with hosts waiting to be
 *     imported would offer Edit.
 *
 * So these render the real tables through the real ModelTable, with only the
 * network stubbed, and assert on what a person would see on the row. Each
 * describe block has at least one test that fails when the page's placement
 * line is deleted. The admin dashboard's probes and AI agents are covered in
 * App/AdminDashboard/RowActionPlacementOverrides.test.tsx.
 */

const getMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const getCommonHeadersMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the compiled
 * requires, so the consts above are still in their temporal dead zone when the
 * factory body runs. Dereferencing them lazily, at call time, is what works.
 */
jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: (...args: Array<any>) => {
        return getMock(...args);
      },
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: unknown) => {
        return error instanceof Error ? error.message : "Something went wrong";
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (...args: Array<any>) => {
        return getCommonHeadersMock(...args);
      },
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

import EmailMethods from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/Email";
import SMSMethods from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/SMS";
import CallMethods from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/Call";
import WhatsAppMethods from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/WhatsApp";
import TelegramMethods from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/Telegram";
import IncomingCallNumberMethods from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/IncomingCallNumber";
import MonitorProbesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorProbes";
import DiscoveryPage from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/Discovery";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import NetworkDeviceDiscoveryScan, {
  DiscoveredNetworkDevice,
} from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import Probe from "../../../Models/DatabaseModels/Probe";
import Project from "../../../Models/DatabaseModels/Project";
import UserCall from "../../../Models/DatabaseModels/UserCall";
import UserEmail from "../../../Models/DatabaseModels/UserEmail";
import UserIncomingCallNumber from "../../../Models/DatabaseModels/UserIncomingCallNumber";
import UserSMS from "../../../Models/DatabaseModels/UserSMS";
import UserTelegram from "../../../Models/DatabaseModels/UserTelegram";
import UserWhatsApp from "../../../Models/DatabaseModels/UserWhatsApp";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import Phone from "../../../Types/Phone";
import {
  DISCOVERY_SCAN_STARTED_MESSAGE,
  DiscoveryScanStatus,
} from "../../../Utils/NetworkDiscovery/DiscoveryScanStatus";

const USER_ID: string = "aaaaaaaa-1111-4111-8111-111111111111";
const PROJECT_ID: string = "dddddddd-4444-4444-8444-444444444444";

afterEach(() => {
  cleanup();
  getMock.mockReset();
  postMock.mockReset();
  getListMock.mockReset();
  getItemMock.mockReset();
  getCommonHeadersMock.mockReset();
  localStorage.clear();
  sessionStorage.clear();
});

/*
 * The session these pages read themselves out of. The components take the user
 * and the project from the real utils rather than from props, so the storage
 * those utils read is set instead of stubbing them.
 */
type SessionOptions = {
  isMasterAdmin: boolean;
  projectPermissions: Array<Permission>;
};

const startSession: (options: SessionOptions) => void = (
  options: SessionOptions,
): void => {
  localStorage.setItem("user_id", USER_ID);
  localStorage.setItem("is_master_admin", String(options.isMasterAdmin));
  sessionStorage.setItem("current_project_id", PROJECT_ID);

  if (options.projectPermissions.length > 0) {
    localStorage.setItem(
      "project_permissions",
      JSON.stringify({
        projectId: PROJECT_ID,
        permissions: options.projectPermissions.map(
          (permission: Permission) => {
            return { permission: permission };
          },
        ),
      }),
    );
  }
};

/*
 * A project owner, as the sibling notification-method suites sign in. The
 * permission snapshot matters as well as the master-admin flag: the table drops
 * any extra column the snapshot cannot read (a probe's key, a scan's hosts)
 * from what it asks the server for.
 */
const signInAsOwner: () => void = (): void => {
  startSession({
    isMasterAdmin: true,
    projectPermissions: [Permission.ProjectOwner],
  });
};

/*
 * What a person sees on a row: the one button and the ⋯ trigger, by the name a
 * screen reader would announce.
 */
const rowButtonLabels: (rowActions: HTMLElement) => Array<string> = (
  rowActions: HTMLElement,
): Array<string> => {
  return within(rowActions)
    .getAllByRole("button")
    .map((button: HTMLElement) => {
      const label: string =
        button.getAttribute("aria-label") || (button.textContent || "").trim();

      /*
       * Each ⋯ is named for its row ("More actions for Monitor: Checkout
       * API"); what these tests compare is which controls a row has.
       */
      return label.startsWith("More actions for ") ? "More actions" : label;
    });
};

const openMenuIn: (rowActions: HTMLElement) => HTMLElement = (
  rowActions: HTMLElement,
): HTMLElement => {
  fireEvent.click(within(rowActions).getByTestId("row-actions-more-button"));
  return screen.getByRole("menu");
};

const menuLabels: (menu: HTMLElement) => Array<string> = (
  menu: HTMLElement,
): Array<string> => {
  return within(menu)
    .getAllByRole("menuitem")
    .map((item: HTMLElement) => {
      return (item.textContent || "").trim();
    });
};

type ListResultJSON = {
  data: Array<BaseModel>;
  count: number;
  skip: number;
  limit: number;
};

const listOf: (rows: Array<BaseModel>) => Promise<ListResultJSON> = (
  rows: Array<BaseModel>,
): Promise<ListResultJSON> => {
  return Promise.resolve({
    data: rows,
    count: rows.length,
    skip: 0,
    limit: 50,
  });
};

/*
 * ---------------------------------------------------------------------------
 * NOTIFICATION METHODS: Verify is what an unverified row is waiting for.
 * ---------------------------------------------------------------------------
 */

const UNVERIFIED_ID: string = "11111111-7777-4777-8777-777777777777";
const VERIFIED_ID: string = "22222222-8888-4888-8888-888888888888";

interface MethodTable {
  name: string;
  Component: () => ReactElement;
  modelType: DatabaseBaseModelType;
  // The identifying columns of one row; isVerified is added per row.
  columns: JSONObject;
  // The NORMAL-styled code action that would take the button without the mark.
  codeActionTitle: string;
  verifyDialogTitle: string;
  codeActionDialogTitle: string;
}

const METHOD_TABLES: Array<MethodTable> = [
  {
    name: "Email",
    Component: EmailMethods,
    modelType: UserEmail,
    columns: { email: new Email("jane@example.com") as never },
    codeActionTitle: "Resend Code",
    verifyDialogTitle: "Verify Email",
    codeActionDialogTitle: "Resend Code",
  },
  {
    name: "SMS",
    Component: SMSMethods,
    modelType: UserSMS,
    columns: { phone: new Phone("+15551230100") as never },
    codeActionTitle: "Resend Code",
    verifyDialogTitle: "Verify Phone Number",
    codeActionDialogTitle: "Resend Code",
  },
  {
    name: "Call",
    Component: CallMethods,
    modelType: UserCall,
    columns: { phone: new Phone("+15551230199") as never },
    codeActionTitle: "Resend Code",
    verifyDialogTitle: "Verify Phone Number",
    codeActionDialogTitle: "Resend Code",
  },
  {
    name: "WhatsApp",
    Component: WhatsAppMethods,
    modelType: UserWhatsApp,
    columns: { phone: new Phone("+15551230123") as never },
    codeActionTitle: "Resend Code",
    verifyDialogTitle: "Verify WhatsApp Number",
    codeActionDialogTitle: "Resend Code",
  },
  {
    name: "Telegram",
    Component: TelegramMethods,
    modelType: UserTelegram,
    columns: { telegramUserHandle: "@alexchen" },
    codeActionTitle: "Rotate Code",
    verifyDialogTitle: "Verify Telegram Account",
    codeActionDialogTitle: "Rotate Verification Code",
  },
  {
    name: "Incoming call number",
    Component: IncomingCallNumberMethods,
    modelType: UserIncomingCallNumber,
    columns: { phone: new Phone("+15551230177") as never },
    codeActionTitle: "Resend Code",
    verifyDialogTitle: "Verify Phone Number",
    codeActionDialogTitle: "Resend Code",
  },
];

const buildMethodRow: (
  table: MethodTable,
  id: string,
  isVerified: boolean,
) => BaseModel = (
  table: MethodTable,
  id: string,
  isVerified: boolean,
): BaseModel => {
  const model: BaseModel = new table.modelType();
  model.id = new ObjectID(id);

  const columns: JSONObject = { ...table.columns, isVerified: isVerified };

  for (const columnName of Object.keys(columns)) {
    (model as unknown as Record<string, unknown>)[columnName] =
      columns[columnName];
  }

  return model;
};

/*
 * One unverified method above one verified one, so the same render shows the
 * row the mark is for and the row it must leave alone.
 */
const mockMethodRows: (table: MethodTable) => void = (
  table: MethodTable,
): void => {
  getCommonHeadersMock.mockReturnValue({});

  getListMock.mockImplementation((params: any): Promise<ListResultJSON> => {
    if (params.modelType === table.modelType) {
      return listOf([
        buildMethodRow(table, UNVERIFIED_ID, false),
        buildMethodRow(table, VERIFIED_ID, true),
      ]);
    }

    return listOf([]);
  });

  /*
   * Only Telegram's Verify calls out before its dialog opens (for the bot's
   * deep link); the others post only when the dialog is submitted.
   */
  postMock.mockResolvedValue(
    new HTTPResponse<JSONObject>(
      200,
      {
        verificationCode: "123456",
        telegramBotUsername: "oneuptime_bot",
        isVerified: false,
        deepLinkUrl: "https://t.me/oneuptime_bot?start=123456",
        startCommand: "/start 123456",
      },
      {},
    ) as never,
  );
};

type MethodRows = {
  unverified: HTMLElement;
  verified: HTMLElement;
};

const renderMethodTable: (table: MethodTable) => Promise<MethodRows> = async (
  table: MethodTable,
): Promise<MethodRows> => {
  signInAsOwner();
  mockMethodRows(table);

  render(<table.Component />);

  await waitFor(() => {
    expect(screen.getAllByTestId("row-actions")).toHaveLength(2);
  });

  const [unverified, verified] = screen.getAllByTestId("row-actions");

  return { unverified: unverified!, verified: verified! };
};

describe.each(METHOD_TABLES)(
  "$name notification methods: Verify is the unverified row's button",
  (table: MethodTable) => {
    test("an unverified row shows Verify, with the code action and Delete in the menu", async () => {
      const { unverified } = await renderMethodTable(table);

      expect(rowButtonLabels(unverified)).toEqual(["Verify", "More actions"]);
      expect(within(unverified).queryByText(table.codeActionTitle)).toBeNull();

      // Delete sinks below the code action, as destructive actions always do.
      expect(menuLabels(openMenuIn(unverified))).toEqual([
        table.codeActionTitle,
        "Delete",
      ]);
    });

    test("Verify is never offered from the menu as well", async () => {
      const { unverified } = await renderMethodTable(table);

      expect(
        within(openMenuIn(unverified)).queryByRole("menuitem", {
          name: "Verify",
        }),
      ).toBeNull();
      expect(screen.getAllByRole("button", { name: "Verify" })).toHaveLength(1);
    });

    /*
     * The mark is for rows that are waiting on a code. A verified row has
     * nothing to verify, so it must not grow a Verify button from it - Delete
     * is all it has, and a lone action stays on the row rather than behind a
     * menu of one.
     */
    test("a verified row offers neither Verify nor the code action", async () => {
      const { verified } = await renderMethodTable(table);

      expect(rowButtonLabels(verified)).toEqual(["Delete"]);
      expect(
        within(verified).queryByTestId("row-actions-more-button"),
      ).toBeNull();
    });

    test("the row's Verify button opens the verify dialog", async () => {
      const { unverified } = await renderMethodTable(table);

      fireEvent.click(
        within(unverified).getByRole("button", { name: "Verify" }),
      );

      await waitFor(() => {
        expect(screen.getByTestId("modal-title")).toHaveTextContent(
          table.verifyDialogTitle,
        );
      });
    });

    test("the code action still works from the menu", async () => {
      const { unverified } = await renderMethodTable(table);

      fireEvent.click(
        within(openMenuIn(unverified)).getByRole("menuitem", {
          name: table.codeActionTitle,
        }),
      );

      await waitFor(() => {
        expect(screen.getByTestId("modal-title")).toHaveTextContent(
          table.codeActionDialogTitle,
        );
      });
    });
  },
);

/*
 * ---------------------------------------------------------------------------
 * A PROJECT'S CUSTOM PROBES: Show ID and Key is a utility, never the button.
 * ---------------------------------------------------------------------------
 */

const PROBE_ID: string = "33333333-9999-4999-8999-999999999999";
const PROBE_KEY: string = "probe-secret-key-0001";

/*
 * The page carries two probe tables. The global one (read from its own
 * endpoint) has no row actions, so it is left empty and every row on screen is
 * the custom probe.
 */
const mockProbeRows: () => void = (): void => {
  getCommonHeadersMock.mockReturnValue({});

  getListMock.mockImplementation((params: any): Promise<ListResultJSON> => {
    if (
      params.modelType === Probe &&
      !params.requestOptions?.overrideRequestUrl
    ) {
      const probe: Probe = new Probe();
      probe._id = PROBE_ID;
      probe.name = "Office LAN";
      probe.key = PROBE_KEY;

      return listOf([probe]);
    }

    return listOf([]);
  });

  // The Global Probe Settings card under the tables reads the project.
  getItemMock.mockResolvedValue(null as never);
};

const renderMonitorProbes: () => Promise<HTMLElement> =
  async (): Promise<HTMLElement> => {
    mockProbeRows();

    render(
      <MemoryRouter>
        <MonitorProbesPage
          pageRoute={new Route("/dashboard/settings/probes")}
          currentProject={null}
          hasPaymentMethod={true}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getAllByTestId("row-actions")).toHaveLength(1);
    });

    return screen.getByTestId("row-actions");
  };

describe("Custom probes: Show ID and Key is never the row's button", () => {
  test("a probe row shows View, with Show ID and Key in the menu", async () => {
    signInAsOwner();

    const rowActions: HTMLElement = await renderMonitorProbes();

    expect(rowButtonLabels(rowActions)).toEqual(["View Probe", "More actions"]);
    expect(
      within(rowActions).queryByRole("button", { name: "Show ID and Key" }),
    ).toBeNull();
    expect(menuLabels(openMenuIn(rowActions))).toEqual(["Show ID and Key"]);
  });

  /*
   * View only appears once the permission snapshot says the viewer may read
   * probes - and the snapshot arrives on a response header, so for the first
   * paint after a login or a project switch it is empty. Show ID and Key is
   * then the row's only action, and styled NORMAL: without the MoreMenu mark
   * it would sit on every row as the button, which is the one place a
   * secret-revealing utility should not be.
   */
  test("with View not on offer, Show ID and Key still waits in the menu", async () => {
    startSession({ isMasterAdmin: false, projectPermissions: [] });

    const rowActions: HTMLElement = await renderMonitorProbes();

    expect(rowButtonLabels(rowActions)).toEqual(["More actions"]);
    expect(menuLabels(openMenuIn(rowActions))).toEqual(["Show ID and Key"]);
  });

  test("Show ID and Key from the menu reveals that probe's ID and key", async () => {
    signInAsOwner();

    const rowActions: HTMLElement = await renderMonitorProbes();

    fireEvent.click(
      within(openMenuIn(rowActions)).getByRole("menuitem", {
        name: "Show ID and Key",
      }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("modal-title")).toHaveTextContent("Probe Key");
    });
    expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
      `Probe ID: ${PROBE_ID}`,
    );
    expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
      `Probe Key: ${PROBE_KEY}`,
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * DISCOVERY SCANS: Review Results is why a scan with results exists.
 * ---------------------------------------------------------------------------
 */

const HOST: DiscoveredNetworkDevice = {
  ipAddress: "10.0.0.7",
  snmpReachable: false,
  isAlreadyRegistered: false,
};

type ScanCase = {
  name: string;
  id: string;
  overrides: Partial<Record<string, unknown>>;
};

/*
 * One scan in every state the Review Results rule tells apart, named for what
 * the row should offer. Pending and just-claimed scans still carry the hosts of
 * their previous run - those belong to a run that is over, which is why
 * neither may be reviewed.
 */
const COMPLETED_SCAN: ScanCase = {
  name: "Completed with hosts",
  id: "44444444-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  overrides: { status: DiscoveryScanStatus.Completed },
};

const RUNNING_SCAN: ScanCase = {
  name: "Running with partial hosts",
  id: "55555555-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  overrides: { status: DiscoveryScanStatus.InProgress },
};

const FAILED_SCAN: ScanCase = {
  name: "Failed after partial hosts",
  id: "66666666-cccc-4ccc-8ccc-cccccccccccc",
  overrides: {
    status: DiscoveryScanStatus.Failed,
    statusMessage: "Probe lost connection during discovery.",
  },
};

const JUST_CLAIMED_SCAN: ScanCase = {
  name: "Just claimed",
  id: "77777777-dddd-4ddd-8ddd-dddddddddddd",
  overrides: {
    status: DiscoveryScanStatus.InProgress,
    statusMessage: DISCOVERY_SCAN_STARTED_MESSAGE,
  },
};

const PENDING_SCAN: ScanCase = {
  name: "Queued",
  id: "88888888-eeee-4eee-8eee-eeeeeeeeeeee",
  overrides: { status: DiscoveryScanStatus.Pending, startedAt: undefined },
};

const RUNNING_EMPTY_SCAN: ScanCase = {
  name: "Running with no hosts yet",
  id: "99999999-ffff-4fff-8fff-ffffffffffff",
  overrides: {
    status: DiscoveryScanStatus.InProgress,
    respondedHostCount: 0,
    discoveredDevices: [],
  },
};

const ALL_SCANS: Array<ScanCase> = [
  COMPLETED_SCAN,
  RUNNING_SCAN,
  FAILED_SCAN,
  JUST_CLAIMED_SCAN,
  PENDING_SCAN,
  RUNNING_EMPTY_SCAN,
];

const buildScan: (scanCase: ScanCase) => NetworkDeviceDiscoveryScan = (
  scanCase: ScanCase,
): NetworkDeviceDiscoveryScan => {
  return Object.assign(
    new NetworkDeviceDiscoveryScan(),
    {
      _id: scanCase.id,
      name: scanCase.name,
      cidr: "10.0.0.0/24",
      startedAt: new Date("2026-09-09T12:00:00Z"),
      scannedHostCount: 256,
      respondedHostCount: 1,
      discoveredDevices: [HOST],
    },
    scanCase.overrides,
  );
};

const mockScanRows: () => void = (): void => {
  getCommonHeadersMock.mockReturnValue({});

  getListMock.mockImplementation((params: any): Promise<ListResultJSON> => {
    if (params.modelType === NetworkDeviceDiscoveryScan) {
      return listOf(ALL_SCANS.map(buildScan));
    }

    return listOf([]);
  });

  // The review dialog re-reads the scan it opens for.
  getItemMock.mockImplementation((params: any): Promise<unknown> => {
    if (params.modelType === NetworkDeviceDiscoveryScan) {
      const scanCase: ScanCase | undefined = ALL_SCANS.find(
        (candidate: ScanCase) => {
          return candidate.id === params.id.toString();
        },
      );

      return Promise.resolve(
        scanCase
          ? Object.assign(buildScan(scanCase), { isSnmpEnabled: false })
          : null,
      );
    }

    return Promise.resolve(null);
  });
};

const renderDiscovery: () => Promise<void> = async (): Promise<void> => {
  mockScanRows();

  render(
    <MemoryRouter>
      <DiscoveryPage
        pageRoute={new Route("/dashboard/network-devices/discovery")}
        currentProject={Object.assign(new Project(), {
          id: new ObjectID(PROJECT_ID),
        })}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );

  await waitFor(() => {
    expect(screen.getAllByTestId("row-actions")).toHaveLength(ALL_SCANS.length);
  });
};

// The actions of the table row that names this scan.
const rowActionsFor: (scanCase: ScanCase) => HTMLElement = (
  scanCase: ScanCase,
): HTMLElement => {
  const rowActions: HTMLElement | undefined = screen
    .getAllByTestId("row-actions")
    .find((candidate: HTMLElement) => {
      return (candidate.closest("tr")?.textContent || "").includes(
        scanCase.name,
      );
    });

  if (!rowActions) {
    throw new Error(`No row for the "${scanCase.name}" scan.`);
  }

  return rowActions;
};

describe("Discovery scans: Review Results is the row's button whenever it is offered", () => {
  test.each([COMPLETED_SCAN, RUNNING_SCAN, FAILED_SCAN])(
    "$name: Review Results on the row, Edit and Delete in the menu",
    async (scanCase: ScanCase) => {
      signInAsOwner();
      await renderDiscovery();

      const rowActions: HTMLElement = rowActionsFor(scanCase);

      expect(rowButtonLabels(rowActions)).toEqual([
        "Review Results",
        "More actions",
      ]);
      expect(within(rowActions).queryByText("Edit")).toBeNull();
      expect(menuLabels(openMenuIn(rowActions))).toEqual(["Edit", "Delete"]);
    },
  );

  /*
   * The mark only decides between actions that are offered. A scan with
   * nothing reviewable does not show Review Results at all, so Edit - the first
   * call to action left - is its button.
   */
  test.each([JUST_CLAIMED_SCAN, PENDING_SCAN, RUNNING_EMPTY_SCAN])(
    "$name: nothing to review, so Edit is the button",
    async (scanCase: ScanCase) => {
      signInAsOwner();
      await renderDiscovery();

      const rowActions: HTMLElement = rowActionsFor(scanCase);

      expect(rowButtonLabels(rowActions)).toEqual(["Edit", "More actions"]);
      expect(menuLabels(openMenuIn(rowActions))).toEqual(["Delete"]);
    },
  );

  test("the row's Review Results button opens the review for that scan", async () => {
    signInAsOwner();
    await renderDiscovery();

    fireEvent.click(
      within(rowActionsFor(RUNNING_SCAN)).getByRole("button", {
        name: "Review Results",
      }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("modal-title")).toHaveTextContent(
        "Review Discovered Devices",
      );
    });

    const scanReads: Array<any> = (getItemMock as any).mock.calls.filter(
      (call: Array<any>): boolean => {
        return call[0].modelType === NetworkDeviceDiscoveryScan;
      },
    );

    expect(scanReads).toHaveLength(1);
    expect(scanReads[0][0].id.toString()).toBe(RUNNING_SCAN.id);
  });

  test("Edit from the menu opens the edit form for that scan", async () => {
    signInAsOwner();
    await renderDiscovery();

    fireEvent.click(
      within(openMenuIn(rowActionsFor(COMPLETED_SCAN))).getByRole("menuitem", {
        name: "Edit",
      }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("modal-title")).toHaveTextContent(
        "Edit Discovery Scan",
      );
    });
  });

  /*
   * A viewer is never offered Edit (the page hides it rather than open a form
   * they could not save), and Delete is shown locked. Review Results is still
   * theirs to use.
   */
  test("a viewer still gets Review Results on the row, and no Edit anywhere", async () => {
    startSession({
      isMasterAdmin: false,
      projectPermissions: [Permission.Viewer],
    });
    await renderDiscovery();

    const rowActions: HTMLElement = rowActionsFor(COMPLETED_SCAN);

    expect(rowButtonLabels(rowActions)).toEqual([
      "Review Results",
      "More actions",
    ]);

    const menu: HTMLElement = openMenuIn(rowActions);

    expect(menuLabels(menu)).toEqual(["Delete"]);
    expect(
      within(menu).getByRole("menuitem", { name: "Delete" }),
    ).toHaveAttribute("aria-disabled", "true");
  });
});
