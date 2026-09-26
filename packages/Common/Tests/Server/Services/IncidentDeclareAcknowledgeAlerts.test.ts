import AlertService from "../../../Server/Services/AlertService";
import AlertStateService from "../../../Server/Services/AlertStateService";
import AutoRemediationRuleEngineService from "../../../Server/Services/AutoRemediationRuleEngineService";
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import IncidentAlertService, {
  AcknowledgeDeclaredAlertsResult,
  LinkAlertsToIncidentResult,
} from "../../../Server/Services/IncidentAlertService";
import IncidentGroupingEngineService from "../../../Server/Services/IncidentGroupingEngineService";
import IncidentLabelRuleEngineService from "../../../Server/Services/IncidentLabelRuleEngineService";
import IncidentOnCallRuleEngineService from "../../../Server/Services/IncidentOnCallRuleEngineService";
import IncidentOwnerRuleEngineService from "../../../Server/Services/IncidentOwnerRuleEngineService";
import IncidentPrivacyRuleEngineService from "../../../Server/Services/IncidentPrivacyRuleEngineService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentSlaService from "../../../Server/Services/IncidentSlaService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import ProjectService from "../../../Server/Services/ProjectService";
import RunbookRuleEngineService from "../../../Server/Services/RunbookRuleEngineService";
import UserService from "../../../Server/Services/UserService";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import AIIncidentInvestigationRunner from "../../../Server/Utils/AI/SRE/IncidentInvestigationRunner";
import AlertStateChangeAuthorization from "../../../Server/Utils/Alert/AlertStateChangeAuthorization";
import ProjectScopedReferenceValidator from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import logger from "../../../Server/Utils/Logger";
import ProductAnalytics from "../../../Server/Utils/ProductAnalytics";
import SloRecordReferenceValidator from "../../../Server/Utils/Slo/SloRecordReferenceValidator";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import {
  INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY,
  INCIDENT_ALERT_IDS_TO_LINK_KEY,
} from "../../../Types/Incident/IncidentAlertLink";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * Declaring an incident from alerts and acknowledging those alerts in the
 * same request (miscDataProps.acknowledgeAlertsToLink), at the two places it
 * hooks into IncidentService:
 *
 * - onBeforeCreate validates the alert ids first and then the request to
 *   acknowledge them (with the validated ids), both BEFORE the incident
 *   number is taken, so an impossible request neither burns a number nor
 *   leaves an incident behind whose alerts keep paging. The project's
 *   Acknowledged alert state is carried forward;
 * - onCreateSuccess acknowledges the alerts once the links have been written,
 *   credited to the declaring user, without waiting for it and without ever
 *   failing the incident because of it.
 *
 * Everything around those hooks is stubbed; the acknowledgement itself
 * (IncidentAlertService.acknowledgeAlertsDeclaredWithIncident) has its own
 * tests.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0194c3a9-0000-4000-8000-000000000001",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "0194c3a9-0000-4000-8000-0000000000a1",
);
const ALERT_ID: string = "0194c3a9-0000-4000-8000-0000000000b1";
const ALERT_ID_2: string = "0194c3a9-0000-4000-8000-0000000000b2";
const ALERT_ID_3: string = "0194c3a9-0000-4000-8000-0000000000b3";
const USER_ID: ObjectID = new ObjectID("0194c3a9-0000-4000-8000-0000000000c1");
const OTHER_USER_ID: ObjectID = new ObjectID(
  "0194c3a9-0000-4000-8000-0000000000c2",
);
const CREATED_STATE_ID: string = "0194c3a9-0000-4000-8000-0000000000d1";
const ACKNOWLEDGED_ALERT_STATE_ID: string =
  "0194c3a9-0000-4000-8000-0000000000f2";
const SEVERITY_ID: ObjectID = new ObjectID(
  "0194c3a9-0000-4000-8000-0000000000e1",
);

const NO_ALERTS_MESSAGE: string =
  "acknowledgeAlertsToLink only applies when the incident is declared from alerts: send the alert ids in alertIdsToLink.";
const NOT_A_BOOLEAN_MESSAGE: string =
  "acknowledgeAlertsToLink must be true or false.";
const NO_ACKNOWLEDGED_STATE_MESSAGE: string =
  "This project has no Acknowledged alert state, so the alerts cannot be acknowledged. Declare the incident without acknowledging them, or add an Acknowledged state in the alert settings.";
const MAY_NOT_ACKNOWLEDGE_MESSAGE: string =
  "You do not have permission to acknowledge one or more of these alerts. Declare the incident without acknowledging them, or ask a project admin for permission.";
const ACKNOWLEDGE_FAILED_LOG_PREFIX: string =
  "Acknowledging the alerts an incident was declared from failed in IncidentService.onCreateSuccess: ";

// What onBeforeCreate hands to onCreateSuccess when declaring from alerts.
type CarriedForward = {
  alertIdsToLink: Array<ObjectID>;
  acknowledgedAlertStateId: ObjectID | null;
};

type ValidateAcknowledgeArgs = {
  projectId: ObjectID | undefined;
  acknowledgeAlerts: unknown;
  alertIds: Array<ObjectID>;
  props: DatabaseCommonInteractionProps;
};

type AcknowledgeArgs = {
  projectId: ObjectID;
  incidentId: ObjectID;
  alertIds: Array<ObjectID>;
  linkedAlertIds: Array<ObjectID>;
  acknowledgedByUserId: ObjectID | undefined;
};

type LinkArgs = {
  alertIds: Array<ObjectID>;
  createdByUserId: ObjectID | undefined;
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

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = (): void => {
    // replaced below
  };
  let reject: (error: Error) => void = (): void => {
    // replaced below
  };
  const promise: Promise<T> = new Promise<T>(
    (res: (value: T) => void, rej: (error: Error) => void) => {
      resolve = res;
      reject = rej;
    },
  );
  return { promise: promise, resolve: resolve, reject: reject };
}

function ids(values: Array<ObjectID>): Array<string> {
  return values.map((value: ObjectID): string => {
    return value.toString();
  });
}

function emptyAcknowledgeResult(): AcknowledgeDeclaredAlertsResult {
  return {
    acknowledgedAlertIds: [],
    alreadyAcknowledgedAlertIds: [],
    leftToLinkedAlertSyncAlertIds: [],
    failed: [],
  };
}

function acknowledgedAlertState(): AlertState {
  const state: AlertState = new AlertState();
  state._id = ACKNOWLEDGED_ALERT_STATE_ID;
  return state;
}

let errorLog: jest.SpyInstance;

// The error log lines about acknowledging, whatever else the chain logs.
function acknowledgementErrorLogs(): Array<Array<unknown>> {
  return errorLog.mock.calls.filter((call: Array<unknown>): boolean => {
    return String(call[0]).toLowerCase().includes("acknowledg");
  });
}

beforeEach(() => {
  errorLog = jest.spyOn(logger, "error").mockImplementation((() => {
    // quiet
  }) as never);
});

afterEach(async () => {
  await settle();
  jest.restoreAllMocks();
});

// What onBeforeCreate reads besides the alerts, up to the incident number.
function stubBeforeCreate(): jest.SpyInstance {
  const createdState: IncidentState = new IncidentState();
  createdState._id = CREATED_STATE_ID;

  jest
    .spyOn(IncidentStateService, "findOneBy")
    .mockResolvedValue(createdState as never);
  jest
    .spyOn(ProjectScopedReferenceValidator, "validateReferencesBelongToProject")
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

  // The project's alerts: every id asked for exists.
  jest.spyOn(AlertService, "findBy").mockImplementation((async (args: {
    query: { _id: unknown };
  }): Promise<Array<Alert>> => {
    const alertIds: Array<string> = Object.values(
      (args.query._id as FindOperator<unknown>).objectLiteralParameters || {},
    )[0] as Array<string>;

    return alertIds.map((id: string) => {
      const alert: Alert = new Alert();
      alert._id = id;
      return alert;
    });
  }) as never);

  return jest
    .spyOn(ProjectService, "incrementAndGetIncidentCounter")
    .mockResolvedValue({ counter: 17, prefix: "INC-" } as never);
}

// The rest of onCreateSuccess: the un-awaited chain and the rule engines.
function stubCreateSuccessChain(): void {
  jest.spyOn(ProductAnalytics, "captureForUser").mockImplementation((() => {
    // no analytics in tests
  }) as never);

  const reRead: Incident = new Incident();
  reRead._id = INCIDENT_ID.toString();
  reRead.projectId = PROJECT_ID;
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

  jest
    .spyOn(IncidentAlertService, "createDeclaredFromAlertsFeedItem")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(IncidentAlertService, "copyAlertOwnersToIncident")
    .mockResolvedValue({ userIds: [], teamIds: [] } as never);
}

// By default every alert asked for is linked.
function stubLinking(): jest.SpyInstance {
  return jest
    .spyOn(IncidentAlertService, "linkAlertsToIncident")
    .mockImplementation((async (args: {
      alertIds: Array<ObjectID>;
    }): Promise<LinkAlertsToIncidentResult> => {
      return {
        linkedAlertIds: [...args.alertIds],
        alreadyLinkedAlertIds: [],
        failed: [],
      };
    }) as never);
}

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
  data: Incident = buildIncident(),
): Promise<OnCreate<Incident>> {
  return callHook<OnCreate<Incident>>(IncidentService, "onBeforeCreate", {
    data: data,
    miscDataProps: miscDataProps,
    props: props,
  });
}

function createdIncident(createdByUserId?: ObjectID): Incident {
  const incident: Incident = new Incident();
  incident._id = INCIDENT_ID.toString();
  incident.projectId = PROJECT_ID;
  incident.title = "Checkout is failing";
  incident.declaredAt = OneUptimeDate.getCurrentDate();
  incident.isPrivate = false;
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

function carried(
  alertIds: Array<ObjectID>,
  acknowledgedAlertStateId: ObjectID | null = new ObjectID(
    ACKNOWLEDGED_ALERT_STATE_ID,
  ),
): CarriedForward {
  return {
    alertIdsToLink: alertIds,
    acknowledgedAlertStateId: acknowledgedAlertStateId,
  };
}

describe("IncidentService.onBeforeCreate with a request to acknowledge the alerts", () => {
  let counter: jest.SpyInstance;
  let validateAlertIds: jest.SpyInstance;
  let validateAcknowledge: jest.SpyInstance;
  let findAcknowledgedState: jest.SpyInstance;
  let authorize: jest.SpyInstance;

  beforeEach(() => {
    counter = stubBeforeCreate();

    // Both validators run for real unless a test replaces them.
    validateAlertIds = jest.spyOn(
      IncidentAlertService,
      "validateAlertIdsForNewIncident",
    );
    validateAcknowledge = jest.spyOn(
      IncidentAlertService,
      "validateAcknowledgeAlertsForNewIncident",
    );

    findAcknowledgedState = jest
      .spyOn(AlertStateService, "findOneBy")
      .mockResolvedValue(acknowledgedAlertState() as never);
    authorize = jest
      .spyOn(AlertStateChangeAuthorization, "assertCanChangeStateOfAlerts")
      .mockResolvedValue(undefined as never);
  });

  function validateAcknowledgeArgs(): ValidateAcknowledgeArgs {
    expect(validateAcknowledge).toHaveBeenCalledTimes(1);
    return validateAcknowledge.mock.calls[0]![0] as ValidateAcknowledgeArgs;
  }

  test("without miscDataProps the validator hears no request, and nothing is carried forward", async () => {
    const props: DatabaseCommonInteractionProps = userProps(
      Permission.ProjectMember,
    );

    const result: OnCreate<Incident> = await onBeforeCreate(undefined, props);

    const args: ValidateAcknowledgeArgs = validateAcknowledgeArgs();

    expect(args.acknowledgeAlerts).toBeUndefined();
    expect(args.alertIds).toEqual([]);
    expect(args.projectId!.toString()).toBe(PROJECT_ID.toString());
    expect(args.props).toBe(props);

    expect(result.carryForward).toBeNull();
    expect(findAcknowledgedState).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
    expect(counter).toHaveBeenCalledTimes(1);
  });

  test("alerts without the key are linked but not acknowledged: acknowledgedAlertStateId is null", async () => {
    const props: DatabaseCommonInteractionProps = userProps(
      Permission.ProjectMember,
    );

    const result: OnCreate<Incident> = await onBeforeCreate(
      { [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [ALERT_ID, ALERT_ID_2] },
      props,
    );

    const args: ValidateAcknowledgeArgs = validateAcknowledgeArgs();

    expect(args.acknowledgeAlerts).toBeUndefined();
    expect(ids(args.alertIds)).toEqual([ALERT_ID, ALERT_ID_2]);
    expect(args.props).toBe(props);

    const carriedForward: CarriedForward =
      result.carryForward as CarriedForward;

    expect(ids(carriedForward.alertIdsToLink)).toEqual([ALERT_ID, ALERT_ID_2]);
    expect(carriedForward.acknowledgedAlertStateId).toBeNull();

    // Not asked to acknowledge: no state lookup and no per-alert check.
    expect(findAcknowledgedState).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
    expect(counter).toHaveBeenCalledTimes(1);
    expect(result.createBy.data.incidentNumber).toBe(17);
  });

  test.each([
    ["false", false],
    ["null", null],
  ])(
    "a %s acknowledgeAlertsToLink links the alerts without acknowledging them",
    async (_label: string, value: boolean | null) => {
      const result: OnCreate<Incident> = await onBeforeCreate({
        [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [ALERT_ID],
        [INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY]: value,
      });

      expect(validateAcknowledgeArgs().acknowledgeAlerts).toBe(value);

      const carriedForward: CarriedForward =
        result.carryForward as CarriedForward;

      expect(ids(carriedForward.alertIdsToLink)).toEqual([ALERT_ID]);
      expect(carriedForward.acknowledgedAlertStateId).toBeNull();
      expect(findAcknowledgedState).not.toHaveBeenCalled();
      expect(authorize).not.toHaveBeenCalled();
      expect(counter).toHaveBeenCalledTimes(1);
    },
  );

  test("a false acknowledgeAlertsToLink without alerts is no request at all", async () => {
    const result: OnCreate<Incident> = await onBeforeCreate({
      [INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY]: false,
    });

    expect(result.carryForward).toBeNull();
    expect(validateAlertIds).not.toHaveBeenCalled();
    expect(counter).toHaveBeenCalledTimes(1);
  });

  test("true with alerts carries the validated alert ids and the project's Acknowledged alert state", async () => {
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
        [INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY]: true,
      },
      props,
    );

    const carriedForward: CarriedForward =
      result.carryForward as CarriedForward;

    expect(Object.keys(carriedForward).sort()).toEqual([
      "acknowledgedAlertStateId",
      "alertIdsToLink",
    ]);
    expect(ids(carriedForward.alertIdsToLink)).toEqual([ALERT_ID, ALERT_ID_2]);
    expect(carriedForward.acknowledgedAlertStateId).toBeInstanceOf(ObjectID);
    expect(carriedForward.acknowledgedAlertStateId!.toString()).toBe(
      ACKNOWLEDGED_ALERT_STATE_ID,
    );

    // The project's Acknowledged state, read as root.
    expect(findAcknowledgedState).toHaveBeenCalledTimes(1);
    expect(findAcknowledgedState).toHaveBeenCalledWith({
      query: {
        projectId: PROJECT_ID,
        isAcknowledgedState: true,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    // The caller may change the state of every one of the validated alerts.
    expect(authorize).toHaveBeenCalledTimes(1);

    const authorizeArgs: {
      projectId: ObjectID;
      alertIds: Array<ObjectID>;
      props: DatabaseCommonInteractionProps;
    } = authorize.mock.calls[0]![0];

    expect(authorizeArgs.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(ids(authorizeArgs.alertIds)).toEqual([ALERT_ID, ALERT_ID_2]);
    expect(authorizeArgs.props).toBe(props);

    expect(counter).toHaveBeenCalledTimes(1);
    expect(result.createBy.data.incidentNumber).toBe(17);
    expect(result.createBy.data.incidentNumberWithPrefix).toBe("INC-17");
  });

  test("the alert ids are validated first, then the acknowledgement with the validated ids, then the number is taken", async () => {
    const props: DatabaseCommonInteractionProps = userProps(
      Permission.ProjectMember,
    );

    await onBeforeCreate(
      {
        [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [
          ` ${ALERT_ID_2} `,
          ALERT_ID,
          ALERT_ID_2.toUpperCase(),
        ],
        [INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY]: true,
      },
      props,
    );

    expect(validateAlertIds).toHaveBeenCalledTimes(1);

    const validated: Array<ObjectID> = await (validateAlertIds.mock.results[0]!
      .value as Promise<Array<ObjectID>>);

    expect(ids(validated)).toEqual([ALERT_ID_2, ALERT_ID]);

    const args: ValidateAcknowledgeArgs = validateAcknowledgeArgs();

    // Not the raw request: the trimmed, deduplicated, checked ids.
    expect(ids(args.alertIds)).toEqual(ids(validated));
    expect(args.acknowledgeAlerts).toBe(true);
    expect(args.projectId!.toString()).toBe(PROJECT_ID.toString());
    expect(args.props).toBe(props);

    const alertIdsOrder: number = validateAlertIds.mock.invocationCallOrder[0]!;
    const acknowledgeOrder: number =
      validateAcknowledge.mock.invocationCallOrder[0]!;

    expect(alertIdsOrder).toBeLessThan(acknowledgeOrder);
    expect(acknowledgeOrder).toBeLessThan(counter.mock.invocationCallOrder[0]!);
    expect(authorize.mock.invocationCallOrder[0]!).toBeLessThan(
      counter.mock.invocationCallOrder[0]!,
    );
  });

  test("the acknowledged state the validator returns is what is carried forward", async () => {
    const stateId: ObjectID = ObjectID.generate();
    validateAcknowledge.mockResolvedValue(stateId as never);

    const result: OnCreate<Incident> = await onBeforeCreate({
      [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [ALERT_ID],
      [INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY]: true,
    });

    expect(
      (result.carryForward as CarriedForward).acknowledgedAlertStateId,
    ).toBe(stateId);
  });

  test.each([
    ["no alert ids at all", undefined],
    ["a null list of alert ids", null],
  ])(
    "true with %s is a 400, before an incident number is taken",
    async (_label: string, alertIds: null | undefined) => {
      const miscDataProps: JSONObject = {
        [INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY]: true,
      };

      if (alertIds !== undefined) {
        miscDataProps[INCIDENT_ALERT_IDS_TO_LINK_KEY] = alertIds;
      }

      const created: Promise<OnCreate<Incident>> =
        onBeforeCreate(miscDataProps);

      await expect(created).rejects.toBeInstanceOf(BadDataException);
      await expect(created).rejects.toThrow(NO_ALERTS_MESSAGE);

      expect(validateAlertIds).not.toHaveBeenCalled();
      expect(validateAcknowledgeArgs().alertIds).toEqual([]);
      expect(findAcknowledgedState).not.toHaveBeenCalled();
      expect(authorize).not.toHaveBeenCalled();
      expect(counter).not.toHaveBeenCalled();
    },
  );

  test.each([
    ["the string 'true'", "true"],
    ["the number 1", 1],
    ["an object", { acknowledge: true }],
    ["a list", [true]],
  ])(
    "%s is not a boolean: a 400, before an incident number is taken",
    async (_label: string, value: unknown) => {
      const created: Promise<OnCreate<Incident>> = onBeforeCreate({
        [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [ALERT_ID],
        [INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY]: value as never,
      });

      await expect(created).rejects.toBeInstanceOf(BadDataException);
      await expect(created).rejects.toThrow(NOT_A_BOOLEAN_MESSAGE);

      expect(findAcknowledgedState).not.toHaveBeenCalled();
      expect(authorize).not.toHaveBeenCalled();
      expect(counter).not.toHaveBeenCalled();
    },
  );

  test("a project without an Acknowledged alert state is a 400, before an incident number is taken", async () => {
    findAcknowledgedState.mockResolvedValue(null as never);

    const created: Promise<OnCreate<Incident>> = onBeforeCreate({
      [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [ALERT_ID],
      [INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY]: true,
    });

    await expect(created).rejects.toBeInstanceOf(BadDataException);
    await expect(created).rejects.toThrow(NO_ACKNOWLEDGED_STATE_MESSAGE);

    expect(findAcknowledgedState).toHaveBeenCalledTimes(1);
    expect(authorize).not.toHaveBeenCalled();
    expect(counter).not.toHaveBeenCalled();
  });

  test("a caller who may not change the alerts' states is a 400, before an incident number is taken", async () => {
    authorize.mockRejectedValue(
      new NotAuthorizedException(
        "You do not have permission to change the state of one or more of these alerts.",
      ) as never,
    );

    const created: Promise<OnCreate<Incident>> = onBeforeCreate({
      [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [ALERT_ID, ALERT_ID_2],
      [INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY]: true,
    });

    await expect(created).rejects.toBeInstanceOf(BadDataException);
    await expect(created).rejects.toThrow(MAY_NOT_ACKNOWLEDGE_MESSAGE);

    expect(authorize).toHaveBeenCalledTimes(1);
    expect(counter).not.toHaveBeenCalled();
  });

  test("an unexpected failure while checking keeps its own error, and no incident number is taken", async () => {
    const failure: Error = new Error("database unavailable");
    authorize.mockRejectedValue(failure as never);

    await expect(
      onBeforeCreate({
        [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [ALERT_ID],
        [INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY]: true,
      }),
    ).rejects.toBe(failure);

    expect(counter).not.toHaveBeenCalled();
  });

  test("any refusal from the acknowledgement validator rejects the create before the number is taken", async () => {
    const refusal: BadDataException = new BadDataException(
      "Acknowledging is refused.",
    );
    validateAcknowledge.mockRejectedValue(refusal as never);

    await expect(
      onBeforeCreate({
        [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [ALERT_ID],
        [INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY]: true,
      }),
    ).rejects.toBe(refusal);

    expect(validateAlertIds).toHaveBeenCalledTimes(1);
    expect(counter).not.toHaveBeenCalled();
  });

  test("a bad alert id is refused first: the acknowledgement is never considered", async () => {
    await expect(
      onBeforeCreate({
        [INCIDENT_ALERT_IDS_TO_LINK_KEY]: ["not-a-uuid"],
        [INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY]: true,
      }),
    ).rejects.toThrow("alertIdsToLink must only contain alert ids.");

    expect(validateAcknowledge).not.toHaveBeenCalled();
    expect(findAcknowledgedState).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
    expect(counter).not.toHaveBeenCalled();
  });

  test("a caller who may not link the alerts is refused for that, before acknowledging is considered", async () => {
    await expect(
      onBeforeCreate(
        {
          [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [ALERT_ID],
          [INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY]: true,
        },
        userProps(Permission.IncidentViewer),
      ),
    ).rejects.toThrow(
      "You do not have permission to link alerts to incidents in this project.",
    );

    expect(validateAcknowledge).not.toHaveBeenCalled();
    expect(counter).not.toHaveBeenCalled();
  });

  test("with the real permission check, an incident member may link alerts but not acknowledge them", async () => {
    // IncidentMember may create an IncidentAlert but not an AlertStateTimeline.
    authorize.mockRestore();

    await expect(
      onBeforeCreate(
        {
          [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [ALERT_ID],
          [INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY]: true,
        },
        userProps(Permission.IncidentMember),
      ),
    ).rejects.toThrow(MAY_NOT_ACKNOWLEDGE_MESSAGE);

    expect(counter).not.toHaveBeenCalled();

    // The same member declaring without acknowledging is let through.
    const result: OnCreate<Incident> = await onBeforeCreate(
      { [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [ALERT_ID] },
      userProps(Permission.IncidentMember),
    );

    expect(
      (result.carryForward as CarriedForward).acknowledgedAlertStateId,
    ).toBeNull();
    expect(counter).toHaveBeenCalledTimes(1);
  });

  test("a root caller gets the Acknowledged state without the per-alert permission check", async () => {
    const result: OnCreate<Incident> = await onBeforeCreate(
      {
        [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [ALERT_ID],
        [INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY]: true,
      },
      { isRoot: true },
    );

    // The project comes from the incident itself for a root caller.
    expect(validateAcknowledgeArgs().projectId!.toString()).toBe(
      PROJECT_ID.toString(),
    );
    expect(authorize).not.toHaveBeenCalled();

    const carriedForward: CarriedForward =
      result.carryForward as CarriedForward;

    expect(ids(carriedForward.alertIdsToLink)).toEqual([ALERT_ID]);
    expect(carriedForward.acknowledgedAlertStateId!.toString()).toBe(
      ACKNOWLEDGED_ALERT_STATE_ID,
    );
  });

  test("a root caller without an Acknowledged alert state is still refused before the number is taken", async () => {
    findAcknowledgedState.mockResolvedValue(null as never);

    await expect(
      onBeforeCreate(
        {
          [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [ALERT_ID],
          [INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY]: true,
        },
        { isRoot: true },
      ),
    ).rejects.toThrow(NO_ACKNOWLEDGED_STATE_MESSAGE);

    expect(counter).not.toHaveBeenCalled();
  });
});

describe("IncidentService.onCreateSuccess acknowledges the alerts it was declared with", () => {
  let link: jest.SpyInstance;
  let acknowledge: jest.SpyInstance;

  const alertIds: Array<ObjectID> = [
    new ObjectID(ALERT_ID),
    new ObjectID(ALERT_ID_2),
  ];

  beforeEach(() => {
    stubCreateSuccessChain();
    link = stubLinking();
    acknowledge = jest
      .spyOn(IncidentAlertService, "acknowledgeAlertsDeclaredWithIncident")
      .mockResolvedValue(emptyAcknowledgeResult() as never);
  });

  function acknowledgeArgs(): AcknowledgeArgs {
    expect(acknowledge).toHaveBeenCalledTimes(1);
    return acknowledge.mock.calls[0]![0] as AcknowledgeArgs;
  }

  test("acknowledges every declared alert once they are linked, credited to the incident's creator for a root caller", async () => {
    const incident: Incident = createdIncident(USER_ID);

    await expect(onCreateSuccess(carried(alertIds), incident)).resolves.toBe(
      incident,
    );

    expect(link).toHaveBeenCalledTimes(1);
    expect(acknowledge).toHaveBeenCalledTimes(1);
    expect(acknowledge).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
      alertIds: alertIds,
      linkedAlertIds: alertIds,
      acknowledgedByUserId: USER_ID,
    });

    // Acknowledged after linking, never before.
    expect(link.mock.invocationCallOrder[0]!).toBeLessThan(
      acknowledge.mock.invocationCallOrder[0]!,
    );
  });

  test("the alert ids acknowledged are exactly the validated ids carried forward", async () => {
    await onCreateSuccess(carried(alertIds), createdIncident(USER_ID));

    const args: AcknowledgeArgs = acknowledgeArgs();

    expect(ids(args.alertIds)).toEqual([ALERT_ID, ALERT_ID_2]);
    // ...and the same ids that were linked.
    expect(ids(args.alertIds)).toEqual(
      ids((link.mock.calls[0]![0] as LinkArgs).alertIds),
    );
  });

  test("acknowledging waits for the links to be written", async () => {
    const linking: Deferred<LinkAlertsToIncidentResult> =
      deferred<LinkAlertsToIncidentResult>();

    link.mockImplementation((() => {
      return linking.promise;
    }) as never);

    const created: Promise<Incident> = onCreateSuccess(
      carried(alertIds),
      createdIncident(USER_ID),
    );
    await settle();

    // Still linking: nothing acknowledged yet.
    expect(link).toHaveBeenCalledTimes(1);
    expect(acknowledge).not.toHaveBeenCalled();

    linking.resolve({
      linkedAlertIds: [...alertIds],
      alreadyLinkedAlertIds: [],
      failed: [],
    });
    await created;

    expect(acknowledge).toHaveBeenCalledTimes(1);
    expect(ids(acknowledgeArgs().linkedAlertIds)).toEqual([
      ALERT_ID,
      ALERT_ID_2,
    ]);
  });

  test("the linked alert ids are the newly linked and the already linked ones, never the failed ones", async () => {
    const threeAlerts: Array<ObjectID> = [
      new ObjectID(ALERT_ID),
      new ObjectID(ALERT_ID_2),
      new ObjectID(ALERT_ID_3),
    ];

    link.mockResolvedValue({
      linkedAlertIds: [new ObjectID(ALERT_ID)],
      alreadyLinkedAlertIds: [new ObjectID(ALERT_ID_3)],
      failed: [{ alertId: new ObjectID(ALERT_ID_2), message: "gone" }],
    } as never);

    await onCreateSuccess(carried(threeAlerts), createdIncident(USER_ID));

    const args: AcknowledgeArgs = acknowledgeArgs();

    // Every declared alert is still asked about...
    expect(ids(args.alertIds)).toEqual([ALERT_ID, ALERT_ID_2, ALERT_ID_3]);
    // ...but only those with a link are handed over as linked.
    expect(ids(args.linkedAlertIds)).toEqual([ALERT_ID, ALERT_ID_3]);

    // The link failure is still reported on its own.
    expect(errorLog).toHaveBeenCalledWith(
      "1 of 3 alerts could not be linked to the incident they were declared with.",
      {
        projectId: PROJECT_ID.toString(),
        incidentId: INCIDENT_ID.toString(),
      },
    );
  });

  test("when linking throws, the alerts are still acknowledged, with no linked alerts", async () => {
    link.mockRejectedValue(new Error("database unavailable") as never);
    const incident: Incident = createdIncident(USER_ID);

    await expect(onCreateSuccess(carried(alertIds), incident)).resolves.toBe(
      incident,
    );

    const args: AcknowledgeArgs = acknowledgeArgs();

    expect(ids(args.alertIds)).toEqual([ALERT_ID, ALERT_ID_2]);
    expect(args.linkedAlertIds).toEqual([]);
    expect(args.acknowledgedByUserId).toBe(USER_ID);

    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining(
        "Linking the alerts an incident was declared from failed in IncidentService.onCreateSuccess: Error: database unavailable",
      ),
      expect.anything(),
    );
    expect(link.mock.invocationCallOrder[0]!).toBeLessThan(
      acknowledge.mock.invocationCallOrder[0]!,
    );
  });

  describe("who the acknowledgement is credited to", () => {
    test("a user is credited as themselves, whatever the incident's createdByUserId says", async () => {
      await onCreateSuccess(carried(alertIds), createdIncident(USER_ID), {
        userId: OTHER_USER_ID,
        tenantId: PROJECT_ID,
      });

      expect(acknowledgeArgs().acknowledgedByUserId).toBe(OTHER_USER_ID);
      // The same person who is recorded as linking the alerts.
      expect((link.mock.calls[0]![0] as LinkArgs).createdByUserId).toBe(
        OTHER_USER_ID,
      );
    });

    test("a user declaring from the dashboard is credited with props.userId", async () => {
      await onCreateSuccess(
        carried(alertIds),
        createdIncident(),
        userProps(Permission.ProjectMember),
      );

      expect(acknowledgeArgs().acknowledgedByUserId).toBe(USER_ID);
    });

    test("an API key credits nobody, even when the payload names a creator", async () => {
      await onCreateSuccess(
        carried(alertIds),
        createdIncident(OTHER_USER_ID),
        apiKeyProps(),
      );

      const args: AcknowledgeArgs = acknowledgeArgs();

      expect(args.acknowledgedByUserId).toBeUndefined();
      // Still acknowledged, just not credited to anyone.
      expect(ids(args.alertIds)).toEqual([ALERT_ID, ALERT_ID_2]);
    });

    test("a root caller credits the incident's createdByUserId", async () => {
      await onCreateSuccess(carried(alertIds), createdIncident(OTHER_USER_ID), {
        isRoot: true,
      });

      expect(acknowledgeArgs().acknowledgedByUserId).toBe(OTHER_USER_ID);
    });

    test("a root caller with no creator on the incident credits nobody", async () => {
      await onCreateSuccess(carried(alertIds), createdIncident(), {
        isRoot: true,
      });

      expect(acknowledgeArgs().acknowledgedByUserId).toBeUndefined();
    });
  });

  describe("the incident never waits for, or fails with, the acknowledgement", () => {
    test("the incident is returned while the acknowledgement is still running", async () => {
      acknowledge.mockImplementation((() => {
        return new Promise<AcknowledgeDeclaredAlertsResult>(() => {
          // never settles
        });
      }) as never);

      const incident: Incident = createdIncident(USER_ID);

      await expect(onCreateSuccess(carried(alertIds), incident)).resolves.toBe(
        incident,
      );

      expect(acknowledge).toHaveBeenCalledTimes(1);
    });

    test("an acknowledgement that finishes after the incident is returned is fine", async () => {
      const acknowledging: Deferred<AcknowledgeDeclaredAlertsResult> =
        deferred<AcknowledgeDeclaredAlertsResult>();
      let finished: boolean = false;

      acknowledge.mockImplementation(
        (async (): Promise<AcknowledgeDeclaredAlertsResult> => {
          const result: AcknowledgeDeclaredAlertsResult =
            await acknowledging.promise;
          finished = true;
          return result;
        }) as never,
      );

      const incident: Incident = createdIncident(USER_ID);

      await expect(onCreateSuccess(carried(alertIds), incident)).resolves.toBe(
        incident,
      );
      expect(finished).toBe(false);

      acknowledging.resolve({
        ...emptyAcknowledgeResult(),
        acknowledgedAlertIds: [...alertIds],
      });
      await settle();

      expect(finished).toBe(true);
      expect(acknowledgementErrorLogs()).toEqual([]);
    });

    test("a rejected acknowledgement is caught and logged, and the incident is still returned", async () => {
      acknowledge.mockRejectedValue(
        new Error("alert states unavailable") as never,
      );
      const incident: Incident = createdIncident(USER_ID);

      await expect(onCreateSuccess(carried(alertIds), incident)).resolves.toBe(
        incident,
      );
      await settle();

      expect(errorLog).toHaveBeenCalledWith(
        `${ACKNOWLEDGE_FAILED_LOG_PREFIX}Error: alert states unavailable`,
        {
          projectId: PROJECT_ID.toString(),
          incidentId: INCIDENT_ID.toString(),
        },
      );
      expect(acknowledgementErrorLogs()).toHaveLength(1);
    });

    test("an acknowledgement that rejects after the incident was returned is caught too", async () => {
      const acknowledging: Deferred<AcknowledgeDeclaredAlertsResult> =
        deferred<AcknowledgeDeclaredAlertsResult>();

      acknowledge.mockImplementation((() => {
        return acknowledging.promise;
      }) as never);

      const incident: Incident = createdIncident(USER_ID);

      await expect(onCreateSuccess(carried(alertIds), incident)).resolves.toBe(
        incident,
      );
      expect(acknowledgementErrorLogs()).toEqual([]);

      acknowledging.reject(new Error("redis lock timed out"));
      await settle();

      expect(errorLog).toHaveBeenCalledWith(
        `${ACKNOWLEDGE_FAILED_LOG_PREFIX}Error: redis lock timed out`,
        {
          projectId: PROJECT_ID.toString(),
          incidentId: INCIDENT_ID.toString(),
        },
      );
    });

    test("alerts that could not be acknowledged are logged with a count", async () => {
      acknowledge.mockResolvedValue({
        acknowledgedAlertIds: [new ObjectID(ALERT_ID)],
        alreadyAcknowledgedAlertIds: [],
        leftToLinkedAlertSyncAlertIds: [],
        failed: [
          {
            alertId: new ObjectID(ALERT_ID_2),
            message: "The alert's state did not change to Acknowledged.",
          },
        ],
      } as never);
      const incident: Incident = createdIncident(USER_ID);

      await expect(onCreateSuccess(carried(alertIds), incident)).resolves.toBe(
        incident,
      );
      await settle();

      expect(errorLog).toHaveBeenCalledWith(
        "1 of 2 alerts could not be acknowledged when the incident was declared from them.",
        {
          projectId: PROJECT_ID.toString(),
          incidentId: INCIDENT_ID.toString(),
        },
      );
      expect(acknowledgementErrorLogs()).toHaveLength(1);
    });

    test("every alert failing is counted against every declared alert", async () => {
      const threeAlerts: Array<ObjectID> = [
        new ObjectID(ALERT_ID),
        new ObjectID(ALERT_ID_2),
        new ObjectID(ALERT_ID_3),
      ];

      acknowledge.mockResolvedValue({
        ...emptyAcknowledgeResult(),
        failed: threeAlerts.map((alertId: ObjectID) => {
          return {
            alertId: alertId,
            message:
              "This project has no Acknowledged alert state, so the alerts could not be acknowledged.",
          };
        }),
      } as never);

      await onCreateSuccess(carried(threeAlerts), createdIncident(USER_ID));
      await settle();

      expect(errorLog).toHaveBeenCalledWith(
        "3 of 3 alerts could not be acknowledged when the incident was declared from them.",
        expect.anything(),
      );
    });

    test("alerts left as they were (already acknowledged, or moved by the linked-alert sync) are not failures", async () => {
      acknowledge.mockResolvedValue({
        acknowledgedAlertIds: [],
        alreadyAcknowledgedAlertIds: [new ObjectID(ALERT_ID)],
        leftToLinkedAlertSyncAlertIds: [new ObjectID(ALERT_ID_2)],
        failed: [],
      } as never);

      await onCreateSuccess(carried(alertIds), createdIncident(USER_ID));
      await settle();

      expect(acknowledgementErrorLogs()).toEqual([]);
    });
  });

  describe("nothing is acknowledged unless the declaration asked for it", () => {
    test.each([
      ["a carry-forward from before the switch existed", false],
      ["a null acknowledged alert state", true],
    ])(
      "%s links the alerts and acknowledges none",
      async (_label: string, withNullState: boolean) => {
        const carryForward: unknown = withNullState
          ? { alertIdsToLink: alertIds, acknowledgedAlertStateId: null }
          : { alertIdsToLink: alertIds };

        await onCreateSuccess(carryForward, createdIncident(USER_ID));
        await settle();

        expect(link).toHaveBeenCalledTimes(1);
        expect(acknowledge).not.toHaveBeenCalled();
      },
    );

    test("an undefined acknowledged alert state acknowledges none", async () => {
      await onCreateSuccess(
        { alertIdsToLink: alertIds, acknowledgedAlertStateId: undefined },
        createdIncident(USER_ID),
      );
      await settle();

      expect(link).toHaveBeenCalledTimes(1);
      expect(acknowledge).not.toHaveBeenCalled();
    });

    test("linking that throws without the request acknowledges none", async () => {
      link.mockRejectedValue(new Error("database unavailable") as never);

      await onCreateSuccess(carried(alertIds, null), createdIncident(USER_ID));
      await settle();

      expect(acknowledge).not.toHaveBeenCalled();
    });

    test.each([
      ["no carry-forward", null],
      ["an undefined carry-forward", undefined],
      [
        "an empty list of alerts, even with an acknowledged state",
        {
          alertIdsToLink: [],
          acknowledgedAlertStateId: new ObjectID(ACKNOWLEDGED_ALERT_STATE_ID),
        },
      ],
    ])(
      "an incident declared with %s acknowledges nothing",
      async (_label: string, carryForward: unknown) => {
        const incident: Incident = createdIncident(USER_ID);

        await expect(onCreateSuccess(carryForward, incident)).resolves.toBe(
          incident,
        );
        await settle();

        expect(link).not.toHaveBeenCalled();
        expect(acknowledge).not.toHaveBeenCalled();
      },
    );
  });
});

describe("declaring and acknowledging in one request, from onBeforeCreate to onCreateSuccess", () => {
  let counter: jest.SpyInstance;
  let link: jest.SpyInstance;
  let acknowledge: jest.SpyInstance;

  beforeEach(() => {
    counter = stubBeforeCreate();
    stubCreateSuccessChain();

    jest
      .spyOn(AlertStateService, "findOneBy")
      .mockResolvedValue(acknowledgedAlertState() as never);
    jest
      .spyOn(AlertStateChangeAuthorization, "assertCanChangeStateOfAlerts")
      .mockResolvedValue(undefined as never);

    link = stubLinking();
    acknowledge = jest
      .spyOn(IncidentAlertService, "acknowledgeAlertsDeclaredWithIncident")
      .mockResolvedValue(emptyAcknowledgeResult() as never);
  });

  async function declare(
    miscDataProps: JSONObject,
    props: DatabaseCommonInteractionProps,
  ): Promise<Incident> {
    const before: OnCreate<Incident> = await onBeforeCreate(
      miscDataProps,
      props,
    );

    // The row as saved.
    const created: Incident = before.createBy.data;
    created._id = INCIDENT_ID.toString();

    return callHook<Incident>(
      IncidentService,
      "onCreateSuccess",
      {
        createBy: before.createBy,
        carryForward: before.carryForward,
      },
      created,
    );
  }

  test("a user who ticks the box has the validated alerts linked and then acknowledged as them", async () => {
    await declare(
      {
        [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [
          ALERT_ID,
          ALERT_ID_2,
          ALERT_ID.toUpperCase(),
        ],
        [INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY]: true,
      },
      userProps(Permission.ProjectMember),
    );

    expect(counter).toHaveBeenCalledTimes(1);

    const args: AcknowledgeArgs = acknowledge.mock
      .calls[0]![0] as AcknowledgeArgs;

    expect(acknowledge).toHaveBeenCalledTimes(1);
    expect(args.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(args.incidentId.toString()).toBe(INCIDENT_ID.toString());
    expect(ids(args.alertIds)).toEqual([ALERT_ID, ALERT_ID_2]);
    expect(ids(args.linkedAlertIds)).toEqual([ALERT_ID, ALERT_ID_2]);
    expect(args.acknowledgedByUserId).toBe(USER_ID);

    expect(link.mock.invocationCallOrder[0]!).toBeLessThan(
      acknowledge.mock.invocationCallOrder[0]!,
    );
  });

  test("a user who leaves the box unticked has the alerts linked and not acknowledged", async () => {
    await declare(
      { [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [ALERT_ID, ALERT_ID_2] },
      userProps(Permission.ProjectMember),
    );

    expect(link).toHaveBeenCalledTimes(1);
    expect(acknowledge).not.toHaveBeenCalled();
  });

  test("an API key that asks for it has the alerts acknowledged, credited to nobody", async () => {
    await declare(
      {
        [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [ALERT_ID],
        [INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY]: true,
      },
      apiKeyProps(),
    );

    expect(acknowledge).toHaveBeenCalledTimes(1);

    const args: AcknowledgeArgs = acknowledge.mock
      .calls[0]![0] as AcknowledgeArgs;

    expect(ids(args.alertIds)).toEqual([ALERT_ID]);
    expect(args.acknowledgedByUserId).toBeUndefined();
  });
});
