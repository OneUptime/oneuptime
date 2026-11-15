import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import CacheGenerations from "../../../../Server/Infrastructure/CacheGenerations";
import Redis from "../../../../Server/Infrastructure/Redis";
import IncidentState from "../../../../Models/DatabaseModels/IncidentState";
import ProjectStateListCache from "../../../../Server/Utils/Database/ProjectStateListCache";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A project's states, kept per process (ProjectStateListCache): read once
 * while the project's generation stands, read again after any change to it
 * - here at once, in another process once it reads Redis again - and after
 * ENTRY_TTL_MS whatever happens. Each "process" is its own cache over one
 * shared Redis map.
 */

jest.mock("../../../../Server/Utils/Logger");

const COLUMNS: Array<string> = [
  "_id",
  "name",
  "order",
  "isCreatedState",
  "isAcknowledgedState",
  "isResolvedState",
];

let redis: Map<string, string>;
let now: number;

function process(): ProjectStateListCache<IncidentState> {
  return new ProjectStateListCache<IncidentState>({
    namespace: "project-state-list-test",
    description: "test states",
    modelType: IncidentState,
    columns: COLUMNS,
  });
}

function state(name: string, order: number): IncidentState {
  const incidentState: IncidentState = new IncidentState();
  incidentState._id = ObjectID.generate().toString();
  incidentState.name = name;
  incidentState.order = order;
  incidentState.isResolvedState = name === "Resolved";
  return incidentState;
}

beforeEach(() => {
  redis = new Map<string, string>();
  now = 1_000_000;

  jest.spyOn(Date, "now").mockImplementation(() => {
    return now;
  });

  jest.spyOn(Redis, "isConnected").mockReturnValue(true);

  jest
    .spyOn(GlobalCache, "getString")
    .mockImplementation(async (namespace: string, key: string) => {
      return redis.get(`${namespace}-${key}`) ?? null;
    });

  jest
    .spyOn(GlobalCache, "setString")
    .mockImplementation(
      async (namespace: string, key: string, value: string) => {
        redis.set(`${namespace}-${key}`, value);
      },
    );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ProjectStateListCache", () => {
  const projectId: ObjectID = ObjectID.generate();
  const otherProjectId: ObjectID = ObjectID.generate();

  test("a project's states are read once while nothing changes", async () => {
    const cache: ProjectStateListCache<IncidentState> = process();
    const states: Array<IncidentState> = [
      state("Created", 1),
      state("Resolved", 2),
    ];
    const read: jest.Mock<() => Promise<Array<IncidentState>>> = jest.fn(
      async () => {
        return states;
      },
    );

    const first: Array<IncidentState> = await cache.getStates(projectId, read);
    const second: Array<IncidentState> = await cache.getStates(projectId, read);

    expect(read).toHaveBeenCalledTimes(1);
    expect(
      second.map((s: IncidentState) => {
        return s.name;
      }),
    ).toEqual(["Created", "Resolved"]);
    expect(second[1]!.isResolvedState).toBe(true);
    expect(second[0]!.id!.toString()).toBe(states[0]!.id!.toString());
    expect(first).toHaveLength(2);
  });

  test("callers that ask together share one read", async () => {
    const cache: ProjectStateListCache<IncidentState> = process();
    const read: jest.Mock<() => Promise<Array<IncidentState>>> = jest.fn(
      async () => {
        return [state("Created", 1)];
      },
    );

    await Promise.all([
      cache.getStates(projectId, read),
      cache.getStates(projectId, read),
      cache.getStates(projectId, read),
    ]);

    expect(read).toHaveBeenCalledTimes(1);
  });

  test("each caller gets its own copies: one caller cannot change what the next reads", async () => {
    const cache: ProjectStateListCache<IncidentState> = process();
    const read: () => Promise<Array<IncidentState>> = async () => {
      return [state("Created", 1)];
    };

    const first: Array<IncidentState> = await cache.getStates(projectId, read);
    first[0]!.name = "Changed by a caller";
    first.push(state("Pushed", 9));

    const second: Array<IncidentState> = await cache.getStates(projectId, read);

    expect(second).toHaveLength(1);
    expect(second[0]!.name).toBe("Created");
    expect(second[0]).not.toBe(first[0]);
  });

  test("projects are kept apart", async () => {
    const cache: ProjectStateListCache<IncidentState> = process();

    await cache.getStates(projectId, async () => {
      return [state("Created", 1)];
    });

    const other: Array<IncidentState> = await cache.getStates(
      otherProjectId,
      async () => {
        return [state("Open", 1), state("Done", 2)];
      },
    );

    expect(other).toHaveLength(2);
  });

  test("a change in this process is read at once", async () => {
    const cache: ProjectStateListCache<IncidentState> = process();
    let states: Array<IncidentState> = [state("Created", 1)];
    const read: () => Promise<Array<IncidentState>> = async () => {
      return states;
    };

    await cache.getStates(projectId, read);

    states = [state("Created", 1), state("Monitoring", 2)];
    await cache.forgetProjects([projectId]);

    expect(await cache.getStates(projectId, read)).toHaveLength(2);
  });

  test("a change in another process is read once Redis is read again", async () => {
    const here: ProjectStateListCache<IncidentState> = process();
    const elsewhere: ProjectStateListCache<IncidentState> = process();
    let states: Array<IncidentState> = [state("Created", 1)];
    const read: () => Promise<Array<IncidentState>> = async () => {
      return states;
    };

    await here.getStates(projectId, read);

    states = [state("Created", 1), state("Monitoring", 2)];
    await elsewhere.forgetProjects([projectId]);

    now += CacheGenerations.SHARED_READ_TTL_MS + 1;

    expect(await here.getStates(projectId, read)).toHaveLength(2);
  });

  test("a change to another project keeps this one", async () => {
    const cache: ProjectStateListCache<IncidentState> = process();
    const read: jest.Mock<() => Promise<Array<IncidentState>>> = jest.fn(
      async () => {
        return [state("Created", 1)];
      },
    );

    await cache.getStates(projectId, read);
    await cache.forgetProjects([otherProjectId]);
    await cache.getStates(projectId, read);

    expect(read).toHaveBeenCalledTimes(1);
  });

  test("an entry runs out after ENTRY_TTL_MS, whatever its generation says", async () => {
    const cache: ProjectStateListCache<IncidentState> = process();
    const read: jest.Mock<() => Promise<Array<IncidentState>>> = jest.fn(
      async () => {
        return [state("Created", 1)];
      },
    );

    await cache.getStates(projectId, read);

    now += ProjectStateListCache.ENTRY_TTL_MS + 1;

    await cache.getStates(projectId, read);

    expect(read).toHaveBeenCalledTimes(2);
  });

  test("a read that failed is not kept", async () => {
    const cache: ProjectStateListCache<IncidentState> = process();

    await expect(
      cache.getStates(projectId, async () => {
        throw new Error("connection terminated");
      }),
    ).rejects.toThrow("connection terminated");

    expect(
      await cache.getStates(projectId, async () => {
        return [state("Created", 1)];
      }),
    ).toHaveLength(1);
  });

  test("nothing is kept while Redis is not connected: the list is read every time", async () => {
    jest.spyOn(Redis, "isConnected").mockReturnValue(false);

    const cache: ProjectStateListCache<IncidentState> = process();
    const read: jest.Mock<() => Promise<Array<IncidentState>>> = jest.fn(
      async () => {
        return [state("Created", 1)];
      },
    );

    await cache.getStates(projectId, read);
    await cache.getStates(projectId, read);

    expect(read).toHaveBeenCalledTimes(2);
    expect(GlobalCache.getString).not.toHaveBeenCalled();
  });

  test("forgetting nothing, or ids that are empty, starts nothing", async () => {
    const cache: ProjectStateListCache<IncidentState> = process();

    await cache.forgetProjects([]);
    await cache.forgetProjects([null, undefined, ""]);

    expect(GlobalCache.setString).not.toHaveBeenCalled();
  });
});
