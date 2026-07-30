import Models from "../../../Models/DatabaseModels/Index";
import AnalyticsModels from "../../../Models/AnalyticsModels/Index";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import AuditLog from "../../../Models/AnalyticsModels/AuditLog";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import Project from "../../../Models/DatabaseModels/Project";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import RumSessionErasureRequest from "../../../Models/DatabaseModels/RumSessionErasureRequest";
import RumSessionPin from "../../../Models/DatabaseModels/RumSessionPin";
import RumSessionReplayView from "../../../Models/DatabaseModels/RumSessionReplayView";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import Dictionary from "../../../Types/Dictionary";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import Permission from "../../../Types/Permission";
import SessionReplayCaptureTrigger from "../../../Types/Rum/SessionReplayCaptureTrigger";
import SessionReplayConsentMode from "../../../Types/Rum/SessionReplayConsentMode";
import SessionReplayMaskingMode from "../../../Types/Rum/SessionReplayMaskingMode";
import { describe, expect, it } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";

/*
 * The Postgres side of session replay. Everything asserted here is a
 * decision that is silently reversible - a default that flips, a cascade
 * that looks like every other cascade in the codebase, a model that
 * compiles fine but was never registered - and whose reversal would not
 * fail a build or a manual test.
 */

type FindRelationFunction = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  target: any,
  propertyName: string,
) => RelationMetadataArgs | undefined;

const findRelation: FindRelationFunction = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  target: any,
  propertyName: string,
): RelationMetadataArgs | undefined => {
  return getMetadataArgsStorage().relations.find(
    (relation: RelationMetadataArgs): boolean => {
      return (
        relation.target === target && relation.propertyName === propertyName
      );
    },
  );
};

describe("RumApplication session replay configuration", () => {
  const model: RumApplication = new RumApplication();
  const columnNames: Array<string> = model.getTableColumns().columns;

  type GetColumnFunction = (columnName: string) => TableColumnMetadata;

  const getColumn: GetColumnFunction = (
    columnName: string,
  ): TableColumnMetadata => {
    return model.getTableColumnMetadata(columnName);
  };

  it("declares every session replay configuration column", () => {
    const expectedColumns: Array<string> = [
      "isSessionReplayEnabled",
      "sessionReplayMaskingMode",
      "sessionReplayMaskSelectors",
      "sessionReplayBlockSelectors",
      "sessionReplayAllowedOrigins",
      "sessionReplayConsentMode",
      "sessionReplayCaptureTrigger",
      "sessionReplaySamplePercentage",
      "sessionReplayCaptureUserIdentity",
      "sessionReplayCaptureGeo",
      "sessionReplayRecordCanvas",
      "sessionReplayRetentionInDays",
      "sessionReplayMonthlyBudgetInGB",
      "sessionReplayLastChunkReceivedAt",
      "sessionReplayBudgetExceededAt",
    ];

    for (const columnName of expectedColumns) {
      expect(columnNames).toContain(columnName);
    }
  });

  it("defaults to not recording anything at all", () => {
    /*
     * The single most important default in the feature. A recorder that is
     * on by default would start capturing real end users' screens the
     * moment a customer upgraded.
     */
    expect(getColumn("isSessionReplayEnabled").defaultValue).toBe(false);
    expect(getColumn("sessionReplaySamplePercentage").defaultValue).toBe(0);
  });

  it("defaults to the strict privacy posture, not the useful-looking one", () => {
    /*
     * Masking happens in the browser before compression, so an
     * under-masked capture cannot be repaired after the fact - the server
     * never had the unmasked content.
     */
    expect(getColumn("sessionReplayMaskingMode").defaultValue).toBe(
      SessionReplayMaskingMode.MaskAllText,
    );
    expect(getColumn("sessionReplayConsentMode").defaultValue).toBe(
      SessionReplayConsentMode.RequireExplicit,
    );
    expect(getColumn("sessionReplayCaptureTrigger").defaultValue).toBe(
      SessionReplayCaptureTrigger.OnErrorOrFrustration,
    );
    expect(getColumn("sessionReplayCaptureUserIdentity").defaultValue).toBe(
      false,
    );
    expect(getColumn("sessionReplayCaptureGeo").defaultValue).toBe(false);
    expect(getColumn("sessionReplayRecordCanvas").defaultValue).toBe(false);
  });

  it("defaults replay retention to 7 days, not the 15 the other pillars use", () => {
    expect(getColumn("sessionReplayRetentionInDays").defaultValue).toBe(7);
  });

  it("keeps identity and geo capture behind a narrower write ACL than the rest", () => {
    /*
     * These two are the switches that turn a pseudonymous recording into
     * an identified one, so ProjectMember and SettingsMember can read the
     * setting but must not flip it.
     */
    const accessControl: Dictionary<ColumnAccessControl> =
      model.getColumnAccessControlForAllColumns();

    for (const columnName of [
      "sessionReplayCaptureUserIdentity",
      "sessionReplayCaptureGeo",
    ]) {
      expect(accessControl[columnName]?.update || []).not.toContain(
        Permission.ProjectMember,
      );
      expect(accessControl[columnName]?.update || []).toContain(
        Permission.ProjectAdmin,
      );
    }

    /* And the ordinary settings are editable by the ordinary roles. */
    expect(accessControl["sessionReplayMaskingMode"]?.update || []).toContain(
      Permission.EditRumApplication,
    );
  });

  it("never exposes the ingest diagnostics as writable", () => {
    const accessControl: Dictionary<ColumnAccessControl> =
      model.getColumnAccessControlForAllColumns();

    for (const columnName of [
      "sessionReplayLastChunkReceivedAt",
      "sessionReplayBudgetExceededAt",
    ]) {
      expect(accessControl[columnName]?.create || []).toEqual([]);
      expect(accessControl[columnName]?.update || []).toEqual([]);
    }
  });
});

describe("Project.isSessionReplayAllowed", () => {
  const model: Project = new Project();

  it("exists and defaults to off for the whole project", () => {
    expect(
      model.getTableColumnMetadata("isSessionReplayAllowed").defaultValue,
    ).toBe(false);
  });

  it("is editable by a project owner or admin", () => {
    const accessControl: Dictionary<ColumnAccessControl> =
      model.getColumnAccessControlForAllColumns();

    expect(accessControl["isSessionReplayAllowed"]?.update || []).toContain(
      Permission.ProjectOwner,
    );
    expect(accessControl["isSessionReplayAllowed"]?.update || []).toContain(
      Permission.ProjectAdmin,
    );
  });
});

describe("RumSessionReplayView (read audit)", () => {
  const model: RumSessionReplayView = new RumSessionReplayView();

  it("is a Postgres model, not a row in the plan-gated AuditLog table", () => {
    /*
     * AuditLog is an analytics table gated at PlanType.Enterprise and is
     * additionally off unless Project.enableAuditLogs is set. If the read
     * audit lived there, no Free or Growth project - and no project that
     * never enabled audit logs - would have any record of who watched a
     * real end user's screen. A privacy control must not be a paid tier.
     *
     * So: the alternative really is Enterprise-gated, the replay audit is
     * not an analytics model, and no column of it carries a billing gate
     * that would silently reintroduce one.
     */
    expect(new AuditLog().tableBillingAccessControl?.read).toBe(
      PlanType.Enterprise,
    );

    const analyticsTableNames: Array<string> = AnalyticsModels.map(
      (analyticsModel: { new (): AnalyticsBaseModel }): string => {
        return new analyticsModel().tableName || "";
      },
    );

    expect(analyticsTableNames).not.toContain("RumSessionReplayView");
    expect(model.tableName).toBe("RumSessionReplayView");

    for (const columnName of model.getTableColumns().columns) {
      expect(model.getColumnBillingAccessControl(columnName)).toBeUndefined();
    }
  });

  it("cannot be created, updated or deleted through the API", () => {
    /* Rows are written server-side as root on every playback. */
    expect(model.createRecordPermissions).toEqual([]);
    expect(model.updateRecordPermissions).toEqual([]);
    /* An audit trail somebody can erase is not an audit trail. */
    expect(model.deleteRecordPermissions).toEqual([]);
  });

  it("is not readable by every role that can read RUM applications", () => {
    /*
     * "Which of my colleagues watched which customer" is itself sensitive,
     * and Permission.Viewer is the project-wide read-only role.
     */
    expect(model.readRecordPermissions).not.toContain(Permission.Viewer);
    expect(model.readRecordPermissions).not.toContain(Permission.ProjectMember);
    expect(model.readRecordPermissions).toContain(
      Permission.ReadRumSessionReplayAudit,
    );
  });

  it("records the viewer's own IP, and nothing about the end user's", () => {
    const columns: Array<string> = model.getTableColumns().columns;

    expect(columns).toContain("ipAddress");
    expect(columns).toContain("userAgent");
    expect(columns).toContain("secondsWatched");
    expect(columns).toContain("accessReason");

    /*
     * The second half of the title, which is the half that matters. The
     * recorded person is not a party to this row: it says who watched, not
     * who was watched. A column carrying the end user's address, location
     * or identity would turn the privacy control into a second copy of the
     * data it exists to police.
     */
    const endUserLocationPattern: RegExp =
      /enduser|geo|country|city|latitude|longitude/i;

    const endUserColumn: string | undefined = columns.find(
      (columnName: string): boolean => {
        return endUserLocationPattern.test(columnName);
      },
    );

    expect(endUserColumn).toBeUndefined();

    /* ipAddress is documented as the viewer's, and nothing disagrees. */
    expect(model.getTableColumnMetadata("ipAddress").description).toContain(
      "viewer",
    );
  });

  it("keeps the API key id as a bare column so revoking a key does not erase the audit", () => {
    expect(
      findRelation(RumSessionReplayView, "viewedByApiKey"),
    ).toBeUndefined();
    expect(model.getTableColumns().columns).toContain("viewedByApiKeyId");
  });
});

describe("RumSessionErasureRequest", () => {
  const model: RumSessionErasureRequest = new RumSessionErasureRequest();

  it("nulls out the application relation instead of cascading the request away", () => {
    /*
     * THE load-bearing assertion of this file. Every other
     * rumApplicationId relation in the codebase is ON DELETE CASCADE.
     * Here that would mean deleting a RUM application also deletes the
     * erasure request that existed to clean up after it - and since the
     * recordings live in ClickHouse, untouched by a Postgres cascade, the
     * end-user data would survive while the instruction to delete it
     * disappeared.
     */
    const relation: RelationMetadataArgs | undefined = findRelation(
      RumSessionErasureRequest,
      "rumApplication",
    );

    expect(relation).toBeDefined();
    expect(relation?.options.onDelete).toBe("SET NULL");
    expect(relation?.options.nullable).toBe(true);
  });

  it("still cascades on project deletion, because a deleted project has nothing to erase", () => {
    const relation: RelationMetadataArgs | undefined = findRelation(
      RumSessionErasureRequest,
      "project",
    );

    expect(relation?.options.onDelete).toBe("CASCADE");
  });

  it("cannot have its progress fields rewritten by the requester", () => {
    /*
     * A requester who could set status or the deletion counts could make
     * an erasure that never ran look like one that did.
     */
    const accessControl: Dictionary<ColumnAccessControl> =
      model.getColumnAccessControlForAllColumns();

    for (const columnName of [
      "status",
      "completedAt",
      "sessionsDeleted",
      "chunksDeleted",
      "failureReason",
    ]) {
      expect(accessControl[columnName]?.create || []).toEqual([]);
      expect(accessControl[columnName]?.update || []).toEqual([]);
    }

    expect(model.updateRecordPermissions).toEqual([]);
    expect(model.deleteRecordPermissions).toEqual([]);
  });

  it("can be raised by a project admin or the granular permission", () => {
    expect(model.createRecordPermissions).toContain(
      Permission.CreateRumSessionErasureRequest,
    );
    expect(model.readRecordPermissions).toContain(
      Permission.ReadRumSessionErasureRequest,
    );
  });
});

describe("RumSessionPin", () => {
  const model: RumSessionPin = new RumSessionPin();

  it("is unique per session, so one recording is never copied twice", () => {
    const uniqueIndexes: Array<IndexMetadataArgs> =
      getMetadataArgsStorage().indices.filter(
        (index: IndexMetadataArgs): boolean => {
          return index.target === RumSessionPin && index.unique === true;
        },
      );

    expect(uniqueIndexes.length).toBe(1);
    expect(uniqueIndexes[0]?.columns).toEqual([
      "projectId",
      "rumApplicationId",
      "sessionId",
    ]);
  });

  it("does not let a client claim the recording has been preserved", () => {
    /*
     * materializedAt asserts the session was actually copied out of the
     * expiring table. A client that could set it would make an
     * unprotected recording look protected.
     */
    const accessControl: Dictionary<ColumnAccessControl> =
      model.getColumnAccessControlForAllColumns();

    expect(accessControl["materializedAt"]?.create || []).toEqual([]);
    expect(accessControl["materializedAt"]?.update || []).toEqual([]);
  });

  it("can be removed, so a pin is not a one-way door", () => {
    expect(model.deleteRecordPermissions).toContain(
      Permission.DeleteRumSessionReplay,
    );
  });
});

describe("session replay model registration", () => {
  it("registers all three models in the DatabaseModels index", () => {
    /*
     * A model that is not in this array does not exist: TypeORM never sees
     * the entity, so the table is never created and every query against it
     * fails at runtime rather than at build time.
     */
    const names: Array<string> = Models.map(
      (model: { new (): BaseModel }): string => {
        return new model().tableName || "";
      },
    );

    expect(names).toContain("RumSessionReplayView");
    expect(names).toContain("RumSessionErasureRequest");
    expect(names).toContain("RumSessionPin");
  });

  it("gives each model its own CRUD route", () => {
    expect(new RumSessionReplayView().getCrudApiPath()?.toString()).toBe(
      "/rum-session-replay-view",
    );
    expect(new RumSessionErasureRequest().getCrudApiPath()?.toString()).toBe(
      "/rum-session-erasure-request",
    );
    expect(new RumSessionPin().getCrudApiPath()?.toString()).toBe(
      "/rum-session-pin",
    );
  });

  it("scopes all three to a tenant, so one project cannot read another's", () => {
    expect(new RumSessionReplayView().getTenantColumn()).toBe("projectId");
    expect(new RumSessionErasureRequest().getTenantColumn()).toBe("projectId");
    expect(new RumSessionPin().getTenantColumn()).toBe("projectId");
  });
});
