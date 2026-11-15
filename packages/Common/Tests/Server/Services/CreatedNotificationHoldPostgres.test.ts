import Alert from "../../../Models/DatabaseModels/Alert";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import AlertService from "../../../Server/Services/AlertService";
import IncidentService from "../../../Server/Services/IncidentService";
import Select from "../../../Server/Types/Database/Select";
import CreatedNotificationHold from "../../../Server/Utils/Notification/CreatedNotificationHold";
import ObjectID from "../../../Types/ObjectID";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource } from "typeorm";

/*
 * THE OWNERS' CREATED NOTIFICATION'S HOLD, ON A REAL POSTGRES (issues
 * #7571, #7573).
 *
 * The hold is written on the record (createdNotificationHeldAt); its
 * release and the Created job's take are each one compare-and-set
 * (DatabaseService.compareAndSetColumnsByIdWithoutHooks) - so whichever
 * comes first acts, and the other writes nothing: the email goes out once,
 * wherever the process that held it stopped. Here the real services run
 * them against copies of the migrated Incident and Alert tables: the hold's
 * time read back exactly as written, the job's two reads, both writes, and
 * the release and the take racing on two connections.
 *
 * Opt in with RUN_POSTGRES_CREATED_NOTIFICATION_HOLD_TESTS=true and a
 * migrated database (CREATED_NOTIFICATION_HOLD_TEST_DATABASE_HOST, _PORT,
 * _NAME; DATABASE_USERNAME, DATABASE_PASSWORD). Every write is to a schema
 * of its own; only the tables' structure is copied, never their rows.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_CREATED_NOTIFICATION_HOLD_TESTS"] === "true"
    ? describe
    : describe.skip;

type Kind = "Incident" | "Alert";

const PROJECT_ID: ObjectID = ObjectID.generate();
const OTHER_PROJECT_ID: ObjectID = ObjectID.generate();

// The flag the job and the hold write, by kind.
const NOTIFIED_COLUMN: Record<Kind, string> = {
  Incident: "isOwnerNotifiedOfResourceCreation",
  Alert: "isOwnerNotifiedOfAlertCreation",
};

interface CreatedNotificationService {
  findCreatedNotificationsDue: (data: {
    select: Select<BaseModel>;
    now: Date;
  }) => Promise<Array<BaseModel>>;
  takeCreatedNotification: (record: BaseModel) => Promise<boolean>;
}

const SERVICE: Record<Kind, CreatedNotificationService> = {
  Incident: IncidentService as unknown as CreatedNotificationService,
  Alert: AlertService as unknown as CreatedNotificationService,
};

// The release the create's chain runs once every owner is in (private to each service).
async function release(
  kind: Kind,
  id: ObjectID,
  heldAt: Date | undefined,
): Promise<void> {
  if (kind === "Incident") {
    const incident: Incident = new Incident(id);
    incident.projectId = PROJECT_ID;

    await (
      IncidentService as unknown as {
        releaseCreatedNotificationHeldForOwners: (data: {
          incident: Incident;
          heldAt: Date | undefined;
        }) => Promise<void>;
      }
    ).releaseCreatedNotificationHeldForOwners({
      incident: incident,
      heldAt: heldAt,
    });
    return;
  }

  const alert: Alert = new Alert(id);
  alert.projectId = PROJECT_ID;

  await (
    AlertService as unknown as {
      releaseCreatedNotificationHeldForOwners: (data: {
        alert: Alert;
        heldAt: Date | undefined;
      }) => Promise<void>;
    }
  ).releaseCreatedNotificationHeldForOwners({ alert: alert, heldAt: heldAt });
}

function minutesBefore(now: Date, minutes: number): Date {
  return new Date(now.getTime() - minutes * 60 * 1000);
}

describePostgres(
  "the owners' Created notification's hold, against Postgres",
  () => {
    const schema: string = `created_hold_test_${ObjectID.generate().toString().replace(/-/g, "")}`;
    let database: DataSource;

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["CREATED_NOTIFICATION_HOLD_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["CREATED_NOTIFICATION_HOLD_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["CREATED_NOTIFICATION_HOLD_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        // Two connections at least: the race below runs its writes side by side.
        extra: { options: `-c search_path=${schema},public`, max: 4 },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);

      for (const table of ["Incident", "Alert"]) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      const currentSchema: Array<{ current_schema: string }> =
        await database.query("SELECT current_schema()");
      expect(currentSchema[0]?.current_schema).toBe(schema);

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);
    });

    afterAll(async () => {
      jest.restoreAllMocks();

      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    describe.each(["Incident", "Alert"] as Array<Kind>)(
      "an %s",
      (kind: Kind) => {
        const notifiedColumn: string = NOTIFIED_COLUMN[kind];

        // A row as an insert writes it: notified or not, held since a time or not.
        async function seed(data: {
          isNotified: boolean;
          heldAt: Date | null;
          createdAt: Date;
          projectId?: ObjectID;
          isDeleted?: boolean;
        }): Promise<ObjectID> {
          const id: ObjectID = ObjectID.generate();
          const severityColumn: string =
            kind === "Alert" ? "alertSeverityId" : "incidentSeverityId";

          await database.query(
            `INSERT INTO "${schema}"."${kind}" ("_id", "projectId", "title", "current${kind}StateId", "${severityColumn}", "version", "${notifiedColumn}", "createdNotificationHeldAt", "createdAt", "deletedAt"${kind === "Incident" ? ', "slug"' : ""})
           VALUES ($1, $2, $3, $4, $5, 1, $6, $7, $8, $9${kind === "Incident" ? ", $10" : ""})`,
            [
              id.toString(),
              (data.projectId || PROJECT_ID).toString(),
              "Checkout is down",
              ObjectID.generate().toString(),
              ObjectID.generate().toString(),
              data.isNotified,
              data.heldAt,
              data.createdAt,
              data.isDeleted ? data.createdAt : null,
              ...(kind === "Incident" ? [`checkout-${id.toString()}`] : []),
            ],
          );

          return id;
        }

        async function storedRow(
          id: ObjectID,
        ): Promise<{ isNotified: boolean; heldAt: Date | null }> {
          const rows: Array<Record<string, unknown>> = await database.query(
            `SELECT "${notifiedColumn}" AS "isNotified", "createdNotificationHeldAt" AS "heldAt" FROM "${schema}"."${kind}" WHERE "_id" = $1`,
            [id.toString()],
          );

          expect(rows).toHaveLength(1);

          return {
            isNotified: rows[0]!["isNotified"] as boolean,
            heldAt: (rows[0]!["heldAt"] as Date | null) || null,
          };
        }

        async function readDue(now: Date): Promise<Array<BaseModel>> {
          return await SERVICE[kind].findCreatedNotificationsDue({
            now: now,
            select: { _id: true, projectId: true } as Select<BaseModel>,
          });
        }

        function idsOf(records: Array<BaseModel>): Array<string> {
          return records
            .map((record: BaseModel): string => {
              return record.id!.toString();
            })
            .sort();
        }

        test("keeps when its hold began in a nullable timestamp with time zone, with no default, and an index of the held ones only", async () => {
          const columns: Array<Record<string, unknown>> = await database.query(
            `SELECT data_type, is_nullable, column_default FROM information_schema.columns
           WHERE table_schema = $1 AND table_name = $2 AND column_name = 'createdNotificationHeldAt'`,
            [schema, kind],
          );

          expect(columns).toEqual([
            {
              data_type: "timestamp with time zone",
              is_nullable: "YES",
              column_default: null,
            },
          ]);

          const indexes: Array<{ indexdef: string }> = await database.query(
            `SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = $2 AND indexdef LIKE '%createdNotificationHeldAt%'`,
            [schema, kind],
          );

          expect(indexes).toHaveLength(1);
          expect(indexes[0]!.indexdef).toContain(
            `WHERE (("createdNotificationHeldAt" IS NOT NULL) AND ("deletedAt" IS NULL))`,
          );
        });

        test("a hold is let go by the release that names its time, once, to the very millisecond", async () => {
          const heldAt: Date = new Date("2026-11-15T10:00:00.123Z");
          const id: ObjectID = await seed({
            isNotified: true,
            heldAt: heldAt,
            createdAt: heldAt,
          });

          // A millisecond off is another hold: nothing is let go.
          await release(kind, id, new Date(heldAt.getTime() + 1));
          expect(await storedRow(id)).toEqual({
            isNotified: true,
            heldAt: heldAt,
          });

          // Without the hold's time, nothing either: it could match a record the job took.
          await release(kind, id, undefined);
          expect((await storedRow(id)).isNotified).toBe(true);

          await release(kind, id, new Date(heldAt.getTime()));
          expect(await storedRow(id)).toEqual({
            isNotified: false,
            heldAt: null,
          });

          // Once: letting go again changes nothing.
          await release(kind, id, heldAt);
          expect(await storedRow(id)).toEqual({
            isNotified: false,
            heldAt: null,
          });
        });

        test("the job reads the records let go a minute after their create and the holds that ran out - in every project, and nothing else", async () => {
          const now: Date = new Date();

          const letGo: ObjectID = await seed({
            isNotified: false,
            heldAt: null,
            createdAt: minutesBefore(now, 2),
          });
          const letGoElsewhere: ObjectID = await seed({
            isNotified: false,
            heldAt: null,
            createdAt: minutesBefore(now, 1),
            projectId: OTHER_PROJECT_ID,
          });
          const heldTooLong: ObjectID = await seed({
            isNotified: true,
            heldAt: minutesBefore(now, 5),
            createdAt: minutesBefore(now, 5),
          });

          // Not yet: let go seconds after its create; held, but not for long.
          const justLetGo: ObjectID = await seed({
            isNotified: false,
            heldAt: null,
            createdAt: minutesBefore(now, 0.5),
          });
          const stillHeld: ObjectID = await seed({
            isNotified: true,
            heldAt: minutesBefore(now, 4.9),
            createdAt: minutesBefore(now, 4.9),
          });

          // Never: told already, written as notified by its caller, deleted.
          const told: ObjectID = await seed({
            isNotified: true,
            heldAt: null,
            createdAt: minutesBefore(now, 60),
          });
          const deletedWhileHeld: ObjectID = await seed({
            isNotified: true,
            heldAt: minutesBefore(now, 30),
            createdAt: minutesBefore(now, 30),
            isDeleted: true,
          });

          const due: Array<BaseModel> = (await readDue(now)).filter(
            (record: BaseModel): boolean => {
              return [
                letGo,
                letGoElsewhere,
                heldTooLong,
                justLetGo,
                stillHeld,
                told,
                deletedWhileHeld,
              ]
                .map((id: ObjectID): string => {
                  return id.toString();
                })
                .includes(record.id!.toString());
            },
          );

          expect(idsOf(due)).toEqual(
            [letGo, letGoElsewhere, heldTooLong]
              .map((id: ObjectID): string => {
                return id.toString();
              })
              .sort(),
          );

          // Read with what the take needs, the hold's time exactly as written.
          const held: BaseModel = due.find((record: BaseModel): boolean => {
            return record.id!.toString() === heldTooLong.toString();
          })!;

          expect(held.getColumnValue(notifiedColumn)).toBe(true);
          expect(
            (
              held.getColumnValue("createdNotificationHeldAt") as Date
            ).getTime(),
          ).toBe(minutesBefore(now, 5).getTime());

          for (const record of due) {
            expect(await SERVICE[kind].takeCreatedNotification(record)).toBe(
              true,
            );
            // The same read again: taken already.
            expect(await SERVICE[kind].takeCreatedNotification(record)).toBe(
              false,
            );
            expect(await storedRow(record.id!)).toEqual({
              isNotified: true,
              heldAt: null,
            });
          }

          // A hold the job took is never let go after it.
          await release(kind, heldTooLong, minutesBefore(now, 5));
          expect(await storedRow(heldTooLong)).toEqual({
            isNotified: true,
            heldAt: null,
          });

          // And a later run reads none of them again.
          expect(
            idsOf(
              await readDue(new Date(now.getTime() + 60 * 60 * 1000)),
            ).filter((id: string): boolean => {
              return [letGo, letGoElsewhere, heldTooLong]
                .map((each: ObjectID): string => {
                  return each.toString();
                })
                .includes(id);
            }),
          ).toEqual([]);
        });

        test("the release and the job's take racing on a hold that ran out: one of them writes, and the owners are told once", async () => {
          const outcomes: Array<string> = [];

          for (let attempt: number = 0; attempt < 12; attempt++) {
            const now: Date = new Date();
            const heldAt: Date = minutesBefore(
              now,
              CreatedNotificationHold.HELD_FOR_AT_MOST_MINUTES + 1,
            );
            const id: ObjectID = await seed({
              isNotified: true,
              heldAt: heldAt,
              createdAt: heldAt,
            });

            const read: BaseModel = (await readDue(now)).find(
              (record: BaseModel): boolean => {
                return record.id!.toString() === id.toString();
              },
            )!;

            expect(read).toBeDefined();

            let tellings: number = 0;

            const [, isTaken] = await Promise.all([
              release(kind, id, heldAt),
              SERVICE[kind].takeCreatedNotification(read),
            ]);

            if (isTaken) {
              tellings++;
            }

            // Whatever the job did not take is let go: the next run takes it.
            for (const record of await readDue(now)) {
              if (
                record.id!.toString() === id.toString() &&
                (await SERVICE[kind].takeCreatedNotification(record))
              ) {
                tellings++;
              }
            }

            expect(tellings).toBe(1);
            expect(await storedRow(id)).toEqual({
              isNotified: true,
              heldAt: null,
            });

            outcomes.push(isTaken ? "taken as held" : "let go first");
          }

          expect(outcomes).toHaveLength(12);
        });

        test("two runs taking the same read at once: one takes it", async () => {
          const now: Date = new Date();
          const id: ObjectID = await seed({
            isNotified: false,
            heldAt: null,
            createdAt: minutesBefore(now, 2),
          });
          const read: BaseModel = (await readDue(now)).find(
            (record: BaseModel): boolean => {
              return record.id!.toString() === id.toString();
            },
          )!;

          const takes: Array<boolean> = await Promise.all([
            SERVICE[kind].takeCreatedNotification(read),
            SERVICE[kind].takeCreatedNotification(read),
          ]);

          expect(takes.sort()).toEqual([false, true]);
        });

        test("the job's read of the holds that ran out goes through their partial index", async () => {
          const queryRunner: ReturnType<DataSource["createQueryRunner"]> =
            database.createQueryRunner();

          try {
            await queryRunner.connect();
            await queryRunner.query("SET enable_seqscan = off");

            const plan: Array<Record<string, string>> = await queryRunner.query(
              `EXPLAIN SELECT "_id" FROM "${kind}" WHERE ("createdNotificationHeldAt" <= $1) AND "deletedAt" IS NULL`,
              [new Date()],
            );
            const text: string = plan
              .map((row: Record<string, string>): string => {
                return Object.values(row).join(" ");
              })
              .join("\n");

            const indexes: Array<{ indexname: string }> =
              await queryRunner.query(
                `SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = $2 AND indexdef LIKE '%createdNotificationHeldAt%'`,
                [schema, kind],
              );

            expect(indexes).toHaveLength(1);
            expect(text).toContain(indexes[0]!.indexname);
          } finally {
            await queryRunner.release();
          }
        });
      },
    );
  },
);
