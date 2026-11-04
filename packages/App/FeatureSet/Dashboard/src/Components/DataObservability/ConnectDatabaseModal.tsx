import DataObservabilityApi from "./DataObservabilityApi";
import WatchedTablesCost from "./WatchedTablesCost";
import Probe from "Common/Models/DatabaseModels/Probe";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { DataStoreKind } from "Common/Types/DataSecurity/DataStoreKind";
import {
  DataObservabilityCollector,
  DataObservabilityConnectStoreResponse,
  DataObservabilitySourceSuggestion,
} from "Common/Types/DataObservability/DataObservabilityApiTypes";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

export interface ComponentProps {
  onClose: () => void;
  onConnected: (dataStoreId: ObjectID) => void;
  // A database the project already knows of: the form starts from what is known of it.
  suggestion?: DataObservabilitySourceSuggestion | undefined;
}

/*
 * Four or five rows (the connection string, or the probe and its variable,
 * by who connects), so the form walks two steps: the database, then how
 * OneUptime reaches it (LongFormStepsGuard).
 */
const DATABASE_STEP_ID: string = "database";
const CONNECTION_STEP_ID: string = "connection";

const STEPS: Array<FormStep<JSONObject>> = [
  { id: DATABASE_STEP_ID, title: "Database" },
  { id: CONNECTION_STEP_ID, title: "Connection" },
];

const KIND_OPTIONS: Array<DropdownOption> = [
  { value: DataStoreKind.PostgreSql, label: "PostgreSQL" },
  { value: DataStoreKind.MySql, label: "MySQL or MariaDB" },
  { value: DataStoreKind.SqlServer, label: "SQL Server" },
  { value: DataStoreKind.AwsRedshiftCluster, label: "Amazon Redshift" },
  { value: DataStoreKind.Snowflake, label: "Snowflake" },
  { value: DataStoreKind.GcpBigQueryDataset, label: "Google BigQuery" },
  { value: DataStoreKind.ClickHouse, label: "ClickHouse" },
  { value: DataStoreKind.Databricks, label: "Databricks" },
  { value: DataStoreKind.AwsAthena, label: "Amazon Athena" },
  { value: DataStoreKind.Oracle, label: "Oracle" },
  { value: DataStoreKind.MongoDb, label: "MongoDB" },
];

/*
 * Connect a database to Data Observability. Two ways in, the second for a
 * database only the customer's network can reach:
 *
 *  - OneUptime connects, with a connection string saved (encrypted) on the
 *    store;
 *  - a probe in the customer's network connects, with the connection string
 *    in an environment variable of that probe - it never leaves the
 *    network.
 *
 * Either way only the catalog is read, and the login should be read-only. The form asks for the little that is needed and nothing more.
 */
const ConnectDatabaseModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [error, setError] = useState<string>("");
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [probeOptions, setProbeOptions] = useState<Array<DropdownOption>>([]);
  const isSavingRef: React.MutableRefObject<boolean> = useRef<boolean>(false);

  useEffect(() => {
    let isCurrent: boolean = true;
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    ModelAPI.getList<Probe>({
      modelType: Probe,
      query: projectId ? { projectId: projectId } : {},
      select: { _id: true, name: true },
      limit: 100,
      skip: 0,
      sort: { name: SortOrder.Ascending },
    })
      .then((result: ListResult<Probe>): void => {
        if (!isCurrent) {
          return;
        }

        setProbeOptions(
          result.data
            .filter((probe: Probe): boolean => {
              return Boolean(probe.id);
            })
            .map((probe: Probe): DropdownOption => {
              return {
                value: probe.id!.toString(),
                label: probe.name || probe.id!.toString(),
              };
            }),
        );
      })
      .catch((): void => {
        // Without probes, OneUptime connecting is the one way in.
      })
      .finally((): void => {
        if (isCurrent) {
          setIsLoading(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  return (
    <BasicFormModal<JSONObject>
      title="Connect a Database"
      description="Reads the database's catalog every few minutes: tables, columns, row counts, sizes and last changes. No value leaves it. Use a read-only login."
      name="Data Observability > Connect a Database"
      beforeFormElement={<WatchedTablesCost />}
      submitButtonText="Connect"
      isLoading={isLoading}
      isSubmitting={isSaving}
      error={error || undefined}
      onClose={props.onClose}
      formProps={{
        name: "Connect a Database",
        initialValues: {
          name: props.suggestion?.name || "",
          kind: props.suggestion?.kind || DataStoreKind.PostgreSql,
          collector: DataObservabilityCollector.OneUptime,
        },
        steps: STEPS,
        fields: [
          {
            field: { name: true },
            title: "Name",
            description: "What your team calls this database.",
            placeholder: "Orders database",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            stepId: DATABASE_STEP_ID,
          },
          {
            field: { kind: true },
            title: "Engine",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: KIND_OPTIONS,
            required: true,
            stepId: DATABASE_STEP_ID,
          },
          {
            field: { collector: true },
            title: "Who Connects",
            fieldType: FormFieldSchemaType.RadioButton,
            stepId: CONNECTION_STEP_ID,
            radioButtonOptions: [
              {
                value: DataObservabilityCollector.OneUptime,
                title: "OneUptime connects",
                description:
                  "The connection string is saved on the store, encrypted, and is never shown again.",
              },
              {
                value: DataObservabilityCollector.Probe,
                title: "A probe in my network connects",
                description:
                  "The connection string stays in an environment variable of your probe and never leaves your network.",
              },
            ],
            required: true,
          },
          {
            field: { connectionString: true },
            title: "Connection String",
            stepId: CONNECTION_STEP_ID,
            // Documentation shows every engine's format in full, with examples.
            description: props.suggestion?.connectionExample
              ? translator.translateTemplate("For this database: {{example}}", {
                  example: props.suggestion.connectionExample,
                })
              : "A URL such as postgres://reader:pw@db.internal:5432/orders, or JSON for Snowflake, BigQuery, Databricks and Athena. Documentation shows each engine's.",
            fieldType: FormFieldSchemaType.Password,
            required: (values: FormValues<JSONObject>): boolean => {
              return (
                values["collector"] === DataObservabilityCollector.OneUptime
              );
            },
            showIf: (values: FormValues<JSONObject>): boolean => {
              return (
                values["collector"] === DataObservabilityCollector.OneUptime
              );
            },
          },
          {
            field: { probeId: true },
            title: "Probe",
            stepId: CONNECTION_STEP_ID,
            description:
              "One of this project's own probes, running where it can reach the database.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: probeOptions,
            required: (values: FormValues<JSONObject>): boolean => {
              return values["collector"] === DataObservabilityCollector.Probe;
            },
            showIf: (values: FormValues<JSONObject>): boolean => {
              return values["collector"] === DataObservabilityCollector.Probe;
            },
          },
          {
            field: { probeConnectionVariable: true },
            title: "Environment Variable",
            stepId: CONNECTION_STEP_ID,
            description:
              "The probe's environment variable that holds the connection string: upper-case letters, digits and underscores.",
            placeholder: "ORDERS_DB_URL",
            fieldType: FormFieldSchemaType.Text,
            required: (values: FormValues<JSONObject>): boolean => {
              return values["collector"] === DataObservabilityCollector.Probe;
            },
            showIf: (values: FormValues<JSONObject>): boolean => {
              return values["collector"] === DataObservabilityCollector.Probe;
            },
          },
        ],
      }}
      onSubmit={async (values: FormValues<JSONObject>) => {
        if (isSavingRef.current) {
          return;
        }

        isSavingRef.current = true;
        setError("");
        setIsSaving(true);

        try {
          const isProbe: boolean =
            values["collector"] === DataObservabilityCollector.Probe;
          const result: DataObservabilityConnectStoreResponse =
            await DataObservabilityApi.connectStore({
              name: String(values["name"] || ""),
              kind: String(values["kind"] || ""),
              ...(props.suggestion?.dataStoreId
                ? { dataStoreId: props.suggestion.dataStoreId }
                : {}),
              ...(isProbe
                ? {
                    probeId: String(values["probeId"] || ""),
                    probeConnectionVariable: String(
                      values["probeConnectionVariable"] || "",
                    ).trim(),
                  }
                : {
                    connectionString: String(values["connectionString"] || ""),
                  }),
            });

          props.onConnected(new ObjectID(result.dataStoreId));
        } catch (err) {
          setError(API.getFriendlyMessage(err));
        }

        isSavingRef.current = false;
        setIsSaving(false);
      }}
    />
  );
};

export default ConnectDatabaseModal;
