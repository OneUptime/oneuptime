import AutoRemediationRuleEngineService from "../../../Server/Services/AutoRemediationRuleEngineService";
import IncidentGroupingEngineService from "../../../Server/Services/IncidentGroupingEngineService";
import IncidentLabelRuleEngineService from "../../../Server/Services/IncidentLabelRuleEngineService";
import IncidentOnCallRuleEngineService from "../../../Server/Services/IncidentOnCallRuleEngineService";
import IncidentOwnerRuleEngineService from "../../../Server/Services/IncidentOwnerRuleEngineService";
import IncidentOwnerTeamService from "../../../Server/Services/IncidentOwnerTeamService";
import IncidentOwnerUserService from "../../../Server/Services/IncidentOwnerUserService";
import IncidentPrivacyRuleEngineService from "../../../Server/Services/IncidentPrivacyRuleEngineService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentSlaService from "../../../Server/Services/IncidentSlaService";
import RunbookRuleEngineService from "../../../Server/Services/RunbookRuleEngineService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UpdateByID from "../../../Server/Types/Database/UpdateByID";
import AIIncidentInvestigationRunner from "../../../Server/Utils/AI/SRE/IncidentInvestigationRunner";
import logger from "../../../Server/Utils/Logger";
import ProductAnalytics from "../../../Server/Utils/ProductAnalytics";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentOwnerTeam from "../../../Models/DatabaseModels/IncidentOwnerTeam";
import IncidentOwnerUser from "../../../Models/DatabaseModels/IncidentOwnerUser";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

/*
 * The server half of declaring an incident from a template in the
 * dashboard: the page sends the template's owners as misc data -
 * { ownerUsers: [<id>], ownerTeams: [<id>] }, plain id strings in the
 * request's JSON - and IncidentService.onCreateSuccess makes them the
 * incident's owners once it exists (the page used to lose them before they
 * were sent: IncidentCreateTemplateOwners.test.tsx).
 *
 * Pinned here with the ids exactly as BaseAPI hands them over (deserialized
 * JSON), through the real IncidentService.addOwners and
 * OwnerRuleAssignment.addOwners, down to the owner rows written:
 *
 *   - they are added as the caller who declared the incident, not as root;
 *   - they are marked as already notified, as this path always did: the
 *     template's owners are not sent an "added as owner" notification.
 *
 * The rest of the (un-awaited) onCreateSuccess chain is stubbed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0194c3a9-0000-4000-8000-000000000001",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "0194c3a9-0000-4000-8000-0000000000a1",
);
const DECLARING_USER_ID: ObjectID = new ObjectID(
  "0194c3a9-0000-4000-8000-0000000000c1",
);
const USER_A: string = "0000000e-0000-4000-8000-000000000001";
const USER_B: string = "0000000e-0000-4000-8000-000000000002";
const TEAM_A: string = "0000000b-0000-4000-8000-000000000001";

const USER_PROPS: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: DECLARING_USER_ID,
};

type HookFunction = (...args: Array<unknown>) => Promise<unknown>;

function callHook<T>(
  service: unknown,
  name: string,
  ...args: Array<unknown>
): Promise<T> {
  const hooks: Record<string, HookFunction> = service as Record<
    string,
    HookFunction
  >;
  return hooks[name]!.apply(service, args) as Promise<T>;
}

// The chain runs after the hook returns: wait for its last step.
async function waitUntil(condition: () => boolean): Promise<void> {
  for (let attempt: number = 0; attempt < 200; attempt++) {
    if (condition()) {
      return;
    }

    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  }

  throw new Error("The onCreateSuccess chain did not get there.");
}

let createdOwnerUsers: Array<{
  row: IncidentOwnerUser;
  props: DatabaseCommonInteractionProps;
}> = [];
let createdOwnerTeams: Array<{
  row: IncidentOwnerTeam;
  props: DatabaseCommonInteractionProps;
}> = [];
let ownerRulesApplied: boolean = false;

// Every update the chain makes to the incident itself.
let incidentUpdates: Array<UpdateByID<Incident>> = [];
let incidentUpdateMock: ReturnType<typeof jest.fn>;

function createdIncident(): Incident {
  const incident: Incident = new Incident();
  incident._id = INCIDENT_ID.toString();
  incident.projectId = PROJECT_ID;
  incident.title = "Checkout is failing";
  incident.declaredAt = OneUptimeDate.getCurrentDate();
  incident.isPrivate = false;
  return incident;
}

async function onCreateSuccess(
  miscDataInRequest: JSONObject | undefined,
  props: DatabaseCommonInteractionProps = USER_PROPS,
): Promise<void> {
  const incident: Incident = createdIncident();

  await callHook<Incident>(
    IncidentService,
    "onCreateSuccess",
    {
      createBy: {
        data: incident,
        // As BaseAPI.createItem reads it off the request body.
        miscDataProps: miscDataInRequest
          ? JSONFunctions.deserialize(miscDataInRequest)
          : undefined,
        props: props,
      },
      carryForward: null,
    },
    incident,
  );

  // The owner rules run right after the template's owners.
  await waitUntil((): boolean => {
    return ownerRulesApplied;
  });
}

beforeEach(() => {
  // The teams, users and records these writes name are the project's (see ProjectReferenceCheck).
  stubProjectDirectory({});
  createdOwnerUsers = [];
  createdOwnerTeams = [];
  ownerRulesApplied = false;
  incidentUpdates = [];

  jest.spyOn(ProductAnalytics, "captureForUser").mockImplementation((() => {
    // no analytics in tests
  }) as never);

  incidentUpdateMock = jest
    .spyOn(IncidentService, "updateOneById")
    .mockImplementation((async (
      updateBy: UpdateByID<Incident>,
    ): Promise<void> => {
      incidentUpdates.push(updateBy);
    }) as never) as unknown as ReturnType<typeof jest.fn>;

  const reRead: Incident = createdIncident();
  jest.spyOn(IncidentService, "findOneById").mockResolvedValue(reRead as never);

  const service: Record<string, unknown> = IncidentService as unknown as Record<
    string,
    unknown
  >;

  for (const method of [
    "handleIncidentWorkspaceOperationsAsync",
    "createIncidentFeedAsync",
    "handleIncidentStateChangeAsync",
    "disableActiveMonitoringIfManualIncident",
    "refreshReminderSchedule",
    "executeOnCallDutyPoliciesAsync",
  ]) {
    jest
      .spyOn(service as Record<string, () => Promise<void>>, method)
      .mockResolvedValue(undefined as never);
  }

  jest
    .spyOn(IncidentPrivacyRuleEngineService, "applyRulesToIncident")
    .mockResolvedValue(false as never);
  jest
    .spyOn(IncidentOwnerRuleEngineService, "applyRulesToIncident")
    .mockImplementation((async (): Promise<void> => {
      ownerRulesApplied = true;
    }) as never);
  jest
    .spyOn(IncidentLabelRuleEngineService, "applyRulesToIncident")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(IncidentOnCallRuleEngineService, "applyRulesToIncident")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(RunbookRuleEngineService, "applyRulesToIncident")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(IncidentGroupingEngineService, "processIncident")
    .mockResolvedValue({} as never);
  jest
    .spyOn(IncidentSlaService, "createSlaForIncident")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(AIIncidentInvestigationRunner, "investigateNewIncident")
    .mockResolvedValue(false as never);
  jest
    .spyOn(AutoRemediationRuleEngineService, "applyRulesToIncident")
    .mockResolvedValue(undefined as never);

  // Nobody owns the new incident yet, and every user is in the project.
  jest.spyOn(IncidentOwnerUserService, "findBy").mockResolvedValue([] as never);
  jest.spyOn(IncidentOwnerTeamService, "findBy").mockResolvedValue([] as never);
  jest
    .spyOn(TeamMemberService, "isUserMemberOfProject")
    .mockResolvedValue(true as never);

  jest
    .spyOn(IncidentOwnerUserService, "create")
    .mockImplementation((async (createBy: {
      data: IncidentOwnerUser;
      props: DatabaseCommonInteractionProps;
    }): Promise<IncidentOwnerUser> => {
      createdOwnerUsers.push({ row: createBy.data, props: createBy.props });
      return createBy.data;
    }) as never);
  jest
    .spyOn(IncidentOwnerTeamService, "create")
    .mockImplementation((async (createBy: {
      data: IncidentOwnerTeam;
      props: DatabaseCommonInteractionProps;
    }): Promise<IncidentOwnerTeam> => {
      createdOwnerTeams.push({ row: createBy.data, props: createBy.props });
      return createBy.data;
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the template's owners a dashboard declare sends", () => {
  test("become the incident's owners, from plain id strings", async () => {
    await onCreateSuccess({
      ownerUsers: [USER_A, USER_B],
      ownerTeams: [TEAM_A],
    });

    expect(
      createdOwnerUsers.map(
        (created: { row: IncidentOwnerUser }): string | undefined => {
          return created.row.userId?.toString();
        },
      ),
    ).toEqual([USER_A, USER_B]);
    expect(
      createdOwnerTeams.map(
        (created: { row: IncidentOwnerTeam }): string | undefined => {
          return created.row.teamId?.toString();
        },
      ),
    ).toEqual([TEAM_A]);

    for (const created of [...createdOwnerUsers, ...createdOwnerTeams]) {
      expect(created.row.incidentId?.toString()).toBe(INCIDENT_ID.toString());
      expect(created.row.projectId?.toString()).toBe(PROJECT_ID.toString());
    }
  });

  test("are marked as already notified, so no one is sent an 'added as owner' message", async () => {
    await onCreateSuccess({ ownerUsers: [USER_A], ownerTeams: [TEAM_A] });

    expect(createdOwnerUsers[0]!.row.isOwnerNotified).toBe(true);
    expect(createdOwnerTeams[0]!.row.isOwnerNotified).toBe(true);
  });

  test("are added as the user who declared the incident", async () => {
    await onCreateSuccess({ ownerUsers: [USER_A], ownerTeams: [TEAM_A] });

    expect(createdOwnerUsers[0]!.props).toBe(USER_PROPS);
    expect(createdOwnerTeams[0]!.props).toBe(USER_PROPS);
  });

  test("only users, or only teams, are added on their own", async () => {
    await onCreateSuccess({ ownerUsers: [USER_A] });

    expect(createdOwnerUsers).toHaveLength(1);
    expect(createdOwnerTeams).toHaveLength(0);

    createdOwnerUsers = [];
    ownerRulesApplied = false;

    await onCreateSuccess({ ownerTeams: [TEAM_A] });

    expect(createdOwnerUsers).toHaveLength(0);
    expect(createdOwnerTeams).toHaveLength(1);
  });

  test("a declare without owners adds none", async () => {
    await onCreateSuccess({ alertIdsToLink: [] });

    expect(createdOwnerUsers).toEqual([]);
    expect(createdOwnerTeams).toEqual([]);

    ownerRulesApplied = false;

    await onCreateSuccess(undefined);

    expect(createdOwnerUsers).toEqual([]);
    expect(createdOwnerTeams).toEqual([]);
  });

  /*
   * Misc data is whatever the request body says, so a user's declare
   * cannot ask for owners to be notified: this path adds them quietly, as
   * it always has.
   */
  test("a user's request asking for its owners to be notified still adds them quietly", async () => {
    await onCreateSuccess({
      ownerUsers: [USER_A],
      ownerTeams: [TEAM_A],
      notifyOwners: true,
    });

    expect(createdOwnerUsers[0]!.row.isOwnerNotified).toBe(true);
    expect(createdOwnerTeams[0]!.row.isOwnerNotified).toBe(true);
  });
});

/*
 * An incident form hands its template's owners over with the create, as
 * root, and asks for them to be notified: they are the people a report
 * through the form is meant to reach. They are added in the create's own
 * chain - after the incident's Slack / Microsoft Teams channels exist, so
 * the owners' hooks invite them to those channels, and after "Incident
 * Created" - rather than by the form once the create returned, when the
 * channel usually did not exist yet and nothing invited them later.
 */
describe("the template's owners an incident form hands over", () => {
  const FORM_PROPS: DatabaseCommonInteractionProps = { isRoot: true };

  test("are added and notified", async () => {
    await onCreateSuccess(
      {
        ownerUsers: [USER_A, USER_B],
        ownerTeams: [TEAM_A],
        notifyOwners: true,
      },
      FORM_PROPS,
    );

    expect(
      createdOwnerUsers.map(
        (created: { row: IncidentOwnerUser }): string | undefined => {
          return created.row.userId?.toString();
        },
      ),
    ).toEqual([USER_A, USER_B]);
    expect(createdOwnerTeams).toHaveLength(1);

    for (const created of [...createdOwnerUsers, ...createdOwnerTeams]) {
      expect(created.row.isOwnerNotified).toBe(false);
      expect(created.props).toBe(FORM_PROPS);
    }
  });

  test("without the flag, even a root declare adds them quietly", async () => {
    await onCreateSuccess(
      { ownerUsers: [USER_A], ownerTeams: [TEAM_A] },
      FORM_PROPS,
    );

    expect(createdOwnerUsers[0]!.row.isOwnerNotified).toBe(true);
    expect(createdOwnerTeams[0]!.row.isOwnerNotified).toBe(true);
  });

  test("are added only once the incident's channels exist, and after Incident Created", async () => {
    await onCreateSuccess(
      { ownerUsers: [USER_A], ownerTeams: [TEAM_A], notifyOwners: true },
      FORM_PROPS,
    );

    const service: Record<string, unknown> =
      IncidentService as unknown as Record<string, unknown>;

    const orderOf: (method: unknown) => number = (method: unknown): number => {
      return (method as { mock: { invocationCallOrder: Array<number> } }).mock
        .invocationCallOrder[0]!;
    };

    const firstOwnerAdded: number = Math.min(
      orderOf(IncidentOwnerUserService.create),
      orderOf(IncidentOwnerTeamService.create),
    );

    expect(
      orderOf(service["handleIncidentWorkspaceOperationsAsync"]),
    ).toBeLessThan(firstOwnerAdded);
    expect(orderOf(service["createIncidentFeedAsync"])).toBeLessThan(
      firstOwnerAdded,
    );
  });
});

/*
 * The owners' "Incident Created" notification is sent by a job that runs
 * every minute and takes every incident not yet marked as notified. A form's
 * create is written marked (IncidentService.onBeforeCreate), so the job
 * cannot take its incident while the chain is still getting to the owners -
 * it would find none, and tell the project's owners instead. The chain lets
 * it go - marks it not notified - once the owners exist, and for no other
 * create: one the job may already have notified would be notified twice.
 */
describe("the Incident Created notification a form's create holds for its owners", () => {
  const FORM_PROPS: DatabaseCommonInteractionProps = { isRoot: true };

  const RELEASE: JSONObject = {
    data: { isOwnerNotifiedOfResourceCreation: false },
    props: { isRoot: true, ignoreHooks: true },
  };

  // The updates that let the notification go, with the incident's id as text.
  const releases: () => Array<JSONObject> = (): Array<JSONObject> => {
    return incidentUpdates
      .filter((updateBy: UpdateByID<Incident>): boolean => {
        return (
          (updateBy.data as JSONObject)["isOwnerNotifiedOfResourceCreation"] ===
          false
        );
      })
      .map((updateBy: UpdateByID<Incident>): JSONObject => {
        return {
          id: updateBy.id.toString(),
          data: updateBy.data as JSONObject,
          props: updateBy.props as JSONObject,
        };
      });
  };

  test("is let go once the owners are added, and only then", async () => {
    await onCreateSuccess(
      { ownerUsers: [USER_A], ownerTeams: [TEAM_A], notifyOwners: true },
      FORM_PROPS,
    );

    expect(releases()).toEqual([{ id: INCIDENT_ID.toString(), ...RELEASE }]);

    const orderOf: (method: unknown) => number = (method: unknown): number => {
      return (method as { mock: { invocationCallOrder: Array<number> } }).mock
        .invocationCallOrder[0]!;
    };

    const released: number =
      incidentUpdateMock.mock.invocationCallOrder[
        incidentUpdates.findIndex((updateBy: UpdateByID<Incident>): boolean => {
          return (
            (updateBy.data as JSONObject)[
              "isOwnerNotifiedOfResourceCreation"
            ] === false
          );
        })
      ]!;

    expect(released).toBeGreaterThan(
      Math.max(
        orderOf(IncidentOwnerUserService.create),
        orderOf(IncidentOwnerTeamService.create),
      ),
    );
    // Before the owner rules, which add owners of their own.
    expect(released).toBeLessThan(
      orderOf(IncidentOwnerRuleEngineService.applyRulesToIncident),
    );
  });

  // The chain will not try again, so a held notification must not stay held.
  test("is let go when adding the owners fails", async () => {
    jest
      .spyOn(IncidentService, "addOwners")
      .mockRejectedValue(
        new Error("the owner tables are unreachable") as never,
      );
    jest.spyOn(logger, "error").mockImplementation((() => {
      // expected: the failure is logged
    }) as never);

    await onCreateSuccess(
      { ownerUsers: [USER_A], notifyOwners: true },
      FORM_PROPS,
    );

    expect(releases()).toEqual([{ id: INCIDENT_ID.toString(), ...RELEASE }]);
  });

  test("a release that fails is logged, and the rest of the chain still runs", async () => {
    incidentUpdateMock.mockImplementation((async (): Promise<never> => {
      throw new Error("the incident row is locked");
    }) as never);
    const loggedError: ReturnType<typeof jest.fn> = jest
      .spyOn(logger, "error")
      .mockImplementation((() => {
        // expected: the failure is logged
      }) as never) as unknown as ReturnType<typeof jest.fn>;

    // Waits for the owner rules, after the release: the chain went on.
    await onCreateSuccess(
      { ownerUsers: [USER_A], notifyOwners: true },
      FORM_PROPS,
    );

    expect(
      loggedError.mock.calls.some((call: Array<unknown>): boolean => {
        return String(call[0]).startsWith(
          "Releasing the Incident Created notification held for the owners failed",
        );
      }),
    ).toBe(true);
  });

  test.each([
    [
      "a dashboard declare, even one asking for its owners to be notified",
      { ownerUsers: [USER_A], ownerTeams: [TEAM_A], notifyOwners: true },
      USER_PROPS,
    ],
    [
      "a root declare that adds its owners quietly",
      { ownerUsers: [USER_A], ownerTeams: [TEAM_A] },
      FORM_PROPS,
    ],
    [
      "a root declare asking to notify owners it does not name",
      { notifyOwners: true },
      FORM_PROPS,
    ],
    ["a root declare with other misc data", { alertIdsToLink: [] }, FORM_PROPS],
  ])(
    "is never let go for %s, which held nothing",
    async (
      _label: string,
      miscData: JSONObject,
      props: DatabaseCommonInteractionProps,
    ) => {
      await onCreateSuccess(miscData, props);

      expect(releases()).toEqual([]);
    },
  );

  test("is never let go for a create without misc data", async () => {
    await onCreateSuccess(undefined, FORM_PROPS);

    expect(releases()).toEqual([]);
  });
});
