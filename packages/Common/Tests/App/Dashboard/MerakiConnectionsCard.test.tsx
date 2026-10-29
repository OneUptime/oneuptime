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
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * The project's Meraki connections at the foot of the network's Traffic
 * page (issue #5140), drawn for real: each with a status pill in the words
 * Cloud Connect's list uses (Working, Not working, Off ...), the sentence
 * the line over its traffic says, how often it reads and what its last read
 * covered, and what it could not do - amber for what to act on, grey for
 * what OneUptime handles by itself.
 *
 * Each row has ONE button, the next thing to do: Read now, Turn on for a
 * connection that is off, Update API key for one whose key Meraki refused
 * (the edit dialog opens on the key and tests a new one before it is
 * saved). Read now says it is reading until the read ends, then the list
 * and the page refresh by themselves - and so does a connection saved or
 * turned back on. A reader who may not change connections sees no buttons,
 * and why. A project without a connection gets nothing - or, on a page
 * that shows its flows, one line offering Meraki. The network is replaced.
 */

const NOW: Date = new Date("2026-10-24T12:00:00.000Z");
const FIRST_ID: string = "11111111-1111-4111-8111-111111111111";
const SECOND_ID: string = "22222222-2222-4222-8222-222222222222";
const THIRD_ID: string = "33333333-3333-4333-8333-333333333333";
const FOURTH_ID: string = "44444444-4444-4444-8444-444444444444";
const NEW_KEY: string = "fedcba9876543210fedcba9876543210fedcba98";

const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();
const deleteItemMock: MockFunction = getJestMockFunction();
const apiPostMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
      deleteItem: (...args: Array<unknown>): unknown => {
        return deleteItemMock(...args);
      },
      getCommonHeaders: (): Record<string, string> => {
        return { tenantid: "10000000-0000-4000-8000-000000000001" };
      },
    },
  };
});

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

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

import MerakiConnectionsCard, {
  READ_NOW_POLL_MS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkTraffic/Meraki/MerakiConnectionsCard";
import NetworkControllerConnection from "../../../Models/DatabaseModels/NetworkControllerConnection";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PermissionGate, {
  ModelAction,
  PermissionGateOptions,
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";

function connection(
  id: string,
  overrides: Record<string, unknown> = {},
): NetworkControllerConnection {
  const value: NetworkControllerConnection = new NetworkControllerConnection();
  value.id = new ObjectID(id);
  value.name = "Acme Retail";
  value.provider = "meraki" as never;
  value.isEnabled = true;
  value.config = {
    region: "global",
    organizationId: "549236",
    organizationName: "Acme Retail",
    readIntervalInMinutes: 5,
  };
  value.createdAt = new Date("2026-10-20T00:00:00.000Z");
  value.lastPulledAt = new Date("2026-10-24T11:58:00.000Z");
  value.lastSuccessfulPullAt = new Date("2026-10-24T11:58:00.000Z");
  value.lastPullResult = {
    status: "success",
    organizationName: "Acme Retail",
    networkCount: 312,
    applianceCount: 287,
    requestCount: 245,
    warnings: [],
  };
  Object.assign(value, overrides);
  return value;
}

// A connection whose key Meraki refused on its last read.
function refusedKey(id: string): NetworkControllerConnection {
  return connection(id, {
    name: "Acme Campus",
    lastPulledAt: new Date("2026-10-24T11:58:00.000Z"),
    lastSuccessfulPullAt: new Date("2026-10-24T10:00:00.000Z"),
    lastError:
      "Meraki answered the organization with HTTP 401: Invalid API key",
    lastPullResult: {
      status: "failed",
      organizationName: "Acme Campus",
      networkCount: 12,
      applianceCount: 12,
      requestCount: 0,
      failureKind: "authentication",
      warnings: [],
    },
  });
}

let connections: Array<NetworkControllerConnection>;
let onChanged: MockFunction;
let onConnect: MockFunction;
// What PermissionGate answers, by operation; and the options it was asked with.
let gates: Record<ModelAction, PermissionGateResult>;
let gateOptions: Array<PermissionGateOptions | undefined>;

const LOCKED: string =
  "You do not have permission to update this Meraki connection. You need one of these permissions: Project Owner, Project Admin.";

async function flush(): Promise<void> {
  for (let i: number = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderCard(
  options: { offerWhenEmpty?: boolean } = {},
): Promise<void> {
  render(
    <MerakiConnectionsCard
      refreshKey={0}
      offerWhenEmpty={options.offerWhenEmpty}
      onChanged={onChanged}
      onConnect={onConnect}
    />,
  );
  await flush();
}

function rows(): Array<HTMLElement> {
  return screen.getAllByTestId("meraki-connection");
}

async function openMenu(row: HTMLElement, item: string): Promise<void> {
  fireEvent.click(within(row).getByTestId("meraki-connection-more"));
  await flush();
  fireEvent.click(screen.getByText(item));
  await flush();
}

// The read the page now watches ends: the connection's lastPulledAt moves on.
async function endRead(id: string = FIRST_ID): Promise<void> {
  getItemMock.mockImplementation(async () => {
    return connection(id, {
      lastPulledAt: new Date("2026-10-24T12:00:30.000Z"),
    });
  });
  await act(async () => {
    jest.advanceTimersByTime(READ_NOW_POLL_MS);
  });
  await flush();
}

function testBodies(): Array<JSONObject> {
  return apiPostMock.mock.calls
    .filter((call: Array<unknown>) => {
      return String((call[0] as { url: unknown }).url).endsWith("/test");
    })
    .map((call: Array<unknown>) => {
      return (call[0] as { data: JSONObject }).data;
    });
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  connections = [connection(FIRST_ID)];
  getListMock.mockReset();
  getListMock.mockImplementation(async () => {
    return {
      data: connections,
      count: connections.length,
      skip: 0,
      limit: 100,
    };
  });
  getItemMock.mockReset();
  updateByIdMock.mockReset();
  updateByIdMock.mockImplementation(async () => {
    return {};
  });
  deleteItemMock.mockReset();
  deleteItemMock.mockImplementation(async () => {
    return {};
  });
  apiPostMock.mockReset();
  apiPostMock.mockImplementation(async () => {
    return { data: { queued: true } };
  });
  onChanged = getJestMockFunction();
  onConnect = getJestMockFunction();
  gates = {
    [ModelAction.Create]: { isAllowed: true },
    [ModelAction.Read]: { isAllowed: true },
    [ModelAction.Update]: { isAllowed: true },
    [ModelAction.Delete]: { isAllowed: true },
  };
  gateOptions = [];
  getJestSpyOn(PermissionGate, "check").mockImplementation(((
    _model: unknown,
    action: ModelAction,
    options?: PermissionGateOptions,
  ): PermissionGateResult => {
    gateOptions.push(options);
    return gates[action];
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("the list", () => {
  test("no connection: nothing at all", async () => {
    connections = [];
    await renderCard();

    expect(screen.queryByTestId("meraki-connections")).toBeNull();
    expect(screen.queryByTestId("meraki-offer")).toBeNull();
  });

  test("the project's connections, read as its own, oldest first", async () => {
    await renderCard();

    const request: {
      query: JSONObject;
      select: JSONObject;
      limit: number;
    } = getListMock.mock.calls[0]![0] as never;
    expect(String(request.query["projectId"])).toBe(
      "10000000-0000-4000-8000-000000000001",
    );
    // Never the key: it is not selected, and the server would not return it.
    expect(request.select["secrets"]).toBeUndefined();
    expect(request.limit).toBe(100);
  });

  test("a connection that works: Working, when it read, how often and what it covered - nothing said twice", async () => {
    await renderCard();

    const row: HTMLElement = rows()[0]!;
    expect(row).toHaveAttribute("data-status", "healthy");
    expect(
      within(row).getByTestId("meraki-connection-status"),
    ).toHaveTextContent(/^Working$/);
    // Named after its organization, on the global dashboard: no line for either.
    expect(within(row).queryByTestId("meraki-connection-organization")).toBe(
      null,
    );
    expect(
      within(row).getByTestId("meraki-connection-sentence"),
    ).toHaveTextContent(/^Read 2 minutes ago\.$/);
    expect(
      within(row).getByTestId("meraki-connection-covered"),
    ).toHaveTextContent(
      /^Every 5 minutes · 312 networks · 287 appliances · 245 API calls a read$/,
    );
    expect(within(row).queryByTestId("meraki-connection-error")).toBeNull();
    // Its one button reads it now.
    expect(
      within(row).getByTestId("meraki-connection-read-now"),
    ).toHaveTextContent("Read now");
    expect(within(row).queryByTestId("meraki-connection-turn-on")).toBeNull();
    expect(
      within(row).queryByTestId("meraki-connection-update-key"),
    ).toBeNull();
  });

  test("a read that listed its devices counts them, and says how many network devices here it fills in the details of", async () => {
    connections = [
      connection(FIRST_ID, {
        lastPullResult: {
          status: "success",
          organizationName: "Acme Retail",
          networkCount: 312,
          applianceCount: 287,
          deviceCount: 1204,
          describedDeviceCount: 212,
          requestCount: 245,
          warnings: [],
        },
      }),
    ];

    await renderCard();

    const row: HTMLElement = rows()[0]!;
    expect(
      within(row).getByTestId("meraki-connection-covered"),
    ).toHaveTextContent(
      /^Every 5 minutes · 312 networks · 1,204 devices · 287 appliances · 245 API calls a read$/,
    );

    const notes: Array<HTMLElement> = within(row).getAllByTestId(
      "meraki-connection-note",
    );
    expect(
      notes.map((note: HTMLElement) => {
        return note.textContent;
      }),
    ).toContain(
      "Fills in the model, serial number and firmware of 212 network devices.",
    );
  });

  test("one such device is said in the singular; none is not said at all", async () => {
    connections = [
      connection(FIRST_ID, {
        lastPullResult: {
          status: "success",
          organizationName: "Acme Retail",
          networkCount: 1,
          applianceCount: 1,
          deviceCount: 3,
          describedDeviceCount: 1,
          requestCount: 4,
          warnings: [],
        },
      }),
      connection(SECOND_ID, {
        name: "Acme Campus",
        lastPullResult: {
          status: "success",
          organizationName: "Acme Campus",
          networkCount: 1,
          applianceCount: 1,
          deviceCount: 3,
          describedDeviceCount: 0,
          requestCount: 4,
          warnings: [],
        },
      }),
    ];

    await renderCard();

    expect(
      within(rows()[0]!).getByTestId("meraki-connection-note"),
    ).toHaveTextContent(
      "Fills in the model, serial number and firmware of 1 network device.",
    );
    expect(
      within(rows()[1]!).queryByTestId("meraki-connection-note"),
    ).toBeNull();
  });

  test("a connection of its own name, or on another region's dashboard, says which", async () => {
    connections = [
      connection(FIRST_ID, {
        name: "Stores (EMEA)",
        config: {
          region: "canada",
          organizationId: "549236",
          organizationName: "Acme Retail",
          readIntervalInMinutes: 60,
        },
      }),
    ];

    await renderCard();

    expect(
      within(rows()[0]!).getByTestId("meraki-connection-organization"),
    ).toHaveTextContent(/^Acme Retail · Canada \(dashboard\.meraki\.ca\)$/);
    expect(
      within(rows()[0]!).getByTestId("meraki-connection-covered"),
    ).toHaveTextContent(/^Every hour · /);
  });

  test("each status in its own pill colour, the ones Cloud Connect's list uses", async () => {
    connections = [
      connection(FIRST_ID),
      refusedKey(SECOND_ID),
      connection(THIRD_ID, { name: "Off", isEnabled: false }),
    ];

    await renderCard();

    const pills: Array<string> = rows().map((row: HTMLElement) => {
      return (
        within(row)
          .getByTestId("meraki-connection-status")
          .querySelector('[data-testid="pill"]')?.textContent || ""
      );
    });
    expect(pills).toEqual(["Working", "Not working", "Off"]);
  });

  test("a connection that fails says why; one read in part says what is left, amber only for what to act on", async () => {
    connections = [
      connection(FIRST_ID, {
        name: "Unreachable",
        lastError:
          "The Meraki dashboard API could not be reached: connect ETIMEDOUT",
        lastSuccessfulPullAt: new Date("2026-10-24T10:00:00.000Z"),
        lastPullResult: {
          status: "failed",
          organizationName: "Acme Retail",
          networkCount: 312,
          applianceCount: 287,
          requestCount: 0,
          failureKind: "unavailable",
          warnings: [],
        },
      }),
      connection(SECOND_ID, {
        name: "Partial",
        lastPullResult: {
          status: "partial",
          organizationName: "Acme Campus",
          networkCount: 1200,
          applianceCount: 1200,
          requestCount: 900,
          trafficAnalysisOffNetworks: 3,
          analyticsNetworksWaiting: 770,
          wasRateLimited: true,
          warnings: [],
        },
      }),
    ];

    await renderCard();
    const [failing, partial]: Array<HTMLElement> = rows();

    expect(failing).toHaveAttribute("data-status", "failing");
    expect(
      within(failing!).getByTestId("meraki-connection-error"),
    ).toHaveTextContent("connect ETIMEDOUT");
    // Unreachable is tried again: Read now, not a new key.
    expect(
      within(failing!).getByTestId("meraki-connection-read-now"),
    ).toBeInTheDocument();
    // Not read: its covered line has no API calls to count.
    expect(
      within(failing!).getByTestId("meraki-connection-covered"),
    ).toHaveTextContent(/^Every 5 minutes · 312 networks · 287 appliances$/);

    // A name of its own: the organization it reads is said under it.
    expect(
      within(partial!).getByTestId("meraki-connection-organization"),
    ).toHaveTextContent(/^Acme Campus$/);
    expect(partial).toHaveAttribute("data-status", "partial");
    const notes: Array<HTMLElement> = within(partial!).getAllByTestId(
      "meraki-connection-note",
    );
    expect(
      notes.map((note: HTMLElement) => {
        return [note.getAttribute("data-tone"), note.textContent];
      }),
    ).toEqual([
      [
        "act",
        "Traffic analysis is off on 3 networks, so Meraki keeps no applications for them. Turn it on in the Meraki dashboard under Network-wide > General.",
      ],
      [
        "info",
        "The applications and clients of 770 networks wait for the next read, which carries on in a minute.",
      ],
      [
        "info",
        "Meraki asked OneUptime to slow down during the last read: other applications share the organization's API budget, and OneUptime reads more slowly until it is free.",
      ],
    ]);
    expect(notes[0]).toHaveClass("text-amber-800");
    expect(notes[1]).toHaveClass("text-gray-500");
  });

  test("Connect Meraki in the header connects another", async () => {
    await renderCard();

    fireEvent.click(screen.getByTestId("meraki-connect-another"));

    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  test("a list that cannot load says why", async () => {
    getListMock.mockImplementation(async () => {
      throw new Error("Could not load the connections.");
    });

    await renderCard();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not load the connections.",
    );
  });

  test("the card is where a line over the traffic sends its Review", async () => {
    await renderCard();

    expect(
      screen
        .getByTestId("meraki-connections")
        .closest("#traffic-meraki-connections"),
    ).not.toBeNull();
  });
});

describe("one button, the next thing to do", () => {
  test("Read now queues a read, says it is reading, and refreshes the list and the page when it ends", async () => {
    await renderCard();

    fireEvent.click(
      within(rows()[0]!).getByTestId("meraki-connection-read-now"),
    );
    await flush();

    expect(
      String((apiPostMock.mock.calls[0]![0] as { url: unknown }).url),
    ).toContain(`/network-controller-connection/${FIRST_ID}/read-now`);
    expect(
      within(rows()[0]!).getByTestId("meraki-connection-status"),
    ).toHaveTextContent("Reading now…");
    expect(
      within(rows()[0]!).getByTestId("meraki-connection-read-now"),
    ).toBeDisabled();

    // Still reading: the same lastPulledAt.
    getItemMock.mockImplementation(async () => {
      return connection(FIRST_ID);
    });
    await act(async () => {
      jest.advanceTimersByTime(READ_NOW_POLL_MS);
    });
    await flush();
    expect(onChanged).not.toHaveBeenCalled();

    await endRead();

    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(getListMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(
      within(rows()[0]!).getByTestId("meraki-connection-status"),
    ).toHaveTextContent("Working");
  });

  test("a connection that is off offers Turn on - never a Read now Meraki would refuse - and its next read is watched", async () => {
    connections = [connection(FIRST_ID, { isEnabled: false })];
    await renderCard();

    const row: HTMLElement = rows()[0]!;
    expect(row).toHaveAttribute("data-status", "off");
    expect(within(row).queryByTestId("meraki-connection-read-now")).toBeNull();
    // Off: how often it reads is not said.
    expect(
      within(row).getByTestId("meraki-connection-covered"),
    ).not.toHaveTextContent("Every 5 minutes");

    connections = [connection(FIRST_ID)];
    fireEvent.click(within(row).getByTestId("meraki-connection-turn-on"));
    await flush();

    expect(updateByIdMock.mock.calls[0]![0]).toMatchObject({
      id: new ObjectID(FIRST_ID),
      data: { isEnabled: true },
    });
    expect(onChanged).toHaveBeenCalledTimes(1);

    // Turned on, it is read within a minute: the row and the page show it by themselves.
    await endRead();

    expect(onChanged).toHaveBeenCalledTimes(2);
  });

  test("a key Meraki refused offers Update API key, which opens Edit on the key", async () => {
    connections = [refusedKey(FIRST_ID)];
    await renderCard();

    const row: HTMLElement = rows()[0]!;
    expect(row).toHaveAttribute("data-status", "failing");
    expect(within(row).queryByTestId("meraki-connection-read-now")).toBeNull();

    fireEvent.click(within(row).getByTestId("meraki-connection-update-key"));
    await flush();

    expect(screen.getByTestId("meraki-edit")).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByTestId("meraki-edit-key"));
  });
});

describe("the row's menu", () => {
  test("Turn off saves the switch and refreshes the page", async () => {
    await renderCard();

    await openMenu(rows()[0]!, "Turn off");

    expect(updateByIdMock.mock.calls[0]![0]).toMatchObject({
      id: new ObjectID(FIRST_ID),
      data: { isEnabled: false },
    });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  test("Delete asks first, then deletes", async () => {
    await renderCard();

    await openMenu(rows()[0]!, "Delete");

    expect(screen.getByText("Delete this connection?")).toBeInTheDocument();
    expect(
      screen.getByText(
        "OneUptime stops reading Acme Retail. The traffic it read stays on the Traffic pages until it is 30 days old.",
      ),
    ).toBeInTheDocument();
    expect(deleteItemMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    await flush();

    expect(deleteItemMock.mock.calls[0]![0]).toMatchObject({
      id: new ObjectID(FIRST_ID),
    });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  test("Edit: a name and an interval - an empty key keeps the stored one, and nothing is tested", async () => {
    await renderCard();

    await openMenu(rows()[0]!, "Edit");

    expect(screen.getByTestId("meraki-edit")).toBeInTheDocument();
    expect(screen.getByTestId("meraki-edit-key")).toHaveValue("");
    // Opened from the menu, the dialog starts on its first field.
    expect(document.activeElement).not.toBe(
      screen.getByTestId("meraki-edit-key"),
    );
    fireEvent.change(screen.getByTestId("meraki-edit-name"), {
      target: { value: "Stores" },
    });
    fireEvent.change(screen.getByTestId("meraki-edit-interval"), {
      target: { value: "30" },
    });
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    await flush();

    expect(testBodies()).toEqual([]);
    expect(updateByIdMock.mock.calls[0]![0]).toMatchObject({
      id: new ObjectID(FIRST_ID),
      data: { name: "Stores", config: { readIntervalInMinutes: 30 } },
    });
    expect(
      (updateByIdMock.mock.calls[0]![0] as { data: JSONObject }).data[
        "secrets"
      ],
    ).toBeUndefined();
    expect(
      screen.getByText("Saved. The connection is read again within a minute."),
    ).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledTimes(1);

    // Saved, it is read again: the next read is watched until it lands.
    await endRead();
    expect(onChanged).toHaveBeenCalledTimes(2);
  });

  test("Edit with a new key tests it against the connection's own organization first, then sends it, and only it", async () => {
    apiPostMock.mockImplementation(async (args: unknown) => {
      if (String((args as { url: unknown }).url).endsWith("/test")) {
        return {
          data: {
            provider: "meraki",
            status: "pass",
            message: "Reads 312 networks and 287 appliances in Acme Retail.",
            organizations: [{ id: "549236", name: "Acme Retail" }],
            organizationId: "549236",
            networkCount: 312,
            applianceCount: 287,
            durationMs: 1,
          },
        };
      }

      return { data: { queued: true } };
    });
    await renderCard();

    await openMenu(rows()[0]!, "Edit");
    fireEvent.change(screen.getByTestId("meraki-edit-key"), {
      target: { value: ` ${NEW_KEY} ` },
    });
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    await flush();

    expect(testBodies()).toEqual([
      { connectionId: FIRST_ID, secrets: { apiKey: NEW_KEY } },
    ]);
    expect(
      JSON.parse(
        (updateByIdMock.mock.calls[0]![0] as { data: JSONObject }).data[
          "secrets"
        ] as string,
      ),
    ).toEqual({ apiKey: NEW_KEY });
  });

  test("a new key Meraki refuses is not saved: the dialog names the dashboard, and keeps the key to correct", async () => {
    apiPostMock.mockImplementation(async () => {
      return {
        data: {
          provider: "meraki",
          status: "fail",
          message:
            "Meraki answered the list of organizations with HTTP 401: Invalid API key",
          failureKind: "authentication",
          organizations: [],
          durationMs: 1,
        },
      };
    });
    connections = [refusedKey(FIRST_ID)];
    await renderCard();

    fireEvent.click(
      within(rows()[0]!).getByTestId("meraki-connection-update-key"),
    );
    await flush();
    fireEvent.change(screen.getByTestId("meraki-edit-key"), {
      target: { value: NEW_KEY },
    });
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    await flush();

    expect(updateByIdMock).not.toHaveBeenCalled();
    const result: HTMLElement = within(
      screen.getByTestId("meraki-edit"),
    ).getByTestId("meraki-test-result");
    expect(result).toHaveAttribute("data-status", "fail");
    expect(result).toHaveTextContent(
      "The Meraki dashboard at dashboard.meraki.com did not accept this API key.",
    );
    // The edit dialog's key is the field above: no step to go back to.
    expect(within(result).queryByTestId("meraki-test-change-key")).toBeNull();
    expect(screen.getByTestId("meraki-edit-key")).toHaveValue(NEW_KEY);

    // Typing a new key clears the old answer.
    fireEvent.change(screen.getByTestId("meraki-edit-key"), {
      target: { value: `${NEW_KEY}0` },
    });
    expect(
      within(screen.getByTestId("meraki-edit")).queryByTestId(
        "meraki-test-result",
      ),
    ).toBeNull();
  });

  test("Edit without a name says so, and saves nothing", async () => {
    await renderCard();

    await openMenu(rows()[0]!, "Edit");
    fireEvent.change(screen.getByTestId("meraki-edit-name"), {
      target: { value: "  " },
    });
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    await flush();

    expect(screen.getByText("Enter a name.")).toBeInTheDocument();
    expect(updateByIdMock).not.toHaveBeenCalled();
  });
});

describe("who may do what", () => {
  test("the gates name the connection as the page does, not the database's model", async () => {
    await renderCard();

    expect(gateOptions.length).toBeGreaterThan(0);
    for (const options of gateOptions) {
      expect(options).toEqual({ singularName: "Meraki connection" });
    }
  });

  test("a reader who may not change connections sees them without buttons, and why in words", async () => {
    gates[ModelAction.Create] = { isAllowed: false, disabledReason: LOCKED };
    gates[ModelAction.Update] = { isAllowed: false, disabledReason: LOCKED };
    gates[ModelAction.Delete] = { isAllowed: false, disabledReason: LOCKED };
    connections = [connection(FIRST_ID), refusedKey(SECOND_ID)];

    await renderCard();

    expect(rows()).toHaveLength(2);
    expect(screen.queryByTestId("meraki-connect-another")).toBeNull();
    expect(screen.queryByTestId("meraki-connection-read-now")).toBeNull();
    expect(screen.queryByTestId("meraki-connection-update-key")).toBeNull();
    expect(screen.queryByTestId("meraki-connection-more")).toBeNull();
    expect(screen.getByTestId("meraki-connections-locked")).toHaveTextContent(
      LOCKED,
    );
  });

  test("before the permissions load, nothing is offered and nothing is said", async () => {
    gates[ModelAction.Create] = { isAllowed: false };
    gates[ModelAction.Update] = { isAllowed: false };
    gates[ModelAction.Delete] = { isAllowed: false };

    await renderCard();

    expect(screen.queryByTestId("meraki-connection-read-now")).toBeNull();
    expect(screen.queryByTestId("meraki-connections-locked")).toBeNull();
  });

  test("who may delete but not edit gets a menu of Delete alone", async () => {
    gates[ModelAction.Update] = { isAllowed: false, disabledReason: LOCKED };

    await renderCard();

    fireEvent.click(within(rows()[0]!).getByTestId("meraki-connection-more"));
    await flush();

    expect(screen.queryByText("Edit")).toBeNull();
    expect(screen.queryByText("Turn off")).toBeNull();
    expect(screen.getByText("Delete")).toBeInTheDocument();
  });
});

describe("a project without a connection", () => {
  test("on a page that shows its flows: one line offering Meraki", async () => {
    connections = [];
    await renderCard({ offerWhenEmpty: true });

    const offer: HTMLElement = screen.getByTestId("meraki-offer");
    expect(offer).toHaveTextContent(/^Using Cisco Meraki\? Connect Meraki$/);
    expect(screen.queryByTestId("meraki-connections")).toBeNull();

    fireEvent.click(screen.getByTestId("meraki-offer-connect"));
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  test("never to who may not connect one", async () => {
    connections = [];
    gates[ModelAction.Create] = { isAllowed: false, disabledReason: LOCKED };

    await renderCard({ offerWhenEmpty: true });

    expect(screen.queryByTestId("meraki-offer")).toBeNull();
  });

  test("a connection after all: the list, not the offer", async () => {
    connections = [connection(FOURTH_ID)];

    await renderCard({ offerWhenEmpty: true });

    expect(screen.queryByTestId("meraki-offer")).toBeNull();
    expect(rows()).toHaveLength(1);
  });
});
