import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * THE STATES A RESOURCE'S ACTIVE MAINTENANCE IS COUNTED IN.
 *
 * A monitor's, a network site's or a cluster's side menu badge and its
 * Activity cards count the scheduled maintenance events still active on it:
 * waiting to start or in progress - every state but those where the event
 * is over (Common/Utils/ScheduledMaintenanceStart.getPhase): Ended,
 * Completed and the project's own states placed after Ended ("Reviewing",
 * "Archived"). A state of the project's own before Ongoing ("Confirmed"),
 * or before Scheduled ("Draft"), or between Ongoing and Ended
 * ("Verifying"), is active.
 *
 * The list is read through the same cached list the Ongoing lists read, so
 * the menus mounted together make one request for it.
 */

const listMock: MockFunction = getJestMockFunction();
const apiListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelListCache", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return listMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return apiListMock(...args);
      },
    },
  };
});

import ScheduledMaintenanceStateUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/ScheduledMaintenanceState";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import ObjectID from "../../../Types/ObjectID";

const PROJECT_ID: ObjectID = new ObjectID(
  "6a000000-0000-4000-8000-000000000001",
);

interface StateRecord {
  name: string;
  flag?:
    | "isScheduledState"
    | "isOngoingState"
    | "isEndedState"
    | "isResolvedState";
}

// A project's whole list, top first, with a state of its own in every gap.
const PROJECT_LIST: Array<StateRecord> = [
  { name: "Draft" },
  { name: "Scheduled", flag: "isScheduledState" },
  { name: "Confirmed" },
  { name: "Ongoing", flag: "isOngoingState" },
  { name: "Verifying" },
  { name: "Ended", flag: "isEndedState" },
  { name: "Reviewing" },
  { name: "Completed", flag: "isResolvedState" },
  { name: "Archived" },
];

function statesOf(
  records: Array<StateRecord>,
): Array<ScheduledMaintenanceState> {
  return records.map(
    (record: StateRecord, index: number): ScheduledMaintenanceState => {
      const state: ScheduledMaintenanceState = new ScheduledMaintenanceState();
      state._id = `6a000000-0000-4000-8000-0000000000${String(index + 10)}`;
      state.name = record.name;
      state.order = index + 1;
      state.isScheduledState = record.flag === "isScheduledState";
      state.isOngoingState = record.flag === "isOngoingState";
      state.isEndedState = record.flag === "isEndedState";
      state.isResolvedState = record.flag === "isResolvedState";
      return state;
    },
  );
}

function namesOf(states: Array<ScheduledMaintenanceState>): Array<string> {
  return states.map((state: ScheduledMaintenanceState): string => {
    return state.name || "";
  });
}

describe("ScheduledMaintenanceStateUtil.getActiveScheduledMaintenanceStates", () => {
  beforeEach(() => {
    listMock.mockReset();
    apiListMock.mockReset();
    listMock.mockImplementation((async () => {
      const data: Array<ScheduledMaintenanceState> = statesOf(PROJECT_LIST);
      return { data, count: data.length, skip: 0, limit: data.length };
    }) as never);
  });

  test("is every state the event is not over in: waiting to start or in progress, the project's own states among them", async () => {
    expect(
      namesOf(
        await ScheduledMaintenanceStateUtil.getActiveScheduledMaintenanceStates(
          PROJECT_ID,
        ),
      ),
    ).toEqual(["Draft", "Scheduled", "Confirmed", "Ongoing", "Verifying"]);
  });

  test("a state of the project's own after Ended is over, as Ended and Completed are", async () => {
    const names: Array<string> = namesOf(
      await ScheduledMaintenanceStateUtil.getActiveScheduledMaintenanceStates(
        PROJECT_ID,
      ),
    );

    for (const over of ["Ended", "Reviewing", "Completed", "Archived"]) {
      expect(names).not.toContain(over);
    }
  });

  test("places each state by its order, however the list arrives", async () => {
    listMock.mockImplementation((async () => {
      const data: Array<ScheduledMaintenanceState> =
        statesOf(PROJECT_LIST).reverse();
      return { data, count: data.length, skip: 0, limit: data.length };
    }) as never);

    expect(
      namesOf(
        await ScheduledMaintenanceStateUtil.getActiveScheduledMaintenanceStates(
          PROJECT_ID,
        ),
      ).sort(),
    ).toEqual(["Confirmed", "Draft", "Ongoing", "Scheduled", "Verifying"]);
  });

  test("reads the project's states once, through the cached list the Ongoing lists read, with their place and every flag", async () => {
    await ScheduledMaintenanceStateUtil.getActiveScheduledMaintenanceStates(
      PROJECT_ID,
    );

    expect(apiListMock).not.toHaveBeenCalled();
    expect(listMock).toHaveBeenCalledTimes(1);

    const request: {
      modelType: unknown;
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      projectId: ObjectID;
    } = listMock.mock.calls[0]![0] as {
      modelType: unknown;
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      projectId: ObjectID;
    };

    expect(request.modelType).toBe(ScheduledMaintenanceState);
    expect(String(request.query["projectId"])).toBe(PROJECT_ID.toString());
    expect(request.projectId.toString()).toBe(PROJECT_ID.toString());

    for (const column of [
      "_id",
      "order",
      "isScheduledState",
      "isOngoingState",
      "isEndedState",
      "isResolvedState",
    ]) {
      expect(request.select[column]).toBe(true);
    }
  });

  test("a project with only the built-in states: Scheduled and Ongoing", async () => {
    listMock.mockImplementation((async () => {
      const data: Array<ScheduledMaintenanceState> = statesOf([
        { name: "Scheduled", flag: "isScheduledState" },
        { name: "Ongoing", flag: "isOngoingState" },
        { name: "Ended", flag: "isEndedState" },
        { name: "Completed", flag: "isResolvedState" },
      ]);
      return { data, count: data.length, skip: 0, limit: data.length };
    }) as never);

    expect(
      namesOf(
        await ScheduledMaintenanceStateUtil.getActiveScheduledMaintenanceStates(
          PROJECT_ID,
        ),
      ),
    ).toEqual(["Scheduled", "Ongoing"]);
  });
});
