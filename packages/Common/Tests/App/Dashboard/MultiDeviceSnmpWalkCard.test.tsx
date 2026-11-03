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
import MultiDeviceSnmpWalkCard from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/MultiDeviceSnmpWalkCard";
import {
  MULTI_DEVICE_SNMP_WALK_MAX_CONSECUTIVE_POLL_FAILURES,
  MULTI_DEVICE_SNMP_WALK_MAX_DEVICES,
  MULTI_DEVICE_SNMP_WALK_MAX_POLL_ATTEMPTS,
  MULTI_DEVICE_SNMP_WALK_POLL_INTERVAL_IN_MS,
  MULTI_DEVICE_SNMP_WALK_RESTORE_LIMIT,
  MULTI_DEVICE_SNMP_WALK_WAIT_IN_MS,
  MultiDeviceSnmpWalkQuery,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/MultiDeviceSnmpWalkViewModel";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceDiagnostic from "../../../Models/DatabaseModels/NetworkDeviceDiagnostic";
import NetworkDeviceOidTemplate from "../../../Models/DatabaseModels/NetworkDeviceOidTemplate";
import Probe from "../../../Models/DatabaseModels/Probe";
import Includes from "../../../Types/BaseDatabase/Includes";
import SnmpDataType from "../../../Types/Monitor/SnmpMonitor/SnmpDataType";
import SnmpOid from "../../../Types/Monitor/SnmpMonitor/SnmpOid";
import {
  NetworkDeviceDiagnosticSnmpWalkResult,
  SNMP_WALK_NO_CREDENTIALS_MESSAGE,
  SnmpWalkFailureKind,
  SnmpWalkRow,
  SnmpWalkStopReason,
} from "../../../Types/NetworkDevice/NetworkDeviceSnmpWalk";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #5548, from the page: the Network's SNMP Walk. Every device picked
 * is walked as its own SNMP Walk page walks it - one diagnostic row each,
 * created a few at a time and read back together every few seconds - so
 * everything a person sees - the devices, the wait, each device's answer as
 * it lands, the OIDs compared side by side, collecting one on every device
 * that answers it, the last walk after a reload, and what a reader without
 * a permission is offered - is driven here through the card's `modelAPI`
 * seam, with fake timers for the polling.
 */

const downloadFileMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/DownloadFile", () => {
  return {
    __esModule: true,
    default: (data: unknown): void => {
      downloadFileMock(data);
    },
  };
});

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

const DEVICE_A: string = "11111111-1111-4111-8111-111111111111";
const DEVICE_B: string = "22222222-2222-4222-8222-222222222222";
const DEVICE_C: string = "33333333-3333-4333-8333-333333333333";
const DEVICE_D: string = "44444444-4444-4444-8444-444444444444";
const DEVICE_T: string = "55555555-5555-4555-8555-555555555555";
const PROBE_ID: string = "66666666-6666-4666-8666-666666666666";
const TEMPLATE_ID: string = "77777777-7777-4777-8777-777777777777";

const ROOT: string = "1.3.6.1.2.1.1";
const SYS_DESCR: string = "1.3.6.1.2.1.1.1.0";
const SYS_UPTIME: string = "1.3.6.1.2.1.1.3.0";
const SYS_NAME: string = "1.3.6.1.2.1.1.5.0";
const SYS_LOCATION: string = "1.3.6.1.2.1.1.6.0";

const deviceListMock: MockFunction = getJestMockFunction();
const walkListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const createMock: MockFunction = getJestMockFunction();
const updateMock: MockFunction = getJestMockFunction();
const queryChangeMock: MockFunction = getJestMockFunction();

interface ListRequest {
  modelType: unknown;
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  limit: number;
  sort: Record<string, unknown>;
}

const fakeModelAPI: typeof ModelAPI = {
  getList: (request: ListRequest) => {
    if (request.modelType === NetworkDevice) {
      return deviceListMock(request);
    }

    if (request.modelType === NetworkDeviceDiagnostic) {
      return walkListMock(request);
    }

    return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
  },
  getItem: getItemMock,
  create: createMock,
  updateById: updateMock,
} as unknown as typeof ModelAPI;

type DeviceOverrides = {
  [Column in keyof NetworkDevice]?: NetworkDevice[Column] | undefined;
};

function device(
  id: string,
  name: string,
  overrides: DeviceOverrides = {},
): NetworkDevice {
  return Object.assign(
    new NetworkDevice(),
    {
      _id: id,
      name: name,
      probeId: new ObjectID(PROBE_ID),
      probe: Object.assign(new Probe(), { name: "Rack 3" }),
      monitoringMethod: "Probe",
      snmpOids: [] as Array<SnmpOid>,
    },
    overrides,
  );
}

let devices: Array<NetworkDevice> = [];

function idsOf(query: Record<string, unknown>, key: string): Array<string> {
  const value: unknown = query[key];

  if (value instanceof Includes) {
    return (value.values as Array<string>).map((id: unknown): string => {
      return String(id);
    });
  }

  return value === undefined ? [] : [String(value)];
}

function walkRow(
  oid: string,
  type: SnmpDataType,
  value: string | number | null,
): SnmpWalkRow {
  return { oid: oid, type: type, value: value };
}

function walkResult(
  rows: Array<SnmpWalkRow>,
  overrides: Partial<NetworkDeviceDiagnosticSnmpWalkResult> = {},
): NetworkDeviceDiagnosticSnmpWalkResult {
  return {
    rootOid: ROOT,
    rows: rows,
    stopReason: SnmpWalkStopReason.Complete,
    snmpVersion: "2c",
    requestCount: 2,
    durationInMs: 40,
    ...overrides,
  };
}

function diagnostic(
  id: string,
  deviceId: string,
  overrides: Partial<NetworkDeviceDiagnostic> = {},
): NetworkDeviceDiagnostic {
  return Object.assign(
    new NetworkDeviceDiagnostic(),
    {
      _id: id,
      networkDeviceId: new ObjectID(deviceId),
      status: "Pending",
      diagnosticType: "SNMP Walk",
      snmpWalkRootOid: ROOT,
      createdAt: new Date(),
    },
    overrides,
  );
}

function completed(
  id: string,
  deviceId: string,
  rows: Array<SnmpWalkRow>,
  overrides: Partial<NetworkDeviceDiagnosticSnmpWalkResult> = {},
): NetworkDeviceDiagnostic {
  return diagnostic(id, deviceId, {
    status: "Completed",
    snmpWalkResult: walkResult(rows, overrides),
  });
}

// The walk id the fake server gives each device's walk.
function walkIdFor(deviceId: string): string {
  return `${deviceId.slice(0, 8)}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
}

/*
 * What the probes report, by device. A device absent here is still
 * walking; a function decides per poll.
 */
let reports: Map<string, NetworkDeviceDiagnostic> = new Map();

async function flush(): Promise<void> {
  await act(async () => {});
}

type CardOptions = {
  query?: MultiDeviceSnmpWalkQuery;
  canWalk?: boolean;
  canEditDevice?: boolean;
  canEditTemplate?: boolean;
};

async function renderCard(options: CardOptions = {}): Promise<void> {
  render(
    <MultiDeviceSnmpWalkCard
      initialQuery={
        options.query || {
          deviceIds: [DEVICE_A, DEVICE_B, DEVICE_C],
          startOid: "",
        }
      }
      canWalk={options.canWalk ?? true}
      canEditDevice={options.canEditDevice ?? true}
      canEditTemplate={options.canEditTemplate ?? true}
      onQueryChange={queryChangeMock}
      modelAPI={fakeModelAPI}
    />,
  );

  for (let index: number = 0; index < 5; index++) {
    await flush();
  }
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(element);
  });

  for (let index: number = 0; index < 5; index++) {
    await flush();
  }
}

async function tick(times: number = 1): Promise<void> {
  for (let index: number = 0; index < times; index++) {
    await act(async () => {
      jest.advanceTimersByTime(MULTI_DEVICE_SNMP_WALK_POLL_INTERVAL_IN_MS);
    });
    await flush();
    await flush();
  }
}

async function typeStart(oid: string): Promise<void> {
  await act(async () => {
    fireEvent.change(screen.getByTestId("multi-snmp-walk-start-oid"), {
      target: { value: oid },
    });
  });
}

async function walk(oid: string = ROOT): Promise<void> {
  await typeStart(oid);
  await click(screen.getByTestId("multi-snmp-walk-start"));
}

function chip(deviceId: string): HTMLElement {
  const found: HTMLElement | undefined = screen
    .queryAllByTestId("multi-snmp-walk-device")
    .find((element: HTMLElement): boolean => {
      return element.getAttribute("data-device-id") === deviceId;
    });

  if (!found) {
    throw new Error(`No chip for ${deviceId}`);
  }

  return found;
}

function rowsShown(): Array<string> {
  return screen
    .queryAllByTestId("multi-snmp-walk-row")
    .map((element: HTMLElement): string => {
      return element.getAttribute("data-oid") || "";
    });
}

function rowFor(oid: string): HTMLElement {
  const found: HTMLElement | undefined = screen
    .queryAllByTestId("multi-snmp-walk-row")
    .find((element: HTMLElement): boolean => {
      return element.getAttribute("data-oid") === oid;
    });

  if (!found) {
    throw new Error(`No row for ${oid}`);
  }

  return found;
}

function createdFor(): Array<NetworkDeviceDiagnostic> {
  return createMock.mock.calls.map((call: Array<unknown>) => {
    return (call[0] as { model: NetworkDeviceDiagnostic }).model;
  });
}

function pollRequests(): Array<ListRequest> {
  return walkListMock.mock.calls
    .map((call: Array<unknown>): ListRequest => {
      return call[0] as ListRequest;
    })
    .filter((request: ListRequest): boolean => {
      return request.query["_id"] !== undefined;
    });
}

beforeEach(() => {
  jest.useFakeTimers();
  deviceListMock.mockReset();
  walkListMock.mockReset();
  getItemMock.mockReset();
  createMock.mockReset();
  updateMock.mockReset();
  queryChangeMock.mockReset();
  downloadFileMock.mockReset();

  devices = [
    device(DEVICE_A, "mx-amsterdam"),
    device(DEVICE_B, "mx-berlin"),
    // No probe: nothing to walk it from.
    device(DEVICE_C, "mx-cardiff", { probeId: undefined, probe: undefined }),
    // Monitor-backed: walked if it can be, never collected on.
    device(DEVICE_D, "mx-dublin", { monitoringMethod: "Monitor" }),
    device(DEVICE_T, "mx-turin", {
      oidTemplateId: new ObjectID(TEMPLATE_ID),
      oidTemplate: Object.assign(new NetworkDeviceOidTemplate(), {
        name: "Edge routers",
        oids: [] as Array<SnmpOid>,
      }),
    }),
  ];
  reports = new Map();

  deviceListMock.mockImplementation((request: unknown) => {
    const ids: Array<string> = idsOf((request as ListRequest).query, "_id");
    const data: Array<NetworkDevice> =
      ids.length === 0
        ? devices
        : devices.filter((entry: NetworkDevice): boolean => {
            return ids.includes(entry._id!.toString());
          });

    return Promise.resolve({
      data: data,
      count: data.length,
      skip: 0,
      limit: 100,
    });
  });

  // No earlier walk; each poll answers what the probes have reported.
  walkListMock.mockImplementation((request: unknown) => {
    const query: Record<string, unknown> = (request as ListRequest).query;
    const ids: Array<string> = idsOf(query, "_id");

    if (ids.length === 0) {
      return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
    }

    const data: Array<NetworkDeviceDiagnostic> = ids.map((id: string) => {
      const deviceId: string | undefined = Array.from(reports.keys()).find(
        (key: string): boolean => {
          return walkIdFor(key) === id;
        },
      );

      if (deviceId) {
        return reports.get(deviceId)!;
      }

      const owner: NetworkDevice | undefined = devices.find(
        (entry: NetworkDevice): boolean => {
          return walkIdFor(entry._id!.toString()) === id;
        },
      );

      return diagnostic(id, owner?._id?.toString() || DEVICE_A);
    });

    return Promise.resolve({
      data: data,
      count: data.length,
      skip: 0,
      limit: 100,
    });
  });

  createMock.mockImplementation((request: unknown) => {
    const model: NetworkDeviceDiagnostic = (
      request as { model: NetworkDeviceDiagnostic }
    ).model;

    return Promise.resolve({
      data: diagnostic(
        walkIdFor(model.networkDeviceId!.toString()),
        model.networkDeviceId!.toString(),
      ),
    });
  });

  updateMock.mockResolvedValue({ data: {} });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("before anything is walked", () => {
  test("names the devices picked, offers the start points, and says nothing was walked yet", async () => {
    await renderCard();

    expect(screen.getByTestId("multi-snmp-walk-form")).toBeInTheDocument();
    expect(screen.getByText("mx-amsterdam")).toBeInTheDocument();
    expect(screen.getByText("mx-berlin")).toBeInTheDocument();
    expect(screen.getByText("mx-cardiff")).toBeInTheDocument();

    for (const oid of [
      "1.3.6.1",
      "1.3.6.1.2.1.1",
      "1.3.6.1.2.1.2",
      "1.3.6.1.2.1.25",
      "1.3.6.1.4.1",
    ]) {
      expect(
        screen.getByTestId(`multi-snmp-walk-start-point-${oid}`),
      ).toBeInTheDocument();
    }

    expect(
      screen.getByTestId("multi-snmp-walk-start-point-1.3.6.1"),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("multi-snmp-walk-empty")).toHaveTextContent(
      "Not walked yet.",
    );
    expect(screen.getByTestId("multi-snmp-walk-start")).not.toBeDisabled();
    expect(createMock).not.toHaveBeenCalled();
  });

  /*
   * The page never asks for a device's credentials: they stay on the
   * server, which hands them to the probe that walks.
   */
  test("reads the devices without a single credential column", async () => {
    await renderCard();

    const requests: Array<ListRequest> = deviceListMock.mock.calls.map(
      (call: Array<unknown>): ListRequest => {
        return call[0] as ListRequest;
      },
    );

    expect(requests.length).toBeGreaterThan(0);

    for (const request of requests) {
      for (const secret of [
        "snmpCommunityString",
        "snmpV3Username",
        "snmpV3AuthKey",
        "snmpV3PrivKey",
        "snmpV3Auth",
        "snmpCredentialProfile",
      ]) {
        expect(request.select).not.toHaveProperty(secret);
      }
    }

    const cardRead: ListRequest = requests.find((request: ListRequest) => {
      return request.select["oidTemplate"] !== undefined;
    })!;

    expect(cardRead.select).toMatchObject({
      probeId: true,
      monitoringMethod: true,
      snmpOids: true,
      oidTemplateId: true,
    });
    expect(idsOf(cardRead.query, "_id").sort()).toEqual(
      [DEVICE_A, DEVICE_B, DEVICE_C].sort(),
    );
  });

  test("a link without devices offers nothing to walk yet", async () => {
    await renderCard({ query: { deviceIds: [], startOid: "" } });

    expect(screen.getByTestId("multi-snmp-walk-start")).toBeDisabled();
  });

  test("a MIB name is refused before anything is asked", async () => {
    await renderCard();
    await typeStart("sysDescr");

    expect(screen.getByTestId("multi-snmp-walk-start-invalid")).toHaveTextContent(
      "Use a numeric OID such as 1.3.6.1.2.1.1, not a MIB name.",
    );
    expect(screen.getByTestId("multi-snmp-walk-start")).toBeDisabled();
  });

  test("a start point fills the OID it stands for", async () => {
    await renderCard();
    await click(screen.getByTestId("multi-snmp-walk-start-point-1.3.6.1.4.1"));

    expect(screen.getByTestId("multi-snmp-walk-start-oid")).toHaveValue(
      "1.3.6.1.4.1",
    );
    expect(
      screen.getByTestId("multi-snmp-walk-start-point-1.3.6.1.4.1"),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("the address's OID is where the walk starts", async () => {
    await renderCard({
      query: { deviceIds: [DEVICE_A], startOid: "1.3.6.1.4.1.29671" },
    });

    expect(screen.getByTestId("multi-snmp-walk-start-oid")).toHaveValue(
      "1.3.6.1.4.1.29671",
    );
  });

  test("a device in the address that cannot be read is left out, and the page says so", async () => {
    await renderCard({
      query: {
        deviceIds: [DEVICE_A, "99999999-9999-4999-8999-999999999999"],
        startOid: "",
      },
    });

    expect(screen.getByTestId("multi-snmp-walk-unreadable")).toHaveTextContent(
      "1 device in this page's address could not be read, so it was left out.",
    );
  });

  test("more devices than one walk takes are said, and the first fifty can be kept with one press", async () => {
    const many: Array<string> = [];

    for (let index: number = 0; index < MULTI_DEVICE_SNMP_WALK_MAX_DEVICES + 2; index++) {
      const id: string = `aaaaaaaa-aaaa-4aaa-8aaa-${index.toString(16).padStart(12, "0")}`;
      many.push(id);
      devices.push(device(id, `edge-${index}`));
    }

    await renderCard({ query: { deviceIds: many, startOid: "" } });

    expect(screen.getByTestId("multi-snmp-walk-too-many")).toHaveTextContent(
      "Walk up to 50 devices at a time. Remove 2 devices to walk the rest.",
    );
    expect(screen.getByTestId("multi-snmp-walk-start")).toBeDisabled();

    await click(screen.getByTestId("multi-snmp-walk-keep-first"));

    expect(
      screen.queryByTestId("multi-snmp-walk-too-many"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("multi-snmp-walk-start")).not.toBeDisabled();
  });
});

describe("walking the devices", () => {
  test("asks for one walk per device with a probe, under the OID, and nothing else", async () => {
    await renderCard();
    await walk("1.3.6.1.2.1.1");

    const models: Array<NetworkDeviceDiagnostic> = createdFor();

    expect(
      models
        .map((model: NetworkDeviceDiagnostic): string => {
          return model.networkDeviceId!.toString();
        })
        .sort(),
    ).toEqual([DEVICE_A, DEVICE_B].sort());

    for (const model of models) {
      expect(model.diagnosticType).toBe("SNMP Walk");
      expect(model.snmpWalkRootOid).toBe("1.3.6.1.2.1.1");
      expect(model.snmpWalkAfterOid).toBeUndefined();
      // The server fills the probe and the address from the device.
      expect(model.probeId).toBeUndefined();
      expect(model.hostname).toBeUndefined();
    }
  });

  test("keeps the walk in the page's address", async () => {
    await renderCard();
    await walk(".1.3.6.1.2.1.1");

    expect(queryChangeMock).toHaveBeenCalledWith({
      deviceIds: [DEVICE_A, DEVICE_B, DEVICE_C],
      startOid: "1.3.6.1.2.1.1",
    });
  });

  test("an empty start walks everything", async () => {
    await renderCard();
    await click(screen.getByTestId("multi-snmp-walk-start"));

    expect(createdFor()[0]!.snmpWalkRootOid).toBe("1.3.6.1");
  });

  test("says it is walking, how many have finished, and a device with no probe is not walked", async () => {
    await renderCard();
    await walk();

    expect(screen.getByTestId("multi-snmp-walk-running")).toHaveTextContent(
      "Walking 1.3.6.1.2.1.1 on 3 devices…",
    );
    expect(screen.getByTestId("multi-snmp-walk-progress")).toHaveTextContent(
      "1 of 3 walks finished.",
    );
    expect(screen.getByTestId("multi-snmp-walk")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(chip(DEVICE_A)).toHaveTextContent("Walking…");
    expect(chip(DEVICE_C)).toHaveAttribute("data-status", "notStarted");
    expect(chip(DEVICE_C)).toHaveTextContent("Not walked");
    // Nothing to change while the walk runs.
    expect(screen.getByTestId("multi-snmp-walk-start")).toBeDisabled();
    expect(screen.getByTestId("multi-snmp-walk-start-oid")).toHaveAttribute(
      "readonly",
    );
  });

  test("reads every walk still on its way in one request, and each device's answer as it lands", async () => {
    await renderCard();
    await walk();

    reports.set(
      DEVICE_A,
      completed(walkIdFor(DEVICE_A), DEVICE_A, [
        walkRow(SYS_DESCR, SnmpDataType.OctetString, "Meraki MX67"),
        walkRow(SYS_NAME, SnmpDataType.OctetString, "mx-amsterdam"),
      ]),
    );

    await tick();

    const first: ListRequest = pollRequests()[0]!;

    expect(idsOf(first.query, "_id").sort()).toEqual(
      [walkIdFor(DEVICE_A), walkIdFor(DEVICE_B)].sort(),
    );
    expect(first.select).toMatchObject({ snmpWalkResult: true, status: true });
    expect(chip(DEVICE_A)).toHaveTextContent("2 OIDs");
    expect(chip(DEVICE_B)).toHaveTextContent("Walking…");
    // What has landed is shown while the rest walks.
    expect(rowsShown()).toEqual([SYS_DESCR, SYS_NAME]);
    expect(screen.getByTestId("multi-snmp-walk-progress")).toHaveTextContent(
      "2 of 3 walks finished.",
    );

    reports.set(
      DEVICE_B,
      completed(walkIdFor(DEVICE_B), DEVICE_B, [
        walkRow(SYS_DESCR, SnmpDataType.OctetString, "Meraki MX68"),
        walkRow(SYS_UPTIME, SnmpDataType.TimeTicks, 104524500),
      ]),
    );

    await tick();

    // Only the walk still on its way was asked for again.
    expect(idsOf(pollRequests()[1]!.query, "_id")).toEqual([
      walkIdFor(DEVICE_B),
    ]);
    expect(rowsShown()).toEqual([SYS_DESCR, SYS_UPTIME, SYS_NAME]);
    expect(
      screen.queryByTestId("multi-snmp-walk-running"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("multi-snmp-walk-summary")).toHaveTextContent(
      "3 OIDs under 1.3.6.1.2.1.1.",
    );
    expect(screen.getByTestId("multi-snmp-walk-meta")).toHaveTextContent(
      "2 of 3 devices answered",
    );

    // Once every walk is in, nothing is read again.
    const polls: number = pollRequests().length;
    await tick(3);
    expect(pollRequests()).toHaveLength(polls);
  });

  test("a device the server will not walk says the server's reason, and where it is fixed", async () => {
    createMock.mockImplementation((request: unknown) => {
      const model: NetworkDeviceDiagnostic = (
        request as { model: NetworkDeviceDiagnostic }
      ).model;

      if (model.networkDeviceId!.toString() === DEVICE_B) {
        return Promise.reject(new Error(SNMP_WALK_NO_CREDENTIALS_MESSAGE));
      }

      return Promise.resolve({
        data: diagnostic(walkIdFor(DEVICE_A), DEVICE_A),
      });
    });

    await renderCard();
    await walk();

    expect(chip(DEVICE_B)).toHaveAttribute("data-status", "notStarted");

    const problems: HTMLElement = screen.getByTestId("multi-snmp-walk-problems");
    const problemB: HTMLElement = within(problems)
      .getAllByTestId("multi-snmp-walk-problem")
      .find((element: HTMLElement): boolean => {
        return element.getAttribute("data-device-id") === DEVICE_B;
      })!;

    expect(problemB).toHaveTextContent("mx-berlin: Not walked");
    expect(problemB).toHaveTextContent(SNMP_WALK_NO_CREDENTIALS_MESSAGE);
    expect(
      within(problemB).getByTestId("multi-snmp-walk-problem-settings"),
    ).toHaveTextContent("Open the device's Settings");

    // The device with no probe is listed too, with the same way to fix it.
    const problemC: HTMLElement = within(problems)
      .getAllByTestId("multi-snmp-walk-problem")
      .find((element: HTMLElement): boolean => {
        return element.getAttribute("data-device-id") === DEVICE_C;
      })!;

    expect(problemC).toHaveTextContent(
      "This device has no probe assigned, so there is nothing to walk it from.",
    );
    expect(
      within(problemC).getByTestId("multi-snmp-walk-problem-settings"),
    ).toBeInTheDocument();
    expect(problems).toHaveTextContent("2 devices were not walked in full");
  });

  test("a device that did not answer is listed with what to check, and is left out of the comparison", async () => {
    await renderCard();
    await walk();

    reports.set(
      DEVICE_A,
      completed(walkIdFor(DEVICE_A), DEVICE_A, [
        walkRow(SYS_NAME, SnmpDataType.OctetString, "mx-amsterdam"),
      ]),
    );
    reports.set(
      DEVICE_B,
      completed(walkIdFor(DEVICE_B), DEVICE_B, [], {
        stopReason: SnmpWalkStopReason.Failed,
        failure: { kind: SnmpWalkFailureKind.Timeout, message: "timeout" },
      }),
    );

    await tick();

    expect(chip(DEVICE_B)).toHaveTextContent("The device did not answer");
    expect(screen.getByTestId("multi-snmp-walk-problems")).toHaveTextContent(
      "community string",
    );
    expect(
      within(rowFor(SYS_NAME)).getByTestId("multi-snmp-walk-row-answered"),
    ).toHaveTextContent("1 of 1 device");
  });

  test("a walk whose row is gone says so", async () => {
    await renderCard();
    await walk();

    walkListMock.mockImplementation(() => {
      return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
    });

    await tick();

    expect(chip(DEVICE_A)).toHaveAttribute("data-status", "probeFailed");
    expect(screen.getByTestId("multi-snmp-walk-problems")).toHaveTextContent(
      "This walk no longer exists. The device or its probe may have been deleted.",
    );
  });

  test("stops waiting after five minutes, and names the probe that never reported", async () => {
    await renderCard();
    await walk();

    reports.set(
      DEVICE_A,
      completed(walkIdFor(DEVICE_A), DEVICE_A, [
        walkRow(SYS_NAME, SnmpDataType.OctetString, "mx-amsterdam"),
      ]),
    );

    await tick(MULTI_DEVICE_SNMP_WALK_MAX_POLL_ATTEMPTS + 1);

    expect(
      MULTI_DEVICE_SNMP_WALK_MAX_POLL_ATTEMPTS *
        MULTI_DEVICE_SNMP_WALK_POLL_INTERVAL_IN_MS,
    ).toBeGreaterThanOrEqual(MULTI_DEVICE_SNMP_WALK_WAIT_IN_MS);
    expect(chip(DEVICE_B)).toHaveAttribute("data-status", "timedOut");
    expect(chip(DEVICE_B)).toHaveTextContent("No answer from the probe");
    expect(screen.getByTestId("multi-snmp-walk-problems")).toHaveTextContent(
      'The probe "Rack 3" did not report the walk within five minutes.',
    );
    expect(
      screen.queryByTestId("multi-snmp-walk-running"),
    ).not.toBeInTheDocument();
    // What did land stays.
    expect(rowsShown()).toEqual([SYS_NAME]);
  });

  test("stops after reads fail in a row, and says why", async () => {
    await renderCard();
    await walk();

    walkListMock.mockImplementation(() => {
      return Promise.reject(new Error("Network error"));
    });

    await tick(MULTI_DEVICE_SNMP_WALK_MAX_CONSECUTIVE_POLL_FAILURES);

    expect(screen.getByTestId("multi-snmp-walk-error")).toHaveTextContent(
      "Network error",
    );
    expect(chip(DEVICE_A)).toHaveAttribute("data-status", "timedOut");
    expect(
      screen.queryByTestId("multi-snmp-walk-running"),
    ).not.toBeInTheDocument();
  });

  test("a read that fails once is tried again", async () => {
    await renderCard();
    await walk();

    walkListMock.mockImplementationOnce(() => {
      return Promise.reject(new Error("Network error"));
    });
    reports.set(
      DEVICE_A,
      completed(walkIdFor(DEVICE_A), DEVICE_A, [
        walkRow(SYS_NAME, SnmpDataType.OctetString, "mx-amsterdam"),
      ]),
    );
    reports.set(
      DEVICE_B,
      completed(walkIdFor(DEVICE_B), DEVICE_B, [
        walkRow(SYS_NAME, SnmpDataType.OctetString, "mx-berlin"),
      ]),
    );

    await tick(2);

    expect(screen.queryByTestId("multi-snmp-walk-error")).not.toBeInTheDocument();
    expect(rowsShown()).toEqual([SYS_NAME]);
  });

  test("a walk that stopped at its limit says there is more to read, and where to read it", async () => {
    await renderCard();
    await walk();

    reports.set(
      DEVICE_A,
      completed(
        walkIdFor(DEVICE_A),
        DEVICE_A,
        [walkRow(SYS_DESCR, SnmpDataType.OctetString, "x")],
        { stopReason: SnmpWalkStopReason.OidLimit, nextOid: SYS_DESCR },
      ),
    );
    reports.set(
      DEVICE_B,
      completed(walkIdFor(DEVICE_B), DEVICE_B, [
        walkRow(SYS_DESCR, SnmpDataType.OctetString, "x"),
        walkRow(SYS_NAME, SnmpDataType.OctetString, "mx-berlin"),
      ]),
    );

    await tick();

    expect(chip(DEVICE_A)).toHaveTextContent("1 OID so far, more to read");
    expect(screen.getByTestId("multi-snmp-walk-more-to-read")).toHaveTextContent(
      "One device's walk stopped at its limit with more to read.",
    );
    // A's walk stopped before sysName: it is not counted as missing it.
    expect(
      within(rowFor(SYS_NAME)).getByTestId("multi-snmp-walk-row-answered"),
    ).toHaveTextContent("1 of 1 device");
    expect(
      within(rowFor(SYS_NAME)).getByTestId("multi-snmp-walk-row-not-reached"),
    ).toHaveTextContent("1 walk stopped before it");
  });

  test("each device's name opens its own SNMP Walk page, which opens on this walk", async () => {
    await renderCard();
    await walk();

    const link: HTMLElement = within(chip(DEVICE_A)).getByText("mx-amsterdam");

    expect(link.closest("a")).toHaveAttribute(
      "href",
      expect.stringContaining(`/network-devices/${DEVICE_A}/snmp-walk`),
    );
  });
});

describe("the devices' answers, side by side", () => {
  async function walkFleet(): Promise<void> {
    await renderCard({
      query: { deviceIds: [DEVICE_A, DEVICE_B, DEVICE_T], startOid: "" },
    });
    await walk();

    reports.set(
      DEVICE_A,
      completed(walkIdFor(DEVICE_A), DEVICE_A, [
        walkRow(SYS_DESCR, SnmpDataType.OctetString, "Meraki MX67"),
        walkRow(SYS_UPTIME, SnmpDataType.TimeTicks, 100),
        walkRow(SYS_NAME, SnmpDataType.OctetString, "mx-amsterdam"),
        walkRow(SYS_LOCATION, SnmpDataType.OctetString, "Amsterdam"),
      ]),
    );
    reports.set(
      DEVICE_B,
      completed(walkIdFor(DEVICE_B), DEVICE_B, [
        walkRow(SYS_DESCR, SnmpDataType.OctetString, "Meraki MX67"),
        walkRow(SYS_UPTIME, SnmpDataType.TimeTicks, 104524500),
        walkRow(SYS_NAME, SnmpDataType.OctetString, "mx-berlin"),
      ]),
    );
    reports.set(
      DEVICE_T,
      completed(walkIdFor(DEVICE_T), DEVICE_T, [
        walkRow(SYS_DESCR, SnmpDataType.OctetString, "Meraki MX67"),
        walkRow(SYS_UPTIME, SnmpDataType.TimeTicks, 5000),
        walkRow(SYS_NAME, SnmpDataType.OctetString, "mx-berlin"),
      ]),
    );

    await tick();
  }

  test("one row an OID, in OID order, with how many devices answer it", async () => {
    await walkFleet();

    expect(rowsShown()).toEqual([SYS_DESCR, SYS_UPTIME, SYS_NAME, SYS_LOCATION]);
    expect(
      within(rowFor(SYS_DESCR)).getByTestId("multi-snmp-walk-row-answered"),
    ).toHaveTextContent("3 of 3 devices");
    expect(
      within(rowFor(SYS_LOCATION)).getByTestId("multi-snmp-walk-row-answered"),
    ).toHaveTextContent("1 of 3 devices");
    expect(
      within(rowFor(SYS_DESCR)).getByTestId("multi-snmp-walk-row-name"),
    ).toHaveTextContent("sysDescr.0");
  });

  test("their values in a few words: the value they agree on, a range, or how many differ", async () => {
    await walkFleet();

    expect(rowFor(SYS_DESCR)).toHaveTextContent("Meraki MX67");
    expect(
      within(rowFor(SYS_UPTIME)).getByTestId("multi-snmp-walk-row-range"),
    ).toHaveTextContent("00:00:01 to 12 days, 02:20:45");
    expect(
      within(rowFor(SYS_NAME)).getByTestId("multi-snmp-walk-row-different"),
    ).toHaveTextContent("2 different values");
  });

  test("Answered by opens each device's own answer, and says which device lacks the OID", async () => {
    await walkFleet();

    const toggle: HTMLElement = within(rowFor(SYS_LOCATION)).getByTestId(
      "multi-snmp-walk-row-answered",
    );

    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");

    const answers: Array<HTMLElement> = within(rowFor(SYS_LOCATION)).getAllByTestId(
      "multi-snmp-walk-row-answer",
    );

    expect(
      answers.map((element: HTMLElement): [string, string] => {
        return [
          element.getAttribute("data-device-id") || "",
          element.getAttribute("data-answer") || "",
        ];
      }),
    ).toEqual([
      [DEVICE_A, "answered"],
      [DEVICE_B, "missing"],
      [DEVICE_T, "missing"],
    ]);
    expect(answers[0]).toHaveTextContent("mx-amsterdam");
    expect(answers[0]).toHaveTextContent("Amsterdam");
    expect(answers[1]).toHaveTextContent("Not answered");
  });

  test("filters by OID, name or any device's value, and can show only what some devices lack", async () => {
    await walkFleet();

    await act(async () => {
      fireEvent.change(screen.getByTestId("multi-snmp-walk-filter"), {
        target: { value: "berlin" },
      });
    });

    expect(rowsShown()).toEqual([SYS_NAME]);
    expect(screen.getByTestId("multi-snmp-walk-filter-count")).toHaveTextContent(
      "1 of 4 OIDs matches.",
    );

    await act(async () => {
      fireEvent.change(screen.getByTestId("multi-snmp-walk-filter"), {
        target: { value: "" },
      });
    });

    await click(screen.getByTestId("multi-snmp-walk-only-missing"));

    expect(rowsShown()).toEqual([SYS_LOCATION]);
  });

  test("Collect adds the OID to every device that answers it, reading each list fresh, and says so in the row", async () => {
    devices[0]!.snmpOids = [{ oid: "1.3.6.1.4.1.9.2.1.58.0", name: "CPU" }];

    await walkFleet();

    const collect: HTMLElement = within(rowFor(SYS_DESCR)).getByTestId(
      "multi-snmp-walk-row-collect",
    );

    expect(collect).toHaveTextContent("Collect on 3 devices");

    await click(collect);

    const freshRead: ListRequest = deviceListMock.mock.calls
      .map((call: Array<unknown>): ListRequest => {
        return call[0] as ListRequest;
      })
      .find((request: ListRequest): boolean => {
        return (
          request.select["snmpOids"] === true &&
          request.select["oidTemplate"] === undefined
        );
      })!;

    expect(idsOf(freshRead.query, "_id").sort()).toEqual(
      [DEVICE_A, DEVICE_B, DEVICE_T].sort(),
    );

    const writes: Map<string, Array<SnmpOid>> = new Map(
      updateMock.mock.calls.map((call: Array<unknown>) => {
        const request: {
          modelType: unknown;
          id: ObjectID;
          data: { snmpOids: Array<SnmpOid> };
        } = call[0] as {
          modelType: unknown;
          id: ObjectID;
          data: { snmpOids: Array<SnmpOid> };
        };

        expect(request.modelType).toBe(NetworkDevice);

        return [request.id.toString(), request.data.snmpOids];
      }),
    );

    expect(Array.from(writes.keys()).sort()).toEqual(
      [DEVICE_A, DEVICE_B, DEVICE_T].sort(),
    );
    // What the device collected before stays, the new OID after it.
    expect(
      writes.get(DEVICE_A)!.map((entry: SnmpOid): string => {
        return entry.oid;
      }),
    ).toEqual(["1.3.6.1.4.1.9.2.1.58.0", SYS_DESCR]);
    expect(writes.get(DEVICE_B)![0]).toMatchObject({
      oid: SYS_DESCR,
      name: "sysDescr.0",
    });

    expect(
      within(rowFor(SYS_DESCR)).getByTestId("multi-snmp-walk-collect-notice"),
    ).toHaveTextContent("Collected on 3 devices from their next poll on");
    expect(
      within(rowFor(SYS_DESCR)).getByTestId("multi-snmp-walk-row-collected"),
    ).toHaveTextContent("Collected");
    expect(
      within(rowFor(SYS_DESCR)).queryByTestId("multi-snmp-walk-row-collect"),
    ).not.toBeInTheDocument();
  });

  test("a device that refuses is named with why, and the others still collect it", async () => {
    updateMock.mockImplementation((request: unknown) => {
      if ((request as { id: ObjectID }).id.toString() === DEVICE_B) {
        return Promise.reject(
          new Error("This device already collects 50 device-specific OIDs."),
        );
      }

      return Promise.resolve({ data: {} });
    });

    await walkFleet();
    await click(
      within(rowFor(SYS_DESCR)).getByTestId("multi-snmp-walk-row-collect"),
    );

    const notice: HTMLElement = within(rowFor(SYS_DESCR)).getByTestId(
      "multi-snmp-walk-collect-notice",
    );

    expect(notice).toHaveTextContent(
      "Collected on 2 of 3 devices. Not on these:",
    );
    expect(
      within(notice).getByTestId("multi-snmp-walk-collect-failures"),
    ).toHaveTextContent(
      "mx-berlin: This device already collects 50 device-specific OIDs.",
    );
    expect(
      within(rowFor(SYS_DESCR)).getByTestId("multi-snmp-walk-row-collected"),
    ).toHaveTextContent("Collected on 2 of 3");
    // B can still be collected on.
    expect(
      within(rowFor(SYS_DESCR)).getByTestId("multi-snmp-walk-row-collect"),
    ).toHaveTextContent("Collect on 1 device");
  });

  test("a device that already collects the OID - its own or its template's - is not written again", async () => {
    devices[1]!.snmpOids = [{ oid: SYS_DESCR }];
    devices[4]!.oidTemplate!.oids = [{ oid: SYS_DESCR }];

    await walkFleet();

    expect(
      within(rowFor(SYS_DESCR)).getByTestId("multi-snmp-walk-row-collected"),
    ).toHaveTextContent("Collected on 2 of 3");
    expect(
      within(rowFor(SYS_DESCR)).getByTestId("multi-snmp-walk-row-collect"),
    ).toHaveTextContent("Collect on 1 device");

    await click(
      within(rowFor(SYS_DESCR)).getByTestId("multi-snmp-walk-row-collect"),
    );

    expect(
      updateMock.mock.calls.map((call: Array<unknown>): string => {
        return (call[0] as { id: ObjectID }).id.toString();
      }),
    ).toEqual([DEVICE_A]);
  });

  test("a monitor-backed device answers, but nothing is collected on it", async () => {
    await renderCard({
      query: { deviceIds: [DEVICE_A, DEVICE_D], startOid: "" },
    });
    await walk();

    for (const deviceId of [DEVICE_A, DEVICE_D]) {
      reports.set(
        deviceId,
        completed(walkIdFor(deviceId), deviceId, [
          walkRow(SYS_NAME, SnmpDataType.OctetString, deviceId),
        ]),
      );
    }

    await tick();

    expect(
      within(rowFor(SYS_NAME)).getByTestId("multi-snmp-walk-row-answered"),
    ).toHaveTextContent("2 of 2 devices");
    expect(
      within(rowFor(SYS_NAME)).getByTestId("multi-snmp-walk-row-collect"),
    ).toHaveTextContent("Collect on 1 device");
  });

  test("the row's menu adds the OID to the template its devices use, for every device that uses it", async () => {
    getItemMock.mockResolvedValue(
      Object.assign(new NetworkDeviceOidTemplate(), {
        oids: [{ oid: "1.3.6.1.4.1.9.2.1.58.0", name: "CPU" }],
      }),
    );

    await walkFleet();

    await click(
      within(rowFor(SYS_DESCR)).getByTestId("multi-snmp-walk-row-more"),
    );
    await click(screen.getByText("Collect on every device using Edge routers"));

    expect(getItemMock).toHaveBeenCalledTimes(1);
    expect(
      (getItemMock.mock.calls[0]![0] as { id: ObjectID }).id.toString(),
    ).toBe(TEMPLATE_ID);

    const write: {
      modelType: unknown;
      id: ObjectID;
      data: { oids: Array<SnmpOid> };
    } = updateMock.mock.calls[0]![0] as {
      modelType: unknown;
      id: ObjectID;
      data: { oids: Array<SnmpOid> };
    };

    expect(write.modelType).toBe(NetworkDeviceOidTemplate);
    expect(write.id.toString()).toBe(TEMPLATE_ID);
    expect(
      write.data.oids.map((entry: SnmpOid): string => {
        return entry.oid;
      }),
    ).toEqual(["1.3.6.1.4.1.9.2.1.58.0", SYS_DESCR]);
    expect(
      within(rowFor(SYS_DESCR)).getByTestId("multi-snmp-walk-collect-notice"),
    ).toHaveTextContent(
      "Every device using Edge routers collects it from its next poll on.",
    );
  });

  test("a reader who may not change devices or templates is offered neither", async () => {
    await renderCard({
      query: { deviceIds: [DEVICE_A, DEVICE_T], startOid: "" },
      canEditDevice: false,
      canEditTemplate: false,
    });
    await walk();

    for (const deviceId of [DEVICE_A, DEVICE_T]) {
      reports.set(
        deviceId,
        completed(walkIdFor(deviceId), deviceId, [
          walkRow(SYS_NAME, SnmpDataType.OctetString, deviceId),
        ]),
      );
    }

    await tick();

    expect(
      within(rowFor(SYS_NAME)).queryByTestId("multi-snmp-walk-row-collect"),
    ).not.toBeInTheDocument();

    await click(within(rowFor(SYS_NAME)).getByTestId("multi-snmp-walk-row-more"));

    expect(screen.queryByText(/Collect on every device using/)).toBeNull();
    expect(screen.getByText("Copy OID")).toBeInTheDocument();
  });

  test("Download saves every device's OIDs as one CSV, grouped by device", async () => {
    await walkFleet();
    await click(screen.getByTestId("multi-snmp-walk-download"));

    expect(downloadFileMock).toHaveBeenCalledTimes(1);

    const file: { content: string; filename: string; mimeType: string } =
      downloadFileMock.mock.calls[0]![0] as {
        content: string;
        filename: string;
        mimeType: string;
      };

    const lines: Array<string> = file.content.split("\r\n");

    expect(lines[0]).toContain("Device,OID,Name,MIB,Type,Value");
    expect(lines[1]).toBe(
      "mx-amsterdam,1.3.6.1.2.1.1.1.0,sysDescr.0,SNMPv2-MIB,STRING,Meraki MX67",
    );
    expect(
      lines.filter((line: string): boolean => {
        return line.startsWith("mx-berlin,");
      }),
    ).toHaveLength(3);
    expect(file.filename).toMatch(/^3-devices-snmp-walk-1\.3\.6\.1\.2\.1\.1-/);
    expect(file.mimeType).toContain("text/csv");
  });
});

describe("the last walk, after a reload", () => {
  test("is found again among the devices' walks of the OID, and read whole only for the walks it keeps", async () => {
    const earlier: Date = new Date(Date.now() - 60000);

    walkListMock.mockImplementation((request: unknown) => {
      const query: Record<string, unknown> = (request as ListRequest).query;

      if (query["networkDeviceId"] !== undefined) {
        return Promise.resolve({
          data: [
            diagnostic("restored-a", DEVICE_A, {
              status: "Completed",
              createdAt: earlier,
            }),
            diagnostic("restored-b", DEVICE_B, {
              status: "Completed",
              createdAt: earlier,
            }),
          ],
          count: 2,
          skip: 0,
          limit: MULTI_DEVICE_SNMP_WALK_RESTORE_LIMIT,
        });
      }

      return Promise.resolve({
        data: [
          diagnostic("restored-a", DEVICE_A, {
            status: "Completed",
            createdAt: earlier,
            snmpWalkResult: walkResult([
              walkRow(SYS_NAME, SnmpDataType.OctetString, "mx-amsterdam"),
            ]),
          }),
          diagnostic("restored-b", DEVICE_B, {
            status: "Completed",
            createdAt: earlier,
            snmpWalkResult: walkResult([
              walkRow(SYS_NAME, SnmpDataType.OctetString, "mx-berlin"),
            ]),
          }),
        ],
        count: 2,
        skip: 0,
        limit: 2,
      });
    });

    await renderCard({
      query: { deviceIds: [DEVICE_A, DEVICE_B], startOid: ROOT },
    });

    const [summaryRead, fullRead]: Array<ListRequest> =
      walkListMock.mock.calls.map((call: Array<unknown>): ListRequest => {
        return call[0] as ListRequest;
      });

    expect(idsOf(summaryRead!.query, "networkDeviceId").sort()).toEqual(
      [DEVICE_A, DEVICE_B].sort(),
    );
    expect(summaryRead!.query["diagnosticType"]).toBe("SNMP Walk");
    expect(summaryRead!.query["snmpWalkRootOid"]).toBe(ROOT);
    // The light read never carries the walks' results.
    expect(summaryRead!.select).not.toHaveProperty("snmpWalkResult");
    expect(String(summaryRead!.sort["createdAt"]).toLowerCase()).toContain(
      "desc",
    );
    expect(idsOf(fullRead!.query, "_id").sort()).toEqual(
      ["restored-a", "restored-b"].sort(),
    );
    expect(fullRead!.select).toMatchObject({ snmpWalkResult: true });

    expect(rowsShown()).toEqual([SYS_NAME]);
    expect(chip(DEVICE_A)).toHaveTextContent("1 OID");
    expect(screen.getByTestId("multi-snmp-walk-meta")).toHaveTextContent(
      "Walked",
    );
    expect(
      screen.queryByTestId("multi-snmp-walk-empty"),
    ).not.toBeInTheDocument();
  });

  test("a walk still on its way is followed to its end, and one asked for too long ago is not waited for", async () => {
    const justNow: Date = new Date(Date.now() - 10000);
    const longAgo: Date = new Date(
      Date.now() - MULTI_DEVICE_SNMP_WALK_WAIT_IN_MS - 1000,
    );
    let isReported: boolean = false;

    walkListMock.mockImplementation((request: unknown) => {
      const query: Record<string, unknown> = (request as ListRequest).query;

      if (query["networkDeviceId"] !== undefined) {
        return Promise.resolve({
          data: [
            diagnostic("running-a", DEVICE_A, { createdAt: justNow }),
            diagnostic("stale-b", DEVICE_B, { createdAt: longAgo }),
          ],
          count: 2,
          skip: 0,
          limit: MULTI_DEVICE_SNMP_WALK_RESTORE_LIMIT,
        });
      }

      const ids: Array<string> = idsOf(query, "_id");

      return Promise.resolve({
        data: ids.map((id: string): NetworkDeviceDiagnostic => {
          if (id === "running-a") {
            return isReported
              ? diagnostic("running-a", DEVICE_A, {
                  status: "Completed",
                  createdAt: justNow,
                  snmpWalkResult: walkResult([
                    walkRow(SYS_NAME, SnmpDataType.OctetString, "mx-amsterdam"),
                  ]),
                })
              : diagnostic("running-a", DEVICE_A, {
                  status: "In Progress",
                  createdAt: justNow,
                });
          }

          return diagnostic("stale-b", DEVICE_B, { createdAt: longAgo });
        }),
        count: ids.length,
        skip: 0,
        limit: ids.length,
      });
    });

    await renderCard({
      query: { deviceIds: [DEVICE_A, DEVICE_B], startOid: ROOT },
    });

    /*
     * Both walks are of one press of Walk - within the window of the newest
     * - but B's was asked for longer ago than the page waits: it is not
     * coming, and only A's is followed.
     */
    expect(screen.getByTestId("multi-snmp-walk-running")).toBeInTheDocument();
    expect(chip(DEVICE_A)).toHaveTextContent("Walking…");
    expect(chip(DEVICE_B)).toHaveAttribute("data-status", "timedOut");

    isReported = true;
    await tick();

    expect(chip(DEVICE_A)).toHaveTextContent("1 OID");
    expect(
      screen.queryByTestId("multi-snmp-walk-running"),
    ).not.toBeInTheDocument();
    // Only the walk on its way was read again, never the stale one.
    expect(
      pollRequests()
        .slice(1)
        .map((request: ListRequest): Array<string> => {
          return idsOf(request.query, "_id");
        }),
    ).toEqual([["running-a"]]);
  });

  test("a walk asked for longer ago than the page waits reads as not reported", async () => {
    const longAgo: Date = new Date(
      Date.now() - MULTI_DEVICE_SNMP_WALK_WAIT_IN_MS - 1000,
    );

    walkListMock.mockImplementation(() => {
      return Promise.resolve({
        data: [diagnostic("stale-a", DEVICE_A, { createdAt: longAgo })],
        count: 1,
        skip: 0,
        limit: 1,
      });
    });

    await renderCard({ query: { deviceIds: [DEVICE_A], startOid: ROOT } });

    expect(chip(DEVICE_A)).toHaveAttribute("data-status", "timedOut");
    expect(
      screen.queryByTestId("multi-snmp-walk-running"),
    ).not.toBeInTheDocument();
  });

  test("a reader who may not walk reads the last walk, and is offered no form", async () => {
    walkListMock.mockImplementation((request: unknown) => {
      const query: Record<string, unknown> = (request as ListRequest).query;
      const restored: NetworkDeviceDiagnostic = diagnostic(
        "restored-a",
        DEVICE_A,
        {
          status: "Completed",
          snmpWalkResult: walkResult([
            walkRow(SYS_NAME, SnmpDataType.OctetString, "mx-amsterdam"),
          ]),
        },
      );

      return Promise.resolve({
        data: [restored],
        count: query["networkDeviceId"] !== undefined ? 1 : 1,
        skip: 0,
        limit: 1,
      });
    });

    await renderCard({
      query: { deviceIds: [DEVICE_A], startOid: ROOT },
      canWalk: false,
    });

    expect(screen.queryByTestId("multi-snmp-walk-form")).not.toBeInTheDocument();
    expect(screen.getByTestId("multi-snmp-walk-read-only")).toHaveTextContent(
      "You can read this walk. Walking devices needs the Create Network Device Diagnostic permission.",
    );
    expect(rowsShown()).toEqual([SYS_NAME]);
  });

  test("a reader who may not walk, with nothing walked, is told what walking needs", async () => {
    await renderCard({ canWalk: false });

    expect(screen.getByTestId("multi-snmp-walk-read-only")).toHaveTextContent(
      "Walking devices needs the Create Network Device Diagnostic permission.",
    );
    expect(screen.queryByTestId("multi-snmp-walk-empty")).not.toBeInTheDocument();
  });

  test("a page whose walks cannot be read still opens, with nothing walked", async () => {
    walkListMock.mockImplementation(() => {
      return Promise.reject(new Error("Permission denied"));
    });

    await renderCard({ query: { deviceIds: [DEVICE_A], startOid: ROOT } });

    expect(screen.getByTestId("multi-snmp-walk-empty")).toBeInTheDocument();
    expect(
      screen.queryByTestId("multi-snmp-walk-load-error"),
    ).not.toBeInTheDocument();
  });

  test("devices that cannot be read at all say why instead of a form", async () => {
    deviceListMock.mockImplementation(() => {
      return Promise.reject(new Error("You do not have permission"));
    });

    await renderCard();

    expect(screen.getByTestId("multi-snmp-walk-load-error")).toHaveTextContent(
      "You do not have permission",
    );
  });
});

describe("picking devices", () => {
  test("a device picked from the list is read before it is walked, and walked with the rest", async () => {
    await renderCard({ query: { deviceIds: [DEVICE_A], startOid: "" } });

    await click(screen.getByTestId("multi-snmp-walk-devices"));
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    await flush();
    await flush();

    const option: HTMLElement = screen
      .getAllByRole("option")
      .find((element: HTMLElement): boolean => {
        return element.textContent?.includes("mx-berlin") || false;
      })!;

    await click(option);

    const reads: Array<ListRequest> = deviceListMock.mock.calls
      .map((call: Array<unknown>): ListRequest => {
        return call[0] as ListRequest;
      })
      .filter((request: ListRequest): boolean => {
        return request.select["oidTemplate"] !== undefined;
      });

    expect(idsOf(reads[reads.length - 1]!.query, "_id")).toEqual([DEVICE_B]);

    await walk();

    expect(
      createdFor()
        .map((model: NetworkDeviceDiagnostic): string => {
          return model.networkDeviceId!.toString();
        })
        .sort(),
    ).toEqual([DEVICE_A, DEVICE_B].sort());
  });
});
