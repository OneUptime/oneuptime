import {
  CROSS_PROJECT_REFERENCES,
  CrossProjectReference,
  RepairCrossProjectIncidentReferences1785320000000,
  TIMELINE_FOREIGN_KEYS,
  getClearQuery,
  getRepairQuery,
} from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1785320000000-RepairCrossProjectIncidentReferences";
import { RepairCrossProjectMonitorStatusReferences1785240000000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1785240000000-RepairCrossProjectMonitorStatusReferences";
import SchemaMigrations from "../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import AlertEpisodeStateTimeline from "../../../Models/DatabaseModels/AlertEpisodeStateTimeline";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import IncidentEpisodeStateTimeline from "../../../Models/DatabaseModels/IncidentEpisodeStateTimeline";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import ScheduledMaintenanceStateTimeline from "../../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import type { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";
import { describe, expect, test } from "@jest/globals";

/*
 * Deleting a project answered "This item cannot be deleted because Incident
 * records still reference it": an Incident in project B held project A's
 * IncidentSeverity id, the FK is ON DELETE NO ACTION, and the cascade from
 * project A tripped over it (23503).
 *
 * These tests pin the three pieces that have to hold for that to stay fixed —
 * a regression in any one silently brings the undeletable project back:
 *   1. the reference list covers every ON DELETE NO ACTION column a project
 *      delete can trip over (checked against the pinned list below),
 *   2. the migration's SQL contract: repair every reference, clear only the
 *      nullable leftovers, and swap exactly the five state-timeline FKs to
 *      ON DELETE CASCADE — with down() putting NO ACTION back,
 *   3. the matching @ManyToOne(onDelete: "CASCADE") on those five entities, so
 *      a future schema:generate does not emit the swap back as "drift", and
 *      the migration's registration in SchemaMigrations/Index.ts (an
 *      unregistered migration is dead code and never runs on boot).
 *
 * Pure metadata/mocks — no Postgres connection anywhere.
 */

/*
 * Every (table, column) whose FK to a project-scoped state / severity / status
 * was ON DELETE NO ACTION when this migration was written, minus
 * Monitor.currentMonitorStatusId which stays NO ACTION on purpose and was
 * already repaired by RepairCrossProjectMonitorStatusReferences1785240000000.
 */
const EXPECTED_REFERENCES: Array<string> = [
  "Alert.alertSeverityId",
  "Alert.currentAlertStateId",
  "Alert.monitorStatusWhenThisAlertWasCreatedId",
  "AlertEpisode.alertSeverityId",
  "AlertEpisode.currentAlertStateId",
  "AlertEpisodeStateTimeline.alertStateId",
  "AlertStateTimeline.alertStateId",
  "Incident.changeMonitorStatusToId",
  "Incident.currentIncidentStateId",
  "Incident.incidentSeverityId",
  "IncidentEpisode.currentIncidentStateId",
  "IncidentEpisode.incidentSeverityId",
  "IncidentEpisodeStateTimeline.incidentStateId",
  "IncidentStateTimeline.incidentStateId",
  "IncidentTemplate.changeMonitorStatusToId",
  "IncidentTemplate.incidentSeverityId",
  "IncidentTemplate.initialIncidentStateId",
  "ScheduledMaintenance.changeMonitorStatusToId",
  "ScheduledMaintenance.currentScheduledMaintenanceStateId",
  "ScheduledMaintenanceStateTimeline.scheduledMaintenanceStateId",
  "ScheduledMaintenanceTemplate.changeMonitorStatusToId",
];

/*
 * The columns the schema declares NOT NULL. A leftover cross-project value can
 * only be cleared on the others, so getting this wrong either leaves rows that
 * still block the delete or writes NULL into a not-null column mid-migration.
 */
const NOT_NULL_COLUMNS: Array<string> = [
  "Alert.alertSeverityId",
  "Alert.currentAlertStateId",
  "AlertEpisode.currentAlertStateId",
  "AlertEpisodeStateTimeline.alertStateId",
  "AlertStateTimeline.alertStateId",
  "Incident.currentIncidentStateId",
  "Incident.incidentSeverityId",
  "IncidentEpisode.currentIncidentStateId",
  "IncidentEpisodeStateTimeline.incidentStateId",
  "IncidentStateTimeline.incidentStateId",
  "ScheduledMaintenance.currentScheduledMaintenanceStateId",
  "ScheduledMaintenanceStateTimeline.scheduledMaintenanceStateId",
];

type ModelClass = { new (): unknown };

// [entity, the FK column its state relation writes]
const CASCADING_TIMELINE_RELATIONS: Array<[ModelClass, string]> = [
  [IncidentStateTimeline, "incidentStateId"],
  [IncidentEpisodeStateTimeline, "incidentStateId"],
  [AlertStateTimeline, "alertStateId"],
  [AlertEpisodeStateTimeline, "alertStateId"],
  [ScheduledMaintenanceStateTimeline, "scheduledMaintenanceStateId"],
];

function recordQueries(): {
  queryRunner: QueryRunner;
  queries: Array<string>;
} {
  const queries: Array<string> = [];

  const queryRunner: QueryRunner = {
    query: async (sql: string): Promise<void> => {
      queries.push(sql);
    },
  } as unknown as QueryRunner;

  return { queryRunner, queries };
}

async function runUp(): Promise<Array<string>> {
  const { queryRunner, queries } = recordQueries();
  await new RepairCrossProjectIncidentReferences1785320000000().up(queryRunner);
  return queries;
}

async function runDown(): Promise<Array<string>> {
  const { queryRunner, queries } = recordQueries();
  await new RepairCrossProjectIncidentReferences1785320000000().down(
    queryRunner,
  );
  return queries;
}

function key(reference: { table: string; column: string }): string {
  return `${reference.table}.${reference.column}`;
}

describe("RepairCrossProjectIncidentReferences migration", () => {
  describe("coverage of the references a project delete trips over", () => {
    test("repairs exactly the known ON DELETE NO ACTION references", async () => {
      expect(CROSS_PROJECT_REFERENCES.map(key).sort()).toEqual(
        EXPECTED_REFERENCES,
      );
    });

    test("marks nullable exactly where the schema allows NULL", async () => {
      const notNull: Array<string> = CROSS_PROJECT_REFERENCES.filter(
        (reference: { isNullable: boolean }) => {
          return !reference.isNullable;
        },
      )
        .map(key)
        .sort();

      expect(notNull).toEqual(NOT_NULL_COLUMNS);
    });

    test("points each reference at the table that actually owns it", async () => {
      for (const reference of CROSS_PROJECT_REFERENCES) {
        if (reference.referencedTable === "MonitorStatus") {
          expect(reference.orderColumn).toBe("priority");
        } else {
          expect(reference.orderColumn).toBe("order");
        }

        // Severities have no role flags to fall back on; states do.
        if (reference.referencedTable.endsWith("Severity")) {
          expect(reference.roleColumns).toEqual([]);
        } else {
          expect(reference.roleColumns.length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe("repair query", () => {
    test("only touches rows whose reference belongs to another project", async () => {
      for (const reference of CROSS_PROJECT_REFERENCES) {
        expect(getRepairQuery(reference)).toContain(
          `WHERE c."projectId" IS DISTINCT FROM p."projectId"`,
        );
      }
    });

    test("never lets a name match cross a role boundary", async () => {
      /*
       * A project may have a custom state literally called "Resolved" that is
       * NOT its resolved state. If a bare name match can win, a resolved
       * incident is silently repointed at a non-resolved state — and the
       * migration is one-way. So every branch that can win before the bare
       * name match must carry the role predicate.
       */
      for (const reference of CROSS_PROJECT_REFERENCES) {
        if (reference.roleColumns.length === 0) {
          continue;
        }

        const sql: string = getRepairQuery(reference);
        const roleColumn: string = reference.roleColumns[0]!;

        const nameAndRole: number = sql.indexOf(
          `AND lower(x."name") = lower(b.ref_name)`,
        );
        const bareName: number = sql.indexOf(
          `x."projectId" = b.project_id AND lower(x."name") = lower(b.ref_name)`,
        );
        const firstRole: number = sql.indexOf(
          `x."${roleColumn}" = b.role_${roleColumn}`,
        );

        expect(nameAndRole).toBeGreaterThan(-1);
        expect(firstRole).toBeGreaterThan(-1);
        expect(bareName).toBeGreaterThan(-1);

        // Both role-bearing branches are ahead of the bare name match.
        expect(bareName).toBeGreaterThan(nameAndRole);
        expect(bareName).toBeGreaterThan(firstRole);

        // And the role predicate appears in exactly the two leading branches.
        expect(
          (
            sql.match(
              new RegExp(`x\\."${roleColumn}" = b\\.role_${roleColumn}`, "g"),
            ) || []
          ).length,
        ).toBe(2);
      }
    });

    test("falls back to nearest order only after every targeted match", async () => {
      for (const reference of CROSS_PROJECT_REFERENCES) {
        const sql: string = getRepairQuery(reference);

        const byOrder: number = sql.indexOf(
          `abs(x."${reference.orderColumn}" - b.ref_order)`,
        );
        const byName: number = sql.indexOf(
          `lower(x."name") = lower(b.ref_name)`,
        );

        expect(byName).toBeGreaterThan(-1);
        expect(byOrder).toBeGreaterThan(byName);
      }
    });

    test("only ever repoints inside the row's own project", async () => {
      for (const reference of CROSS_PROJECT_REFERENCES) {
        const sql: string = getRepairQuery(reference);
        const candidateFilters: number = (
          sql.match(/x\."projectId" = b\.project_id/g) || []
        ).length;

        // One per branch of the COALESCE ladder.
        expect(candidateFilters).toBe(reference.roleColumns.length > 0 ? 4 : 2);
      }
    });

    test("leaves the row alone when nothing in its own project matches", async () => {
      for (const reference of CROSS_PROJECT_REFERENCES) {
        expect(getRepairQuery(reference)).toContain(
          `WHERE c."_id" = r.row_id AND r.good_id IS NOT NULL`,
        );
      }
    });

    test("skips the role branch for severities, which have no role flags", async () => {
      const severityReference: CrossProjectReference =
        CROSS_PROJECT_REFERENCES.find(
          (reference: { referencedTable: string }) => {
            return reference.referencedTable === "IncidentSeverity";
          },
        )!;

      expect(getRepairQuery(severityReference)).not.toContain("role_");
    });
  });

  describe("clear query", () => {
    test("clears only the cross-project leftovers", async () => {
      const nullableReference: CrossProjectReference =
        CROSS_PROJECT_REFERENCES.find((reference: { isNullable: boolean }) => {
          return reference.isNullable;
        })!;

      const sql: string = getClearQuery(nullableReference);

      expect(sql).toContain(`SET "${nullableReference.column}" = NULL`);
      expect(sql).toContain(`c."projectId" IS DISTINCT FROM p."projectId"`);
    });
  });

  describe("up()", () => {
    test("raises the statement timeout before the table scans", async () => {
      const queries: Array<string> = await runUp();

      expect(queries[0]).toContain("SET LOCAL statement_timeout");
    });

    test("bounds the lock wait before swapping foreign keys", async () => {
      const queries: Array<string> = await runUp();

      const lockTimeoutAt: number = queries.findIndex((sql: string) => {
        return sql.includes("SET LOCAL lock_timeout");
      });
      const firstAlterAt: number = queries.findIndex((sql: string) => {
        return sql.includes("DROP CONSTRAINT");
      });

      expect(lockTimeoutAt).toBeGreaterThan(-1);
      expect(firstAlterAt).toBeGreaterThan(lockTimeoutAt);
    });

    test("drops the raised statement timeout before taking any lock", async () => {
      /*
       * DATABASE_QUERY_TIMEOUT_MS is a client-side deadline no SET can lift.
       * If the client gives up while an ADD CONSTRAINT is still running, the
       * server keeps going and the queued ROLLBACK times out too — holding
       * ACCESS EXCLUSIVE for as long as the raised ceiling allows, long after
       * the deploy already failed. Aborting server-side is the cheaper
       * failure, so the ceiling must be back to default before the DDL.
       */
      const queries: Array<string> = await runUp();

      const resetAt: number = queries.findIndex((sql: string) => {
        return sql.includes("SET LOCAL statement_timeout = DEFAULT");
      });
      const firstAlterAt: number = queries.findIndex((sql: string) => {
        return sql.includes("DROP CONSTRAINT");
      });
      const lastRepairAt: number = queries.reduce(
        (last: number, sql: string, index: number) => {
          return sql.includes("resolved r") ? index : last;
        },
        -1,
      );

      expect(resetAt).toBeGreaterThan(lastRepairAt);
      expect(firstAlterAt).toBeGreaterThan(resetAt);
    });

    test("repairs every reference, and clears only the nullable ones", async () => {
      const queries: Array<string> = await runUp();

      for (const reference of CROSS_PROJECT_REFERENCES) {
        /*
         * Asserted structurally rather than by comparing against
         * getRepairQuery's own output, which would pass for any SQL the
         * builder happened to emit.
         */
        const repairs: Array<string> = queries.filter((sql: string) => {
          return (
            sql.includes(`UPDATE "${reference.table}" c`) &&
            sql.includes(`SET "${reference.column}" = r.good_id`) &&
            sql.includes(`JOIN "${reference.referencedTable}" p`)
          );
        });

        expect(repairs).toHaveLength(1);

        const clears: Array<string> = queries.filter((sql: string) => {
          return (
            sql.includes(`UPDATE "${reference.table}" c`) &&
            sql.includes(`SET "${reference.column}" = NULL`)
          );
        });

        expect(clears).toHaveLength(reference.isNullable ? 1 : 0);
      }
    });

    test("counts what it could not repair, for every reference", async () => {
      /*
       * A row survives both the repair and the clear only when its own
       * project has nothing to point at. That keeps the project undeletable,
       * so it must not pass silently — the user would retry the delete and
       * see a byte-identical error with nothing to act on.
       */
      const queries: Array<string> = await runUp();

      for (const reference of CROSS_PROJECT_REFERENCES) {
        const counts: Array<string> = queries.filter((sql: string) => {
          return (
            sql.includes("count(*)::int AS remaining") &&
            sql.includes(`FROM "${reference.table}" c`) &&
            sql.includes(`p."_id" = c."${reference.column}"`)
          );
        });

        expect(counts).toHaveLength(1);
      }
    });

    test("repairs the data before the cascade can sweep it up", async () => {
      /*
       * Order matters: switching the timeline FKs to CASCADE first would let
       * the project delete take another project's timeline history with it,
       * instead of the history staying with the project that owns it.
       */
      const queries: Array<string> = await runUp();

      const lastRepairAt: number = queries.reduce(
        (last: number, sql: string, index: number) => {
          return sql.includes("resolved r") ? index : last;
        },
        -1,
      );
      const firstAlterAt: number = queries.findIndex((sql: string) => {
        return sql.includes("DROP CONSTRAINT");
      });

      expect(lastRepairAt).toBeGreaterThan(-1);
      expect(firstAlterAt).toBeGreaterThan(lastRepairAt);
    });

    test("swaps exactly the five state-timeline foreign keys to CASCADE", async () => {
      const queries: Array<string> = await runUp();

      const added: Array<string> = queries.filter((sql: string) => {
        return sql.includes("ADD CONSTRAINT");
      });

      expect(added).toHaveLength(TIMELINE_FOREIGN_KEYS.length);
      expect(TIMELINE_FOREIGN_KEYS).toHaveLength(5);

      for (const foreignKey of TIMELINE_FOREIGN_KEYS) {
        expect(queries).toContain(
          `ALTER TABLE "${foreignKey.table}" DROP CONSTRAINT "${foreignKey.constraintName}"`,
        );
        expect(queries).toContain(
          `ALTER TABLE "${foreignKey.table}" ADD CONSTRAINT "${foreignKey.constraintName}" FOREIGN KEY ("${foreignKey.column}") REFERENCES "${foreignKey.referencedTable}"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
        );
      }
    });

    test("touches no table outside the ones it declares", async () => {
      const queries: Array<string> = await runUp();
      const declaredTables: Array<string> = CROSS_PROJECT_REFERENCES.map(
        (reference: { table: string }) => {
          return reference.table;
        },
      ).concat(
        CROSS_PROJECT_REFERENCES.map(
          (reference: { referencedTable: string }) => {
            return reference.referencedTable;
          },
        ),
      );

      for (const sql of queries) {
        for (const table of sql.match(/UPDATE "([A-Za-z]+)"/g) || []) {
          expect(declaredTables).toContain(table.replace(/UPDATE "|"/g, ""));
        }
      }
    });
  });

  describe("down()", () => {
    test("puts NO ACTION back on every foreign key up() swapped", async () => {
      const queries: Array<string> = await runDown();

      for (const foreignKey of TIMELINE_FOREIGN_KEYS) {
        expect(queries).toContain(
          `ALTER TABLE "${foreignKey.table}" DROP CONSTRAINT "${foreignKey.constraintName}"`,
        );
        expect(queries).toContain(
          `ALTER TABLE "${foreignKey.table}" ADD CONSTRAINT "${foreignKey.constraintName}" FOREIGN KEY ("${foreignKey.column}") REFERENCES "${foreignKey.referencedTable}"("_id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
        );
      }
    });

    test("does not try to undo the data repair", async () => {
      const queries: Array<string> = await runDown();

      expect(
        queries.filter((sql: string) => {
          return sql.trimStart().startsWith("UPDATE ");
        }),
      ).toHaveLength(0);
    });
  });

  describe("entity metadata", () => {
    test("the five timeline relations declare ON DELETE CASCADE", async () => {
      /*
       * Without this the next `schema:generate` sees the database disagreeing
       * with the entities and emits an ALTER putting NO ACTION back.
       */
      const relations: Array<RelationMetadataArgs> =
        getMetadataArgsStorage().relations;

      for (const [model, column] of CASCADING_TIMELINE_RELATIONS) {
        const relation: RelationMetadataArgs | undefined = relations.find(
          (candidate: RelationMetadataArgs) => {
            return (
              candidate.target === model &&
              candidate.propertyName === column.replace(/Id$/, "")
            );
          },
        );

        expect(relation).toBeDefined();
        expect(relation?.options.onDelete).toBe("CASCADE");
      }
    });
  });

  describe("registration", () => {
    test("is registered so it runs on boot", async () => {
      expect(SchemaMigrations).toContain(
        RepairCrossProjectIncidentReferences1785320000000,
      );
    });

    test("runs after the migration it builds on", async () => {
      /*
       * It must land after the monitor-status repair, whose cross-project
       * cleanup it assumes. Pinning it to the last slot instead would turn
       * red the moment anyone appends an unrelated migration.
       */
      expect(
        SchemaMigrations.indexOf(
          RepairCrossProjectIncidentReferences1785320000000,
        ),
      ).toBeGreaterThan(
        SchemaMigrations.indexOf(
          RepairCrossProjectMonitorStatusReferences1785240000000,
        ),
      );
    });
  });
});
