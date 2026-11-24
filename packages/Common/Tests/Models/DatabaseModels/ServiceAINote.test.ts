import ServiceAINote, {
  MAX_SERVICE_AI_NOTE_LENGTH,
  SERVICE_AI_NOTE_CREATE_PERMISSIONS,
  SERVICE_AI_NOTE_DELETE_PERMISSIONS,
  SERVICE_AI_NOTE_READ_PERMISSIONS,
  SERVICE_AI_NOTE_UPDATE_PERMISSIONS,
} from "../../../Models/DatabaseModels/ServiceAINote";
import Service from "../../../Models/DatabaseModels/Service";
import { readServiceAINoteText } from "../../../Server/Services/ServiceAINoteService";
import OwnedScopePermission from "../../../Server/Types/Database/Permissions/OwnedScopePermission";
import { PRODUCT_RECORD_TABLES } from "../../../Types/Product/ProductRecordTables";
import ProductKey from "../../../Types/Product/ProductKey";
import EnableAuditLogOn from "../../../Types/BaseDatabase/EnableAuditLogOn";
import BadDataException from "../../../Types/Exception/BadDataException";
import { isErrorSentence } from "../../../Types/Exception/ErrorMessageRule";
import Permission, { PermissionHelper } from "../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT A SERVICE'S TEAM TELLS ONEUPTIME AI ABOUT IT (#7672): a note on the
 * service, read like the service and audited like it.
 *
 *  - Read by whoever may read the service, through it: a role limited to
 *    some labels or to what its members own reads the notes of those
 *    services only (OwnedThrough), and a reader of a note may read its
 *    service (CanAccessIfCanReadOn).
 *  - Written, edited and deleted by whoever may write about the service,
 *    or holds the note's own permission; a Viewer only reads.
 *  - Every change is in the service's audit log (rootResource), named by
 *    the note's own words.
 *  - A record of the Services product, so its writes stop while Services is
 *    switched off on the server.
 *  - Its text is a person's: some words, at most MAX_SERVICE_AI_NOTE_LENGTH
 *    characters, trimmed; a refusal says what to change.
 */

describe("ServiceAINote", () => {
  const note: ServiceAINote = new ServiceAINote();

  test("is a table of its own, in the project, with a CRUD route", () => {
    expect(note.tableName).toBe("ServiceAINote");
    expect(note.getTenantColumn()).toBe("projectId");
    expect(note.crudApiPath?.toString()).toBe("/service-ai-note");
  });

  test("is read through its service", () => {
    expect(OwnedScopePermission.getOwnedThrough(ServiceAINote)).toEqual(
      expect.objectContaining({ fkColumn: "serviceId" }),
    );
    expect(
      OwnedScopePermission.getOwnedThrough(ServiceAINote)!.parentModels,
    ).toContain(Service);
    expect(note.canAccessIfCanReadOn).toBe("service");
  });

  test("whoever may read a service reads its notes; a Viewer never writes one", () => {
    expect(note.getReadPermissions()).toEqual(
      expect.arrayContaining([
        Permission.ProjectMember,
        Permission.Viewer,
        Permission.ReadServiceAINote,
      ]),
    );

    for (const permissions of [
      SERVICE_AI_NOTE_CREATE_PERMISSIONS,
      SERVICE_AI_NOTE_UPDATE_PERMISSIONS,
      SERVICE_AI_NOTE_DELETE_PERMISSIONS,
    ]) {
      expect(permissions).toContain(Permission.ProjectMember);
      expect(permissions).not.toContain(Permission.Viewer);
      expect(permissions).not.toContain(Permission.SettingsViewer);
    }

    expect(SERVICE_AI_NOTE_CREATE_PERMISSIONS).toContain(
      Permission.CreateServiceAINote,
    );
    expect(SERVICE_AI_NOTE_UPDATE_PERMISSIONS).toContain(
      Permission.EditServiceAINote,
    );
    expect(SERVICE_AI_NOTE_DELETE_PERMISSIONS).toContain(
      Permission.DeleteServiceAINote,
    );
    expect(SERVICE_AI_NOTE_READ_PERMISSIONS).toContain(
      Permission.ReadServiceAINote,
    );
  });

  test("its own permissions can be given to a team or an API key", () => {
    for (const permission of [
      Permission.CreateServiceAINote,
      Permission.EditServiceAINote,
      Permission.DeleteServiceAINote,
      Permission.ReadServiceAINote,
    ]) {
      expect(PermissionHelper.isAssignableToTenant(permission)).toBe(true);
      expect(PermissionHelper.getTitle(permission)).toMatch(/Service AI Note$/);
    }
  });

  test("who wrote a note is OneUptime's to write, never the request's; who deleted it is no column", () => {
    expect(note.getColumnAccessControlFor("createdByUserId")?.create).toEqual(
      [],
    );
    expect(note.hasColumn("deletedByUserId")).toBe(false);
    // With Services' levels (#10289), which follow the project-wide roles.
    expect(note.getColumnAccessControlFor("note")?.update).toEqual([
      ...SERVICE_AI_NOTE_UPDATE_PERMISSIONS,
      Permission.ServiceAdmin,
      Permission.ServiceMember,
    ]);
    expect(note.getColumnAccessControlFor("serviceId")?.update).toEqual([]);
  });

  test("every change is in the service's audit log, named by the note", () => {
    const audit: EnableAuditLogOn | undefined = note.enableAuditLogOn;

    expect(audit).toEqual(
      expect.objectContaining({
        create: true,
        update: true,
        delete: true,
        rootResource: { resourceType: "Service", column: "serviceId" },
        resourceNameColumns: ["note"],
      }),
    );
  });

  test("is a record of the Services product", () => {
    expect(PRODUCT_RECORD_TABLES[ProductKey.Services]).toContain(
      "ServiceAINote",
    );
  });
});

describe("a note's text", () => {
  test("is kept trimmed", () => {
    expect(readServiceAINoteText("  Failover takes five minutes.\n")).toBe(
      "Failover takes five minutes.",
    );
  });

  test.each([[""], ["   \n\t"], [undefined], [null], [42]])(
    "with no words (%p) is refused, saying what to write",
    (value: unknown) => {
      expect(() => {
        return readServiceAINoteText(value);
      }).toThrow(BadDataException);

      try {
        readServiceAINoteText(value);
      } catch (error) {
        expect(isErrorSentence((error as Error).message)).toBe(true);
      }
    },
  );

  test("longer than the limit is refused, saying how long it is and what to do", () => {
    const text: string = "x".repeat(MAX_SERVICE_AI_NOTE_LENGTH + 1);

    expect(() => {
      return readServiceAINoteText(text);
    }).toThrow(
      `A note can be at most ${MAX_SERVICE_AI_NOTE_LENGTH} characters, and this one is ${MAX_SERVICE_AI_NOTE_LENGTH + 1}. Shorten it, or write it as two notes.`,
    );
    expect(readServiceAINoteText("x".repeat(MAX_SERVICE_AI_NOTE_LENGTH))).toBe(
      "x".repeat(MAX_SERVICE_AI_NOTE_LENGTH),
    );
  });
});
