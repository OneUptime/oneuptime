import AllModelTypes from "../../Models/DatabaseModels/Index";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OnCallDutyPolicySchedule from "../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleCalendarFeed from "../../Models/DatabaseModels/OnCallDutyPolicyScheduleCalendarFeed";
import Project from "../../Models/DatabaseModels/Project";
import ProjectOnCallCalendarFeed from "../../Models/DatabaseModels/ProjectOnCallCalendarFeed";
import User from "../../Models/DatabaseModels/User";
import UserOnCallCalendarFeed from "../../Models/DatabaseModels/UserOnCallCalendarFeed";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import { ColumnAccessControl } from "../../Types/BaseDatabase/AccessControl";
import { TableColumnMetadata } from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import Permission from "../../Types/Permission";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import type { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import type { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";

/*
 * The three calendar-feed models were written from one template, so this is
 * a sweep rather than three hand-written files: a template applied three
 * times fails in the same place three times.
 *
 * What is pinned is what is invisible until it is wrong in production:
 *
 *   - registration in the model index, without which the table never exists
 *   - a UNIQUE CRUD route, because a duplicate silently shadows another model
 *   - tenant scoping and the Growth plan gate
 *   - the token columns: never readable, never creatable/updatable through
 *     the API, hidden from documentation, minted server-side (`computed`),
 *     the plaintext encrypted at rest, the hash UNIQUE at the database
 *   - the settings the owner may change and the bookkeeping they may not
 *   - the uniqueness rule that makes "mint or rotate" an upsert
 */

type ModelType = { new (): BaseModel };

interface FeedSpec {
  name: string;
  modelType: ModelType;
  crudApiPath: string;
  /** The columns whose (non-token) uniqueness makes the feed an upsert. */
  uniqueColumns: Array<string>;
  /** Columns the API may update on an existing row. */
  updatableSettings: Array<string>;
  /** Extra columns this model has beyond the shared set. */
  extraColumns: Array<string>;
  /** Boolean/number defaults the model must carry. */
  defaults: Record<string, boolean | number>;
}

const FEEDS: Array<FeedSpec> = [
  {
    name: "UserOnCallCalendarFeed",
    modelType: UserOnCallCalendarFeed,
    crudApiPath: "/user-on-call-calendar-feed",
    uniqueColumns: ["projectId", "userId"],
    updatableSettings: [
      "isEnabled",
      "includeCoveringShifts",
      "pastDays",
      "futureDays",
    ],
    extraColumns: ["user", "userId", "includeCoveringShifts"],
    defaults: {
      isEnabled: true,
      includeCoveringShifts: true,
      pastDays: 2,
      futureDays: 90,
      fetchCount: 0,
      lastRenderTruncated: false,
    },
  },
  {
    name: "OnCallDutyPolicyScheduleCalendarFeed",
    modelType: OnCallDutyPolicyScheduleCalendarFeed,
    crudApiPath: "/on-call-duty-policy-schedule-calendar-feed",
    uniqueColumns: ["onCallDutyPolicyScheduleId"],
    updatableSettings: [
      "isEnabled",
      "includeCoverageGaps",
      "minimumGapMinutes",
      "pastDays",
      "futureDays",
      "rotateWhenMemberLeaves",
    ],
    extraColumns: [
      "onCallDutyPolicySchedule",
      "onCallDutyPolicyScheduleId",
      "includeCoverageGaps",
      "minimumGapMinutes",
      "rotateWhenMemberLeaves",
      "createdByUser",
      "createdByUserId",
    ],
    defaults: {
      isEnabled: true,
      includeCoverageGaps: false,
      minimumGapMinutes: 60,
      pastDays: 2,
      futureDays: 90,
      rotateWhenMemberLeaves: false,
      fetchCount: 0,
      lastRenderTruncated: false,
    },
  },
  {
    name: "ProjectOnCallCalendarFeed",
    modelType: ProjectOnCallCalendarFeed,
    crudApiPath: "/project-on-call-calendar-feed",
    uniqueColumns: ["projectId"],
    updatableSettings: [
      "isEnabled",
      "includeCoverageGaps",
      "minimumGapMinutes",
      "pastDays",
      "futureDays",
      "rotateWhenMemberLeaves",
    ],
    extraColumns: [
      "includeCoverageGaps",
      "minimumGapMinutes",
      "rotateWhenMemberLeaves",
      "createdByUser",
      "createdByUserId",
    ],
    defaults: {
      isEnabled: true,
      includeCoverageGaps: false,
      minimumGapMinutes: 60,
      pastDays: 2,
      futureDays: 90,
      rotateWhenMemberLeaves: false,
      fetchCount: 0,
      lastRenderTruncated: false,
    },
  },
];

const SECRET_COLUMNS: Array<string> = [
  "tokenHash",
  "token",
  "previousTokenHash",
  "previousTokenExpiresAt",
];

const BOOKKEEPING_COLUMNS: Array<string> = [
  "tokenHint",
  "rotatedAt",
  "lastFetchedAt",
  "lastFetchedClient",
  "fetchCount",
  "lastRenderTruncated",
];

const SHARED_COLUMNS: Array<string> = [
  "project",
  "projectId",
  ...SECRET_COLUMNS,
  ...BOOKKEEPING_COLUMNS,
  "isEnabled",
  "pastDays",
  "futureDays",
  "deletedByUser",
  "deletedByUserId",
];

function feedSpecs(): Array<[string, FeedSpec]> {
  return FEEDS.map((spec: FeedSpec): [string, FeedSpec] => {
    return [spec.name, spec];
  });
}

function typeormColumn(
  modelType: ModelType,
  propertyName: string,
): ColumnMetadataArgs {
  const column: ColumnMetadataArgs | undefined =
    getMetadataArgsStorage().columns.find((entry: ColumnMetadataArgs) => {
      return entry.target === modelType && entry.propertyName === propertyName;
    });

  if (!column) {
    throw new Error(`${modelType.name}.${propertyName} has no @Column`);
  }

  return column;
}

function typeormIndices(modelType: ModelType): Array<IndexMetadataArgs> {
  return getMetadataArgsStorage().indices.filter((entry: IndexMetadataArgs) => {
    return entry.target === modelType;
  });
}

function indexColumns(index: IndexMetadataArgs): Array<string> {
  if (Array.isArray(index.columns)) {
    return index.columns as Array<string>;
  }

  return [];
}

function typeormRelation(
  modelType: ModelType,
  propertyName: string,
): RelationMetadataArgs {
  const relation: RelationMetadataArgs | undefined =
    getMetadataArgsStorage().relations.find((entry: RelationMetadataArgs) => {
      return entry.target === modelType && entry.propertyName === propertyName;
    });

  if (!relation) {
    throw new Error(`${modelType.name}.${propertyName} has no relation`);
  }

  return relation;
}

describe("On-call calendar feed models", () => {
  test.each(feedSpecs())(
    "%s is registered in the model index",
    (_name: string, spec: FeedSpec) => {
      expect((AllModelTypes as Array<ModelType>).includes(spec.modelType)).toBe(
        true,
      );
    },
  );

  test.each(feedSpecs())(
    "%s uses its own table name",
    (name: string, spec: FeedSpec) => {
      expect(new spec.modelType().tableName).toBe(name);
    },
  );

  test.each(feedSpecs())(
    "%s is served from a CRUD route nothing else uses",
    (_name: string, spec: FeedSpec) => {
      const model: BaseModel = new spec.modelType();

      expect(model.getCrudApiPath()?.toString()).toBe(spec.crudApiPath);

      const owners: Array<string> = (AllModelTypes as Array<ModelType>)
        .filter((modelType: ModelType) => {
          return (
            new modelType().getCrudApiPath()?.toString() === spec.crudApiPath
          );
        })
        .map((modelType: ModelType) => {
          return modelType.name;
        });

      expect(owners).toEqual([spec.modelType.name]);
    },
  );

  test.each(feedSpecs())(
    "%s is tenant scoped by projectId",
    (_name: string, spec: FeedSpec) => {
      const model: BaseModel = new spec.modelType();

      expect(model.getTenantColumn()).toBe("projectId");
    },
  );

  test.each(feedSpecs())(
    "%s is Growth-gated for every operation and survives an unpaid subscription",
    (_name: string, spec: FeedSpec) => {
      const model: BaseModel = new spec.modelType();

      expect(model.getCreateBillingPlan()).toBe(PlanType.Growth);
      expect(model.getReadBillingPlan()).toBe(PlanType.Growth);
      expect(model.getUpdateBillingPlan()).toBe(PlanType.Growth);
      expect(model.getDeleteBillingPlan()).toBe(PlanType.Growth);
      expect(model.allowAccessIfSubscriptionIsUnpaid).toBe(true);
    },
  );

  test.each(feedSpecs())(
    "%s is not documented",
    (_name: string, spec: FeedSpec) => {
      expect(new spec.modelType().enableDocumentation).toBeFalsy();
    },
  );

  test.each(feedSpecs())(
    "%s carries exactly the shared columns plus its own",
    (_name: string, spec: FeedSpec) => {
      const columns: Array<string> = new spec.modelType().getTableColumns()
        .columns;

      for (const column of [...SHARED_COLUMNS, ...spec.extraColumns]) {
        expect(columns).toContain(column);
      }

      /*
       * Base columns (_id, createdAt, ...) come from BaseModel; everything
       * else must be accounted for above so a stray column is a deliberate
       * edit here as well.
       */
      const base: Array<string> = new BaseModel().getTableColumns().columns;
      const unexpected: Array<string> = columns.filter((column: string) => {
        return (
          !base.includes(column) &&
          !SHARED_COLUMNS.includes(column) &&
          !spec.extraColumns.includes(column)
        );
      });

      expect(unexpected).toEqual([]);
    },
  );
});

describe("On-call calendar feed token columns", () => {
  test.each(feedSpecs())(
    "%s denies every operation on every secret column",
    (_name: string, spec: FeedSpec) => {
      const model: BaseModel = new spec.modelType();

      for (const column of SECRET_COLUMNS) {
        const accessControl: ColumnAccessControl | null =
          model.getColumnAccessControlFor(column);

        expect({ column, accessControl }).toEqual({
          column,
          accessControl: { create: [], read: [], update: [] },
        });
      }
    },
  );

  test.each(feedSpecs())(
    "%s hides every secret column from documentation and marks it server-minted",
    (_name: string, spec: FeedSpec) => {
      const model: BaseModel = new spec.modelType();

      for (const column of SECRET_COLUMNS) {
        const metadata: TableColumnMetadata =
          model.getTableColumnMetadata(column);

        expect({ column, hidden: metadata.hideColumnInDocumentation }).toEqual({
          column,
          hidden: true,
        });
        expect({ column, computed: metadata.computed }).toEqual({
          column,
          computed: true,
        });
        expect({ column, relation: metadata.canReadOnRelationQuery }).toEqual({
          column,
          relation: false,
        });
      }
    },
  );

  test.each(feedSpecs())(
    "%s encrypts the plaintext token at rest and nothing else",
    (_name: string, spec: FeedSpec) => {
      const model: BaseModel = new spec.modelType();

      const encrypted: Array<string> = model
        .getTableColumns()
        .columns.filter((column: string) => {
          return model.getTableColumnMetadata(column)?.encrypted === true;
        });

      expect(encrypted).toEqual(["token"]);
      expect(model.getTableColumnMetadata("token").type).toBe(
        TableColumnType.VeryLongText,
      );
    },
  );

  test.each(feedSpecs())(
    "%s never uses TableColumn.unique on the hash (the pre-insert check would echo it in an error)",
    (_name: string, spec: FeedSpec) => {
      const model: BaseModel = new spec.modelType();

      expect(model.getTableColumnMetadata("tokenHash").unique).toBeFalsy();
      expect(
        model.getTableColumnMetadata("previousTokenHash").unique,
      ).toBeFalsy();
    },
  );

  test.each(feedSpecs())(
    "%s makes tokenHash NOT NULL and UNIQUE at the database",
    (_name: string, spec: FeedSpec) => {
      const column: ColumnMetadataArgs = typeormColumn(
        spec.modelType,
        "tokenHash",
      );

      expect(column.options.nullable).toBe(false);
      expect(column.options.unique).toBe(true);
      expect(
        new spec.modelType().getTableColumnMetadata("tokenHash").required,
      ).toBe(true);
    },
  );

  test.each(feedSpecs())(
    "%s indexes previousTokenHash (the public route falls back to it)",
    (_name: string, spec: FeedSpec) => {
      const indexed: boolean = typeormIndices(spec.modelType).some(
        (index: IndexMetadataArgs) => {
          return (
            indexColumns(index).length === 1 &&
            indexColumns(index)[0] === "previousTokenHash"
          );
        },
      );

      expect(indexed).toBe(true);
      expect(
        typeormColumn(spec.modelType, "previousTokenHash").options.nullable,
      ).toBe(true);
      expect(
        typeormColumn(spec.modelType, "previousTokenExpiresAt").options
          .nullable,
      ).toBe(true);
    },
  );

  test.each(feedSpecs())(
    "%s lets readers see the hint but never write it",
    (_name: string, spec: FeedSpec) => {
      const model: BaseModel = new spec.modelType();
      const accessControl: ColumnAccessControl | null =
        model.getColumnAccessControlFor("tokenHint");

      expect(accessControl?.read).toEqual(model.readRecordPermissions);
      expect(accessControl?.read.length).toBeGreaterThan(0);
      expect(accessControl?.create).toEqual([]);
      expect(accessControl?.update).toEqual([]);
      expect(model.getTableColumnMetadata("tokenHint").computed).toBe(true);
    },
  );
});

describe("On-call calendar feed settings and bookkeeping", () => {
  test.each(feedSpecs())(
    "%s lets its readers read and its editors update exactly the settings columns",
    (_name: string, spec: FeedSpec) => {
      const model: BaseModel = new spec.modelType();

      /*
       * BaseModel's own columns (_id, createdAt, ...) inherit the table lists;
       * only the model's declared columns are the settings under test.
       */
      const base: Array<string> = new BaseModel().getTableColumns().columns;

      const updatable: Array<string> = model
        .getTableColumns()
        .columns.filter((column: string) => {
          return (
            !base.includes(column) &&
            (model.getColumnAccessControlFor(column)?.update || []).length > 0
          );
        })
        .sort();

      expect(updatable).toEqual([...spec.updatableSettings].sort());

      for (const column of spec.updatableSettings) {
        const accessControl: ColumnAccessControl | null =
          model.getColumnAccessControlFor(column);

        expect(accessControl?.read).toEqual(model.readRecordPermissions);
        expect(accessControl?.update).toEqual(model.updateRecordPermissions);
      }
    },
  );

  test.each(feedSpecs())(
    "%s bookkeeping is readable but root-written",
    (_name: string, spec: FeedSpec) => {
      const model: BaseModel = new spec.modelType();

      for (const column of BOOKKEEPING_COLUMNS) {
        const accessControl: ColumnAccessControl | null =
          model.getColumnAccessControlFor(column);

        expect({ column, read: accessControl?.read }).toEqual({
          column,
          read: model.readRecordPermissions,
        });
        expect({ column, create: accessControl?.create }).toEqual({
          column,
          create: [],
        });
        expect({ column, update: accessControl?.update }).toEqual({
          column,
          update: [],
        });
        expect({
          column,
          computed: model.getTableColumnMetadata(column).computed,
        }).toEqual({ column, computed: true });
      }
    },
  );

  test.each(feedSpecs())(
    "%s carries the documented defaults, in the model metadata AND the database column",
    (_name: string, spec: FeedSpec) => {
      const model: BaseModel = new spec.modelType();

      for (const [column, value] of Object.entries(spec.defaults)) {
        const metadata: TableColumnMetadata =
          model.getTableColumnMetadata(column);

        expect({ column, isDefault: metadata.isDefaultValueColumn }).toEqual({
          column,
          isDefault: true,
        });
        expect({ column, defaultValue: metadata.defaultValue }).toEqual({
          column,
          defaultValue: value,
        });
        expect({
          column,
          dbDefault: typeormColumn(spec.modelType, column).options.default,
        }).toEqual({ column, dbDefault: value });
        expect({
          column,
          nullable: typeormColumn(spec.modelType, column).options.nullable,
        }).toEqual({ column, nullable: false });
      }
    },
  );

  test.each(feedSpecs())(
    "%s is unique on the columns that make mint-or-rotate an upsert",
    (_name: string, spec: FeedSpec) => {
      const uniqueIndexes: Array<Array<string>> = typeormIndices(spec.modelType)
        .filter((index: IndexMetadataArgs) => {
          return index.unique === true;
        })
        .map(indexColumns);

      expect(uniqueIndexes).toContainEqual(spec.uniqueColumns);
    },
  );

  test.each(feedSpecs())(
    "%s cascades away with its project",
    (_name: string, spec: FeedSpec) => {
      const relation: RelationMetadataArgs = typeormRelation(
        spec.modelType,
        "project",
      );

      expect(relation.options.onDelete).toBe("CASCADE");
      expect(
        new spec.modelType().getTableColumnMetadata("project").modelType,
      ).toBe(Project);
    },
  );
});

describe("UserOnCallCalendarFeed (personal feed) specifics", () => {
  const model: UserOnCallCalendarFeed = new UserOnCallCalendarFeed();

  test("is owned by its user and readable/updatable/deletable by the owner only", () => {
    expect(model.currentUserCanAccessColumnBy).toBe("userId");
    expect(model.readRecordPermissions).toEqual([Permission.CurrentUser]);
    expect(model.updateRecordPermissions).toEqual([Permission.CurrentUser]);
    expect(model.deleteRecordPermissions).toEqual([Permission.CurrentUser]);
  });

  test("cannot be created through the CRUD API at all", () => {
    expect(model.createRecordPermissions).toEqual([]);

    for (const column of model.getTableColumns().columns) {
      expect({
        column,
        create: model.getColumnAccessControlFor(column)?.create || [],
      }).toEqual({ column, create: [] });
    }
  });

  test("cascades away with its user", () => {
    expect(
      typeormRelation(UserOnCallCalendarFeed, "user").options.onDelete,
    ).toBe("CASCADE");
    expect(model.getTableColumnMetadata("user").modelType).toBe(User);
    expect(
      typeormColumn(UserOnCallCalendarFeed, "userId").options.nullable,
    ).toBe(false);
  });

  test("is not label scoped (it has no labelled parent)", () => {
    expect(model.canAccessIfCanReadOn).toBeFalsy();
  });
});

describe("OnCallDutyPolicyScheduleCalendarFeed (shared schedule feed) specifics", () => {
  test("cascades away with its schedule", () => {
    const relation: RelationMetadataArgs = typeormRelation(
      OnCallDutyPolicyScheduleCalendarFeed,
      "onCallDutyPolicySchedule",
    );

    expect(relation.options.onDelete).toBe("CASCADE");
    expect(
      typeormColumn(
        OnCallDutyPolicyScheduleCalendarFeed,
        "onCallDutyPolicyScheduleId",
      ).options.nullable,
    ).toBe(false);
    expect(
      new OnCallDutyPolicyScheduleCalendarFeed().getTableColumnMetadata(
        "onCallDutyPolicySchedule",
      ).modelType,
    ).toBe(OnCallDutyPolicySchedule);
  });

  test("keeps the creator informationally, without cascading", () => {
    const relation: RelationMetadataArgs = typeormRelation(
      OnCallDutyPolicyScheduleCalendarFeed,
      "createdByUser",
    );

    expect(relation.options.onDelete).toBe("SET NULL");
  });
});

describe("ProjectOnCallCalendarFeed (project-wide feed) specifics", () => {
  test("keeps the creator informationally, without cascading", () => {
    const relation: RelationMetadataArgs = typeormRelation(
      ProjectOnCallCalendarFeed,
      "createdByUser",
    );

    expect(relation.options.onDelete).toBe("SET NULL");
  });
});
