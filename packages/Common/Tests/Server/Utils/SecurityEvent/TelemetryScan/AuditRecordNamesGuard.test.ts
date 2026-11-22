import "../../../TestingUtils/Init";
import { describe, expect, test } from "@jest/globals";
import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import TablePermission from "../../../../../Server/Types/Database/Permissions/TablePermission";
import AuditLogReadAccess from "../../../../../Server/Utils/AuditLog/AuditLogReadAccess";
import AuditRecordNameReaders from "../../../../../Server/Utils/SecurityEvent/TelemetryScan/AuditRecordNameReaders";
import SecurityEvent from "../../../../../Models/AnalyticsModels/SecurityEvent";
import AllDatabaseModelTypes from "../../../../../Models/DatabaseModels/Index";
import { DatabaseBaseModelType } from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AuditLogAction from "../../../../../Types/AuditLog/AuditLogAction";
import Permission from "../../../../../Types/Permission";
import NormalizedSecurityEvent from "../../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import { getAuditLogResourceTypeSpellings } from "../../../../../Utils/AuditLog/AuditLogResourceTypes";
import {
  AUDIT_ATTRIBUTES,
  AUDIT_SECURITY_RESOURCE_TYPES,
  AuditResourceType,
  AuditScanRecord,
  buildAuditRecordEvent,
  classifyAuditRecord,
} from "../../../../../Utils/SecurityEvent/TelemetryScan/AuditLogSignals";

/*
 * GUARD (#10663): EVERY KIND OF RECORD THE AUDIT LOG'S SECURITY SCAN TURNS
 * INTO A SECURITY EVENT, DECIDED ON PURPOSE.
 *
 * A security event about a change in OneUptime is read by every reader of
 * security events - Project Owner and Admin, the Security tiers and Read
 * Security Event - and names its record only when every one of them reads
 * the record's table (AuditRecordNameReaders). Below is each type
 * classifyAuditRecord reports, whether Security Viewer reads its records,
 * and whether its events name them. A new type the scan reports, or a read
 * list that changes under one of these, fails here until it is decided:
 *
 *   - securityViewerReads: Security Viewer is on the type's table read list;
 *   - named: its events carry the record's name - in the message, the
 *     target and `audit.resource_name`. Only when every permission that
 *     reads security events reads the table; an API key with Read Security
 *     Event alone reads no playbook, so even a playbook's name is withheld.
 *
 * A person in the project reads its teams as a project user, but an API key
 * holding a Security tier does not, so a team's name is withheld too.
 */
const DECIDED: Record<
  AuditResourceType,
  { securityViewerReads: boolean; named: boolean }
> = {
  [AuditResourceType.ApiKey]: { securityViewerReads: false, named: false },
  [AuditResourceType.CustomRole]: { securityViewerReads: false, named: false },
  [AuditResourceType.ApiKeyCustomRole]: {
    securityViewerReads: false,
    named: false,
  },
  [AuditResourceType.TeamCustomRole]: {
    securityViewerReads: false,
    named: false,
  },
  [AuditResourceType.Team]: { securityViewerReads: false, named: false },
  [AuditResourceType.McpClientAuthorization]: {
    securityViewerReads: false,
    named: false,
  },
  [AuditResourceType.PacketCapture]: {
    securityViewerReads: false,
    named: false,
  },
  [AuditResourceType.ProtectedEntity]: {
    securityViewerReads: true,
    named: false,
  },
  [AuditResourceType.AuditLogExport]: {
    securityViewerReads: false,
    named: false,
  },
  [AuditResourceType.SecurityPlaybook]: {
    securityViewerReads: true,
    named: false,
  },
};

const ALL_ACTIONS: Array<string> = Object.values(AuditLogAction);

// Every type an audit log entry can be stored under: each model's, in each spelling.
function everyStoredResourceType(): Array<string> {
  const types: Set<string> = new Set<string>();

  for (const modelType of AllDatabaseModelTypes as Array<DatabaseBaseModelType>) {
    const resourceType: string | null = AuditLogReadAccess.getResourceTypeOf(
      new modelType(),
    );

    if (!resourceType) {
      continue;
    }

    for (const spelling of getAuditLogResourceTypeSpellings(resourceType)) {
      types.add(spelling);
    }
  }

  return Array.from(types).sort();
}

// The types classifyAuditRecord makes a security event of, for some action.
function reportedResourceTypes(): Array<string> {
  return everyStoredResourceType().filter((resourceType: string): boolean => {
    return ALL_ACTIONS.some((action: string): boolean => {
      return classifyAuditRecord({ resourceType, action }) !== null;
    });
  });
}

// An action that makes a signal of the type, for an event to be built of it.
function signalActionOf(resourceType: string): string {
  return ALL_ACTIONS.find((action: string): boolean => {
    return classifyAuditRecord({ resourceType, action }) !== null;
  })!;
}

function namedRecordOf(resourceType: string): AuditScanRecord {
  return {
    id: "0192f1a0-0000-7000-8000-00000000c001",
    createdAt: new Date("2026-11-22T10:00:00.000Z"),
    resourceType,
    resourceId: "0192f1a0-0000-7000-8000-00000000c002",
    resourceName: "Name Only Its Readers Read",
    action: signalActionOf(resourceType),
    userId: "0192f1a0-0000-7000-8000-00000000c003",
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
  };
}

function tableReadersOf(modelType: DatabaseBaseModelType): Array<Permission> {
  return TablePermission.getTablePermission(
    modelType,
    DatabaseRequestType.Read,
  );
}

describe("what a security event about a OneUptime change says of its record", () => {
  test("every type classifyAuditRecord reports is decided here, and nothing else is", () => {
    expect(reportedResourceTypes()).toEqual(
      Object.keys(DECIDED).sort((a: string, b: string): number => {
        return a.localeCompare(b);
      }),
    );
    expect([...AUDIT_SECURITY_RESOURCE_TYPES].sort()).toEqual(
      Object.keys(DECIDED).sort(),
    );
  });

  test("the scan reads the readers of security events from SecurityEvent's read list", () => {
    const eventReaders: Array<Permission> =
      AuditRecordNameReaders.getEventReaders();

    expect(eventReaders).toEqual(new SecurityEvent().getReadPermissions());
    // The readers this guard is about: none of them may be dropped unseen.
    expect(eventReaders).toEqual(
      expect.arrayContaining([
        Permission.SecurityViewer,
        Permission.ReadSecurityEvent,
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
      ]),
    );
  });

  test.each(Object.keys(DECIDED))(
    "%s: its records are found, and Security Viewer reads them as decided",
    (resourceType: string) => {
      const modelTypes: Array<DatabaseBaseModelType> =
        AuditLogReadAccess.getModelTypesOf(resourceType);

      expect([resourceType, modelTypes.length > 0]).toEqual([
        resourceType,
        true,
      ]);

      const securityViewerReads: boolean = modelTypes.every(
        (modelType: DatabaseBaseModelType): boolean => {
          return tableReadersOf(modelType).includes(Permission.SecurityViewer);
        },
      );

      expect([resourceType, securityViewerReads]).toEqual([
        resourceType,
        DECIDED[resourceType as AuditResourceType].securityViewerReads,
      ]);
    },
  );

  test.each(Object.keys(DECIDED))(
    "%s: its events name the record as decided, and only where every reader of security events reads it",
    (resourceType: string) => {
      const decided: boolean = DECIDED[resourceType as AuditResourceType].named;
      const everyEventReaderReads: boolean = AuditLogReadAccess.getModelTypesOf(
        resourceType,
      ).every((modelType: DatabaseBaseModelType): boolean => {
        const readers: Array<Permission> = tableReadersOf(modelType);

        return AuditRecordNameReaders.getEventReaders().every(
          (permission: Permission): boolean => {
            return readers.includes(permission);
          },
        );
      });

      expect([
        resourceType,
        AuditRecordNameReaders.isNameWritten(resourceType),
      ]).toEqual([resourceType, decided]);
      // Never named where one reader of security events may not read it.
      expect(decided && !everyEventReaderReads).toBe(false);

      const event: NormalizedSecurityEvent = buildAuditRecordEvent(
        namedRecordOf(resourceType),
        AuditRecordNameReaders.get(),
      )!;
      const said: string = JSON.stringify(event);

      expect([
        resourceType,
        said.includes("Name Only Its Readers Read"),
      ]).toEqual([resourceType, decided]);
      expect([
        resourceType,
        event.attributes[AUDIT_ATTRIBUTES.resourceName] !== undefined,
      ]).toEqual([resourceType, decided]);

      // What is kept for every reader: the type, the id and who changed it.
      expect(event.attributes[AUDIT_ATTRIBUTES.resourceType]).toBe(
        resourceType,
      );
      expect(event.attributes[AUDIT_ATTRIBUTES.resourceId]).toBe(
        "0192f1a0-0000-7000-8000-00000000c002",
      );
      expect(event.principalUser).toBe("alice@example.com");
    },
  );

  test("a type no model has reads no record, so names none", () => {
    expect(AuditRecordNameReaders.getRecordReaders("No Such Thing")).toEqual(
      [],
    );
    expect(AuditRecordNameReaders.isNameWritten("No Such Thing")).toBe(false);
  });

  test("the readers are worked out once, and are the models' own", () => {
    expect(AuditRecordNameReaders.get()).toBe(AuditRecordNameReaders.get());
    expect(
      AuditRecordNameReaders.get().getRecordReaders(AuditResourceType.ApiKey),
    ).toEqual(
      AuditRecordNameReaders.getRecordReaders(AuditResourceType.ApiKey),
    );
  });
});
