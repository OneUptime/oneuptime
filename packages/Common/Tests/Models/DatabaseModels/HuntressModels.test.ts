import HuntressConnection from "../../../Models/DatabaseModels/HuntressConnection";
import HuntressIncidentReport from "../../../Models/DatabaseModels/HuntressIncidentReport";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import Dictionary from "../../../Types/Dictionary";
import HuntressSeverity from "../../../Types/Huntress/HuntressSeverity";
import Permission from "../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";

/*
 * Who may do what with a Huntress connection and the reports it received,
 * and what the tables promise: the signing secret is never read back, the
 * report rows are written only by the webhook and stay unique per report,
 * and deleting what a row points at never deletes the row's history.
 */

const ADMINS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
];

const READERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.IncidentAdmin,
  Permission.IncidentMember,
  Permission.IncidentViewer,
];

function columnAccess(
  model: HuntressConnection | HuntressIncidentReport,
): Dictionary<ColumnAccessControl> {
  return model.getColumnAccessControlForAllColumns();
}

function relation(target: Function, propertyName: string): RelationMetadataArgs {
  const found: RelationMetadataArgs | undefined =
    getMetadataArgsStorage().relations.find(
      (candidate: RelationMetadataArgs): boolean => {
        return (
          candidate.target === target && candidate.propertyName === propertyName
        );
      },
    );

  if (!found) {
    throw new Error(`No relation ${propertyName}`);
  }

  return found;
}

describe("HuntressConnection", () => {
  const model: HuntressConnection = new HuntressConnection();

  test("is configured by the project's admins and read by everyone who reads incidents", () => {
    expect(model.createRecordPermissions).toEqual(ADMINS);
    expect(model.updateRecordPermissions).toEqual(ADMINS);
    expect(model.deleteRecordPermissions).toEqual(ADMINS);
    expect(model.readRecordPermissions).toEqual(READERS);
  });

  test("Incident Admin and Incident Member cannot change who is paged", () => {
    for (const permission of [
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.ProjectMember,
    ]) {
      expect(model.createRecordPermissions).not.toContain(permission);
      expect(model.updateRecordPermissions).not.toContain(permission);
      expect(model.deleteRecordPermissions).not.toContain(permission);
    }
  });

  test("the signing secret is encrypted and never read back by anyone", () => {
    const access: ColumnAccessControl = columnAccess(model)["signingSecret"]!;

    expect(access.read).toEqual([]);
    expect(access.create).toEqual(ADMINS);
    expect(access.update).toEqual(ADMINS);
    expect(model.getTableColumnMetadata("signingSecret").encrypted).toBe(true);
    expect(model.getEncryptedColumns().columns).toEqual(["signingSecret"]);
  });

  test("whether a secret is saved is readable by every reader", () => {
    expect(columnAccess(model)["isSigningSecretSet"]!.read).toEqual(READERS);
  });

  test("only the webhook writes what it last received", () => {
    for (const column of [
      "lastEventReceivedAt",
      "lastEventType",
      "lastError",
      "lastErrorAt",
    ]) {
      expect({ column, access: columnAccess(model)[column] }).toEqual({
        column,
        access: { create: [], read: READERS, update: [] },
      });
    }
  });

  test("starts paging for high and critical reports, and resolving when Huntress closes", () => {
    expect(model.getTableColumnMetadata("pageOnCallFor").defaultValue).toBe(
      HuntressSeverity.High,
    );
    expect(
      model.getTableColumnMetadata("resolveIncidentWhenReportCloses")
        .defaultValue,
    ).toBe(true);
    expect(model.getTableColumnMetadata("isSigningSecretSet").defaultValue).toBe(
      false,
    );
  });

  test("is served at /huntress-connection", () => {
    expect(model.getCrudApiPath()?.toString()).toBe("/huntress-connection");
  });

  test("a deleted incident severity leaves the connection to choose by rank", () => {
    for (const property of [
      "criticalIncidentSeverity",
      "highIncidentSeverity",
      "lowIncidentSeverity",
    ]) {
      expect({
        property,
        onDelete: relation(HuntressConnection, property).options.onDelete,
      }).toEqual({ property, onDelete: "SET NULL" });
    }
  });

  test("is deleted with its project", () => {
    expect(relation(HuntressConnection, "project").options.onDelete).toBe(
      "CASCADE",
    );
  });
});

describe("HuntressIncidentReport", () => {
  const model: HuntressIncidentReport = new HuntressIncidentReport();

  test("is read by everyone who reads incidents and written by no caller", () => {
    expect(model.readRecordPermissions).toEqual(READERS);
    expect(model.createRecordPermissions).toEqual([]);
    expect(model.updateRecordPermissions).toEqual([]);
    expect(model.deleteRecordPermissions).toEqual([]);
  });

  test("no column is writable through the API", () => {
    const access: Dictionary<ColumnAccessControl> = columnAccess(model);

    for (const column of Object.keys(access)) {
      expect({ column, create: access[column]!.create }).toEqual({
        column,
        create: [],
      });
      expect({ column, update: access[column]!.update }).toEqual({
        column,
        update: [],
      });
    }
  });

  test("the webhook message ids it remembers are the server's alone", () => {
    expect(columnAccess(model)["appliedMessageIds"]!.read).toEqual([]);
    expect(
      model.getTableColumnMetadata("appliedMessageIds")
        .hideColumnInDocumentation,
    ).toBe(true);
  });

  test("is unique per project, Huntress account and report id", () => {
    const unique: Array<IndexMetadataArgs> =
      getMetadataArgsStorage().indices.filter(
        (index: IndexMetadataArgs): boolean => {
          return index.target === HuntressIncidentReport && Boolean(index.unique);
        },
      );

    expect(
      unique.map((index: IndexMetadataArgs): unknown => {
        return index.columns;
      }),
    ).toEqual([["projectId", "huntressAccountId", "huntressIncidentReportId"]]);
  });

  test("an account Huntress does not name is stored as empty, never null", () => {
    expect(
      model.getTableColumnMetadata("huntressAccountId").defaultValue,
    ).toBe("");
    expect(model.getTableColumnMetadata("huntressAccountId").required).toBe(
      true,
    );
  });

  test("outlives the connection and the incident, but not the project", () => {
    expect(
      relation(HuntressIncidentReport, "huntressConnection").options.onDelete,
    ).toBe("SET NULL");
    expect(relation(HuntressIncidentReport, "incident").options.onDelete).toBe(
      "SET NULL",
    );
    expect(relation(HuntressIncidentReport, "project").options.onDelete).toBe(
      "CASCADE",
    );
  });

  test("is served at /huntress-incident-report", () => {
    expect(model.getCrudApiPath()?.toString()).toBe("/huntress-incident-report");
  });
});
