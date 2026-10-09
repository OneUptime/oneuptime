import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import AlertEpisodeMember from "../../../Models/DatabaseModels/AlertEpisodeMember";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeMember from "../../../Models/DatabaseModels/IncidentEpisodeMember";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import AlertEpisodeMemberService from "../../../Server/Services/AlertEpisodeMemberService";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertService from "../../../Server/Services/AlertService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentEpisodeMemberService from "../../../Server/Services/IncidentEpisodeMemberService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentGroupingEngineService from "../../../Server/Services/IncidentGroupingEngineService";
import IncidentService from "../../../Server/Services/IncidentService";
import UserService from "../../../Server/Services/UserService";
import ProjectService from "../../../Server/Services/ProjectService";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import {
  RunOptions,
  RunReturnType,
} from "../../../Server/Types/Workflow/ComponentCode";
import CreateOneBaseModel from "../../../Server/Types/Workflow/Components/BaseModel/CreateOneBaseModel";
import UpdateOneBaseModel from "../../../Server/Types/Workflow/Components/BaseModel/UpdateOneBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Email from "../../../Types/Email";
import Exception from "../../../Types/Exception/Exception";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import UserType from "../../../Types/UserType";
import logger from "../../../Server/Utils/Logger";
import { getJestSpyOn } from "../../Spy";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The paths that write who did something to a record, through the real
 * services: a workflow cannot name anybody, and OneUptime's own server code
 * - which acts for a person it names in code - still records that person.
 * Each write stops at its first hook, after DatabaseService has decided who
 * the record is by (UserAttribution), so nothing reaches the database.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-bbbb-4aaa-8bbb-000000000001",
);
const PERSON_ID: ObjectID = new ObjectID(
  "0193c0de-bbbb-4aaa-8bbb-0000000000e1",
);
const OTHER_USER_ID: string = "0193c0de-bbbb-4aaa-8bbb-0000000000f2";
const RECORD_ID: string = "0193c0de-bbbb-4aaa-8bbb-0000000000a1";

class AtTheHooks extends Error {}

/*
 * Stops the service's writes at their first hook and records what they
 * carried there.
 */
function stopAtTheHooks(service: unknown): () => Record<string, unknown> {
  let reached: Record<string, unknown> = {};

  getJestSpyOn(service, "_onBeforeCreate").mockImplementation(
    async (createBy: { data: unknown }): Promise<never> => {
      reached = { ...(createBy.data as Record<string, unknown>) };
      throw new AtTheHooks();
    },
  );
  getJestSpyOn(service, "onBeforeUpdate").mockImplementation(
    async (updateBy: { data: unknown }): Promise<never> => {
      reached = { ...(updateBy.data as Record<string, unknown>) };
      throw new AtTheHooks();
    },
  );

  return (): Record<string, unknown> => {
    return reached;
  };
}

function runOptions(): RunOptions {
  return {
    log: (): void => {},
    workflowLogId: ObjectID.generate(),
    workflowId: ObjectID.generate(),
    projectId: PROJECT_ID,
    onError: (exception: Exception): Exception => {
      return exception;
    },
    executeWorkflow: async (): Promise<void> => {},
  };
}

beforeEach(() => {
  stubProjectDirectory({});
  // The project's plan, which a step's props carry on a server with billing.
  jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
    plan: PlanType.Enterprise,
    isSubscriptionUnpaid: false,
  });
  // A workflow component logs the stop at the hooks as its error.
  getJestSpyOn(logger, "error").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a workflow cannot name who did something to a record", () => {
  test("Create One: a creator the workflow sends, under either name, never reaches the record", async () => {
    const service: DatabaseService<Monitor> = new DatabaseService<Monitor>(
      Monitor,
    );
    const reached: () => Record<string, unknown> = stopAtTheHooks(service);

    const result: RunReturnType = await new CreateOneBaseModel<Monitor>(
      service,
    ).run(
      {
        json: {
          name: "Checkout API",
          createdByUserId: OTHER_USER_ID,
          createdByUser: { _id: OTHER_USER_ID },
          archivedByUserId: OTHER_USER_ID,
        },
      },
      runOptions(),
    );

    // The write stopped at the hooks, so the component took its error port.
    expect(result.executePort?.id).toBe("error");
    expect(reached()["name"]).toBe("Checkout API");
    expect(reached()["createdByUserId"]).toBeUndefined();
    expect(reached()["createdByUser"]).toBeUndefined();
    expect(reached()["archivedByUserId"]).toBeUndefined();
  });

  test("Update One: a creator the workflow sends never changes the record", async () => {
    const service: DatabaseService<Monitor> = new DatabaseService<Monitor>(
      Monitor,
    );
    const reached: () => Record<string, unknown> = stopAtTheHooks(service);

    /*
     * The step updates as a Project Admin of its project, so the rows it may
     * write are read before the hooks run: here, the one it names.
     */
    const record: Monitor = new Monitor();
    record._id = RECORD_ID;
    getJestSpyOn(service, "_findBy").mockResolvedValue([record]);

    await new UpdateOneBaseModel<Monitor>(service).run(
      {
        query: { _id: RECORD_ID },
        data: {
          description: "Owned by payments",
          createdByUserId: OTHER_USER_ID,
          createdByUser: { _id: OTHER_USER_ID },
        },
      },
      runOptions(),
    );

    expect(reached()["description"]).toBe("Owned by payments");
    expect(reached()["createdByUserId"]).toBeUndefined();
    expect(reached()["createdByUser"]).toBeUndefined();
  });
});

/*
 * (A note posted from Slack or Microsoft Teams is the member's own write, made
 * with their props: the *PublicNoteNotifyDefault suites save one through the
 * whole create and find it by them.)
 */
describe("OneUptime's own server code records the person it acts for", () => {
  test("an account made by an invitation is by the person who invited", async () => {
    const reached: () => Record<string, unknown> = stopAtTheHooks(UserService);

    await expect(
      UserService.createByEmail({
        email: new Email("new.member@example.com"),
        name: new Name("New Member"),
        createdByUserId: PERSON_ID,
        props: { isRoot: true },
      }),
    ).rejects.toBeInstanceOf(AtTheHooks);

    expect(String(reached()["createdByUserId"])).toBe(PERSON_ID.toString());
  });

  test("an incident added to an episode by hand is added by that person", async () => {
    const reached: () => Record<string, unknown> = stopAtTheHooks(
      IncidentEpisodeMemberService,
    );

    const incident: Incident = new Incident();
    incident._id = RECORD_ID;
    incident.projectId = PROJECT_ID;

    await expect(
      IncidentGroupingEngineService.addIncidentToEpisodeManually(
        incident,
        ObjectID.generate(),
        PERSON_ID,
      ),
    ).rejects.toBeInstanceOf(AtTheHooks);

    expect(String(reached()["addedByUserId"])).toBe(PERSON_ID.toString());
  });
});

/*
 * Who added an incident or an alert to an episode is about the request
 * itself, so the services stamp it in their create hooks, after
 * DatabaseService has taken out whoever the request named.
 */
describe("an incident or alert added to an episode is added by the person making the request", () => {
  const EPISODE_ID: string = "0193c0de-bbbb-4aaa-8bbb-0000000000c3";

  const OWNER: DatabaseCommonInteractionProps["userTenantAccessPermission"] = {
    [PROJECT_ID.toString()]: {
      projectId: PROJECT_ID,
      permissions: [
        {
          permission: Permission.ProjectOwner,
          labelIds: [],
          isBlockPermission: false,
          _type: "UserPermission",
        },
      ],
      _type: "UserTenantAccessPermission",
    },
  };

  // Someone signed in who owns the project.
  const PERSON_PROPS: DatabaseCommonInteractionProps = {
    tenantId: PROJECT_ID,
    userId: PERSON_ID,
    userGlobalAccessPermission: {
      projectIds: [PROJECT_ID],
      globalPermissions: [Permission.Public, Permission.User],
      _type: "UserGlobalAccessPermission",
    },
    userTenantAccessPermission: OWNER,
  };

  // An API key with every project permission: no person on the request.
  const API_KEY_PROPS: DatabaseCommonInteractionProps = {
    tenantId: PROJECT_ID,
    userType: UserType.API,
    userTenantAccessPermission: OWNER,
  };

  interface EpisodeMemberCase {
    label: string;
    service: DatabaseService<DatabaseBaseModel>;
    member: () => DatabaseBaseModel;
    // The episode and the record, as the caller reads them before adding.
    stubEnds: () => void;
  }

  const CASES: Array<EpisodeMemberCase> = [
    {
      label: "an incident",
      service:
        IncidentEpisodeMemberService as unknown as DatabaseService<DatabaseBaseModel>,
      member: (): DatabaseBaseModel => {
        const member: IncidentEpisodeMember = new IncidentEpisodeMember();
        member.projectId = PROJECT_ID;
        member.incidentEpisodeId = new ObjectID(EPISODE_ID);
        member.incidentId = new ObjectID(RECORD_ID);
        return member;
      },
      stubEnds: (): void => {
        const episode: IncidentEpisode = new IncidentEpisode();
        episode.projectId = PROJECT_ID;
        getJestSpyOn(IncidentEpisodeService, "findOneById").mockResolvedValue(
          episode,
        );
        const incident: Incident = new Incident();
        incident.projectId = PROJECT_ID;
        getJestSpyOn(IncidentService, "findOneById").mockResolvedValue(
          incident,
        );
      },
    },
    {
      label: "an alert",
      service:
        AlertEpisodeMemberService as unknown as DatabaseService<DatabaseBaseModel>,
      member: (): DatabaseBaseModel => {
        const member: AlertEpisodeMember = new AlertEpisodeMember();
        member.projectId = PROJECT_ID;
        member.alertEpisodeId = new ObjectID(EPISODE_ID);
        member.alertId = new ObjectID(RECORD_ID);
        return member;
      },
      stubEnds: (): void => {
        const episode: AlertEpisode = new AlertEpisode();
        episode.projectId = PROJECT_ID;
        getJestSpyOn(AlertEpisodeService, "findOneById").mockResolvedValue(
          episode,
        );
        const alert: Alert = new Alert();
        alert.projectId = PROJECT_ID;
        getJestSpyOn(AlertService, "findOneById").mockResolvedValue(alert);
      },
    },
  ];

  // Whoever else the request says added it, under both names.
  function namingSomeoneElse(member: DatabaseBaseModel): DatabaseBaseModel {
    Object.assign(member, {
      addedByUserId: new ObjectID(OTHER_USER_ID),
      addedByUser: { _id: OTHER_USER_ID },
    });

    return member;
  }

  /*
   * The create through the service's real write path - the permission check
   * and the hooks included - stopped right after the hooks.
   */
  async function pastTheHooks(
    entry: EpisodeMemberCase,
    props: DatabaseCommonInteractionProps,
  ): Promise<Record<string, unknown>> {
    // Not a member yet, in an episode that has others: the hook goes on.
    getJestSpyOn(entry.service, "findOneBy").mockResolvedValue(null);
    // Both the caller's to see: they own the project.
    entry.stubEnds();
    getJestSpyOn(entry.service, "countBy").mockResolvedValue(
      new PositiveNumber(1),
    );

    let reached: Record<string, unknown> = {};

    getJestSpyOn(entry.service, "generateSlug").mockImplementation(
      (createBy: { data: unknown }): never => {
        reached = { ...(createBy.data as Record<string, unknown>) };
        throw new AtTheHooks();
      },
    );

    await expect(
      entry.service.create({
        data: namingSomeoneElse(entry.member()),
        props: props,
      }),
    ).rejects.toBeInstanceOf(AtTheHooks);

    return reached;
  }

  test.each(CASES)(
    "$label: by the person, whoever the request names",
    async (entry: EpisodeMemberCase) => {
      const reached: Record<string, unknown> = await pastTheHooks(
        entry,
        PERSON_PROPS,
      );

      expect(String(reached["addedByUserId"])).toBe(PERSON_ID.toString());
      expect(reached["addedByUser"]).toBeUndefined();
    },
  );

  test.each(CASES)(
    "$label: with no person on the request, by nobody",
    async (entry: EpisodeMemberCase) => {
      const reached: Record<string, unknown> = await pastTheHooks(
        entry,
        API_KEY_PROPS,
      );

      expect(reached["addedByUserId"]).toBeUndefined();
      expect(reached["addedByUser"]).toBeUndefined();
    },
  );
});
