import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import Redis from "../../../Server/Infrastructure/Redis";
import AlertStateService from "../../../Server/Services/AlertStateService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import ObjectID from "../../../Types/ObjectID";
import {
  ALERT_STATE_IDS,
  INCIDENT_STATE_IDS,
  ProjectStateIds,
  makeAlertStates,
  makeIncidentStates,
  mockProjectStates,
} from "../TestingUtils/Services/ProjectStatesHelper";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * AN ANSWER ABOUT ONE OF A PROJECT'S STATES READS PAST A KEPT LIST ONLY.
 *
 * Whether an incident or an alert in a state is resolved - and acknowledged,
 * and where a record created in it starts - is answered from the project's
 * states as this process keeps them (statesAsOneUptime, ProjectStateListCache).
 * A kept list can be behind the database: a state created a moment ago, in
 * another process, is not in it until that process's change of the project's
 * generation reaches this one. So a state the kept list does not have is
 * looked for in the database before it is said not to be the project's.
 *
 * A list read for the answer itself is the database as it is now: nothing is
 * kept while Redis is not connected, nor before a project's list is first
 * read. Reading that one again found the same, with a second statement - and,
 * in a suite that answers the project's states through getAllIncidentStates
 * and getAllAlertStates (ProjectStatesHelper), with a read of a database that
 * is not there.
 */

type StateModel = IncidentState | AlertState;

interface Kind {
  name: string;
  ids: ProjectStateIds;
  states: () => Array<StateModel>;
  // A state placed after Resolved, which is resolved whatever its flags say.
  stateAfterResolved: (id: ObjectID) => StateModel;
  /*
   * Stands in for the service's reads of the database: each answers the next
   * list, the last one every read after. Returns how many reads were made.
   */
  stubReads: (lists: Array<Array<StateModel>>) => () => number;
  isResolved: (stateId: ObjectID) => Promise<boolean>;
  forgetKept: () => void;
}

const PROJECT_ID: ObjectID = new ObjectID(
  "6b2f0c55-1a0e-4c3d-9e1f-5d0a7c2b9e01",
);

function placeAfterResolved<T extends StateModel>(state: T, id: ObjectID): T {
  state._id = id.toString();
  state.name = "Postmortem";
  state.order = 5;
  return state;
}

function readsAnswering<T extends StateModel>(
  lists: Array<Array<StateModel>>,
): { next: () => Array<T>; count: () => number } {
  let reads: number = 0;

  return {
    next: (): Array<T> => {
      const list: Array<StateModel> =
        lists[Math.min(reads, lists.length - 1)] || [];
      reads++;
      return list as Array<T>;
    },
    count: (): number => {
      return reads;
    },
  };
}

const INCIDENT: Kind = {
  name: "incident",
  ids: INCIDENT_STATE_IDS,
  states: makeIncidentStates,
  stateAfterResolved: (id: ObjectID): StateModel => {
    return placeAfterResolved(new IncidentState(), id);
  },
  stubReads: (lists: Array<Array<StateModel>>): (() => number) => {
    const reads: { next: () => Array<IncidentState>; count: () => number } =
      readsAnswering<IncidentState>(lists);

    jest
      .spyOn(IncidentStateService, "findBy")
      .mockImplementation(async (): Promise<Array<IncidentState>> => {
        return reads.next();
      });

    return reads.count;
  },
  isResolved: (stateId: ObjectID): Promise<boolean> => {
    return IncidentStateService.isResolvedIncidentState({
      projectId: PROJECT_ID,
      incidentStateId: stateId,
    });
  },
  forgetKept: (): void => {
    IncidentStateService.statesAsOneUptime.clear();
  },
};

const ALERT: Kind = {
  name: "alert",
  ids: ALERT_STATE_IDS,
  states: makeAlertStates,
  stateAfterResolved: (id: ObjectID): StateModel => {
    return placeAfterResolved(new AlertState(), id);
  },
  stubReads: (lists: Array<Array<StateModel>>): (() => number) => {
    const reads: { next: () => Array<AlertState>; count: () => number } =
      readsAnswering<AlertState>(lists);

    jest
      .spyOn(AlertStateService, "findBy")
      .mockImplementation(async (): Promise<Array<AlertState>> => {
        return reads.next();
      });

    return reads.count;
  },
  isResolved: (stateId: ObjectID): Promise<boolean> => {
    return AlertStateService.isResolvedAlertState({
      projectId: PROJECT_ID,
      alertStateId: stateId,
    });
  },
  forgetKept: (): void => {
    AlertStateService.statesAsOneUptime.clear();
  },
};

// One process, over a Redis of its own: where the project's generation is kept.
function connectRedis(): void {
  const redis: Map<string, string> = new Map<string, string>();

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
}

describe.each([INCIDENT, ALERT])(
  "whether an $name's state is resolved",
  (kind: Kind) => {
    beforeEach(() => {
      kind.forgetKept();
    });

    afterEach(() => {
      jest.restoreAllMocks();
      kind.forgetKept();
    });

    describe("while Redis is not connected, so nothing is kept", () => {
      beforeEach(() => {
        jest.spyOn(Redis, "isConnected").mockReturnValue(false);
      });

      test("a state of the project is answered from one read", async () => {
        const reads: () => number = kind.stubReads([kind.states()]);

        expect(await kind.isResolved(kind.ids.resolved)).toBe(true);
        expect(reads()).toBe(1);
      });

      test("a state that is not the project's is answered from the same one read", async () => {
        const reads: () => number = kind.stubReads([kind.states()]);

        expect(await kind.isResolved(ObjectID.generate())).toBe(false);
        expect(reads()).toBe(1);
      });
    });

    describe("while Redis is connected, so the list is kept", () => {
      beforeEach(() => {
        connectRedis();
      });

      test("the project's first answer reads the list, and a state it does not have is not looked for again", async () => {
        const reads: () => number = kind.stubReads([kind.states()]);

        expect(await kind.isResolved(ObjectID.generate())).toBe(false);
        expect(reads()).toBe(1);
      });

      test("a state the kept list has is answered with no read", async () => {
        const reads: () => number = kind.stubReads([kind.states()]);

        expect(await kind.isResolved(kind.ids.created)).toBe(false);
        expect(await kind.isResolved(kind.ids.resolved)).toBe(true);
        expect(await kind.isResolved(kind.ids.closed)).toBe(true);
        expect(reads()).toBe(1);
      });

      test("a state the kept list does not have is looked for in the database, where one created since in another process is found", async () => {
        const createdSince: ObjectID = ObjectID.generate();
        const reads: () => number = kind.stubReads([
          kind.states(),
          [...kind.states(), kind.stateAfterResolved(createdSince)],
        ]);

        // Keeps the list as it was before the state was created.
        expect(await kind.isResolved(kind.ids.created)).toBe(false);

        expect(await kind.isResolved(createdSince)).toBe(true);
        expect(reads()).toBe(2);
      });

      test("a state that is not the project's, after a kept list, is read for once and is not resolved", async () => {
        const reads: () => number = kind.stubReads([kind.states()]);

        await kind.isResolved(kind.ids.created);

        expect(await kind.isResolved(ObjectID.generate())).toBe(false);
        expect(reads()).toBe(2);
      });

      test("states a suite answers in place of the database (ProjectStatesHelper) are not read past", async () => {
        mockProjectStates();
        const reads: () => number = kind.stubReads([kind.states()]);

        expect(await kind.isResolved(ObjectID.generate())).toBe(false);
        expect(await kind.isResolved(kind.ids.closed)).toBe(true);
        expect(reads()).toBe(0);
      });
    });
  },
);
