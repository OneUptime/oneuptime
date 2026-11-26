import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import ResourceAiAgent from "../../../Models/DatabaseModels/ResourceAiAgent";
import DatabaseServerService from "../../Services/DatabaseServerService";
import ResourceAiAgentService from "../../Services/ResourceAiAgentService";
import QueryHelper from "../../Types/Database/QueryHelper";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../Types/Date";
import {
  DataObservabilityAgentState,
  DataObservabilityDatabaseAgent,
} from "../../../Types/DataObservability/DataObservabilityApiTypes";
import { DataStoreKind } from "../../../Types/DataSecurity/DataStoreKind";
import ObjectID from "../../../Types/ObjectID";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiAgentPosture,
  parseResourceAiAgentPosture,
} from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import {
  DATABASE_AGENT_WORK_VERSION,
  DatabaseAgentDataObservabilityPosture,
  DatabaseAgentEngine,
  getDatabaseAgentEngineOfSystem,
} from "../../../Utils/DataObservability/DatabaseAgent/DatabaseAgentWork";

/*
 * THE DATABASE AGENTS A DATABASE CAN BE READ THROUGH (#11148).
 *
 * A Database Agent (agents/DatabaseAgent) is a collector and, beside it, a
 * resource AI agent registered as the database server the collector
 * reports. That agent is what reads a database for Data Observability: it
 * already reaches the server, with logins of its own. Whether it can read
 * one now is said in one word (DataObservabilityAgentState), worked out
 * here, from the server's engine, the agent's presence and what its
 * posture says of Data Observability - the same word where the agent is
 * chosen and on the database's page.
 */

// The kinds a database read through a Database Agent is collected as, by the agent's engine.
const KIND_OF_ENGINE: Readonly<Record<DatabaseAgentEngine, DataStoreKind>> = {
  postgresql: DataStoreKind.PostgreSql,
  mysql: DataStoreKind.MySql,
};

export const DATABASE_AGENT_KINDS: ReadonlyArray<DataStoreKind> =
  Object.values(KIND_OF_ENGINE);

export function getDatabaseAgentKindOfEngine(
  engine: DatabaseAgentEngine | null,
): DataStoreKind | null {
  return engine ? KIND_OF_ENGINE[engine] : null;
}

// The engine a store of this kind is read with by a Database Agent; null for a kind it reads none of.
export function getDatabaseAgentEngineOfKind(
  kind: string | null | undefined,
): DatabaseAgentEngine | null {
  for (const engine of Object.keys(KIND_OF_ENGINE) as Array<
    DatabaseAgentEngine
  >) {
    if (KIND_OF_ENGINE[engine] === kind) {
      return engine;
    }
  }

  return null;
}

// The most servers the agent picker lists.
const MAX_AGENTS_LISTED: number = 200;

export interface AgentStateInput {
  // The server's engine as its collector reports it (dbSystem).
  serverSystem: string | null | undefined;
  agent: ResourceAiAgent | null;
  isAgentOnline: boolean;
}

/*
 * Whether the server's Database Agent can read a database for Data
 * Observability now, and when not, the first thing in the way: an engine
 * it reads none of, no agent, an agent not heard from, one older than this
 * work, one whose owner left it off.
 */
export function getDatabaseAgentState(
  input: AgentStateInput,
): DataObservabilityAgentState {
  if (!getDatabaseAgentEngineOfSystem(input.serverSystem)) {
    return DataObservabilityAgentState.EngineNotSupported;
  }

  if (!input.agent) {
    return DataObservabilityAgentState.NoAgent;
  }

  if (!input.isAgentOnline) {
    return DataObservabilityAgentState.Offline;
  }

  const dataObservability: DatabaseAgentDataObservabilityPosture | null =
    readAgentDataObservability(input.agent);

  if (
    !dataObservability ||
    dataObservability.workVersion < DATABASE_AGENT_WORK_VERSION
  ) {
    return DataObservabilityAgentState.NeedsUpdate;
  }

  if (!dataObservability.isOn) {
    return DataObservabilityAgentState.TurnedOff;
  }

  return DataObservabilityAgentState.Ready;
}

// What an agent's posture says of Data Observability, read strictly; null from an agent that says nothing.
export function readAgentDataObservability(
  agent: ResourceAiAgent | null,
): DatabaseAgentDataObservabilityPosture | null {
  if (!agent?.posture) {
    return null;
  }

  const posture: ResourceAiAgentPosture | null = parseResourceAiAgentPosture(
    agent.posture,
  );

  return posture?.dataObservability || null;
}

export interface DatabaseAgentOfServer {
  server: DatabaseServer;
  agent: ResourceAiAgent | null;
  state: DataObservabilityAgentState;
}

export default class DataObservabilityDatabaseAgents {
  /*
   * Every database server of the project that has a Database Agent of its
   * own, by name, with whether it can read a database now: what Connect a
   * Database and a database's settings offer. Read as OneUptime - a
   * database server is the Database product's record - and only what
   * choosing one needs.
   */
  public static async list(
    projectId: ObjectID,
  ): Promise<Array<DataObservabilityDatabaseAgent>> {
    const agents: Array<ResourceAiAgent> = await ResourceAiAgentService.findBy({
      query: {
        projectId,
        resourceType: AiResourceType.DatabaseServer,
      },
      select: {
        _id: true,
        resourceId: true,
        agentVersion: true,
        posture: true,
        lastAliveAt: true,
        connectionStatus: true,
      },
      skip: 0,
      limit: MAX_AGENTS_LISTED,
      props: { isRoot: true },
    });

    const serverIds: Array<ObjectID> = agents
      .map((agent: ResourceAiAgent): ObjectID | undefined => {
        return agent.resourceId;
      })
      .filter((id: ObjectID | undefined): id is ObjectID => {
        return Boolean(id);
      });

    if (serverIds.length === 0) {
      return [];
    }

    const servers: Array<DatabaseServer> = await DatabaseServerService.findBy({
      query: {
        projectId,
        _id: QueryHelper.any(
          serverIds.map((id: ObjectID): string => {
            return id.toString();
          }),
        ),
        isArchived: false,
      },
      select: { _id: true, name: true, dbSystem: true },
      sort: { name: SortOrder.Ascending },
      skip: 0,
      limit: MAX_AGENTS_LISTED,
      props: { isRoot: true },
    });

    const agentByServer: Map<string, ResourceAiAgent> = new Map();

    for (const agent of agents) {
      if (agent.resourceId) {
        agentByServer.set(agent.resourceId.toString().toLowerCase(), agent);
      }
    }

    const now: Date = OneUptimeDate.getCurrentDate();

    return servers
      .filter((server: DatabaseServer): boolean => {
        return Boolean(server.id);
      })
      .map((server: DatabaseServer): DataObservabilityDatabaseAgent => {
        const agent: ResourceAiAgent | null =
          agentByServer.get(server.id!.toString().toLowerCase()) || null;
        const engine: DatabaseAgentEngine | null =
          getDatabaseAgentEngineOfSystem(server.dbSystem);
        const dataObservability: DatabaseAgentDataObservabilityPosture | null =
          readAgentDataObservability(agent);

        return {
          databaseServerId: server.id!.toString(),
          name: server.name || "",
          engine: server.dbSystem || null,
          kind: getDatabaseAgentKindOfEngine(engine),
          state: getDatabaseAgentState({
            serverSystem: server.dbSystem,
            agent,
            isAgentOnline: agent
              ? ResourceAiAgentService.isOnline(agent, now)
              : false,
          }),
          agentVersion: agent?.agentVersion || null,
          runsCustomSql: dataObservability?.runsCustomSql === true,
        };
      });
  }

  /*
   * The servers named, each with its agent and whether it can read a
   * database now, by server id (lower case): a database's page and the
   * list of databases. A server not found is absent.
   */
  public static async readByServer(data: {
    projectId: ObjectID;
    serverIds: Array<ObjectID>;
  }): Promise<Map<string, DatabaseAgentOfServer>> {
    const byServer: Map<string, DatabaseAgentOfServer> = new Map();
    const ids: Array<string> = Array.from(
      new Set(
        data.serverIds.map((id: ObjectID): string => {
          return id.toString().toLowerCase();
        }),
      ),
    );

    if (ids.length === 0) {
      return byServer;
    }

    const servers: Array<DatabaseServer> = await DatabaseServerService.findBy({
      query: { projectId: data.projectId, _id: QueryHelper.any(ids) },
      select: { _id: true, name: true, dbSystem: true },
      skip: 0,
      limit: ids.length,
      props: { isRoot: true },
    });
    const agents: Map<string, ResourceAiAgent> =
      await ResourceAiAgentService.findAgentsForResources({
        projectId: data.projectId,
        resourceType: AiResourceType.DatabaseServer,
        resourceIds: servers
          .map((server: DatabaseServer): ObjectID | null => {
            return server.id;
          })
          .filter((id: ObjectID | null): id is ObjectID => {
            return Boolean(id);
          }),
      });
    const now: Date = OneUptimeDate.getCurrentDate();

    for (const server of servers) {
      if (!server.id) {
        continue;
      }

      const key: string = server.id.toString().toLowerCase();
      const agent: ResourceAiAgent | null = agents.get(key) || null;

      byServer.set(key, {
        server,
        agent,
        state: getDatabaseAgentState({
          serverSystem: server.dbSystem,
          agent,
          isAgentOnline: agent
            ? ResourceAiAgentService.isOnline(agent, now)
            : false,
        }),
      });
    }

    return byServer;
  }
}
