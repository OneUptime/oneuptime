import DataObservabilityApi from "./DataObservabilityApi";
import {
  getDatabaseConnectionFields,
  readDatabaseConnection,
} from "./DatabaseConnectionFields";
import useDatabaseConnectionChoices, {
  DatabaseConnectionChoices,
} from "./UseDatabaseConnectionChoices";
import WatchedTablesCost from "./WatchedTablesCost";
import { DataStoreKind } from "Common/Types/DataSecurity/DataStoreKind";
import {
  DataObservabilityAgentState,
  DataObservabilityCollector,
  DataObservabilityConnectStoreResponse,
  DataObservabilityDatabaseAgent,
  DataObservabilitySourceSuggestion,
} from "Common/Types/DataObservability/DataObservabilityApiTypes";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import API from "Common/UI/Utils/API/API";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
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
 * Four or five rows (the connection string, the probe and its variable, or
 * the Database Agent and its database, by who connects), so the form walks
 * two steps: the database, then how OneUptime reaches it
 * (LongFormStepsGuard).
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
  { value: DataStoreKind.Dataverse, label: "Microsoft Dataverse" },
];

/*
 * The way in a form starts from: the Database Agent that already monitors a
 * database Database Monitoring found, when it can read one (#11148) -
 * nothing to type but the database's name - else OneUptime connecting.
 */
function getStartingCollector(
  suggestion: DataObservabilitySourceSuggestion | undefined,
  agents: Array<DataObservabilityDatabaseAgent>,
): DataObservabilityCollector {
  const serverId: string | null | undefined = suggestion?.databaseServerId;
  const agent: DataObservabilityDatabaseAgent | undefined = serverId
    ? agents.find((candidate: DataObservabilityDatabaseAgent): boolean => {
        return candidate.databaseServerId === serverId;
      })
    : undefined;

  return agent && agent.state !== DataObservabilityAgentState.EngineNotSupported
    ? DataObservabilityCollector.DatabaseAgent
    : DataObservabilityCollector.OneUptime;
}

/*
 * Connect a database to Data Observability. Three ways in, the last two for
 * a database only the customer's network can reach:
 *
 *  - OneUptime connects, with a connection string saved (encrypted) on the
 *    store;
 *  - a probe in the customer's network connects, with the connection
 *    string in an environment variable of that probe - it never leaves the
 *    network;
 *  - the Database Agent the customer already runs beside the database
 *    connects, with logins of its own environment (#11148).
 *
 * Either way only the catalog is read, and the login should be read-only. The form asks for the little that is needed and nothing more.
 */
const ConnectDatabaseModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [error, setError] = useState<string>("");
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const isSavingRef: React.MutableRefObject<boolean> = useRef<boolean>(false);
  const choices: DatabaseConnectionChoices = useDatabaseConnectionChoices();
  const startingCollector: DataObservabilityCollector = getStartingCollector(
    props.suggestion,
    choices.agents,
  );

  return (
    <BasicFormModal<JSONObject>
      title="Connect a Database"
      description="Reads the database's catalog every few minutes: tables, columns, row counts, sizes and last changes. No value leaves it. Use a read-only login."
      name="Data Observability > Connect a Database"
      beforeFormElement={<WatchedTablesCost />}
      submitButtonText="Connect"
      isLoading={choices.isLoading}
      isSubmitting={isSaving}
      error={error || undefined}
      onClose={props.onClose}
      formProps={{
        name: "Connect a Database",
        initialValues: {
          name: props.suggestion?.name || "",
          kind: props.suggestion?.kind || DataStoreKind.PostgreSql,
          collector: startingCollector,
          ...(startingCollector === DataObservabilityCollector.DatabaseAgent
            ? { databaseServerId: props.suggestion?.databaseServerId || "" }
            : {}),
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
          ...getDatabaseConnectionFields({
            stepId: CONNECTION_STEP_ID,
            probeOptions: choices.probeOptions,
            agentOptions: choices.agentOptions,
            // A database Data Security keeps a connection string for may keep it.
            hasSavedConnection: props.suggestion?.hasSavedConnection === true,
            connectionExample: props.suggestion?.connectionExample,
            translator,
          }),
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
          const { collector, ...connection } = readDatabaseConnection(values);
          const result: DataObservabilityConnectStoreResponse =
            await DataObservabilityApi.connectStore({
              name: String(values["name"] || ""),
              kind: String(values["kind"] || ""),
              ...(props.suggestion?.dataStoreId
                ? { dataStoreId: props.suggestion.dataStoreId }
                : {}),
              ...(collector === DataObservabilityCollector.OneUptime &&
              !connection.connectionString
                ? {}
                : connection),
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
