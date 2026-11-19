import DataStore from "../../../../Models/DatabaseModels/DataStore";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import DataStoreService from "../../../Services/DataStoreService";
import { assertDatabaseConnectionAllowed } from "../DatabaseConnectionGuard";
import { getCollectorEngineOfKind } from "../DataObservabilityEngines";
import DataverseApi, { readDataverseConnection } from "../DataverseApi";
import { UsageStore } from "../TableUsageMatching";
import { isSameBiHost } from "./BiMatching";
import { BiTableRef } from "./BiTables";

/*
 * EACH DATAVERSE ENVIRONMENT'S ENTITY SET NAMES, FOR THE BI TABLES THAT
 * NAME ONE (#9554).
 *
 * Power BI's OData connectors to Dataverse (Cds.Entities,
 * Dataverse.Contents) pick a table by its entity set - accounts - while
 * OneUptime keeps a Dataverse table under its logical name - account - as
 * the environment's SQL endpoint names it (DataverseApi). An entity set's
 * name is usually its table's plural, but not always (a maker can name it,
 * and Dataverse's own plurals are its own), so it is never guessed: the
 * environment says. Its table definitions (EntityDefinitions, one request
 * that reads no rows) give each table's LogicalName and EntitySetName.
 *
 * Only the watched environments a read's tables name by entity set are
 * asked - by their host, as the connector named it - with the
 * environment's own connection, as its collection reads it. What each
 * said is kept with the tool (DataBiConnection.readState) for a day, and
 * asked again sooner, once an hour at most, when a table names an entity
 * set it did not have. An environment a probe collects is not asked: its
 * connection is the probe's. One that cannot be asked keeps what it said
 * last, and the read says why.
 */

export interface DataverseEntitySetTable {
  logicalName: string;
  entitySetName: string;
}

// What a read keeps of one environment: when it was asked, and each entity set (lower case) to its logical name.
export interface DataverseEntitySetEntry {
  readAt: string;
  entitySets: Record<string, string>;
}

// By the environment's store id.
export type DataverseEntitySetState = Record<string, DataverseEntitySetEntry>;

// Asks one watched environment, by its store's id, for its tables' entity sets.
export type DataverseEntitySetLookup = (
  dataStoreId: string,
) => Promise<Array<DataverseEntitySetTable>>;

export interface DataverseEntitySetsRead {
  // By the environment's store id: each entity set, in lower case, to its table's logical name.
  entitySets: Map<string, Map<string, string>>;
  // What to keep for the next read.
  state: DataverseEntitySetState;
  // The environments that could not be asked, and why.
  warnings: Array<string>;
}

// How long an environment's entity sets are kept before it is asked again.
export const DATAVERSE_ENTITY_SETS_KEPT_FOR_IN_MS: number = 24 * 60 * 60 * 1000;

// The soonest an environment is asked again for an entity set it did not have.
export const DATAVERSE_ENTITY_SETS_ASKED_AGAIN_AFTER_IN_MS: number =
  60 * 60 * 1000;

// The most environments asked by one read, and entity sets kept of one.
export const MAX_DATAVERSE_ENVIRONMENTS_ASKED: number = 20;
export const MAX_DATAVERSE_ENTITY_SETS: number = 10_000;

const MAX_NAME_LENGTH: number = 200;
const MAX_REASON_LENGTH: number = 300;

function readText(value: unknown, maxLength: number = MAX_NAME_LENGTH): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function timeOf(value: string): number {
  const time: number = new Date(value).getTime();

  return Number.isNaN(time) ? 0 : time;
}

// What a read kept, as written: anything else is nothing kept.
export function readDataverseEntitySetState(
  value: unknown,
): DataverseEntitySetState {
  const state: DataverseEntitySetState = {};
  const stores: Record<string, unknown> | null = readObject(value);

  for (const [dataStoreId, entryValue] of Object.entries(stores || {})) {
    const entry: Record<string, unknown> | null = readObject(entryValue);
    const readAt: string = readText(entry?.["readAt"], 40);
    const entitySets: Record<string, unknown> | null = readObject(
      entry?.["entitySets"],
    );

    if (!dataStoreId || !readAt || !timeOf(readAt) || !entitySets) {
      continue;
    }

    const kept: Record<string, string> = {};

    for (const [entitySet, logicalName] of Object.entries(entitySets).slice(
      0,
      MAX_DATAVERSE_ENTITY_SETS,
    )) {
      const name: string = readText(logicalName);

      if (entitySet && name) {
        kept[entitySet.toLowerCase()] = name;
      }
    }

    state[dataStoreId] = { readAt, entitySets: kept };
  }

  return state;
}

// An environment's answer, kept: each entity set in lower case to its logical name.
export function keepDataverseEntitySets(
  tables: Array<DataverseEntitySetTable>,
): Record<string, string> {
  const kept: Record<string, string> = {};

  for (const table of tables) {
    const entitySet: string = readText(table.entitySetName).toLowerCase();
    const logicalName: string = readText(table.logicalName);

    if (
      entitySet &&
      logicalName &&
      Object.keys(kept).length < MAX_DATAVERSE_ENTITY_SETS
    ) {
      kept[entitySet] = logicalName;
    }
  }

  return kept;
}

function reasonOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(
    0,
    MAX_REASON_LENGTH,
  );
}

/*
 * The entity sets of every watched environment a read's tables name by
 * entity set: kept ones while fresh, the others asked of the environment.
 */
export async function readDataverseEntitySets(data: {
  stores: Array<UsageStore>;
  refs: Array<BiTableRef>;
  state: DataverseEntitySetState;
  now: Date;
  lookup: DataverseEntitySetLookup;
}): Promise<DataverseEntitySetsRead> {
  const entitySets: Map<string, Map<string, string>> = new Map();
  const state: DataverseEntitySetState = {};
  const warnings: Array<string> = [];
  const named: Array<BiTableRef> = data.refs.filter(
    (ref: BiTableRef): boolean => {
      return Boolean(ref.isEntitySet && ref.host && ref.table);
    },
  );
  const environments: Array<UsageStore> = data.stores
    .filter((store: UsageStore): boolean => {
      return (
        getCollectorEngineOfKind(store.kind) === "dataverse" &&
        named.some((ref: BiTableRef): boolean => {
          return isSameBiHost(store.serverAddress, ref.host);
        })
      );
    })
    .slice(0, MAX_DATAVERSE_ENVIRONMENTS_ASKED);

  for (const environment of environments) {
    const kept: DataverseEntitySetEntry | undefined =
      data.state[environment.dataStoreId];
    const wanted: Array<string> = named
      .filter((ref: BiTableRef): boolean => {
        return isSameBiHost(environment.serverAddress, ref.host);
      })
      .map((ref: BiTableRef): string => {
        return ref.table.toLowerCase();
      });
    const age: number = kept
      ? data.now.getTime() - timeOf(kept.readAt)
      : Number.POSITIVE_INFINITY;
    const isFresh: boolean = Boolean(
      kept &&
        age < DATAVERSE_ENTITY_SETS_KEPT_FOR_IN_MS &&
        (age < DATAVERSE_ENTITY_SETS_ASKED_AGAIN_AFTER_IN_MS ||
          wanted.every((entitySet: string): boolean => {
            return entitySet in kept.entitySets;
          })),
    );
    let entry: DataverseEntitySetEntry | undefined = kept;

    if (!isFresh) {
      try {
        entry = {
          readAt: data.now.toISOString(),
          entitySets: keepDataverseEntitySets(
            await data.lookup(environment.dataStoreId),
          ),
        };
      } catch (error) {
        warnings.push(
          `Dataverse ${environment.serverAddress || environment.dataStoreId} was not asked for its tables' entity set names, so the Power BI tables that name one by it are matched as it said before, or not at all: ${reasonOf(error)}`,
        );
      }
    }

    if (entry) {
      state[environment.dataStoreId] = entry;
      entitySets.set(
        environment.dataStoreId,
        new Map(Object.entries(entry.entitySets)),
      );
    }
  }

  return { entitySets, state, warnings };
}

/*
 * Asks a watched Dataverse environment of the project for its tables'
 * entity sets, with its own connection, as its collection reads them. Not
 * one a probe collects, whose connection is the probe's.
 */
export function getDataverseEntitySetLookup(
  projectId: ObjectID,
): DataverseEntitySetLookup {
  return async (
    dataStoreId: string,
  ): Promise<Array<DataverseEntitySetTable>> => {
    const store: DataStore | null = await DataStoreService.findOneBy({
      query: { _id: new ObjectID(dataStoreId), projectId },
      select: {
        _id: true,
        kind: true,
        connectionString: true,
        scanProbeId: true,
        isArchived: true,
      },
      props: { isRoot: true },
    });

    if (
      !store?.id ||
      store.isArchived ||
      getCollectorEngineOfKind(store.kind) !== "dataverse"
    ) {
      throw new Error("The environment is no longer connected.");
    }

    if (store.scanProbeId) {
      throw new Error(
        "A probe collects this environment, so its connection is the probe's.",
      );
    }

    if (!store.connectionString) {
      throw new Error("No connection string is saved on this environment.");
    }

    await assertDatabaseConnectionAllowed({
      engine: "dataverse",
      connectionString: store.connectionString,
    });

    const definitions: Array<JSONObject> = await new DataverseApi({
      connection: readDataverseConnection(store.connectionString),
    }).listTables();

    return definitions.map((definition: JSONObject) => {
      return {
        logicalName: readText(definition["LogicalName"]),
        entitySetName: readText(definition["EntitySetName"]),
      };
    });
  };
}
