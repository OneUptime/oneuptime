/**
 * @timezone UTC
 */
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
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * The Hosts list's fleet Needs attention card (Components/Host/
 * HostFleetAttentionCard), rendered for real with only its one read stood
 * in: POST /host/needs-attention answers the hosts past one of HostHealth's
 * lines, and the card says which need attention, the most urgent first. It
 * reads again every minute and when the list is refreshed, says a failed
 * read in its own frame with Refresh, and lets only the newest read land.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
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

import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import API from "../../../UI/Utils/API/API";
import HostFleetAttentionCard, {
  HOST_FLEET_ATTENTION_REFRESH_MS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Host/HostFleetAttentionCard";

const NOW: Date = new Date("2026-11-02T10:00:00.000Z");
const MINUTE: number = 60_000;

// A host's record as the route answers it (Host.toJSON).
function hostJson(
  id: string,
  name: string,
  fields: JSONObject = {},
): JSONObject {
  return {
    _id: id,
    name: name,
    hostIdentifier: name,
    otelCollectorStatus: "connected",
    lastSeenAt: {
      _type: "DateTime",
      value: new Date(NOW.getTime() - MINUTE).toISOString(),
    },
    readingsUpdatedAt: {
      _type: "DateTime",
      value: new Date(NOW.getTime() - MINUTE).toISOString(),
    },
    cpuCores: 4,
    latestMemoryPercent: 40,
    latestDiskPercent: 40,
    latestDiskMountpoint: "/",
    ...fields,
  };
}

const DB: JSONObject = hostJson(
  "10000000-0000-4000-8000-0000000000d1",
  "db-01",
  {
    latestDiskPercent: 97,
    latestDiskMountpoint: "/var",
  },
);
const EDGE: JSONObject = hostJson(
  "10000000-0000-4000-8000-0000000000e1",
  "edge-01",
  { latestSwapPercent: 86 },
);
const CALM: JSONObject = hostJson(
  "10000000-0000-4000-8000-0000000000c1",
  "calm-01",
);

type Answer = () => Promise<HTTPResponse<JSONObject> | HTTPErrorResponse>;

let answers: Array<Answer> = [];
let requests: Array<JSONObject> = [];

function answerWith(
  hosts: Array<JSONObject>,
  isTruncated: boolean = false,
): Answer {
  return async (): Promise<HTTPResponse<JSONObject>> => {
    return new HTTPResponse<JSONObject>(
      200,
      { hosts: hosts, isTruncated: isTruncated },
      {},
    );
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  answers = [];
  requests = [];
  jest.spyOn(API, "post").mockImplementation((async (
    request: JSONObject,
  ): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
    requests.push(request);
    const answer: Answer | undefined = answers.shift();
    if (!answer) {
      throw new Error("No answer was set up for this read.");
    }
    return await answer();
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

async function settle(): Promise<void> {
  for (let index: number = 0; index < 10; index++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function draw(refreshToken: number = 0): Promise<{
  rerender: (token: number) => Promise<void>;
}> {
  const view: ReturnType<typeof render> = render(
    <MemoryRouter>
      <HostFleetAttentionCard refreshToken={refreshToken} />
    </MemoryRouter>,
  );
  await settle();
  return {
    rerender: async (token: number): Promise<void> => {
      view.rerender(
        <MemoryRouter>
          <HostFleetAttentionCard refreshToken={token} />
        </MemoryRouter>,
      );
      await settle();
    },
  };
}

function rowKeys(): Array<string | null> {
  return screen
    .queryAllByTestId("host-fleet-attention-item")
    .map((row: HTMLElement): string | null => {
      return row.getAttribute("data-key");
    });
}

describe("the Hosts list's Needs attention card", () => {
  test("reads the hosts past a line with the project's headers, and lists those that need attention", async () => {
    answers.push(answerWith([EDGE, CALM, DB]));
    await draw();

    expect(requests).toHaveLength(1);
    expect(String(requests[0]!["url"])).toMatch(/\/host\/needs-attention$/);
    expect(requests[0]!["headers"]).toEqual({
      tenantid: "10000000-0000-4000-8000-000000000001",
    });
    // The critical one first; a host that needs nothing is not listed.
    expect(rowKeys()).toEqual([DB["_id"], EDGE["_id"]]);
    expect(
      screen
        .getAllByTestId("host-fleet-attention-reason")
        .map((reason: HTMLElement): string | null => {
          return reason.textContent;
        }),
    ).toEqual(["/var 97% full", "Swap 86% used"]);
    // Every row is a host: no kind chip says so on each.
    expect(screen.queryAllByTestId("host-fleet-attention-kind")).toEqual([]);
    // Each row opens its host's page.
    expect(
      screen.getAllByTestId("host-fleet-attention-item")[0]!.querySelector("a"),
    ).toHaveAttribute(
      "href",
      `/dashboard/10000000-0000-4000-8000-000000000001/host/${DB["_id"]}`,
    );
  });

  test("a calm fleet draws no card", async () => {
    answers.push(answerWith([CALM]));
    await draw();

    expect(screen.queryByTestId("host-fleet-attention")).toBeNull();
    expect(screen.queryByTestId("host-fleet-attention-error")).toBeNull();
  });

  test("a read cut short says the rows are the most urgent", async () => {
    answers.push(answerWith([DB], true));
    await draw();

    expect(screen.getByTestId("host-fleet-attention")).toHaveTextContent(
      "More hosts need attention than one read holds: these are the most urgent.",
    );
  });

  test("reads again every minute, and when the list is refreshed", async () => {
    answers.push(answerWith([CALM]));
    const view: { rerender: (token: number) => Promise<void> } = await draw();
    expect(screen.queryByTestId("host-fleet-attention")).toBeNull();

    // A minute later the database filled up.
    answers.push(answerWith([DB]));
    await act(async () => {
      jest.advanceTimersByTime(HOST_FLEET_ATTENTION_REFRESH_MS);
    });
    await settle();
    expect(requests).toHaveLength(2);
    expect(rowKeys()).toEqual([DB["_id"]]);

    answers.push(answerWith([]));
    await view.rerender(1);
    expect(requests).toHaveLength(3);
    expect(screen.queryByTestId("host-fleet-attention")).toBeNull();
  });

  test("a read that fails says so in the card's frame, and Refresh reads again", async () => {
    answers.push(async (): Promise<HTTPErrorResponse> => {
      return new HTTPErrorResponse(500, { message: "Postgres is down." }, {});
    });
    await draw();

    const error: HTMLElement = screen.getByTestId("host-fleet-attention-error");
    expect(error).toHaveTextContent("Postgres is down.");

    answers.push(answerWith([DB]));
    fireEvent.click(screen.getByTestId("refresh-button"));
    await settle();

    expect(requests).toHaveLength(2);
    expect(screen.queryByTestId("host-fleet-attention-error")).toBeNull();
    expect(rowKeys()).toEqual([DB["_id"]]);
  });

  test("only the newest read lands: a slow one never paints over it", async () => {
    let releaseSlow: () => void = () => {};
    answers.push((): Promise<HTTPResponse<JSONObject>> => {
      return new Promise<HTTPResponse<JSONObject>>(
        (resolve: (value: HTTPResponse<JSONObject>) => void) => {
          releaseSlow = () => {
            resolve(
              new HTTPResponse<JSONObject>(
                200,
                { hosts: [EDGE], isTruncated: false },
                {},
              ),
            );
          };
        },
      );
    });
    const view: { rerender: (token: number) => Promise<void> } = await draw();

    answers.push(answerWith([DB]));
    await view.rerender(1);
    expect(rowKeys()).toEqual([DB["_id"]]);

    // The first read answers last: the card keeps what the newer one said.
    await act(async () => {
      releaseSlow();
    });
    await settle();
    expect(rowKeys()).toEqual([DB["_id"]]);
  });
});
