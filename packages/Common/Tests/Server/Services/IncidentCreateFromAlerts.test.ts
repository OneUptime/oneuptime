import Semaphore, {
  SemaphoreMutex,
} from "../../../Server/Infrastructure/Semaphore";
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
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../../Types/Date";
import { INCIDENT_ALERT_IDS_TO_LINK_KEY } from "../../../Types/Incident/IncidentAlertLink";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
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

    link = jest
      .spyOn(IncidentAlertService, "linkAlertsToIncident")
      .mockResolvedValue({
        linkedAlertIds: [],
        alreadyLinkedAlertIds: [],
        failed: [],
      } as never);
  });

  function createdIncident(createdByUserId?: ObjectID): Incident {
    const incident: Incident = new Incident();
    incident._id = INCIDENT_ID.toString();
    incident.projectId = PROJECT_ID;
    incident.title = "Checkout is failing";
    incident.declaredAt = OneUptimeDate.getCurrentDate();
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
      props: { isRoot: true },
    });
  });

  test("the declaring user falls back to the request's user", async () => {
    await onCreateSuccess(
      { alertIdsToLink: [new ObjectID(ALERT_ID)] },
      createdIncident(),
      { userId: OTHER_USER_ID, tenantId: PROJECT_ID },
    );

    expect(link.mock.calls[0]![0].createdByUserId).toBe(OTHER_USER_ID);
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
      await onCreateSuccess(carryForward, createdIncident());

      expect(link).not.toHaveBeenCalled();
    },
  );
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
