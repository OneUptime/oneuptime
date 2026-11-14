import "@testing-library/jest-dom";
import {
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
  within,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import type { Mock } from "jest-mock";

/*
 * THE NETWORK MAP'S DEVICE DRAWER SAYS WHY A DEVICE READS "UNKNOWN"
 * (issue #7346), RENDERED.
 *
 * A monitor-backed device whose bound monitor is turned off or archived has
 * no status, so the map draws it "unknown". The device's own pages put the
 * gray "Monitoring off" or "Monitor archived" pill beside its Pending, say
 * what that means, and offer the ways out (Turn monitoring on, Open
 * monitor). The map's drawer said "Unknown" and nothing else - the one
 * surface an operator opens from the map. Its device node now carries the
 * reason (NetworkTopologyNode.monitorNotChecked), and the drawer draws the
 * device pages' pill, caption and ways out from it - in the reader's
 * language - and nothing at all for a device whose monitor is checked.
 */

// What the next save does: by default the server takes it.
let answerUpdateById: () => Promise<unknown> = (): Promise<unknown> => {
  return Promise.resolve({});
};
let updateByIdRequests: Array<{
  modelType: unknown;
  id: { toString: () => string };
  data: Record<string, unknown>;
}> = [];

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      updateById: (request: {
        modelType: unknown;
        id: { toString: () => string };
        data: Record<string, unknown>;
      }): Promise<unknown> => {
        updateByIdRequests.push(request);
        return answerUpdateById();
      },
      getItem: (): Promise<unknown> => {
        return Promise.resolve(null);
      },
      getList: (): Promise<unknown> => {
        return Promise.resolve({ data: [], count: 0 });
      },
    },
  };
});

import {
  NetworkTopologyEdge,
  NetworkTopologyNode,
} from "../../../Types/Monitor/SnmpMonitor/NetworkTopology";
import MonitorNotCheckedReason from "../../../Types/Monitor/MonitorNotCheckedReason";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import { getJestSpyOn } from "../../Spy";
import NetworkDeviceDetailPanel, {
  MONITOR_NOT_CHECKED_CAPTION_TEST_ID,
  MONITOR_NOT_CHECKED_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/NetworkDeviceDetailPanel";
import {
  MONITOR_ARCHIVED_QUALIFIER,
  MONITORING_OFF_QUALIFIER,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceStatusUtil";
import { TURN_MONITORING_ON_BUTTON_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitoringSwitchCopy";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const EN: Record<string, string> = readLocale("en");
const DE: Record<string, string> = readLocale("de");
const AR: Record<string, string> = readLocale("ar");

// The locale's own words for `key`, which must differ from the English.
function worded(locale: Record<string, string>, key: string): string {
  const text: string | undefined = locale[key];

  expect({ key, translated: Boolean(text) && text !== EN[key] }).toEqual({
    key,
    translated: true,
  });

  return text as string;
}

const MONITOR_ID: string = "77777777-7777-4777-8777-777777777777";
const OTHER_MONITOR_ID: string = "88888888-8888-4888-8888-888888888888";

function monitorHref(monitorId: string): string {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.MONITOR_VIEW] as Route,
    { modelId: new ObjectID(monitorId) },
  ).toString();
}

function deviceNode(
  overrides?: Partial<NetworkTopologyNode>,
): NetworkTopologyNode {
  return {
    id: "ap-1",
    name: "branch-ap-01",
    isManaged: true,
    kind: "device",
    role: "wirelessAccessPoint",
    status: "unknown",
    ...overrides,
  };
}

function notChecked(
  reason: MonitorNotCheckedReason,
  monitorId: string = MONITOR_ID,
): Partial<NetworkTopologyNode> {
  return { monitorNotChecked: { monitorId, reason } };
}

const TURNED_OFF: NetworkTopologyNode = deviceNode(
  notChecked(MonitorNotCheckedReason.MonitoringOff),
);
const ARCHIVED: NetworkTopologyNode = deviceNode(
  notChecked(MonitorNotCheckedReason.MonitorArchived),
);

function panel(
  node: NetworkTopologyNode,
  readMapAgain?: (() => Promise<void>) | undefined,
): React.ReactElement {
  const edges: Array<NetworkTopologyEdge> = [];

  return (
    <MemoryRouter>
      <NetworkDeviceDetailPanel
        node={node}
        edges={edges}
        nodeById={new Map<string, NetworkTopologyNode>([[node.id, node]])}
        onClose={() => {}}
        onSelectEdge={() => {}}
        onHideNode={() => {}}
        readMapAgain={readMapAgain}
      />
    </MemoryRouter>
  );
}

// Every pill in the drawer's status row, in DOM order.
function statusRowPills(): Array<string> {
  const status: HTMLElement = screen.getByTestId(
    "network-topology-device-status",
  );
  const row: HTMLElement = status.parentElement as HTMLElement;

  return Array.from(
    row.querySelectorAll<HTMLElement>('[data-testid="pill"]'),
  ).map((pill: HTMLElement): string => {
    return (pill.textContent || "").trim();
  });
}

function pillNamed(text: string): HTMLElement {
  const pill: HTMLElement | undefined = Array.from(
    document.querySelectorAll<HTMLElement>('[data-testid="pill"]'),
  ).find((candidate: HTMLElement): boolean => {
    return (candidate.textContent || "").trim() === text;
  });

  if (!pill) {
    throw new Error(`No pill reading "${text}" was rendered.`);
  }

  return pill;
}

function tooltipsAfterHovering(text: string): Array<string> {
  fireEvent.mouseEnter(pillNamed(text));

  return screen.getAllByRole("tooltip").map((tooltip: HTMLElement): string => {
    return tooltip.textContent || "";
  });
}

function linkHref(text: string): string {
  const anchor: HTMLAnchorElement | null = screen.getByText(text).closest("a");

  expect(anchor).not.toBeNull();

  return anchor!.getAttribute("href") || "";
}

// Lets every promise the last event started settle, as the browser would.
async function settle(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 5; i++) {
      await Promise.resolve();
    }
  });
}

// Whether the reader may turn a monitor's monitoring on (its column's gate).
let columnGate: PermissionGateResult = { isAllowed: true };

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      de: { translation: DE },
      ar: { translation: AR },
      en: { translation: EN },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(async () => {
  await i18next.changeLanguage("en");
  updateByIdRequests = [];
  answerUpdateById = (): Promise<unknown> => {
    return Promise.resolve({});
  };
  columnGate = { isAllowed: true };
  getJestSpyOn(PermissionGate, "checkColumnUpdate").mockImplementation(
    (): PermissionGateResult => {
      return columnGate;
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the Network Map's device drawer, for a device whose bound monitor nothing checks", () => {
  test("monitoring off: Unknown with the gray Monitoring off pill beside it, in the status row", () => {
    render(panel(TURNED_OFF));

    expect(
      screen.getByTestId("network-topology-device-status").textContent,
    ).toBe("Unknown");
    expect(statusRowPills()).toEqual([MONITORING_OFF_QUALIFIER.text]);
    expect(MONITORING_OFF_QUALIFIER.text).toBe("Monitoring off");
  });

  test("monitoring off: the pill's tooltip is the device pages' why and what to do", () => {
    render(panel(TURNED_OFF));

    expect(tooltipsAfterHovering("Monitoring off")).toContain(
      MONITORING_OFF_QUALIFIER.tooltip,
    );
  });

  test("monitoring off: says the status waits for monitoring, and offers Turn monitoring on and Open monitor", () => {
    render(panel(TURNED_OFF));

    const line: HTMLElement = screen.getByTestId(MONITOR_NOT_CHECKED_TEST_ID);
    expect(
      within(line).getByTestId(MONITOR_NOT_CHECKED_CAPTION_TEST_ID).textContent,
    ).toBe("Not checked until monitoring is back on");

    const button: HTMLElement = screen.getByRole("button", {
      name: "Turn monitoring on",
    });
    expect(line).toContainElement(button);
    expect(button).toBe(screen.getByTestId(TURN_MONITORING_ON_BUTTON_TEST_ID));
    expect(button).toBeEnabled();

    expect(line).toContainElement(screen.getByText("Open monitor"));
    expect(linkHref("Open monitor")).toBe(monitorHref(MONITOR_ID));
  });

  test("archived: the gray Monitor archived pill, its tooltip, and only Open monitor - unarchiving is done on the monitor", () => {
    render(panel(ARCHIVED));

    expect(statusRowPills()).toEqual([MONITOR_ARCHIVED_QUALIFIER.text]);
    expect(MONITOR_ARCHIVED_QUALIFIER.text).toBe("Monitor archived");
    expect(tooltipsAfterHovering("Monitor archived")).toContain(
      MONITOR_ARCHIVED_QUALIFIER.tooltip,
    );

    expect(
      screen.getByTestId(MONITOR_NOT_CHECKED_CAPTION_TEST_ID).textContent,
    ).toBe("Not checked until its monitor is unarchived");
    expect(screen.queryByTestId(TURN_MONITORING_ON_BUTTON_TEST_ID)).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Turn monitoring on" }),
    ).toBeNull();
    expect(linkHref("Open monitor")).toBe(monitorHref(MONITOR_ID));
  });

  test("Open monitor opens the device's own monitor, whichever that is", () => {
    render(
      panel(
        deviceNode(
          notChecked(MonitorNotCheckedReason.MonitoringOff, OTHER_MONITOR_ID),
        ),
      ),
    );

    expect(linkHref("Open monitor")).toBe(monitorHref(OTHER_MONITOR_ID));
  });

  test("Hide from map is still in the status row, after the pill", () => {
    render(panel(TURNED_OFF));

    const row: HTMLElement = screen.getByTestId(
      "network-topology-device-status",
    ).parentElement as HTMLElement;
    const hide: HTMLElement = screen.getByTestId("network-topology-hide-node");
    expect(row).toContainElement(hide);
    expect(
      pillNamed("Monitoring off").compareDocumentPosition(hide) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // A long qualifier wraps on a narrow drawer rather than pushing it out.
    expect(row).toHaveClass("flex-wrap");
  });
});

describe("Turn monitoring on, in the drawer", () => {
  test("a press turns the device's monitor on and reads the map again, busy until the read is in", async () => {
    let finishRead: () => void = (): void => {};
    const readMapAgain: Mock<() => Promise<void>> = jest.fn(
      (): Promise<void> => {
        return new Promise<void>((resolve: () => void) => {
          finishRead = resolve;
        });
      },
    );

    render(panel(TURNED_OFF, readMapAgain));

    fireEvent.click(screen.getByTestId(TURN_MONITORING_ON_BUTTON_TEST_ID));
    await settle();

    // Exactly what the Monitoring switch writes, to the device's monitor.
    expect(updateByIdRequests).toHaveLength(1);
    expect(updateByIdRequests[0]!.modelType).toBe(Monitor);
    expect(updateByIdRequests[0]!.id.toString()).toBe(MONITOR_ID);
    expect(updateByIdRequests[0]!.data).toEqual({
      disableActiveMonitoring: false,
    });

    // Saved: the map is read again, and stays busy until it is in.
    expect(readMapAgain).toHaveBeenCalledTimes(1);
    expect(
      screen.getByTestId(TURN_MONITORING_ON_BUTTON_TEST_ID),
    ).toBeDisabled();

    await act(async () => {
      finishRead();
    });
    await settle();

    expect(screen.getByTestId(TURN_MONITORING_ON_BUTTON_TEST_ID)).toBeEnabled();
  });

  test("a save the server refuses says why, and reads nothing again", async () => {
    answerUpdateById = (): Promise<unknown> => {
      return Promise.reject(
        new Error("You do not have permission to update this Monitor."),
      );
    };
    const readMapAgain: Mock<() => Promise<void>> = jest.fn(
      (): Promise<void> => {
        return Promise.resolve();
      },
    );

    render(panel(TURNED_OFF, readMapAgain));

    fireEvent.click(screen.getByTestId(TURN_MONITORING_ON_BUTTON_TEST_ID));
    await settle();

    const alert: HTMLElement = screen.getByRole("alert");
    expect(alert).toHaveTextContent(
      "You do not have permission to update this Monitor.",
    );
    expect(screen.getByTestId(MONITOR_NOT_CHECKED_TEST_ID)).toContainElement(
      alert,
    );
    expect(readMapAgain).not.toHaveBeenCalled();
  });

  test("a drawer given no way to read the map again still saves", async () => {
    render(panel(TURNED_OFF));

    fireEvent.click(screen.getByTestId(TURN_MONITORING_ON_BUTTON_TEST_ID));
    await settle();

    expect(updateByIdRequests).toHaveLength(1);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByTestId(TURN_MONITORING_ON_BUTTON_TEST_ID)).toBeEnabled();
  });

  test("someone who may not turn monitoring on sees it locked, and a press writes nothing", async () => {
    columnGate = {
      isAllowed: false,
      disabledReason:
        "You do not have permission to update this Monitor. You need one of these permissions: Project Owner.",
    };

    render(panel(TURNED_OFF));

    const button: HTMLElement = screen.getByTestId(
      TURN_MONITORING_ON_BUTTON_TEST_ID,
    );
    expect(button).toBeDisabled();
    fireEvent.click(button);
    await settle();

    expect(updateByIdRequests).toHaveLength(0);
    expect(linkHref("Open monitor")).toBe(monitorHref(MONITOR_ID));
  });

  test("the next device's drawer offers the next device's monitor", () => {
    const { rerender } = render(panel(TURNED_OFF));
    expect(linkHref("Open monitor")).toBe(monitorHref(MONITOR_ID));

    rerender(
      panel(
        deviceNode({
          id: "ap-2",
          name: "branch-ap-02",
          ...notChecked(
            MonitorNotCheckedReason.MonitorArchived,
            OTHER_MONITOR_ID,
          ),
        }),
      ),
    );

    expect(linkHref("Open monitor")).toBe(monitorHref(OTHER_MONITOR_ID));
    expect(statusRowPills()).toEqual(["Monitor archived"]);
    expect(screen.queryByTestId(TURN_MONITORING_ON_BUTTON_TEST_ID)).toBeNull();
  });
});

describe("nothing for a device whose monitor is checked", () => {
  function expectNothing(): void {
    expect(statusRowPills()).toEqual([]);
    expect(screen.queryByTestId(MONITOR_NOT_CHECKED_TEST_ID)).toBeNull();
    expect(screen.queryByText("Monitoring off")).toBeNull();
    expect(screen.queryByText("Monitor archived")).toBeNull();
    expect(screen.queryByText("Open monitor")).toBeNull();
    expect(screen.queryByTestId(TURN_MONITORING_ON_BUTTON_TEST_ID)).toBeNull();
  }

  test("a checked device - its node carries no reason - reads its status alone", () => {
    render(panel(deviceNode({ status: "up" })));

    expect(
      screen.getByTestId("network-topology-device-status").textContent,
    ).toBe("Up");
    expectNothing();
  });

  test("an unknown device with no reason (never polled, say) reads Unknown alone", () => {
    render(panel(deviceNode()));

    expect(
      screen.getByTestId("network-topology-device-status").textContent,
    ).toBe("Unknown");
    expectNothing();
  });

  /*
   * A node still drawn with a status - stamped before its monitor was
   * turned off - shows that status, with nothing claiming it has none.
   */
  test("a device still drawn down beside a reason shows its status alone", () => {
    render(
      panel(
        deviceNode({
          status: "down",
          ...notChecked(MonitorNotCheckedReason.MonitoringOff),
        }),
      ),
    );

    expectNothing();
  });

  test("a reason this Dashboard does not know says nothing, rather than a guess", () => {
    render(
      panel(
        deviceNode({
          monitorNotChecked: {
            monitorId: MONITOR_ID,
            reason: "monitorDeleted" as MonitorNotCheckedReason,
          },
        }),
      ),
    );

    expectNothing();
  });
});

describe("in the reader's language", () => {
  test.each([
    ["de", DE],
    ["ar", AR],
  ])(
    "%s: the pill, its caption and the ways out are the locale's words",
    async (language: string, locale: Record<string, string>) => {
      await i18next.changeLanguage(language);
      render(panel(TURNED_OFF));

      expect(statusRowPills()).toEqual([worded(locale, "Monitoring off")]);
      expect(screen.queryByText("Monitoring off")).toBeNull();
      expect(
        screen.getByTestId(MONITOR_NOT_CHECKED_CAPTION_TEST_ID).textContent,
      ).toBe(worded(locale, "Not checked until monitoring is back on"));
      expect(
        screen.getByRole("button", {
          name: worded(locale, "Turn monitoring on"),
        }),
      ).toBeInTheDocument();
      expect(linkHref(worded(locale, "Open monitor"))).toBe(
        monitorHref(MONITOR_ID),
      );
      expect(tooltipsAfterHovering(worded(locale, "Monitoring off"))).toContain(
        worded(locale, MONITORING_OFF_QUALIFIER.tooltip),
      );
    },
  );

  test.each([
    ["de", DE],
    ["ar", AR],
  ])(
    "%s: archived reads the locale's Monitor archived and its caption",
    async (language: string, locale: Record<string, string>) => {
      await i18next.changeLanguage(language);
      render(panel(ARCHIVED));

      expect(statusRowPills()).toEqual([worded(locale, "Monitor archived")]);
      expect(
        screen.getByTestId(MONITOR_NOT_CHECKED_CAPTION_TEST_ID).textContent,
      ).toBe(worded(locale, "Not checked until its monitor is unarchived"));
    },
  );
});
