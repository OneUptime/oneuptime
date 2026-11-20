import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * Inventory > Managed Devices (issue #9586): the Esper connections list,
 * the devices list, a device's apps, a device's status chip and the words
 * all of them say. ModelTable is captured instead of rendered, so what is
 * under test is what each list hands it:
 *
 *   - the connections list reads this project's connections and never
 *     their key; its button reads "Connect Esper" and opens the page's
 *     form; a row says the tenant's address under its name, and how the
 *     connection is doing - red only for a read that failed, grey for one
 *     someone turned off; View error only while it fails, Read now and
 *     Turn off while it is on, Turn on while it is off, each greyed with
 *     why without the right to change connections; Set up alerts on every
 *     row, opening the connection's recommended monitors (#9835);
 *   - the devices list reads this project's devices, adds and changes
 *     nothing, and opens a device on its host's Inventory page;
 *   - a device's apps are that device's, read only;
 *   - the status chip: Offline after half an hour without a check-in, with
 *     how long ago, and Removed for a device Esper no longer has;
 *   - the words: a test's failure says what happened and what to do, then
 *     Esper's own answer; a passed test says how many devices a read
 *     imports.
 */

const mockCapturedTableProps: Array<Record<string, unknown>> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): null => {
      mockCapturedTableProps.push(props);
      return null;
    },
  };
});

import DeviceManagementConnectionsTable, {
  getConnectionHealth,
  getConnectionRecommendationsRoute,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DeviceManagement/DeviceManagementConnectionsTable";
import ManagedDevicesTable from "../../../../App/FeatureSet/Dashboard/src/Components/DeviceManagement/ManagedDevicesTable";
import ManagedDeviceAppsTable from "../../../../App/FeatureSet/Dashboard/src/Components/DeviceManagement/ManagedDeviceAppsTable";
import ManagedDeviceCard from "../../../../App/FeatureSet/Dashboard/src/Components/DeviceManagement/ManagedDeviceCard";
import ManagedDeviceStatusPill, {
  getMinutesSinceCheckIn,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DeviceManagement/ManagedDeviceStatusPill";
import {
  MANAGED_DEVICE_PLATFORM_OPTIONS,
  READ_INTERVAL_WORDS,
  TEST_PASSED,
  getDeviceManagementFailureWords,
  getDeviceManagementHealthWords,
  getDeviceManagementTestWords,
  getManagedDeviceMatchWords,
  getManagedDeviceOperatingSystemLine,
  getManagedDeviceStatusWords,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DeviceManagement/DeviceManagementWords";
import { ManagedDevicePlatform } from "../../../Types/DeviceManagement/ManagedDevicePlatform";
import { DEVICE_MANAGER_CARD_OPTIONS } from "../../../../App/FeatureSet/Dashboard/src/Components/DeviceManagement/DeviceManagerPickerModal";
import { CardSelectOption } from "../../../UI/Components/CardSelect/CardSelect";
import {
  getTestFailureSentence,
  getTestPassedSentence,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DeviceManagement/EsperConnectionFormModal";
import DeviceManagementConnection from "../../../Models/DatabaseModels/DeviceManagementConnection";
import ManagedDevice from "../../../Models/DatabaseModels/ManagedDevice";
import Route from "../../../Types/API/Route";
import { DeviceManagementConnectionStatus } from "../../../Types/DeviceManagement/DeviceManagementConnectionHealth";
import { DEVICE_MANAGEMENT_READ_INTERVALS_IN_MINUTES } from "../../../Types/DeviceManagement/DeviceManagementConnectionSettings";
import { DeviceManagementTestResult } from "../../../Types/DeviceManagement/DeviceManagementConnectionTest";
import DeviceManagementProvider from "../../../Types/DeviceManagement/DeviceManagementProvider";
import { ManagedDeviceHostMatch } from "../../../Types/DeviceManagement/ManagedDeviceIdentity";
import {
  EsperDeviceState,
  ManagedDeviceStatus,
} from "../../../Types/DeviceManagement/ManagedDeviceStatus";
import { LlmConnectionFailureKind } from "../../../Types/LlmObservability/LlmConnectionTest";
import ObjectID from "../../../Types/ObjectID";
import { PillTone } from "../../../UI/Components/Pill/PillTone";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import { PermissionGateResult } from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  Translator,
  getGlobalTranslator,
} from "../../../UI/Utils/TranslateTemplate";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

interface CapturedAction {
  title: string;
  disabled?: boolean;
  tooltip?: string;
  isVisible?: (item: DeviceManagementConnection) => boolean;
  onClick: (
    item: DeviceManagementConnection,
    done: () => void,
  ) => void | Promise<void>;
}

interface CapturedColumn<T> {
  title: string;
  getElement: (item: T) => React.ReactElement;
}

const CONNECTION_ID: string = "30000000-0000-4000-8000-000000000001";
const DEVICE_ID: string = "30000000-0000-4000-8000-000000000002";
const ITEM_ID: string = "30000000-0000-4000-8000-000000000003";
const NOW: Date = new Date("2026-11-19T12:00:00.000Z");

const english: Translator = getGlobalTranslator();

function connection(
  fields: Record<string, unknown> = {},
): DeviceManagementConnection {
  const item: DeviceManagementConnection = new DeviceManagementConnection();
  item._id = CONNECTION_ID;
  item.name = "Store fleet";
  item.isEnabled = true;
  item.config = { tenant: "acme", readIntervalInMinutes: 15 };
  item.createdAt = new Date("2026-11-19T11:00:00.000Z");
  item.lastPulledAt = new Date("2026-11-19T11:50:00.000Z");
  item.lastSuccessfulPullAt = new Date("2026-11-19T11:50:00.000Z");
  Object.assign(item, fields);
  return item;
}

function testResult(
  fields: Partial<DeviceManagementTestResult> &
    Pick<DeviceManagementTestResult, "status">,
): DeviceManagementTestResult {
  return {
    provider: DeviceManagementProvider.Esper,
    message: "",
    tenant: "acme",
    durationMs: 1,
    ...fields,
  };
}

let updateSpy: jest.SpyInstance<any, any>;

beforeEach(() => {
  mockCapturedTableProps.length = 0;
  goTo(`/dashboard/${PROJECT_ID}/inventory/managed-devices`);
  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );
  updateSpy = getJestSpyOn(ModelAPI, "updateById").mockResolvedValue({});
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function lastTableProps(): Record<string, unknown> {
  const props: Record<string, unknown> | undefined =
    mockCapturedTableProps[mockCapturedTableProps.length - 1];

  if (!props) {
    throw new Error("No ModelTable was drawn");
  }

  return props;
}

function renderConnections(
  updateGate: PermissionGateResult = { isAllowed: true },
  onConnect: MockFunction = getJestMockFunction(),
  onEdit: MockFunction = getJestMockFunction(),
): Record<string, unknown> {
  render(
    <MemoryRouter>
      <DeviceManagementConnectionsTable
        refreshToggle="0"
        updateGate={updateGate}
        onConnect={onConnect as unknown as () => void}
        onEdit={onEdit as unknown as (item: DeviceManagementConnection) => void}
        onConnectionsLoaded={(): void => {}}
      />
    </MemoryRouter>,
  );

  return lastTableProps();
}

function action(props: Record<string, unknown>, title: string): CapturedAction {
  const found: CapturedAction | undefined = (
    props["actionButtons"] as Array<CapturedAction>
  ).find((candidate: CapturedAction): boolean => {
    return candidate.title === title;
  });

  if (!found) {
    throw new Error(`No action "${title}"`);
  }

  return found;
}

function column<T>(
  props: Record<string, unknown>,
  title: string,
): CapturedColumn<T> {
  const found: CapturedColumn<T> | undefined = (
    props["columns"] as Array<CapturedColumn<T>>
  ).find((candidate: CapturedColumn<T>): boolean => {
    return candidate.title === title;
  });

  if (!found) {
    throw new Error(`No column "${title}"`);
  }

  return found;
}

describe("the Esper connections list", () => {
  test("reads this project's connections, and never their key", () => {
    const props: Record<string, unknown> = renderConnections();

    expect(props["query"]).toEqual({ projectId: new ObjectID(PROJECT_ID) });
    expect(
      Object.keys(props["selectMoreFields"] as Record<string, unknown>),
    ).not.toContain("secrets");
    expect(props["isEditable"]).toBe(false);
  });

  // #9837: Esper or Microsoft Intune, chosen on the page before its form.
  test("its button reads Connect device manager and opens the page's choice", () => {
    const onConnect: MockFunction = getJestMockFunction();
    const props: Record<string, unknown> = renderConnections(
      { isAllowed: true },
      onConnect,
    );

    expect(props["isCreateable"]).toBe(true);
    expect(props["createVerb"]).toBe("Connect");
    expect(props["singularName"]).toBe("device manager");
    expect(props["noItemsMessage"]).toBe("No device managers connected yet.");
    (props["onCreateClick"] as () => void)();
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  test("its delete dialog names the connection, not Esper", async () => {
    const props: Record<string, unknown> = renderConnections();
    const getDeleteConfirmation: (
      item: DeviceManagementConnection,
    ) => Promise<{ title?: string }> = props["getDeleteConfirmation"] as (
      item: DeviceManagementConnection,
    ) => Promise<{ title?: string }>;

    expect((await getDeleteConfirmation(connection())).title).toBe(
      "Delete Store fleet",
    );
  });

  test("a row names the connection and its tenant's address", () => {
    const props: Record<string, unknown> = renderConnections();
    const cell: CapturedColumn<DeviceManagementConnection> = column(
      props,
      "Connection",
    );

    render(cell.getElement(connection()));
    expect(screen.getByText("Store fleet")).toBeInTheDocument();
    expect(screen.getByText("Esper · acme.esper.cloud")).toBeInTheDocument();
    cleanup();

    // An Intune connection: its service, its tenant and its cloud.
    render(
      cell.getElement(
        connection({
          name: "Contoso",
          provider: DeviceManagementProvider.Intune,
          config: {
            tenant: "contoso.onmicrosoft.us",
            clientId: "6731de76-14a6-49ae-97bc-6eba6914391e",
            cloud: "usgov",
            readIntervalInMinutes: 15,
          },
        }),
      ),
    );
    expect(
      screen.getByText(
        "Microsoft Intune · contoso.onmicrosoft.us (Microsoft 365 GCC High)",
      ),
    ).toBeInTheDocument();
  });

  test("an Intune connection's failure is said in Microsoft's words", () => {
    expect(
      getDeviceManagementFailureWords(
        LlmConnectionFailureKind.Permission,
        DeviceManagementProvider.Intune,
      ),
    ).toEqual({
      headline: "The app registration may not read Intune's devices.",
      advice:
        "Give it the application permission DeviceManagementManagedDevices.Read.All on Microsoft Graph, and grant admin consent.",
    });
    expect(
      getDeviceManagementFailureWords(
        LlmConnectionFailureKind.Authentication,
        DeviceManagementProvider.Intune,
      ).headline,
    ).toBe("Microsoft Entra refused the client secret.");
    // Esper's, when the service is Esper or not said.
    expect(
      getDeviceManagementFailureWords(LlmConnectionFailureKind.Authentication)
        .headline,
    ).toBe("Esper refused the API key.");
  });

  test("the choice of device manager: Esper, Microsoft Intune, Workspace ONE UEM and SOTI MobiControl, each by its product name and a neutral icon", () => {
    expect(
      DEVICE_MANAGER_CARD_OPTIONS.map((option: CardSelectOption) => {
        return [option.value, option.title, option.logo];
      }),
    ).toEqual([
      ["esper", "Esper", undefined],
      ["intune", "Microsoft Intune", undefined],
      // #10086, #10087.
      ["workspaceone", "Workspace ONE UEM", undefined],
      ["soti", "SOTI MobiControl", undefined],
    ]);
  });

  test("says a failing read in red, and a turned-off connection in grey", () => {
    const props: Record<string, unknown> = renderConnections();
    const cell: CapturedColumn<DeviceManagementConnection> = column(
      props,
      "Status",
    );

    const failing: DeviceManagementConnection = connection({
      lastError: "Esper refused the API key.",
      lastSuccessfulPullAt: undefined,
    });

    expect(getConnectionHealth(failing, NOW).status).toBe(
      DeviceManagementConnectionStatus.Failing,
    );
    render(cell.getElement(failing));
    expect(screen.getByText("Failing")).toBeInTheDocument();
    cleanup();

    const off: DeviceManagementConnection = connection({
      isEnabled: false,
      lastError: "Esper refused the API key.",
    });

    expect(getConnectionHealth(off, NOW).status).toBe(
      DeviceManagementConnectionStatus.Off,
    );
    render(cell.getElement(off));
    expect(screen.getByText("Off")).toBeInTheDocument();
  });

  test("offers View error only while it fails, and Read now and Turn off while it is on", () => {
    const props: Record<string, unknown> = renderConnections();
    const on: DeviceManagementConnection = connection();
    const failing: DeviceManagementConnection = connection({
      lastError: "Esper refused the API key.",
    });
    const off: DeviceManagementConnection = connection({ isEnabled: false });

    expect(action(props, "View error").isVisible!(on)).toBe(false);
    expect(action(props, "View error").isVisible!(failing)).toBe(true);
    expect(
      action(props, "View error").isVisible!(
        connection({ isEnabled: false, lastError: "x" }),
      ),
    ).toBe(false);
    expect(action(props, "Read now").isVisible!(on)).toBe(true);
    expect(action(props, "Read now").isVisible!(off)).toBe(false);
    expect(action(props, "Turn off").isVisible!(on)).toBe(true);
    expect(action(props, "Turn on").isVisible!(on)).toBe(false);
    expect(action(props, "Turn on").isVisible!(off)).toBe(true);
  });

  test("Turn off turns the connection off, and keeps what it brought in", async () => {
    const props: Record<string, unknown> = renderConnections();
    const done: MockFunction = getJestMockFunction();

    expect(action(props, "Turn off").tooltip).toBe(
      "Stop reading it. What it brought in stays.",
    );
    await act(async () => {
      await action(props, "Turn off").onClick(
        connection(),
        done as unknown as () => void,
      );
    });

    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        modelType: DeviceManagementConnection,
        data: { isEnabled: false },
      }),
    );
    expect(done).toHaveBeenCalled();
  });

  /*
   * #9835: a connection's recommended monitors - Esper Device Stopped
   * Checking In - are a page of their own, opened from its row.
   */
  test("Set up alerts opens the connection's recommended monitors", () => {
    const navigate: jest.SpyInstance<any, any> = getJestSpyOn(
      Navigation,
      "navigate",
    ).mockImplementation(() => {});
    const props: Record<string, unknown> = renderConnections();
    const done: MockFunction = getJestMockFunction();

    expect(action(props, "Set up alerts").tooltip).toBe(
      "Get an alert when one of its devices stops checking in.",
    );
    void action(props, "Set up alerts").onClick(
      connection(),
      done as unknown as () => void,
    );

    expect(done).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(String(navigate.mock.calls[0]![0])).toBe(
      `/dashboard/${PROJECT_ID}/inventory/managed-devices/${CONNECTION_ID}/recommendations`,
    );
    expect(
      getConnectionRecommendationsRoute(new ObjectID(CONNECTION_ID)).toString(),
    ).toBe(
      `/dashboard/${PROJECT_ID}/inventory/managed-devices/${CONNECTION_ID}/recommendations`,
    );
  });

  test("Set up alerts is on every row, for everyone who sees it: creating a monitor asks its own permission", () => {
    const props: Record<string, unknown> = renderConnections({
      isAllowed: false,
      disabledReason: "You need permission to edit connections.",
    });

    expect(action(props, "Set up alerts").isVisible).toBeUndefined();
    expect(action(props, "Set up alerts").disabled).toBeUndefined();
  });

  test("greys every change, with why, without the right to change connections", () => {
    const props: Record<string, unknown> = renderConnections({
      isAllowed: false,
      disabledReason: "You need permission to edit connections.",
    });

    for (const title of ["Read now", "Turn on", "Turn off", "Edit"]) {
      expect({ title, disabled: action(props, title).disabled }).toEqual({
        title,
        disabled: true,
      });
      expect(action(props, title).tooltip).toBe(
        "You need permission to edit connections.",
      );
    }
  });
});

describe("the devices list", () => {
  test("reads this project's devices, and adds, edits and deletes nothing", () => {
    render(
      <MemoryRouter>
        <ManagedDevicesTable refreshToggle="0" />
      </MemoryRouter>,
    );
    const props: Record<string, unknown> = lastTableProps();

    expect(props["query"]).toEqual({ projectId: new ObjectID(PROJECT_ID) });
    expect(props["isCreateable"]).toBe(false);
    expect(props["isEditable"]).toBe(false);
    expect(props["isDeleteable"]).toBe(false);
    expect(props["isViewable"]).toBe(true);
    expect(props["searchableFields"]).toEqual([
      "deviceName",
      "alias",
      "serialNumber",
    ]);
  });

  test("opens a device on its host's Inventory page", async () => {
    render(
      <MemoryRouter>
        <ManagedDevicesTable refreshToggle="0" />
      </MemoryRouter>,
    );
    const props: Record<string, unknown> = lastTableProps();
    const device: ManagedDevice = new ManagedDevice();
    device._id = DEVICE_ID;
    device.inventoryItemId = new ObjectID(ITEM_ID);

    const route: Route = await (
      props["onViewPage"] as (item: ManagedDevice) => Promise<Route>
    )(device);

    expect(route.toString()).toBe(
      `/dashboard/${PROJECT_ID}/inventory/item/${ITEM_ID}`,
    );
  });
});

describe("a device's apps", () => {
  test("are that device's, read only", () => {
    const deviceId: ObjectID = new ObjectID(DEVICE_ID);

    render(
      <MemoryRouter>
        <ManagedDeviceAppsTable managedDeviceId={deviceId} />
      </MemoryRouter>,
    );
    const props: Record<string, unknown> = lastTableProps();

    expect(props["query"]).toEqual({ managedDeviceId: deviceId });
    expect(props["isCreateable"]).toBe(false);
    expect(props["isEditable"]).toBe(false);
    expect(props["isDeleteable"]).toBe(false);
  });
});

/*
 * A device's Esper card draws Esper's agent version as every agent version
 * is drawn (AgentVersion, AgentVersionDisplayGuard): Esper releases and
 * updates its agent, so OneUptime never calls it outdated.
 */
describe("a device's Esper card", () => {
  async function renderCard(fields: Record<string, unknown>): Promise<void> {
    const device: ManagedDevice = new ManagedDevice();
    device._id = DEVICE_ID;
    device.deviceName = "ESP-ID-AAAAW";
    device.lastCheckInAt = new Date("2026-11-19T11:50:00.000Z");
    Object.assign(device, fields);
    getJestSpyOn(ModelAPI, "getItem").mockResolvedValue(device);

    await act(async () => {
      render(
        <MemoryRouter>
          <ManagedDeviceCard managedDeviceId={new ObjectID(DEVICE_ID)} />
        </MemoryRouter>,
      );
    });
  }

  function agentRow(): HTMLElement {
    return screen.getByText("Esper Agent").parentElement as HTMLElement;
  }

  test("shows Esper's agent version as it is, with no sign however old", async () => {
    await renderCard({ agentVersion: "0.0.1" });

    expect(within(agentRow()).getByText("0.0.1")).toBeInTheDocument();
    expect(screen.queryByTestId("agent-version-outdated")).toBeNull();
  });

  test("a device whose agent reported no version shows none", async () => {
    await renderCard({ agentVersion: "" });

    expect(within(agentRow()).queryByText("0.0.1")).toBeNull();
    expect(screen.queryByTestId("agent-version-outdated")).toBeNull();
  });
});

/*
 * #9837: an Esper tenant's Apple devices are listed beside its Android
 * ones, each saying what it runs; an Apple device's card has no patch level
 * and no Esper agent, which are Android's.
 */
describe("a device's platform", () => {
  // A fact of the card, as its words read: what follows its label.
  function factOf(label: string): string {
    const row: HTMLElement = screen.getByText(label)
      .parentElement as HTMLElement;

    return (
      row.querySelector("dd")?.textContent?.replace(/[⁦-⁩]/g, "") || ""
    ).trim();
  }

  test("the devices list reads each device's platform and service, and filters by what it runs", () => {
    render(
      <MemoryRouter>
        <ManagedDevicesTable refreshToggle="0" />
      </MemoryRouter>,
    );
    const props: Record<string, unknown> = lastTableProps();
    const filters: Array<{
      title: string;
      filterDropdownOptions?: Array<{
        value: unknown;
        label: string;
        isUserContent?: boolean;
      }>;
    }> = props["filters"] as Array<{
      title: string;
      filterDropdownOptions?: Array<{
        value: unknown;
        label: string;
        isUserContent?: boolean;
      }>;
    }>;
    const platform:
      | {
          title: string;
          filterDropdownOptions?: Array<{
            value: unknown;
            label: string;
            isUserContent?: boolean;
          }>;
        }
      | undefined = filters.find((filter: { title: string }): boolean => {
      return filter.title === "Platform";
    });

    expect(props["selectMoreFields"]).toMatchObject({
      platform: true,
      details: true,
      connection: { provider: true },
    });
    expect(
      platform!.filterDropdownOptions!.map(
        (option: { value: unknown; label: string }): string => {
          return `${String(option.value)}=${option.label}`;
        },
      ),
    ).toEqual([
      "android=Android",
      "ios=iOS",
      "ipados=iPadOS",
      "tvos=tvOS",
      "macos=macOS",
      "windows=Windows",
      "linux=Linux",
      "other=Other",
    ]);
    // Product names are drawn as written; "Other" is a word to translate.
    expect(
      MANAGED_DEVICE_PLATFORM_OPTIONS.filter(
        (option: { isUserContent?: boolean | undefined }): boolean => {
          return option.isUserContent !== true;
        },
      ).map((option: { label: string }): string => {
        return option.label;
      }),
    ).toEqual(["Other"]);
  });

  test("a device's system is its name and its version, once", () => {
    expect(
      getManagedDeviceOperatingSystemLine({
        platform: "ipados",
        osVersion: "17.4.1",
      }),
    ).toBe("iPadOS 17.4.1");
    // A row written before the platform was kept runs Android.
    expect(getManagedDeviceOperatingSystemLine({ osVersion: "13" })).toBe(
      "Android 13",
    );
    // A version that names its system already is not named twice.
    expect(
      getManagedDeviceOperatingSystemLine({
        platform: "windows",
        osVersion: "Windows 11 Pro 23H2",
      }),
    ).toBe("Windows 11 Pro 23H2");
    expect(
      getManagedDeviceOperatingSystemLine({
        platform: "other",
        osVersion: "120.0",
        details: { operatingSystem: "ChromeOS" },
      }),
    ).toBe("ChromeOS 120.0");
    expect(getManagedDeviceOperatingSystemLine({ platform: "ios" })).toBe(
      "iOS",
    );
    expect(getManagedDeviceOperatingSystemLine({ platform: "other" })).toBe("");
  });

  test("an iPad's card says what it runs, with no patch level and no Esper agent", async () => {
    const device: ManagedDevice = new ManagedDevice();
    device._id = DEVICE_ID;
    device.deviceName = "ESP-ID-IPAD1";
    device.platform = ManagedDevicePlatform.IPadOS;
    device.osVersion = "17.4.1";
    device.lastCheckInAt = new Date("2026-11-19T09:00:00.000Z");
    getJestSpyOn(ModelAPI, "getItem").mockResolvedValue(device);

    await act(async () => {
      render(
        <MemoryRouter>
          <ManagedDeviceCard managedDeviceId={new ObjectID(DEVICE_ID)} />
        </MemoryRouter>,
      );
    });

    expect(factOf("Operating System")).toMatch(/^iPadOS\s17\.4\.1$/);
    expect(screen.queryByText("Security Patch Level")).toBeNull();
    expect(screen.queryByText("Esper Agent")).toBeNull();
  });

  test("an Android device's card keeps its patch level and its Esper agent", async () => {
    const device: ManagedDevice = new ManagedDevice();
    device._id = DEVICE_ID;
    device.deviceName = "ESP-ID-AAAAW";
    device.osVersion = "13";
    device.securityPatchLevel = "2024-09-01";
    getJestSpyOn(ModelAPI, "getItem").mockResolvedValue(device);

    await act(async () => {
      render(
        <MemoryRouter>
          <ManagedDeviceCard managedDeviceId={new ObjectID(DEVICE_ID)} />
        </MemoryRouter>,
      );
    });

    expect(factOf("Operating System")).toMatch(/^Android\s13$/);
    expect(screen.getByText("Security Patch Level")).toBeInTheDocument();
    expect(screen.getByText("Esper Agent")).toBeInTheDocument();
  });

  test("an iPad seen three hours ago is online, how long ago said; an Android device is offline", () => {
    render(
      <div>
        <div data-testid="ipad">
          <ManagedDeviceStatusPill
            providerState={EsperDeviceState.Online}
            lastCheckInAt={new Date("2026-11-19T09:00:00.000Z")}
            provider={DeviceManagementProvider.Esper}
            platform={ManagedDevicePlatform.IPadOS}
            now={NOW}
            showAge={true}
          />
        </div>
        <div data-testid="kiosk">
          <ManagedDeviceStatusPill
            providerState={EsperDeviceState.Online}
            lastCheckInAt={new Date("2026-11-19T09:00:00.000Z")}
            provider={DeviceManagementProvider.Esper}
            platform={ManagedDevicePlatform.Android}
            now={NOW}
            showAge={true}
          />
        </div>
      </div>,
    );

    expect(
      within(screen.getByTestId("ipad")).getByTestId("managed-device-status"),
    ).toHaveAttribute("data-status", ManagedDeviceStatus.Online);
    expect(
      within(screen.getByTestId("ipad")).getByText("3h ago"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("kiosk")).getByTestId("managed-device-status"),
    ).toHaveAttribute("data-status", ManagedDeviceStatus.Offline);
  });
});

describe("a device's status chip", () => {
  test("says Offline after half an hour without a check-in, and how long ago", () => {
    render(
      <ManagedDeviceStatusPill
        providerState={EsperDeviceState.Online}
        lastCheckInAt={new Date("2026-11-19T09:00:00.000Z")}
        now={NOW}
        showAge={true}
      />,
    );

    expect(screen.getByTestId("managed-device-status")).toHaveAttribute(
      "data-status",
      ManagedDeviceStatus.Offline,
    );
    expect(screen.getByText("Offline")).toBeInTheDocument();
    expect(screen.getByText("3h ago")).toBeInTheDocument();
  });

  test("says Online within half an hour of a check-in", () => {
    render(
      <ManagedDeviceStatusPill
        providerState={EsperDeviceState.Offline}
        lastCheckInAt={new Date("2026-11-19T11:45:00.000Z")}
        now={NOW}
      />,
    );

    expect(screen.getByText("Online")).toBeInTheDocument();
    expect(screen.queryByText("15m ago")).not.toBeInTheDocument();
  });

  test("says Removed for a device Esper no longer has, with no age", () => {
    render(
      <ManagedDeviceStatusPill
        providerState={EsperDeviceState.Online}
        lastCheckInAt={new Date("2026-11-19T09:00:00.000Z")}
        removedAt={new Date("2026-11-19T10:00:00.000Z")}
        now={NOW}
        showAge={true}
      />,
    );

    expect(screen.getByText("Removed")).toBeInTheDocument();
    expect(screen.queryByText("3h ago")).not.toBeInTheDocument();
  });

  test("counts whole minutes since a check-in, and nothing without one", () => {
    expect(
      getMinutesSinceCheckIn(new Date("2026-11-19T11:30:30.000Z"), NOW),
    ).toBe(29);
    expect(getMinutesSinceCheckIn(undefined, NOW)).toBeNull();
    expect(getMinutesSinceCheckIn("not a date", NOW)).toBeNull();
  });
});

describe("the words", () => {
  test("a status is red only for what went wrong, and grey for what someone chose", () => {
    const tones: Record<string, PillTone> = {};

    for (const status of Object.values(ManagedDeviceStatus)) {
      tones[status] = getManagedDeviceStatusWords(status).tone;
    }

    expect(tones).toEqual({
      [ManagedDeviceStatus.Online]: PillTone.Success,
      [ManagedDeviceStatus.Offline]: PillTone.Danger,
      [ManagedDeviceStatus.Provisioning]: PillTone.Info,
      [ManagedDeviceStatus.OnboardingFailed]: PillTone.Danger,
      [ManagedDeviceStatus.Disabled]: PillTone.Paused,
      [ManagedDeviceStatus.Wiping]: PillTone.Paused,
      [ManagedDeviceStatus.Removed]: PillTone.Paused,
    });
  });

  test("a connection is red only when its read failed", () => {
    for (const status of Object.values(DeviceManagementConnectionStatus)) {
      expect({
        status,
        red: getDeviceManagementHealthWords(status).tone === PillTone.Danger,
      }).toEqual({
        status,
        red: status === DeviceManagementConnectionStatus.Failing,
      });
    }
  });

  test("every failure says what happened and what to do", () => {
    const kinds: Array<LlmConnectionFailureKind | undefined> = [
      ...Object.values(LlmConnectionFailureKind),
      undefined,
    ];

    for (const kind of kinds) {
      const words: { headline: string; advice?: string | undefined } =
        getDeviceManagementFailureWords(kind);

      expect(words.headline.length).toBeGreaterThan(0);
      expect(words.advice?.length || 0).toBeGreaterThan(0);
    }

    expect(
      getDeviceManagementFailureWords(LlmConnectionFailureKind.Authentication)
        .headline,
    ).toBe("Esper refused the API key.");
    expect(
      getDeviceManagementFailureWords(LlmConnectionFailureKind.RateLimited)
        .headline,
    ).toBe("Esper asked OneUptime to slow down.");
  });

  test("a failed test says OneUptime's words first, then Esper's answer", () => {
    expect(
      getTestFailureSentence(
        testResult({
          status: "fail",
          failureKind: LlmConnectionFailureKind.Authentication,
          message:
            "Esper answered 401: Authentication credentials were not provided.",
        }),
        english,
      ),
    ).toBe(
      "Esper refused the API key. Copy the key again from API Key Management in the Esper console, or make a new one. Esper answered 401: Authentication credentials were not provided.",
    );
  });

  test("a passed test says how many devices a read imports", () => {
    expect(
      getTestPassedSentence(
        testResult({ status: "pass", message: "", deviceCount: 1 }),
        english,
      ),
    ).toBe("Connected. 1 device to import.");
    expect(
      getTestPassedSentence(
        testResult({ status: "pass", message: "", deviceCount: 1250 }),
        english,
      ),
    ).toBe("Connected. 1,250 devices to import.");
    expect(
      getTestPassedSentence(
        testResult({ status: "pass", message: "" }),
        english,
      ),
    ).toBe("Connected.");
    expect(
      getDeviceManagementTestWords(testResult({ status: "pass", message: "" }))
        .headline,
    ).toBe(TEST_PASSED);
  });

  test("every interval a connection may be read at has its words", () => {
    for (const minutes of DEVICE_MANAGEMENT_READ_INTERVALS_IN_MINUTES) {
      expect({ minutes, words: Boolean(READ_INTERVAL_WORDS[minutes]) }).toEqual(
        { minutes, words: true },
      );
    }
  });

  test("a device's card says how its Inventory item was found", () => {
    expect(getManagedDeviceMatchWords(ManagedDeviceHostMatch.Name)).toBe(
      "Telemetry names it by its Esper name",
    );
    expect(getManagedDeviceMatchWords(ManagedDeviceHostMatch.Created)).toBe(
      "No telemetry from it yet",
    );
    expect(getManagedDeviceMatchWords(undefined)).toBeUndefined();
  });
});

/*
 * #10238's guard: the card read its connection's settings through the
 * device, a column the server will not read through a relation, so it
 * refused the whole read and every device's card said "Column config on
 * Device Management Connection does not support read on relation query."
 * The card reads the connection's name and service through the device, and
 * its settings - its address - from the connection itself.
 */
describe("a device's card names the connection that imports it", () => {
  const CONNECTION_ID: string = "30000000-0000-4000-8000-0000000000c1";

  function deviceOfConnection(): ManagedDevice {
    const device: ManagedDevice = new ManagedDevice();
    device._id = DEVICE_ID;
    device.deviceName = "ESP-ID-AAAAW";
    device.connectionId = new ObjectID(CONNECTION_ID);

    const connection: DeviceManagementConnection =
      new DeviceManagementConnection();
    connection.name = "Acme fleet";
    connection.provider = DeviceManagementProvider.Esper;
    device.connection = connection;

    return device;
  }

  async function renderConnectedCard(): Promise<void> {
    await act(async () => {
      render(
        <MemoryRouter>
          <ManagedDeviceCard managedDeviceId={new ObjectID(DEVICE_ID)} />
        </MemoryRouter>,
      );
    });
  }

  test("with its address, read from the connection, never through the device", async () => {
    const settings: DeviceManagementConnection =
      new DeviceManagementConnection();
    settings.config = { tenant: "acme", readIntervalInMinutes: 15 };

    const getItem: jest.SpyInstance<any, any> = getJestSpyOn(
      ModelAPI,
      "getItem",
    ).mockImplementation((async (args: {
      modelType: unknown;
    }): Promise<unknown> => {
      return args.modelType === ManagedDevice ? deviceOfConnection() : settings;
    }) as never);

    await renderConnectedCard();

    expect(
      screen.getByText(
        "Imported by the Esper connection Acme fleet (acme.esper.cloud).",
      ),
    ).toBeInTheDocument();

    const reads: Array<{
      modelType: unknown;
      id: ObjectID;
      select: Record<string, unknown>;
    }> = getItem.mock.calls.map((call: Array<unknown>) => {
      return call[0] as {
        modelType: unknown;
        id: ObjectID;
        select: Record<string, unknown>;
      };
    });

    // The device's read names nothing of the connection a relation does not read.
    expect(reads[0]!.modelType).toBe(ManagedDevice);
    expect(reads[0]!.select["connection"]).toEqual({
      name: true,
      provider: true,
    });
    expect(reads[1]!.modelType).toBe(DeviceManagementConnection);
    expect(reads[1]!.id.toString()).toBe(CONNECTION_ID);
    expect(reads[1]!.select).toEqual({ _id: true, config: true });
  });

  test("without its address when the connection's settings cannot be read, and the rest of the card", async () => {
    getJestSpyOn(ModelAPI, "getItem").mockImplementation((async (args: {
      modelType: unknown;
    }): Promise<unknown> => {
      if (args.modelType === ManagedDevice) {
        return deviceOfConnection();
      }

      throw new Error(
        "You do not have permissions to read Device Management Connection.",
      );
    }) as never);

    await renderConnectedCard();

    expect(
      screen.getByText("Imported by the Esper connection Acme fleet."),
    ).toBeInTheDocument();
    expect(screen.getByText("Esper Agent")).toBeInTheDocument();
    expect(
      screen.queryByText(/does not support read on relation query/),
    ).toBeNull();
  });
});
