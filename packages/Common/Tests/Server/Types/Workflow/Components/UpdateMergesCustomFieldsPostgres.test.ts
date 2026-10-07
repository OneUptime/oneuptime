import Entities from "../../../../../Models/DatabaseModels/Index";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import PostgresAppInstance from "../../../../../Server/Infrastructure/PostgresDatabase";
import {
  IsBillingEnabled,
  getAllEnvVars,
} from "../../../../../Server/EnvironmentConfig";
import AuditLogService from "../../../../../Server/Services/AuditLogService";
import IncidentFeedService from "../../../../../Server/Services/IncidentFeedService";
import IncidentService from "../../../../../Server/Services/IncidentService";
import FindBy from "../../../../../Server/Types/Database/FindBy";
import {
  RunOptions,
  RunReturnType,
} from "../../../../../Server/Types/Workflow/ComponentCode";
import UpdateManyBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/UpdateManyBaseModel";
import UpdateOneBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/UpdateOneBaseModel";
import URL from "../../../../../Types/API/URL";
import Exception from "../../../../../Types/Exception/Exception";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import SubscriptionPlan from "../../../../../Types/Billing/SubscriptionPlan";
import { DataSource, Repository } from "typeorm";

/*
 * The workflow Update steps merging custom fields, against a migrated
 * Postgres, through the production IncidentService.
 *
 * Opt in with RUN_POSTGRES_WORKFLOW_CUSTOM_FIELD_MERGE_TESTS=true against a
 * database the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_WORKFLOW_CUSTOM_FIELD_MERGE_TESTS=true \
 *   WORKFLOW_CUSTOM_FIELD_MERGE_TEST_DATABASE_HOST=127.0.0.1 \
 *   WORKFLOW_CUSTOM_FIELD_MERGE_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Types/Workflow/Components/UpdateMergesCustomFieldsPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml, right after that
 * job has applied every registered migration to an empty database. It works on
 * structure-only clones (LIKE ... INCLUDING ALL) of Project, Incident and
 * IncidentCustomField in a uniquely named schema that is dropped afterwards;
 * every row is synthetic. Only the feed, dashboard links, audit log, realtime
 * and workflow triggers are stubbed.
 *
 * What it pins (https://github.com/OneUptime/oneuptime/issues/4469):
 *   - Update One Incident writing one custom field keeps every other one, and
 *     the incident's On Update workflows are handed the merged values;
 *   - Update Many merges into each incident's own custom fields;
 *   - customFields set to null still clears them all;
 *   - an update whose query names the version writes nothing once the row has
 *     moved past it - in the UPDATE itself, not only in the find before it;
 *   - two workflows setting different custom fields of one incident at the
 *     same moment both land, and so does a step whose write another writer
 *     beats between the find and the UPDATE.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_WORKFLOW_CUSTOM_FIELD_MERGE_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = [
  "Project",
  "Incident",
  "Monitor",
  "IncidentMonitor",
  "IncidentCustomField",
];

const STORED_CUSTOM_FIELDS: JSONObject = {
  Application: "Example Application",
  Duration: "2 hours",
  Impact: "Service unavailable",
  Locations: ["Location A"],
};

interface IncidentRow {
  customFields: JSONObject | null;
  version: number;
}

describePostgres(
  "workflow Update steps merge custom fields, against Postgres",
  () => {
    const schema: string = `workflow_custom_field_merge_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;

    const projectId: ObjectID = ObjectID.generate();

    /*
     * The steps act as a Project Admin of the project, on its plan
     * (WorkflowPrincipal). On a server with billing that plan is read from
     * the project row, so the project is on the highest plan configured.
     */
    const projectPlanId: string | null = IsBillingEnabled
      ? SubscriptionPlan.getSubscriptionPlans(getAllEnvVars())
          .sort((left: SubscriptionPlan, right: SubscriptionPlan): number => {
            return right.getPlanOrder() - left.getPlanOrder();
          })[0]!
          .getMonthlyPlanId()
      : null;

    let database: DataSource;
    let onTriggerWorkflow: jest.SpiedFunction<
      typeof IncidentService.onTriggerWorkflow
    >;

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["WORKFLOW_CUSTOM_FIELD_MERGE_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["WORKFLOW_CUSTOM_FIELD_MERGE_TEST_DATABASE_PORT"] ||
            "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["WORKFLOW_CUSTOM_FIELD_MERGE_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        extra: { options: `-c search_path=${schema},public` },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);

      for (const table of TABLES) {
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

      onTriggerWorkflow = jest
        .spyOn(IncidentService, "onTriggerWorkflow")
        .mockResolvedValue();
      jest.spyOn(IncidentService, "onTriggerRealtime").mockResolvedValue();
      jest.spyOn(AuditLogService, "recordUpdate").mockResolvedValue();
      jest
        .spyOn(IncidentService, "getIncidentLinkInDashboard")
        .mockResolvedValue(
          URL.fromString("https://oneuptime.example/incident"),
        );
      jest
        .spyOn(IncidentFeedService, "createIncidentFeedItem")
        .mockResolvedValue(undefined);
    });

    beforeEach(async () => {
      onTriggerWorkflow.mockClear();

      await database.query(
        TABLES.map((table: string): string => {
          return `DELETE FROM "${schema}"."${table}"`;
        })
          .reverse()
          .join("; "),
      );
      await database.query(
        `INSERT INTO "${schema}"."Project" ("_id", "name", "slug", "version", "paymentProviderPlanId")
       VALUES ($1, 'Custom field merge test', $2, 1, $3)`,
        [projectId.toString(), `merge-${projectId.toString()}`, projectPlanId],
      );
    });

    afterAll(async () => {
      jest.restoreAllMocks();
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    async function seedIncident(
      customFields: JSONObject | null,
    ): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      await database.query(
        `INSERT INTO "${schema}"."Incident"
       ("_id", "projectId", "title", "slug", "currentIncidentStateId", "incidentSeverityId", "customFields", "version")
       VALUES ($1, $2, 'Checkout down', $3, $4, $5, $6::jsonb, 1)`,
        [
          id.toString(),
          projectId.toString(),
          `incident-${id.toString()}`,
          ObjectID.generate().toString(),
          ObjectID.generate().toString(),
          customFields === null ? null : JSON.stringify(customFields),
        ],
      );
      return id;
    }

    async function readIncident(id: ObjectID): Promise<IncidentRow> {
      const rows: Array<IncidentRow> = await database.query(
        `SELECT "customFields", "version" FROM "${schema}"."Incident" WHERE "_id" = $1`,
        [id.toString()],
      );
      return rows[0]!;
    }

    // Another writer, straight to the table: one custom field and a new version.
    async function writeElsewhere(
      id: ObjectID,
      field: string,
      value: string,
    ): Promise<void> {
      await database.query(
        `UPDATE "${schema}"."Incident"
          SET "customFields" = COALESCE("customFields", '{}'::jsonb) || jsonb_build_object($2::text, $3::text),
              "version" = "version" + 1
        WHERE "_id" = $1`,
        [id.toString(), field, value],
      );
    }

    function runOptions(): RunOptions {
      return {
        log: jest.fn() as RunOptions["log"],
        workflowLogId: ObjectID.generate(),
        workflowId: ObjectID.generate(),
        projectId: projectId,
        onError: ((exception: Exception): Exception => {
          return exception;
        }) as RunOptions["onError"],
        executeWorkflow: async (): Promise<void> => {},
      };
    }

    async function updateOneIncident(
      id: ObjectID,
      data: JSONObject,
    ): Promise<RunReturnType> {
      return await new UpdateOneBaseModel<Incident>(IncidentService).run(
        { query: { _id: id.toString() }, data: data },
        runOptions(),
      );
    }

    /*
     * Runs `whenWriting` once, right before the first guarded UPDATE of the
     * incident table reaches Postgres - after the find that located the row,
     * so it lands exactly in the gap between the two statements.
     */
    function interveneBeforeFirstUpdate(
      whenWriting: () => Promise<void>,
    ): jest.SpiedFunction<typeof IncidentService.getRepository> {
      const getRepository: () => Repository<Incident> =
        IncidentService.getRepository.bind(IncidentService);
      let hasIntervened: boolean = false;

      return jest
        .spyOn(IncidentService, "getRepository")
        .mockImplementation((): Repository<Incident> => {
          const repository: Repository<Incident> = getRepository();

          return new Proxy(repository, {
            get: (target: Repository<Incident>, property: string | symbol) => {
              if (property !== "update") {
                return Reflect.get(target, property, target);
              }

              return async (
                criteria: unknown,
                partial: unknown,
              ): Promise<unknown> => {
                if (!hasIntervened) {
                  hasIntervened = true;
                  await whenWriting();
                }

                return await target.update(criteria as never, partial as never);
              };
            },
          });
        });
    }

    test("Update One sets the custom field it names and keeps every other one", async () => {
      const id: ObjectID = await seedIncident(STORED_CUSTOM_FIELDS);

      const result: RunReturnType = await updateOneIncident(id, {
        customFields: { "Notification Count": "1" },
      });

      expect(result.executePort?.id).toBe("success");
      expect(result.returnValues["items-updated"]).toBe(1);

      const row: IncidentRow = await readIncident(id);

      expect(row.customFields).toEqual({
        ...STORED_CUSTOM_FIELDS,
        "Notification Count": "1",
      });
      expect(row.version).toBe(2);
    });

    test("the incident's On Update workflows are handed the merged values", async () => {
      const id: ObjectID = await seedIncident(STORED_CUSTOM_FIELDS);

      await updateOneIncident(id, {
        customFields: { "Notification Count": "1" },
      });

      expect(onTriggerWorkflow).toHaveBeenCalledTimes(1);

      const payload: JSONObject = onTriggerWorkflow.mock
        .calls[0]![3] as JSONObject;

      expect((payload["updatedFields"] as JSONObject)["customFields"]).toEqual({
        ...STORED_CUSTOM_FIELDS,
        "Notification Count": "1",
      });
    });

    test("a field set to null is cleared and the others kept", async () => {
      const id: ObjectID = await seedIncident(STORED_CUSTOM_FIELDS);

      await updateOneIncident(id, { customFields: { Impact: null } });

      expect((await readIncident(id)).customFields).toEqual({
        ...STORED_CUSTOM_FIELDS,
        Impact: null,
      });
    });

    test("customFields set to null clears them all", async () => {
      const id: ObjectID = await seedIncident(STORED_CUSTOM_FIELDS);

      await updateOneIncident(id, { customFields: null });

      expect((await readIncident(id)).customFields).toBeNull();
    });

    test("Update Many merges into each incident's own custom fields", async () => {
      const first: ObjectID = await seedIncident(STORED_CUSTOM_FIELDS);
      const second: ObjectID = await seedIncident({ Impact: "Low" });
      const empty: ObjectID = await seedIncident(null);

      const result: RunReturnType = await new UpdateManyBaseModel<Incident>(
        IncidentService,
      ).run(
        { query: {}, data: { customFields: { Reviewed: "yes" } } },
        runOptions(),
      );

      expect(result.returnValues["items-updated"]).toBe(3);
      expect((await readIncident(first)).customFields).toEqual({
        ...STORED_CUSTOM_FIELDS,
        Reviewed: "yes",
      });
      expect((await readIncident(second)).customFields).toEqual({
        Impact: "Low",
        Reviewed: "yes",
      });
      expect((await readIncident(empty)).customFields).toEqual({
        Reviewed: "yes",
      });
    });

    test("an update guarded by a version the incident has moved past writes nothing", async () => {
      const id: ObjectID = await seedIncident(STORED_CUSTOM_FIELDS);
      await writeElsewhere(id, "Owner", "ops");

      const updated: number = await IncidentService.updateOneBy({
        query: { _id: id.toString(), version: 1 } as never,
        data: { customFields: { "Notification Count": "1" } } as never,
        props: { isRoot: true, tenantId: projectId },
      });

      expect(updated).toBe(0);
      expect((await readIncident(id)).customFields).toEqual({
        ...STORED_CUSTOM_FIELDS,
        Owner: "ops",
      });
    });

    test("the version is asked again in the UPDATE, so a write between it and the find is kept", async () => {
      const id: ObjectID = await seedIncident(STORED_CUSTOM_FIELDS);

      const getRepository: jest.SpiedFunction<
        typeof IncidentService.getRepository
      > = interveneBeforeFirstUpdate(async () => {
        await writeElsewhere(id, "Owner", "ops");
      });

      try {
        const updated: number = await IncidentService.updateOneBy({
          query: { _id: id.toString(), version: 1 } as never,
          data: {
            customFields: { ...STORED_CUSTOM_FIELDS, Overwritten: "yes" },
          } as never,
          props: { isRoot: true, tenantId: projectId },
        });

        expect(updated).toBe(0);
      } finally {
        getRepository.mockRestore();
      }

      expect((await readIncident(id)).customFields).toEqual({
        ...STORED_CUSTOM_FIELDS,
        Owner: "ops",
      });
    });

    test("a step whose write is beaten between its find and its UPDATE merges again and keeps both", async () => {
      const id: ObjectID = await seedIncident(STORED_CUSTOM_FIELDS);

      const getRepository: jest.SpiedFunction<
        typeof IncidentService.getRepository
      > = interveneBeforeFirstUpdate(async () => {
        await writeElsewhere(id, "Owner", "ops");
      });

      try {
        const result: RunReturnType = await updateOneIncident(id, {
          customFields: { "Notification Count": "1" },
        });

        expect(result.returnValues["items-updated"]).toBe(1);
      } finally {
        getRepository.mockRestore();
      }

      expect((await readIncident(id)).customFields).toEqual({
        ...STORED_CUSTOM_FIELDS,
        Owner: "ops",
        "Notification Count": "1",
      });
    });

    test("two workflows setting different custom fields at the same moment both land", async () => {
      const id: ObjectID = await seedIncident(STORED_CUSTOM_FIELDS);

      /*
       * Hold each step's first read until both have read, so both merge
       * from the same values and their writes race - the case that lost a
       * field before the writes were guarded.
       */
      const findBy: (findBy: FindBy<Incident>) => Promise<Array<Incident>> =
        IncidentService.findBy.bind(IncidentService);
      let mergeReads: number = 0;
      let releaseReads: () => void = (): void => {};
      const bothHaveRead: Promise<void> = new Promise<void>(
        (resolve: () => void) => {
          releaseReads = resolve;
        },
      );

      const findBySpy: jest.SpiedFunction<typeof IncidentService.findBy> = jest
        .spyOn(IncidentService, "findBy")
        .mockImplementation(
          async (args: FindBy<Incident>): Promise<Array<Incident>> => {
            const records: Array<Incident> = await findBy(args);

            const isMergeRead: boolean =
              args.props.ignoreHooks === true &&
              (args.select as JSONObject | undefined)?.["version"] === true;

            if (isMergeRead && mergeReads < 2) {
              mergeReads++;

              if (mergeReads === 2) {
                releaseReads();
              }

              await bothHaveRead;
            }

            return records;
          },
        );

      let results: Array<RunReturnType> = [];

      try {
        results = await Promise.all([
          updateOneIncident(id, {
            customFields: { "Notification Count": "1" },
          }),
          updateOneIncident(id, { customFields: { Owner: "ops" } }),
        ]);
      } finally {
        findBySpy.mockRestore();
      }

      expect(mergeReads).toBe(2);
      expect(
        results.map((result: RunReturnType) => {
          return result.returnValues["items-updated"];
        }),
      ).toEqual([1, 1]);

      const row: IncidentRow = await readIncident(id);

      expect(row.customFields).toEqual({
        ...STORED_CUSTOM_FIELDS,
        "Notification Count": "1",
        Owner: "ops",
      });
      expect(row.version).toBe(3);
    });
  },
);
