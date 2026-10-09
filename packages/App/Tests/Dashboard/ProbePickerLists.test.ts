import { beforeEach, describe, expect, test } from "@jest/globals";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import ObjectID from "Common/Types/ObjectID";
import Probe from "Common/Models/DatabaseModels/Probe";

/*
 * THE PROBE PICKERS LIST THE GLOBAL PROBES, WHATEVER THE PROJECT'S OWN LIST
 * ANSWERS.
 *
 * Every probe picker in the Dashboard - the monitor form, a monitor's
 * probes, logs and metrics, the monitor list's bulk actions, network
 * devices, discovery scans, topology - lists its probes through
 * ProbeUtil.getAllProbes: the project's own probes and, from their own
 * route, the global probes most monitors run on.
 *
 * The project's probes are read by whoever may pick one (the probe
 * readers, and whoever may read, create or edit monitors, a monitor's
 * probes, network devices, their discovery scans or network sites). The
 * permission snapshot decides: whoever it says may not list them is not
 * asked about them, and still gets the global probes; a refusal of a list it
 * says they may read is an error. Until the snapshot lands, a refusal (422)
 * is taken as its answer. Any other failure still fails the list, and so
 * does a failed global list.
 */

jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: jest.fn(),
    },
  };
});

/*
 * The permission snapshot, as the test sets it: whether it has landed, and
 * whether it lets the user list the project's probes (PermissionGate.check
 * with ModelAction.Read on Probe).
 */
const mockSnapshot: { hasLanded: boolean; mayListProbes: boolean } = {
  hasLanded: false,
  mayListProbes: true,
};

jest.mock("Common/UI/Utils/PermissionGate", () => {
  return {
    __esModule: true,
    ModelAction: {
      Create: "create",
      Read: "read",
      Update: "update",
      Delete: "delete",
    },
    default: {
      hasPermissionSnapshot: jest.fn((): boolean => {
        return mockSnapshot.hasLanded;
      }),
      check: jest.fn(
        (model: { constructor: { name: string } }, action: string) => {
          return {
            isAllowed:
              model.constructor.name === "Probe" &&
              action === "read" &&
              mockSnapshot.mayListProbes,
          };
        },
      ),
    },
  };
});

jest.mock("Common/UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: jest.fn(),
    },
  };
});

jest.mock("Common/UI/Config", () => {
  const { default: MockURL } = jest.requireActual("Common/Types/API/URL") as {
    default: { fromString: (value: string) => unknown };
  };
  return {
    __esModule: true,
    APP_API_URL: MockURL.fromString("http://localhost/api"),
  };
});

import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import ProbeUtil from "../../FeatureSet/Dashboard/src/Utils/Probe";

const getListMock: jest.Mock = ModelAPI.getList as unknown as jest.Mock;
const getCurrentProjectIdMock: jest.Mock =
  ProjectUtil.getCurrentProjectId as unknown as jest.Mock;

const PROJECT_ID: ObjectID = new ObjectID(
  "3f1b6b0e-0000-4000-8000-0000000000cc",
);

function makeProbe(name: string): Probe {
  const probe: Probe = new Probe();
  probe._id = ObjectID.generate().toString();
  probe.name = name;
  return probe;
}

function asListResult(models: Array<Probe>): ListResult<Probe> {
  return {
    data: models,
    count: models.length,
    skip: 0,
    limit: models.length,
  };
}

function refusal(statusCode: number, message: string): HTTPErrorResponse {
  return new HTTPErrorResponse(statusCode, { message: message }, {});
}

function isGlobalListRequest(args: unknown): boolean {
  const requestUrl: string | undefined = (
    args as {
      requestOptions?: { overrideRequestUrl?: { toString: () => string } };
    }
  ).requestOptions?.overrideRequestUrl?.toString();

  return Boolean(requestUrl && requestUrl.includes("/probe/global-probes"));
}

/*
 * Answers the project list and the global list the way the test needs,
 * whichever is asked first.
 */
function answerLists(data: {
  project: () => Promise<ListResult<Probe>>;
  global: () => Promise<ListResult<Probe>>;
}): void {
  getListMock.mockImplementation((...args: Array<unknown>): unknown => {
    return isGlobalListRequest(args[0]) ? data.global() : data.project();
  });
}

function projectListRequests(): number {
  return getListMock.mock.calls.filter((call: Array<unknown>) => {
    return !isGlobalListRequest(call[0]);
  }).length;
}

beforeEach(() => {
  getListMock.mockReset();
  getCurrentProjectIdMock.mockReset();
  getCurrentProjectIdMock.mockReturnValue(PROJECT_ID);
  mockSnapshot.hasLanded = false;
  mockSnapshot.mayListProbes = true;
});

describe("ProbeUtil.getAllProbes - before the permission snapshot lands, the server decides", () => {
  test("with both lists answered, the project's probes come first, then the global ones", async () => {
    answerLists({
      project: () => {
        return Promise.resolve(asListResult([makeProbe("Office probe")]));
      },
      global: () => {
        return Promise.resolve(asListResult([makeProbe("US East")]));
      },
    });

    const probes: Array<Probe> = await ProbeUtil.getAllProbes();

    expect(
      probes.map((probe: Probe) => {
        return [probe.name, probe.isGlobalProbe];
      }),
    ).toEqual([
      ["Office probe", false],
      ["US East", true],
    ]);
  });

  test("a project list refused for lack of permission (422) still offers the global probes", async () => {
    answerLists({
      project: () => {
        return Promise.reject(
          refusal(422, "You do not have permissions to read Probe"),
        );
      },
      global: () => {
        return Promise.resolve(
          asListResult([makeProbe("US East"), makeProbe("EU West")]),
        );
      },
    });

    const probes: Array<Probe> = await ProbeUtil.getAllProbes();

    expect(
      probes.map((probe: Probe) => {
        return [probe.name, probe.isGlobalProbe];
      }),
    ).toEqual([
      ["US East", true],
      ["EU West", true],
    ]);
  });

  test("a refused column (422) is answered the same way", async () => {
    answerLists({
      project: () => {
        return Promise.reject(
          refusal(
            422,
            "You do not have permissions to select on - shouldAutoEnableProbeOnNewMonitors.",
          ),
        );
      },
      global: () => {
        return Promise.resolve(asListResult([makeProbe("US East")]));
      },
    });

    await expect(ProbeUtil.getAllProbes()).resolves.toHaveLength(1);
  });

  test.each([
    [500, "Server Error"],
    [400, "Invalid select clause."],
    [401, "Authentication required."],
  ])(
    "any other failure of the project list (%s) still fails the list",
    async (statusCode: number, message: string) => {
      const failure: HTTPErrorResponse = refusal(statusCode, message);

      answerLists({
        project: () => {
          return Promise.reject(failure);
        },
        global: () => {
          return Promise.resolve(asListResult([makeProbe("US East")]));
        },
      });

      await expect(ProbeUtil.getAllProbes()).rejects.toBe(failure);
    },
  );

  test("an error that is not an API answer still fails the list", async () => {
    const failure: Error = new Error("The network is down.");

    answerLists({
      project: () => {
        return Promise.reject(failure);
      },
      global: () => {
        return Promise.resolve(asListResult([]));
      },
    });

    await expect(ProbeUtil.getAllProbes()).rejects.toBe(failure);
  });

  test("a failed global list fails the list, even with the project's probes read", async () => {
    const failure: HTTPErrorResponse = refusal(500, "Server Error");

    answerLists({
      project: () => {
        return Promise.resolve(asListResult([makeProbe("Office probe")]));
      },
      global: () => {
        return Promise.reject(failure);
      },
    });

    await expect(ProbeUtil.getAllProbes()).rejects.toBe(failure);
  });

  test("the project list asks for what a picker shows, and nothing a picker may not read", async () => {
    answerLists({
      project: () => {
        return Promise.resolve(asListResult([]));
      },
      global: () => {
        return Promise.resolve(asListResult([]));
      },
    });

    await ProbeUtil.getAllProbes();

    const projectCall: { select: Record<string, boolean> } | undefined =
      getListMock.mock.calls
        .map((call: Array<unknown>) => {
          return call[0] as {
            select: Record<string, boolean>;
            requestOptions?: unknown;
          };
        })
        .find(
          (args: {
            select: Record<string, boolean>;
            requestOptions?: unknown;
          }) => {
            return !isGlobalListRequest(args);
          },
        );

    expect(projectCall?.select).toEqual({
      name: true,
      _id: true,
      shouldAutoEnableProbeOnNewMonitors: true,
    });
  });
});

describe("ProbeUtil.getAllProbes - once the permission snapshot has landed, it decides", () => {
  beforeEach(() => {
    mockSnapshot.hasLanded = true;
  });

  test("a user it says may not list the project's probes is not asked about them, and gets the global probes", async () => {
    mockSnapshot.mayListProbes = false;

    answerLists({
      project: () => {
        return Promise.resolve(asListResult([makeProbe("Office probe")]));
      },
      global: () => {
        return Promise.resolve(asListResult([makeProbe("US East")]));
      },
    });

    const probes: Array<Probe> = await ProbeUtil.getAllProbes();

    expect(projectListRequests()).toBe(0);
    expect(
      probes.map((probe: Probe) => {
        return [probe.name, probe.isGlobalProbe];
      }),
    ).toEqual([["US East", true]]);
  });

  test("a user it says may list them gets the project's probes first, then the global ones", async () => {
    answerLists({
      project: () => {
        return Promise.resolve(asListResult([makeProbe("Office probe")]));
      },
      global: () => {
        return Promise.resolve(asListResult([makeProbe("US East")]));
      },
    });

    const probes: Array<Probe> = await ProbeUtil.getAllProbes();

    expect(projectListRequests()).toBe(1);
    expect(
      probes.map((probe: Probe) => {
        return [probe.name, probe.isGlobalProbe];
      }),
    ).toEqual([
      ["Office probe", false],
      ["US East", true],
    ]);
  });

  test("a refusal (422) of a list it says the user may read is an error, never an empty list", async () => {
    const failure: HTTPErrorResponse = refusal(
      422,
      "You do not have permissions to select on - shouldAutoEnableProbeOnNewMonitors.",
    );

    answerLists({
      project: () => {
        return Promise.reject(failure);
      },
      global: () => {
        return Promise.resolve(asListResult([makeProbe("US East")]));
      },
    });

    await expect(ProbeUtil.getAllProbes()).rejects.toBe(failure);
  });
});
