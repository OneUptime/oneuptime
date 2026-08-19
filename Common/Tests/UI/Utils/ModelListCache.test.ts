import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ModelListCache from "../../../UI/Utils/ModelListCache";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import Query from "../../../Types/BaseDatabase/Query";
import Select from "../../../Types/BaseDatabase/Select";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../Types/ObjectID";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";

/*
 * ModelListCache exists so that reference-data lists (incident states, alert
 * states, custom-field definitions) are fetched once per mount burst instead
 * of once per consumer. Everything below pins the contract that makes that
 * safe: concurrent callers share one request, the TTL bounds staleness,
 * distinct keys (model / project / shape) never bleed into each other, and
 * invalidation - including mid-flight - really forces the next read back to
 * the network.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "00000000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "00000000-0000-4000-8000-000000000002",
);

const TTL_IN_MS: number = 60 * 1000;

/*
 * Hand-rolled rather than jest.SpiedFunction<typeof ModelAPI.getList>: the
 * static is generic, and the installed jest typings cannot describe a spy on
 * a generic method without collapsing it to one instantiation (same pattern
 * as ProjectUsersModelAPI.test.ts).
 */
interface Spy {
  mockResolvedValue: (value: unknown) => Spy;
  mockResolvedValueOnce: (value: unknown) => Spy;
  mockRejectedValueOnce: (reason: unknown) => Spy;
  mockImplementation: (fn: (...args: Array<unknown>) => unknown) => Spy;
  mockImplementationOnce: (fn: (...args: Array<unknown>) => unknown) => Spy;
  mock: { calls: Array<Array<unknown>> };
}

let getListSpy: Spy;

type Deferred = {
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};

const makeDeferred: () => Deferred = (): Deferred => {
  let resolveFn: (value: unknown) => void = () => {
    // replaced synchronously by the Promise executor below.
  };
  let rejectFn: (reason: unknown) => void = () => {
    // replaced synchronously by the Promise executor below.
  };

  const promise: Promise<unknown> = new Promise(
    (
      resolve: (value: unknown) => void,
      reject: (reason: unknown) => void,
    ): void => {
      resolveFn = resolve;
      rejectFn = reject;
    },
  );

  return { promise, resolve: resolveFn, reject: rejectFn };
};

const makeIncidentStateList: () => ListResult<IncidentState> =
  (): ListResult<IncidentState> => {
    const state: IncidentState = new IncidentState();
    state.isResolvedState = false;

    return { data: [state], count: 1, skip: 0, limit: 90 };
  };

const makeAlertStateList: () => ListResult<AlertState> =
  (): ListResult<AlertState> => {
    const state: AlertState = new AlertState();
    state.isResolvedState = false;

    return { data: [state], count: 1, skip: 0, limit: 90 };
  };

const fetchIncidentStates: (
  projectId?: ObjectID,
) => Promise<ListResult<IncidentState>> = (
  projectId: ObjectID = PROJECT_ID,
): Promise<ListResult<IncidentState>> => {
  return ModelListCache.getList<IncidentState>({
    modelType: IncidentState,
    query: { projectId: projectId } as Query<IncidentState>,
    skip: 0,
    limit: 90,
    sort: { order: SortOrder.Ascending } as never,
    select: { _id: true, isResolvedState: true } as Select<IncidentState>,
    projectId: projectId,
  });
};

const fetchAlertStates: () => Promise<ListResult<AlertState>> = (): Promise<
  ListResult<AlertState>
> => {
  return ModelListCache.getList<AlertState>({
    modelType: AlertState,
    query: { projectId: PROJECT_ID } as Query<AlertState>,
    skip: 0,
    limit: 90,
    sort: { order: SortOrder.Ascending } as never,
    select: { _id: true, isResolvedState: true } as Select<AlertState>,
    projectId: PROJECT_ID,
  });
};

const getListCallCount: () => number = (): number => {
  return getListSpy.mock.calls.length;
};

describe("ModelListCache", () => {
  beforeEach(() => {
    // Fake timers fake Date.now too, which is all the TTL reads.
    jest.useFakeTimers();
    ModelListCache.invalidateAll();
    getListSpy = jest.spyOn(ModelAPI, "getList") as unknown as Spy;
  });

  afterEach(() => {
    ModelListCache.invalidateAll();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("shares one in-flight request between concurrent callers", async () => {
    const deferred: Deferred = makeDeferred();
    getListSpy.mockImplementation(() => {
      return deferred.promise;
    });

    const first: Promise<ListResult<IncidentState>> = fetchIncidentStates();
    const second: Promise<ListResult<IncidentState>> = fetchIncidentStates();

    // Both callers are waiting, yet only one request went out.
    expect(getListCallCount()).toBe(1);

    deferred.resolve(makeIncidentStateList());

    const firstResult: ListResult<IncidentState> = await first;
    const secondResult: ListResult<IncidentState> = await second;

    expect(secondResult).toBe(firstResult);
    expect(getListCallCount()).toBe(1);
  });

  it("serves a repeat call from the cache within the TTL", async () => {
    const list: ListResult<IncidentState> = makeIncidentStateList();
    getListSpy.mockResolvedValue(list);

    const firstResult: ListResult<IncidentState> = await fetchIncidentStates();

    // Just under the TTL: still the cached response, no new request.
    jest.advanceTimersByTime(TTL_IN_MS - 1);

    const secondResult: ListResult<IncidentState> = await fetchIncidentStates();

    expect(getListCallCount()).toBe(1);
    expect(secondResult).toBe(firstResult);
  });

  it("refetches once the TTL has passed", async () => {
    getListSpy.mockResolvedValue(makeIncidentStateList());

    await fetchIncidentStates();

    jest.advanceTimersByTime(TTL_IN_MS);

    await fetchIncidentStates();

    expect(getListCallCount()).toBe(2);
  });

  it("keeps different model types on different keys", async () => {
    getListSpy
      .mockResolvedValueOnce(makeIncidentStateList())
      .mockResolvedValueOnce(makeAlertStateList());

    await fetchIncidentStates();
    await fetchAlertStates();

    expect(getListCallCount()).toBe(2);

    // Both are now cached independently.
    await fetchIncidentStates();
    await fetchAlertStates();

    expect(getListCallCount()).toBe(2);
  });

  it("keeps different projects on different keys", async () => {
    getListSpy.mockResolvedValue(makeIncidentStateList());

    await fetchIncidentStates(PROJECT_ID);
    await fetchIncidentStates(OTHER_PROJECT_ID);

    expect(getListCallCount()).toBe(2);

    await fetchIncidentStates(PROJECT_ID);

    expect(getListCallCount()).toBe(2);
  });

  it("keeps different request shapes on different keys", async () => {
    getListSpy.mockResolvedValue(makeIncidentStateList());

    await fetchIncidentStates();

    // Same model and project, but a different select: a distinct list.
    await ModelListCache.getList<IncidentState>({
      modelType: IncidentState,
      query: { projectId: PROJECT_ID } as Query<IncidentState>,
      skip: 0,
      limit: 90,
      sort: { order: SortOrder.Ascending } as never,
      select: { _id: true, name: true } as Select<IncidentState>,
      projectId: PROJECT_ID,
    });

    expect(getListCallCount()).toBe(2);
  });

  it("invalidate(modelType) clears that model and only that model", async () => {
    getListSpy
      .mockResolvedValueOnce(makeIncidentStateList())
      .mockResolvedValueOnce(makeAlertStateList())
      .mockResolvedValue(makeIncidentStateList());

    await fetchIncidentStates();
    await fetchAlertStates();

    ModelListCache.invalidate(IncidentState);

    await fetchIncidentStates();
    expect(getListCallCount()).toBe(3);

    // The alert-state entry survived the incident-state invalidation.
    await fetchAlertStates();
    expect(getListCallCount()).toBe(3);
  });

  it("invalidateAll clears every entry", async () => {
    getListSpy
      .mockResolvedValueOnce(makeIncidentStateList())
      .mockResolvedValueOnce(makeAlertStateList())
      .mockResolvedValueOnce(makeIncidentStateList())
      .mockResolvedValueOnce(makeAlertStateList());

    await fetchIncidentStates();
    await fetchAlertStates();

    ModelListCache.invalidateAll();

    await fetchIncidentStates();
    await fetchAlertStates();

    expect(getListCallCount()).toBe(4);
  });

  it("invalidate() with no argument behaves like invalidateAll", async () => {
    getListSpy.mockResolvedValue(makeIncidentStateList());

    await fetchIncidentStates();

    ModelListCache.invalidate();

    await fetchIncidentStates();

    expect(getListCallCount()).toBe(2);
  });

  it("does not cache failures", async () => {
    const deferred: Deferred = makeDeferred();
    getListSpy
      .mockImplementationOnce(() => {
        return deferred.promise;
      })
      .mockResolvedValueOnce(makeIncidentStateList());

    /*
     * Rejected only after the cache has hooked onto the promise, so the
     * rejection never counts as unhandled in the test environment.
     */
    const failing: Promise<ListResult<IncidentState>> = fetchIncidentStates();
    const rejection: Promise<void> =
      expect(failing).rejects.toThrow("network down");
    deferred.reject(new Error("network down"));
    await rejection;

    // The failure left nothing behind: the retry goes back to the network.
    const result: ListResult<IncidentState> = await fetchIncidentStates();

    expect(result.count).toBe(1);
    expect(getListCallCount()).toBe(2);
  });

  it("discards a response whose key was invalidated while it was in flight", async () => {
    const deferred: Deferred = makeDeferred();
    getListSpy
      .mockImplementationOnce(() => {
        return deferred.promise;
      })
      .mockResolvedValueOnce(makeIncidentStateList());

    const inFlight: Promise<ListResult<IncidentState>> = fetchIncidentStates();

    ModelListCache.invalidateAll();

    // The stale response still reaches its original caller...
    deferred.resolve(makeIncidentStateList());
    await inFlight;

    // ...but it must not have (re)populated the cache.
    await fetchIncidentStates();

    expect(getListCallCount()).toBe(2);
  });
});
