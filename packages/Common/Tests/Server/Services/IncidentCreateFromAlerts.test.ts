import Semaphore, {
  SemaphoreMutex,
} from "../../../Server/Infrastructure/Semaphore";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import AlertService from "../../../Server/Services/AlertService";
import AutoRemediationRuleEngineService from "../../../Server/Services/AutoRemediationRuleEngineService";
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import IncidentAlertService, {
  LinkAlertsToIncidentResult,
} from "../../../Server/Services/IncidentAlertService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentGroupingEngineService from "../../../Server/Services/IncidentGroupingEngineService";
import IncidentLabelRuleEngineService from "../../../Server/Services/IncidentLabelRuleEngineService";
import IncidentMeasurementValueService from "../../../Server/Services/IncidentMeasurementValueService";
import IncidentOnCallRuleEngineService from "../../../Server/Services/IncidentOnCallRuleEngineService";
import IncidentOwnerRuleEngineService from "../../../Server/Services/IncidentOwnerRuleEngineService";
import IncidentPrivacyRuleEngineService from "../../../Server/Services/IncidentPrivacyRuleEngineService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentSlaService from "../../../Server/Services/IncidentSlaService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import IncidentStateTimelineService from "../../../Server/Services/IncidentStateTimelineService";
import ProjectService from "../../../Server/Services/ProjectService";
import RunbookRuleEngineService from "../../../Server/Services/RunbookRuleEngineService";
import UserService from "../../../Server/Services/UserService";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import AIIncidentInvestigationRunner from "../../../Server/Utils/AI/SRE/IncidentInvestigationRunner";
import ProjectScopedReferenceValidator from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import logger from "../../../Server/Utils/Logger";
import ProductAnalytics from "../../../Server/Utils/ProductAnalytics";
import SloRecordReferenceValidator from "../../../Server/Utils/Slo/SloRecordReferenceValidator";
import Alert from "../../../Models/DatabaseModels/Alert";
import { AlertFeedEventType } from "../../../Models/DatabaseModels/AlertFeed";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentAlert from "../../../Models/DatabaseModels/IncidentAlert";
import { IncidentFeedEventType } from "../../../Models/DatabaseModels/IncidentFeed";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../../Types/Date";
import { INCIDENT_ALERT_IDS_TO_LINK_KEY } from "../../../Types/Incident/IncidentAlertLink";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * Declaring an incident from alerts, and carrying incident state changes over
 * to linked alerts, at the two places they hook into existing services:
 *
 * - IncidentService.onBeforeCreate checks miscDataProps.alertIdsToLink BEFORE
 *   the incident number is taken, so a bad id neither burns a number nor
 *   leaves an incident behind; onCreateSuccess links the alerts once the
 *   incident exists, and a failing link never fails the incident;
 * - IncidentStateTimelineService.onCreateSuccess hands the incident's new
 *   CURRENT state to the linked-alert cascade, after its mutex is released,
 *   and never waits on it or fails because of it.
 *
 * Everything around those hooks is stubbed; the cascade and the link helpers
 * have their own tests.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0194c3a9-0000-4000-8000-000000000001",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "0194c3a9-0000-4000-8000-0000000000a1",
);
const ALERT_ID: string = "0194c3a9-0000-4000-8000-0000000000b1";
const ALERT_ID_2: string = "0194c3a9-0000-4000-8000-0000000000b2";
const FOREIGN_ALERT_ID: string = "0194c3a9-0000-4000-8000-0000000000bf";
const USER_ID: ObjectID = new ObjectID("0194c3a9-0000-4000-8000-0000000000c1");
const OTHER_USER_ID: ObjectID = new ObjectID(
  "0194c3a9-0000-4000-8000-0000000000c2",
);
const CREATED_STATE_ID: string = "0194c3a9-0000-4000-8000-0000000000d1";
const ACKNOWLEDGED_STATE_ID: string = "0194c3a9-0000-4000-8000-0000000000d2";
const SEVERITY_ID: ObjectID = new ObjectID(
  "0194c3a9-0000-4000-8000-0000000000e1",
);

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

function userProps(permission: Permission): DatabaseCommonInteractionProps {
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
    userId: USER_ID,
    userType: UserType.User,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: tenantPermission,
    },
  };
}

// An API key: a project tenant and no user.
function apiKeyProps(): DatabaseCommonInteractionProps {
  const props: DatabaseCommonInteractionProps = userProps(
    Permission.ProjectMember,
  );
  delete props.userId;
  props.userType = UserType.API;
  return props;
}

async function settle(): Promise<void> {
  // Let fire-and-forget chains run to completion while the stubs are live.
  for (let i: number = 0; i < 5; i++) {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  }
}

let errorLog: jest.SpyInstance;

beforeEach(() => {
  errorLog = jest.spyOn(logger, "error").mockImplementation((() => {
    // quiet
  }) as never);
});

afterEach(async () => {
  await settle();
  jest.restoreAllMocks();
});

describe("IncidentService.onBeforeCreate with alerts to link", () => {
  let counter: jest.SpyInstance;
  let validate: jest.SpyInstance;

  beforeEach(() => {
    const createdState: IncidentState = new IncidentState();
    createdState._id = CREATED_STATE_ID;

    jest
      .spyOn(IncidentStateService, "findOneBy")
      .mockResolvedValue(createdState as never);
    jest
      .spyOn(
        ProjectScopedReferenceValidator,
        "validateReferencesBelongToProject",
      )
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(
        SloRecordReferenceValidator,
        "validateServiceLevelObjectivesBelongToProject",
      )
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(CustomFieldMappingService, "applyMappingsToCreate")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(UserService, "getUserMarkdownString")
      .mockResolvedValue("**A responder**" as never);

    counter = jest
      .spyOn(ProjectService, "incrementAndGetIncidentCounter")
      .mockResolvedValue({ counter: 17, prefix: "INC-" } as never);

    // The project's alerts: ALERT_ID and ALERT_ID_2. FOREIGN_ALERT_ID is not.
    jest.spyOn(AlertService, "findBy").mockImplementation((async (args: {
      query: { _id: unknown };
    }): Promise<Array<Alert>> => {
      const ids: Array<string> = Object.values(
        (args.query._id as FindOperator<unknown>).objectLiteralParameters || {},
      )[0] as Array<string>;

      return ids
        .filter((id: string) => {
          return id !== FOREIGN_ALERT_ID;
        })
        .map((id: string) => {
          const alert: Alert = new Alert();
          alert._id = id;
          return alert;
        });
    }) as never);

    validate = jest.spyOn(
      IncidentAlertService,
      "validateAlertIdsForNewIncident",
    );
  });

  function buildIncident(): Incident {
    const incident: Incident = new Incident();
    incident.projectId = PROJECT_ID;
    incident.title = "Checkout is failing";
    incident.incidentSeverityId = SEVERITY_ID;
    return incident;
  }

  function onBeforeCreate(
    miscDataProps: JSONObject | undefined,
    props: DatabaseCommonInteractionProps = userProps(Permission.ProjectMember),
  ): Promise<OnCreate<Incident>> {
    return callHook<OnCreate<Incident>>(IncidentService, "onBeforeCreate", {
      data: buildIncident(),
      miscDataProps: miscDataProps,
      props: props,
    });
  }

  test("without miscDataProps nothing is validated or carried forward", async () => {
    const result: OnCreate<Incident> = await onBeforeCreate(undefined);

    expect(validate).not.toHaveBeenCalled();
    expect(result.carryForward).toBeNull();
    expect(counter).toHaveBeenCalledTimes(1);
  });

  test("miscDataProps with other keys (owners) leave the alerts alone", async () => {
    const result: OnCreate<Incident> = await onBeforeCreate({
      ownerUsers: [USER_ID.toString()],
    });

    expect(validate).not.toHaveBeenCalled();
    expect(result.carryForward).toBeNull();
  });

  test("a null list is treated as no list", async () => {
    const result: OnCreate<Incident> = await onBeforeCreate({
      [INCIDENT_ALERT_IDS_TO_LINK_KEY]: null,
    });

    expect(validate).not.toHaveBeenCalled();
    expect(result.carryForward).toBeNull();
  });

  test.each([
    ["not a list", ALERT_ID, "must be an array of alert ids"],
    [
      "a list holding something other than an id",
      [ALERT_ID, 7],
      "must only contain alert ids",
    ],
    [
      "a list holding a malformed id",
      ["not-a-uuid"],
      "must only contain alert ids",
    ],
    ["an empty list", [], "Please select at least one alert"],
    [
      "more than 50 alerts",
      Array.from({ length: 51 }, () => {
        return ObjectID.generate().toString();
      }),
      "You can link at most 50 alerts",
    ],
    [
      "an alert from another project",
      [ALERT_ID, FOREIGN_ALERT_ID],
      "do not exist in this project, or you do not have access to them",
    ],
  ])(
    "%s is refused before an incident number is taken",
    async (_label: string, alertIds: unknown, message: string) => {
      await expect(
        onBeforeCreate({ [INCIDENT_ALERT_IDS_TO_LINK_KEY]: alertIds as never }),
      ).rejects.toThrow(message);

      expect(counter).not.toHaveBeenCalled();
    },
  );

  test("a caller who may not link alerts is refused before an incident number is taken", async () => {
    await expect(
      onBeforeCreate(
        { [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [ALERT_ID] },
        userProps(Permission.IncidentViewer),
      ),
    ).rejects.toThrow(
      "You do not have permission to link alerts to incidents in this project.",
    );

    expect(counter).not.toHaveBeenCalled();
  });

  test("valid alert ids are checked as the caller, then carried to onCreateSuccess", async () => {
    const props: DatabaseCommonInteractionProps = userProps(
      Permission.ProjectMember,
    );

    const result: OnCreate<Incident> = await onBeforeCreate(
      {
        [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [
          ALERT_ID,
          ALERT_ID_2,
          ALERT_ID.toUpperCase(),
        ],
      },
      props,
    );

    expect(validate).toHaveBeenCalledTimes(1);

    const args: {
      projectId: ObjectID;
      alertIds: unknown;
      props: DatabaseCommonInteractionProps;
    } = validate.mock.calls[0]![0];

    expect(args.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(args.props).toBe(props);

    // Validated before the number was taken.
    expect(validate.mock.invocationCallOrder[0]!).toBeLessThan(
      counter.mock.invocationCallOrder[0]!,
    );

    const carried: { alertIdsToLink: Array<ObjectID> } =
      result.carryForward as { alertIdsToLink: Array<ObjectID> };

    expect(carried.alertIdsToLink.map(String)).toEqual([ALERT_ID, ALERT_ID_2]);
    expect(result.createBy.data.incidentNumber).toBe(17);
  });

  test("a root caller (API automation run as root) is validated too", async () => {
    const result: OnCreate<Incident> = await onBeforeCreate(
      { [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [ALERT_ID] },
      { isRoot: true },
    );

    expect(
      (result.carryForward as { alertIdsToLink: Array<ObjectID> })
        .alertIdsToLink,
    ).toHaveLength(1);
  });
});

describe("IncidentService.onCreateSuccess links the alerts it was declared with", () => {
  let link: jest.SpyInstance;
  let summary: jest.SpyInstance;
  let copyOwners: jest.SpyInstance;
  const chain: Record<string, jest.SpyInstance> = {};

  beforeEach(() => {
    jest.spyOn(ProductAnalytics, "captureForUser").mockImplementation((() => {
      // no analytics in tests
    }) as never);

    const reRead: Incident = new Incident();
    reRead._id = INCIDENT_ID.toString();
    reRead.projectId = PROJECT_ID;
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(reRead as never);

    // The un-awaited side-effect chain.
    const service: Record<string, unknown> =
      IncidentService as unknown as Record<string, unknown>;
    for (const method of [
      "handleIncidentWorkspaceOperationsAsync",
      "createIncidentFeedAsync",
      "handleIncidentStateChangeAsync",
      "disableActiveMonitoringIfManualIncident",
      "refreshReminderSchedule",
    ]) {
      chain[method] = jest
        .spyOn(service as Record<string, () => Promise<void>>, method)
        .mockResolvedValue(undefined as never);
    }

    jest
      .spyOn(IncidentPrivacyRuleEngineService, "applyRulesToIncident")
      .mockResolvedValue(false as never);
    jest
      .spyOn(IncidentOwnerRuleEngineService, "applyRulesToIncident")
      .mockResolvedValue(undefined as never);
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

    link = jest
      .spyOn(IncidentAlertService, "linkAlertsToIncident")
      .mockResolvedValue({
        linkedAlertIds: [],
        alreadyLinkedAlertIds: [],
        failed: [],
      } as never);
    summary = jest
      .spyOn(IncidentAlertService, "createDeclaredFromAlertsFeedItem")
      .mockResolvedValue(undefined as never);
    copyOwners = jest
      .spyOn(IncidentAlertService, "copyAlertOwnersToIncident")
      .mockResolvedValue({ userIds: [], teamIds: [] } as never);
  });

  function createdIncident(
    createdByUserId?: ObjectID,
    isPrivate: boolean = false,
  ): Incident {
    const incident: Incident = new Incident();
    incident._id = INCIDENT_ID.toString();
    incident.projectId = PROJECT_ID;
    incident.title = "Checkout is failing";
    incident.declaredAt = OneUptimeDate.getCurrentDate();
    incident.isPrivate = isPrivate;
    if (createdByUserId) {
      incident.createdByUserId = createdByUserId;
    }
    return incident;
  }

  function onCreateSuccess(
    carryForward: unknown,
    createdItem: Incident,
    props: DatabaseCommonInteractionProps = { isRoot: true },
  ): Promise<Incident> {
    return callHook<Incident>(
      IncidentService,
      "onCreateSuccess",
      {
        createBy: { data: createdItem, props: props },
        carryForward: carryForward,
      },
      createdItem,
    );
  }

  test("links every validated alert as root, recording the declaring user", async () => {
    const alertIds: Array<ObjectID> = [
      new ObjectID(ALERT_ID),
      new ObjectID(ALERT_ID_2),
    ];
    const incident: Incident = createdIncident(USER_ID);

    await expect(
      onCreateSuccess({ alertIdsToLink: alertIds }, incident),
    ).resolves.toBe(incident);

    expect(link).toHaveBeenCalledTimes(1);
    expect(link).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      incidentId: incident.id,
      alertIds: alertIds,
      createdByUserId: USER_ID,
      declaredWithIncident: true,
      props: { isRoot: true },
    });
  });

  test("a user who declares the incident is recorded as the one who linked the alerts", async () => {
    await onCreateSuccess(
      { alertIdsToLink: [new ObjectID(ALERT_ID)] },
      createdIncident(),
      { userId: OTHER_USER_ID, tenantId: PROJECT_ID },
    );

    expect(link.mock.calls[0]![0].createdByUserId).toBe(OTHER_USER_ID);
  });

  test("a user caller is recorded as themselves, whatever the incident's createdByUserId says", async () => {
    await onCreateSuccess(
      { alertIdsToLink: [new ObjectID(ALERT_ID)] },
      createdIncident(USER_ID),
      { userId: OTHER_USER_ID, tenantId: PROJECT_ID },
    );

    expect(link.mock.calls[0]![0].createdByUserId).toBe(OTHER_USER_ID);
  });

  test("an API key cannot name somebody else as the one who linked the alerts", async () => {
    // The key sent data.createdByUserId naming another user.
    await onCreateSuccess(
      { alertIdsToLink: [new ObjectID(ALERT_ID)] },
      createdIncident(OTHER_USER_ID),
      apiKeyProps(),
    );

    expect(link).toHaveBeenCalledTimes(1);
    expect(link.mock.calls[0]![0].createdByUserId).toBeUndefined();
    // The links are still written as root, and still declared.
    expect(link.mock.calls[0]![0].props).toEqual({ isRoot: true });
    expect(link.mock.calls[0]![0].declaredWithIncident).toBe(true);
  });

  test("the links exist by the time the incident is returned", async () => {
    let linked: boolean = false;

    link.mockImplementation((async (): Promise<LinkAlertsToIncidentResult> => {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 5);
      });
      linked = true;
      return { linkedAlertIds: [], alreadyLinkedAlertIds: [], failed: [] };
    }) as never);

    await onCreateSuccess(
      { alertIdsToLink: [new ObjectID(ALERT_ID)] },
      createdIncident(),
    );

    expect(linked).toBe(true);
  });

  test("a link that throws never fails the incident", async () => {
    link.mockRejectedValue(new Error("database unavailable") as never);
    const incident: Incident = createdIncident();

    await expect(
      onCreateSuccess({ alertIdsToLink: [new ObjectID(ALERT_ID)] }, incident),
    ).resolves.toBe(incident);

    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining("Linking the alerts an incident was declared"),
      expect.anything(),
    );
  });

  test("alerts that could not be linked are logged, and the incident is still returned", async () => {
    link.mockResolvedValue({
      linkedAlertIds: [new ObjectID(ALERT_ID)],
      alreadyLinkedAlertIds: [],
      failed: [{ alertId: new ObjectID(ALERT_ID_2), message: "gone" }],
    } as never);
    const incident: Incident = createdIncident();

    await expect(
      onCreateSuccess(
        {
          alertIdsToLink: [new ObjectID(ALERT_ID), new ObjectID(ALERT_ID_2)],
        },
        incident,
      ),
    ).resolves.toBe(incident);

    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining("1 of 2 alerts could not be linked"),
      expect.anything(),
    );
  });

  test.each([
    ["no carry-forward", null],
    ["an undefined carry-forward", undefined],
    ["an empty list", { alertIdsToLink: [] }],
  ])(
    "an incident declared with %s links nothing",
    async (_label: string, carryForward: unknown) => {
      await onCreateSuccess(carryForward, createdIncident(USER_ID, true));
      await settle();

      expect(link).not.toHaveBeenCalled();
      expect(summary).not.toHaveBeenCalled();
      expect(copyOwners).not.toHaveBeenCalled();
    },
  );

  describe("one announcement instead of one per alert", () => {
    const alertIds: Array<ObjectID> = [
      new ObjectID(ALERT_ID),
      new ObjectID(ALERT_ID_2),
    ];

    function order(name: string): number {
      return chain[name]!.mock.invocationCallOrder[0]!;
    }

    test("the alerts are announced once, after Incident Created and the workspace channels", async () => {
      await onCreateSuccess(
        { alertIdsToLink: alertIds },
        createdIncident(USER_ID),
      );
      await settle();

      expect(summary).toHaveBeenCalledTimes(1);
      expect(summary).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
        alertIds: alertIds,
        actorUserId: USER_ID,
      });

      const summaryOrder: number = summary.mock.invocationCallOrder[0]!;

      expect(order("handleIncidentWorkspaceOperationsAsync")).toBeLessThan(
        summaryOrder,
      );
      expect(order("createIncidentFeedAsync")).toBeLessThan(summaryOrder);
      // ...and it is the very next step, ahead of the rest of the chain.
      expect(summaryOrder).toBeLessThan(
        order("handleIncidentStateChangeAsync"),
      );
    });

    test("the links themselves are written without incident-side entries", async () => {
      await onCreateSuccess(
        { alertIdsToLink: alertIds },
        createdIncident(USER_ID),
      );

      expect(link.mock.calls[0]![0].declaredWithIncident).toBe(true);
    });

    test("a user's announcement is theirs, an API key's names nobody", async () => {
      await onCreateSuccess(
        { alertIdsToLink: alertIds },
        createdIncident(USER_ID),
        { userId: OTHER_USER_ID, tenantId: PROJECT_ID },
      );
      await settle();

      expect(summary.mock.calls[0]![0].actorUserId).toBe(OTHER_USER_ID);

      summary.mockClear();

      await onCreateSuccess(
        { alertIdsToLink: alertIds },
        createdIncident(OTHER_USER_ID),
        apiKeyProps(),
      );
      await settle();

      expect(summary).toHaveBeenCalledTimes(1);
      expect(summary.mock.calls[0]![0].actorUserId).toBeUndefined();
    });

    test("it does not wait for the links", async () => {
      let finishLinking: () => void = (): void => {
        // replaced once linking starts
      };

      link.mockImplementation(
        (async (): Promise<LinkAlertsToIncidentResult> => {
          await new Promise<void>((resolve: () => void) => {
            finishLinking = resolve;
          });
          return { linkedAlertIds: [], alreadyLinkedAlertIds: [], failed: [] };
        }) as never,
      );

      const created: Promise<Incident> = onCreateSuccess(
        { alertIdsToLink: alertIds },
        createdIncident(USER_ID),
      );
      await settle();

      // Still linking, already announced.
      expect(summary).toHaveBeenCalledTimes(1);

      finishLinking();
      await created;
    });

    test("an announcement that fails is logged, and the rest of the chain carries on", async () => {
      summary.mockRejectedValue(new Error("slack is down") as never);

      const incident: Incident = createdIncident(USER_ID);

      await expect(
        onCreateSuccess({ alertIdsToLink: alertIds }, incident),
      ).resolves.toBe(incident);
      await settle();

      expect(errorLog).toHaveBeenCalledWith(
        expect.stringContaining(
          "Announcing the alerts an incident was declared from failed",
        ),
        expect.anything(),
      );
      expect(chain["handleIncidentStateChangeAsync"]).toHaveBeenCalledTimes(1);
    });

    test("a failed Incident Created entry does not stop the announcement", async () => {
      chain["createIncidentFeedAsync"]!.mockRejectedValue(
        new Error("feed failed") as never,
      );

      await onCreateSuccess(
        { alertIdsToLink: alertIds },
        createdIncident(USER_ID),
      );
      await settle();

      expect(summary).toHaveBeenCalledTimes(1);
    });
  });

  describe("a private incident takes on the alerts' owners", () => {
    const alertIds: Array<ObjectID> = [
      new ObjectID(ALERT_ID),
      new ObjectID(ALERT_ID_2),
    ];

    function order(name: string): number {
      return chain[name]!.mock.invocationCallOrder[0]!;
    }

    test("the owners are added once the incident's channels exist, after Incident Created and the announcement", async () => {
      await onCreateSuccess(
        { alertIdsToLink: alertIds },
        createdIncident(USER_ID, true),
        userProps(Permission.ProjectMember),
      );
      await settle();

      expect(copyOwners).toHaveBeenCalledTimes(1);
      expect(copyOwners).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
        alertIds: alertIds,
      });

      /*
       * The owners' own hooks invite them to the incident's Slack / Teams
       * channels, so the copy must come after the step that records them.
       */
      const copyOrder: number = copyOwners.mock.invocationCallOrder[0]!;

      expect(order("handleIncidentWorkspaceOperationsAsync")).toBeLessThan(
        copyOrder,
      );
      expect(order("createIncidentFeedAsync")).toBeLessThan(copyOrder);
      expect(summary.mock.invocationCallOrder[0]!).toBeLessThan(copyOrder);
      expect(copyOrder).toBeLessThan(order("handleIncidentStateChangeAsync"));
    });

    test("an incident a privacy rule makes private takes on the owners too", async () => {
      jest
        .spyOn(IncidentPrivacyRuleEngineService, "applyRulesToIncident")
        .mockImplementation((async (incident: Incident): Promise<boolean> => {
          incident.isPrivate = true;
          return true;
        }) as never);

      await onCreateSuccess(
        { alertIdsToLink: alertIds },
        createdIncident(USER_ID, false),
      );
      await settle();

      expect(copyOwners).toHaveBeenCalledTimes(1);
    });

    test("a public incident keeps its owners as they are", async () => {
      await onCreateSuccess(
        { alertIdsToLink: alertIds },
        createdIncident(USER_ID, false),
      );
      await settle();

      expect(copyOwners).not.toHaveBeenCalled();
    });

    test("an incident declared without alerts never copies owners", async () => {
      await onCreateSuccess(null, createdIncident(USER_ID, true));
      await settle();

      expect(copyOwners).not.toHaveBeenCalled();
    });

    test("the owners are added even when linking fails", async () => {
      link.mockRejectedValue(new Error("database unavailable") as never);

      await onCreateSuccess(
        { alertIdsToLink: alertIds },
        createdIncident(USER_ID, true),
      );
      await settle();

      expect(copyOwners).toHaveBeenCalledTimes(1);
    });

    test("a failure adding them is logged, and the rest of the chain carries on", async () => {
      copyOwners.mockRejectedValue(new Error("owners failed") as never);
      const incident: Incident = createdIncident(USER_ID, true);

      await expect(
        onCreateSuccess({ alertIdsToLink: alertIds }, incident),
      ).resolves.toBe(incident);
      await settle();

      expect(errorLog).toHaveBeenCalledWith(
        expect.stringContaining(
          "Adding the owners of the alerts a private incident was declared from failed",
        ),
        expect.anything(),
      );
      expect(chain["handleIncidentStateChangeAsync"]).toHaveBeenCalledTimes(1);
    });
  });

  describe("linking waits for the privacy rules", () => {
    test("the links are written only once the privacy rules have run", async () => {
      let rulesApplied: boolean = false;
      let rulesAppliedWhenLinking: boolean | null = null;

      jest
        .spyOn(IncidentPrivacyRuleEngineService, "applyRulesToIncident")
        .mockImplementation((async (incident: Incident): Promise<boolean> => {
          await new Promise<void>((resolve: () => void) => {
            setTimeout(resolve, 5);
          });
          incident.isPrivate = true;
          rulesApplied = true;
          return true;
        }) as never);

      link.mockImplementation(
        (async (): Promise<LinkAlertsToIncidentResult> => {
          rulesAppliedWhenLinking = rulesApplied;
          return { linkedAlertIds: [], alreadyLinkedAlertIds: [], failed: [] };
        }) as never,
      );

      await onCreateSuccess(
        { alertIdsToLink: [new ObjectID(ALERT_ID)] },
        createdIncident(USER_ID),
      );

      expect(link).toHaveBeenCalledTimes(1);
      expect(rulesAppliedWhenLinking).toBe(true);
    });

    test("an incident declared without alerts does not wait for the privacy rules", async () => {
      let finishRules: () => void = (): void => {
        // replaced once the rules start
      };

      jest
        .spyOn(IncidentPrivacyRuleEngineService, "applyRulesToIncident")
        .mockImplementation((async (): Promise<boolean> => {
          await new Promise<void>((resolve: () => void) => {
            finishRules = resolve;
          });
          return false;
        }) as never);

      const incident: Incident = createdIncident(USER_ID);

      // Resolves while the rules are still running.
      await expect(onCreateSuccess(null, incident)).resolves.toBe(incident);

      finishRules();
    });
  });
});

describe("declaring an incident from alerts, through the real link service", () => {
  let incidentFeed: jest.SpyInstance;
  let alertFeed: jest.SpyInstance;
  let save: jest.Mock;

  const ALERT_TITLES: Record<string, string> = {
    [ALERT_ID]: "Checkout p95 latency is high",
    [ALERT_ID_2]: "Payroll DB credentials exposed",
  };

  function alertRow(id: string, number: number, isPrivate: boolean): Alert {
    const alert: Alert = new Alert();
    alert._id = id;
    alert.alertNumber = number;
    alert.title = ALERT_TITLES[id]!;
    alert.isPrivate = isPrivate;
    return alert;
  }

  beforeEach(() => {
    jest.spyOn(ProductAnalytics, "captureForUser").mockImplementation((() => {
      // no analytics in tests
    }) as never);

    const incident: Incident = new Incident();
    incident._id = INCIDENT_ID.toString();
    incident.projectId = PROJECT_ID;
    incident.incidentNumber = 17;
    incident.incidentNumberWithPrefix = "INC-17";
    incident.title = "Checkout is failing";
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(incident as never);

    const service: Record<string, unknown> =
      IncidentService as unknown as Record<string, unknown>;
    for (const method of [
      "handleIncidentWorkspaceOperationsAsync",
      "createIncidentFeedAsync",
      "handleIncidentStateChangeAsync",
      "disableActiveMonitoringIfManualIncident",
      "refreshReminderSchedule",
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
      .mockResolvedValue(undefined as never);
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

    // The link table, without a database.
    save = jest.fn(async (row: IncidentAlert): Promise<IncidentAlert> => {
      row._id = ObjectID.generate().toString();
      return row;
    });
    jest
      .spyOn(IncidentAlertService, "getRepository")
      .mockReturnValue({ save: save } as never);
    jest
      .spyOn(IncidentAlertService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);
    jest
      .spyOn(
        ProjectScopedReferenceValidator,
        "validateReferencesBelongToProject",
      )
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(IncidentAlertService, "onTriggerWorkflow")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(IncidentAlertService, "onTriggerRealtime")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(IncidentAlertService, "syncAlertWithLinkedIncidentState")
      .mockResolvedValue(undefined as never);

    // The alerts: #3 is public, #4 is private.
    jest.spyOn(AlertService, "findOneById").mockImplementation((async (args: {
      id: ObjectID;
    }): Promise<Alert> => {
      return args.id.toString() === ALERT_ID
        ? alertRow(ALERT_ID, 3, false)
        : alertRow(ALERT_ID_2, 4, true);
    }) as never);
    jest
      .spyOn(AlertService, "findBy")
      .mockResolvedValue([
        alertRow(ALERT_ID_2, 4, true),
        alertRow(ALERT_ID, 3, false),
      ] as never);
    jest
      .spyOn(AlertService, "getAlertLinkInDashboard")
      .mockImplementation((async (
        _projectId: ObjectID,
        alertId: ObjectID,
      ): Promise<URL> => {
        return URL.fromString(
          `https://oneuptime.example/alerts/${alertId.toString()}`,
        );
      }) as never);
    jest
      .spyOn(IncidentService, "getIncidentLinkInDashboard")
      .mockResolvedValue(
        URL.fromString("https://oneuptime.example/incident") as never,
      );

    incidentFeed = jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockResolvedValue(undefined as never);
    alertFeed = jest
      .spyOn(AlertFeedService, "createAlertFeedItem")
      .mockResolvedValue(undefined as never);
  });

  function declare(props: DatabaseCommonInteractionProps): Promise<Incident> {
    const incident: Incident = new Incident();
    incident._id = INCIDENT_ID.toString();
    incident.projectId = PROJECT_ID;
    incident.title = "Checkout is failing";
    incident.createdByUserId = USER_ID;
    incident.declaredAt = OneUptimeDate.getCurrentDate();

    return callHook<Incident>(
      IncidentService,
      "onCreateSuccess",
      {
        createBy: { data: incident, props: props },
        carryForward: {
          alertIdsToLink: [new ObjectID(ALERT_ID), new ObjectID(ALERT_ID_2)],
        },
      },
      incident,
    );
  }

  test("every alert is linked, and the incident gets exactly one entry and one post", async () => {
    await declare(userProps(Permission.ProjectMember));

    // Both links were written before the incident was returned.
    expect(save).toHaveBeenCalledTimes(2);
    expect(
      save.mock.calls.map((call: Array<IncidentAlert>) => {
        return call[0]!.createdByUserId?.toString();
      }),
    ).toEqual([USER_ID.toString(), USER_ID.toString()]);

    await settle();

    // No per-link "Alert Linked" entry or post: just the one summary.
    expect(incidentFeed).toHaveBeenCalledTimes(1);

    const entry: Record<string, unknown> = incidentFeed.mock.calls[0]![0];

    expect(entry["incidentFeedEventType"]).toBe(
      IncidentFeedEventType.AlertLinked,
    );
    expect(entry["workspaceNotification"]).toEqual({
      sendWorkspaceNotification: true,
      notifyUserId: USER_ID,
    });
    expect(entry["feedInfoInMarkdown"]).toBe(
      [
        "🔗 Declared from 2 alerts:",
        "",
        `- **[Alert #3](https://oneuptime.example/alerts/${ALERT_ID})**: Checkout p95 latency is high`,
        `- **[Alert #4](https://oneuptime.example/alerts/${ALERT_ID_2})** (private alert)`,
      ].join("\n"),
    );

    // Each alert still records that it was linked, without a post.
    expect(alertFeed).toHaveBeenCalledTimes(2);
    for (const call of alertFeed.mock.calls) {
      const alertEntry: Record<string, unknown> = call[0];
      expect(alertEntry["alertFeedEventType"]).toBe(
        AlertFeedEventType.LinkedToIncident,
      );
      expect(alertEntry["workspaceNotification"]).toBeUndefined();
      expect(String(alertEntry["userId"])).toBe(USER_ID.toString());
    }
  });

  test("links made one by one outside a declaration each get their own incident entry", async () => {
    await IncidentAlertService.linkAlertsToIncident({
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
      alertIds: [new ObjectID(ALERT_ID), new ObjectID(ALERT_ID_2)],
      createdByUserId: USER_ID,
      props: { isRoot: true },
    });

    expect(incidentFeed).toHaveBeenCalledTimes(2);
    expect(alertFeed).toHaveBeenCalledTimes(2);
    expect(
      incidentFeed.mock.calls.map((call: Array<Record<string, unknown>>) => {
        return (call[0]!["workspaceNotification"] as Record<string, unknown>)[
          "sendWorkspaceNotification"
        ];
      }),
    ).toEqual([true, true]);
  });
});

describe("IncidentStateTimelineService.onCreateSuccess hands the new state to the cascade", () => {
  let cascade: jest.SpyInstance;
  let release: jest.SpyInstance;
  let updateIncident: jest.SpyInstance;
  let stateFeed: jest.SpyInstance;

  beforeEach(() => {
    const state: IncidentState = new IncidentState();
    state._id = ACKNOWLEDGED_STATE_ID;
    state.name = "Acknowledged";
    state.isAcknowledgedState = true;
    state.isResolvedState = false;

    jest
      .spyOn(IncidentStateService, "findOneBy")
      .mockResolvedValue(state as never);
    updateIncident = jest
      .spyOn(IncidentService, "updateOneBy")
      .mockResolvedValue(1 as never);
    jest.spyOn(IncidentService, "getIncidentNumber").mockResolvedValue({
      number: 17,
      numberWithPrefix: "INC-17",
    } as never);
    jest
      .spyOn(IncidentService, "getIncidentLinkInDashboard")
      .mockResolvedValue(
        URL.fromString("https://oneuptime.example/incident") as never,
      );
    jest
      .spyOn(IncidentService, "refreshIncidentMetrics")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(IncidentMeasurementValueService, "recomputeForIncident")
      .mockResolvedValue(undefined as never);
    stateFeed = jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockResolvedValue(undefined as never);

    const service: Record<string, () => Promise<unknown>> =
      IncidentStateTimelineService as unknown as Record<
        string,
        () => Promise<unknown>
      >;
    jest
      .spyOn(service, "trackSlaStateChange")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(service, "isLastIncidentState")
      .mockResolvedValue(false as never);

    release = jest
      .spyOn(Semaphore, "release")
      .mockResolvedValue(undefined as never);

    cascade = jest
      .spyOn(IncidentAlertService, "cascadeIncidentStateToLinkedAlerts")
      .mockResolvedValue(undefined as never);
  });

  function timeline(endsAt?: Date): IncidentStateTimeline {
    const row: IncidentStateTimeline = new IncidentStateTimeline();
    row._id = ObjectID.generate().toString();
    row.projectId = PROJECT_ID;
    row.incidentId = INCIDENT_ID;
    row.incidentStateId = new ObjectID(ACKNOWLEDGED_STATE_ID);
    row.startsAt = OneUptimeDate.getCurrentDate();
    if (endsAt) {
      row.endsAt = endsAt;
    }
    return row;
  }

  function onCreateSuccess(
    createdItem: IncidentStateTimeline,
    mutex: SemaphoreMutex | null = null,
  ): Promise<IncidentStateTimeline> {
    return callHook<IncidentStateTimeline>(
      IncidentStateTimelineService,
      "onCreateSuccess",
      {
        createBy: { data: createdItem, props: { isRoot: true } },
        carryForward: {
          statusTimelineBeforeThisStatus: null,
          statusTimelineAfterThisStatus: null,
          publicNote: undefined,
          mutex: mutex,
        },
      },
      createdItem,
    );
  }

  test("the incident's new current state is cascaded to its linked alerts", async () => {
    await onCreateSuccess(timeline());

    expect(cascade).toHaveBeenCalledTimes(1);

    const args: {
      projectId: ObjectID;
      incidentId: ObjectID;
      incidentStateId: ObjectID;
    } = cascade.mock.calls[0]![0];

    expect(args.projectId).toBe(PROJECT_ID);
    expect(args.incidentId).toBe(INCIDENT_ID);
    expect(args.incidentStateId.toString()).toBe(ACKNOWLEDGED_STATE_ID);
  });

  test("the cascade starts only after the incident's mutex is released", async () => {
    const mutex: SemaphoreMutex = {
      key: INCIDENT_ID.toString(),
    } as unknown as SemaphoreMutex;

    await onCreateSuccess(timeline(), mutex);

    expect(release).toHaveBeenCalledWith(mutex);
    expect(release.mock.invocationCallOrder[0]!).toBeLessThan(
      cascade.mock.invocationCallOrder[0]!,
    );
  });

  test("a back-dated row (one with an end) is not the current state and cascades nothing", async () => {
    await onCreateSuccess(timeline(OneUptimeDate.getCurrentDate()));

    expect(cascade).not.toHaveBeenCalled();
    // ...and, as before, it does not become the incident's current state.
    expect(updateIncident).not.toHaveBeenCalled();
  });

  test("the state change neither waits for nor fails with the cascade", async () => {
    let finished: boolean = false;

    cascade.mockImplementation((async (): Promise<void> => {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 20);
      });
      finished = true;
      throw new Error("cascade failed");
    }) as never);

    const row: IncidentStateTimeline = timeline();

    await expect(onCreateSuccess(row)).resolves.toBe(row);
    expect(finished).toBe(false);

    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 40);
    });

    expect(finished).toBe(true);
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining("carrying the incident state over"),
      expect.anything(),
    );
  });

  test("the rest of the hook is unchanged: the state is stored and announced", async () => {
    await onCreateSuccess(timeline());

    expect(updateIncident).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { currentIncidentStateId: new ObjectID(ACKNOWLEDGED_STATE_ID) },
      }),
    );
    expect(stateFeed).toHaveBeenCalledTimes(1);
  });
});
