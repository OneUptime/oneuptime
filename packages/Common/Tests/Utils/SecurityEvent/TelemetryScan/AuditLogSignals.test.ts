import { describe, expect, test } from "@jest/globals";
import AuditLogAction from "../../../../Types/AuditLog/AuditLogAction";
import Permission from "../../../../Types/Permission";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../../Types/SecurityEvent/OcsfSeverity";
import {
  SECURITY_TELEMETRY_SIGNAL_ATTRIBUTE,
  SecurityTelemetrySignal,
} from "../../../../Types/SecurityEvent/SecurityTelemetrySource";
import {
  AUDIT_ATTRIBUTES,
  AUDIT_SECURITY_RESOURCE_TYPES,
  AuditRecordNameReaders,
  AuditResourceType,
  AuditScanRecord,
  MASS_DELETE_MIN_DELETES,
  MassDeleteRow,
  buildAuditRecordEvent,
  buildMassDeleteEvent,
  classifyAuditRecord,
  describeAuditActor,
  describeAuditChange,
  describeAuditTarget,
  isAuditRecordNameReadByEveryEventReader,
} from "../../../../Utils/SecurityEvent/TelemetryScan/AuditLogSignals";

/*
 * What OneUptime's own audit log says about an attack: the changes to who
 * may get in and what may be done, the security controls, and many deletes
 * at once. Every record type the scan reads and every action on it is
 * pinned - which become events, how serious, and how they are said.
 */

function record(overrides: Partial<AuditScanRecord> = {}): AuditScanRecord {
  return {
    id: "0192f1a0-0000-7000-8000-00000000a001",
    createdAt: new Date("2026-10-27T10:00:00.000Z"),
    resourceType: AuditResourceType.ApiKey,
    resourceId: "0192f1a0-0000-7000-8000-00000000a002",
    resourceName: "deploy-bot",
    action: AuditLogAction.Create,
    userId: "0192f1a0-0000-7000-8000-00000000a003",
    userName: "Alice",
    userEmail: "alice@example.com",
    userType: "User",
    apiKeyId: "",
    apiKeyName: "",
    mcpClientName: "",
    workflowId: "",
    workflowName: "",
    workflowRunAs: "",
    workflowRunAsCustomRoleName: "",
    workflowRunAsGiverName: "",
    workflowRunAsGiverApiKeyId: "",
    ...overrides,
  };
}

const ALL_ACTIONS: Array<AuditLogAction> = Object.values(AuditLogAction);

// Who reads security events: SecurityEvent's read list, as the model has it.
const EVENT_READERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.SecurityViewer,
  Permission.ReadSecurityEvent,
];

// An API key's readers, as ApiKey's table has them: no Security tier.
const API_KEY_READERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ReadProjectApiKey,
];

// A security playbook's: every Security tier, but not Read Security Event.
const SECURITY_PLAYBOOK_READERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.SecurityViewer,
  Permission.ReadSecurityPlaybook,
];

function readersOf(
  eventReaders: Array<Permission>,
  recordReaders: Record<string, Array<Permission>>,
): AuditRecordNameReaders {
  return {
    eventReaders,
    getRecordReaders: (resourceType: string): Array<Permission> => {
      return recordReaders[resourceType] || [];
    },
  };
}

// Readers who read every record the scan reads: what an event says in full.
const EVERY_RECORD_READ: AuditRecordNameReaders = readersOf(
  EVENT_READERS,
  Object.fromEntries(
    AUDIT_SECURITY_RESOURCE_TYPES.map(
      (resourceType: string): [string, Array<Permission>] => {
        return [resourceType, [...EVENT_READERS]];
      },
    ),
  ),
);

// The readers of today's models, for the types these tests name.
const TODAYS_READERS: AuditRecordNameReaders = readersOf(EVENT_READERS, {
  [AuditResourceType.ApiKey]: API_KEY_READERS,
  [AuditResourceType.SecurityPlaybook]: SECURITY_PLAYBOOK_READERS,
});

// Every text an event holds, so a test can say a name is in none of them.
function textOfEvent(event: NormalizedSecurityEvent): string {
  return JSON.stringify(event);
}

describe("which audit records are security signals", () => {
  test.each([
    [
      AuditResourceType.ApiKey,
      AuditLogAction.Create,
      SecurityTelemetrySignal.ApiKeyCreated,
      OcsfSeverity.Low,
    ],
    [
      AuditResourceType.ApiKey,
      AuditLogAction.Delete,
      SecurityTelemetrySignal.ApiKeyDeleted,
      OcsfSeverity.Informational,
    ],
    [
      AuditResourceType.CustomRole,
      AuditLogAction.Create,
      SecurityTelemetrySignal.RoleChanged,
      OcsfSeverity.Medium,
    ],
    [
      AuditResourceType.CustomRole,
      AuditLogAction.Update,
      SecurityTelemetrySignal.RoleChanged,
      OcsfSeverity.Medium,
    ],
    [
      AuditResourceType.CustomRole,
      AuditLogAction.Delete,
      SecurityTelemetrySignal.RoleChanged,
      OcsfSeverity.Low,
    ],
    [
      AuditResourceType.ApiKeyCustomRole,
      AuditLogAction.Create,
      SecurityTelemetrySignal.RoleChanged,
      OcsfSeverity.Medium,
    ],
    [
      AuditResourceType.TeamCustomRole,
      AuditLogAction.Create,
      SecurityTelemetrySignal.RoleChanged,
      OcsfSeverity.Medium,
    ],
    [
      AuditResourceType.Team,
      AuditLogAction.Create,
      SecurityTelemetrySignal.TeamChanged,
      OcsfSeverity.Low,
    ],
    [
      AuditResourceType.Team,
      AuditLogAction.Delete,
      SecurityTelemetrySignal.TeamChanged,
      OcsfSeverity.Low,
    ],
    [
      AuditResourceType.McpClientAuthorization,
      AuditLogAction.Create,
      SecurityTelemetrySignal.McpClientAuthorized,
      OcsfSeverity.Low,
    ],
    [
      AuditResourceType.PacketCapture,
      AuditLogAction.Download,
      SecurityTelemetrySignal.PacketCaptureDownloaded,
      OcsfSeverity.Low,
    ],
    [
      AuditResourceType.ProtectedEntity,
      AuditLogAction.Delete,
      SecurityTelemetrySignal.SecurityControlChanged,
      OcsfSeverity.Medium,
    ],
    [
      AuditResourceType.ProtectedEntity,
      AuditLogAction.Update,
      SecurityTelemetrySignal.SecurityControlChanged,
      OcsfSeverity.Medium,
    ],
    [
      AuditResourceType.AuditLogExport,
      AuditLogAction.Create,
      SecurityTelemetrySignal.SecurityControlChanged,
      OcsfSeverity.Medium,
    ],
    [
      AuditResourceType.AuditLogExport,
      AuditLogAction.Delete,
      SecurityTelemetrySignal.SecurityControlChanged,
      OcsfSeverity.Medium,
    ],
    [
      AuditResourceType.SecurityPlaybook,
      AuditLogAction.Delete,
      SecurityTelemetrySignal.SecurityControlChanged,
      OcsfSeverity.Medium,
    ],
  ])(
    "%s %s",
    (
      resourceType: string,
      action: string,
      signal: SecurityTelemetrySignal,
      severity: OcsfSeverity,
    ) => {
      expect(classifyAuditRecord({ resourceType, action })).toEqual(
        expect.objectContaining({ signal, severity }),
      );
    },
  );

  test.each([
    // A rename of a key, a revoked MCP client, a protected entity added, a playbook edited.
    [AuditResourceType.ApiKey, AuditLogAction.Update],
    [AuditResourceType.McpClientAuthorization, AuditLogAction.Delete],
    [AuditResourceType.ProtectedEntity, AuditLogAction.Create],
    [AuditResourceType.SecurityPlaybook, AuditLogAction.Update],
    [AuditResourceType.SecurityPlaybook, AuditLogAction.Create],
    [AuditResourceType.PacketCapture, AuditLogAction.Create],
    ["Monitor", AuditLogAction.Delete],
    ["Incident", AuditLogAction.Create],
  ])("%s %s is no signal", (resourceType: string, action: string) => {
    expect(classifyAuditRecord({ resourceType, action })).toBeNull();
  });

  test("every type the scan reads is one at least one action makes a signal", () => {
    for (const resourceType of AUDIT_SECURITY_RESOURCE_TYPES) {
      const signals: number = ALL_ACTIONS.filter((action: AuditLogAction) => {
        return classifyAuditRecord({ resourceType, action }) !== null;
      }).length;

      expect([resourceType, signals > 0]).toEqual([resourceType, true]);
    }
  });
});

describe("an audit record's event", () => {
  test("says who did what to what, in one line", () => {
    const event: NormalizedSecurityEvent = buildAuditRecordEvent(
      record(),
      EVERY_RECORD_READ,
    )!;

    expect(event.message).toBe(
      'alice@example.com created the API key "deploy-bot"',
    );
    expect(event.className).toBe("Account Change");
    expect(event.activityName).toBe("Create");
    expect(event.principalUser).toBe("alice@example.com");
    expect(event.targetResource).toBe("API Key: deploy-bot");
    expect(event.time).toEqual(new Date("2026-10-27T10:00:00.000Z"));
    expect(event.productName).toBe("OneUptime Audit Log");
    expect(event.eventUid).toBe(
      "audit:0192f1a0-0000-7000-8000-00000000a001:api-key-created",
    );
    expect(event.attributes[SECURITY_TELEMETRY_SIGNAL_ATTRIBUTE]).toBe(
      SecurityTelemetrySignal.ApiKeyCreated,
    );
    expect(event.attributes[AUDIT_ATTRIBUTES.recordId]).toBe(
      "0192f1a0-0000-7000-8000-00000000a001",
    );
    expect(event.attributes[AUDIT_ATTRIBUTES.userEmail]).toBe(
      "alice@example.com",
    );
    expect(event.mitreTechniques).toEqual(["T1098"]);
  });

  test.each([
    [
      record({
        resourceType: AuditResourceType.CustomRole,
        action: AuditLogAction.Update,
        resourceName: "Auditors",
      }),
      'alice@example.com changed the custom role "Auditors"',
    ],
    [
      record({
        resourceType: AuditResourceType.ApiKeyCustomRole,
        resourceName: "Admins",
      }),
      'alice@example.com gave an API key a custom role "Admins"',
    ],
    [
      record({
        resourceType: AuditResourceType.TeamCustomRole,
        action: AuditLogAction.Delete,
        resourceName: "",
      }),
      "alice@example.com took a custom role away from a team",
    ],
    [
      record({
        resourceType: AuditResourceType.McpClientAuthorization,
        resourceName: "grant-1",
        mcpClientName: "Claude Desktop",
      }),
      'alice@example.com authorized the MCP client "Claude Desktop"',
    ],
    [
      record({
        resourceType: AuditResourceType.PacketCapture,
        action: AuditLogAction.Download,
        resourceName: "edge-1 capture",
      }),
      'alice@example.com downloaded the packet capture "edge-1 capture"',
    ],
    [
      record({
        resourceType: AuditResourceType.AuditLogExport,
        action: AuditLogAction.Delete,
        resourceName: "S3 export",
      }),
      'alice@example.com deleted the audit log export "S3 export"',
    ],
  ])("%#: %s", (input: AuditScanRecord, sentence: string) => {
    expect(describeAuditChange(input)).toBe(sentence);
  });

  test("an actor is named by what the record knows of them", () => {
    const actor: (overrides: Partial<AuditScanRecord>) => string = (
      overrides: Partial<AuditScanRecord>,
    ): string => {
      return describeAuditActor(
        record({
          userEmail: "",
          userName: "",
          apiKeyName: "",
          workflowName: "",
          mcpClientName: "",
          ...overrides,
        }),
      );
    };

    expect(actor({ userEmail: "bob@example.com", userName: "Bob" })).toBe(
      "bob@example.com",
    );
    expect(actor({ userName: "Bob" })).toBe("Bob");
    expect(actor({ apiKeyName: "ci" })).toBe('The API key "ci"');
    expect(actor({ workflowName: "Nightly" })).toBe('The workflow "Nightly"');
    expect(actor({ mcpClientName: "Cursor" })).toBe('The MCP client "Cursor"');
    expect(actor({})).toBe("Someone");
  });

  test("a record that is no signal, or has no id, is no event", () => {
    expect(
      buildAuditRecordEvent(record({ action: AuditLogAction.Update })),
    ).toBeNull();
    expect(buildAuditRecordEvent(record({ id: "" }))).toBeNull();
  });

  test("a long name is cut, so one record cannot make a page of a message", () => {
    const event: NormalizedSecurityEvent = buildAuditRecordEvent(
      record({ resourceName: "x".repeat(5000) }),
      EVERY_RECORD_READ,
    )!;

    expect(event.message.length).toBeLessThan(200);
  });
});

describe("a record's name reaches only readers who may read the record (#10663)", () => {
  test("an API key's event names no key for readers that do not read keys", () => {
    const event: NormalizedSecurityEvent = buildAuditRecordEvent(
      record({ resourceName: "terraform-prod" }),
      TODAYS_READERS,
    )!;

    expect(event.message).toBe("alice@example.com created an API key");
    expect(event.targetResource).toBe(
      "API Key: 0192f1a0-0000-7000-8000-00000000a002",
    );
    expect(event.attributes[AUDIT_ATTRIBUTES.resourceName]).toBeUndefined();
    expect(textOfEvent(event)).not.toContain("terraform-prod");

    // The type, the id and the actor are what the event is about, and kept.
    expect(event.attributes[AUDIT_ATTRIBUTES.resourceType]).toBe(
      AuditResourceType.ApiKey,
    );
    expect(event.attributes[AUDIT_ATTRIBUTES.resourceId]).toBe(
      "0192f1a0-0000-7000-8000-00000000a002",
    );
    expect(event.attributes[AUDIT_ATTRIBUTES.recordId]).toBe(
      "0192f1a0-0000-7000-8000-00000000a001",
    );
    expect(event.attributes[AUDIT_ATTRIBUTES.userEmail]).toBe(
      "alice@example.com",
    );
    expect(event.principalUser).toBe("alice@example.com");
    expect(event.attributes[SECURITY_TELEMETRY_SIGNAL_ATTRIBUTE]).toBe(
      SecurityTelemetrySignal.ApiKeyCreated,
    );
    expect(event.severityName).toBe(OcsfSeverity.Low);
  });

  test("a type every reader of security events may read keeps its name", () => {
    const event: NormalizedSecurityEvent = buildAuditRecordEvent(
      record({ resourceName: "terraform-prod" }),
      readersOf(EVENT_READERS, {
        [AuditResourceType.ApiKey]: [
          ...EVENT_READERS,
          Permission.ReadProjectApiKey,
        ],
      }),
    )!;

    expect(event.message).toBe(
      'alice@example.com created the API key "terraform-prod"',
    );
    expect(event.targetResource).toBe("API Key: terraform-prod");
    expect(event.attributes[AUDIT_ATTRIBUTES.resourceName]).toBe(
      "terraform-prod",
    );
  });

  test("an API key's event names it for readers who all read keys", () => {
    // Project Owner and Admin read security events and API keys alike.
    const ownersAndAdmins: AuditRecordNameReaders = readersOf(
      [Permission.ProjectOwner, Permission.ProjectAdmin],
      { [AuditResourceType.ApiKey]: API_KEY_READERS },
    );

    expect(
      buildAuditRecordEvent(
        record({ resourceName: "terraform-prod" }),
        ownersAndAdmins,
      )!.message,
    ).toBe('alice@example.com created the API key "terraform-prod"');
  });

  test("one reader of security events who may not read the record is enough to keep its name out", () => {
    const deleted: AuditScanRecord = record({
      resourceType: AuditResourceType.SecurityPlaybook,
      action: AuditLogAction.Delete,
      resourceName: "Contain ransomware",
    });

    // Read Security Event alone reads no playbook.
    expect(buildAuditRecordEvent(deleted, TODAYS_READERS)!.message).toBe(
      "alice@example.com deleted a security playbook",
    );

    // Without it, every reader of security events reads playbooks.
    expect(
      buildAuditRecordEvent(
        deleted,
        readersOf(
          EVENT_READERS.filter((permission: Permission): boolean => {
            return permission !== Permission.ReadSecurityEvent;
          }),
          { [AuditResourceType.SecurityPlaybook]: SECURITY_PLAYBOOK_READERS },
        ),
      )!.message,
    ).toBe(
      'alice@example.com deleted the security playbook "Contain ransomware"',
    );
  });

  test("with no readers given, or none of events, an event names no record", () => {
    const named: AuditScanRecord = record({ resourceName: "terraform-prod" });

    expect(textOfEvent(buildAuditRecordEvent(named)!)).not.toContain(
      "terraform-prod",
    );
    expect(
      textOfEvent(
        buildAuditRecordEvent(
          named,
          readersOf([], { [AuditResourceType.ApiKey]: API_KEY_READERS }),
        )!,
      ),
    ).not.toContain("terraform-prod");
  });

  test("a type nobody reads on a record keeps no name", () => {
    expect(
      isAuditRecordNameReadByEveryEventReader({
        resourceType: AuditResourceType.Team,
        readers: TODAYS_READERS,
      }),
    ).toBe(false);
    expect(
      isAuditRecordNameReadByEveryEventReader({
        resourceType: AuditResourceType.ApiKey,
        readers: undefined,
      }),
    ).toBe(false);
  });

  test.each([
    [AuditResourceType.ApiKey, AuditLogAction.Create, "created an API key"],
    [AuditResourceType.ApiKey, AuditLogAction.Delete, "deleted an API key"],
    [
      AuditResourceType.CustomRole,
      AuditLogAction.Create,
      "created a custom role",
    ],
    [
      AuditResourceType.CustomRole,
      AuditLogAction.Update,
      "changed a custom role",
    ],
    [
      AuditResourceType.CustomRole,
      AuditLogAction.Delete,
      "deleted a custom role",
    ],
    [
      AuditResourceType.ApiKeyCustomRole,
      AuditLogAction.Create,
      "gave an API key a custom role",
    ],
    [
      AuditResourceType.ApiKeyCustomRole,
      AuditLogAction.Delete,
      "took a custom role away from an API key",
    ],
    [
      AuditResourceType.TeamCustomRole,
      AuditLogAction.Update,
      "gave a team a custom role",
    ],
    [
      AuditResourceType.TeamCustomRole,
      AuditLogAction.Delete,
      "took a custom role away from a team",
    ],
    [AuditResourceType.Team, AuditLogAction.Create, "created a team"],
    [AuditResourceType.Team, AuditLogAction.Update, "changed a team"],
    [AuditResourceType.Team, AuditLogAction.Delete, "deleted a team"],
    [
      AuditResourceType.McpClientAuthorization,
      AuditLogAction.Create,
      "authorized an MCP client",
    ],
    [
      AuditResourceType.PacketCapture,
      AuditLogAction.Download,
      "downloaded a packet capture",
    ],
    [
      AuditResourceType.ProtectedEntity,
      AuditLogAction.Update,
      "changed a protected entity",
    ],
    [
      AuditResourceType.ProtectedEntity,
      AuditLogAction.Delete,
      "deleted a protected entity",
    ],
    [
      AuditResourceType.AuditLogExport,
      AuditLogAction.Create,
      "created an audit log export",
    ],
    [
      AuditResourceType.AuditLogExport,
      AuditLogAction.Update,
      "changed an audit log export",
    ],
    [
      AuditResourceType.AuditLogExport,
      AuditLogAction.Delete,
      "deleted an audit log export",
    ],
    [
      AuditResourceType.SecurityPlaybook,
      AuditLogAction.Delete,
      "deleted a security playbook",
    ],
  ])(
    "%s %s, its name withheld, still reads naturally",
    (resourceType: string, action: string, said: string) => {
      const event: NormalizedSecurityEvent = buildAuditRecordEvent(
        record({ resourceType, action, resourceName: "Secret Name" }),
        TODAYS_READERS,
      )!;

      expect(event.message).toBe(`alice@example.com ${said}`);
      expect(event.targetResource).toBe(
        `${resourceType}: 0192f1a0-0000-7000-8000-00000000a002`,
      );
      expect(textOfEvent(event)).not.toContain("Secret Name");
    },
  );

  test("an MCP client's authorization keeps the client it was made through: the actor's", () => {
    const authorized: AuditScanRecord = record({
      resourceType: AuditResourceType.McpClientAuthorization,
      resourceName: "grant-for-claude",
      mcpClientName: "Claude Desktop",
    });
    const event: NormalizedSecurityEvent = buildAuditRecordEvent(
      authorized,
      TODAYS_READERS,
    )!;

    expect(event.message).toBe(
      'alice@example.com authorized the MCP client "Claude Desktop"',
    );
    expect(event.attributes[AUDIT_ATTRIBUTES.mcpClientName]).toBe(
      "Claude Desktop",
    );
    expect(textOfEvent(event)).not.toContain("grant-for-claude");
  });

  test("an API key that acts is the actor, and is named as one", () => {
    const event: NormalizedSecurityEvent = buildAuditRecordEvent(
      record({
        userId: "",
        userName: "",
        userEmail: "",
        userType: "API",
        apiKeyId: "0192f1a0-0000-7000-8000-00000000a00b",
        apiKeyName: "ci",
        resourceType: AuditResourceType.Team,
        action: AuditLogAction.Delete,
        resourceName: "Incident Commanders",
      }),
      TODAYS_READERS,
    )!;

    expect(event.message).toBe('The API key "ci" deleted a team');
    expect(event.principalUser).toBe("ci");
    expect(textOfEvent(event)).not.toContain("Incident Commanders");
  });

  test("a record with no name and no id is still said by its type", () => {
    expect(
      describeAuditTarget({
        resourceType: AuditResourceType.Team,
        resourceId: "",
        resourceName: "",
      }),
    ).toBe(AuditResourceType.Team);
    expect(
      describeAuditTarget({
        resourceType: AuditResourceType.Team,
        resourceId: "0192f1a0-0000-7000-8000-00000000a002",
        resourceName: "Ops",
      }),
    ).toBe("Team: Ops");
  });
});

describe("a mass delete", () => {
  const row: (overrides?: Partial<MassDeleteRow>) => MassDeleteRow = (
    overrides: Partial<MassDeleteRow> = {},
  ): MassDeleteRow => {
    return {
      userId: "0192f1a0-0000-7000-8000-00000000a003",
      userName: "Mallory",
      userEmail: "mallory@example.com",
      userType: "User",
      apiKeyId: "",
      apiKeyName: "",
      mcpClientName: "",
      workflowId: "",
      workflowName: "",
      workflowRunAs: "",
      workflowRunAsCustomRoleName: "",
      workflowRunAsGiverName: "",
      workflowRunAsGiverApiKeyId: "",
      deletes: 40,
      sampleResourceTypes: ["Monitor", "Incident", "Status Page"],
      firstAt: new Date("2026-10-27T10:00:00.000Z"),
      lastAt: new Date("2026-10-27T10:03:30.000Z"),
      ...overrides,
    };
  };

  test("is one actor deleting many records in a few minutes", () => {
    const event: NormalizedSecurityEvent = buildMassDeleteEvent(
      row(),
      new Date("2026-10-27T10:00:00.000Z"),
    )!;

    expect(event.message).toBe(
      "mallory@example.com deleted 40 records in 4 minutes (Incident, Monitor, Status Page)",
    );
    expect(event.severityName).toBe(OcsfSeverity.High);
    expect(event.principalUser).toBe("mallory@example.com");
    expect(event.attributes[AUDIT_ATTRIBUTES.deletes]).toBe("40");
    expect(event.eventUid).toBe(
      "audit:mass-delete:0192f1a0-0000-7000-8000-00000000a003:2026-10-27T10:00:00.000Z",
    );
    expect(event.mitreTechniques).toEqual(["T1485"]);
  });

  test("starts at the threshold", () => {
    expect(
      buildMassDeleteEvent(
        row({ deletes: MASS_DELETE_MIN_DELETES }),
        new Date(),
      ),
    ).not.toBeNull();
    expect(
      buildMassDeleteEvent(
        row({ deletes: MASS_DELETE_MIN_DELETES - 1 }),
        new Date(),
      ),
    ).toBeNull();
  });

  test("an API key's deletes are said as the key's, and a minute is one", () => {
    const event: NormalizedSecurityEvent = buildMassDeleteEvent(
      row({
        userId: "",
        userName: "",
        userEmail: "",
        apiKeyId: "0192f1a0-0000-7000-8000-00000000a009",
        apiKeyName: "terraform",
        lastAt: new Date("2026-10-27T10:00:00.000Z"),
        sampleResourceTypes: [],
      }),
      new Date("2026-10-27T10:00:00.000Z"),
    )!;

    expect(event.message).toBe(
      'The API key "terraform" deleted 40 records in 1 minute',
    );
    expect(event.principalUser).toBe("terraform");
  });
});
