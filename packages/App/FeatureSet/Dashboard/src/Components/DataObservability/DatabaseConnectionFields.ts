import {
  DataObservabilityAgentState,
  DataObservabilityCollector,
  DataObservabilityDatabaseAgent,
} from "Common/Types/DataObservability/DataObservabilityApiTypes";
import { JSONObject } from "Common/Types/JSON";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import Fields from "Common/UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  DATABASE_AGENT_STATE_LABELS,
  getDatabaseAgentEngineName,
} from "./DatabaseAgentWords";

/*
 * HOW DATA OBSERVABILITY REACHES A DATABASE, AS A FORM ASKS IT: Connect a
 * Database's second step and a database's Change Connection. Three ways in:
 *
 *   - OneUptime connects, with a connection string saved, encrypted;
 *   - a probe in the customer's network connects, with the connection
 *     string in an environment variable of that probe;
 *   - the Database Agent the customer already runs beside the database
 *     connects (#11148), with logins of its own environment: nothing to
 *     type but which server's agent and which database on it.
 *
 * Each way shows only its own fields: two or three in view at once.
 */

export const COLLECTOR_FIELD: string = "collector";

// The agents a database can be read through, each with its engine and whether it can read now.
export function getDatabaseAgentOptions(
  agents: Array<DataObservabilityDatabaseAgent>,
  translator: Translator,
): Array<DropdownOption> {
  return agents.map((agent: DataObservabilityDatabaseAgent): DropdownOption => {
    const engine: string = getDatabaseAgentEngineName(agent.engine);
    const state: string =
      translator.translateText(DATABASE_AGENT_STATE_LABELS[agent.state]) || "";

    return {
      value: agent.databaseServerId,
      label: agent.name || agent.databaseServerId,
      isUserContent: true,
      // Facts set apart, each already in the reader's words.
      description: engine ? `${engine} · ${state}` : state,
      isDescriptionUserContent: true,
      // A server of an engine no agent reads for Data Observability cannot be chosen.
      isDisabled:
        agent.state === DataObservabilityAgentState.EngineNotSupported,
    };
  });
}

function isCollector(
  values: FormValues<JSONObject>,
  collector: DataObservabilityCollector,
): boolean {
  return values[COLLECTOR_FIELD] === collector;
}

export function getDatabaseConnectionFields(data: {
  stepId?: string | undefined;
  probeOptions: Array<DropdownOption>;
  agentOptions: Array<DropdownOption>;
  // A connection string is saved already: leaving the field empty keeps it.
  hasSavedConnection: boolean;
  // A connection string to start from, for a database the project knows of.
  connectionExample?: string | null | undefined;
  translator: Translator;
}): Fields<JSONObject> {
  const step: { stepId?: string } = data.stepId ? { stepId: data.stepId } : {};

  return [
    {
      field: { collector: true },
      title: "Who Connects",
      fieldType: FormFieldSchemaType.RadioButton,
      ...step,
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
        {
          value: DataObservabilityCollector.DatabaseAgent,
          title: "My Database Agent connects",
          description:
            "The Database Agent beside the database reads it with its own logins. No connection string or password is saved in OneUptime.",
        },
      ],
      required: true,
    },
    {
      field: { connectionString: true },
      title: "Connection String",
      ...step,
      // Documentation shows every engine's format in full, with examples.
      description: data.hasSavedConnection
        ? "Leave it empty to keep the saved connection string."
        : data.connectionExample
          ? data.translator.translateTemplate(
              "For this database: {{example}}",
              {
                example: data.connectionExample,
              },
            )
          : "A URL such as postgres://reader:pw@db.internal:5432/orders, or JSON for Snowflake, BigQuery, Databricks, Athena or Dataverse. Docs show each format.",
      fieldType: FormFieldSchemaType.Password,
      required: (values: FormValues<JSONObject>): boolean => {
        return (
          !data.hasSavedConnection &&
          isCollector(values, DataObservabilityCollector.OneUptime)
        );
      },
      showIf: (values: FormValues<JSONObject>): boolean => {
        return isCollector(values, DataObservabilityCollector.OneUptime);
      },
    },
    {
      field: { probeId: true },
      title: "Probe",
      ...step,
      description:
        "One of this project's own probes, running where it can reach the database.",
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: data.probeOptions,
      required: (values: FormValues<JSONObject>): boolean => {
        return isCollector(values, DataObservabilityCollector.Probe);
      },
      showIf: (values: FormValues<JSONObject>): boolean => {
        return isCollector(values, DataObservabilityCollector.Probe);
      },
    },
    {
      field: { probeConnectionVariable: true },
      title: "Environment Variable",
      ...step,
      description:
        "The probe's environment variable that holds the connection string: upper-case letters, digits and underscores.",
      placeholder: "ORDERS_DB_URL",
      fieldType: FormFieldSchemaType.Text,
      required: (values: FormValues<JSONObject>): boolean => {
        return isCollector(values, DataObservabilityCollector.Probe);
      },
      showIf: (values: FormValues<JSONObject>): boolean => {
        return isCollector(values, DataObservabilityCollector.Probe);
      },
    },
    {
      field: { databaseServerId: true },
      title: "Database Agent",
      ...step,
      description:
        data.agentOptions.length > 0
          ? "The database server whose agent reads it. Its agent reads PostgreSQL and MySQL databases."
          : "No Database Agent is connected yet. Install one from a database's Documentation tab in Databases.",
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: data.agentOptions,
      required: (values: FormValues<JSONObject>): boolean => {
        return isCollector(values, DataObservabilityCollector.DatabaseAgent);
      },
      showIf: (values: FormValues<JSONObject>): boolean => {
        return isCollector(values, DataObservabilityCollector.DatabaseAgent);
      },
    },
    {
      field: { databaseName: true },
      title: "Database Name",
      ...step,
      description:
        "The database on that server to read, as the server names it.",
      placeholder: "orders",
      fieldType: FormFieldSchemaType.Text,
      required: (values: FormValues<JSONObject>): boolean => {
        return isCollector(values, DataObservabilityCollector.DatabaseAgent);
      },
      showIf: (values: FormValues<JSONObject>): boolean => {
        return isCollector(values, DataObservabilityCollector.DatabaseAgent);
      },
    },
  ];
}

// The way in a form's values ask for, as the request names it: only the chosen way's fields.
export function readDatabaseConnection(values: FormValues<JSONObject>): {
  collector: DataObservabilityCollector;
  connectionString?: string;
  probeId?: string;
  probeConnectionVariable?: string;
  databaseServerId?: string;
  databaseName?: string;
} {
  const collector: DataObservabilityCollector =
    (values[COLLECTOR_FIELD] as DataObservabilityCollector) ||
    DataObservabilityCollector.OneUptime;

  if (collector === DataObservabilityCollector.Probe) {
    return {
      collector,
      probeId: String(values["probeId"] || ""),
      probeConnectionVariable: String(
        values["probeConnectionVariable"] || "",
      ).trim(),
    };
  }

  if (collector === DataObservabilityCollector.DatabaseAgent) {
    return {
      collector,
      databaseServerId: String(values["databaseServerId"] || ""),
      databaseName: String(values["databaseName"] || "").trim(),
    };
  }

  return {
    collector: DataObservabilityCollector.OneUptime,
    connectionString: String(values["connectionString"] || ""),
  };
}
