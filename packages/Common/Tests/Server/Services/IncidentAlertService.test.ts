import AlertFeedService from "../../../Server/Services/AlertFeedService";
import AlertService from "../../../Server/Services/AlertService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentAlertService, {
  LinkAlertsToIncidentResult,
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
import { MAX_ALERTS_PER_INCIDENT_LINK_ACTION } from "../../../Types/Incident/IncidentAlertLink";
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
            "This alert is already linked to this incident.",
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
