import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import * as React from "react";
import { initReactI18next } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import DeviceMonitorsCard from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceMonitorsCard";
import { UntiedMonitorsListing } from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceMonitorLookupUtil";
import { getNetworkDeviceRoute } from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceNameLink";
import {
  UNTIED_MONITORS_COPY,
  getUntiedMonitorReason,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceUntiedMonitors";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import { AmbiguousAddressReason } from "../../../Utils/NetworkDevice/DeviceAddressScope";
import {
  UntiedDeviceMonitor,
  UntiedMonitorMatch,
} from "../../../Utils/NetworkDevice/UntiedDeviceMonitor";

/*
 * THE MONITORS ON A DEVICE'S ADDRESS THAT ARE TIED TO NO DEVICE, on its
 * Monitors card (OneUptime issue #9903), RENDERED.
 *
 * Branch A and branch B each have a router at 10.0.0.5. On branch A's
 * router's card, under its own monitors: a Ping monitor on branch A's probe
 * is offered Add, which ties it in one click; one on probes that poll both
 * routers says why it is not tied and names branch B's router, with no
 * one-click add; one on a probe that is no site's says OneUptime cannot
 * tell whether it reaches the router. The listing is as the device's page
 * hands it (DeviceMonitorLookupUtil.listUntiedMonitors).
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000009903";
const DEVICE_ID: string = "40000000-0000-4000-8000-00000000000a";
const BRANCH_B_ROUTER: string = "40000000-0000-4000-8000-00000000000b";

const BRANCH_A_PING: UntiedDeviceMonitor = {
  monitorId: "90000000-0000-4000-8000-000000000001",
  name: "Branch A ping",
  monitorType: "Ping",
  match: UntiedMonitorMatch.ThisDevice,
};

const SECOND_BRANCH_A_PING: UntiedDeviceMonitor = {
  monitorId: "90000000-0000-4000-8000-000000000002",
  name: "Branch A port 443",
  monitorType: "Port",
  match: UntiedMonitorMatch.ThisDevice,
};

const BOTH_BRANCHES_PING: UntiedDeviceMonitor = {
  monitorId: "90000000-0000-4000-8000-000000000003",
  name: "Both branches ping",
  monitorType: "Ping",
  match: UntiedMonitorMatch.CannotTellApart,
  ambiguousReason: AmbiguousAddressReason.PollSeveral,
  otherDeviceIds: [BRANCH_B_ROUTER],
};

const UNPLACED_PROBE_PING: UntiedDeviceMonitor = {
  monitorId: "90000000-0000-4000-8000-000000000004",
  name: "Cloud probe ping",
  monitorType: "Ping",
  match: UntiedMonitorMatch.ProbesInNoSite,
};

const DEVICE_NAMES: ReadonlyMap<string, string> = new Map<string, string>([
  [BRANCH_B_ROUTER, "Branch B router"],
]);

function listing(
  monitors: Array<UntiedDeviceMonitor>,
  hasMore: boolean = false,
): UntiedMonitorsListing {
  return { monitors: monitors, hasMore: hasMore, deviceNames: DEVICE_NAMES };
}

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        return mockProjectObjectId;
      },
    },
  };
});

// Handed out by the Project mock; below the imports so ObjectID exists.
const mockProjectObjectId: ObjectID = new ObjectID(PROJECT_ID);

const LOCALES: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(language: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: readLocale("en") },
      de: { translation: readLocale("de") },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(async () => {
  cleanup();
  jest.restoreAllMocks();
  await act(async () => {
    await i18next.changeLanguage("en");
  });
});

function grant(permissions: Array<Permission>): void {
  jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue(permissions);
}

function renderCard(data: {
  untied: UntiedMonitorsListing;
  monitors?: Array<Monitor>;
  onMonitorAdded?: (() => void) | undefined;
  isLoading?: boolean;
  error?: string;
}): void {
  render(
    <MemoryRouter>
      <DeviceMonitorsCard
        monitors={data.monitors || []}
        isLoading={data.isLoading || false}
        error={data.error || ""}
        networkDeviceId={DEVICE_ID}
        isMonitorBacked={false}
        canCreateMonitor={true}
        onMonitorAdded={data.onMonitorAdded}
        untiedMonitors={data.untied}
      />
    </MemoryRouter>,
  );
}

function rowOf(monitor: UntiedDeviceMonitor): HTMLElement {
  return screen.getByTestId(`device-untied-monitor-${monitor.monitorId}`);
}

function addButton(monitor: UntiedDeviceMonitor): HTMLElement | null {
  return screen.queryByRole("button", {
    name: `Add ${monitor.name} to this device`,
  });
}

describe("the monitors on the device's address tied to no device", () => {
  test("are not drawn when there are none", () => {
    grant([Permission.ProjectOwner]);
    renderCard({ untied: listing([]), onMonitorAdded: jest.fn() });

    expect(screen.queryByTestId("device-untied-monitors")).toBeNull();
  });

  test("a muted line counts them, in the form the count takes", () => {
    grant([Permission.ProjectOwner]);
    renderCard({ untied: listing([BRANCH_A_PING]), onMonitorAdded: jest.fn() });

    expect(screen.getByTestId("device-untied-monitors")).toHaveTextContent(
      "1 monitor checks this device's address but is not tied to it.",
    );

    cleanup();
    renderCard({
      untied: listing([BRANCH_A_PING, BOTH_BRANCHES_PING]),
      onMonitorAdded: jest.fn(),
    });

    expect(screen.getByTestId("device-untied-monitors")).toHaveTextContent(
      "2 monitors check this device's address but are not tied to it.",
    );
  });

  test("are drawn under the device's empty state too, and never while the card loads or failed to", () => {
    grant([Permission.ProjectOwner]);
    renderCard({ untied: listing([BRANCH_A_PING]), onMonitorAdded: jest.fn() });

    expect(
      screen.getByText(/Nothing alerts on this device yet/),
    ).toBeInTheDocument();
    expect(screen.getByTestId("device-untied-monitors")).toBeInTheDocument();

    cleanup();
    renderCard({
      untied: listing([BRANCH_A_PING]),
      onMonitorAdded: jest.fn(),
      isLoading: true,
    });
    expect(screen.queryByTestId("device-untied-monitors")).toBeNull();

    cleanup();
    renderCard({
      untied: listing([BRANCH_A_PING]),
      onMonitorAdded: jest.fn(),
      error: "The monitors could not be read.",
    });
    expect(screen.queryByTestId("device-untied-monitors")).toBeNull();
  });

  test("one whose probes see this device is added in one click - its Network Device alone - and the page reads its monitors again", async () => {
    grant([Permission.ProjectOwner]);
    const updateById: ReturnType<typeof jest.spyOn> = jest
      .spyOn(ModelAPI, "updateById")
      .mockResolvedValue({} as never);
    const onMonitorAdded: Mock<() => void> = jest.fn<() => void>();

    renderCard({ untied: listing([BRANCH_A_PING]), onMonitorAdded });

    // Named for a screen reader; nothing else on the row explains it.
    expect(within(rowOf(BRANCH_A_PING)).queryByText(/OneUptime/)).toBeNull();

    await act(async () => {
      fireEvent.click(addButton(BRANCH_A_PING)!);
    });

    expect(updateById).toHaveBeenCalledTimes(1);
    const update: {
      modelType: unknown;
      id: ObjectID;
      data: Record<string, unknown>;
    } = updateById.mock.calls[0]![0] as {
      modelType: unknown;
      id: ObjectID;
      data: Record<string, unknown>;
    };
    expect(update.modelType).toBe(Monitor);
    expect(update.id.toString()).toBe(BRANCH_A_PING.monitorId);
    expect(Object.keys(update.data)).toEqual(["networkDeviceId"]);
    expect(String(update.data["networkDeviceId"])).toBe(DEVICE_ID);
    expect(onMonitorAdded).toHaveBeenCalledTimes(1);
  });

  test("while one is added, no other Add can be pressed", async () => {
    grant([Permission.ProjectOwner]);
    jest
      .spyOn(ModelAPI, "updateById")
      .mockReturnValue(new Promise<never>(() => {}) as never);

    renderCard({
      untied: listing([BRANCH_A_PING, SECOND_BRANCH_A_PING]),
      onMonitorAdded: jest.fn(),
    });

    await act(async () => {
      fireEvent.click(addButton(BRANCH_A_PING)!);
    });

    expect(addButton(SECOND_BRANCH_A_PING)).toBeDisabled();
  });

  test("an add the server refuses is said under its row, and nothing is read again", async () => {
    grant([Permission.ProjectOwner]);
    jest
      .spyOn(ModelAPI, "updateById")
      .mockRejectedValue(
        new Error(
          "An import, an auto import rule or an alert policy made this monitor for its network device, so it is that device's already. Its Network Device cannot be changed.",
        ),
      );
    const onMonitorAdded: Mock<() => void> = jest.fn<() => void>();

    renderCard({
      untied: listing([BRANCH_A_PING, SECOND_BRANCH_A_PING]),
      onMonitorAdded,
    });

    await act(async () => {
      fireEvent.click(addButton(BRANCH_A_PING)!);
    });

    expect(
      within(rowOf(BRANCH_A_PING)).getByTestId(
        `device-untied-monitor-error-${BRANCH_A_PING.monitorId}`,
      ),
    ).toHaveTextContent("Its Network Device cannot be changed.");
    expect(
      screen.queryByTestId(
        `device-untied-monitor-error-${SECOND_BRANCH_A_PING.monitorId}`,
      ),
    ).toBeNull();
    expect(onMonitorAdded).not.toHaveBeenCalled();
    // Pressable again.
    expect(addButton(BRANCH_A_PING)).not.toBeDisabled();
  });

  test("one whose probes cannot tell this device from another says why, names the other with a link, and is not added in one click", () => {
    grant([Permission.ProjectOwner]);
    renderCard({
      untied: listing([BOTH_BRANCHES_PING]),
      onMonitorAdded: jest.fn(),
    });

    const row: HTMLElement = rowOf(BOTH_BRANCHES_PING);

    expect(row).toHaveTextContent(
      "Its probes poll more than one device at this address, so OneUptime cannot tell which one it checks. If it checks this device, add it with Add Existing Monitor.",
    );
    expect(
      within(row).getByTestId(
        `device-untied-monitor-others-${BOTH_BRANCHES_PING.monitorId}`,
      ),
    ).toHaveTextContent("Also at this address: Branch B router");
    expect(
      within(row).getByRole("link", { name: "Branch B router" }),
    ).toHaveAttribute(
      "href",
      getNetworkDeviceRoute(BRANCH_B_ROUTER).toString(),
    );
    expect(within(row).queryByRole("button")).toBeNull();
  });

  test("another device the reader may not read is not named", () => {
    grant([Permission.ProjectOwner]);
    renderCard({
      untied: {
        monitors: [BOTH_BRANCHES_PING],
        hasMore: false,
        deviceNames: new Map<string, string>(),
      },
      onMonitorAdded: jest.fn(),
    });

    expect(rowOf(BOTH_BRANCHES_PING)).toHaveTextContent(
      "OneUptime cannot tell which one it checks.",
    );
    expect(
      screen.queryByTestId(
        `device-untied-monitor-others-${BOTH_BRANCHES_PING.monitorId}`,
      ),
    ).toBeNull();
  });

  test("one on a probe that is no site's says OneUptime cannot tell whether it reaches this device, and is not added in one click", () => {
    grant([Permission.ProjectOwner]);
    renderCard({
      untied: listing([UNPLACED_PROBE_PING]),
      onMonitorAdded: jest.fn(),
    });

    const row: HTMLElement = rowOf(UNPLACED_PROBE_PING);

    expect(row).toHaveTextContent(
      "Its probes poll no device and are no site's default probe, so OneUptime cannot tell whether they reach this device. If it checks this device, add it with Add Existing Monitor.",
    );
    expect(within(row).queryByRole("button")).toBeNull();
  });

  test("a reader who may not tie monitors to devices reads why, with no Add and no advice to add", () => {
    grant([Permission.Viewer]);
    renderCard({
      untied: listing([BRANCH_A_PING, BOTH_BRANCHES_PING]),
      onMonitorAdded: jest.fn(),
    });

    expect(addButton(BRANCH_A_PING)).toBeNull();
    expect(rowOf(BOTH_BRANCHES_PING)).toHaveTextContent(
      "OneUptime cannot tell which one it checks.",
    );
    expect(rowOf(BOTH_BRANCHES_PING)).not.toHaveTextContent(
      "Add Existing Monitor",
    );
  });

  test("a page that reads nothing again offers no Add", () => {
    grant([Permission.ProjectOwner]);
    renderCard({ untied: listing([BRANCH_A_PING]) });

    expect(addButton(BRANCH_A_PING)).toBeNull();
  });

  test("says when more monitors may check the address than are listed", () => {
    grant([Permission.ProjectOwner]);
    renderCard({
      untied: listing([BRANCH_A_PING], true),
      onMonitorAdded: jest.fn(),
    });

    expect(screen.getByTestId("device-untied-monitors")).toHaveTextContent(
      "More monitors may check this address than are listed.",
    );
  });

  test("in German, the count and why read in German", async () => {
    grant([Permission.ProjectOwner]);
    await act(async () => {
      await i18next.changeLanguage("de");
    });

    renderCard({
      untied: listing([BOTH_BRANCHES_PING]),
      onMonitorAdded: jest.fn(),
    });

    const section: HTMLElement = screen.getByTestId("device-untied-monitors");

    expect(section).toHaveTextContent(
      "1 Monitor prüft die Adresse dieses Geräts, ist ihm aber nicht zugeordnet.",
    );
    expect(section).toHaveTextContent(
      "Seine Sonden fragen mehr als ein Gerät an dieser Adresse ab, daher kann OneUptime nicht erkennen, welches er prüft.",
    );
    expect(section).toHaveTextContent(
      "Ebenfalls an dieser Adresse: Branch B router",
    );
  });
});

describe("both device pages", () => {
  test("hand the card the untied monitors their context read, and read them again after an add", () => {
    for (const page of ["Index.tsx", "Monitors.tsx"]) {
      const source: string = fs
        .readFileSync(
          path.join(
            __dirname,
            "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/View",
            page,
          ),
          "utf-8",
        )
        .replace(/\s+/g, " ");

      expect(source).toContain("untiedMonitors={untiedMonitors}");
      expect(source).toContain("setUntiedMonitors(context.untiedMonitors);");
      expect(source).toContain("onMonitorAdded={readMonitorsAgain}");
    }
  });
});

describe("why a monitor is not tied, in words", () => {
  test("each reason its probes cannot tell has its own sentence, and a monitor they place says none", () => {
    expect(getUntiedMonitorReason(BRANCH_A_PING)).toBe("");
    expect(getUntiedMonitorReason(UNPLACED_PROBE_PING)).toBe(
      UNTIED_MONITORS_COPY.probesInNoSite,
    );
    expect(
      [
        AmbiguousAddressReason.PollSeveral,
        AmbiguousAddressReason.SeveralInTheirSites,
        AmbiguousAddressReason.ReachUnknown,
      ].map((reason: AmbiguousAddressReason): string => {
        return getUntiedMonitorReason({
          ...BOTH_BRANCHES_PING,
          ambiguousReason: reason,
        });
      }),
    ).toEqual([
      UNTIED_MONITORS_COPY.pollsSeveral,
      UNTIED_MONITORS_COPY.severalInSites,
      UNTIED_MONITORS_COPY.reachUnknown,
    ]);
  });
});
