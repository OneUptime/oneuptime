import Project from "Common/Models/DatabaseModels/Project";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import ProjectService from "Common/Server/Services/ProjectService";
import ScheduledMaintenanceStateService from "Common/Server/Services/ScheduledMaintenanceStateService";
import CreateBy from "Common/Server/Types/Database/CreateBy";
import FindOneBy from "Common/Server/Types/Database/FindOneBy";
import ObjectID from "Common/Types/ObjectID";
import AddEndedState from "../../../FeatureSet/Workers/DataMigrations/AddEndedState";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * AddEndedState: projects from before maintenance events had an Ended state
 * get one, just above their Completed state.
 *
 * A project's maintenance states are a drag-ordered list: a write of a
 * state's number places that state and moves no other (issue #9609). The
 * migration used to write the Completed state's number on the new state:
 * the two then shared it, and the Ended state - the newer - was listed below
 * Completed, out of the order maintenance events move in. It now writes no
 * number, so the server gives the new state the Completed state's place and
 * Completed steps down one (StateOrderGuard, ListOrderMaintainer), as for
 * any state created without a number.
 */

const WITH_COMPLETED: ObjectID = new ObjectID(
  "1e000000-0000-4000-8000-000000000001",
);
const WITH_ENDED: ObjectID = new ObjectID(
  "1e000000-0000-4000-8000-000000000002",
);
const WITH_NAMESAKE: ObjectID = new ObjectID(
  "1e000000-0000-4000-8000-000000000003",
);
const WITHOUT_COMPLETED: ObjectID = new ObjectID(
  "1e000000-0000-4000-8000-000000000004",
);

interface StoredState {
  projectId: string;
  name: string;
  order: number;
  isResolvedState?: boolean;
  isEndedState?: boolean;
}

const STATES: Array<StoredState> = [
  {
    projectId: WITH_COMPLETED.toString(),
    name: "Completed",
    order: 3,
    isResolvedState: true,
  },
  {
    projectId: WITH_ENDED.toString(),
    name: "Completed",
    order: 4,
    isResolvedState: true,
  },
  {
    projectId: WITH_ENDED.toString(),
    name: "Wrapped up",
    order: 3,
    isEndedState: true,
  },
  {
    projectId: WITH_NAMESAKE.toString(),
    name: "Completed",
    order: 4,
    isResolvedState: true,
  },
  { projectId: WITH_NAMESAKE.toString(), name: "Ended", order: 3 },
];

function project(id: ObjectID): Project {
  const item: Project = new Project();
  item._id = id.toString();
  return item;
}

describe("AddEndedState", () => {
  let created: Array<CreateBy<ScheduledMaintenanceState>>;

  beforeEach(() => {
    created = [];

    jest
      .spyOn(ProjectService, "findBy")
      .mockResolvedValue([
        project(WITH_COMPLETED),
        project(WITH_ENDED),
        project(WITH_NAMESAKE),
        project(WITHOUT_COMPLETED),
      ] as never);

    jest
      .spyOn(ScheduledMaintenanceStateService, "findOneBy")
      .mockImplementation((async (
        findOneBy: FindOneBy<ScheduledMaintenanceState>,
      ) => {
        const query: Record<string, unknown> = findOneBy.query as Record<
          string,
          unknown
        >;
        const match: StoredState | undefined = STATES.find(
          (state: StoredState): boolean => {
            return (
              state.projectId === String(query["projectId"]) &&
              (query["isResolvedState"] === undefined ||
                state.isResolvedState === query["isResolvedState"]) &&
              (query["isEndedState"] === undefined ||
                state.isEndedState === query["isEndedState"]) &&
              (query["name"] === undefined || state.name === query["name"])
            );
          },
        );

        if (!match) {
          return null;
        }

        const state: ScheduledMaintenanceState =
          new ScheduledMaintenanceState();
        state.order = match.order;
        return state;
      }) as never);

    jest
      .spyOn(ScheduledMaintenanceStateService, "create")
      .mockImplementation((async (
        createBy: CreateBy<ScheduledMaintenanceState>,
      ) => {
        created.push(createBy);
        return createBy.data;
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("gives a project with a Completed state and no Ended state one, as root", async () => {
    await new AddEndedState().migrate();

    expect(created).toHaveLength(1);

    const ended: ScheduledMaintenanceState = created[0]!.data;

    expect(ended.projectId?.toString()).toBe(WITH_COMPLETED.toString());
    expect(ended.name).toBe("Ended");
    expect(ended.isEndedState).toBe(true);
    expect(created[0]!.props).toEqual({ isRoot: true });
  });

  test("writes no number: the server puts the new state just above Completed, which steps down", async () => {
    await new AddEndedState().migrate();

    expect(created[0]!.data.order).toBeUndefined();
  });

  test("leaves a project that has an Ended state, one named Ended, or no Completed state as it is", async () => {
    await new AddEndedState().migrate();

    expect(
      created.map((createBy: CreateBy<ScheduledMaintenanceState>) => {
        return createBy.data.projectId?.toString();
      }),
    ).toEqual([WITH_COMPLETED.toString()]);
  });
});
