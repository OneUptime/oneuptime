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
  renderHook,
  RenderHookResult,
  waitFor,
} from "@testing-library/react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The owners an incident's, alert's or episode's header names: its owner
 * teams and owner people, read for the record on screen, teams first. The
 * page stays mounted when the reader moves to another record, so what was
 * read for one never stands in for the next.
 */

const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
    },
  };
});

import useEventOwners, {
  EventOwnersState,
  OWNER_TEAM_SELECT,
  OWNER_USER_SELECT,
  UseEventOwnersOptions,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/useEventOwners";
import { getEventOwnerName } from "../../../../App/FeatureSet/Dashboard/src/Utils/EventPeople";
import { ResourceOwnerEntry } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/OwnerEntry";
import IncidentOwnerTeam from "../../../Models/DatabaseModels/IncidentOwnerTeam";
import IncidentOwnerUser from "../../../Models/DatabaseModels/IncidentOwnerUser";
import AlertOwnerTeam from "../../../Models/DatabaseModels/AlertOwnerTeam";
import AlertOwnerUser from "../../../Models/DatabaseModels/AlertOwnerUser";
import Team from "../../../Models/DatabaseModels/Team";
import User from "../../../Models/DatabaseModels/User";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";
import PermissionGate, {
  ModelAction,
  PermissionCheckableModel,
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const INCIDENT_ID: string = "20000000-0000-4000-8000-000000001042";
const OTHER_INCIDENT_ID: string = "20000000-0000-4000-8000-000000001029";

interface ListRequest {
  modelType: unknown;
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  sort: Record<string, unknown>;
  limit: number;
  skip: number;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = (): void => {};
  let reject: (reason: unknown) => void = (): void => {};
  const promise: Promise<T> = new Promise<T>(
    (
      promiseResolve: (value: T) => void,
      promiseReject: (reason: unknown) => void,
    ) => {
      resolve = promiseResolve;
      reject = promiseReject;
    },
  );
  return { promise, resolve, reject };
}

function userRow(name: string, id: string): IncidentOwnerUser {
  const user: User = new User();
  user._id = id;
  user.name = new Name(name);
  const row: IncidentOwnerUser = new IncidentOwnerUser();
  row.user = user;
  return row;
}

function teamRow(name: string, id: string): IncidentOwnerTeam {
  const team: Team = new Team();
  team._id = id;
  team.name = name;
  const row: IncidentOwnerTeam = new IncidentOwnerTeam();
  row.team = team;
  return row;
}

function listOf(data: Array<unknown>): {
  data: Array<unknown>;
  count: number;
  skip: number;
  limit: number;
} {
  return { data, count: data.length, skip: 0, limit: LIMIT_PER_PROJECT };
}

function names(state: EventOwnersState): Array<string> | undefined {
  return state.owners?.map((owner: ResourceOwnerEntry): string => {
    return `${owner.kind}:${getEventOwnerName(owner)}`;
  });
}

function incidentOptions(id: string): UseEventOwnersOptions {
  return {
    ownerUserModelType: IncidentOwnerUser,
    ownerTeamModelType: IncidentOwnerTeam,
    resourceIdField: "incidentId",
    resourceId: new ObjectID(id),
  };
}

let projectId: ObjectID | null = new ObjectID(PROJECT_ID);

beforeEach(() => {
  projectId = new ObjectID(PROJECT_ID);
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockImplementation(() => {
    return projectId;
  });
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  jest.restoreAllMocks();
});

describe("useEventOwners", () => {
  test("reads the record's owner people and owner teams, as the Owners page does", async () => {
    getListMock.mockImplementation((...args: Array<unknown>) => {
      const request: ListRequest = args[0] as ListRequest;
      return Promise.resolve(
        listOf(
          request.modelType === IncidentOwnerUser
            ? [userRow("Sam Rivera", "80000000-0000-4000-8000-000000000002")]
            : [teamRow("Checkout SRE", "81000000-0000-4000-8000-000000000001")],
        ),
      );
    });

    const hook: RenderHookResult<EventOwnersState, UseEventOwnersOptions> =
      renderHook(useEventOwners, {
        initialProps: incidentOptions(INCIDENT_ID),
      });

    await waitFor(() => {
      expect(hook.result.current.owners).toBeDefined();
    });

    const requests: Array<ListRequest> = getListMock.mock.calls.map(
      (call: Array<unknown>): ListRequest => {
        return call[0] as ListRequest;
      },
    );

    expect(
      requests.map((request: ListRequest) => {
        return request.modelType;
      }),
    ).toEqual([IncidentOwnerUser, IncidentOwnerTeam]);

    for (const request of requests) {
      expect(String(request.query["incidentId"])).toBe(INCIDENT_ID);
      expect(String(request.query["projectId"])).toBe(PROJECT_ID);
      expect(request.limit).toBe(LIMIT_PER_PROJECT);
      expect(request.skip).toBe(0);
      expect(request.sort).toEqual({ createdAt: SortOrder.Ascending });
    }

    expect(requests[0]!.select).toEqual(OWNER_USER_SELECT);
    expect(requests[1]!.select).toEqual(OWNER_TEAM_SELECT);
    // A person's picture is asked for, so the avatar shows it.
    expect(OWNER_USER_SELECT["user"]).toEqual({
      _id: true,
      name: true,
      email: true,
      profilePictureId: true,
    });
    expect(OWNER_TEAM_SELECT["team"]).toEqual({ _id: true, name: true });

    // Teams first, though people were read first.
    expect(names(hook.result.current)).toEqual([
      "team:Checkout SRE",
      "user:Sam Rivera",
    ]);
    expect(hook.result.current.error).toBe("");
  });

  test("an alert's owners come from the alert's own owner tables", async () => {
    getListMock.mockImplementation(() => {
      return Promise.resolve(listOf([]));
    });

    const hook: RenderHookResult<EventOwnersState, UseEventOwnersOptions> =
      renderHook<EventOwnersState, UseEventOwnersOptions>(useEventOwners, {
        initialProps: {
          ownerUserModelType: AlertOwnerUser,
          ownerTeamModelType: AlertOwnerTeam,
          resourceIdField: "alertId",
          resourceId: new ObjectID("30000000-0000-4000-8000-000000000311"),
        },
      });

    await waitFor(() => {
      expect(hook.result.current.owners).toEqual([]);
    });

    const requests: Array<ListRequest> = getListMock.mock.calls.map(
      (call: Array<unknown>): ListRequest => {
        return call[0] as ListRequest;
      },
    );

    expect(
      requests.map((request: ListRequest) => {
        return [request.modelType, String(request.query["alertId"])];
      }),
    ).toEqual([
      [AlertOwnerUser, "30000000-0000-4000-8000-000000000311"],
      [AlertOwnerTeam, "30000000-0000-4000-8000-000000000311"],
    ]);
  });

  test("says nothing until both reads are in", async () => {
    const users: Deferred<unknown> = createDeferred<unknown>();
    const teams: Deferred<unknown> = createDeferred<unknown>();

    getListMock.mockImplementation((...args: Array<unknown>) => {
      return (args[0] as ListRequest).modelType === IncidentOwnerUser
        ? users.promise
        : teams.promise;
    });

    const hook: RenderHookResult<EventOwnersState, UseEventOwnersOptions> =
      renderHook(useEventOwners, {
        initialProps: incidentOptions(INCIDENT_ID),
      });

    expect(hook.result.current.owners).toBeUndefined();

    await act(async () => {
      users.resolve(listOf([userRow("Sam Rivera", "u1")]));
    });

    expect(hook.result.current.owners).toBeUndefined();

    await act(async () => {
      teams.resolve(listOf([]));
    });

    expect(names(hook.result.current)).toEqual(["user:Sam Rivera"]);
  });

  test("a read it may not make leaves the header without Owners, and says why", async () => {
    getListMock.mockImplementation(() => {
      return Promise.reject(
        new Error("You do not have permission to read owners."),
      );
    });

    const hook: RenderHookResult<EventOwnersState, UseEventOwnersOptions> =
      renderHook(useEventOwners, {
        initialProps: incidentOptions(INCIDENT_ID),
      });

    await waitFor(() => {
      expect(hook.result.current.error).toBe(
        "You do not have permission to read owners.",
      );
    });

    // Not an empty list: that would say the record has no owners.
    expect(hook.result.current.owners).toBeUndefined();
  });

  test("a row whose person or team could not be read is left out", async () => {
    getListMock.mockImplementation((...args: Array<unknown>) => {
      return Promise.resolve(
        listOf(
          (args[0] as ListRequest).modelType === IncidentOwnerUser
            ? [new IncidentOwnerUser(), userRow("Sam Rivera", "u1")]
            : [new IncidentOwnerTeam()],
        ),
      );
    });

    const hook: RenderHookResult<EventOwnersState, UseEventOwnersOptions> =
      renderHook(useEventOwners, {
        initialProps: incidentOptions(INCIDENT_ID),
      });

    await waitFor(() => {
      expect(names(hook.result.current)).toEqual(["user:Sam Rivera"]);
    });
  });

  test("moving to another record forgets the previous one's owners at once, and a late answer for it is dropped", async () => {
    const firstUsers: Deferred<unknown> = createDeferred<unknown>();
    const firstTeams: Deferred<unknown> = createDeferred<unknown>();

    getListMock.mockImplementation((...args: Array<unknown>) => {
      const request: ListRequest = args[0] as ListRequest;

      if (String(request.query["incidentId"]) === INCIDENT_ID) {
        return request.modelType === IncidentOwnerUser
          ? firstUsers.promise
          : firstTeams.promise;
      }

      return Promise.resolve(
        listOf(
          request.modelType === IncidentOwnerUser
            ? []
            : [teamRow("Payments", "81000000-0000-4000-8000-000000000002")],
        ),
      );
    });

    const hook: RenderHookResult<EventOwnersState, UseEventOwnersOptions> =
      renderHook(useEventOwners, {
        initialProps: incidentOptions(INCIDENT_ID),
      });

    hook.rerender(incidentOptions(OTHER_INCIDENT_ID));

    await waitFor(() => {
      expect(names(hook.result.current)).toEqual(["team:Payments"]);
    });

    // The first incident's reads land late: they never replace these.
    await act(async () => {
      firstUsers.resolve(listOf([userRow("Sam Rivera", "u1")]));
      firstTeams.resolve(listOf([teamRow("Checkout SRE", "t1")]));
    });

    expect(names(hook.result.current)).toEqual(["team:Payments"]);
  });

  test("the previous record's owners are not shown for the next while it is read", async () => {
    getListMock.mockImplementation((...args: Array<unknown>) => {
      const request: ListRequest = args[0] as ListRequest;

      if (String(request.query["incidentId"]) === INCIDENT_ID) {
        return Promise.resolve(
          listOf(
            request.modelType === IncidentOwnerUser
              ? []
              : [teamRow("Checkout SRE", "t1")],
          ),
        );
      }

      // The next record's reads never answer in this test.
      return new Promise<unknown>(() => {});
    });

    const hook: RenderHookResult<EventOwnersState, UseEventOwnersOptions> =
      renderHook(useEventOwners, {
        initialProps: incidentOptions(INCIDENT_ID),
      });

    await waitFor(() => {
      expect(names(hook.result.current)).toEqual(["team:Checkout SRE"]);
    });

    hook.rerender(incidentOptions(OTHER_INCIDENT_ID));

    expect(hook.result.current.owners).toBeUndefined();
  });

  test("reads nothing outside a project", () => {
    projectId = null;

    const hook: RenderHookResult<EventOwnersState, UseEventOwnersOptions> =
      renderHook(useEventOwners, {
        initialProps: incidentOptions(INCIDENT_ID),
      });

    expect(getListMock).not.toHaveBeenCalled();
    expect(hook.result.current.owners).toBeUndefined();
  });
});

/*
 * Once the header's Add owners list adds an owner, the header reads its
 * owners again (refresh) and names the new one - settling only once it
 * does, so the pick's row stays busy until then. A read again that fails
 * keeps the owners on screen: the owner was added all the same.
 */
describe("reading the owners again (refresh)", () => {
  test("names the owner just added, and settles once it does", async () => {
    let rows: Array<IncidentOwnerUser> = [];

    getListMock.mockImplementation((...args: Array<unknown>) => {
      return Promise.resolve(
        listOf(
          (args[0] as ListRequest).modelType === IncidentOwnerUser
            ? rows
            : [teamRow("Checkout SRE", "81000000-0000-4000-8000-000000000001")],
        ),
      );
    });

    const hook: RenderHookResult<EventOwnersState, UseEventOwnersOptions> =
      renderHook(useEventOwners, {
        initialProps: incidentOptions(INCIDENT_ID),
      });

    await waitFor(() => {
      expect(names(hook.result.current)).toEqual(["team:Checkout SRE"]);
    });

    rows = [userRow("Jordan Patel", "80000000-0000-4000-8000-000000000003")];

    await act(async () => {
      await hook.result.current.refresh();
    });

    // Named by the time refresh settles: nothing else to wait for.
    expect(names(hook.result.current)).toEqual([
      "team:Checkout SRE",
      "user:Jordan Patel",
    ]);
    // Read again for this record, from the same tables.
    expect(getListMock).toHaveBeenCalledTimes(4);
    for (const call of getListMock.mock.calls) {
      expect(String((call[0] as ListRequest).query["incidentId"])).toBe(
        INCIDENT_ID,
      );
    }
  });

  test("keeps the owners on screen while it reads, and when the read fails", async () => {
    getListMock.mockImplementation((...args: Array<unknown>) => {
      return Promise.resolve(
        listOf(
          (args[0] as ListRequest).modelType === IncidentOwnerUser
            ? [userRow("Sam Rivera", "80000000-0000-4000-8000-000000000002")]
            : [],
        ),
      );
    });

    const hook: RenderHookResult<EventOwnersState, UseEventOwnersOptions> =
      renderHook(useEventOwners, {
        initialProps: incidentOptions(INCIDENT_ID),
      });

    await waitFor(() => {
      expect(names(hook.result.current)).toEqual(["user:Sam Rivera"]);
    });

    const pending: Deferred<unknown> = createDeferred<unknown>();

    getListMock.mockImplementation(() => {
      return pending.promise;
    });

    let refreshed: Promise<void> = Promise.resolve();

    act(() => {
      refreshed = hook.result.current.refresh();
    });

    // While it reads: the same owners, never a blank or a placeholder.
    expect(names(hook.result.current)).toEqual(["user:Sam Rivera"]);

    await act(async () => {
      pending.reject(new Error("The API is restarting."));
      await refreshed;
    });

    expect(names(hook.result.current)).toEqual(["user:Sam Rivera"]);
    expect(hook.result.current.error).toBe("");
  });

  test("a read again for a record the reader has left never stands in for the next", async () => {
    const late: Deferred<unknown> = createDeferred<unknown>();
    let isFirstRecordReadAgain: boolean = false;

    getListMock.mockImplementation((...args: Array<unknown>) => {
      const request: ListRequest = args[0] as ListRequest;

      if (
        String(request.query["incidentId"]) === INCIDENT_ID &&
        isFirstRecordReadAgain
      ) {
        return late.promise;
      }

      return Promise.resolve(
        listOf(
          String(request.query["incidentId"]) === INCIDENT_ID
            ? []
            : request.modelType === IncidentOwnerUser
              ? []
              : [teamRow("Payments", "81000000-0000-4000-8000-000000000002")],
        ),
      );
    });

    const hook: RenderHookResult<EventOwnersState, UseEventOwnersOptions> =
      renderHook(useEventOwners, {
        initialProps: incidentOptions(INCIDENT_ID),
      });

    await waitFor(() => {
      expect(hook.result.current.owners).toEqual([]);
    });

    isFirstRecordReadAgain = true;

    let refreshed: Promise<void> = Promise.resolve();

    act(() => {
      refreshed = hook.result.current.refresh();
    });

    hook.rerender(incidentOptions(OTHER_INCIDENT_ID));

    await waitFor(() => {
      expect(names(hook.result.current)).toEqual(["team:Payments"]);
    });

    await act(async () => {
      late.resolve(listOf([userRow("Sam Rivera", "u1")]));
      await refreshed;
    });

    expect(names(hook.result.current)).toEqual(["team:Payments"]);
  });

  test("hands on the record's owner tables, for the header's Add owners list to add to", () => {
    getListMock.mockImplementation(() => {
      return new Promise(() => {});
    });

    const hook: RenderHookResult<EventOwnersState, UseEventOwnersOptions> =
      renderHook(useEventOwners, {
        initialProps: incidentOptions(INCIDENT_ID),
      });

    const first: EventOwnersState["target"] = hook.result.current.target;

    expect(first.ownerUserModelType).toBe(IncidentOwnerUser);
    expect(first.ownerTeamModelType).toBe(IncidentOwnerTeam);
    expect(first.resourceIdField).toBe("incidentId");
    expect(first.resourceId.toString()).toBe(INCIDENT_ID);

    // The same object while the record is the same: the list is not reset.
    hook.rerender(incidentOptions(INCIDENT_ID));
    expect(hook.result.current.target).toBe(first);

    hook.rerender(incidentOptions(OTHER_INCIDENT_ID));
    expect(hook.result.current.target.resourceId.toString()).toBe(
      OTHER_INCIDENT_ID,
    );
  });
});

/*
 * The header offers Add owners only to a reader the Owners page would let
 * add one: someone who may create an owner row - a person or a team - for
 * the record. Read from the permission snapshot (PermissionGate), so it is
 * false before the snapshot lands.
 */
describe("whether the reader may add owners", () => {
  function allowCreating(
    allowed: Array<{ new (): PermissionCheckableModel }>,
  ): Array<{ model: string; action: ModelAction }> {
    const asked: Array<{ model: string; action: ModelAction }> = [];

    jest
      .spyOn(PermissionGate, "check")
      .mockImplementation(
        (
          model: PermissionCheckableModel,
          action: ModelAction,
        ): PermissionGateResult => {
          asked.push({ model: model.constructor.name, action: action });
          return {
            isAllowed:
              action === ModelAction.Create &&
              allowed.some(
                (type: { new (): PermissionCheckableModel }): boolean => {
                  return model instanceof type;
                },
              ),
          };
        },
      );

    return asked;
  }

  test.each([
    ["owner people and owner teams", [IncidentOwnerUser, IncidentOwnerTeam]],
    ["owner people only", [IncidentOwnerUser]],
    ["owner teams only", [IncidentOwnerTeam]],
  ])(
    "may, when the reader may create %s for it",
    (
      _name: string,
      allowed: Array<{ new (): PermissionCheckableModel }>,
    ): void => {
      getListMock.mockImplementation(() => {
        return new Promise(() => {});
      });
      const asked: Array<{ model: string; action: ModelAction }> =
        allowCreating(allowed);

      const hook: RenderHookResult<EventOwnersState, UseEventOwnersOptions> =
        renderHook(useEventOwners, {
          initialProps: incidentOptions(INCIDENT_ID),
        });

      // Known before the owners are read.
      expect(hook.result.current.owners).toBeUndefined();
      expect(hook.result.current.canAddOwners).toBe(true);
      // Asked of the record's own owner tables, to create a row.
      expect(asked[0]).toEqual({
        model: "IncidentOwnerUser",
        action: ModelAction.Create,
      });
    },
  );

  test("may not before the permission snapshot has landed: nothing is offered on a guess", () => {
    getListMock.mockImplementation(() => {
      return new Promise(() => {});
    });

    // The real gate, with no snapshot stored and no master admin.
    const hook: RenderHookResult<EventOwnersState, UseEventOwnersOptions> =
      renderHook(useEventOwners, {
        initialProps: incidentOptions(INCIDENT_ID),
      });

    expect(hook.result.current.canAddOwners).toBe(false);
  });

  test("may not, when the reader may create neither", async () => {
    getListMock.mockImplementation(() => {
      return Promise.resolve(listOf([]));
    });
    const asked: Array<{ model: string; action: ModelAction }> = allowCreating(
      [],
    );

    const hook: RenderHookResult<EventOwnersState, UseEventOwnersOptions> =
      renderHook(useEventOwners, {
        initialProps: incidentOptions(INCIDENT_ID),
      });

    await waitFor(() => {
      expect(hook.result.current.owners).toEqual([]);
    });

    expect(hook.result.current.canAddOwners).toBe(false);
    expect(
      asked.map((question: { model: string; action: ModelAction }) => {
        return question.model;
      }),
    ).toEqual(
      expect.arrayContaining(["IncidentOwnerUser", "IncidentOwnerTeam"]),
    );
  });

  test("an alert's are its own owner tables'", () => {
    getListMock.mockImplementation(() => {
      return new Promise(() => {});
    });
    allowCreating([AlertOwnerTeam]);

    const alertOptions: UseEventOwnersOptions = {
      ownerUserModelType: AlertOwnerUser,
      ownerTeamModelType: AlertOwnerTeam,
      resourceIdField: "alertId",
      resourceId: new ObjectID(INCIDENT_ID),
    };
    const alert: RenderHookResult<EventOwnersState, UseEventOwnersOptions> =
      renderHook(useEventOwners, {
        initialProps: alertOptions,
      });

    expect(alert.result.current.canAddOwners).toBe(true);
    alert.unmount();

    const incident: RenderHookResult<EventOwnersState, UseEventOwnersOptions> =
      renderHook(useEventOwners, {
        initialProps: incidentOptions(INCIDENT_ID),
      });

    expect(incident.result.current.canAddOwners).toBe(false);
  });
});
