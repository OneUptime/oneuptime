import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddNetworkSnmpCredentialProfilesAndAlertPolicies1791000000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1791000000000-AddNetworkSnmpCredentialProfilesAndAlertPolicies";
import { AddNetworkDeviceRoleTable1790800000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1790800000000-AddNetworkDeviceRoleTable";
import { AddNetworkSiteTypeParentHierarchy1790700000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1790700000000-AddNetworkSiteTypeParentHierarchy";
import { AddNetworkDeviceOidTemplate1790500000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1790500000000-AddNetworkDeviceOidTemplate";
import NetworkAlertPolicy from "../../../../Models/DatabaseModels/NetworkAlertPolicy";
import NetworkSnmpCredentialProfile from "../../../../Models/DatabaseModels/NetworkSnmpCredentialProfile";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import NetworkSite from "../../../../Models/DatabaseModels/NetworkSite";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import TableColumnType from "../../../../Types/Database/TableColumnType";

/*
 * The schema migration behind ping-first network device polling: SNMP
 * credential profiles, alert policies, the site's monitoring defaults and
 * the SNMP walk's own result columns on NetworkDevice.
 *
 * The SQL is generated and the schema-drift job proves it matches the
 * entities, so this file does not re-check TypeORM's spelling. It pins the
 * decisions a regeneration, a copy-paste or a well-meaning edit would
 * silently reverse, none of which a functional test would notice:
 *
 *  1. EVERY NEW FOREIGN KEY ONTO CONFIGURATION IS "SET NULL". A device points
 *     at a credential profile, a site at a profile and a probe, a monitor at
 *     the alert policy that owns it, a policy at its monitor template. All of
 *     those are configuration; devices, sites and monitors are inventory.
 *     CASCADE on any of them means deleting a credential profile deletes the
 *     devices that used it.
 *
 *  2. THE DEFAULT MONITORING METHOD BECOMES 'Probe'. A device created through
 *     the API without naming a method is polled by its probe, which is the
 *     whole point of the change; a regeneration against a stale model would
 *     put 'SNMP' back.
 *
 *  3. isSnmpReachable IS NULLABLE WITH NO DEFAULT. NULL means "no walk has
 *     been attempted", which is true of every existing device and of every
 *     ping-only device forever. A default of false would show every
 *     ping-only device as "SNMP failing".
 *
 *  4. THE SECRET COLUMNS ARE text. They are stored encrypted, and ciphertext
 *     is longer than the plaintext limit the plain SNMP columns carry.
 *
 * The ordering-and-registration guard for the registry as a whole lives in
 * SchemaMigrationsOrdering.test.ts; only this migration's own registration
 * and file/class pairing are asserted here.
 */

const MIGRATION_FILE: string =
  "1791000000000-AddNetworkSnmpCredentialProfilesAndAlertPolicies";

const MIGRATION_PATH: string = path.join(
  __dirname,
  `../../../../Server/Infrastructure/Postgres/SchemaMigrations/${MIGRATION_FILE}.ts`,
);

const SOURCE: string = fs.readFileSync(MIGRATION_PATH, "utf8");

function bodyOf(method: "up" | "down"): string {
  const start: number = SOURCE.indexOf(`public async ${method}(`);

  expect(start).toBeGreaterThan(-1);

  const end: number =
    method === "up" ? SOURCE.indexOf("public async down(") : SOURCE.length;

  return SOURCE.slice(start, end);
}

const UP: string = bodyOf("up");
const DOWN: string = bodyOf("down");

function statementsIn(body: string): Array<string> {
  return [...body.matchAll(/`([^`]+)`/g)].map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

function createTableStatement(tableName: string): string {
  const statement: string | undefined = statementsIn(UP).find(
    (candidate: string): boolean => {
      return candidate.startsWith(`CREATE TABLE "${tableName}"`);
    },
  );

  expect({ table: tableName, found: Boolean(statement) }).toEqual({
    table: tableName,
    found: true,
  });

  return statement as string;
}

/*
 * The column definitions out of a CREATE TABLE, keyed by column name with
 * the definition kept verbatim so NOT NULL and DEFAULT can both be read off
 * it. The split is on a comma followed by a quoted name or by CONSTRAINT,
 * which is every separator in a generated CREATE TABLE and none of the
 * commas that could appear inside one definition.
 */
function columnDefinitions(tableName: string): Map<string, string> {
  const statement: string = createTableStatement(tableName);
  const body: string = statement.slice(
    statement.indexOf("(") + 1,
    statement.lastIndexOf(")"),
  );

  const definitions: Map<string, string> = new Map<string, string>();

  for (const part of body.split(/,\s(?=(?:"|CONSTRAINT\s))/)) {
    const match: RegExpMatchArray | null = part.match(/^"(\w+)"\s([\s\S]+)$/);

    if (match) {
      definitions.set(match[1] as string, match[2] as string);
    }
  }

  return definitions;
}

function definitionOf(
  columns: Map<string, string>,
  columnName: string,
): string {
  const definition: string | undefined = columns.get(columnName);

  expect({ column: columnName, found: Boolean(definition) }).toEqual({
    column: columnName,
    found: true,
  });

  return definition as string;
}

/*
 * The columns a model actually stores: everything except the relation
 * objects, which are addressed by their own "...Id" column.
 */
function persistedColumnsOf(model: BaseModel): Array<string> {
  const persisted: Array<string> = model
    .getTableColumns()
    .columns.filter((columnName: string): boolean => {
      const type: TableColumnType =
        model.getTableColumnMetadata(columnName).type;

      return (
        type !== TableColumnType.Entity && type !== TableColumnType.EntityArray
      );
    });

  expect(persisted.length).toBeGreaterThan(0);

  return persisted;
}

function addColumnStatement(tableName: string, columnName: string): string {
  const statement: string | undefined = statementsIn(UP).find(
    (candidate: string): boolean => {
      return candidate.startsWith(
        `ALTER TABLE "${tableName}" ADD "${columnName}"`,
      );
    },
  );

  expect({
    table: tableName,
    column: columnName,
    added: Boolean(statement),
  }).toEqual({ table: tableName, column: columnName, added: true });

  return statement as string;
}

function foreignKeyStatement(tableName: string, columnName: string): string {
  const statement: string | undefined = statementsIn(UP).find(
    (candidate: string): boolean => {
      return (
        candidate.startsWith(`ALTER TABLE "${tableName}" ADD CONSTRAINT`) &&
        candidate.includes(`FOREIGN KEY ("${columnName}")`)
      );
    },
  );

  expect({
    table: tableName,
    column: columnName,
    keyed: Boolean(statement),
  }).toEqual({ table: tableName, column: columnName, keyed: true });

  return statement as string;
}

const POLICY_COLUMNS: Map<string, string> =
  columnDefinitions("NetworkAlertPolicy");
const PROFILE_COLUMNS: Map<string, string> = columnDefinitions(
  "NetworkSnmpCredentialProfile",
);

describe("the NetworkSnmpCredentialProfile table", () => {
  /*
   * Written out as a literal rather than derived from the model, so that
   * adding a column to the entity without a migration for it fails here
   * rather than passing because both sides moved together.
   */
  test("declares exactly the columns a profile is made of", () => {
    expect([...PROFILE_COLUMNS.keys()].sort()).toEqual([
      "_id",
      "createdAt",
      "createdByUserId",
      "deletedAt",
      "deletedByUserId",
      "description",
      "name",
      "projectId",
      "snmpCommunityString",
      "snmpPort",
      "snmpV3AuthKey",
      "snmpV3AuthProtocol",
      "snmpV3PrivKey",
      "snmpV3PrivProtocol",
      "snmpV3SecurityLevel",
      "snmpV3Username",
      "snmpVersion",
      "updatedAt",
      "version",
    ]);
  });

  test("has a column for every column the model persists", () => {
    for (const columnName of persistedColumnsOf(
      new NetworkSnmpCredentialProfile(),
    )) {
      expect({
        column: columnName,
        inTable: PROFILE_COLUMNS.has(columnName),
      }).toEqual({ column: columnName, inTable: true });
    }
  });

  test("name and projectId are required; nothing about the credentials is", () => {
    expect(definitionOf(PROFILE_COLUMNS, "name")).toContain("NOT NULL");
    expect(definitionOf(PROFILE_COLUMNS, "projectId")).toContain("NOT NULL");

    /*
     * A v2c profile has no v3 fields and a v3 profile has no community
     * string, so every credential column has to accept NULL.
     */
    for (const columnName of [
      "snmpCommunityString",
      "snmpV3SecurityLevel",
      "snmpV3Username",
      "snmpV3AuthProtocol",
      "snmpV3AuthKey",
      "snmpV3PrivProtocol",
      "snmpV3PrivKey",
    ]) {
      expect(definitionOf(PROFILE_COLUMNS, columnName)).not.toContain(
        "NOT NULL",
      );
    }
  });

  /*
   * The three secrets are encrypted at rest. Ciphertext is far longer than
   * the plaintext, so they cannot share the varchar(100) the non-secret
   * SNMP columns use; text is the only honest type.
   */
  test("the three secrets are stored as text, because they are encrypted", () => {
    for (const columnName of [
      "snmpCommunityString",
      "snmpV3AuthKey",
      "snmpV3PrivKey",
    ]) {
      expect(definitionOf(PROFILE_COLUMNS, columnName)).toBe("text");
    }
  });

  test("version and port carry the SNMP defaults", () => {
    expect(definitionOf(PROFILE_COLUMNS, "snmpVersion")).toContain(
      "DEFAULT 'V2c'",
    );
    expect(definitionOf(PROFILE_COLUMNS, "snmpPort")).toContain(
      "DEFAULT '161'",
    );
  });

  test("profiles are looked up by project, so projectId is indexed and cascades with the project", () => {
    expect(UP).toContain(
      `CREATE INDEX "IDX_3114361b9ddb6a70d7c538c28d" ON "NetworkSnmpCredentialProfile" ("projectId")`,
    );
    expect(
      foreignKeyStatement("NetworkSnmpCredentialProfile", "projectId"),
    ).toContain(`REFERENCES "Project"("_id") ON DELETE CASCADE`);
  });
});

describe("the NetworkAlertPolicy table", () => {
  test("declares exactly the columns a policy is made of", () => {
    expect([...POLICY_COLUMNS.keys()].sort()).toEqual([
      "_id",
      "coveredDeviceCount",
      "createdAt",
      "createdByUserId",
      "deletedAt",
      "deletedByUserId",
      "description",
      "isEnabled",
      "lastSyncAt",
      "lastSyncError",
      "monitorTemplateId",
      "name",
      "projectId",
      "scope",
      "templateSyncedAt",
      "updatedAt",
      "version",
    ]);
  });

  test("has a column for every column the model persists", () => {
    for (const columnName of persistedColumnsOf(new NetworkAlertPolicy())) {
      expect({
        column: columnName,
        inTable: POLICY_COLUMNS.has(columnName),
      }).toEqual({ column: columnName, inTable: true });
    }
  });

  /*
   * A policy is enabled unless somebody turns it off, and its scope is an
   * object even before anyone has narrowed it: an empty scope is a valid
   * "every device in the project" policy, not a broken row.
   */
  test("isEnabled defaults to true and scope to an empty object", () => {
    expect(definitionOf(POLICY_COLUMNS, "isEnabled")).toBe(
      "boolean NOT NULL DEFAULT true",
    );
    expect(definitionOf(POLICY_COLUMNS, "scope")).toBe(
      "jsonb NOT NULL DEFAULT '{}'",
    );
  });

  /*
   * A policy can outlive its template (the template FK is SET NULL, below),
   * so the column has to accept NULL rather than dragging the policy down
   * with the template.
   */
  test("monitorTemplateId is optional", () => {
    expect(definitionOf(POLICY_COLUMNS, "monitorTemplateId")).not.toContain(
      "NOT NULL",
    );
  });

  /*
   * One template, one policy per project. Two policies sharing a template
   * would fight over the same monitors. The index is partial so a deleted
   * policy releases its template, and so template-less policies (which
   * cannot create monitors) do not collide with each other.
   */
  test("a template may back at most one live policy per project", () => {
    expect(UP).toContain(
      `CREATE UNIQUE INDEX "IDX_network_alert_policy_project_template_unique" ON "NetworkAlertPolicy" ("projectId", "monitorTemplateId") WHERE "deletedAt" IS NULL AND "monitorTemplateId" IS NOT NULL`,
    );
  });

  test("policies are looked up by project and by template, so both are indexed", () => {
    expect(UP).toContain(
      `CREATE INDEX "IDX_784e9f96c6229aadb1f3ff1f4f" ON "NetworkAlertPolicy" ("projectId")`,
    );
    expect(UP).toContain(
      `CREATE INDEX "IDX_248ef6126744a645d084cb2431" ON "NetworkAlertPolicy" ("monitorTemplateId")`,
    );
  });

  test("the project foreign key cascades; the template foreign key sets null", () => {
    expect(foreignKeyStatement("NetworkAlertPolicy", "projectId")).toContain(
      `REFERENCES "Project"("_id") ON DELETE CASCADE`,
    );
    expect(
      foreignKeyStatement("NetworkAlertPolicy", "monitorTemplateId"),
    ).toContain(`REFERENCES "MonitorTemplate"("_id") ON DELETE SET NULL`);
  });
});

describe("the columns added to existing tables", () => {
  /*
   * Each new column is one its model declares: a column the migration adds
   * that the entity does not know about is dead weight, and one the entity
   * declares that the migration does not add is a runtime error on the
   * first insert.
   */
  test.each([
    { model: "NetworkDevice", instance: new NetworkDevice() },
    { model: "NetworkSite", instance: new NetworkSite() },
    { model: "Monitor", instance: new Monitor() },
  ])(
    "every column added to $model is one the model persists",
    ({ model, instance }: { model: string; instance: BaseModel }) => {
      const persisted: Array<string> = persistedColumnsOf(instance);

      const added: Array<string> = [
        ...UP.matchAll(new RegExp(`ALTER TABLE "${model}" ADD "(\\w+)"`, "g")),
      ].map((match: RegExpMatchArray): string => {
        return match[1] as string;
      });

      expect(added.length).toBeGreaterThan(0);

      for (const columnName of added) {
        expect({
          column: columnName,
          persisted: persisted.includes(columnName),
        }).toEqual({ column: columnName, persisted: true });
      }
    },
  );

  test("NetworkDevice gains the profile link and the walk's own result", () => {
    expect(
      [...UP.matchAll(/ALTER TABLE "NetworkDevice" ADD "(\w+)"/g)]
        .map((match: RegExpMatchArray): string => {
          return match[1] as string;
        })
        .sort(),
    ).toEqual(["isSnmpReachable", "lastSnmpSeenAt", "snmpCredentialProfileId"]);
  });

  /*
   * THE ASSERTION BEHIND "SNMP failing" NEVER SHOWING ON A PING-ONLY DEVICE.
   *
   * NULL is a meaningful value here and always will be: no walk has been
   * attempted. Every existing device holds it on upgrade and every device
   * without credentials holds it forever. A DEFAULT false would put every
   * one of them into the "SNMP failing" state the moment the column landed.
   */
  test("isSnmpReachable is nullable with no default: NULL means no walk was attempted", () => {
    const statement: string = addColumnStatement(
      "NetworkDevice",
      "isSnmpReachable",
    );

    expect(statement).toBe(
      `ALTER TABLE "NetworkDevice" ADD "isSnmpReachable" boolean`,
    );
  });

  test("NetworkSite gains its two monitoring defaults", () => {
    expect(
      [...UP.matchAll(/ALTER TABLE "NetworkSite" ADD "(\w+)"/g)]
        .map((match: RegExpMatchArray): string => {
          return match[1] as string;
        })
        .sort(),
    ).toEqual(["probeId", "snmpCredentialProfileId"]);
  });

  test("Monitor gains the link to the policy that owns it", () => {
    expect(
      [...UP.matchAll(/ALTER TABLE "Monitor" ADD "(\w+)"/g)].map(
        (match: RegExpMatchArray): string => {
          return match[1] as string;
        },
      ),
    ).toEqual(["networkAlertPolicyId"]);
  });

  /*
   * All of them are optional: a device without a profile is pinged, a site
   * without a probe leaves devices to name their own, a monitor without a
   * policy is one somebody made by hand. NOT NULL on any of these would
   * restate every existing row as something somebody chose.
   */
  test("every added column is nullable with no default", () => {
    const ADD_COLUMN: RegExp = /^ALTER TABLE "\w+" ADD "\w+"/;

    const added: Array<string> = statementsIn(UP).filter(
      (statement: string): boolean => {
        return ADD_COLUMN.test(statement);
      },
    );

    expect(added.length).toBe(6);

    for (const statement of added) {
      expect(statement).not.toContain("NOT NULL");
      expect(statement).not.toContain("DEFAULT");
    }
  });

  test("each foreign-key column is indexed, because each is a filter on a list page", () => {
    expect(UP).toContain(
      `CREATE INDEX "IDX_51cac50b63aac2d24983010b47" ON "Monitor" ("networkAlertPolicyId")`,
    );
    expect(UP).toContain(
      `CREATE INDEX "IDX_b54c966057aa58e360a4f2e532" ON "NetworkSite" ("probeId")`,
    );
    expect(UP).toContain(
      `CREATE INDEX "IDX_79c8d9b3f4f3b3c93bddcbd713" ON "NetworkSite" ("snmpCredentialProfileId")`,
    );
    /*
     * The device index is COMPOSITE, and leads with projectId. Every read of
     * it is per-project — "which of this project's devices use this profile?"
     * is the question the delete guard asks before refusing, and the
     * credential resolver batches by project too. A bare index on the profile
     * column alone would make the guard scan every project's devices.
     */
    expect(UP).toContain(
      `CREATE INDEX "IDX_293e5f4308dec96413427b6739" ON "NetworkDevice" ("projectId", "snmpCredentialProfileId")`,
    );
  });
});

describe("deleting configuration never deletes inventory", () => {
  /*
   * THE ASSERTION THIS FILE EXISTS FOR.
   *
   * Every other NetworkDevice and NetworkSite relation in this schema is ON
   * DELETE CASCADE, so CASCADE is what a regeneration or a copy-paste
   * produces by default. Here it would mean that deleting a credential
   * profile from Network > Settings deletes every device and site that used
   * it, that deleting a probe deletes every site that defaulted to it, and
   * that deleting an alert policy deletes the monitors (and their incident
   * history) it created. SET NULL puts each of them back to the state "no
   * profile / no default probe / hand-made monitor" has always meant.
   */
  test.each([
    {
      table: "NetworkDevice",
      column: "snmpCredentialProfileId",
      references: "NetworkSnmpCredentialProfile",
    },
    {
      table: "NetworkSite",
      column: "snmpCredentialProfileId",
      references: "NetworkSnmpCredentialProfile",
    },
    { table: "NetworkSite", column: "probeId", references: "Probe" },
    {
      table: "Monitor",
      column: "networkAlertPolicyId",
      references: "NetworkAlertPolicy",
    },
    {
      table: "NetworkAlertPolicy",
      column: "monitorTemplateId",
      references: "MonitorTemplate",
    },
  ])(
    "$table.$column -> $references is ON DELETE SET NULL",
    ({
      table,
      column,
      references,
    }: {
      table: string;
      column: string;
      references: string;
    }) => {
      const statement: string = foreignKeyStatement(table, column);

      expect(statement).toContain(
        `REFERENCES "${references}"("_id") ON DELETE SET NULL`,
      );
      expect(statement).not.toContain("ON DELETE CASCADE");
    },
  );

  /*
   * ...and the only CASCADEs are the two tenancy keys, where cascading is
   * correct: a project's profiles and policies go with the project.
   */
  test("the only cascading foreign keys are the two projectId keys", () => {
    const cascading: Array<string> = statementsIn(UP)
      .filter((statement: string): boolean => {
        return statement.includes("ON DELETE CASCADE");
      })
      .map((statement: string): string => {
        const match: RegExpMatchArray | null = statement.match(
          /^ALTER TABLE "(\w+)" ADD CONSTRAINT "\w+" FOREIGN KEY \("(\w+)"\)/,
        );

        return `${match?.[1]}.${match?.[2]}`;
      })
      .sort();

    expect(cascading).toEqual([
      "NetworkAlertPolicy.projectId",
      "NetworkSnmpCredentialProfile.projectId",
    ]);
  });
});

describe("the default monitoring method", () => {
  /*
   * The change the whole migration is in service of. A device registered
   * through the API with no method named is polled by its probe; before
   * this it was 'SNMP', which the NormalizeNetworkDeviceMonitoringMethod
   * data migration rewrites on the rows that already hold it.
   */
  test("becomes 'Probe' on the way up", () => {
    expect(UP).toContain(
      `ALTER TABLE "NetworkDevice" ALTER COLUMN "monitoringMethod" SET DEFAULT 'Probe'`,
    );
  });

  test("is restored to 'SNMP' on the way down, which is what it was", () => {
    expect(DOWN).toContain(
      `ALTER TABLE "NetworkDevice" ALTER COLUMN "monitoringMethod" SET DEFAULT 'SNMP'`,
    );
  });

  /*
   * A default is not a rewrite. Existing rows keep whatever they hold and
   * the data migration decides what to do with them; a schema migration
   * that UPDATEd them would run before the code that understands the new
   * values was necessarily deployed.
   */
  test("existing rows are not rewritten by the schema migration", () => {
    for (const statement of [...statementsIn(UP), ...statementsIn(DOWN)]) {
      expect(statement).not.toMatch(/^UPDATE /);
    }
  });
});

describe("what the migration deliberately leaves alone", () => {
  /*
   * up() drops nothing at all. The columns this change makes redundant
   * (the per-device SNMP credential columns still work as the first stop in
   * credential resolution) stay exactly as they are.
   */
  test("up drops no column, no table and no index", () => {
    expect(UP).not.toContain("DROP COLUMN");
    expect(UP).not.toContain("DROP TABLE");
    expect(UP).not.toContain("DROP INDEX");
  });

  test("the only columns down drops are the six up added", () => {
    const droppedColumns: Array<string> = [
      ...DOWN.matchAll(/ALTER TABLE "(\w+)" DROP COLUMN "(\w+)"/g),
    ]
      .map((match: RegExpMatchArray): string => {
        return `${match[1]}.${match[2]}`;
      })
      .sort();

    expect(droppedColumns).toEqual([
      "Monitor.networkAlertPolicyId",
      "NetworkDevice.isSnmpReachable",
      "NetworkDevice.lastSnmpSeenAt",
      "NetworkDevice.snmpCredentialProfileId",
      "NetworkSite.probeId",
      "NetworkSite.snmpCredentialProfileId",
    ]);
  });

  /*
   * The generator was run against a developer database carrying drift from
   * other branches; this pins that none of it was kept. Only the five
   * tables the feature touches may appear.
   */
  test("only the two new tables, NetworkDevice, NetworkSite and Monitor are touched", () => {
    const touchedTables: Set<string> = new Set<string>(
      [
        ...UP.matchAll(/(?:ALTER|CREATE) TABLE "(\w+)"/g),
        ...DOWN.matchAll(/(?:ALTER|CREATE|DROP) TABLE "(\w+)"/g),
      ].map((match: RegExpMatchArray): string => {
        return match[1] as string;
      }),
    );

    expect([...touchedTables].sort()).toEqual([
      "Monitor",
      "NetworkAlertPolicy",
      "NetworkDevice",
      "NetworkSite",
      "NetworkSnmpCredentialProfile",
    ]);
  });
});

describe("up and down are symmetric", () => {
  /*
   * Names each object a statement brings into or takes out of existence, so
   * the two halves can be compared as lists rather than as SQL. An
   * unrecognised statement returns null and fails the count assertion below
   * rather than being quietly skipped.
   */
  function objectTouchedBy(statement: string): string | null {
    const patterns: Array<{ pattern: RegExp; kind: string }> = [
      { pattern: /^CREATE TABLE "(\w+)"/, kind: "table" },
      { pattern: /^DROP TABLE "(\w+)"/, kind: "table" },
      { pattern: /^CREATE (?:UNIQUE )?INDEX "(\w+)"/, kind: "index" },
      { pattern: /^DROP INDEX "public"\."(\w+)"/, kind: "index" },
      { pattern: /ADD CONSTRAINT "(\w+)"/, kind: "constraint" },
      { pattern: /DROP CONSTRAINT "(\w+)"/, kind: "constraint" },
      { pattern: /^ALTER TABLE "(\w+)" ADD "(\w+)"/, kind: "column" },
      { pattern: /^ALTER TABLE "(\w+)" DROP COLUMN "(\w+)"/, kind: "column" },
      {
        pattern: /^ALTER TABLE "(\w+)" ALTER COLUMN "(\w+)" SET DEFAULT/,
        kind: "default",
      },
    ];

    for (const { pattern, kind } of patterns) {
      const match: RegExpMatchArray | null = statement.match(pattern);

      if (match) {
        return `${kind}:${match.slice(1).join(".")}`;
      }
    }

    return null;
  }

  const createdInUp: Array<string | null> =
    statementsIn(UP).map(objectTouchedBy);
  const droppedInDown: Array<string | null> =
    statementsIn(DOWN).map(objectTouchedBy);

  test("every statement in both halves is one this test understands", () => {
    expect(createdInUp).not.toContain(null);
    expect(droppedInDown).not.toContain(null);
    expect(createdInUp.length).toBe(28);
  });

  /*
   * Reverse order is not cosmetic: the foreign keys reference the tables
   * and the columns, so dropping a table first would fail outright. A
   * down() that cannot run is a migration that cannot be rolled back.
   */
  test("down undoes exactly what up did, in reverse order", () => {
    expect(droppedInDown).toEqual([...createdInUp].reverse());
  });

  /*
   * A stray semicolon would split one queryRunner.query() into two, and a
   * newline inside a statement means the template literal wrapped.
   * Trailing whitespace is tolerated deliberately: TypeORM's generator ends
   * a CREATE INDEX with no WHERE clause in a single space.
   */
  test("every statement is a complete, single statement", () => {
    for (const statement of [...statementsIn(UP), ...statementsIn(DOWN)]) {
      expect(statement).not.toContain(";");
      expect(statement).not.toContain("\n");
      expect(statement.trimStart()).toBe(statement);
    }
  });
});

describe("the migration runs", () => {
  test("it is imported and listed in the registry file", () => {
    const index: string = fs.readFileSync(
      path.join(path.dirname(MIGRATION_PATH), "Index.ts"),
      "utf8",
    );

    expect(index).toContain(`from "./${MIGRATION_FILE}"`);
    expect(index).toContain(
      "AddNetworkSnmpCredentialProfilesAndAlertPolicies1791000000000,",
    );
  });

  test("it is in the exported migration list, after every migration it builds on", () => {
    const position: number = SchemaMigrations.indexOf(
      AddNetworkSnmpCredentialProfilesAndAlertPolicies1791000000000,
    );

    expect(position).toBeGreaterThan(-1);

    /*
     * It references tables and columns that earlier migrations create, so it
     * has to run after all of them. Each one named here is a table this
     * migration's SQL actually touches: creating a foreign key onto a table
     * that does not exist yet fails the whole boot.
     *
     * Stated as "after these", not "last in the array", deliberately —
     * merging master brings other teams' migrations in after this one, and a
     * position-is-last assertion would fail on the merge rather than on a
     * real ordering mistake.
     */
    for (const earlier of [
      AddNetworkDeviceRoleTable1790800000000,
      AddNetworkSiteTypeParentHierarchy1790700000000,
      AddNetworkDeviceOidTemplate1790500000000,
    ]) {
      const earlierPosition: number = SchemaMigrations.indexOf(earlier);

      expect(earlierPosition).toBeGreaterThan(-1);
      expect(position).toBeGreaterThan(earlierPosition);
    }
  });

  /*
   * TypeORM records applied migrations by the `name` property, not the
   * file name. A mismatch re-runs the migration on every boot, and this one
   * CREATEs tables with no IF NOT EXISTS, so the re-run fails hard.
   */
  test("its declared name matches its class name", () => {
    expect(
      new AddNetworkSnmpCredentialProfilesAndAlertPolicies1791000000000().name,
    ).toBe("AddNetworkSnmpCredentialProfilesAndAlertPolicies1791000000000");
  });

  test("exactly one file on disk carries its timestamp, and it is this one", () => {
    const directory: string = path.dirname(MIGRATION_PATH);
    const matching: Array<string> = fs
      .readdirSync(directory)
      .filter((file: string): boolean => {
        return file.startsWith("1791000000000-");
      });

    expect(matching).toEqual([`${MIGRATION_FILE}.ts`]);
  });

  /*
   * `npm run generate-postgres-migration` writes its output as
   * "<timestamp>-MigrationName.ts", and running it leaves that file on disk
   * next to the renamed copy unless somebody deletes it. Committing both
   * applies the same DDL twice, which fails on the CREATE TABLE.
   *
   * The check is scoped to migrations newer than the last legacy placeholder
   * because this repo carries 321 of them from before migrations were named
   * for what they do (the newest is 1787923136162). Those are shipped
   * history and are not this test's business; anything newer is a
   * placeholder somebody forgot to rename.
   */
  test("no generated placeholder migration was left behind", () => {
    const LAST_LEGACY_PLACEHOLDER_TIMESTAMP: number = 1787923136162;

    const directory: string = path.dirname(MIGRATION_PATH);

    const modernPlaceholders: Array<string> = fs
      .readdirSync(directory)
      .filter((file: string): boolean => {
        if (!file.includes("MigrationName")) {
          return false;
        }

        const timestamp: number = Number(file.split("-")[0]);

        return (
          Number.isFinite(timestamp) &&
          timestamp > LAST_LEGACY_PLACEHOLDER_TIMESTAMP
        );
      });

    expect(modernPlaceholders).toEqual([]);
  });
});
