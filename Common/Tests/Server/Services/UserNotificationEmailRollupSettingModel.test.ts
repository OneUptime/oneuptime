import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";
import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import UserNotificationEmailRollupSetting from "../../../Models/DatabaseModels/UserNotificationEmailRollupSetting";
import UserNotificationSetting from "../../../Models/DatabaseModels/UserNotificationSetting";
import Services from "../../../Server/Services/Index";
import UserNotificationEmailRollupSettingService from "../../../Server/Services/UserNotificationEmailRollupSettingService";
import SchemaMigrations from "../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddUserNotificationEmailRollupSetting1791100000000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1791100000000-AddUserNotificationEmailRollupSetting";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import Dictionary from "../../../Types/Dictionary";
import Permission from "../../../Types/Permission";
import TableColumnType from "../../../Types/Database/TableColumnType";

/*
 * The escape hatch's storage. It carries one boolean, and every property that
 * makes that boolean safe lives in decorator metadata, a generated migration
 * and three registration files — none of which any functional test touches.
 * What breaks in production if this regresses:
 *
 *  1. THE DEFAULT IS THE WHOLE MIGRATION STRATEGY. Rollup ships on, this table
 *     starts empty, and the read path treats "no row" and isEnabled = true
 *     identically. Change the DDL default to false, or make the column
 *     nullable without a default, and a feature nobody was asked about
 *     silently switches itself off for the first person who happens to get a
 *     row written — or, worse, the absent-row default and the column default
 *     stop agreeing and behaviour depends on whether you have ever opened the
 *     settings page.
 *
 *  2. THE ACCESS CONTROL IS WHAT STOPS ONE MEMBER EDITING ANOTHER'S
 *     PREFERENCE. Permission.CurrentUser plus
 *     @CurrentUserCanAccessRecordBy("userId") is the same pairing
 *     UserNotificationSetting uses, and it is the reason this feature adds no
 *     Permission enum members at all. Widen either half and a project member
 *     can turn a colleague's batching on or off — which, for somebody who
 *     opted out because their inbox rules depend on one email per event, is a
 *     silent breakage of something they deliberately configured.
 *
 *  3. UNREGISTERED IS INERT. A model missing from AllModelTypes gets no table;
 *     an unmounted router means the settings page's toggle 404s; an
 *     imported-but-unappended migration is exactly as dead as an unimported
 *     one. All three failures are silent at boot.
 *
 *  4. THE FOREIGN KEYS MUST CASCADE. projectId and userId are both NOT NULL,
 *     so SET NULL — the shape most audit columns in this schema use, and
 *     therefore the shape a hand adds by reflex — cannot be satisfied and
 *     would leave rows that block deleting the project.
 */

const MIGRATION_FILE_NAME: string =
  "1791100000000-AddUserNotificationEmailRollupSetting.ts";

const MIGRATION_SOURCE: string = fs.readFileSync(
  path.join(
    __dirname,
    `../../../Server/Infrastructure/Postgres/SchemaMigrations/${MIGRATION_FILE_NAME}`,
  ),
  "utf8",
);

const CREATE_TABLE_STATEMENT: string = ((): string | never => {
  const statements: Array<string> = [
    ...MIGRATION_SOURCE.matchAll(/`([^`]+)`/g),
  ].map((match: RegExpMatchArray): string => {
    return match[1] as string;
  });

  const statement: string | undefined = statements.find(
    (candidate: string): boolean => {
      return candidate.startsWith(
        `CREATE TABLE "UserNotificationEmailRollupSetting"`,
      );
    },
  );

  if (!statement) {
    throw new Error(
      "the migration no longer creates the UserNotificationEmailRollupSetting table",
    );
  }

  return statement;
})();

describe("the preference row is addressable exactly like the settings it sits beside", () => {
  test("it is registered as a model and as a service", () => {
    expect(AllModelTypes).toContain(UserNotificationEmailRollupSetting);
    expect(Services).toContain(UserNotificationEmailRollupSettingService);
  });

  test("it is tenant-scoped by project and reachable on its own CRUD route", () => {
    const model: UserNotificationEmailRollupSetting =
      new UserNotificationEmailRollupSetting();

    expect(model.getTenantColumn()).toBe("projectId");
    expect(model.getCrudApiPath()?.toString()).toBe(
      "/user-notification-email-rollup-setting",
    );
  });

  /*
   * Read as text because Common cannot import App. The toggle on the settings
   * page talks to this router; without the mount it would 404 and the escape
   * hatch would exist only in the database.
   */
  test("its CRUD router is mounted in the API", () => {
    const baseApi: string = fs.readFileSync(
      path.join(__dirname, "../../../../App/FeatureSet/BaseAPI/Index.ts"),
      "utf8",
    );

    expect(baseApi).toContain(
      "Common/Server/Services/UserNotificationEmailRollupSettingService",
    );
    expect(baseApi).toContain(
      "Common/Models/DatabaseModels/UserNotificationEmailRollupSetting",
    );
    expect(baseApi).toContain(
      "        UserNotificationEmailRollupSetting,\n        UserNotificationEmailRollupSettingService,",
    );
  });
});

describe("a member can change their own preference and nobody else's", () => {
  /*
   * Compared against UserNotificationSetting rather than written out on its
   * own, because "the same access control as the page it lives on" is the
   * actual requirement — if that model's pairing is ever revisited, this one
   * should move with it rather than quietly diverge.
   */
  test("the table is gated on CurrentUser in all four directions, like UserNotificationSetting", () => {
    const model: UserNotificationEmailRollupSetting =
      new UserNotificationEmailRollupSetting();
    const sibling: UserNotificationSetting = new UserNotificationSetting();

    for (const list of [
      model.createRecordPermissions,
      model.readRecordPermissions,
      model.updateRecordPermissions,
      model.deleteRecordPermissions,
    ]) {
      expect(list).toEqual([Permission.CurrentUser]);
    }

    expect(model.createRecordPermissions).toEqual(
      sibling.createRecordPermissions,
    );
    expect(model.readRecordPermissions).toEqual(sibling.readRecordPermissions);
  });

  /*
   * The tenant column keeps one project's rows away from another's; THIS is
   * what keeps one member's row away from another member's inside the same
   * project. Without it, Permission.CurrentUser alone would let any member
   * read and edit every colleague's preference.
   */
  test("access is additionally scoped to the row's own user, as on UserNotificationSetting", () => {
    const model: UserNotificationEmailRollupSetting =
      new UserNotificationEmailRollupSetting();
    const sibling: UserNotificationSetting = new UserNotificationSetting();

    expect(model.currentUserCanAccessColumnBy).toBe("userId");
    expect(model.currentUserCanAccessColumnBy).toBe(
      sibling.currentUserCanAccessColumnBy,
    );
  });

  /*
   * A user may flip their own preference, but may not re-point a row at a
   * different person or project after the fact — those two columns have an
   * empty update list, matching how UserNotificationSetting treats its own
   * identity columns.
   */
  test("only the preference itself is updatable", () => {
    const model: UserNotificationEmailRollupSetting =
      new UserNotificationEmailRollupSetting();
    const accessControl: Dictionary<ColumnAccessControl> =
      model.getColumnAccessControlForAllColumns();

    expect(accessControl["isEnabled"]?.update).toEqual([
      Permission.CurrentUser,
    ]);
    expect(accessControl["userId"]?.update).toEqual([]);
    expect(accessControl["projectId"]?.update).toEqual([]);
  });
});

describe("the default is what lets this ship with no backfill", () => {
  test("the model declares the preference as a boolean defaulting to on", () => {
    const model: UserNotificationEmailRollupSetting =
      new UserNotificationEmailRollupSetting();

    expect(model.getTableColumnMetadata("isEnabled").type).toBe(
      TableColumnType.Boolean,
    );
    expect(model.getTableColumnMetadata("isEnabled").defaultValue).toBe(true);
  });

  /*
   * The DDL half of the same claim. The model default and the column default
   * disagreeing is invisible until the first row is written by something that
   * does not go through the model.
   */
  test("the column is NOT NULL DEFAULT true in the migration", () => {
    expect(CREATE_TABLE_STATEMENT).toContain(
      `"isEnabled" boolean NOT NULL DEFAULT true`,
    );
  });

  test("the table carries nothing but the pair it is keyed on and that one flag", () => {
    const body: string = CREATE_TABLE_STATEMENT.slice(
      CREATE_TABLE_STATEMENT.indexOf("(") + 1,
      CREATE_TABLE_STATEMENT.lastIndexOf(")"),
    );

    const columnNames: Array<string> = body
      .split(/,\s(?=(?:"|CONSTRAINT\s))/)
      .map((part: string): string | null => {
        const match: RegExpMatchArray | null = part.match(/^"(\w+)"\s/);

        return match ? (match[1] as string) : null;
      })
      .filter((name: string | null): name is string => {
        return name !== null;
      })
      .sort();

    expect(columnNames).toEqual([
      "_id",
      "createdAt",
      "createdByUserId",
      "deletedAt",
      "deletedByUserId",
      "isEnabled",
      "projectId",
      "updatedAt",
      "userId",
      "version",
    ]);
  });
});

describe("the row goes away with whatever it was a preference about", () => {
  test("both projectId and userId cascade", () => {
    const relations: Array<RelationMetadataArgs> =
      getMetadataArgsStorage().relations.filter(
        (relation: RelationMetadataArgs): boolean => {
          return (
            (relation.target as typeof BaseModel) ===
            (UserNotificationEmailRollupSetting as unknown as typeof BaseModel)
          );
        },
      );

    for (const propertyName of ["project", "user"]) {
      const relation: RelationMetadataArgs | undefined = relations.find(
        (candidate: RelationMetadataArgs): boolean => {
          return candidate.propertyName === propertyName;
        },
      );

      expect(relation).toBeDefined();
      expect(relation?.options.onDelete).toBe("CASCADE");
    }
  });

  test("the migration issues those two as CASCADE and not SET NULL", () => {
    for (const column of ["projectId", "userId"]) {
      const pattern: RegExp = new RegExp(
        `FOREIGN KEY \\("${column}"\\)[^\`]*ON DELETE CASCADE`,
      );

      expect(MIGRATION_SOURCE).toMatch(pattern);
    }
  });
});

describe("migration registration", () => {
  test("it is the last registered migration, and its three names agree", () => {
    expect(SchemaMigrations).toContain(
      AddUserNotificationEmailRollupSetting1791100000000,
    );
    expect(SchemaMigrations[SchemaMigrations.length - 1]).toBe(
      AddUserNotificationEmailRollupSetting1791100000000,
    );
    expect(MIGRATION_SOURCE).toContain(
      'public name: string = "AddUserNotificationEmailRollupSetting1791100000000";',
    );
  });
});
