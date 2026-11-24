import { describe, expect, test } from "@jest/globals";
import DetectionRule from "../../../../Models/DatabaseModels/DetectionRule";
import DetectionRuleEvaluator from "../../../../Server/Utils/SecurityEvent/DetectionRuleEvaluator";
import { DetectionMatchGroup } from "../../../../Server/Services/SecurityEventService";
import AuditLogAction from "../../../../Types/AuditLog/AuditLogAction";
import {
  SecurityEntity,
  SecurityEntityType,
  canActOnSecurityEntity,
  getEntityAsActionable,
  mergeSecurityEntities,
} from "../../../../Types/SecurityCase/SecurityEntity";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import {
  API_KEY_PRINCIPAL_PREFIX,
  getApiKeyIdOfPrincipal,
  getApiKeyPrincipal,
  getWorkflowPrincipal,
  isOneUptimeActorPrincipal,
} from "../../../../Types/SecurityEvent/OneUptimeActorPrincipal";
import UserType from "../../../../Types/UserType";
import { WorkflowRunAs } from "../../../../Types/Workflow/WorkflowRunAs";
import {
  AUDIT_ATTRIBUTES,
  AuditActor,
  AuditRecordNameReaders,
  AuditResourceType,
  AuditScanRecord,
  MassDeleteRow,
  buildAuditRecordEvent,
  buildMassDeleteEvent,
  describeAuditActor,
  getAuditActorPrincipal,
  isApiKeyAuditActor,
} from "../../../../Utils/SecurityEvent/TelemetryScan/AuditLogSignals";
import Permission from "../../../../Types/Permission";

/*
 * A PROJECT API KEY IS NEVER OFFERED AS A USER TO SUSPEND (#10630).
 *
 * OneUptime's audit log events named a key that made a change by its name,
 * as the event's principal user: "terraform", "deploy-bot". A rule that
 * groups by principal user made that a User of the case, so a playbook's
 * Okta or Entra ID step could offer "terraform" as the user to suspend,
 * and two keys with one name were one principal.
 *
 * A key's events name it "api-key:" and its id now, which the entity rule
 * holds as Other (isOneUptimeActorPrincipal): no playbook offers it. Its
 * name stays in the message and in audit.api_key_name, beside its id in
 * audit.api_key_id.
 */

const WINDOW_START: Date = new Date("2026-11-20T10:00:00.000Z");
const TERRAFORM_ID: string = "0192f1a0-0000-7000-8000-00000000d001";
const TERRAFORM_TWIN_ID: string = "0192f1a0-0000-7000-8000-00000000d002";
const WORKFLOW_ID: string = "0192f1a0-0000-7000-8000-00000000d003";

const NOBODY: AuditActor = {
  userId: "",
  userName: "",
  userEmail: "",
  userType: "",
  apiKeyId: "",
  apiKeyName: "",
  mcpClientName: "",
  workflowId: "",
  workflowName: "",
  workflowRunAs: "",
  workflowRunAsCustomRoleName: "",
  workflowRunAsGiverName: "",
  workflowRunAsGiverApiKeyId: "",
};

// A project API key's change, as ProjectMiddleware hands it to the audit log.
function apiKey(id: string, name: string): AuditActor {
  return { ...NOBODY, userType: UserType.API, apiKeyId: id, apiKeyName: name };
}

const TERRAFORM: AuditActor = apiKey(TERRAFORM_ID, "terraform");
const TERRAFORM_TWIN: AuditActor = apiKey(TERRAFORM_TWIN_ID, "terraform");

// Every reader of security events reads custom roles: the record is named.
const EVERYONE_READS: AuditRecordNameReaders = {
  eventReaders: [Permission.ProjectOwner],
  getRecordReaders: (): ReadonlyArray<Permission> => {
    return [Permission.ProjectOwner];
  },
};

function roleChange(
  actor: AuditActor,
  overrides: Partial<AuditScanRecord> = {},
): AuditScanRecord {
  return {
    ...actor,
    id: "0192f1a0-0000-7000-8000-00000000d0a1",
    createdAt: new Date("2026-11-20T10:00:00.000Z"),
    resourceType: AuditResourceType.CustomRole,
    resourceId: "0192f1a0-0000-7000-8000-00000000d0a2",
    resourceName: "Deployers",
    action: AuditLogAction.Update,
    ...overrides,
  };
}

function deletes(actor: AuditActor, count: number): MassDeleteRow {
  return {
    ...actor,
    deletes: count,
    sampleResourceTypes: ["Monitor"],
    firstAt: new Date("2026-11-20T10:00:10.000Z"),
    lastAt: new Date("2026-11-20T10:02:40.000Z"),
  };
}

describe("a project API key's principal", () => {
  test("is made from the key's id, and read back from it, whatever its case", () => {
    expect(API_KEY_PRINCIPAL_PREFIX).toBe("api-key:");
    expect(getApiKeyPrincipal(TERRAFORM_ID)).toBe(`api-key:${TERRAFORM_ID}`);
    expect(getApiKeyPrincipal(` ${TERRAFORM_ID.toUpperCase()} `)).toBe(
      `api-key:${TERRAFORM_ID}`,
    );
    expect(getApiKeyIdOfPrincipal(`API-Key:${TERRAFORM_ID}`)).toBe(
      TERRAFORM_ID,
    );
    expect(
      getApiKeyIdOfPrincipal(`api-key:${TERRAFORM_ID.toUpperCase()}`),
    ).toBe(TERRAFORM_ID);
  });

  test("is never made of anything but an id", () => {
    expect(getApiKeyPrincipal("terraform")).toBe("");
    expect(getApiKeyPrincipal("")).toBe("");
    expect(getApiKeyPrincipal(undefined)).toBe("");
    expect(getApiKeyPrincipal(42)).toBe("");
    expect(getApiKeyIdOfPrincipal("api-key:terraform")).toBe("");
    expect(getApiKeyIdOfPrincipal("terraform")).toBe("");
    expect(getApiKeyIdOfPrincipal(`workflow:${WORKFLOW_ID}`)).toBe("");
    expect(getApiKeyIdOfPrincipal(`xapi-key:${TERRAFORM_ID}`)).toBe("");
  });

  test("is one of OneUptime's own actors, whatever its case; a key's name is not", () => {
    expect(isOneUptimeActorPrincipal(`api-key:${TERRAFORM_ID}`)).toBe(true);
    expect(isOneUptimeActorPrincipal(`API-KEY:${TERRAFORM_ID}`)).toBe(true);
    expect(isOneUptimeActorPrincipal(` api-key:${TERRAFORM_ID} `)).toBe(true);
    // The workflow's and OneUptime's stay what they were (#10430).
    expect(isOneUptimeActorPrincipal(getWorkflowPrincipal(WORKFLOW_ID))).toBe(
      true,
    );
    expect(isOneUptimeActorPrincipal("oneuptime")).toBe(true);
    expect(isOneUptimeActorPrincipal("api-key:terraform")).toBe(false);
    expect(isOneUptimeActorPrincipal("terraform")).toBe(false);
    expect(isOneUptimeActorPrincipal("jane@example.com")).toBe(false);
  });
});

describe("a key's change names the key by its id", () => {
  test("a key's role change: principal api-key:<id>, its name in the message and audit.api_key_name", () => {
    const event: NormalizedSecurityEvent = buildAuditRecordEvent(
      roleChange(TERRAFORM),
      EVERYONE_READS,
    )!;

    expect(event.principalUser).toBe(`api-key:${TERRAFORM_ID}`);
    expect(event.message).toBe(
      'The API key "terraform" changed the custom role "Deployers"',
    );
    expect(event.attributes[AUDIT_ATTRIBUTES.apiKeyName]).toBe("terraform");
    expect(event.attributes[AUDIT_ATTRIBUTES.apiKeyId]).toBe(TERRAFORM_ID);
    expect(event.attributes[AUDIT_ATTRIBUTES.actorType]).toBe(UserType.API);
    // The principal is among the observables a rule and a case read, never the name alone.
    expect(event.observables).toContain(`api-key:${TERRAFORM_ID}`);
    expect(event.observables).not.toContain("terraform");
  });

  test("its mass delete is the key's too, and keeps the id it was always stored by", () => {
    const event: NormalizedSecurityEvent = buildMassDeleteEvent(
      deletes(TERRAFORM, 40),
      WINDOW_START,
    )!;

    expect(event.principalUser).toBe(`api-key:${TERRAFORM_ID}`);
    expect(event.message.startsWith('The API key "terraform" deleted 40')).toBe(
      true,
    );
    expect(event.attributes[AUDIT_ATTRIBUTES.apiKeyName]).toBe("terraform");
    expect(event.attributes[AUDIT_ATTRIBUTES.apiKeyId]).toBe(TERRAFORM_ID);
    // The same window read again is the same event, before and after #10630.
    expect(event.eventUid).toBe(
      `audit:mass-delete:${TERRAFORM_ID}:2026-11-20T10:00:00.000Z`,
    );
  });

  test("two keys with one name are two principals", () => {
    const first: NormalizedSecurityEvent = buildAuditRecordEvent(
      roleChange(TERRAFORM),
      EVERYONE_READS,
    )!;
    const second: NormalizedSecurityEvent = buildAuditRecordEvent(
      roleChange(TERRAFORM_TWIN, {
        id: "0192f1a0-0000-7000-8000-00000000d0b1",
      }),
      EVERYONE_READS,
    )!;

    expect(first.principalUser).not.toBe(second.principalUser);
    expect(second.principalUser).toBe(`api-key:${TERRAFORM_TWIN_ID}`);
    // Both still read "terraform", in their message and their attribute.
    expect(first.attributes[AUDIT_ATTRIBUTES.apiKeyName]).toBe(
      second.attributes[AUDIT_ATTRIBUTES.apiKeyName],
    );

    const firstDeletes: NormalizedSecurityEvent = buildMassDeleteEvent(
      deletes(TERRAFORM, 30),
      WINDOW_START,
    )!;
    const secondDeletes: NormalizedSecurityEvent = buildMassDeleteEvent(
      deletes(TERRAFORM_TWIN, 30),
      WINDOW_START,
    )!;

    expect(firstDeletes.principalUser).not.toBe(secondDeletes.principalUser);
    expect(firstDeletes.eventUid).not.toBe(secondDeletes.eventUid);
  });

  test("a key renamed is still one principal", () => {
    expect(getAuditActorPrincipal(apiKey(TERRAFORM_ID, "terraform"))).toBe(
      getAuditActorPrincipal(apiKey(TERRAFORM_ID, "terraform-prod")),
    );
  });

  test("a key's entry that does not say which key names no principal, never its name", () => {
    expect(getAuditActorPrincipal({ ...NOBODY, userType: UserType.API })).toBe(
      "",
    );
    expect(
      getAuditActorPrincipal({
        ...NOBODY,
        userType: UserType.API,
        apiKeyName: "terraform",
      }),
    ).toBe("");
    expect(getAuditActorPrincipal({ ...NOBODY, apiKeyName: "terraform" })).toBe(
      "",
    );
    // It is still said as the key's.
    expect(
      describeAuditActor({
        ...NOBODY,
        userType: UserType.API,
        apiKeyName: "terraform",
      }),
    ).toBe('The API key "terraform"');
  });

  test("a key named by its id alone, with no kind, is the key's", () => {
    expect(getAuditActorPrincipal({ ...NOBODY, apiKeyId: TERRAFORM_ID })).toBe(
      `api-key:${TERRAFORM_ID}`,
    );
  });

  test("the master key acts as the master admin, whom its entry names", () => {
    const masterKey: AuditActor = {
      ...NOBODY,
      userType: UserType.MasterAdmin,
      userId: "0192f1a0-0000-7000-8000-00000000d004",
      userEmail: "admin@example.com",
      userName: "Admin",
      apiKeyName: "Master API Key",
    };

    expect(isApiKeyAuditActor(masterKey)).toBe(false);
    expect(getAuditActorPrincipal(masterKey)).toBe("admin@example.com");
  });

  test("a key behind an MCP client is still the key", () => {
    expect(
      getAuditActorPrincipal({ ...TERRAFORM, mcpClientName: "Cursor" }),
    ).toBe(`api-key:${TERRAFORM_ID}`);
  });

  test("a workflow a key gave its permissions to is the workflow, never the key", () => {
    const event: NormalizedSecurityEvent = buildAuditRecordEvent(
      roleChange({
        ...NOBODY,
        userType: UserType.Workflow,
        workflowId: WORKFLOW_ID,
        workflowName: "Nightly Cleanup",
        workflowRunAs: WorkflowRunAs.CustomRole,
        workflowRunAsCustomRoleName: "Cleanup Crew",
        workflowRunAsGiverName: "terraform",
        workflowRunAsGiverApiKeyId: TERRAFORM_ID,
      }),
      EVERYONE_READS,
    )!;

    expect(event.principalUser).toBe(`workflow:${WORKFLOW_ID}`);
    expect(event.attributes[AUDIT_ATTRIBUTES.apiKeyId]).toBeUndefined();
  });

  test("a person's change is theirs, with no key attribute", () => {
    const event: NormalizedSecurityEvent = buildAuditRecordEvent(
      roleChange({
        ...NOBODY,
        userType: UserType.User,
        userId: "0192f1a0-0000-7000-8000-00000000d005",
        userEmail: "jane@example.com",
      }),
      EVERYONE_READS,
    )!;

    expect(event.principalUser).toBe("jane@example.com");
    expect(event.attributes[AUDIT_ATTRIBUTES.apiKeyId]).toBeUndefined();
    expect(event.attributes[AUDIT_ATTRIBUTES.apiKeyName]).toBeUndefined();
  });
});

describe("a case grouped on a key offers no user to a playbook", () => {
  const principal: string = getApiKeyPrincipal(TERRAFORM_ID);

  test("the entity rule holds the key as Other, which no response acts on", () => {
    expect(
      getEntityAsActionable({
        type: SecurityEntityType.User,
        value: principal,
      }),
    ).toEqual({ type: SecurityEntityType.Other, value: principal });
    expect(
      getEntityAsActionable({
        type: SecurityEntityType.User,
        value: principal.toUpperCase(),
      })!.type,
    ).toBe(SecurityEntityType.Other);
    expect(
      canActOnSecurityEntity({
        type: SecurityEntityType.User,
        value: principal,
      }),
    ).toBe(false);
  });

  test("a rule grouped by principalUser makes the key no User of the case", () => {
    const rule: DetectionRule = new DetectionRule();
    rule.groupByField = "principalUser";

    const matchGroup: DetectionMatchGroup = {
      groupValue: principal,
      matchCount: 3,
      distinctCount: 0,
      sampleMessage: 'The API key "terraform" changed the custom role',
      sampleObservables: [principal],
    };

    const entities: Array<SecurityEntity> =
      DetectionRuleEvaluator.getMatchGroupEntities({ rule, matchGroup });

    expect(entities).toContainEqual({
      type: SecurityEntityType.Other,
      value: principal,
    });
    expect(
      entities.some((entity: SecurityEntity): boolean => {
        return entity.type === SecurityEntityType.User;
      }),
    ).toBe(false);
  });

  test("a case's entities merged from a key's events hold no user", () => {
    const event: NormalizedSecurityEvent = buildAuditRecordEvent(
      roleChange(TERRAFORM),
      EVERYONE_READS,
    )!;

    const merged: Array<SecurityEntity> = mergeSecurityEntities([
      { type: SecurityEntityType.User, value: event.principalUser! },
    ]);

    expect(merged).toEqual([
      { type: SecurityEntityType.Other, value: principal },
    ]);
  });
});
