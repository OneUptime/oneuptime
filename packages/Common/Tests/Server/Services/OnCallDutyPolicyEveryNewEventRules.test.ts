import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AlertOnCallRule from "../../../Models/DatabaseModels/AlertOnCallRule";
import IncidentOnCallRule from "../../../Models/DatabaseModels/IncidentOnCallRule";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import AlertOnCallRuleService from "../../../Server/Services/AlertOnCallRuleService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentOnCallRuleService from "../../../Server/Services/IncidentOnCallRuleService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import logger from "../../../Server/Utils/Logger";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  EVERY_NEW_ALERT_RULE_DESCRIPTION,
  EVERY_NEW_INCIDENT_RULE_DESCRIPTION,
  PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_KEY,
} from "../../../Types/OnCallDutyPolicy/EveryNewEventRules";
import Permission, { UserPermission } from "../../../Types/Permission";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

/*
 * A NEW PROJECT'S FIRST ON-CALL POLICY PAGES FOR EVERY INCIDENT AND ALERT.
 *
 * Create On-Call Policy's "Page this policy for every new incident and
 * alert" travels as misc data (EveryNewEventRules).
 * OnCallDutyPolicyService.create, given
 * it, adds two on-call rules once the policy is saved - one for incidents,
 * one for alerts, matching everything and naming the policy - so the policy
 * pages whoever its first level names as soon as anything opens. These
 * tests drive the real create override with the database stubbed:
 *
 *   - not asked for (nothing, false, an API caller): no rule, as before;
 *   - asked for: both rules, after the policy, as the caller;
 *   - refused before anything is saved when the caller may not add them, or
 *     the ask is not a yes or a no;
 *   - a rule that fails once the policy is saved is logged, the other still
 *     added and the policy kept.
 */

beforeEach(() => {
  stubProjectDirectory({});
});

const PROJECT_ID: ObjectID = new ObjectID(
  "0c000000-0000-4000-8000-000000000001",
);
const POLICY_ID: ObjectID = new ObjectID(
  "0c000000-0000-4000-8000-000000000002",
);
const CALLER_ID: ObjectID = new ObjectID(
  "0c000000-0000-4000-8000-000000000004",
);

const ASK: JSONObject = { [PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_KEY]: true };

function grant(permission: Permission): UserPermission {
  return {
    _type: "UserPermission",
    permission,
    labelIds: [],
    scope: PermissionScope.All,
    isBlockPermission: false,
  };
}

function callerProps(
  permissions: Array<Permission> = [Permission.ProjectAdmin],
): DatabaseCommonInteractionProps {
  return {
    userId: CALLER_ID,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: permissions.map(grant),
      },
    },
  };
}

function createPolicy(
  miscDataProps: JSONObject | undefined,
  props: DatabaseCommonInteractionProps = callerProps(),
  name: string = "Payments",
): Promise<OnCallDutyPolicy> {
  const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
  policy.name = name;

  const createBy: CreateBy<OnCallDutyPolicy> = { data: policy, props };

  if (miscDataProps !== undefined) {
    createBy.miscDataProps = miscDataProps;
  }

  return OnCallDutyPolicyService.create(createBy);
}

/*
 * The rule services' create is inherited (ProjectReferencesService), and
 * jest.spyOn patches an inherited method where it is defined - which would
 * stub every service's create, the policy's own included. Each rule
 * service's create is made its own first, so only it is stubbed.
 */
type CreateOf<T extends BaseModel> = (createBy: CreateBy<T>) => Promise<T>;

function stubOwnCreate<T extends BaseModel>(
  service: { create: CreateOf<T> },
  implementation: CreateOf<T>,
): void {
  Object.defineProperty(service, "create", {
    value: implementation,
    configurable: true,
    writable: true,
  });
}

function unstubOwnCreate(service: unknown): void {
  delete (service as { create?: unknown }).create;
}

let events: Array<string>;
let incidentRuleCreates: Array<CreateBy<IncidentOnCallRule>>;
let alertRuleCreates: Array<CreateBy<AlertOnCallRule>>;
let incidentRuleError: Error | null;
let alertRuleError: Error | null;
let policyCreateSpy: jest.SpyInstance;
let loggerErrorSpy: jest.SpyInstance;

beforeEach(() => {
  events = [];
  incidentRuleCreates = [];
  alertRuleCreates = [];
  incidentRuleError = null;
  alertRuleError = null;

  // The policy's own create "saves" it, standing for its hooks and owner row.
  policyCreateSpy = jest
    .spyOn(DatabaseService.prototype, "create")
    .mockImplementation(async function (
      this: DatabaseService<BaseModel>,
      createBy: CreateBy<BaseModel>,
    ): Promise<BaseModel> {
      if (this.modelType === OnCallDutyPolicy) {
        events.push("policy created");
        await Promise.resolve();
        const policy: OnCallDutyPolicy = createBy.data as OnCallDutyPolicy;
        policy.id = POLICY_ID;
        policy.projectId = createBy.props.tenantId || policy.projectId!;
        return policy;
      }

      throw new Error(`Unexpected create of ${this.modelType.name}`);
    });

  stubOwnCreate<IncidentOnCallRule>(
    IncidentOnCallRuleService,
    async (
      createBy: CreateBy<IncidentOnCallRule>,
    ): Promise<IncidentOnCallRule> => {
      events.push("incident rule created");
      incidentRuleCreates.push(createBy);

      if (incidentRuleError) {
        throw incidentRuleError;
      }

      return createBy.data;
    },
  );

  stubOwnCreate<AlertOnCallRule>(
    AlertOnCallRuleService,
    async (createBy: CreateBy<AlertOnCallRule>): Promise<AlertOnCallRule> => {
      events.push("alert rule created");
      alertRuleCreates.push(createBy);

      if (alertRuleError) {
        throw alertRuleError;
      }

      return createBy.data;
    },
  );

  loggerErrorSpy = jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined as never;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  unstubOwnCreate(IncidentOnCallRuleService);
  unstubOwnCreate(AlertOnCallRuleService);
});

function policyWasSaved(): boolean {
  return events.includes("policy created");
}

function policyIdsOf(
  rule: IncidentOnCallRule | AlertOnCallRule,
): Array<string> {
  return (rule.onCallDutyPolicies || []).map(
    (policy: OnCallDutyPolicy): string => {
      return policy.id!.toString();
    },
  );
}

describe("a policy not asked to be paged for everything", () => {
  test.each([
    ["no misc data", undefined],
    ["empty misc data", {}],
    ["the switch off", { [PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_KEY]: false }],
    [
      "the switch sent as null",
      { [PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_KEY]: null },
    ],
    ["other misc data only", { ownerUsers: [CALLER_ID.toString()] }],
  ] as Array<[string, JSONObject | undefined]>)(
    "%s: is created without a rule, as before",
    async (_label: string, miscDataProps: JSONObject | undefined) => {
      const policy: OnCallDutyPolicy = await createPolicy(miscDataProps);

      expect(policy.id?.toString()).toBe(POLICY_ID.toString());
      expect(events).toEqual(["policy created"]);
    },
  );

  test("past the hooks (ignoreHooks), the ask is not even read", async () => {
    await createPolicy(ASK, { ...callerProps(), ignoreHooks: true });

    expect(events).toEqual(["policy created"]);
  });
});

describe("a policy asked to be paged for every new incident and alert", () => {
  test("gets an incident rule and an alert rule, after it is saved", async () => {
    await createPolicy(ASK);

    expect(events).toEqual([
      "policy created",
      "incident rule created",
      "alert rule created",
    ]);
  });

  test("each rule matches everything and names the new policy alone", async () => {
    await createPolicy(ASK);

    const incidentRule: IncidentOnCallRule = incidentRuleCreates[0]!.data;
    const alertRule: AlertOnCallRule = alertRuleCreates[0]!.data;

    for (const rule of [incidentRule, alertRule]) {
      expect(rule.projectId?.toString()).toBe(PROJECT_ID.toString());
      expect(rule.isEnabled).toBe(true);
      expect(policyIdsOf(rule)).toEqual([POLICY_ID.toString()]);
      // No filter of any kind: an empty rule matches every incident or alert.
      expect(rule.monitors).toBeUndefined();
      expect(rule.monitorLabels).toBeUndefined();
      expect(rule.monitorNamePattern).toBeUndefined();
      expect(rule.monitorDescriptionPattern).toBeUndefined();
    }

    expect(incidentRule.incidentSeverities).toBeUndefined();
    expect(incidentRule.incidentLabels).toBeUndefined();
    expect(incidentRule.incidentTitlePattern).toBeUndefined();
    expect(alertRule.alertSeverities).toBeUndefined();
    expect(alertRule.alertLabels).toBeUndefined();
    expect(alertRule.alertTitlePattern).toBeUndefined();
  });

  test("the rules say what they do, and are named after the policy", async () => {
    await createPolicy(ASK, callerProps(), "Payments on-call");

    expect(incidentRuleCreates[0]!.data.name).toBe(
      "Page Payments on-call for every incident",
    );
    expect(incidentRuleCreates[0]!.data.description).toBe(
      EVERY_NEW_INCIDENT_RULE_DESCRIPTION,
    );
    expect(alertRuleCreates[0]!.data.name).toBe(
      "Page Payments on-call for every alert",
    );
    expect(alertRuleCreates[0]!.data.description).toBe(
      EVERY_NEW_ALERT_RULE_DESCRIPTION,
    );
  });

  test("the rules are created as the caller, through their own services' checks", async () => {
    const props: DatabaseCommonInteractionProps = callerProps();

    await createPolicy(ASK, props);

    expect(incidentRuleCreates[0]!.props).toBe(props);
    expect(alertRuleCreates[0]!.props).toBe(props);
  });

  test("the text an API caller may send is read the same as true", async () => {
    await createPolicy({ [PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_KEY]: "true" });

    expect(incidentRuleCreates).toHaveLength(1);
    expect(alertRuleCreates).toHaveLength(1);
  });

  test("with first responders too, both are done: the policy pages them", async () => {
    jest
      .spyOn(OnCallDutyPolicyService, "checkFirstRespondersCanBePaged")
      .mockResolvedValue(undefined as never);
    const firstRule: jest.SpyInstance = jest
      .spyOn(OnCallDutyPolicyService, "addFirstEscalationRule")
      .mockImplementation(async (): Promise<void> => {
        events.push("first escalation rule added");
      });

    await createPolicy({
      ...ASK,
      users: [CALLER_ID.toString()],
    });

    expect(firstRule).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      "policy created",
      "first escalation rule added",
      "incident rule created",
      "alert rule created",
    ]);
  });
});

describe("refused before anything is saved", () => {
  test("an ask that is neither yes nor no", async () => {
    await expect(
      createPolicy({ [PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_KEY]: "always" }),
    ).rejects.toThrow(BadDataException);

    expect(policyWasSaved()).toBe(false);
  });

  test("a caller who may create policies but not on-call rules", async () => {
    const attempt: Promise<OnCallDutyPolicy> = createPolicy(
      ASK,
      callerProps([Permission.CreateProjectOnCallDutyPolicy]),
    );

    await expect(attempt).rejects.toThrow(NotAuthorizedException);
    await expect(attempt).rejects.toThrow("Incident On-Call Rule");

    expect(policyWasSaved()).toBe(false);
    expect(incidentRuleCreates).toHaveLength(0);
    expect(alertRuleCreates).toHaveLength(0);
  });

  test("a caller who may add incident rules but not alert rules", async () => {
    const attempt: Promise<OnCallDutyPolicy> = createPolicy(
      ASK,
      callerProps([
        Permission.CreateProjectOnCallDutyPolicy,
        Permission.CreateIncidentOnCallRule,
      ]),
    );

    await expect(attempt).rejects.toThrow(NotAuthorizedException);
    await expect(attempt).rejects.toThrow("Alert On-Call Rule");

    expect(policyWasSaved()).toBe(false);
  });

  test("the same caller not asking gets the policy alone", async () => {
    const policy: OnCallDutyPolicy = await createPolicy(
      {},
      callerProps([Permission.CreateProjectOnCallDutyPolicy]),
    );

    expect(policy.id?.toString()).toBe(POLICY_ID.toString());
    expect(events).toEqual(["policy created"]);
  });

  test("a caller who may add both kinds is let through", async () => {
    await createPolicy(
      ASK,
      callerProps([
        Permission.CreateProjectOnCallDutyPolicy,
        Permission.CreateIncidentOnCallRule,
        Permission.CreateAlertOnCallRule,
      ]),
    );

    expect(incidentRuleCreates).toHaveLength(1);
    expect(alertRuleCreates).toHaveLength(1);
  });

  test("a policy with no project", async () => {
    await expect(
      createPolicy(ASK, { userId: CALLER_ID, isRoot: true }),
    ).rejects.toThrow(BadDataException);

    expect(policyWasSaved()).toBe(false);
  });
});

describe("once the policy is saved", () => {
  test("an incident rule that cannot be added is logged, and the alert rule is still added", async () => {
    incidentRuleError = new Error("The database went away.");

    const policy: OnCallDutyPolicy = await createPolicy(ASK);

    expect(policy.id?.toString()).toBe(POLICY_ID.toString());
    expect(alertRuleCreates).toHaveLength(1);
    expect(loggerErrorSpy).toHaveBeenCalledTimes(1);
    expect(String(loggerErrorSpy.mock.calls[0]![0])).toContain(
      "The database went away.",
    );
    expect(loggerErrorSpy.mock.calls[0]![1]).toEqual({
      projectId: PROJECT_ID.toString(),
      onCallDutyPolicyId: POLICY_ID.toString(),
    });
  });

  test("an alert rule that cannot be added is logged, and the policy kept", async () => {
    alertRuleError = new Error("The database went away.");

    const policy: OnCallDutyPolicy = await createPolicy(ASK);

    expect(policy.id?.toString()).toBe(POLICY_ID.toString());
    expect(incidentRuleCreates).toHaveLength(1);
    expect(loggerErrorSpy).toHaveBeenCalledTimes(1);
    expect(String(loggerErrorSpy.mock.calls[0]![0])).toContain("alert");
  });

  test("a policy create that fails makes no rule", async () => {
    policyCreateSpy.mockImplementationOnce(async (): Promise<never> => {
      throw new BadDataException("name is required");
    });

    await expect(createPolicy(ASK)).rejects.toThrow("name is required");

    expect(incidentRuleCreates).toHaveLength(0);
    expect(alertRuleCreates).toHaveLength(0);
  });
});
