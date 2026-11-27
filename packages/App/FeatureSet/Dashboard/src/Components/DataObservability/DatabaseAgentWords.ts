import { DataObservabilityAgentState } from "Common/Types/DataObservability/DataObservabilityApiTypes";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * WHAT A DATABASE AGENT'S STATE SAYS, WHEREVER IT IS DRAWN (#11148): the
 * agent picker of Connect a Database and of a database's settings, the
 * database's Connection card, and its collection message. Each state not
 * ready says what stands in the way and the one step that fixes it.
 */

// A word for each state, for a picker's option and a pill.
export const DATABASE_AGENT_STATE_LABELS: Readonly<
  Record<DataObservabilityAgentState, string>
> = {
  [DataObservabilityAgentState.Ready]: translationKey("Ready"),
  [DataObservabilityAgentState.NoAgent]: translationKey("No agent connected"),
  [DataObservabilityAgentState.Offline]: translationKey("Offline"),
  [DataObservabilityAgentState.NeedsUpdate]: translationKey("Needs an update"),
  [DataObservabilityAgentState.TurnedOff]: translationKey(
    "Data Observability off",
  ),
  [DataObservabilityAgentState.EngineNotSupported]: translationKey(
    "Engine not supported",
  ),
};

// The sentence a state says, of the database server the agent reports as.
export function getDatabaseAgentStateSentence(
  state: DataObservabilityAgentState,
  serverName: string,
  translator: Translator,
): string {
  const server: { server: string } = { server: serverName };

  switch (state) {
    case DataObservabilityAgentState.Ready:
      return translator.translateTemplate(
        "The Database Agent of {{server}} reads this database with its own logins.",
        server,
      );
    case DataObservabilityAgentState.NoAgent:
      return translator.translateTemplate(
        "{{server}} has no Database Agent connected. Install the Database Agent beside it, or choose another way to connect.",
        server,
      );
    case DataObservabilityAgentState.Offline:
      return translator.translateTemplate(
        "The Database Agent of {{server}} has not been heard from for a while. Check that it is running.",
        server,
      );
    case DataObservabilityAgentState.NeedsUpdate:
      return translator.translateTemplate(
        "The Database Agent of {{server}} is too old to read databases for Data Observability. Update it by running its install.sh again.",
        server,
      );
    case DataObservabilityAgentState.TurnedOff:
      return translator.translateTemplate(
        "The Database Agent of {{server}} does not read databases for Data Observability yet. Add ONEUPTIME_DATA_OBSERVABILITY=true to its .env, then run docker compose up -d.",
        server,
      );
    case DataObservabilityAgentState.EngineNotSupported:
    default:
      return translator.translateTemplate(
        "A Database Agent reads PostgreSQL and MySQL databases for Data Observability, and {{server}} is neither. Choose another way to connect.",
        server,
      );
  }
}

// The engine a Database Agent's collector reports, as people name it.
export function getDatabaseAgentEngineName(engine: string | null): string {
  switch ((engine || "").trim().toLowerCase()) {
    case "postgresql":
    case "postgres":
      return "PostgreSQL";
    case "mysql":
      return "MySQL";
    case "mariadb":
      return "MariaDB";
    default:
      return engine || "";
  }
}
