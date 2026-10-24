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

/*
 * The project's Meraki connections at the foot of the network's Traffic
 * page (issue #5140), drawn for real: each with how it is doing - in the
 * words the line over its traffic uses - how often it reads, what its last
 * read covered, and what it could not do. Read now says it is reading until
 * the read ends, then the list and the page refresh by themselves; Edit,
 * Turn off and Delete do what they say. The network is replaced.
 */

const NOW: Date = new Date("2026-10-24T12:00:00.000Z");
const FIRST_ID: string = "11111111-1111-4111-8111-111111111111";
const SECOND_ID: string = "22222222-2222-4222-8222-222222222222";
const THIRD_ID: string = "33333333-3333-4333-8333-333333333333";

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

let connections: Array<NetworkControllerConnection>;
let onChanged: MockFunction;
let onConnect: MockFunction;

async function flush(): Promise<void> {
  for (let i: number = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderCard(): Promise<void> {
  render(
    <MerakiConnectionsCard
      refreshKey={0}
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
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("the list", () => {
  test("no connection: nothing at all", async () => {
    connections = [];
    await renderCard();

    expect(screen.queryByTestId("meraki-connections")).toBeNull();
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

  test("a connection that works: its status, organization, region, interval and what it covered", async () => {
    await renderCard();

    const row: HTMLElement = rows()[0]!;
    expect(row).toHaveAttribute("data-status", "healthy");
    expect(
      within(row).getByTestId("meraki-connection-status"),
    ).toHaveTextContent("Connected");
    // Named after its organization: the organization is not said twice.
    expect(
      within(row).getByTestId("meraki-connection-organization"),
    ).toHaveTextContent(/^Global \(dashboard\.meraki\.com\)$/);
    expect(row).toHaveTextContent("Read 2 minutes ago. Every 5 minutes");
    expect(
      within(row).getByTestId("meraki-connection-covered"),
    ).toHaveTextContent("312 networks · 287 appliances · 245 API calls a read");
    expect(within(row).queryByTestId("meraki-connection-error")).toBeNull();
  });

  test("a connection that fails says why; one read in part says what it could not do", async () => {
    connections = [
      connection(FIRST_ID, {
        name: "Failing",
        lastError:
          "Meraki answered the organization with HTTP 401: Invalid API key",
        lastSuccessfulPullAt: new Date("2026-10-24T10:00:00.000Z"),
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
      connection(THIRD_ID, { name: "Off", isEnabled: false }),
    ];

    await renderCard();
    const [failing, partial, off]: Array<HTMLElement> = rows();

    // A name of its own: the organization it reads is said beside it.
    expect(
      within(partial!).getByTestId("meraki-connection-organization"),
    ).toHaveTextContent("Acme Campus · Global (dashboard.meraki.com)");

    expect(failing).toHaveAttribute("data-status", "failing");
    expect(
      within(failing!).getByTestId("meraki-connection-error"),
    ).toHaveTextContent("Meraki answered the organization with HTTP 401");

    expect(partial).toHaveAttribute("data-status", "partial");
    expect(
      within(partial!)
        .getAllByTestId("meraki-connection-note")
        .map((note: HTMLElement) => {
          return note.textContent;
        }),
    ).toEqual([
      "Traffic analysis is off on 3 networks, so Meraki keeps no applications for them. Turn it on in the Meraki dashboard under Network-wide > General.",
      "The applications and clients of 770 networks wait for the next read, which carries on in a minute.",
      "Meraki asked OneUptime to slow down during the last read: other applications share the organization's API budget, and OneUptime reads more slowly until it is free.",
    ]);

    expect(off).toHaveAttribute("data-status", "off");
    expect(
      within(off!).getByTestId("meraki-connection-read-now"),
    ).toBeDisabled();
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
});

describe("Read now", () => {
  test("queues a read, says it is reading, and refreshes the list and the page when it ends", async () => {
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

    // The read ended.
    getItemMock.mockImplementation(async () => {
      return connection(FIRST_ID, {
        lastPulledAt: new Date("2026-10-24T12:00:30.000Z"),
      });
    });
    await act(async () => {
      jest.advanceTimersByTime(READ_NOW_POLL_MS);
    });
    await flush();

    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(getListMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(
      within(rows()[0]!).getByTestId("meraki-connection-status"),
    ).toHaveTextContent("Connected");
  });

  test("a connection never read yet is watched quietly until its first read", async () => {
    connections = [
      connection(FIRST_ID, {
        lastPulledAt: undefined,
        lastSuccessfulPullAt: undefined,
        lastPullResult: undefined,
        createdAt: new Date("2026-10-24T11:59:00.000Z"),
      }),
    ];
    await renderCard();

    expect(
      within(rows()[0]!).getByTestId("meraki-connection-status"),
    ).toHaveTextContent("Waiting for the first read");
    // The status says it waits; its sentence does not say it again.
    expect(rows()[0]!).not.toHaveTextContent(
      "Waiting for the first read. It starts within a minute",
    );
    expect(rows()[0]!).toHaveTextContent("Every 5 minutes");

    getItemMock.mockImplementation(async () => {
      return connection(FIRST_ID, {
        lastPulledAt: new Date("2026-10-24T12:00:30.000Z"),
      });
    });
    await act(async () => {
      jest.advanceTimersByTime(READ_NOW_POLL_MS);
    });
    await flush();

    expect(onChanged).toHaveBeenCalledTimes(1);
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

  test("Edit: a name, an interval and a new key - an empty key keeps the stored one", async () => {
    await renderCard();

    await openMenu(rows()[0]!, "Edit");

    expect(screen.getByTestId("meraki-edit")).toBeInTheDocument();
    expect(screen.getByTestId("meraki-edit-key")).toHaveValue("");
    fireEvent.change(screen.getByTestId("meraki-edit-name"), {
      target: { value: "Stores" },
    });
    fireEvent.change(screen.getByTestId("meraki-edit-interval"), {
      target: { value: "30" },
    });
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    await flush();

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
  });

  test("Edit with a new key sends it, and only it, in the secrets", async () => {
    await renderCard();

    await openMenu(rows()[0]!, "Edit");
    fireEvent.change(screen.getByTestId("meraki-edit-key"), {
      target: { value: " fedcba9876543210fedcba9876543210fedcba98 " },
    });
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    await flush();

    expect(
      JSON.parse(
        (updateByIdMock.mock.calls[0]![0] as { data: JSONObject }).data[
          "secrets"
        ] as string,
      ),
    ).toEqual({ apiKey: "fedcba9876543210fedcba9876543210fedcba98" });
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
