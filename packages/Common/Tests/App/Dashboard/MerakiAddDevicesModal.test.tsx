/** @timezone UTC */

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
import userEvent, { UserEvent } from "@testing-library/user-event";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Add Meraki devices (MerakiAddDevicesModal), drawn for real: one question
 * - which kinds of device, each with how many the connection's last read
 * counted, the network gear ticked and cameras not - and under it what of
 * those kinds is not added, and why. The sites and the probe are folded
 * under More fields, saying what they are set to while folded; an ask
 * remembers its choices for the next one. The ask is POSTed to the
 * connection's add-devices route with exactly the choices made, and a
 * refusal is said in the dialog. The network is replaced.
 */

const CONNECTION_ID: string = "11111111-1111-4111-8111-111111111111";
const STORE_PROBE: string = "30000000-0000-4000-8000-000000000001";
const LAB_PROBE: string = "30000000-0000-4000-8000-000000000002";
const GLOBAL_PROBE: string = "30000000-0000-4000-8000-000000000009";
const USER_ID: string = "33333333-3333-4333-8333-333333333333";

const apiPostMock: MockFunction = getJestMockFunction();
let probes: Array<{ id: string; name: string; isGlobal: boolean }>;

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>): unknown => {
        return apiPostMock(...args);
      },
      getFriendlyMessage: (error: Error): string => {
        return error.message;
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return { tenantid: "10000000-0000-4000-8000-000000000001" };
      },
    },
  };
});

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/Probe", () => {
  return {
    __esModule: true,
    default: {
      getAllProbes: async (): Promise<Array<unknown>> => {
        const ProbeClass: { default: new () => Record<string, unknown> } =
          jest.requireActual("../../../Models/DatabaseModels/Probe") as never;

        return probes.map(
          (probe: { id: string; name: string; isGlobal: boolean }) => {
            const model: Record<string, unknown> = new ProbeClass.default();
            model["_id"] = probe.id;
            model["name"] = probe.name;
            model["isGlobalProbe"] = probe.isGlobal;
            return model;
          },
        );
      },
    },
  };
});

import MerakiAddDevicesModal from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkTraffic/Meraki/MerakiAddDevicesModal";
import NetworkControllerConnection from "../../../Models/DatabaseModels/NetworkControllerConnection";
import { JSONObject } from "../../../Types/JSON";
import {
  NetworkControllerDeviceAddState,
  NetworkControllerDeviceAddStatus,
  NetworkControllerUnaddedDeviceCount,
  buildQueuedNetworkControllerDeviceAddState,
  toNetworkControllerDeviceAddStateJson,
} from "../../../Types/NetworkController/NetworkControllerDeviceAdd";
import ObjectID from "../../../Types/ObjectID";

const COUNTS: Array<NetworkControllerUnaddedDeviceCount> = [
  {
    productType: "switch",
    addable: 40,
    withoutAddress: 0,
    taken: 2,
    archived: 0,
  },
  {
    productType: "wireless",
    addable: 70,
    withoutAddress: 0,
    taken: 0,
    archived: 1,
  },
  {
    productType: "appliance",
    addable: 0,
    withoutAddress: 8,
    taken: 0,
    archived: 0,
  },
  {
    productType: "camera",
    addable: 12,
    withoutAddress: 0,
    taken: 0,
    archived: 0,
  },
];

function connection(
  overrides: Record<string, unknown> = {},
): NetworkControllerConnection {
  const value: NetworkControllerConnection = new NetworkControllerConnection();
  value.id = new ObjectID(CONNECTION_ID);
  value.name = "Acme Retail";
  value.isEnabled = true;
  value.config = {
    region: "global",
    organizationId: "549236",
    organizationName: "Acme Retail",
    readIntervalInMinutes: 5,
  };
  value.lastPullResult = {
    status: "success",
    organizationName: "Acme Retail",
    warnings: [],
    unaddedDevices: COUNTS as unknown as JSONObject[],
  };
  Object.assign(value, overrides);
  return value;
}

let onClose: MockFunction;
let onAsked: MockFunction;

async function flush(): Promise<void> {
  for (let i: number = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderModal(
  model: NetworkControllerConnection = connection(),
): Promise<void> {
  render(
    <MerakiAddDevicesModal
      connection={model}
      onClose={onClose}
      onAsked={onAsked}
    />,
  );
  await flush();
}

function kinds(): Array<{ kind: string; checked: boolean; count: string }> {
  return screen
    .getAllByTestId("meraki-add-devices-kind")
    .map((row: HTMLElement) => {
      return {
        kind: row.getAttribute("data-kind") || "",
        checked: (within(row).getByRole("checkbox") as HTMLInputElement)
          .checked,
        count:
          within(row).queryByTestId("meraki-add-devices-kind-count")
            ?.textContent || "",
      };
    });
}

function submit(): HTMLElement {
  return screen.getByTestId("modal-footer-submit-button");
}

function asked(): JSONObject {
  const calls: Array<Array<unknown>> = apiPostMock.mock.calls.filter(
    (call: Array<unknown>) => {
      return String((call[0] as { url: unknown }).url).endsWith(
        `/network-controller-connection/${CONNECTION_ID}/add-devices`,
      );
    },
  );
  expect(calls).toHaveLength(1);
  return (calls[0]![0] as { data: JSONObject }).data;
}

beforeEach(() => {
  probes = [
    { id: STORE_PROBE, name: "Store probe", isGlobal: false },
    { id: GLOBAL_PROBE, name: "OneUptime Cloud", isGlobal: true },
  ];
  apiPostMock.mockReset();
  apiPostMock.mockImplementation(async (request: unknown) => {
    const data: JSONObject = (request as { data: JSONObject }).data;

    return {
      data: {
        lastDeviceAdd: toNetworkControllerDeviceAddStateJson(
          buildQueuedNetworkControllerDeviceAddState({
            request: {
              productTypes: data["productTypes"] as Array<string>,
              groupBySite: data["groupBySite"] as boolean,
            },
            requestedByUserId: USER_ID,
            now: new Date("2026-11-03T10:00:00.000Z"),
          }),
        ),
      },
    };
  });
  onClose = getJestMockFunction();
  onAsked = getJestMockFunction();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("which devices", () => {
  test("the kinds a read counted something to add of, with how many; the network gear ticked, cameras not", async () => {
    await renderModal();

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Add Meraki devices",
    );
    expect(screen.getByTestId("modal-description")).toHaveTextContent(
      "Adds the devices of Acme Retail that are not here yet, at their management addresses. Meraki fills in their model, serial number and firmware.",
    );
    // Security appliances are not listed: none of them can be added.
    expect(kinds()).toEqual([
      { kind: "switch", checked: true, count: "40" },
      { kind: "wireless", checked: true, count: "70" },
      { kind: "camera", checked: false, count: "12" },
    ]);
    expect(submit()).toHaveTextContent("Add 110 devices");
    expect(submit()).toBeEnabled();
  });

  test("each kind is named as people call it, beside its Meraki product line", async () => {
    await renderModal();

    const rows: Array<HTMLElement> = screen.getAllByTestId(
      "meraki-add-devices-kind",
    );
    expect(rows[0]).toHaveTextContent("SwitchesMS");
    expect(rows[1]).toHaveTextContent("Access pointsMR");
    expect(rows[2]).toHaveTextContent("CamerasMV");
  });

  test("a press anywhere on a kind's row ticks it, and a screen reader hears its count with its name", async () => {
    await renderModal();

    const cameras: HTMLElement = screen.getAllByTestId(
      "meraki-add-devices-kind",
    )[2]!;
    // The whole row is the box's label: its name and its count say what it is.
    expect(
      within(cameras).getByRole("checkbox", { name: "Cameras MV 12" }),
    ).not.toBeChecked();

    // The count, at the far end of the row, ticks it as the box does.
    fireEvent.click(
      within(cameras).getByTestId("meraki-add-devices-kind-count"),
    );
    expect(screen.getByTestId("meraki-add-devices-kind-camera")).toBeChecked();
    expect(submit()).toHaveTextContent("Add 122 devices");

    fireEvent.click(within(cameras).getByText("Cameras"));
    expect(
      screen.getByTestId("meraki-add-devices-kind-camera"),
    ).not.toBeChecked();
    expect(submit()).toHaveTextContent("Add 110 devices");
  });

  test("ticking and unticking moves the count on the button; nothing ticked, nothing to add", async () => {
    await renderModal();

    fireEvent.click(screen.getByTestId("meraki-add-devices-kind-camera"));
    expect(submit()).toHaveTextContent("Add 122 devices");

    fireEvent.click(screen.getByTestId("meraki-add-devices-kind-switch"));
    fireEvent.click(screen.getByTestId("meraki-add-devices-kind-wireless"));
    expect(submit()).toHaveTextContent("Add 12 devices");

    fireEvent.click(screen.getByTestId("meraki-add-devices-kind-camera"));
    expect(submit()).toBeDisabled();
  });

  test("one device is said in the singular", async () => {
    await renderModal(
      connection({
        lastPullResult: {
          status: "success",
          organizationName: "Acme Retail",
          warnings: [],
          unaddedDevices: [{ productType: "switch", addable: 1 }],
        },
      }),
    );

    expect(submit()).toHaveTextContent(/^Add 1 device$/);
  });

  test("what of the kinds picked is not added, and why - the security appliances whatever is picked", async () => {
    await renderModal();

    const lines: Array<HTMLElement> = screen.getAllByTestId(
      "meraki-add-devices-not-added-line",
    );
    expect(
      lines.map((line: HTMLElement) => {
        return [line.getAttribute("data-reason"), line.textContent];
      }),
    ).toEqual([
      [
        "without-address",
        "8 devices have no address in Meraki (security appliances list none). Add them by hand at addresses your probe can reach, and Meraki fills in the rest.",
      ],
      [
        "taken",
        "2 devices share their address, MAC address or serial number with network devices already here.",
      ],
      ["archived", "1 device is archived here, so it is not added again."],
    ]);

    // Unticking the switches drops their two from what is said.
    fireEvent.click(screen.getByTestId("meraki-add-devices-kind-switch"));
    expect(
      screen
        .getAllByTestId("meraki-add-devices-not-added-line")
        .map((line: HTMLElement) => {
          return line.getAttribute("data-reason");
        }),
    ).toEqual(["without-address", "archived"]);
  });

  test("a connection read before it could count: every kind, no numbers, and it says when they are counted", async () => {
    await renderModal(
      connection({
        lastPullResult: {
          status: "success",
          organizationName: "Acme Retail",
          warnings: [],
        },
      }),
    );

    expect(
      kinds().map((kind: { kind: string; checked: boolean; count: string }) => {
        return `${kind.kind}:${kind.checked}:${kind.count}`;
      }),
    ).toEqual([
      "switch:true:",
      "wireless:true:",
      "appliance:true:",
      "cellularGateway:true:",
      "wirelessController:true:",
      "campusGateway:true:",
      "camera:false:",
    ]);
    expect(
      screen.getByTestId("meraki-add-devices-uncounted"),
    ).toHaveTextContent(
      "The connection counts its devices at its next read, within a few minutes. Adding them now adds every device of the kinds picked that is not here yet.",
    );
    expect(submit()).toHaveTextContent(/^Add devices$/);
    expect(submit()).toBeEnabled();
  });

  test("counts from before an ask that added devices are not offered: it says the next read counts them", async () => {
    const added: NetworkControllerDeviceAddState = {
      ...buildQueuedNetworkControllerDeviceAddState({
        request: { productTypes: ["switch"], groupBySite: true },
        requestedByUserId: USER_ID,
        now: new Date("2026-11-03T10:00:00.000Z"),
      }),
      status: NetworkControllerDeviceAddStatus.Done,
      updatedAt: "2026-11-03T10:02:00.000Z",
      finishedAt: "2026-11-03T10:02:00.000Z",
      toAddCount: 40,
      addedCount: 40,
    };

    // Read at 10:00, the 40 switches added at 10:02: the read counted them.
    await renderModal(
      connection({
        lastPulledAt: new Date("2026-11-03T10:00:00.000Z"),
        lastDeviceAdd: toNetworkControllerDeviceAddStateJson(added),
      }),
    );

    expect(
      screen.getByTestId("meraki-add-devices-uncounted"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("meraki-add-devices-kind-count")).toBeNull();
    expect(
      screen.queryByTestId("meraki-add-devices-not-added-line"),
    ).toBeNull();
    // The kinds the last ask picked, as ever; no count on the button.
    expect(
      kinds()
        .filter((kind: { checked: boolean }) => {
          return kind.checked;
        })
        .map((kind: { kind: string }) => {
          return kind.kind;
        }),
    ).toEqual(["switch"]);
    expect(submit()).toHaveTextContent(/^Add devices$/);

    // Once a read after the ask counted again, its counts are what is shown.
    cleanup();
    await renderModal(
      connection({
        lastPulledAt: new Date("2026-11-03T10:03:00.000Z"),
        lastDeviceAdd: toNetworkControllerDeviceAddStateJson(added),
      }),
    );
    expect(screen.queryByTestId("meraki-add-devices-uncounted")).toBeNull();
    expect(submit()).toHaveTextContent("Add 40 devices");
  });

  test("nothing left to add: it says so, and Close is the one thing to press", async () => {
    await renderModal(
      connection({
        lastPullResult: {
          status: "success",
          organizationName: "Acme Retail",
          warnings: [],
          unaddedDevices: [{ productType: "appliance", withoutAddress: 4 }],
        },
      }),
    );

    expect(screen.getByTestId("meraki-add-devices-nothing")).toHaveTextContent(
      "Every Meraki device that can be added is a network device here already.",
    );
    expect(screen.queryByTestId("meraki-add-devices-kinds")).toBeNull();
    expect(screen.queryByTestId("meraki-add-devices-more")).toBeNull();
    // Why the appliances are not added is still said.
    expect(
      screen.getByTestId("meraki-add-devices-not-added-line"),
    ).toHaveAttribute("data-reason", "without-address");
    // Not a button that cannot be pressed: Close, alone.
    expect(screen.queryByTestId("modal-footer-submit-button")).toBeNull();
    expect(screen.getByTestId("modal-footer-close-button")).toHaveTextContent(
      /^Close$/,
    );
    fireEvent.click(screen.getByTestId("modal-footer-close-button"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(apiPostMock).not.toHaveBeenCalled();
  });
});

describe("More fields: the sites and the probe", () => {
  test("folded, it says what they are set to: sites named after the networks, the project's one probe", async () => {
    await renderModal();

    const items: Array<HTMLElement> = within(
      screen.getByTestId("meraki-add-devices-more"),
    ).getAllByTestId("folded-section-item");

    expect(
      items.map((item: HTMLElement) => {
        return item.textContent;
      }),
    ).toEqual(["Sites: Named after their networks", "Probe: Store probe"]);
  });

  test("with two probes of the project's own there is no 'the' probe: none, until one is picked", async () => {
    probes.push({ id: LAB_PROBE, name: "Lab probe", isGlobal: false });

    await renderModal();

    expect(
      within(screen.getByTestId("meraki-add-devices-more")).getAllByTestId(
        "folded-section-item",
      )[1],
    ).toHaveTextContent("Probe: No probe");
  });

  test("the sites switched off, a probe picked, and the kinds: exactly what is asked for", async () => {
    const user: UserEvent = userEvent.setup();
    probes.push({ id: LAB_PROBE, name: "Lab probe", isGlobal: false });

    await renderModal();

    await user.click(screen.getByRole("button", { name: "More fields" }));
    fireEvent.click(screen.getByTestId("meraki-add-devices-sites"));

    await user.click(
      within(screen.getByTestId("meraki-add-devices-probe")).getByRole(
        "combobox",
      ),
    );
    const options: Array<HTMLElement> = await screen.findAllByText(
      "Lab probe",
      { exact: true },
    );
    await user.click(options[options.length - 1]!);

    fireEvent.click(screen.getByTestId("meraki-add-devices-kind-camera"));
    fireEvent.click(submit());
    await flush();

    expect(asked()).toEqual({
      productTypes: ["switch", "wireless", "camera"],
      groupBySite: false,
      probeId: LAB_PROBE,
    });
  });

  test("the defaults are asked for as they stand: sites on, the project's one probe", async () => {
    await renderModal();

    fireEvent.click(submit());
    await flush();

    expect(asked()).toEqual({
      productTypes: ["switch", "wireless"],
      groupBySite: true,
      probeId: STORE_PROBE,
    });
  });

  test("the last ask's choices are where the next one starts", async () => {
    const last: NetworkControllerDeviceAddState = {
      ...buildQueuedNetworkControllerDeviceAddState({
        request: { productTypes: ["camera"], groupBySite: false },
        requestedByUserId: USER_ID,
        now: new Date("2026-11-01T10:00:00.000Z"),
      }),
      status: NetworkControllerDeviceAddStatus.Done,
    };

    await renderModal(
      connection({
        lastDeviceAdd: toNetworkControllerDeviceAddStateJson(last),
      }),
    );

    expect(kinds()).toEqual([
      { kind: "switch", checked: false, count: "40" },
      { kind: "wireless", checked: false, count: "70" },
      { kind: "camera", checked: true, count: "12" },
    ]);
    // It picked no probe: none, though the project has one.
    expect(
      within(screen.getByTestId("meraki-add-devices-more"))
        .getAllByTestId("folded-section-item")
        .map((item: HTMLElement) => {
          return item.textContent;
        }),
    ).toEqual(["Sites: Off", "Probe: No probe"]);
  });
});

describe("asking", () => {
  test("the ask is handed back, and the dialog is done", async () => {
    await renderModal();

    fireEvent.click(submit());
    await flush();

    expect(onAsked).toHaveBeenCalledTimes(1);
    const state: NetworkControllerDeviceAddState = onAsked.mock
      .calls[0]![0] as NetworkControllerDeviceAddState;
    expect(state.status).toBe(NetworkControllerDeviceAddStatus.Queued);
    expect(state.request.productTypes).toEqual(["switch", "wireless"]);
  });

  test("a refusal is said in the dialog, which stays open to try again", async () => {
    apiPostMock.mockImplementation(async () => {
      throw new Error(
        "Devices are being added from this connection already. Wait for them to be added, then add more.",
      );
    });

    await renderModal();

    fireEvent.click(submit());
    await flush();

    expect(onAsked).not.toHaveBeenCalled();
    expect(screen.getByTestId("modal")).toHaveTextContent(
      "Devices are being added from this connection already. Wait for them to be added, then add more.",
    );
    expect(submit()).toBeEnabled();
  });

  test("Cancel closes it without asking", async () => {
    await renderModal();

    fireEvent.click(screen.getByTestId("modal-footer-close-button"));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(apiPostMock).not.toHaveBeenCalled();
  });
});
