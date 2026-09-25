import AlertFeedService from "../../../Server/Services/AlertFeedService";
import AlertOwnerTeamService from "../../../Server/Services/AlertOwnerTeamService";
import AlertOwnerUserService from "../../../Server/Services/AlertOwnerUserService";
import AlertService from "../../../Server/Services/AlertService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentAlertService, {
  INCIDENT_ALERT_DECLARED_WITH_INCIDENT_KEY,
  LinkAlertsToIncidentResult,
  LinkedAlertMention,
  getDeclaredFromAlertsMarkdown,
} from "../../../Server/Services/IncidentAlertService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentService from "../../../Server/Services/IncidentService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import FindBy from "../../../Server/Types/Database/FindBy";
import {
  OnCreate,
  OnDelete,
  OnFind,
  OnUpdate,
} from "../../../Server/Types/Database/Hooks";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import Query from "../../../Server/Types/Database/Query";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import PostgresErrorTranslator from "../../../Server/Utils/Database/PostgresErrorTranslator";
import ProjectScopedReferenceValidator from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import logger from "../../../Server/Utils/Logger";
import Alert from "../../../Models/DatabaseModels/Alert";
import { AlertFeedEventType } from "../../../Models/DatabaseModels/AlertFeed";
import AlertOwnerTeam from "../../../Models/DatabaseModels/AlertOwnerTeam";
import AlertOwnerUser from "../../../Models/DatabaseModels/AlertOwnerUser";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentAlert from "../../../Models/DatabaseModels/IncidentAlert";
import { IncidentFeedEventType } from "../../../Models/DatabaseModels/IncidentFeed";
import User from "../../../Models/DatabaseModels/User";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { Gray500, Yellow500 } from "../../../Types/BrandColors";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import {
  INCIDENT_ALERT_ALREADY_LINKED_MESSAGE,
  MAX_ALERTS_PER_INCIDENT_LINK_ACTION,
} from "../../../Types/Incident/IncidentAlertLink";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import UserType from "../../../Types/UserType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * IncidentAlertService owns the alert <-> incident link. Every refusal and
 * side effect it is responsible for is pinned here against stubbed
 * neighbours: what a link must reference, who may create it, what it writes
 * to both feeds, which deleted rows it reports, how its reads are narrowed to
 * what the caller can see, and the helpers behind "declare incident from
 * alerts". The state cascade has its own file (IncidentAlertStateCascade).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0194a1e7-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "0194a1e7-0000-4000-8000-000000000002",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "0194a1e7-0000-4000-8000-0000000000a1",
);
const OTHER_INCIDENT_ID: ObjectID = new ObjectID(
  "0194a1e7-0000-4000-8000-0000000000a2",
);
const ALERT_ID: ObjectID = new ObjectID("0194a1e7-0000-4000-8000-0000000000b1");
const ALERT_ID_2: ObjectID = new ObjectID(
  "0194a1e7-0000-4000-8000-0000000000b2",
);
const ALERT_ID_3: ObjectID = new ObjectID(
  "0194a1e7-0000-4000-8000-0000000000b3",
);
const USER_ID: ObjectID = new ObjectID("0194a1e7-0000-4000-8000-0000000000c1");
const OTHER_USER_ID: ObjectID = new ObjectID(
  "0194a1e7-0000-4000-8000-0000000000c2",
);

const INCIDENT_URL: string = "https://oneuptime.example/dashboard/incident";
const ALERT_URL: string = "https://oneuptime.example/dashboard/alert";

type HookFunction = (...args: Array<unknown>) => Promise<unknown>;

function callHook<T>(name: string, ...args: Array<unknown>): Promise<T> {
  const hooks: Record<string, HookFunction> =
    IncidentAlertService as unknown as Record<string, HookFunction>;
  return hooks[name]!.apply(IncidentAlertService, args) as Promise<T>;
}

// Pass null for an API key, which acts for no user.
function userProps(
  permission: Permission,
  userId: ObjectID | null = USER_ID,
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    projectId: PROJECT_ID,
    _type: "UserTenantAccessPermission",
    permissions: [
      {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      },
    ],
  };

  return {
    tenantId: PROJECT_ID,
    userId: userId || undefined,
    userType: userId ? UserType.User : UserType.API,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: tenantPermission,
    },
  };
}

function buildLink(data: Partial<IncidentAlert> = {}): IncidentAlert {
  const link: IncidentAlert = new IncidentAlert();
  link.projectId = PROJECT_ID;
  link.incidentId = INCIDENT_ID;
  link.alertId = ALERT_ID;
  Object.assign(link, data);
  return link;
}

function buildIncident(projectId: ObjectID = PROJECT_ID): Incident {
  const incident: Incident = new Incident();
  incident._id = INCIDENT_ID.toString();
  incident.projectId = projectId;
  return incident;
}

function buildAlert(projectId: ObjectID = PROJECT_ID): Alert {
  const alert: Alert = new Alert();
  alert._id = ALERT_ID.toString();
  alert.projectId = projectId;
  return alert;
}

function alertRow(id: ObjectID): Alert {
  const alert: Alert = new Alert();
  alert._id = id.toString();
  return alert;
}

// The SQL of every Raw clause inside a (possibly And-combined) operator.
function operatorSql(value: unknown): Array<string> {
  if (!(value instanceof FindOperator)) {
    return [];
  }

  if (value.type === "and") {
    return (value.value as unknown as Array<unknown>).flatMap(operatorSql);
  }

  const getSql: ((alias: string) => string) | undefined = value.getSql as
    | ((alias: string) => string)
    | undefined;

  return getSql ? [getSql("COLUMN")] : [value.type];
}

let validator: jest.SpyInstance;

beforeEach(() => {
  validator = jest
    .spyOn(ProjectScopedReferenceValidator, "validateReferencesBelongToProject")
    .mockResolvedValue(undefined as never);
  jest.spyOn(logger, "error").mockImplementation((() => {
    // quiet
  }) as never);
  jest.spyOn(logger, "debug").mockImplementation((() => {
    // quiet
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("onBeforeCreate: what a link must reference", () => {
  function create(
    data: Partial<IncidentAlert>,
    props: DatabaseCommonInteractionProps = { isRoot: true },
  ): Promise<OnCreate<IncidentAlert>> {
    const link: IncidentAlert = new IncidentAlert();
    Object.assign(link, data);
    return callHook<OnCreate<IncidentAlert>>("onBeforeCreate", {
      data: link,
      props: props,
    } as CreateBy<IncidentAlert>);
  }

  test("refuses a link with no incident", async () => {
    await expect(
      create({ projectId: PROJECT_ID, alertId: ALERT_ID }),
    ).rejects.toThrow("Please select the incident to link the alert to.");
    expect(validator).not.toHaveBeenCalled();
  });

  test("refuses a link with no alert", async () => {
    await expect(
      create({ projectId: PROJECT_ID, incidentId: INCIDENT_ID }),
    ).rejects.toThrow("Please select the alert to link.");
  });

  test("refuses a root link with no project to check the ends against", async () => {
    await expect(
      create({ incidentId: INCIDENT_ID, alertId: ALERT_ID }),
    ).rejects.toThrow("projectId is required");
    expect(validator).not.toHaveBeenCalled();
  });

  test("refuses an incident id and incident relation that disagree", async () => {
    await expect(
      create({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
        incident: { _id: OTHER_INCIDENT_ID.toString() } as Incident,
        alertId: ALERT_ID,
      }),
    ).rejects.toThrow("Conflicting incident references were provided.");
    expect(validator).not.toHaveBeenCalled();
  });

  test("refuses an alert id and alert relation that disagree", async () => {
    await expect(
      create({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
        alertId: ALERT_ID,
        alert: { _id: ALERT_ID_2.toString() } as Alert,
      }),
    ).rejects.toThrow("Conflicting alert references were provided.");
  });

  test("accepts the relation spelling the dashboard posts and normalises it onto the id columns", async () => {
    const result: OnCreate<IncidentAlert> = await create({
      projectId: PROJECT_ID,
      incident: { _id: INCIDENT_ID.toString() } as Incident,
      alert: { _id: ALERT_ID.toString() } as Alert,
    });

    expect(result.createBy.data.incidentId?.toString()).toBe(
      INCIDENT_ID.toString(),
    );
    expect(result.createBy.data.alertId?.toString()).toBe(ALERT_ID.toString());
    expect(result.carryForward).toBeNull();
  });

  test("a root link is checked against its project for both ends", async () => {
    await create({
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
      alertId: ALERT_ID,
    });

    expect(validator).toHaveBeenCalledTimes(1);

    const args: {
      projectId: ObjectID;
      references: Array<{ modelName: string; id: ObjectID; service: unknown }>;
    } = validator.mock.calls[0]![0];

    expect(args.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(
      args.references.map(
        (reference: { modelName: string; id: ObjectID; service: unknown }) => {
          return [reference.modelName, reference.id.toString()];
        },
      ),
    ).toEqual([
      ["Incident", INCIDENT_ID.toString()],
      ["Alert", ALERT_ID.toString()],
    ]);
    expect(args.references[0]!.service).toBe(IncidentService);
    expect(args.references[1]!.service).toBe(AlertService);
  });

  test("a root link to another project's record is refused by the project check", async () => {
    validator.mockRejectedValue(
      new BadDataException(
        "This incident alert link references records that belong to a different project",
      ) as never,
    );

    await expect(
      create({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
        alertId: ALERT_ID,
      }),
    ).rejects.toThrow("belong to a different project");
  });

  test("a root link does not read the ends as a user", async () => {
    const incidentRead: jest.SpyInstance = jest.spyOn(
      IncidentService,
      "findOneById",
    );
    const alertRead: jest.SpyInstance = jest.spyOn(AlertService, "findOneById");

    await create({
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
      alertId: ALERT_ID,
      createdByUserId: OTHER_USER_ID,
    });

    expect(incidentRead).not.toHaveBeenCalled();
    expect(alertRead).not.toHaveBeenCalled();
  });

  test("a root caller may name who linked the alert", async () => {
    const result: OnCreate<IncidentAlert> = await create({
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
      alertId: ALERT_ID,
      createdByUserId: OTHER_USER_ID,
    });

    expect(result.createBy.data.createdByUserId?.toString()).toBe(
      OTHER_USER_ID.toString(),
    );
  });
});

describe("onBeforeCreate: a user may only link what they can see", () => {
  let incidentRead: jest.SpyInstance;
  let alertRead: jest.SpyInstance;

  beforeEach(() => {
    incidentRead = jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(buildIncident() as never);
    alertRead = jest
      .spyOn(AlertService, "findOneById")
      .mockResolvedValue(buildAlert() as never);
  });

  function create(
    props: DatabaseCommonInteractionProps = userProps(Permission.ProjectMember),
    data: Partial<IncidentAlert> = {},
  ): Promise<OnCreate<IncidentAlert>> {
    return callHook<OnCreate<IncidentAlert>>("onBeforeCreate", {
      data: buildLink(data),
      props: props,
    } as CreateBy<IncidentAlert>);
  }

  test("reads both ends with the caller's own props", async () => {
    const props: DatabaseCommonInteractionProps = userProps(
      Permission.ProjectMember,
    );

    await create(props);

    expect(incidentRead).toHaveBeenCalledWith(
      expect.objectContaining({ id: INCIDENT_ID, props: props }),
    );
    expect(alertRead).toHaveBeenCalledWith(
      expect.objectContaining({ id: ALERT_ID, props: props }),
    );
    expect(validator).toHaveBeenCalledTimes(1);
  });

  test("the project is the caller's tenant, whatever the payload says", async () => {
    const result: OnCreate<IncidentAlert> = await create(
      userProps(Permission.ProjectMember),
      { projectId: OTHER_PROJECT_ID },
    );

    expect(result.createBy.data.projectId?.toString()).toBe(
      PROJECT_ID.toString(),
    );
  });

  test("an incident the caller cannot see is refused without saying why", async () => {
    incidentRead.mockResolvedValue(null as never);

    await expect(create()).rejects.toThrow(
      "The incident to link does not exist in this project, or you do not have access to it.",
    );
    expect(validator).not.toHaveBeenCalled();
  });

  test("an incident read the permission layer refuses gets the same answer", async () => {
    incidentRead.mockRejectedValue(
      new NotAuthorizedException(
        "You do not have permission to read Incident",
      ) as never,
    );

    await expect(create()).rejects.toThrow(
      "The incident to link does not exist in this project, or you do not have access to it.",
    );
  });

  test("an incident of another project is refused", async () => {
    incidentRead.mockResolvedValue(buildIncident(OTHER_PROJECT_ID) as never);

    await expect(create()).rejects.toThrow(
      "The incident to link does not exist in this project",
    );
  });

  test("an alert the caller cannot see is refused without saying why", async () => {
    alertRead.mockResolvedValue(null as never);

    await expect(create()).rejects.toThrow(
      "The alert to link does not exist in this project, or you do not have access to it.",
    );
    expect(validator).not.toHaveBeenCalled();
  });

  test("an alert read the permission layer refuses gets the same answer", async () => {
    alertRead.mockRejectedValue(
      new NotAuthorizedException(
        "You do not have permission to read Alert",
      ) as never,
    );

    await expect(create()).rejects.toThrow(
      "The alert to link does not exist in this project, or you do not have access to it.",
    );
  });

  test("an alert of another project is refused", async () => {
    alertRead.mockResolvedValue(buildAlert(OTHER_PROJECT_ID) as never);

    await expect(create()).rejects.toThrow(
      "The alert to link does not exist in this project",
    );
  });

  test("a failure that is not about access is passed on unchanged", async () => {
    alertRead.mockRejectedValue(new Error("connection reset") as never);

    await expect(create()).rejects.toThrow("connection reset");
  });

  test("the user who made the request is recorded as the one who linked it", async () => {
    const result: OnCreate<IncidentAlert> = await create(
      userProps(Permission.ProjectMember),
      {
        createdByUserId: OTHER_USER_ID,
        createdByUser: { _id: OTHER_USER_ID.toString() } as User,
      },
    );

    expect(result.createBy.data.createdByUserId?.toString()).toBe(
      USER_ID.toString(),
    );
    expect(result.createBy.data.createdByUser).toBeUndefined();
  });

  test("an API key cannot name somebody else as the one who linked it", async () => {
    const result: OnCreate<IncidentAlert> = await create(
      userProps(Permission.ProjectMember, null),
      { createdByUserId: OTHER_USER_ID },
    );

    expect(result.createBy.data.createdByUserId).toBeUndefined();
  });

  test.each([
    Permission.ProjectMember,
    Permission.IncidentMember,
    Permission.AlertMember,
    Permission.ProjectAdmin,
  ])(
    "what the hook returns passes the create permission check for %s",
    async (permission: Permission) => {
      const props: DatabaseCommonInteractionProps = userProps(permission);
      const result: OnCreate<IncidentAlert> = await create(props);

      expect(() => {
        ModelPermission.checkCreatePermissions(
          IncidentAlert,
          result.createBy.data,
          result.createBy.props,
        );
      }).not.toThrow();
    },
  );
});

describe("feed entries", () => {
  let incidentFeed: jest.SpyInstance;
  let alertFeed: jest.SpyInstance;
  let sync: jest.SpyInstance;

  beforeEach(() => {
    const incident: Incident = new Incident();
    incident.incidentNumber = 7;
    incident.incidentNumberWithPrefix = "INC-7";
    incident.title = "Checkout is down";

    const alert: Alert = new Alert();
    alert.alertNumber = 3;
    alert.title = "Checkout p95 latency is high";

    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(incident as never);
    jest.spyOn(AlertService, "findOneById").mockResolvedValue(alert as never);
    jest
      .spyOn(IncidentService, "getIncidentLinkInDashboard")
      .mockResolvedValue(URL.fromString(INCIDENT_URL) as never);
    jest
      .spyOn(AlertService, "getAlertLinkInDashboard")
      .mockResolvedValue(URL.fromString(ALERT_URL) as never);

    incidentFeed = jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockResolvedValue(undefined as never);
    alertFeed = jest
      .spyOn(AlertFeedService, "createAlertFeedItem")
      .mockResolvedValue(undefined as never);
    sync = jest
      .spyOn(IncidentAlertService, "syncAlertWithLinkedIncidentState")
      .mockResolvedValue(undefined as never);
  });

  function created(data: Partial<IncidentAlert> = {}): IncidentAlert {
    const link: IncidentAlert = buildLink(data);
    link._id = ObjectID.generate().toString();
    return link;
  }

  describe("on link", () => {
    test("the incident gets an Alert Linked entry that is posted to its channels", async () => {
      const link: IncidentAlert = created({ createdByUserId: USER_ID });

      await IncidentAlertService.onCreateSuccess(
        {
          createBy: { data: link, props: { isRoot: true } },
          carryForward: null,
        },
        link,
      );

      expect(incidentFeed).toHaveBeenCalledTimes(1);

      const entry: Record<string, unknown> = incidentFeed.mock.calls[0]![0];

      expect(entry["incidentId"]).toBe(INCIDENT_ID);
      expect(entry["projectId"]).toBe(PROJECT_ID);
      expect(entry["incidentFeedEventType"]).toBe(
        IncidentFeedEventType.AlertLinked,
      );
      expect(entry["displayColor"]).toBe(Yellow500);
      expect(entry["userId"]).toBe(USER_ID);
      expect(entry["workspaceNotification"]).toEqual({
        sendWorkspaceNotification: true,
        notifyUserId: USER_ID,
      });
      expect(entry["feedInfoInMarkdown"]).toBe(
        `🔗 Linked **[Alert #3](${ALERT_URL})** to **[Incident INC-7](${INCIDENT_URL})**: Checkout p95 latency is high`,
      );
    });

    test("the alert gets a Linked to Incident entry that is not posted to any channel", async () => {
      const link: IncidentAlert = created({ createdByUserId: USER_ID });

      await IncidentAlertService.onCreateSuccess(
        {
          createBy: { data: link, props: { isRoot: true } },
          carryForward: null,
        },
        link,
      );

      expect(alertFeed).toHaveBeenCalledTimes(1);

      const entry: Record<string, unknown> = alertFeed.mock.calls[0]![0];

      expect(entry["alertId"]).toBe(ALERT_ID);
      expect(entry["projectId"]).toBe(PROJECT_ID);
      expect(entry["alertFeedEventType"]).toBe(
        AlertFeedEventType.LinkedToIncident,
      );
      expect(entry["displayColor"]).toBe(Yellow500);
      expect(entry["userId"]).toBe(USER_ID);
      expect(entry["workspaceNotification"]).toBeUndefined();
      expect(entry["feedInfoInMarkdown"]).toBe(
        `🔗 Linked to **[Incident INC-7](${INCIDENT_URL})**: Checkout is down`,
      );
    });

    test("the actor falls back to the requesting user when no linker was stored", async () => {
      const link: IncidentAlert = created();

      await IncidentAlertService.onCreateSuccess(
        {
          createBy: { data: link, props: { userId: OTHER_USER_ID } },
          carryForward: null,
        },
        link,
      );

      expect(incidentFeed.mock.calls[0]![0]["userId"]).toBe(OTHER_USER_ID);
      expect(alertFeed.mock.calls[0]![0]["userId"]).toBe(OTHER_USER_ID);
    });

    test("the linked alert is brought in line with the incident's state", async () => {
      const link: IncidentAlert = created();

      await IncidentAlertService.onCreateSuccess(
        {
          createBy: { data: link, props: { isRoot: true } },
          carryForward: null,
        },
        link,
      );

      expect(sync).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
        alertId: ALERT_ID,
      });
    });

    test("a failing state sync never fails the link", async () => {
      sync.mockRejectedValue(new Error("sync failed") as never);
      const link: IncidentAlert = created();

      await expect(
        IncidentAlertService.onCreateSuccess(
          {
            createBy: { data: link, props: { isRoot: true } },
            carryForward: null,
          },
          link,
        ),
      ).resolves.toBe(link);

      // Let the fire-and-forget rejection settle into its catch.
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });

      expect(logger.error).toHaveBeenCalled();
    });

    test("a failing feed write never fails the link", async () => {
      jest
        .spyOn(IncidentService, "getIncidentLinkInDashboard")
        .mockRejectedValue(new Error("no dashboard url") as never);
      const link: IncidentAlert = created();

      await expect(
        IncidentAlertService.onCreateSuccess(
          {
            createBy: { data: link, props: { isRoot: true } },
            carryForward: null,
          },
          link,
        ),
      ).resolves.toBe(link);
      expect(logger.error).toHaveBeenCalled();
      expect(sync).toHaveBeenCalledTimes(1);
    });

    test("a number with no prefix is shown as #<number>, and a missing title says so", async () => {
      const incident: Incident = new Incident();
      incident.incidentNumber = 12;

      jest
        .spyOn(IncidentService, "findOneById")
        .mockResolvedValue(incident as never);

      const link: IncidentAlert = created();

      await IncidentAlertService.onCreateSuccess(
        {
          createBy: { data: link, props: { isRoot: true } },
          carryForward: null,
        },
        link,
      );

      expect(alertFeed.mock.calls[0]![0]["feedInfoInMarkdown"]).toBe(
        `🔗 Linked to **[Incident #12](${INCIDENT_URL})**: No title`,
      );
    });
  });

  describe("on unlink", () => {
    function carried(
      id: ObjectID,
      alertId: ObjectID,
    ): {
      id: string;
      incidentId: ObjectID;
      alertId: ObjectID;
      projectId: ObjectID;
    } {
      return {
        id: id.toString(),
        incidentId: INCIDENT_ID,
        alertId: alertId,
        projectId: PROJECT_ID,
      };
    }

    test("reports only the links that were actually deleted", async () => {
      const deletedLinkId: ObjectID = ObjectID.generate();
      const survivingLinkId: ObjectID = ObjectID.generate();

      await IncidentAlertService.onDeleteSuccess(
        {
          deleteBy: {
            query: {},
            props: { userId: USER_ID },
            limit: 1,
            skip: 0,
          } as DeleteBy<IncidentAlert>,
          carryForward: [
            carried(deletedLinkId, ALERT_ID),
            carried(survivingLinkId, ALERT_ID_2),
          ],
        },
        [new ObjectID(deletedLinkId.toString().toUpperCase())],
      );

      expect(incidentFeed).toHaveBeenCalledTimes(1);
      expect(alertFeed).toHaveBeenCalledTimes(1);
      expect(alertFeed.mock.calls[0]![0]["alertId"]).toBe(ALERT_ID);
    });

    test("an unlink writes Alert Unlinked (posted) and Unlinked from Incident (not posted)", async () => {
      const linkId: ObjectID = ObjectID.generate();

      await IncidentAlertService.onDeleteSuccess(
        {
          deleteBy: {
            query: {},
            props: { userId: USER_ID },
            limit: 1,
            skip: 0,
          } as DeleteBy<IncidentAlert>,
          carryForward: [carried(linkId, ALERT_ID)],
        },
        [linkId],
      );

      const incidentEntry: Record<string, unknown> =
        incidentFeed.mock.calls[0]![0];
      const alertEntry: Record<string, unknown> = alertFeed.mock.calls[0]![0];

      expect(incidentEntry["incidentFeedEventType"]).toBe(
        IncidentFeedEventType.AlertUnlinked,
      );
      expect(incidentEntry["displayColor"]).toBe(Gray500);
      expect(incidentEntry["userId"]).toBe(USER_ID);
      expect(incidentEntry["workspaceNotification"]).toEqual({
        sendWorkspaceNotification: true,
        notifyUserId: USER_ID,
      });
      expect(incidentEntry["feedInfoInMarkdown"]).toBe(
        `Unlinked **[Alert #3](${ALERT_URL})** from **[Incident INC-7](${INCIDENT_URL})**: Checkout p95 latency is high`,
      );

      expect(alertEntry["alertFeedEventType"]).toBe(
        AlertFeedEventType.UnlinkedFromIncident,
      );
      expect(alertEntry["displayColor"]).toBe(Gray500);
      expect(alertEntry["workspaceNotification"]).toBeUndefined();
      expect(alertEntry["feedInfoInMarkdown"]).toBe(
        `Unlinked from **[Incident INC-7](${INCIDENT_URL})**: Checkout is down`,
      );
    });

    test("the actor is the user named as the deleter, else the requesting user", async () => {
      const linkId: ObjectID = ObjectID.generate();
      const deleter: User = new User();
      deleter._id = OTHER_USER_ID.toString();

      await IncidentAlertService.onDeleteSuccess(
        {
          deleteBy: {
            query: {},
            deletedByUser: deleter,
            props: { userId: USER_ID },
            limit: 1,
            skip: 0,
          } as DeleteBy<IncidentAlert>,
          carryForward: [carried(linkId, ALERT_ID)],
        },
        [linkId],
      );

      expect(
        (incidentFeed.mock.calls[0]![0]["userId"] as ObjectID).toString(),
      ).toBe(OTHER_USER_ID.toString());
    });

    test("nothing is reported when nothing was deleted", async () => {
      await IncidentAlertService.onDeleteSuccess(
        {
          deleteBy: {
            query: {},
            props: { isRoot: true },
            limit: 1,
            skip: 0,
          } as DeleteBy<IncidentAlert>,
          carryForward: [carried(ObjectID.generate(), ALERT_ID)],
        },
        [],
      );

      expect(incidentFeed).not.toHaveBeenCalled();
      expect(alertFeed).not.toHaveBeenCalled();
    });

    test("a carry-forward that is not a list reports nothing", async () => {
      await IncidentAlertService.onDeleteSuccess(
        {
          deleteBy: {
            query: {},
            props: { isRoot: true },
            limit: 1,
            skip: 0,
          } as DeleteBy<IncidentAlert>,
          carryForward: null,
        },
        [ObjectID.generate()],
      );

      expect(incidentFeed).not.toHaveBeenCalled();
    });
  });

  describe("a private end's title never reaches the other side's entry", () => {
    const INCIDENT_TITLE: string = "Payroll export is failing";
    const ALERT_TITLE: string = "Payroll DB credentials exposed";

    let incidentRead: jest.SpyInstance;
    let alertRead: jest.SpyInstance;

    function stubEnds(ends: {
      incidentIsPrivate: boolean;
      alertIsPrivate: boolean;
    }): void {
      const incident: Incident = new Incident();
      incident.incidentNumber = 7;
      incident.incidentNumberWithPrefix = "INC-7";
      incident.title = INCIDENT_TITLE;
      incident.isPrivate = ends.incidentIsPrivate;

      const alert: Alert = new Alert();
      alert.alertNumber = 3;
      alert.title = ALERT_TITLE;
      alert.isPrivate = ends.alertIsPrivate;

      incidentRead = jest
        .spyOn(IncidentService, "findOneById")
        .mockResolvedValue(incident as never);
      alertRead = jest
        .spyOn(AlertService, "findOneById")
        .mockResolvedValue(alert as never);
    }

    async function link(): Promise<void> {
      const row: IncidentAlert = created({ createdByUserId: USER_ID });

      await IncidentAlertService.onCreateSuccess(
        {
          createBy: { data: row, props: { isRoot: true } },
          carryForward: null,
        },
        row,
      );
    }

    async function unlink(): Promise<void> {
      const linkId: ObjectID = ObjectID.generate();

      await IncidentAlertService.onDeleteSuccess(
        {
          deleteBy: {
            query: {},
            props: { userId: USER_ID },
            limit: 1,
            skip: 0,
          } as DeleteBy<IncidentAlert>,
          carryForward: [
            {
              id: linkId.toString(),
              incidentId: INCIDENT_ID,
              alertId: ALERT_ID,
              projectId: PROJECT_ID,
            },
          ],
        },
        [linkId],
      );
    }

    function incidentEntry(): Record<string, unknown> {
      expect(incidentFeed).toHaveBeenCalledTimes(1);
      return incidentFeed.mock.calls[0]![0];
    }

    function alertEntry(): Record<string, unknown> {
      expect(alertFeed).toHaveBeenCalledTimes(1);
      return alertFeed.mock.calls[0]![0];
    }

    test("both ends are read, as root, with their privacy", async () => {
      stubEnds({ incidentIsPrivate: false, alertIsPrivate: false });

      await link();

      expect(incidentRead.mock.calls[0]![0].select).toEqual(
        expect.objectContaining({ title: true, isPrivate: true }),
      );
      expect(alertRead.mock.calls[0]![0].select).toEqual(
        expect.objectContaining({ title: true, isPrivate: true }),
      );
      expect(incidentRead.mock.calls[0]![0].props).toEqual({ isRoot: true });
      expect(alertRead.mock.calls[0]![0].props).toEqual({ isRoot: true });
    });

    test.each([
      ["link", link],
      ["unlink", unlink],
    ])(
      "%s: a private alert is named by number and link only on the incident and its Slack / Teams post",
      async (_label: string, act: () => Promise<void>) => {
        stubEnds({ incidentIsPrivate: false, alertIsPrivate: true });

        await act();

        const entry: Record<string, unknown> = incidentEntry();
        const markdown: string = entry["feedInfoInMarkdown"] as string;

        expect(markdown).not.toContain(ALERT_TITLE);
        expect(markdown).toContain(
          `**[Alert #3](${ALERT_URL})** (private alert)`,
        );
        expect(markdown).toContain(`**[Incident INC-7](${INCIDENT_URL})**`);
        // The post is this same markdown, so it is title-free too.
        expect(entry["workspaceNotification"]).toEqual({
          sendWorkspaceNotification: true,
          notifyUserId: USER_ID,
        });

        // The incident is not private: the alert's entry may name it.
        expect(alertEntry()["feedInfoInMarkdown"]).toContain(
          `: ${INCIDENT_TITLE}`,
        );
      },
    );

    test("link: the incident-side wording for a private alert", async () => {
      stubEnds({ incidentIsPrivate: false, alertIsPrivate: true });

      await link();

      expect(incidentEntry()["feedInfoInMarkdown"]).toBe(
        `🔗 Linked **[Alert #3](${ALERT_URL})** (private alert) to **[Incident INC-7](${INCIDENT_URL})**`,
      );
    });

    test("unlink: the incident-side wording for a private alert", async () => {
      stubEnds({ incidentIsPrivate: false, alertIsPrivate: true });

      await unlink();

      expect(incidentEntry()["feedInfoInMarkdown"]).toBe(
        `Unlinked **[Alert #3](${ALERT_URL})** (private alert) from **[Incident INC-7](${INCIDENT_URL})**`,
      );
    });

    test.each([
      [
        "link",
        link,
        `🔗 Linked to **[Incident INC-7](${INCIDENT_URL})** (private incident)`,
      ],
      [
        "unlink",
        unlink,
        `Unlinked from **[Incident INC-7](${INCIDENT_URL})** (private incident)`,
      ],
    ])(
      "%s: a private incident is named by number and link only on the alert",
      async (_label: string, act: () => Promise<void>, expected: string) => {
        stubEnds({ incidentIsPrivate: true, alertIsPrivate: false });

        await act();

        const markdown: string = alertEntry()["feedInfoInMarkdown"] as string;

        expect(markdown).toBe(expected);
        expect(markdown).not.toContain(INCIDENT_TITLE);

        // The alert is not private: the incident's entry may name it.
        expect(incidentEntry()["feedInfoInMarkdown"]).toContain(
          `: ${ALERT_TITLE}`,
        );
      },
    );

    test.each([
      ["link", link],
      ["unlink", unlink],
    ])(
      "%s: when both ends are private neither title crosses over (their owners can differ)",
      async (_label: string, act: () => Promise<void>) => {
        stubEnds({ incidentIsPrivate: true, alertIsPrivate: true });

        await act();

        const incidentMarkdown: string = incidentEntry()[
          "feedInfoInMarkdown"
        ] as string;
        const alertMarkdown: string = alertEntry()[
          "feedInfoInMarkdown"
        ] as string;

        expect(incidentMarkdown).not.toContain(ALERT_TITLE);
        expect(incidentMarkdown).toContain("(private alert)");
        expect(alertMarkdown).not.toContain(INCIDENT_TITLE);
        expect(alertMarkdown).toContain("(private incident)");
      },
    );

    test("public ends keep their titles on both sides", async () => {
      stubEnds({ incidentIsPrivate: false, alertIsPrivate: false });

      await link();

      expect(incidentEntry()["feedInfoInMarkdown"]).toBe(
        `🔗 Linked **[Alert #3](${ALERT_URL})** to **[Incident INC-7](${INCIDENT_URL})**: ${ALERT_TITLE}`,
      );
      expect(alertEntry()["feedInfoInMarkdown"]).toBe(
        `🔗 Linked to **[Incident INC-7](${INCIDENT_URL})**: ${INCIDENT_TITLE}`,
      );
    });
  });

  describe("links written while an incident is declared from alerts", () => {
    async function linkWith(
      props: DatabaseCommonInteractionProps,
      miscDataProps: JSONObject | undefined,
    ): Promise<void> {
      const row: IncidentAlert = created({ createdByUserId: USER_ID });

      await IncidentAlertService.onCreateSuccess(
        {
          createBy: {
            data: row,
            props: props,
            ...(miscDataProps ? { miscDataProps: miscDataProps } : {}),
          },
          carryForward: null,
        },
        row,
      );
    }

    test("root with the flag: no incident-side entry or post, the alert still gets its entry", async () => {
      await linkWith(
        { isRoot: true },
        { [INCIDENT_ALERT_DECLARED_WITH_INCIDENT_KEY]: true },
      );

      expect(incidentFeed).not.toHaveBeenCalled();
      expect(alertFeed).toHaveBeenCalledTimes(1);
      expect(alertFeed.mock.calls[0]![0]["alertFeedEventType"]).toBe(
        AlertFeedEventType.LinkedToIncident,
      );
      expect(alertFeed.mock.calls[0]![0]["userId"]).toBe(USER_ID);
      // The alert is still brought in line with the incident.
      expect(sync).toHaveBeenCalledTimes(1);
    });

    test.each([
      ["a user", userProps(Permission.ProjectMember)],
      ["an API key", userProps(Permission.ProjectMember, null)],
    ])(
      "%s cannot suppress the incident's entry by sending the flag",
      async (_label: string, props: DatabaseCommonInteractionProps) => {
        await linkWith(props, {
          [INCIDENT_ALERT_DECLARED_WITH_INCIDENT_KEY]: true,
        });

        expect(incidentFeed).toHaveBeenCalledTimes(1);

        const entry: Record<string, unknown> = incidentFeed.mock.calls[0]![0];

        expect(entry["incidentFeedEventType"]).toBe(
          IncidentFeedEventType.AlertLinked,
        );
        expect(entry["workspaceNotification"]).toEqual(
          expect.objectContaining({ sendWorkspaceNotification: true }),
        );
        expect(alertFeed).toHaveBeenCalledTimes(1);
      },
    );

    test.each([
      ["no miscDataProps", undefined],
      ["other miscDataProps", { somethingElse: true }],
      [
        "a flag that is not exactly true",
        { [INCIDENT_ALERT_DECLARED_WITH_INCIDENT_KEY]: "true" },
      ],
    ])(
      "root with %s writes both entries",
      async (_label: string, miscDataProps: JSONObject | undefined) => {
        await linkWith({ isRoot: true }, miscDataProps);

        expect(incidentFeed).toHaveBeenCalledTimes(1);
        expect(alertFeed).toHaveBeenCalledTimes(1);
      },
    );
  });
});

describe("onBeforeDelete carries the rows it may delete", () => {
  test("reads the matching rows as root, pinned to the caller's project", async () => {
    const row: IncidentAlert = buildLink();
    row._id = ObjectID.generate().toString();
    const incomplete: IncidentAlert = new IncidentAlert();
    incomplete._id = ObjectID.generate().toString();

    const findBy: jest.SpyInstance = jest
      .spyOn(IncidentAlertService, "findBy")
      .mockResolvedValue([row, incomplete] as never);

    const result: OnDelete<IncidentAlert> = await callHook<
      OnDelete<IncidentAlert>
    >("onBeforeDelete", {
      query: { _id: row._id },
      props: userProps(Permission.ProjectAdmin),
      limit: 1,
      skip: 0,
    } as DeleteBy<IncidentAlert>);

    const args: {
      query: Query<IncidentAlert>;
      select: Record<string, boolean>;
      props: DatabaseCommonInteractionProps;
    } = findBy.mock.calls[0]![0];

    expect(args.props).toEqual({ isRoot: true });
    expect(args.select).toEqual({
      _id: true,
      incidentId: true,
      alertId: true,
      projectId: true,
    });
    expect(args.query._id).toBe(row._id);
    expect(args.query.projectId).toBe(PROJECT_ID);

    expect(result.carryForward).toEqual([
      {
        id: row._id,
        incidentId: INCIDENT_ID,
        alertId: ALERT_ID,
        projectId: PROJECT_ID,
      },
    ]);
  });
});

describe("privacy: link rows are narrowed to incidents AND alerts the caller can see", () => {
  function expectBothFilters(query: Query<IncidentAlert>): void {
    const incidentSql: Array<string> = operatorSql(query.incidentId);
    const alertSql: Array<string> = operatorSql(query.alertId);

    expect(
      incidentSql.some((sql: string) => {
        return sql.includes('FROM "Incident" i');
      }),
    ).toBe(true);
    expect(
      alertSql.some((sql: string) => {
        return sql.includes('FROM "Alert" a');
      }),
    ).toBe(true);
  }

  test("find", async () => {
    const result: OnFind<IncidentAlert> = await callHook<OnFind<IncidentAlert>>(
      "onBeforeFind",
      {
        query: {},
        props: userProps(Permission.ProjectMember),
        limit: 10,
        skip: 0,
      } as FindBy<IncidentAlert>,
    );

    expectBothFilters(result.findBy.query);
  });

  test("find keeps the caller's own incident filter alongside the privacy clause", async () => {
    const result: OnFind<IncidentAlert> = await callHook<OnFind<IncidentAlert>>(
      "onBeforeFind",
      {
        query: { incidentId: INCIDENT_ID },
        props: userProps(Permission.ProjectMember),
        limit: 10,
        skip: 0,
      } as FindBy<IncidentAlert>,
    );

    const incidentFilter: FindOperator<unknown> = result.findBy.query
      .incidentId as unknown as FindOperator<unknown>;

    expect(incidentFilter.type).toBe("and");
    expectBothFilters(result.findBy.query);
  });

  test("count", async () => {
    const baseCount: jest.SpyInstance = jest
      .spyOn(DatabaseService.prototype, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);

    await IncidentAlertService.countBy({
      query: {},
      props: userProps(Permission.ProjectMember),
    });

    expect(baseCount).toHaveBeenCalledTimes(1);
    expectBothFilters(baseCount.mock.calls[0]![0].query);
  });

  test("update", async () => {
    const result: OnUpdate<IncidentAlert> = await callHook<
      OnUpdate<IncidentAlert>
    >("onBeforeUpdate", {
      query: {},
      data: {},
      props: userProps(Permission.ProjectMember),
      limit: 1,
      skip: 0,
    } as UpdateBy<IncidentAlert>);

    expectBothFilters(result.updateBy.query);
  });

  test("delete, including the rows it carries forward", async () => {
    const findBy: jest.SpyInstance = jest
      .spyOn(IncidentAlertService, "findBy")
      .mockResolvedValue([] as never);

    const result: OnDelete<IncidentAlert> = await callHook<
      OnDelete<IncidentAlert>
    >("onBeforeDelete", {
      query: {},
      props: userProps(Permission.ProjectMember),
      limit: 1,
      skip: 0,
    } as DeleteBy<IncidentAlert>);

    expectBothFilters(result.deleteBy.query);
    expectBothFilters(findBy.mock.calls[0]![0].query);
  });

  test("project admins, and root, are not narrowed", async () => {
    for (const props of [
      userProps(Permission.ProjectAdmin),
      { isRoot: true },
    ] as Array<DatabaseCommonInteractionProps>) {
      const result: OnFind<IncidentAlert> = await callHook<
        OnFind<IncidentAlert>
      >("onBeforeFind", {
        query: {},
        props: props,
        limit: 10,
        skip: 0,
      } as FindBy<IncidentAlert>);

      expect(result.findBy.query).toEqual({});
    }
  });
});

describe("validateAlertIdsForNewIncident", () => {
  let alertFindBy: jest.SpyInstance;

  beforeEach(() => {
    alertFindBy = jest
      .spyOn(AlertService, "findBy")
      .mockImplementation((async (args: {
        query: { _id: unknown };
      }): Promise<Array<Alert>> => {
        const ids: Array<string> = Object.values(
          (args.query._id as FindOperator<unknown>).objectLiteralParameters ||
            {},
        )[0] as Array<string>;
        return ids.map((id: string) => {
          return alertRow(new ObjectID(id));
        });
      }) as never);
  });

  function validate(
    alertIds: unknown,
    props: DatabaseCommonInteractionProps = { isRoot: true },
  ): Promise<Array<ObjectID>> {
    return IncidentAlertService.validateAlertIdsForNewIncident({
      projectId: PROJECT_ID,
      alertIds: alertIds,
      props: props,
    });
  }

  test.each([
    ["a string", ALERT_ID.toString()],
    ["an object", { alertId: ALERT_ID.toString() }],
    ["a number", 5],
  ])("refuses %s instead of a list", async (_label: string, value: unknown) => {
    await expect(validate(value)).rejects.toThrow(
      "alertIdsToLink must be an array of alert ids.",
    );
    expect(alertFindBy).not.toHaveBeenCalled();
  });

  test.each([
    ["a number", 42],
    ["null", null],
    ["an object", { _id: ALERT_ID.toString() }],
    ["an empty string", ""],
    ["a string that is not an id", "not-an-id"],
    ["a SQL fragment", "1' OR '1'='1"],
  ])("refuses a list holding %s", async (_label: string, value: unknown) => {
    await expect(validate([ALERT_ID.toString(), value])).rejects.toThrow(
      "alertIdsToLink must only contain alert ids.",
    );
    expect(alertFindBy).not.toHaveBeenCalled();
  });

  test("refuses an empty list", async () => {
    await expect(validate([])).rejects.toThrow(
      "Please select at least one alert to link to the incident.",
    );
  });

  test(`refuses more than ${MAX_ALERTS_PER_INCIDENT_LINK_ACTION} distinct alerts`, async () => {
    const ids: Array<string> = [];
    for (let i: number = 0; i <= MAX_ALERTS_PER_INCIDENT_LINK_ACTION; i++) {
      ids.push(ObjectID.generate().toString());
    }

    await expect(validate(ids)).rejects.toThrow(
      `You can link at most ${MAX_ALERTS_PER_INCIDENT_LINK_ACTION} alerts`,
    );
    expect(alertFindBy).not.toHaveBeenCalled();
  });

  test(`counts the limit after removing duplicates`, async () => {
    const ids: Array<string> = [];
    for (let i: number = 0; i < MAX_ALERTS_PER_INCIDENT_LINK_ACTION; i++) {
      ids.push(ObjectID.generate().toString());
    }

    const result: Array<ObjectID> = await validate([...ids, ...ids]);

    expect(result).toHaveLength(MAX_ALERTS_PER_INCIDENT_LINK_ACTION);
  });

  test("removes duplicates regardless of case and whitespace, keeping order", async () => {
    const result: Array<ObjectID> = await validate([
      ALERT_ID_2.toString(),
      ` ${ALERT_ID.toString().toUpperCase()} `,
      ALERT_ID.toString(),
      ALERT_ID_2,
    ]);

    expect(
      result.map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([ALERT_ID_2.toString(), ALERT_ID.toString()]);
  });

  test("refuses when there is no project to check against", async () => {
    await expect(
      IncidentAlertService.validateAlertIdsForNewIncident({
        projectId: undefined,
        alertIds: [ALERT_ID.toString()],
        props: { isRoot: true },
      }),
    ).rejects.toThrow("projectId is required");
    expect(alertFindBy).not.toHaveBeenCalled();
  });

  test("root: reads the alerts as root, pinned to the project", async () => {
    await validate([ALERT_ID.toString(), ALERT_ID_2.toString()]);

    const args: {
      query: Query<Alert>;
      props: DatabaseCommonInteractionProps;
    } = alertFindBy.mock.calls[0]![0];

    expect(args.props).toEqual({ isRoot: true });
    expect(args.query.projectId).toBe(PROJECT_ID);
    expect(
      Object.values(
        (args.query._id as unknown as FindOperator<unknown>)
          .objectLiteralParameters || {},
      )[0],
    ).toEqual([ALERT_ID.toString(), ALERT_ID_2.toString()]);
  });

  test("refuses when an alert does not exist in the project", async () => {
    alertFindBy.mockResolvedValue([alertRow(ALERT_ID)] as never);

    await expect(
      validate([ALERT_ID.toString(), ALERT_ID_3.toString()]),
    ).rejects.toThrow(
      "One or more of the selected alerts do not exist in this project, or you do not have access to them.",
    );
  });

  test("a user reads the alerts as themselves", async () => {
    const props: DatabaseCommonInteractionProps = userProps(
      Permission.ProjectMember,
    );

    const result: Array<ObjectID> = await validate(
      [ALERT_ID.toString()],
      props,
    );

    expect(alertFindBy.mock.calls[0]![0].props).toBe(props);
    expect(result.map(String)).toEqual([ALERT_ID.toString()]);
  });

  test("a user who cannot see one of the alerts is refused without saying which", async () => {
    alertFindBy.mockResolvedValue([alertRow(ALERT_ID)] as never);

    await expect(
      validate(
        [ALERT_ID.toString(), ALERT_ID_2.toString()],
        userProps(Permission.ProjectMember),
      ),
    ).rejects.toThrow(
      "One or more of the selected alerts do not exist in this project, or you do not have access to them.",
    );
  });

  test("a user without read access to alerts gets the same answer", async () => {
    alertFindBy.mockRejectedValue(
      new NotAuthorizedException(
        "You do not have permission to read Alert",
      ) as never,
    );

    await expect(
      validate([ALERT_ID.toString()], userProps(Permission.IncidentMember)),
    ).rejects.toThrow(
      "One or more of the selected alerts do not exist in this project, or you do not have access to them.",
    );
  });

  test.each([
    Permission.Viewer,
    Permission.IncidentViewer,
    Permission.AlertViewer,
  ])(
    "a %s, who may not create links, is refused before any alert is read",
    async (permission: Permission) => {
      await expect(
        validate([ALERT_ID.toString()], userProps(permission)),
      ).rejects.toThrow(
        "You do not have permission to link alerts to incidents in this project.",
      );
      expect(alertFindBy).not.toHaveBeenCalled();
    },
  );

  test("a refusal that is not about the caller's role keeps its own answer", async () => {
    jest
      .spyOn(ModelPermission, "checkCreatePermissions")
      .mockImplementation((() => {
        throw new PaymentRequiredException("Please upgrade your plan");
      }) as never);

    await expect(
      validate([ALERT_ID.toString()], userProps(Permission.ProjectMember)),
    ).rejects.toBeInstanceOf(PaymentRequiredException);
  });

  test.each([
    Permission.ProjectMember,
    Permission.IncidentMember,
    Permission.AlertMember,
  ])("a %s may link alerts", async (permission: Permission) => {
    await expect(
      validate([ALERT_ID.toString()], userProps(permission)),
    ).resolves.toHaveLength(1);
  });

  test("accepts ObjectID values from server-side callers", async () => {
    const result: Array<ObjectID> = await validate([ALERT_ID]);

    expect(result.map(String)).toEqual([ALERT_ID.toString()]);
  });
});

describe("linkAlertsToIncident", () => {
  test("links each alert, counts an existing link as done and reports other failures", async () => {
    const create: jest.SpyInstance = jest
      .spyOn(IncidentAlertService, "create")
      .mockImplementation((async (args: {
        data: IncidentAlert;
      }): Promise<IncidentAlert> => {
        if (args.data.alertId?.toString() === ALERT_ID_2.toString()) {
          throw PostgresErrorTranslator.createUniqueViolationException(
            INCIDENT_ALERT_ALREADY_LINKED_MESSAGE,
          );
        }

        if (args.data.alertId?.toString() === ALERT_ID_3.toString()) {
          throw new BadDataException("The alert to link does not exist");
        }

        return args.data;
      }) as never);

    const result: LinkAlertsToIncidentResult =
      await IncidentAlertService.linkAlertsToIncident({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
        alertIds: [ALERT_ID, ALERT_ID_2, ALERT_ID_3],
        createdByUserId: USER_ID,
        props: { isRoot: true },
      });

    expect(result.linkedAlertIds).toEqual([ALERT_ID]);
    expect(result.alreadyLinkedAlertIds).toEqual([ALERT_ID_2]);
    expect(result.failed).toEqual([
      { alertId: ALERT_ID_3, message: "The alert to link does not exist" },
    ]);

    // Every alert was attempted, in order, even after a failure.
    expect(create).toHaveBeenCalledTimes(3);

    const first: {
      data: IncidentAlert;
      props: DatabaseCommonInteractionProps;
    } = create.mock.calls[0]![0];

    expect(first.props).toEqual({ isRoot: true });
    expect(first.data.projectId).toBe(PROJECT_ID);
    expect(first.data.incidentId).toBe(INCIDENT_ID);
    expect(first.data.alertId).toBe(ALERT_ID);
    expect(first.data.createdByUserId).toBe(USER_ID);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  test("a unique violation raised by Postgres itself also counts as already linked", async () => {
    const driverError: Error & { code?: string; driverError?: unknown } =
      new Error("duplicate key value violates unique constraint");
    driverError.driverError = { code: "23505" };
    driverError.code = "23505";

    jest
      .spyOn(IncidentAlertService, "create")
      .mockRejectedValue(driverError as never);

    const result: LinkAlertsToIncidentResult =
      await IncidentAlertService.linkAlertsToIncident({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
        alertIds: [ALERT_ID],
        props: { isRoot: true },
      });

    expect(result.alreadyLinkedAlertIds).toEqual([ALERT_ID]);
    expect(result.failed).toEqual([]);
  });

  test("leaves who linked it to the create when no user is named", async () => {
    const create: jest.SpyInstance = jest
      .spyOn(IncidentAlertService, "create")
      .mockImplementation((async (args: {
        data: IncidentAlert;
      }): Promise<IncidentAlert> => {
        return args.data;
      }) as never);

    const props: DatabaseCommonInteractionProps = userProps(
      Permission.ProjectMember,
    );

    await IncidentAlertService.linkAlertsToIncident({
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
      alertIds: [ALERT_ID],
      props: props,
    });

    expect(create.mock.calls[0]![0].data.createdByUserId).toBeUndefined();
    expect(create.mock.calls[0]![0].props).toBe(props);
  });
});

describe("linkAlertsToIncident while an incident is declared", () => {
  let create: jest.SpyInstance;

  beforeEach(() => {
    create = jest
      .spyOn(IncidentAlertService, "create")
      .mockImplementation((async (args: {
        data: IncidentAlert;
      }): Promise<IncidentAlert> => {
        return args.data;
      }) as never);
  });

  test("marks every link as declared with the incident", async () => {
    await IncidentAlertService.linkAlertsToIncident({
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
      alertIds: [ALERT_ID, ALERT_ID_2],
      declaredWithIncident: true,
      props: { isRoot: true },
    });

    expect(create).toHaveBeenCalledTimes(2);

    for (const call of create.mock.calls) {
      expect(call[0].miscDataProps).toEqual({
        [INCIDENT_ALERT_DECLARED_WITH_INCIDENT_KEY]: true,
      });
    }
  });

  test.each([
    ["left out", undefined],
    ["false", false],
  ])(
    "sends no miscDataProps when declaredWithIncident is %s",
    async (_label: string, declaredWithIncident: boolean | undefined) => {
      await IncidentAlertService.linkAlertsToIncident({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
        alertIds: [ALERT_ID],
        declaredWithIncident: declaredWithIncident,
        props: { isRoot: true },
      });

      expect(create.mock.calls[0]![0]).not.toHaveProperty("miscDataProps");
    },
  );
});

describe("the one incident entry for an incident declared from alerts", () => {
  function mention(
    number: number,
    title: string | undefined,
    isPrivate: boolean = false,
  ): LinkedAlertMention {
    return {
      label: `Alert #${number}`,
      link: `${ALERT_URL}/${number}`,
      title: title,
      isPrivate: isPrivate,
    };
  }

  test("lists every alert with its number and link, and the title of each public one", () => {
    expect(
      getDeclaredFromAlertsMarkdown([
        mention(3, "Checkout p95 latency is high"),
        mention(7, "Payroll DB credentials exposed", true),
        mention(9, undefined),
      ]),
    ).toBe(
      [
        "🔗 Declared from 3 alerts:",
        "",
        `- **[Alert #3](${ALERT_URL}/3)**: Checkout p95 latency is high`,
        `- **[Alert #7](${ALERT_URL}/7)** (private alert)`,
        `- **[Alert #9](${ALERT_URL}/9)**: No title`,
      ].join("\n"),
    );
  });

  test("one alert is 'alert', not 'alerts'", () => {
    expect(
      getDeclaredFromAlertsMarkdown([mention(3, "Checkout is slow")]),
    ).toBe(
      `🔗 Declared from 1 alert:\n\n- **[Alert #3](${ALERT_URL}/3)**: Checkout is slow`,
    );
  });

  describe("reading the alerts and posting the entry", () => {
    let alertFindBy: jest.SpyInstance;
    let incidentFeed: jest.SpyInstance;

    function alertWith(
      id: ObjectID,
      number: number,
      title: string,
      options: { isPrivate?: boolean; prefix?: string } = {},
    ): Alert {
      const alert: Alert = new Alert();
      alert._id = id.toString();
      alert.alertNumber = number;
      alert.title = title;
      alert.isPrivate = options.isPrivate === true;
      if (options.prefix) {
        alert.alertNumberWithPrefix = `${options.prefix}${number}`;
      }
      return alert;
    }

    beforeEach(() => {
      // Returned out of order: the entry follows the order it was given.
      alertFindBy = jest.spyOn(AlertService, "findBy").mockResolvedValue([
        alertWith(ALERT_ID_3, 9, "Disk is full"),
        alertWith(ALERT_ID, 3, "Checkout p95 latency is high", {
          prefix: "ALT-",
        }),
        alertWith(ALERT_ID_2, 7, "Payroll DB credentials exposed", {
          isPrivate: true,
        }),
      ] as never);

      jest
        .spyOn(AlertService, "getAlertLinkInDashboard")
        .mockImplementation((async (
          _projectId: ObjectID,
          alertId: ObjectID,
        ): Promise<URL> => {
          return URL.fromString(`${ALERT_URL}/${alertId.toString()}`);
        }) as never);

      incidentFeed = jest
        .spyOn(IncidentFeedService, "createIncidentFeedItem")
        .mockResolvedValue(undefined as never);
    });

    test("reads the alerts as root, pinned to the project, with their privacy", async () => {
      await IncidentAlertService.buildDeclaredFromAlertsMarkdown({
        projectId: PROJECT_ID,
        alertIds: [ALERT_ID, ALERT_ID_2],
      });

      const args: {
        query: Query<Alert>;
        select: Record<string, boolean>;
        props: DatabaseCommonInteractionProps;
      } = alertFindBy.mock.calls[0]![0];

      expect(args.props).toEqual({ isRoot: true });
      expect(args.query.projectId).toBe(PROJECT_ID);
      expect(
        Object.values(
          (args.query._id as unknown as FindOperator<unknown>)
            .objectLiteralParameters || {},
        )[0],
      ).toEqual([ALERT_ID.toString(), ALERT_ID_2.toString()]);
      expect(args.select).toEqual(
        expect.objectContaining({
          alertNumber: true,
          alertNumberWithPrefix: true,
          title: true,
          isPrivate: true,
        }),
      );
    });

    test("lists the alerts in the order given, once each, skipping ones that no longer exist", async () => {
      const gone: ObjectID = ObjectID.generate();

      const markdown: string | null =
        await IncidentAlertService.buildDeclaredFromAlertsMarkdown({
          projectId: PROJECT_ID,
          alertIds: [ALERT_ID_2, gone, ALERT_ID, ALERT_ID_3, ALERT_ID],
        });

      expect(markdown).toBe(
        [
          "🔗 Declared from 3 alerts:",
          "",
          `- **[Alert #7](${ALERT_URL}/${ALERT_ID_2.toString()})** (private alert)`,
          `- **[Alert ALT-3](${ALERT_URL}/${ALERT_ID.toString()})**: Checkout p95 latency is high`,
          `- **[Alert #9](${ALERT_URL}/${ALERT_ID_3.toString()})**: Disk is full`,
        ].join("\n"),
      );
      expect(markdown).not.toContain("Payroll DB credentials exposed");
    });

    test("no alerts to name: no markdown, and nothing is read", async () => {
      await expect(
        IncidentAlertService.buildDeclaredFromAlertsMarkdown({
          projectId: PROJECT_ID,
          alertIds: [],
        }),
      ).resolves.toBeNull();
      expect(alertFindBy).not.toHaveBeenCalled();
    });

    test("posts exactly one Alert Linked entry to the incident and its channels", async () => {
      await IncidentAlertService.createDeclaredFromAlertsFeedItem({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
        alertIds: [ALERT_ID, ALERT_ID_2, ALERT_ID_3],
        actorUserId: USER_ID,
      });

      expect(incidentFeed).toHaveBeenCalledTimes(1);

      const entry: Record<string, unknown> = incidentFeed.mock.calls[0]![0];

      expect(entry["incidentId"]).toBe(INCIDENT_ID);
      expect(entry["projectId"]).toBe(PROJECT_ID);
      expect(entry["incidentFeedEventType"]).toBe(
        IncidentFeedEventType.AlertLinked,
      );
      expect(entry["displayColor"]).toBe(Yellow500);
      expect(entry["userId"]).toBe(USER_ID);
      expect(entry["workspaceNotification"]).toEqual({
        sendWorkspaceNotification: true,
        notifyUserId: USER_ID,
      });
      expect(entry["feedInfoInMarkdown"]).toContain(
        "🔗 Declared from 3 alerts:",
      );
      expect(entry["feedInfoInMarkdown"]).not.toContain(
        "Payroll DB credentials exposed",
      );
    });

    test("an API key declares as nobody", async () => {
      await IncidentAlertService.createDeclaredFromAlertsFeedItem({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
        alertIds: [ALERT_ID],
        actorUserId: undefined,
      });

      const entry: Record<string, unknown> = incidentFeed.mock.calls[0]![0];

      expect(entry["userId"]).toBeUndefined();
      expect(entry["workspaceNotification"]).toEqual({
        sendWorkspaceNotification: true,
        notifyUserId: undefined,
      });
    });

    test("posts nothing when none of the alerts exists any more", async () => {
      alertFindBy.mockResolvedValue([] as never);

      await IncidentAlertService.createDeclaredFromAlertsFeedItem({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
        alertIds: [ALERT_ID],
        actorUserId: USER_ID,
      });

      expect(incidentFeed).not.toHaveBeenCalled();
    });
  });
});

describe("copyAlertOwnersToIncident", () => {
  const TEAM_ID: ObjectID = new ObjectID(
    "0194a1e7-0000-4000-8000-0000000000d1",
  );
  const OTHER_TEAM_ID: ObjectID = new ObjectID(
    "0194a1e7-0000-4000-8000-0000000000d2",
  );

  let ownerUsers: jest.SpyInstance;
  let ownerTeams: jest.SpyInstance;
  let addOwners: jest.SpyInstance;

  function ownerUser(userId: ObjectID | undefined): AlertOwnerUser {
    const owner: AlertOwnerUser = new AlertOwnerUser();
    if (userId) {
      owner.userId = userId;
    }
    return owner;
  }

  function ownerTeam(teamId: ObjectID): AlertOwnerTeam {
    const owner: AlertOwnerTeam = new AlertOwnerTeam();
    owner.teamId = teamId;
    return owner;
  }

  beforeEach(() => {
    // Two alerts owned by overlapping users and teams.
    ownerUsers = jest
      .spyOn(AlertOwnerUserService, "findBy")
      .mockResolvedValue([
        ownerUser(USER_ID),
        ownerUser(OTHER_USER_ID),
        ownerUser(new ObjectID(USER_ID.toString().toUpperCase())),
        ownerUser(undefined),
      ] as never);
    ownerTeams = jest
      .spyOn(AlertOwnerTeamService, "findBy")
      .mockResolvedValue([
        ownerTeam(TEAM_ID),
        ownerTeam(OTHER_TEAM_ID),
        ownerTeam(TEAM_ID),
      ] as never);
    addOwners = jest
      .spyOn(IncidentService, "addOwners")
      .mockResolvedValue(undefined as never);
  });

  function copy(
    alertIds: Array<ObjectID> = [ALERT_ID, ALERT_ID_2],
  ): Promise<{ userIds: Array<ObjectID>; teamIds: Array<ObjectID> }> {
    return IncidentAlertService.copyAlertOwnersToIncident({
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
      alertIds: alertIds,
    });
  }

  test("reads the alerts' owners as root, pinned to the project", async () => {
    await copy();

    for (const [spy, column] of [
      [ownerUsers, "userId"],
      [ownerTeams, "teamId"],
    ] as Array<[jest.SpyInstance, string]>) {
      const args: {
        query: Record<string, unknown>;
        select: Record<string, boolean>;
        props: DatabaseCommonInteractionProps;
      } = spy.mock.calls[0]![0];

      expect(args.props).toEqual({ isRoot: true });
      expect(args.query["projectId"]).toBe(PROJECT_ID);
      expect(
        Object.values(
          (args.query["alertId"] as FindOperator<unknown>)
            .objectLiteralParameters || {},
        )[0],
      ).toEqual([ALERT_ID.toString(), ALERT_ID_2.toString()]);
      expect(args.select).toEqual({ [column]: true });
    }
  });

  test("adds each owner once, as root, without notifying them", async () => {
    const result: { userIds: Array<ObjectID>; teamIds: Array<ObjectID> } =
      await copy();

    expect(addOwners).toHaveBeenCalledTimes(1);

    const [projectId, incidentId, userIds, teamIds, notifyOwners, props] =
      addOwners.mock.calls[0]! as [
        ObjectID,
        ObjectID,
        Array<ObjectID>,
        Array<ObjectID>,
        boolean,
        DatabaseCommonInteractionProps,
      ];

    expect(projectId).toBe(PROJECT_ID);
    expect(incidentId).toBe(INCIDENT_ID);
    expect(userIds.map(String)).toEqual([
      USER_ID.toString(),
      OTHER_USER_ID.toString(),
    ]);
    expect(teamIds.map(String)).toEqual([
      TEAM_ID.toString(),
      OTHER_TEAM_ID.toString(),
    ]);
    expect(notifyOwners).toBe(false);
    expect(props).toEqual({ isRoot: true });
    expect(result.userIds.map(String)).toEqual(userIds.map(String));
    expect(result.teamIds.map(String)).toEqual(teamIds.map(String));
  });

  test("alerts without owners add nobody", async () => {
    ownerUsers.mockResolvedValue([] as never);
    ownerTeams.mockResolvedValue([] as never);

    await expect(copy()).resolves.toEqual({ userIds: [], teamIds: [] });
    expect(addOwners).not.toHaveBeenCalled();
  });

  test("owner teams alone are still added", async () => {
    ownerUsers.mockResolvedValue([] as never);

    await copy();

    expect(addOwners.mock.calls[0]![2]).toEqual([]);
    expect(addOwners.mock.calls[0]![3].map(String)).toEqual([
      TEAM_ID.toString(),
      OTHER_TEAM_ID.toString(),
    ]);
  });

  test("no alerts: nothing is read or added", async () => {
    await expect(copy([])).resolves.toEqual({ userIds: [], teamIds: [] });
    expect(ownerUsers).not.toHaveBeenCalled();
    expect(ownerTeams).not.toHaveBeenCalled();
    expect(addOwners).not.toHaveBeenCalled();
  });
});

describe("a duplicate caught by the unique index answers like the unique-together check", () => {
  type DriverError = Error & {
    code?: string;
    table?: string;
    detail?: string;
    driverError?: { code: string; table?: string; detail?: string };
  };

  const DUPLICATE_DETAIL: string = `Key ("incidentId", "alertId", "projectId")=(${INCIDENT_ID.toString()}, ${ALERT_ID.toString()}, ${PROJECT_ID.toString()}) already exists.`;

  /*
   * A QueryFailedError as TypeORM raises it for Postgres: the pg fields are
   * hoisted onto the error and kept under driverError. `hoisted: false` keeps
   * them under driverError only.
   */
  function driverError(
    code: string,
    table: string | undefined,
    detail: string,
    hoisted: boolean = true,
  ): DriverError {
    const error: DriverError = new Error(
      "duplicate key value violates unique constraint",
    );
    error.driverError = { code: code, detail: detail };
    if (table) {
      error.driverError.table = table;
    }
    if (hoisted) {
      error.code = code;
      error.detail = detail;
      if (table) {
        error.table = table;
      }
    }
    return error;
  }

  // What getException throws for `error` (it always throws).
  function thrownFor(error: unknown): unknown {
    const service: { getException: (error: unknown) => never } =
      IncidentAlertService as unknown as {
        getException: (error: unknown) => never;
      };

    try {
      service.getException(error);
    } catch (thrown) {
      return thrown;
    }

    throw new Error("getException returned instead of throwing");
  }

  test("without the override a duplicate insert would read as a generic 'already exists'", () => {
    const translated: unknown = PostgresErrorTranslator.translate(
      driverError("23505", "IncidentAlert", DUPLICATE_DETAIL),
    );

    expect((translated as Error).message).toContain("already exists");
    expect((translated as Error).message).not.toBe(
      INCIDENT_ALERT_ALREADY_LINKED_MESSAGE,
    );
  });

  test.each([
    [
      "names IncidentAlert",
      driverError("23505", "IncidentAlert", DUPLICATE_DETAIL),
    ],
    [
      "names IncidentAlert under driverError only",
      driverError("23505", "IncidentAlert", DUPLICATE_DETAIL, false),
    ],
    ["names no table", driverError("23505", undefined, DUPLICATE_DETAIL)],
    [
      "was already translated",
      PostgresErrorTranslator.createUniqueViolationException(
        "A Incident Alert with the same Incident Id, Alert Id, Project Id already exists. Please use different values and try again.",
      ),
    ],
  ])(
    "a unique violation that %s answers 'already linked' and stays a unique violation",
    (_label: string, error: unknown) => {
      const thrown: unknown = thrownFor(error);

      expect(thrown).toBeInstanceOf(BadDataException);
      expect((thrown as Error).message).toBe(
        INCIDENT_ALERT_ALREADY_LINKED_MESSAGE,
      );
      expect(PostgresErrorTranslator.isUniqueViolation(thrown)).toBe(true);
    },
  );

  test("a unique violation on another table keeps the generic translation", () => {
    const thrown: unknown = thrownFor(
      driverError("23505", "AlertFeed", 'Key ("slug")=(x) already exists.'),
    );

    expect((thrown as Error).message).toBe(
      "A Alert Feed with this Slug already exists. Please use a different value and try again.",
    );
    expect(PostgresErrorTranslator.isUniqueViolation(thrown)).toBe(true);
  });

  test("a foreign key violation keeps the generic translation", () => {
    const error: DriverError = driverError(
      "23503",
      "IncidentAlert",
      `Key ("alertId")=(${ALERT_ID.toString()}) is not present in table "Alert".`,
    );

    const thrown: unknown = thrownFor(error);

    expect((thrown as Error).message).not.toBe(
      INCIDENT_ALERT_ALREADY_LINKED_MESSAGE,
    );
    expect(PostgresErrorTranslator.isUniqueViolation(thrown)).toBe(false);
  });

  test("anything that is not a Postgres error is passed on as it is", () => {
    const error: Error = new Error("connection reset");

    expect(thrownFor(error)).toBe(error);
  });

  describe("through create", () => {
    let save: jest.Mock;
    let countBy: jest.SpyInstance;

    beforeEach(() => {
      save = jest.fn();
      jest
        .spyOn(IncidentAlertService, "getRepository")
        .mockReturnValue({ save: save } as never);
      countBy = jest
        .spyOn(IncidentAlertService, "countBy")
        .mockResolvedValue(new PositiveNumber(0) as never);
    });

    function createLink(): Promise<IncidentAlert> {
      return IncidentAlertService.create({
        data: buildLink(),
        props: { isRoot: true },
      });
    }

    async function failureOf(run: () => Promise<unknown>): Promise<unknown> {
      try {
        await run();
      } catch (error) {
        return error;
      }
      throw new Error("expected the create to fail");
    }

    test("two requests racing past the unique-together check: the index's refusal reads 'already linked'", async () => {
      save.mockRejectedValue(
        driverError("23505", "IncidentAlert", DUPLICATE_DETAIL) as never,
      );

      const failure: unknown = await failureOf(createLink);

      // The unique-together check ran and found nothing, as in a race.
      expect(countBy).toHaveBeenCalledTimes(1);
      expect(save).toHaveBeenCalledTimes(1);
      expect((failure as Error).message).toBe(
        INCIDENT_ALERT_ALREADY_LINKED_MESSAGE,
      );
      expect(PostgresErrorTranslator.isUniqueViolation(failure)).toBe(true);
    });

    test("the unique-together check answers with the same message before any insert", async () => {
      countBy.mockResolvedValue(new PositiveNumber(1) as never);

      const failure: unknown = await failureOf(createLink);

      expect(save).not.toHaveBeenCalled();
      expect((failure as Error).message).toBe(
        INCIDENT_ALERT_ALREADY_LINKED_MESSAGE,
      );
      expect(PostgresErrorTranslator.isUniqueViolation(failure)).toBe(true);
    });

    test("linkAlertsToIncident counts the index's refusal as already linked", async () => {
      save.mockRejectedValue(
        driverError("23505", "IncidentAlert", DUPLICATE_DETAIL) as never,
      );

      const result: LinkAlertsToIncidentResult =
        await IncidentAlertService.linkAlertsToIncident({
          projectId: PROJECT_ID,
          incidentId: INCIDENT_ID,
          alertIds: [ALERT_ID],
          props: { isRoot: true },
        });

      expect(result.alreadyLinkedAlertIds).toEqual([ALERT_ID]);
      expect(result.linkedAlertIds).toEqual([]);
      expect(result.failed).toEqual([]);
    });
  });
});
