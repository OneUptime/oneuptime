import Entities from "../../../../../Models/DatabaseModels/Index";
import Alert from "../../../../../Models/DatabaseModels/Alert";
import PostgresAppInstance from "../../../../../Server/Infrastructure/PostgresDatabase";
import {
  IsBillingEnabled,
  getAllEnvVars,
} from "../../../../../Server/EnvironmentConfig";
import AlertService from "../../../../../Server/Services/AlertService";
import { RunOptions } from "../../../../../Server/Types/Workflow/ComponentCode";
import FindManyBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/FindManyBaseModel";
import FindOneBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/FindOneBaseModel";
import OnCreateBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/OnCreateBaseModel";
import VMAPI, { EmptyValueOptions } from "../../../../../Server/Utils/VM/VMAPI";
import SubscriptionPlan from "../../../../../Types/Billing/SubscriptionPlan";
import Exception from "../../../../../Types/Exception/Exception";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { NodeDataProp } from "../../../../../Types/Workflow/Component";
import BaseModelComponents from "../../../../../Types/Workflow/Components/BaseModel";
import {
  isEmptyRecordField,
  readRecordField,
} from "../../../../../Types/Workflow/EmptyValues";
import { DataSource } from "typeorm";

/*
 * What a record step really returns for a record with nothing in a field, and
 * what a message's references come to on it, against a migrated Postgres,
 * through the production AlertService (issue 5761).
 *
 * Opt in with RUN_POSTGRES_WORKFLOW_EMPTY_FIELDS_TESTS=true against a database
 * the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_WORKFLOW_EMPTY_FIELDS_TESTS=true \
 *   WORKFLOW_EMPTY_FIELDS_TEST_DATABASE_HOST=127.0.0.1 \
 *   WORKFLOW_EMPTY_FIELDS_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Types/Workflow/Components/RecordFieldsWithNoValuePostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml, right after that
 * job has applied every registered migration to an empty database. It works on
 * structure-only clones (LIKE ... INCLUDING ALL) of the tables in a uniquely
 * named schema that is dropped afterwards; every row is synthetic.
 *
 * The rest of the suites hand the runner a record they wrote themselves. This
 * one is why they may write it as they do:
 *   - a related record the alert does not have comes back as null, and only when
 *     it was asked for: that is what tells "this alert has no monitor" from "the
 *     step does not pass the monitor on";
 *   - an alert a monitor raised comes back with the monitor's name, read as a
 *     Project Admin of the project, as a workflow reads it;
 *   - a related record comes with its ID whichever of its fields are named;
 *   - a NULL column is null, an SLO is read through its list, and a list with
 *     nothing in it is an empty list;
 *   - the alert in the report reads as it should once it is in a message.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_WORKFLOW_EMPTY_FIELDS_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = [
  "Project",
  "Alert",
  "Monitor",
  "AlertState",
  "AlertSeverity",
  "ServiceLevelObjective",
  "AlertServiceLevelObjective",
];

const ALERT_STEPS: Array<NodeDataProp["metadata"]> =
  BaseModelComponents.getComponents(new Alert());

const MODEL: string = "local.components.alert-on-create-1.returnValues.model";

// The message in the report, for the fields it names.
const MESSAGE: string = [
  `:warning: New Alert {{${MODEL}.alertNumberWithPrefix}}`,
  `*Severity:* {{${MODEL}.alertSeverity.name}}    *State:* {{${MODEL}.currentAlertState.name}}`,
  `*Monitor:* {{${MODEL}.monitor.name}}`,
  `*Summary:* {{${MODEL}.title}}`,
].join("\n");

const SELECT: JSONObject = {
  title: true,
  description: true,
  customFields: true,
  alertNumberWithPrefix: true,
  monitorId: true,
  currentAlertState: { name: true },
  alertSeverity: { name: true },
  monitor: { name: true },
  serviceLevelObjectives: { name: true },
};

describePostgres(
  "what a record step returns for a record with nothing there, against Postgres",
  () => {
    const schema: string = `workflow_empty_fields_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;

    const projectId: ObjectID = ObjectID.generate();
    const stateId: string = ObjectID.generate().toString();
    const severityId: string = ObjectID.generate().toString();
    const monitorId: string = ObjectID.generate().toString();
    const sloId: string = ObjectID.generate().toString();
    const raisedByMonitor: string = ObjectID.generate().toString();
    const raisedBySlo: string = ObjectID.generate().toString();

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

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["WORKFLOW_EMPTY_FIELDS_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["WORKFLOW_EMPTY_FIELDS_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["WORKFLOW_EMPTY_FIELDS_TEST_DATABASE_NAME"] ||
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

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);

      await database.query(
        `INSERT INTO "${schema}"."Project" ("_id", "name", "slug", "version", "paymentProviderPlanId")
       VALUES ($1, 'Empty fields test', $2, 1, $3)`,
        [projectId.toString(), `empty-${projectId.toString()}`, projectPlanId],
      );
      await database.query(
        `INSERT INTO "${schema}"."AlertState" ("_id", "projectId", "name", "color", "order", "version")
       VALUES ($1, $2, 'Identified', '#000000', 1, 1)`,
        [stateId, projectId.toString()],
      );
      await database.query(
        `INSERT INTO "${schema}"."AlertSeverity" ("_id", "projectId", "name", "slug", "color", "order", "version")
       VALUES ($1, $2, 'High', 'high', '#000000', 1, 1)`,
        [severityId, projectId.toString()],
      );
      await database.query(
        `INSERT INTO "${schema}"."Monitor" ("_id", "projectId", "name", "slug", "monitorType", "currentMonitorStatusId", "version")
       VALUES ($1, $2, 'Checkout API', 'checkout-api', 'Manual', $3, 1)`,
        [monitorId, projectId.toString(), ObjectID.generate().toString()],
      );
      await database.query(
        `INSERT INTO "${schema}"."ServiceLevelObjective" ("_id", "projectId", "name", "slug", "targetPercentage", "version")
       VALUES ($1, $2, 'Overall Calendar Month', 'overall', 99.9, 1)`,
        [sloId, projectId.toString()],
      );
      await database.query(
        `INSERT INTO "${schema}"."Alert" ("_id", "projectId", "title", "currentAlertStateId", "alertSeverityId", "monitorId", "alertNumberWithPrefix", "customFields", "version")
       VALUES ($1, $2, 'Latency high', $3, $4, $5, 'ALT-8', '{"Region": "eu"}'::jsonb, 1)`,
        [raisedByMonitor, projectId.toString(), stateId, severityId, monitorId],
      );
      // As Slo:EvaluateSlos raises one: no monitor, and the SLO among its resources.
      await database.query(
        `INSERT INTO "${schema}"."Alert" ("_id", "projectId", "title", "currentAlertStateId", "alertSeverityId", "alertNumberWithPrefix", "version")
       VALUES ($1, $2, 'SLO burn rate: Overall Calendar Month — Slow burn', $3, $4, 'ALT-9', 1)`,
        [raisedBySlo, projectId.toString(), stateId, severityId],
      );
      await database.query(
        `INSERT INTO "${schema}"."AlertServiceLevelObjective" ("alertId", "serviceLevelObjectiveId") VALUES ($1, $2)`,
        [raisedBySlo, sloId],
      );
    });

    afterAll(async () => {
      jest.restoreAllMocks();
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

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

    async function trigger(
      alertId: string,
      select: JSONObject = SELECT,
    ): Promise<JSONObject> {
      const result: { returnValues: JSONObject } =
        await new OnCreateBaseModel<Alert>(AlertService).run(
          { _id: alertId, data: { _id: alertId }, select: select },
          runOptions(),
        );

      return result.returnValues["model"] as JSONObject;
    }

    // As RunWorkflow.getComponentArguments fills in a text setting.
    function message(
      template: string,
      model: JSONObject,
      select: JSONObject = SELECT,
    ): string {
      const metadata: NodeDataProp["metadata"] = ALERT_STEPS.find(
        (step: NodeDataProp["metadata"]): boolean => {
          return step.id === "alert-on-create";
        },
      )!;
      const step: NodeDataProp = {
        id: "alert-on-create-1",
        metadata: metadata,
        metadataId: metadata.id,
        arguments: { select: select },
      } as unknown as NodeDataProp;
      const storageMap: JSONObject = {
        local: {
          variables: {},
          components: {
            "alert-on-create-1": { returnValues: { model: model } },
          },
        },
        global: { variables: {} },
      };
      const options: EmptyValueOptions = {
        isEmptyPath: (path: string): boolean => {
          return isEmptyRecordField(
            readRecordField({
              path: path,
              getStep: (): NodeDataProp => {
                return step;
              },
              storageMap: storageMap,
            }),
          );
        },
      };

      return VMAPI.replaceValueInPlace(storageMap, template, false, options);
    }

    test("the alert in the report has no monitor, and its message reads", async () => {
      const model: JSONObject = await trigger(raisedBySlo);

      expect(model["monitor"]).toBeNull();
      expect(message(MESSAGE, model)).toBe(
        ":warning: New Alert ALT-9\n*Severity:* High    *State:* Identified\n*Monitor:* \n*Summary:* SLO burn rate: Overall Calendar Month — Slow burn",
      );
    });

    test("an alert a monitor raised names it", async () => {
      const model: JSONObject = await trigger(raisedByMonitor);

      expect((model["monitor"] as JSONObject)["name"]).toBe("Checkout API");
      expect(message(MESSAGE, model)).toBe(
        ":warning: New Alert ALT-8\n*Severity:* High    *State:* Identified\n*Monitor:* Checkout API\n*Summary:* Latency high",
      );
    });

    test("a related record comes with its ID, whichever of its fields are named", async () => {
      const model: JSONObject = await trigger(raisedByMonitor, {
        monitor: { name: true },
      });

      expect(model["monitor"]).toEqual({
        _id: monitorId,
        name: "Checkout API",
      });
    });

    test("a related record not asked for is not there at all, not null", async () => {
      const model: JSONObject = await trigger(raisedByMonitor, { title: true });

      expect(Object.keys(model)).not.toContain("monitor");
    });

    test("a field the step does not pass on comes through empty, the monitor there or not", async () => {
      const select: JSONObject = { title: true };
      const template: string = `[{{${MODEL}.monitor.name}}]`;

      expect(
        message(template, await trigger(raisedByMonitor, select), select),
      ).toBe("[]");
      expect(
        message(template, await trigger(raisedBySlo, select), select),
      ).toBe("[]");
    });

    test("a mistyped field stays as written", async () => {
      const template: string = `[{{${MODEL}.monitorr.name}}]`;

      expect(message(template, await trigger(raisedBySlo))).toBe(template);
    });

    test("a NULL column is null, and reads as nothing", async () => {
      const model: JSONObject = await trigger(raisedBySlo);

      expect(model["description"]).toBeNull();
      expect(message(`[{{${MODEL}.description}}]`, model)).toBe("[]");
    });

    test("an ID column that is NULL is null too", async () => {
      expect((await trigger(raisedBySlo))["monitorId"]).toBeNull();
    });

    test("a custom field the alert does not hold reads as nothing, and one it does is read", async () => {
      const withFields: JSONObject = await trigger(raisedByMonitor);
      const withNone: JSONObject = await trigger(raisedBySlo);

      expect(message(`[{{${MODEL}.customFields.Region}}]`, withFields)).toBe(
        "[eu]",
      );
      expect(message(`[{{${MODEL}.customFields.Impact}}]`, withFields)).toBe(
        "[]",
      );
      expect(withNone["customFields"]).toBeNull();
      expect(message(`[{{${MODEL}.customFields.Impact}}]`, withNone)).toBe(
        "[]",
      );
    });

    test("the SLO of the alert it raised is read through its list, as the docs show", async () => {
      const model: JSONObject = await trigger(raisedBySlo);

      expect(model["serviceLevelObjectives"]).toEqual([
        { _id: sloId, name: "Overall Calendar Month" },
      ]);
      expect(
        message(
          `SLO: [{{#each ${MODEL}.serviceLevelObjectives}}{{name}}{{/each}}] First: [{{${MODEL}.serviceLevelObjectives[0].name}}]`,
          model,
        ),
      ).toBe("SLO: [Overall Calendar Month] First: [Overall Calendar Month]");
    });

    test("a list with nothing in it is empty, and its first item reads as nothing", async () => {
      const model: JSONObject = await trigger(raisedByMonitor);

      expect(model["serviceLevelObjectives"]).toEqual([]);
      expect(
        message(`[{{${MODEL}.serviceLevelObjectives[0].name}}]`, model),
      ).toBe("[]");
    });

    test("a Find One that finds no alert returns no model, which reads as nothing", async () => {
      const result: { returnValues: JSONObject } =
        await new FindOneBaseModel<Alert>(AlertService).run(
          {
            query: { _id: ObjectID.generate().toString() },
            select: { title: true },
          },
          runOptions(),
        );

      expect(result.returnValues["model"]).toBeNull();
      expect(
        message(
          `[{{${MODEL}.title}}]`,
          result.returnValues["model"] as JSONObject,
        ),
      ).toBe("[]");
    });

    test("a Find Many that finds none returns an empty list", async () => {
      const result: { returnValues: JSONObject } =
        await new FindManyBaseModel<Alert>(AlertService).run(
          {
            query: { _id: ObjectID.generate().toString() },
            select: { title: true },
          },
          runOptions(),
        );

      expect(result.returnValues["models"]).toEqual([]);
    });

    /*
     * "Whole" is the ID alone (SelectUtil.sanitizeSelect, because of security),
     * so what the step's field list and a run say about it has to be that.
     */
    test("a related record asked for without naming a field comes back as its ID", async () => {
      const select: JSONObject = { monitor: true };
      const model: JSONObject = await trigger(raisedByMonitor, select);

      expect(model["monitor"]).toEqual({ _id: monitorId });
      expect(message(`[{{${MODEL}.monitor._id}}]`, model, select)).toBe(
        `[${monitorId}]`,
      );
      expect(message(`[{{${MODEL}.monitor.name}}]`, model, select)).toBe("[]");
    });
  },
);
