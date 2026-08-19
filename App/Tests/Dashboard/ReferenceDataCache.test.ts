import { beforeEach, describe, expect, test } from "@jest/globals";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ObjectID from "Common/Types/ObjectID";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Probe from "Common/Models/DatabaseModels/Probe";

/*
 * The state utils and ProbeUtil import ModelAPI, and ModelAPI transitively
 * loads Common/UI/Config, which reads `window` at import time and throws in
 * this node test environment. Mocking the module keeps the import graph
 * browser-free and doubles as the request-counting seam these tests need.
 * ProbeUtil additionally imports Common/UI/Config directly (for APP_API_URL)
 * and ProjectUtil, so both get the same treatment.
 */
jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: jest.fn(),
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
import ModelListCache from "Common/UI/Utils/ModelListCache";
import ProjectUtil from "Common/UI/Utils/Project";
import AlertStateUtil from "../../FeatureSet/Dashboard/src/Utils/AlertState";
import IncidentStateUtil from "../../FeatureSet/Dashboard/src/Utils/IncidentState";
import ProbeUtil from "../../FeatureSet/Dashboard/src/Utils/Probe";

const getListMock: jest.Mock = ModelAPI.getList as unknown as jest.Mock;
const getCurrentProjectIdMock: jest.Mock =
  ProjectUtil.getCurrentProjectId as unknown as jest.Mock;

const PROJECT_ID: ObjectID = new ObjectID(
  "3f1b6b0e-0000-4000-8000-0000000000aa",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "3f1b6b0e-0000-4000-8000-0000000000bb",
);

function makeState<TState extends IncidentState | AlertState>(
  StateType: { new (): TState },
  isResolvedState: boolean,
): TState {
  const state: TState = new StateType();
  state.isResolvedState = isResolvedState;
  return state;
}

function asListResult<TModel extends BaseModel>(
  models: Array<TModel>,
): ListResult<TModel> {
  return {
    data: models,
    count: models.length,
    skip: 0,
    limit: 90,
  };
}

beforeEach(() => {
  getListMock.mockReset();
  getCurrentProjectIdMock.mockReset();
  getCurrentProjectIdMock.mockReturnValue(PROJECT_ID);
  // The cache is module-level state; every test starts cold.
  ModelListCache.invalidateAll();
});

describe("state utils are served from the cache on repeat calls", () => {
  test("IncidentStateUtil fetches once for two sequential calls", async () => {
    getListMock.mockResolvedValue(
      asListResult([
        makeState(IncidentState, false),
        makeState(IncidentState, true),
      ]),
    );

    const first: Array<IncidentState> =
      await IncidentStateUtil.getUnresolvedIncidentStates(PROJECT_ID);
    const second: Array<IncidentState> =
      await IncidentStateUtil.getUnresolvedIncidentStates(PROJECT_ID);

    // One network request served both consumers.
    expect(getListMock).toHaveBeenCalledTimes(1);

    // And the filtering still happened on both calls.
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0]!.isResolvedState).toBe(false);
  });

  test("IncidentStateUtil dedups concurrent callers into one request", async () => {
    getListMock.mockResolvedValue(
      asListResult([makeState(IncidentState, false)]),
    );

    const [first, second]: [Array<IncidentState>, Array<IncidentState>] =
      await Promise.all([
        IncidentStateUtil.getUnresolvedIncidentStates(PROJECT_ID),
        IncidentStateUtil.getUnresolvedIncidentStates(PROJECT_ID),
      ]);

    expect(getListMock).toHaveBeenCalledTimes(1);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
  });

  test("AlertStateUtil fetches once for two sequential calls", async () => {
    getListMock.mockResolvedValue(
      asListResult([makeState(AlertState, false), makeState(AlertState, true)]),
    );

    const first: Array<AlertState> =
      await AlertStateUtil.getUnresolvedAlertStates(PROJECT_ID);
    const second: Array<AlertState> =
      await AlertStateUtil.getUnresolvedAlertStates(PROJECT_ID);

    expect(getListMock).toHaveBeenCalledTimes(1);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
  });

  test("a different project is a different cache entry", async () => {
    getListMock.mockResolvedValue(
      asListResult([makeState(IncidentState, false)]),
    );

    await IncidentStateUtil.getUnresolvedIncidentStates(PROJECT_ID);
    await IncidentStateUtil.getUnresolvedIncidentStates(OTHER_PROJECT_ID);

    expect(getListMock).toHaveBeenCalledTimes(2);
  });

  test("incident and alert state lists do not share an entry", async () => {
    getListMock.mockResolvedValue(
      asListResult([makeState(IncidentState, false)]),
    );

    await IncidentStateUtil.getUnresolvedIncidentStates(PROJECT_ID);
    await AlertStateUtil.getUnresolvedAlertStates(PROJECT_ID);

    expect(getListMock).toHaveBeenCalledTimes(2);
  });
});

describe("ProbeUtil.getAllProbes parallelizes its two lists", () => {
  function makeProbe(name: string): Probe {
    const probe: Probe = new Probe();
    probe.name = name;
    return probe;
  }

  test("both getLists start before either resolves", async () => {
    let resolveProjectList: (value: ListResult<Probe>) => void = () => {
      // replaced synchronously by the Promise executor below.
    };
    let resolveGlobalList: (value: ListResult<Probe>) => void = () => {
      // replaced synchronously by the Promise executor below.
    };

    const projectListPromise: Promise<ListResult<Probe>> = new Promise(
      (resolve: (value: ListResult<Probe>) => void): void => {
        resolveProjectList = resolve;
      },
    );
    const globalListPromise: Promise<ListResult<Probe>> = new Promise(
      (resolve: (value: ListResult<Probe>) => void): void => {
        resolveGlobalList = resolve;
      },
    );

    getListMock
      .mockReturnValueOnce(projectListPromise)
      .mockReturnValueOnce(globalListPromise);

    const resultPromise: Promise<Array<Probe>> = ProbeUtil.getAllProbes();

    /*
     * The whole point of the change: the second request must not wait for
     * the first response. Neither promise has resolved yet, and both
     * requests are already in flight.
     */
    expect(getListMock).toHaveBeenCalledTimes(2);

    resolveProjectList(asListResult([makeProbe("project probe")]));
    resolveGlobalList(asListResult([makeProbe("global probe")]));

    const probes: Array<Probe> = await resultPromise;

    // Project probes first, then globals, with the flag stamped on.
    expect(probes).toHaveLength(2);
    expect(probes[0]!.name?.toString()).toBe("project probe");
    expect(probes[0]!.isGlobalProbe).toBe(false);
    expect(probes[1]!.name?.toString()).toBe("global probe");
    expect(probes[1]!.isGlobalProbe).toBe(true);
  });

  test("the second call targets the global-probes endpoint", async () => {
    getListMock
      .mockResolvedValueOnce(asListResult([]))
      .mockResolvedValueOnce(asListResult([]));

    await ProbeUtil.getAllProbes();

    const secondCallArg: {
      requestOptions?: { overrideRequestUrl?: { toString: () => string } };
    } = getListMock.mock.calls[1]![0] as {
      requestOptions?: { overrideRequestUrl?: { toString: () => string } };
    };

    expect(
      secondCallArg.requestOptions?.overrideRequestUrl?.toString(),
    ).toContain("/probe/global-probes");
  });
});
