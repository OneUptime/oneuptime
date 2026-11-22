import { describe, expect, test } from "@jest/globals";
import AuditLogAction from "../../../../Types/AuditLog/AuditLogAction";
import {
  DETECTION_RULE_LIBRARY,
  DetectionRuleLibraryEntry,
} from "../../../../Types/SecurityEvent/DetectionRuleLibrary";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../../Types/SecurityEvent/OcsfSeverity";
import {
  ONEUPTIME_PRINCIPAL,
  getWorkflowIdOfPrincipal,
  getWorkflowPrincipal,
  isOneUptimeActorPrincipal,
} from "../../../../Types/SecurityEvent/OneUptimeActorPrincipal";
import {
  SECURITY_TELEMETRY_SIGNAL_ATTRIBUTE,
  SecurityTelemetrySignal,
} from "../../../../Types/SecurityEvent/SecurityTelemetrySource";
import { WorkflowRunAs } from "../../../../Types/Workflow/WorkflowRunAs";
import {
  AUDIT_ATTRIBUTES,
  AUDIT_SYSTEM_ACTOR_TYPE,
  AuditActor,
  AuditResourceType,
  AuditScanRecord,
  MassDeleteRow,
  buildAuditRecordEvent,
  buildMassDeleteEvent,
  describeAuditActor,
  getAuditActorPrincipal,
  isOneUptimeAuditActor,
} from "../../../../Utils/SecurityEvent/TelemetryScan/AuditLogSignals";

/*
 * WHO DELETED THEM (#10430). Security Events summed OneUptime's audit log
 * deletes by userId and apiKeyId alone. A workflow's step acts as no person
 * and no key, and neither does OneUptime's own bookkeeping, so every
 * workflow's deletes in a window - and OneUptime's own - were one actor,
 * "Someone", and a cleanup workflow doing its job, or two workflows deleting
 * 15 records each, opened a High "Someone deleted N records" case nobody
 * could act on.
 *
 * Each actor is its own now: a workflow is named, with what it ran as and
 * whose permissions those were, under a principal of its own
 * ("workflow:<id>"); OneUptime's own bookkeeping is "OneUptime",
 * Informational, under a signal no recommended rule reads; and an entry
 * that names nobody still says "Someone" - never a guess.
 */

const WINDOW_START: Date = new Date("2026-11-20T10:00:00.000Z");
const NIGHTLY_ID: string = "0192f1a0-0000-7000-8000-00000000b001";
const ARCHIVER_ID: string = "0192f1a0-0000-7000-8000-00000000b002";
const JANE_ID: string = "0192f1a0-0000-7000-8000-00000000b003";
const KEY_ID: string = "0192f1a0-0000-7000-8000-00000000b004";

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

// A workflow's step, as the audit log records one (WorkflowPrincipal).
function workflow(
  id: string,
  name: string,
  overrides: Partial<AuditActor> = {},
): AuditActor {
  return {
    ...NOBODY,
    userType: "Workflow",
    workflowId: id,
    workflowName: name,
    workflowRunAs: WorkflowRunAs.Default,
    ...overrides,
  };
}

// OneUptime's own change, with system events stored (AuditLogRecorder.resolveActor).
const ONEUPTIME: AuditActor = { ...NOBODY, userType: AUDIT_SYSTEM_ACTOR_TYPE };

function deletes(
  actor: AuditActor,
  count: number,
  overrides: Partial<MassDeleteRow> = {},
): MassDeleteRow {
  return {
    ...actor,
    deletes: count,
    sampleResourceTypes: ["Monitor", "Incident"],
    firstAt: new Date("2026-11-20T10:00:10.000Z"),
    lastAt: new Date("2026-11-20T10:02:40.000Z"),
    ...overrides,
  };
}

function record(
  actor: AuditActor,
  overrides: Partial<AuditScanRecord> = {},
): AuditScanRecord {
  return {
    ...actor,
    id: "0192f1a0-0000-7000-8000-00000000b0a1",
    createdAt: new Date("2026-11-20T10:00:00.000Z"),
    resourceType: AuditResourceType.TeamCustomRole,
    resourceId: "0192f1a0-0000-7000-8000-00000000b0a2",
    resourceName: "Admins",
    action: AuditLogAction.Create,
    ...overrides,
  };
}

function signalOf(event: NormalizedSecurityEvent): unknown {
  return event.attributes[SECURITY_TELEMETRY_SIGNAL_ATTRIBUTE];
}

describe("deletes by several workflows", () => {
  test("two workflows deleting 15 records each are two actors under the threshold: no event, so no finding", () => {
    expect(
      buildMassDeleteEvent(
        deletes(workflow(NIGHTLY_ID, "Nightly Cleanup"), 15),
        WINDOW_START,
      ),
    ).toBeNull();
    expect(
      buildMassDeleteEvent(
        deletes(workflow(ARCHIVER_ID, "Archive Old Incidents"), 15),
        WINDOW_START,
      ),
    ).toBeNull();
  });

  test("two workflows over it are two events, each naming its workflow, each its own principal", () => {
    const nightly: NormalizedSecurityEvent = buildMassDeleteEvent(
      deletes(workflow(NIGHTLY_ID, "Nightly Cleanup"), 30),
      WINDOW_START,
    )!;
    const archiver: NormalizedSecurityEvent = buildMassDeleteEvent(
      deletes(workflow(ARCHIVER_ID, "Archive Old Incidents"), 40),
      WINDOW_START,
    )!;

    expect(nightly.message).toBe(
      'The workflow "Nightly Cleanup" deleted 30 records in 3 minutes (Incident, Monitor)',
    );
    expect(archiver.message).toBe(
      'The workflow "Archive Old Incidents" deleted 40 records in 3 minutes (Incident, Monitor)',
    );
    expect(nightly.principalUser).toBe(`workflow:${NIGHTLY_ID}`);
    expect(archiver.principalUser).toBe(`workflow:${ARCHIVER_ID}`);
    expect(nightly.eventUid).not.toBe(archiver.eventUid);
    expect(nightly.observables).toContain(`workflow:${NIGHTLY_ID}`);
    expect(archiver.observables).not.toContain(`workflow:${NIGHTLY_ID}`);
  });

  test("one workflow deleting 30 is a High mass delete that names it", () => {
    const event: NormalizedSecurityEvent = buildMassDeleteEvent(
      deletes(workflow(NIGHTLY_ID, "Nightly Cleanup"), 30),
      WINDOW_START,
    )!;

    expect(signalOf(event)).toBe(SecurityTelemetrySignal.MassDelete);
    expect(event.severityName).toBe(OcsfSeverity.High);
    expect(event.eventUid).toBe(
      `audit:mass-delete:workflow:${NIGHTLY_ID}:2026-11-20T10:00:00.000Z`,
    );
    expect(event.mitreTechniques).toEqual(["T1485"]);
    expect(event.attributes[AUDIT_ATTRIBUTES.actorType]).toBe("Workflow");
    expect(event.attributes[AUDIT_ATTRIBUTES.workflowId]).toBe(NIGHTLY_ID);
    expect(event.attributes[AUDIT_ATTRIBUTES.workflowName]).toBe(
      "Nightly Cleanup",
    );
    expect(event.attributes[AUDIT_ATTRIBUTES.workflowRunAs]).toBe("Default");
    expect(event.attributes[AUDIT_ATTRIBUTES.deletes]).toBe("30");
  });

  test("a workflow renamed is still one principal: its id, not its name", () => {
    const before: NormalizedSecurityEvent = buildMassDeleteEvent(
      deletes(workflow(NIGHTLY_ID, "Nightly Cleanup"), 30),
      WINDOW_START,
    )!;
    const after: NormalizedSecurityEvent = buildMassDeleteEvent(
      deletes(workflow(NIGHTLY_ID, "Cleanup (nightly)"), 30),
      WINDOW_START,
    )!;

    expect(before.principalUser).toBe(after.principalUser);
    expect(before.eventUid).toBe(after.eventUid);
  });
});

describe("what a workflow ran as, and whose permissions", () => {
  test("Project Owner, given by a person", () => {
    const actor: AuditActor = workflow(NIGHTLY_ID, "Nightly Cleanup", {
      workflowRunAs: WorkflowRunAs.ProjectOwner,
      workflowRunAsGiverName: "Jane Doe",
    });
    const event: NormalizedSecurityEvent = buildMassDeleteEvent(
      deletes(actor, 30),
      WINDOW_START,
    )!;

    expect(event.message).toBe(
      'The workflow "Nightly Cleanup", running as Project Owner with the permissions Jane Doe gave it, deleted 30 records in 3 minutes (Incident, Monitor)',
    );
    expect(event.attributes[AUDIT_ATTRIBUTES.workflowRunAs]).toBe(
      "ProjectOwner",
    );
    expect(event.attributes[AUDIT_ATTRIBUTES.workflowRunAsGivenBy]).toBe(
      "Jane Doe",
    );
    // The giver is named, never made the principal: the workflow acted.
    expect(event.principalUser).toBe(`workflow:${NIGHTLY_ID}`);
  });

  test("a custom role, given by an API key", () => {
    const actor: AuditActor = workflow(NIGHTLY_ID, "Nightly Cleanup", {
      workflowRunAs: WorkflowRunAs.CustomRole,
      workflowRunAsCustomRoleName: "Cleanup Crew",
      workflowRunAsGiverName: "terraform",
      workflowRunAsGiverApiKeyId: KEY_ID,
    });

    expect(describeAuditActor(actor)).toBe(
      'The workflow "Nightly Cleanup", running as the custom role "Cleanup Crew" with the permissions the API key "terraform" gave it,',
    );
    expect(
      buildMassDeleteEvent(deletes(actor, 30), WINDOW_START)!.attributes[
        AUDIT_ATTRIBUTES.workflowRunAsRole
      ],
    ).toBe("Cleanup Crew");
  });

  test("raised with no giver recorded says what it ran as, and no more", () => {
    expect(
      describeAuditActor(
        workflow(NIGHTLY_ID, "Nightly Cleanup", {
          workflowRunAs: WorkflowRunAs.ProjectOwner,
        }),
      ),
    ).toBe('The workflow "Nightly Cleanup", running as Project Owner,');
  });

  test("the default permissions, or a Run As this version cannot read, add nothing", () => {
    for (const workflowRunAs of ["", "Default", "Superuser"]) {
      expect(
        describeAuditActor(
          workflow(NIGHTLY_ID, "Nightly Cleanup", { workflowRunAs }),
        ),
      ).toBe('The workflow "Nightly Cleanup"');
    }
  });

  test("a workflow's own change says what it ran as too", () => {
    const event: NormalizedSecurityEvent = buildAuditRecordEvent(
      record(
        workflow(NIGHTLY_ID, "Access Sync", {
          workflowRunAs: WorkflowRunAs.ProjectOwner,
          workflowRunAsGiverName: "Jane Doe",
        }),
      ),
    )!;

    expect(event.message).toBe(
      'The workflow "Access Sync", running as Project Owner with the permissions Jane Doe gave it, gave a team a custom role "Admins"',
    );
    expect(event.principalUser).toBe(`workflow:${NIGHTLY_ID}`);
    expect(signalOf(event)).toBe(SecurityTelemetrySignal.RoleChanged);
  });
});

describe("OneUptime's own deletes", () => {
  test("with system events stored, they are OneUptime's: Informational, under a signal of their own", () => {
    const event: NormalizedSecurityEvent = buildMassDeleteEvent(
      deletes(ONEUPTIME, 400, { sampleResourceTypes: ["Team Member"] }),
      WINDOW_START,
    )!;

    expect(event.message).toBe(
      "OneUptime deleted 400 records in 3 minutes (Team Member): its own work, such as a scheduled cleanup, a SCIM sync or what another delete took with it",
    );
    expect(event.severityName).toBe(OcsfSeverity.Informational);
    expect(signalOf(event)).toBe(SecurityTelemetrySignal.OneUptimeMassDelete);
    expect(event.principalUser).toBe(ONEUPTIME_PRINCIPAL);
    expect(event.eventUid).toBe(
      "audit:oneuptime-mass-delete:oneuptime:2026-11-20T10:00:00.000Z",
    );
    // Bookkeeping stands for no attack.
    expect(event.mitreTactics).toEqual([]);
    expect(event.mitreTechniques).toEqual([]);
  });

  test("no rule of the library reads OneUptime's own deletes, and the mass delete rule still reads everyone else's", () => {
    const readers: Array<DetectionRuleLibraryEntry> =
      DETECTION_RULE_LIBRARY.filter(
        (entry: DetectionRuleLibraryEntry): boolean => {
          return entry.sigmaRuleYaml.includes(
            SecurityTelemetrySignal.OneUptimeMassDelete,
          );
        },
      );
    const massDelete: DetectionRuleLibraryEntry = DETECTION_RULE_LIBRARY.find(
      (entry: DetectionRuleLibraryEntry): boolean => {
        return entry.id === "51a51214-ca6e-43bc-b9ba-abf06cf4a135";
      },
    )!;

    expect(readers).toEqual([]);
    expect(massDelete.sigmaRuleYaml).toContain(
      `oneuptime.signal: ${SecurityTelemetrySignal.MassDelete}\n`,
    );
    expect(massDelete.description).toContain("workflow");
  });

  test("a System entry that names a person is that person's, and fails toward them: High", () => {
    const event: NormalizedSecurityEvent = buildMassDeleteEvent(
      deletes(
        {
          ...ONEUPTIME,
          userId: JANE_ID,
          userEmail: "jane@example.com",
        },
        30,
      ),
      WINDOW_START,
    )!;

    expect(isOneUptimeAuditActor({ ...ONEUPTIME, userId: JANE_ID })).toBe(
      false,
    );
    expect(event.severityName).toBe(OcsfSeverity.High);
    expect(signalOf(event)).toBe(SecurityTelemetrySignal.MassDelete);
    expect(event.principalUser).toBe("jane@example.com");
    expect(event.message.startsWith("jane@example.com deleted 30")).toBe(true);
  });

  test("OneUptime's own change to a team is said as OneUptime's", () => {
    const event: NormalizedSecurityEvent = buildAuditRecordEvent(
      record(ONEUPTIME, {
        resourceType: AuditResourceType.Team,
        action: AuditLogAction.Delete,
        resourceName: "Ops",
      }),
    )!;

    expect(event.message).toBe('OneUptime deleted the team "Ops"');
    expect(event.principalUser).toBe(ONEUPTIME_PRINCIPAL);
  });
});

describe("when the audit log does not say who", () => {
  test("an entry that names nobody says Someone, and stays High: a person looks", () => {
    const event: NormalizedSecurityEvent = buildMassDeleteEvent(
      deletes(NOBODY, 40),
      WINDOW_START,
    )!;

    expect(event.message.startsWith("Someone deleted 40 records")).toBe(true);
    expect(event.severityName).toBe(OcsfSeverity.High);
    expect(event.principalUser).toBe("");
  });

  test("a workflow's entry from before workflows were named says a workflow, not which", () => {
    const event: NormalizedSecurityEvent = buildMassDeleteEvent(
      deletes({ ...NOBODY, userType: "Workflow" }, 40),
      WINDOW_START,
    )!;

    expect(event.message.startsWith("A workflow deleted 40 records")).toBe(
      true,
    );
    expect(event.principalUser).toBe("");
    expect(event.severityName).toBe(OcsfSeverity.High);
  });

  test("an API key's entry without its name says an API key", () => {
    expect(describeAuditActor({ ...NOBODY, userType: "API" })).toBe(
      "An API key",
    );
  });

  test("a person and a key are named as they always were", () => {
    expect(
      getAuditActorPrincipal({
        ...NOBODY,
        userType: "User",
        userId: JANE_ID,
        userEmail: "jane@example.com",
      }),
    ).toBe("jane@example.com");
    expect(
      getAuditActorPrincipal({
        ...NOBODY,
        userType: "API",
        apiKeyId: KEY_ID,
        apiKeyName: "terraform",
      }),
    ).toBe("terraform");
    expect(
      buildMassDeleteEvent(
        deletes(
          {
            ...NOBODY,
            userType: "API",
            apiKeyId: KEY_ID,
            apiKeyName: "terraform",
          },
          30,
        ),
        WINDOW_START,
      )!.eventUid,
    ).toBe(`audit:mass-delete:${KEY_ID}:2026-11-20T10:00:00.000Z`);
  });
});

describe("a workflow's and OneUptime's principals", () => {
  test("are made from a workflow's id, and read back from it", () => {
    expect(getWorkflowPrincipal(NIGHTLY_ID)).toBe(`workflow:${NIGHTLY_ID}`);
    expect(getWorkflowPrincipal(NIGHTLY_ID.toUpperCase())).toBe(
      `workflow:${NIGHTLY_ID}`,
    );
    expect(getWorkflowIdOfPrincipal(`Workflow:${NIGHTLY_ID}`)).toBe(NIGHTLY_ID);
    expect(getWorkflowPrincipal("")).toBe("");
    expect(getWorkflowPrincipal("nightly-cleanup")).toBe("");
    expect(getWorkflowPrincipal(undefined)).toBe("");
  });

  test("are OneUptime's own actors, whatever their case; a person is not", () => {
    expect(isOneUptimeActorPrincipal(`workflow:${NIGHTLY_ID}`)).toBe(true);
    expect(isOneUptimeActorPrincipal(`WORKFLOW:${NIGHTLY_ID}`)).toBe(true);
    expect(isOneUptimeActorPrincipal("oneuptime")).toBe(true);
    expect(isOneUptimeActorPrincipal("OneUptime")).toBe(true);
    expect(isOneUptimeActorPrincipal("workflow:nightly")).toBe(false);
    expect(isOneUptimeActorPrincipal("jane@example.com")).toBe(false);
    expect(isOneUptimeActorPrincipal("oneuptime-bot")).toBe(false);
    expect(isOneUptimeActorPrincipal(undefined)).toBe(false);
  });
});
