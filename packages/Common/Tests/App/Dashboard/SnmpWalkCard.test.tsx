import "@testing-library/jest-dom";
import {
  afterEach,
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
import * as React from "react";
import SnmpWalkCard from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/SnmpWalkCard";
import {
  SNMP_WALK_MAX_CONSECUTIVE_POLL_FAILURES,
  SNMP_WALK_MAX_POLL_ATTEMPTS,
  SNMP_WALK_POLL_INTERVAL_IN_MS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/SnmpWalkViewModel";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceDiagnostic from "../../../Models/DatabaseModels/NetworkDeviceDiagnostic";
import NetworkDeviceOidTemplate from "../../../Models/DatabaseModels/NetworkDeviceOidTemplate";
import Probe from "../../../Models/DatabaseModels/Probe";
import SnmpDataType from "../../../Types/Monitor/SnmpMonitor/SnmpDataType";
import SnmpOid from "../../../Types/Monitor/SnmpMonitor/SnmpOid";
import {
  NetworkDeviceDiagnosticSnmpWalkResult,
  SnmpWalkAuthenticationReason,
  SnmpWalkFailureKind,
  SnmpWalkRow,
  SnmpWalkStopReason,
} from "../../../Types/NetworkDevice/NetworkDeviceSnmpWalk";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #5184, from the page: a device's SNMP Walk. The walk is a
 * diagnostic row the page creates and reads back until the probe has
 * written what it read, so everything a person sees - the form, the wait,
 * the rows, what a failure means, collecting an OID, the walk continued
 * page by page, the last walk after a reload - is driven here through the
 * same `modelAPI` seam DeviceDiagnostics uses, with fake timers for the
 * polling.
 */

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (error: Error) => {
        return error.message;
      },
    },
  };
});

const DEVICE_ID: string = "11111111-1111-4111-8111-111111111111";
const WALK_ID: string = "22222222-2222-4222-8222-222222222222";
const OLD_WALK_ID: string = "33333333-3333-4333-8333-333333333333";
const PROBE_ID: string = "44444444-4444-4444-8444-444444444444";
const TEMPLATE_ID: string = "55555555-5555-4555-8555-555555555555";

const getDeviceMock: MockFunction = getJestMockFunction();
const getWalkMock: MockFunction = getJestMockFunction();
const getTemplateMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const createMock: MockFunction = getJestMockFunction();
const updateMock: MockFunction = getJestMockFunction();

interface GetItemRequest {
  modelType: unknown;
  id: ObjectID;
  select: Record<string, unknown>;
}

const fakeModelAPI: typeof ModelAPI = {
  getItem: (request: GetItemRequest) => {
    if (request.modelType === NetworkDevice) {
      return getDeviceMock(request);
    }

    if (request.modelType === NetworkDeviceOidTemplate) {
      return getTemplateMock(request);
    }

    return getWalkMock(request);
  },
  getList: getListMock,
  create: createMock,
  updateById: updateMock,
} as unknown as typeof ModelAPI;

function walkRow(
  oid: string,
  type: SnmpDataType,
  value: string | number | null,
): SnmpWalkRow {
  return { oid: oid, type: type, value: value };
}

const SYS_NAME: SnmpWalkRow = walkRow(
  "1.3.6.1.2.1.1.5.0",
  SnmpDataType.OctetString,
  "edge-sw-01",
);
const SYS_UPTIME: SnmpWalkRow = walkRow(
  "1.3.6.1.2.1.1.3.0",
  SnmpDataType.TimeTicks,
  104524500,
);
const CISCO_CPU: SnmpWalkRow = walkRow(
  "1.3.6.1.4.1.9.9.109.1.1.1.1.8.1",
  SnmpDataType.Gauge32,
  7,
);

function walkResult(
  overrides: Partial<NetworkDeviceDiagnosticSnmpWalkResult> = {},
): NetworkDeviceDiagnosticSnmpWalkResult {
  return {
    rootOid: "1.3.6.1",
    rows: [SYS_UPTIME, SYS_NAME, CISCO_CPU],
    stopReason: SnmpWalkStopReason.Complete,
    snmpVersion: "2c",
    requestCount: 2,
    durationInMs: 40,
    ...overrides,
  };
}

function walk(
  id: string,
  overrides: Partial<NetworkDeviceDiagnostic> = {},
): NetworkDeviceDiagnostic {
  return Object.assign(
    new NetworkDeviceDiagnostic(),
    {
      _id: id,
      status: "Pending",
      diagnosticType: "SNMP Walk",
      createdAt: new Date(),
    },
    overrides,
  );
}

function completedWalk(
  id: string,
  resultOverrides: Partial<NetworkDeviceDiagnosticSnmpWalkResult> = {},
): NetworkDeviceDiagnostic {
  const result: NetworkDeviceDiagnosticSnmpWalkResult =
    walkResult(resultOverrides);

  return walk(id, {
    status: "Completed",
    snmpWalkRootOid: result.rootOid,
    ...(result.afterOid ? { snmpWalkAfterOid: result.afterOid } : {}),
    snmpWalkResult: result,
  });
}

function device(overrides: Partial<NetworkDevice> = {}): NetworkDevice {
  return Object.assign(
    new NetworkDevice(),
    {
      _id: DEVICE_ID,
      name: "edge-sw-01",
      probeId: new ObjectID(PROBE_ID),
      probe: Object.assign(new Probe(), { name: "Rack 3" }),
      monitoringMethod: "Probe",
      snmpOids: [] as Array<SnmpOid>,
    },
    overrides,
  );
}

type CardOptions = {
  canWalk?: boolean;
  canEditDevice?: boolean;
  canEditTemplate?: boolean;
  canCreateMonitor?: boolean;
};

async function flush(): Promise<void> {
  await act(async () => {});
}

async function renderCard(options: CardOptions = {}): Promise<void> {
  render(
    <SnmpWalkCard
      networkDeviceId={new ObjectID(DEVICE_ID)}
      canWalk={options.canWalk ?? true}
      canEditDevice={options.canEditDevice ?? true}
      canEditTemplate={options.canEditTemplate ?? true}
      canCreateMonitor={options.canCreateMonitor ?? true}
      modelAPI={fakeModelAPI}
    />,
  );

  await flush();
  await flush();
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(element);
  });
}

async function tick(): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(SNMP_WALK_POLL_INTERVAL_IN_MS);
  });
  await flush();
}

function rowsShown(): Array<string> {
  return screen
    .queryAllByTestId("snmp-walk-row")
    .map((element: HTMLElement): string => {
      return element.getAttribute("data-oid") || "";
    });
}

function rowFor(oid: string): HTMLElement {
  const found: HTMLElement | undefined = screen
    .queryAllByTestId("snmp-walk-row")
    .find((element: HTMLElement): boolean => {
      return element.getAttribute("data-oid") === oid;
    });

  if (!found) {
    throw new Error(`No row for ${oid}`);
  }

  return found;
}

function createdModel(callIndex: number = 0): NetworkDeviceDiagnostic {
  return (
    createMock.mock.calls[callIndex]![0] as {
      model: NetworkDeviceDiagnostic;
    }
  ).model;
}

beforeEach(() => {
  jest.useFakeTimers();
  getDeviceMock.mockReset();
  getWalkMock.mockReset();
  getTemplateMock.mockReset();
  getListMock.mockReset();
  createMock.mockReset();
  updateMock.mockReset();

  getDeviceMock.mockResolvedValue(device());
  getListMock.mockResolvedValue({ data: [], count: 0, skip: 0, limit: 5 });
  createMock.mockResolvedValue({ data: walk(WALK_ID) });
  getWalkMock.mockResolvedValue(walk(WALK_ID));
  updateMock.mockResolvedValue({ data: {} });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("before anything is walked", () => {
  test("offers the start points, walks everything by default, and says nothing was walked yet", async () => {
    await renderCard();

    expect(screen.getByTestId("snmp-walk-form")).toBeInTheDocument();
    for (const oid of [
      "1.3.6.1",
      "1.3.6.1.2.1.1",
      "1.3.6.1.2.1.2",
      "1.3.6.1.2.1.25",
      "1.3.6.1.4.1",
    ]) {
      expect(
        screen.getByTestId(`snmp-walk-start-point-${oid}`),
      ).toBeInTheDocument();
    }
    expect(screen.getByTestId("snmp-walk-start-point-1.3.6.1")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("snmp-walk-empty")).toHaveTextContent(
      "Not walked yet.",
    );
    expect(screen.getByText(/Runs on the probe "Rack 3"/)).toBeInTheDocument();
    expect(createMock).not.toHaveBeenCalled();
  });

  /*
   * The page never asks for the device's credentials: they stay on the
   * server, which hands them to the probe that walks.
   */
  test("reads the device without a single credential column", async () => {
    await renderCard();

    const select: Record<string, unknown> = (
      getDeviceMock.mock.calls[0]![0] as GetItemRequest
    ).select;

    for (const secret of [
      "snmpCommunityString",
      "snmpV3Username",
      "snmpV3AuthKey",
      "snmpV3PrivKey",
      "snmpV3Auth",
    ]) {
      expect(select).not.toHaveProperty(secret);
    }
    expect(select).toMatchObject({
      probeId: true,
      snmpOids: true,
      oidTemplateId: true,
    });
  });

  test("reads the device's latest walks, newest first", async () => {
    await renderCard();

    const request: {
      query: Record<string, unknown>;
      sort: Record<string, unknown>;
      limit: number;
    } = getListMock.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      sort: Record<string, unknown>;
      limit: number;
    };

    expect(String(request.query["networkDeviceId"])).toBe(DEVICE_ID);
    expect(request.query["diagnosticType"]).toBe("SNMP Walk");
    expect(String(request.sort["createdAt"]).toLowerCase()).toContain("desc");
    expect(request.limit).toBe(5);
  });

  test("a device with no probe has nothing to walk from, and says where to assign one", async () => {
    getDeviceMock.mockResolvedValue(
      device({ probeId: undefined, probe: undefined }),
    );

    await renderCard();

    expect(screen.getByTestId("snmp-walk-no-probe")).toHaveTextContent(
      "This device has no probe assigned",
    );
    expect(screen.queryByTestId("snmp-walk-form")).not.toBeInTheDocument();
  });

  test("a reader who may not walk gets the last walk, and no form", async () => {
    getListMock.mockResolvedValue({
      data: [completedWalk(OLD_WALK_ID)],
      count: 1,
      skip: 0,
      limit: 5,
    });

    await renderCard({ canWalk: false });

    expect(screen.queryByTestId("snmp-walk-form")).not.toBeInTheDocument();
    expect(screen.getByTestId("snmp-walk-read-only")).toBeInTheDocument();
    expect(rowsShown()).toEqual([SYS_UPTIME.oid, SYS_NAME.oid, CISCO_CPU.oid]);
  });

  test("a device that cannot be read says so", async () => {
    getDeviceMock.mockRejectedValue(new Error("Device not found"));

    await renderCard();

    expect(screen.getByTestId("snmp-walk-load-error")).toHaveTextContent(
      "Device not found",
    );
  });
});

describe("walking", () => {
  test("asks for a walk of everything, waits for the probe, and shows what it read", async () => {
    getWalkMock
      .mockResolvedValueOnce(walk(WALK_ID, { status: "In Progress" }))
      .mockResolvedValueOnce(completedWalk(WALK_ID));

    await renderCard();
    await click(screen.getByTestId("snmp-walk-start"));

    const model: NetworkDeviceDiagnostic = createdModel();
    expect(model.diagnosticType).toBe("SNMP Walk");
    expect(model.networkDeviceId?.toString()).toBe(DEVICE_ID);
    expect(model.snmpWalkRootOid).toBe("1.3.6.1");
    expect(model.snmpWalkAfterOid).toBeUndefined();

    expect(screen.getByTestId("snmp-walk-running")).toHaveTextContent(
      "Walking 1.3.6.1…",
    );
    expect(screen.getByTestId("snmp-walk-start")).toBeDisabled();

    await tick();
    expect(screen.getByTestId("snmp-walk-running")).toBeInTheDocument();

    await tick();
    expect(screen.queryByTestId("snmp-walk-running")).not.toBeInTheDocument();
    expect(screen.getByTestId("snmp-walk-summary")).toHaveTextContent(
      "3 OIDs under 1.3.6.1.",
    );
    expect(rowsShown()).toEqual([SYS_UPTIME.oid, SYS_NAME.oid, CISCO_CPU.oid]);
    expect(getWalkMock).toHaveBeenCalledTimes(2);
  });

  test("a row reads its name, type and value", async () => {
    getListMock.mockResolvedValue({
      data: [completedWalk(OLD_WALK_ID)],
      count: 1,
      skip: 0,
      limit: 5,
    });

    await renderCard();

    const uptime: HTMLElement = rowFor(SYS_UPTIME.oid);
    expect(within(uptime).getByTestId("snmp-walk-row-name")).toHaveTextContent(
      "sysUpTime.0",
    );
    expect(within(uptime).getByTestId("snmp-walk-row-type")).toHaveTextContent(
      "Timeticks",
    );
    expect(within(uptime).getByTestId("snmp-walk-row-value")).toHaveTextContent(
      "104524500",
    );
    expect(
      within(uptime).getByTestId("snmp-walk-row-duration"),
    ).toHaveTextContent("12 days, 02:20:45");

    const cpu: HTMLElement = rowFor(CISCO_CPU.oid);
    expect(within(cpu).getByTestId("snmp-walk-row-name")).toHaveTextContent(
      "CPU 5-min %",
    );
    expect(within(cpu).getByTestId("snmp-walk-row-source")).toHaveTextContent(
      "In the Cisco IOS / IOS-XE template",
    );
  });

  test("a start point picks the subtree to walk", async () => {
    getWalkMock.mockResolvedValue(
      completedWalk(WALK_ID, { rootOid: "1.3.6.1.2.1.25", rows: [] }),
    );

    await renderCard();
    await click(screen.getByTestId("snmp-walk-start-point-1.3.6.1.2.1.25"));

    expect(screen.getByTestId("snmp-walk-start-oid")).toHaveValue(
      "1.3.6.1.2.1.25",
    );
    expect(
      screen.getByTestId("snmp-walk-start-point-1.3.6.1.2.1.25"),
    ).toHaveAttribute("aria-pressed", "true");

    await click(screen.getByTestId("snmp-walk-start"));
    expect(createdModel().snmpWalkRootOid).toBe("1.3.6.1.2.1.25");

    await tick();
    expect(screen.getByTestId("snmp-walk-summary")).toHaveTextContent(
      "Nothing under 1.3.6.1.2.1.25.",
    );
  });

  test("a typed OID is walked without its leading dot, and Enter walks it", async () => {
    await renderCard();

    await act(async () => {
      fireEvent.change(screen.getByTestId("snmp-walk-start-oid"), {
        target: { value: ".1.3.6.1.4.1.9" },
      });
    });
    await act(async () => {
      fireEvent.keyDown(screen.getByTestId("snmp-walk-start-oid"), {
        key: "Enter",
      });
    });

    expect(createdModel().snmpWalkRootOid).toBe("1.3.6.1.4.1.9");
  });

  test("a MIB name is refused before anything is sent", async () => {
    await renderCard();

    await act(async () => {
      fireEvent.change(screen.getByTestId("snmp-walk-start-oid"), {
        target: { value: "IF-MIB::ifTable" },
      });
    });

    expect(screen.getByTestId("snmp-walk-start-invalid")).toHaveTextContent(
      "Use a numeric OID",
    );
    expect(screen.getByTestId("snmp-walk-start")).toBeDisabled();
    expect(createMock).not.toHaveBeenCalled();
  });

  test("a walk the server refuses says why at once", async () => {
    createMock.mockRejectedValue(
      new Error(
        "This device has no SNMP credentials to walk it with. Add a community string or an SNMPv3 user in its Settings, or give it (or its site) an SNMP credential profile.",
      ),
    );

    await renderCard();
    await click(screen.getByTestId("snmp-walk-start"));

    expect(screen.queryByTestId("snmp-walk-running")).not.toBeInTheDocument();
    expect(screen.getByTestId("snmp-walk-error")).toHaveTextContent(
      "This device has no SNMP credentials to walk it with.",
    );
    expect(screen.getByTestId("snmp-walk-start")).not.toBeDisabled();
  });

  test("a walk the probe could not run says the probe's reason", async () => {
    getWalkMock.mockResolvedValue(
      walk(WALK_ID, {
        status: "Failed",
        statusMessage:
          "This device's probe runs a version that cannot walk SNMP. Update the probe to the latest version, then walk again.",
      }),
    );

    await renderCard();
    await click(screen.getByTestId("snmp-walk-start"));
    await tick();

    expect(screen.getByTestId("snmp-walk-error")).toHaveTextContent(
      "Update the probe to the latest version",
    );
  });

  test("a probe that never reports is named after two minutes", async () => {
    getWalkMock.mockResolvedValue(walk(WALK_ID, { status: "Pending" }));

    await renderCard();
    await click(screen.getByTestId("snmp-walk-start"));

    for (
      let attempt: number = 0;
      attempt < SNMP_WALK_MAX_POLL_ATTEMPTS;
      attempt++
    ) {
      await tick();
    }

    expect(screen.getByTestId("snmp-walk-error")).toHaveTextContent(
      'The probe "Rack 3" did not report the walk within two minutes.',
    );
    expect(getWalkMock).toHaveBeenCalledTimes(SNMP_WALK_MAX_POLL_ATTEMPTS);

    // And it stops reading.
    await tick();
    expect(getWalkMock).toHaveBeenCalledTimes(SNMP_WALK_MAX_POLL_ATTEMPTS);
  });

  test("one failed read is not a verdict; a streak of them is", async () => {
    getWalkMock
      .mockRejectedValueOnce(new Error("Gateway Timeout"))
      .mockResolvedValueOnce(walk(WALK_ID, { status: "In Progress" }));

    for (
      let index: number = 0;
      index < SNMP_WALK_MAX_CONSECUTIVE_POLL_FAILURES;
      index++
    ) {
      getWalkMock.mockRejectedValueOnce(new Error("API is down"));
    }

    await renderCard();
    await click(screen.getByTestId("snmp-walk-start"));

    await tick();
    await tick();
    expect(screen.getByTestId("snmp-walk-running")).toBeInTheDocument();

    for (
      let index: number = 0;
      index < SNMP_WALK_MAX_CONSECUTIVE_POLL_FAILURES;
      index++
    ) {
      await tick();
    }

    expect(screen.getByTestId("snmp-walk-error")).toHaveTextContent(
      "API is down",
    );
  });

  test("a walk whose row disappeared says so", async () => {
    getWalkMock.mockResolvedValue(null);

    await renderCard();
    await click(screen.getByTestId("snmp-walk-start"));
    await tick();

    expect(screen.getByTestId("snmp-walk-error")).toHaveTextContent(
      "This walk no longer exists.",
    );
  });

  test("leaving the page stops the reading", async () => {
    getWalkMock.mockResolvedValue(walk(WALK_ID, { status: "Pending" }));

    await renderCard();
    await click(screen.getByTestId("snmp-walk-start"));
    await tick();

    const reads: number = getWalkMock.mock.calls.length;
    cleanup();
    await tick();
    await tick();

    expect(getWalkMock).toHaveBeenCalledTimes(reads);
  });
});

describe("what a failed walk shows", () => {
  test("credentials the device refused: what to fix, and the way to Settings, with no 'nothing under'", async () => {
    getListMock.mockResolvedValue({
      data: [
        completedWalk(OLD_WALK_ID, {
          rows: [],
          stopReason: SnmpWalkStopReason.Failed,
          snmpVersion: "3",
          failure: {
            kind: SnmpWalkFailureKind.Authentication,
            authenticationReason: SnmpWalkAuthenticationReason.WrongDigest,
            message: "Wrong Digest (incorrect password, community or key)",
          },
        }),
      ],
      count: 1,
      skip: 0,
      limit: 5,
    });

    await renderCard();

    const failure: HTMLElement = screen.getByTestId("snmp-walk-failure");
    expect(failure).toHaveTextContent("The device refused the credentials");
    expect(failure).toHaveTextContent(
      "The authentication password or protocol does not match the device's.",
    );
    expect(
      within(failure).getByTestId("snmp-walk-failure-settings"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("snmp-walk-summary")).not.toBeInTheDocument();
    expect(screen.queryByTestId("snmp-walk-continue")).not.toBeInTheDocument();
  });

  test("a device that went quiet partway keeps what it read, and offers to continue", async () => {
    getListMock.mockResolvedValue({
      data: [
        completedWalk(OLD_WALK_ID, {
          rows: [SYS_UPTIME, SYS_NAME],
          stopReason: SnmpWalkStopReason.Failed,
          nextOid: SYS_NAME.oid,
          failure: {
            kind: SnmpWalkFailureKind.Timeout,
            message: "Request timed out",
          },
        }),
      ],
      count: 1,
      skip: 0,
      limit: 5,
    });

    await renderCard();

    expect(screen.getByTestId("snmp-walk-failure")).toHaveTextContent(
      "The device stopped answering",
    );
    expect(screen.getByTestId("snmp-walk-summary")).toHaveTextContent(
      "2 OIDs read under 1.3.6.1 before the walk stopped.",
    );
    expect(rowsShown()).toEqual([SYS_UPTIME.oid, SYS_NAME.oid]);

    await click(screen.getByTestId("snmp-walk-continue"));

    expect(createdModel().snmpWalkRootOid).toBe("1.3.6.1");
    expect(createdModel().snmpWalkAfterOid).toBe(SYS_NAME.oid);
  });
});

describe("a walk read in pages", () => {
  test("continuing appends the next page under the first, from where it stopped", async () => {
    getListMock.mockResolvedValue({
      data: [
        completedWalk(OLD_WALK_ID, {
          rows: [SYS_UPTIME, SYS_NAME],
          stopReason: SnmpWalkStopReason.OidLimit,
          nextOid: SYS_NAME.oid,
        }),
      ],
      count: 1,
      skip: 0,
      limit: 5,
    });
    getWalkMock.mockResolvedValue(
      completedWalk(WALK_ID, {
        afterOid: SYS_NAME.oid,
        rows: [CISCO_CPU],
      }),
    );

    await renderCard();

    expect(screen.getByTestId("snmp-walk-summary")).toHaveTextContent(
      "2 OIDs read under 1.3.6.1 so far. There is more to read.",
    );
    expect(screen.getByTestId("snmp-walk-continue-bottom")).toBeInTheDocument();

    await click(screen.getByTestId("snmp-walk-continue"));

    expect(createdModel().snmpWalkAfterOid).toBe(SYS_NAME.oid);
    expect(screen.getByTestId("snmp-walk-running")).toHaveTextContent(
      "Walking on under 1.3.6.1",
    );
    // The page so far stays while the next one is read.
    expect(rowsShown()).toEqual([SYS_UPTIME.oid, SYS_NAME.oid]);

    await tick();

    expect(rowsShown()).toEqual([SYS_UPTIME.oid, SYS_NAME.oid, CISCO_CPU.oid]);
    expect(screen.getByTestId("snmp-walk-summary")).toHaveTextContent(
      "3 OIDs under 1.3.6.1.",
    );
    expect(screen.queryByTestId("snmp-walk-continue")).not.toBeInTheDocument();
  });

  test("after a reload, a walk read in pages comes back as one, its root in the box", async () => {
    getListMock.mockResolvedValue({
      data: [
        completedWalk(WALK_ID, {
          rootOid: "1.3.6.1.2.1",
          afterOid: SYS_NAME.oid,
          rows: [walkRow("1.3.6.1.2.1.2.1.0", SnmpDataType.Integer, 3)],
        }),
        completedWalk(OLD_WALK_ID, {
          rootOid: "1.3.6.1.2.1",
          rows: [SYS_UPTIME, SYS_NAME],
          stopReason: SnmpWalkStopReason.OidLimit,
          nextOid: SYS_NAME.oid,
        }),
      ],
      count: 2,
      skip: 0,
      limit: 5,
    });

    await renderCard();

    expect(rowsShown()).toEqual([
      SYS_UPTIME.oid,
      SYS_NAME.oid,
      "1.3.6.1.2.1.2.1.0",
    ]);
    expect(screen.getByTestId("snmp-walk-start-oid")).toHaveValue(
      "1.3.6.1.2.1",
    );
  });

  test("a walk still running when the page opens is followed to its end", async () => {
    getListMock.mockResolvedValue({
      data: [
        walk(WALK_ID, {
          status: "In Progress",
          snmpWalkRootOid: "1.3.6.1.4.1",
          createdAt: new Date(),
        }),
      ],
      count: 1,
      skip: 0,
      limit: 5,
    });
    getWalkMock.mockResolvedValue(
      completedWalk(WALK_ID, { rootOid: "1.3.6.1.4.1", rows: [CISCO_CPU] }),
    );

    await renderCard();

    expect(screen.getByTestId("snmp-walk-running")).toHaveTextContent(
      "Walking 1.3.6.1.4.1…",
    );

    await tick();

    expect(String((getWalkMock.mock.calls[0]![0] as GetItemRequest).id)).toBe(
      WALK_ID,
    );
    expect(rowsShown()).toEqual([CISCO_CPU.oid]);
  });

  test("a walk left running long ago is not waited on", async () => {
    getListMock.mockResolvedValue({
      data: [
        walk(WALK_ID, {
          status: "In Progress",
          snmpWalkRootOid: "1.3.6.1.4.1",
          createdAt: new Date(Date.now() - 60 * 60 * 1000),
        }),
      ],
      count: 1,
      skip: 0,
      limit: 5,
    });

    await renderCard();

    expect(screen.queryByTestId("snmp-walk-running")).not.toBeInTheDocument();
    expect(screen.getByTestId("snmp-walk-empty")).toBeInTheDocument();
  });
});

describe("collecting what a walk found", () => {
  beforeEach(() => {
    getListMock.mockResolvedValue({
      data: [completedWalk(OLD_WALK_ID)],
      count: 1,
      skip: 0,
      limit: 5,
    });
  });

  test("Collect adds the OID, named, to the device's own health OIDs, read fresh first", async () => {
    getDeviceMock
      .mockResolvedValueOnce(device())
      .mockResolvedValueOnce(
        device({ snmpOids: [{ oid: "1.3.6.1.2.1.1.1.0", name: "sysDescr" }] }),
      )
      .mockResolvedValue(
        device({
          snmpOids: [
            { oid: "1.3.6.1.2.1.1.1.0", name: "sysDescr" },
            { oid: CISCO_CPU.oid, name: "CPU 5-min %" },
          ],
        }),
      );

    await renderCard();
    await click(
      within(rowFor(CISCO_CPU.oid)).getByTestId("snmp-walk-row-collect"),
    );
    await flush();

    expect(updateMock).toHaveBeenCalledTimes(1);
    const update: {
      modelType: unknown;
      id: ObjectID;
      data: Record<string, unknown>;
    } = updateMock.mock.calls[0]![0] as {
      modelType: unknown;
      id: ObjectID;
      data: Record<string, unknown>;
    };

    expect(update.modelType).toBe(NetworkDevice);
    expect(update.id.toString()).toBe(DEVICE_ID);
    expect(update.data).toEqual({
      snmpOids: [
        { oid: "1.3.6.1.2.1.1.1.0", name: "sysDescr" },
        { oid: CISCO_CPU.oid, name: "CPU 5-min %" },
      ],
    });
    expect((getDeviceMock.mock.calls[1]![0] as GetItemRequest).select).toEqual({
      snmpOids: true,
    });

    const cpu: HTMLElement = rowFor(CISCO_CPU.oid);
    expect(
      within(cpu).getByTestId("snmp-walk-row-collected"),
    ).toBeInTheDocument();
    expect(
      within(cpu).queryByTestId("snmp-walk-row-collect"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("snmp-walk-collect-notice")).toHaveTextContent(
      "CPU 5-min % is collected on every poll from the next one on. It is charted on the device's Metrics page.",
    );
  });

  test("a collected OID offers Alert on it, opening a monitor on it", async () => {
    getDeviceMock.mockResolvedValue(
      device({ snmpOids: [{ oid: CISCO_CPU.oid, name: "CPU 5-min %" }] }),
    );

    await renderCard();

    const link: HTMLElement = within(rowFor(CISCO_CPU.oid)).getByTestId(
      "snmp-walk-row-alert",
    );
    const href: string = link.getAttribute("href") || "";
    const query: URLSearchParams = new URLSearchParams(
      href.substring(href.indexOf("?") + 1),
    );

    expect(href).toContain("/monitors/create?");
    expect(query.get("networkDeviceId")).toBe(DEVICE_ID);
    expect(query.get("snmpOid")).toBe(CISCO_CPU.oid);
    expect(query.get("snmpOidType")).toBe(SnmpDataType.Gauge32);
    expect(query.get("snmpOidValue")).toBe("7");

    // Not collected yet: nothing to alert on.
    expect(
      within(rowFor(SYS_NAME.oid)).queryByTestId("snmp-walk-row-alert"),
    ).not.toBeInTheDocument();
  });

  test("Alert on it is hidden from a reader who may not create monitors", async () => {
    getDeviceMock.mockResolvedValue(
      device({ snmpOids: [{ oid: CISCO_CPU.oid }] }),
    );

    await renderCard({ canCreateMonitor: false });

    expect(
      within(rowFor(CISCO_CPU.oid)).getByTestId("snmp-walk-row-collected"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("snmp-walk-row-alert")).not.toBeInTheDocument();
  });

  test("an OID the template collects is collected already", async () => {
    getDeviceMock.mockResolvedValue(
      device({
        oidTemplateId: new ObjectID(TEMPLATE_ID),
        oidTemplate: Object.assign(new NetworkDeviceOidTemplate(), {
          name: "Cisco Catalyst 9300",
          oids: [{ oid: SYS_UPTIME.oid }],
        }),
      }),
    );

    await renderCard();

    expect(
      within(rowFor(SYS_UPTIME.oid)).getByTestId("snmp-walk-row-collected"),
    ).toBeInTheDocument();
    expect(
      within(rowFor(SYS_NAME.oid)).getByTestId("snmp-walk-row-collect"),
    ).toBeInTheDocument();
  });

  test("the row menu collects on every device using the device's template", async () => {
    getDeviceMock.mockResolvedValue(
      device({
        oidTemplateId: new ObjectID(TEMPLATE_ID),
        oidTemplate: Object.assign(new NetworkDeviceOidTemplate(), {
          name: "Cisco Catalyst 9300",
          oids: [],
        }),
      }),
    );
    getTemplateMock.mockResolvedValue(
      Object.assign(new NetworkDeviceOidTemplate(), {
        oids: [{ oid: "1.3.6.1.2.1.1.1.0" }],
      }),
    );

    await renderCard();
    await click(within(rowFor(SYS_NAME.oid)).getByTestId("snmp-walk-row-more"));
    await click(
      screen.getByText("Collect on every device using Cisco Catalyst 9300"),
    );
    await flush();

    const update: {
      modelType: unknown;
      id: ObjectID;
      data: Record<string, unknown>;
    } = updateMock.mock.calls[0]![0] as {
      modelType: unknown;
      id: ObjectID;
      data: Record<string, unknown>;
    };

    expect(update.modelType).toBe(NetworkDeviceOidTemplate);
    expect(update.id.toString()).toBe(TEMPLATE_ID);
    expect(update.data).toEqual({
      oids: [
        { oid: "1.3.6.1.2.1.1.1.0" },
        { oid: SYS_NAME.oid, name: "sysName.0" },
      ],
    });
    expect(screen.getByTestId("snmp-walk-collect-notice")).toHaveTextContent(
      "sysName.0 is collected by every device using Cisco Catalyst 9300",
    );
  });

  test("a list the server refuses keeps the row as it was, and says why", async () => {
    updateMock.mockRejectedValue(
      new Error(
        "Device-Specific Health OIDs: 51 OIDs is more than the limit of 50.",
      ),
    );

    await renderCard();
    await click(
      within(rowFor(SYS_NAME.oid)).getByTestId("snmp-walk-row-collect"),
    );
    await flush();

    expect(screen.getByTestId("snmp-walk-collect-notice")).toHaveTextContent(
      "51 OIDs is more than the limit of 50.",
    );
    expect(
      within(rowFor(SYS_NAME.oid)).getByTestId("snmp-walk-row-collect"),
    ).toBeInTheDocument();
  });

  test("a text OID is collected to alert on, not to chart", async () => {
    await renderCard();
    await click(
      within(rowFor(SYS_NAME.oid)).getByTestId("snmp-walk-row-collect"),
    );
    await flush();

    expect(screen.getByTestId("snmp-walk-collect-notice")).toHaveTextContent(
      "sysName.0 is collected on every poll from the next one on, so you can alert on its value.",
    );
  });

  test.each([
    ["may not change the device", { canEditDevice: false }, "Probe"],
    ["is a bound-monitor override nothing polls", {}, "Monitor"],
  ])(
    "no Collect for a reader who %s",
    async (_label: string, options: CardOptions, method: string) => {
      getDeviceMock.mockResolvedValue(device({ monitoringMethod: method }));

      await renderCard(options);

      expect(
        screen.queryByTestId("snmp-walk-row-collect"),
      ).not.toBeInTheDocument();
      expect(rowsShown()).toHaveLength(3);
    },
  );
});

describe("reading a long walk", () => {
  const MANY: Array<SnmpWalkRow> = Array.from(
    { length: 250 },
    (_: unknown, index: number): SnmpWalkRow => {
      return walkRow(
        `1.3.6.1.2.1.2.2.1.10.${index + 1}`,
        SnmpDataType.Counter32,
        index,
      );
    },
  );

  beforeEach(() => {
    getListMock.mockResolvedValue({
      data: [completedWalk(OLD_WALK_ID, { rows: MANY })],
      count: 1,
      skip: 0,
      limit: 5,
    });
  });

  test("draws a hundred rows at a time", async () => {
    await renderCard();

    expect(rowsShown()).toHaveLength(100);

    await click(screen.getByTestId("snmp-walk-show-more"));
    expect(rowsShown()).toHaveLength(200);

    await click(screen.getByTestId("snmp-walk-show-more"));
    expect(rowsShown()).toHaveLength(250);
    expect(screen.queryByTestId("snmp-walk-show-more")).not.toBeInTheDocument();
  });

  test("the filter narrows the rows and counts what matches", async () => {
    await renderCard();

    await act(async () => {
      fireEvent.change(screen.getByTestId("snmp-walk-filter"), {
        target: { value: "1.3.6.1.2.1.2.2.1.10.25" },
      });
    });

    expect(rowsShown()).toEqual([
      "1.3.6.1.2.1.2.2.1.10.25",
      "1.3.6.1.2.1.2.2.1.10.250",
    ]);
    expect(screen.getByTestId("snmp-walk-filter-count")).toHaveTextContent(
      "2 of 250 OIDs match.",
    );

    await act(async () => {
      fireEvent.change(screen.getByTestId("snmp-walk-filter"), {
        target: { value: "no such thing" },
      });
    });

    expect(screen.getByTestId("snmp-walk-no-match")).toHaveTextContent(
      'No OIDs match "no such thing".',
    );
  });

  test("a long value is cut until asked for", async () => {
    getListMock.mockResolvedValue({
      data: [
        completedWalk(OLD_WALK_ID, {
          rows: [
            walkRow(
              "1.3.6.1.2.1.1.1.0",
              SnmpDataType.OctetString,
              `start ${"x".repeat(300)} end`,
            ),
          ],
        }),
      ],
      count: 1,
      skip: 0,
      limit: 5,
    });

    await renderCard();

    const value: HTMLElement = screen.getByTestId("snmp-walk-row-value");
    expect(value.textContent).toContain("start");
    expect(value.textContent).not.toContain("end");

    await click(screen.getByTestId("snmp-walk-row-value-toggle"));

    expect(screen.getByTestId("snmp-walk-row-value").textContent).toContain(
      "end",
    );
    expect(screen.getByTestId("snmp-walk-row-value-toggle")).toHaveTextContent(
      "Show less",
    );
  });
});
