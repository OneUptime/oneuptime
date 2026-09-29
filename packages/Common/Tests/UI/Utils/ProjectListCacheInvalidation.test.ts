import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ModelListCache from "../../../UI/Utils/ModelListCache";
import ProjectUtil from "../../../UI/Utils/Project";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import Query from "../../../Types/BaseDatabase/Query";
import Select from "../../../Types/BaseDatabase/Select";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../Types/ObjectID";
import Project from "../../../Models/DatabaseModels/Project";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";

/*
 * ProjectUtil.setCurrentProject runs on EVERY dashboard boot — in the same
 * React commit as the Header/Home mounts whose reference-list requests are
 * already in flight. It used to call ModelListCache.invalidateAll()
 * unconditionally, which discarded the cache's very first fill right after
 * login (the mid-flight-invalidation contract in ModelListCache.test.ts is
 * what turned that wipe into re-requests). The contract pinned here: the
 * cache is invalidated only when the project actually CHANGES — a re-set of
 * the same project preserves entries and in-flight fills — while
 * clearCurrentProject stays unconditional.
 */

const PROJECT_A_ID: string = "11111111-1111-4111-8111-111111111111";
const PROJECT_B_ID: string = "22222222-2222-4222-8222-222222222222";

type BuildProjectFunction = (id: string) => Project;

const buildProject: BuildProjectFunction = (id: string): Project => {
  const project: Project = new Project();
  project._id = id;
  return project;
};

/*
 * Hand-rolled rather than jest.SpiedFunction<typeof ModelAPI.getList>: the
 * static is generic, and the installed jest typings cannot describe a spy on
 * a generic method without collapsing it to one instantiation (same pattern
 * as ModelListCache.test.ts).
 */
interface Spy {
  mockResolvedValue: (value: unknown) => Spy;
  mockImplementationOnce: (fn: (...args: Array<unknown>) => unknown) => Spy;
  mock: { calls: Array<Array<unknown>> };
}

let getListSpy: Spy;

type Deferred = {
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
};

const makeDeferred: () => Deferred = (): Deferred => {
  let resolveFn: (value: unknown) => void = () => {
    // replaced synchronously by the Promise executor below.
  };

  const promise: Promise<unknown> = new Promise(
    (resolve: (value: unknown) => void): void => {
      resolveFn = resolve;
    },
  );

  return { promise, resolve: resolveFn };
};

const makeIncidentStateList: () => ListResult<IncidentState> =
  (): ListResult<IncidentState> => {
    const state: IncidentState = new IncidentState();
    state.isResolvedState = false;

    return { data: [state], count: 1, skip: 0, limit: 90 };
  };

const fetchIncidentStates: () => Promise<
  ListResult<IncidentState>
> = (): Promise<ListResult<IncidentState>> => {
  const projectId: ObjectID = new ObjectID(PROJECT_A_ID);

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

const getListCallCount: () => number = (): number => {
  return getListSpy.mock.calls.length;
};

describe("ProjectUtil <-> ModelListCache invalidation", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    // A project-less route, so the URL never shadows the stored project id.
    window.history.replaceState(window.history.state, "", "/dashboard");
    ModelListCache.invalidateAll();
    getListSpy = jest.spyOn(ModelAPI, "getList") as unknown as Spy;
  });

  afterEach(() => {
    ModelListCache.invalidateAll();
    jest.restoreAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  test("re-setting the SAME project preserves cached entries", async () => {
    getListSpy.mockResolvedValue(makeIncidentStateList());

    ProjectUtil.setCurrentProject(buildProject(PROJECT_A_ID));

    const firstResult: ListResult<IncidentState> = await fetchIncidentStates();

    expect(getListCallCount()).toBe(1);

    // The every-boot re-set of the project this tab is already on...
    ProjectUtil.setCurrentProject(buildProject(PROJECT_A_ID));

    // ...must not wipe the cache: the repeat read is served without a request.
    const secondResult: ListResult<IncidentState> = await fetchIncidentStates();

    expect(getListCallCount()).toBe(1);
    expect(secondResult).toBe(firstResult);
  });

  test("re-setting the SAME project keeps an in-flight fill (the boot-after-login commit)", async () => {
    /*
     * The reported shape exactly: Header/Home mount and start their
     * reference-list requests, then the boot-time setCurrentProject runs in
     * the same commit. The in-flight fill must survive it — before the fix,
     * the unconditional invalidateAll made the cache discard the response
     * on arrival and the next consumer re-requested it.
     */
    const deferred: Deferred = makeDeferred();
    getListSpy
      .mockImplementationOnce(() => {
        return deferred.promise;
      })
      .mockResolvedValue(makeIncidentStateList());

    // The tab is already on project A (session storage carries it)...
    ProjectUtil.setCurrentProject(buildProject(PROJECT_A_ID));

    // ...a mount starts the list request...
    const inFlight: Promise<ListResult<IncidentState>> = fetchIncidentStates();

    // ...and boot re-sets the same project while the request is in flight.
    ProjectUtil.setCurrentProject(buildProject(PROJECT_A_ID));

    deferred.resolve(makeIncidentStateList());
    await inFlight;

    // The fill stuck: the next consumer is served from the cache.
    await fetchIncidentStates();

    expect(getListCallCount()).toBe(1);
  });

  test("switching to a DIFFERENT project invalidates the cached lists", async () => {
    getListSpy.mockResolvedValue(makeIncidentStateList());

    ProjectUtil.setCurrentProject(buildProject(PROJECT_A_ID));

    await fetchIncidentStates();

    expect(getListCallCount()).toBe(1);

    ProjectUtil.setCurrentProject(buildProject(PROJECT_B_ID));

    // Same cache key as before — only invalidation can force this refetch.
    await fetchIncidentStates();

    expect(getListCallCount()).toBe(2);
  });

  test("the very first set in a fresh tab still invalidates (no stored id to match)", async () => {
    /*
     * With nothing in session storage there is no evidence the cache belongs
     * to this project, so the conservative wipe stands. Only the same-id
     * re-set — the every-boot case — earns the skip.
     */
    getListSpy.mockResolvedValue(makeIncidentStateList());

    await fetchIncidentStates();

    expect(getListCallCount()).toBe(1);

    ProjectUtil.setCurrentProject(buildProject(PROJECT_A_ID));

    await fetchIncidentStates();

    expect(getListCallCount()).toBe(2);
  });

  test("clearCurrentProject invalidates unconditionally", async () => {
    getListSpy.mockResolvedValue(makeIncidentStateList());

    ProjectUtil.setCurrentProject(buildProject(PROJECT_A_ID));

    await fetchIncidentStates();

    expect(getListCallCount()).toBe(1);

    // Leaving the project: its reference lists must not outlive it.
    ProjectUtil.clearCurrentProject();

    await fetchIncidentStates();

    expect(getListCallCount()).toBe(2);
  });
});
