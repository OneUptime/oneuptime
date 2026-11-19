import { DataBiSource } from "../../../../Types/DataObservability/DataBiLineage";
import { getBiDatabaseSource } from "./BiSources";
import { BiTableRef, uniqueTables } from "./BiTables";
import {
  PowerQueryDataflowEntity,
  PowerQueryRead,
  PowerQuerySource,
  readPowerQueryDataset,
  readPowerQuerySection,
  uniqueDataflowEntities,
} from "./PowerQuery";

/*
 * THE TABLES A POWER BI DATAFLOW'S ENTITIES READ (#9551).
 *
 * A dataset built on a dataflow reads one of its entities
 * (PowerPlatform.Dataflows, then the workspace, the dataflow and the
 * entity: PowerQuery), and the scan names only the dataflow. What the
 * entity reads is in the dataflow's definition, which Power BI's admin API
 * exports (Dataflows - Export Dataflow As Admin: admin/dataflows/{id}/export,
 * for a service principal while Service principals can access read-only
 * admin APIs is on, 200 requests an hour): its model.json, whose
 * pbi:mashup document is a section document of the dataflow's queries
 * (section Section1; shared Orders = let ... in ...;). Each entity is its
 * query of that name, read as a dataset's table is (readPowerQueryDataset),
 * with the dataflow's parameters and its other queries - staging queries,
 * computed entities - as its context. An entity linked from another
 * dataflow reads that dataflow's entity in turn, a few dataflows deep.
 *
 * Only the dataflows the charted datasets read are exported, and each once
 * until it changes (the scan says when it last did): a read keeps each
 * definition it read (PowerBiReadState), and the exports of the last hour,
 * so one read exports at most MAX_DATAFLOW_EXPORTS_PER_READ and all reads
 * together stay under Power BI's hourly limit, with room to spare. A
 * definition Power BI would not give is asked for again a day later; a 429
 * stops the read's exports, and the rest wait for the next read.
 */

// The reader's version: a definition read by an older one is read again when there is room.
export const POWER_BI_DATAFLOW_READER_VERSION: number = 1;

// The most dataflow definitions one read exports.
export const MAX_DATAFLOW_EXPORTS_PER_READ: number = 60;

// Power BI exports 200 definitions an hour: reads keep 20 of them spare, for anything else that asks.
export const POWER_BI_DATAFLOW_EXPORTS_PER_HOUR: number = 180;

// How long a definition Power BI would not give waits before it is asked for again.
export const DATAFLOW_RETRY_AFTER_IN_MS: number = 24 * 60 * 60 * 1000;

// How often a definition is read again when the scan does not say when its dataflow changed.
export const DATAFLOW_READ_AGAIN_AFTER_IN_MS: number = 24 * 60 * 60 * 1000;

// How many dataflows deep linked entities are followed.
const MAX_LINKED_DEPTH: number = 5;

// The most entities kept of one dataflow, and dataflow definitions kept in all.
const MAX_ENTITIES_PER_DATAFLOW: number = 500;
export const MAX_DATAFLOW_DEFINITIONS: number = 2_000;

const HOUR_IN_MS: number = 60 * 60 * 1000;
const MAX_REASON_LENGTH: number = 300;

// One entity of a dataflow, as its definition reads it.
export interface PowerBiDataflowEntityRead {
  tables: Array<BiTableRef>;
  // The databases its connector calls name.
  sources: Array<PowerQuerySource>;
  // Other dataflows' entities it reads (a linked entity).
  dataflowEntities: Array<PowerQueryDataflowEntity>;
}

// What a read keeps of a dataflow's definition.
export interface PowerBiDataflowDefinition {
  // When the dataflow last changed, as the scan said when its definition was read (ISO).
  modifiedAt: string | null;
  // When it was read (ISO).
  readAt: string;
  // Each entity, by its query's name: null when Power BI would not give the definition.
  entities: Record<string, PowerBiDataflowEntityRead> | null;
  // Why it was not read, in Power BI's words; null when it was.
  error: string | null;
  version: number;
}

// A dataflow as the scan names it: what finds it by a dataset's name for it.
export interface PowerBiDataflowName {
  id: string;
  name: string;
  workspaceId: string;
  modifiedAt: string | null;
}

// Every dataflow the scan names, by id and by name in lower case.
export interface PowerBiDataflowIndex {
  byId: Map<string, PowerBiDataflowName>;
  byName: Map<string, Array<PowerBiDataflowName>>;
}

export function indexPowerBiDataflows(
  dataflows: Array<PowerBiDataflowName>,
): PowerBiDataflowIndex {
  const index: PowerBiDataflowIndex = { byId: new Map(), byName: new Map() };

  for (const dataflow of dataflows) {
    index.byId.set(dataflow.id, dataflow);

    const named: Array<PowerBiDataflowName> =
      index.byName.get(dataflow.name.toLowerCase()) || [];

    named.push(dataflow);
    index.byName.set(dataflow.name.toLowerCase(), named);
  }

  return index;
}

/*
 * The dataflow an entity reference names: by its id, or by its name - in
 * the workspace it names, where it names one - when one dataflow alone has
 * that name. Null when it names none the scan knows by name; an id is
 * always the dataflow's, known or not.
 */
export function findDataflowId(
  entity: PowerQueryDataflowEntity,
  index: PowerBiDataflowIndex,
): string | null {
  if (entity.dataflowId) {
    return entity.dataflowId;
  }

  const named: Array<PowerBiDataflowName> = (
    index.byName.get((entity.dataflowName || "").toLowerCase()) || []
  ).filter((dataflow: PowerBiDataflowName): boolean => {
    return !entity.workspaceId || dataflow.workspaceId === entity.workspaceId;
  });

  return named.length === 1 ? named[0]!.id : null;
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/*
 * A dataflow's exported definition (model.json) as its entities: each
 * query of its pbi:mashup document, read with the others as its context.
 * Null when it holds no document.
 */
export function readPowerBiDataflowExport(
  exported: unknown,
): Record<string, PowerBiDataflowEntityRead> | null {
  const mashup: Record<string, unknown> | null = readObject(
    readObject(exported)?.["pbi:mashup"],
  );
  const document: unknown = mashup?.["document"];

  if (typeof document !== "string" || !document.trim()) {
    return null;
  }

  const queries: Array<{ name: string; expression: string }> =
    readPowerQuerySection(document);
  const entities: Record<string, PowerBiDataflowEntityRead> = {};

  for (const query of queries.slice(0, MAX_ENTITIES_PER_DATAFLOW)) {
    const read: PowerQueryRead = readPowerQueryDataset({
      tables: [{ name: query.name, sources: [query.expression] }],
      expressions: queries,
    });

    entities[query.name] = {
      tables: uniqueTables(read.tables),
      sources: read.sources,
      dataflowEntities: read.dataflowEntities,
    };
  }

  return entities;
}

// What a dataset's dataflow entities read, and those that could not be read.
export interface PowerBiDataflowResolution {
  tables: Array<BiTableRef>;
  sources: Array<DataBiSource>;
  // Entities whose dataflow's definition is not read yet: it is exported within Power BI's limit.
  isPending: boolean;
  // Entities that could not be read, and why (Power BI's words, or OneUptime's).
  unreadReasons: Array<string>;
}

// How a sentence ends.
const SENTENCE_END: RegExp = /[.!?]$/;

// A reason as a sentence, so it reads whole inside another: "Power BI answered 403: Forbidden."
export function asReasonSentence(text: string): string {
  const trimmed: string = text.trim();

  return SENTENCE_END.test(trimmed) ? trimmed : `${trimmed}.`;
}

function entityOf(
  definition: PowerBiDataflowDefinition,
  name: string,
): PowerBiDataflowEntityRead | undefined {
  const entities: Record<string, PowerBiDataflowEntityRead> =
    definition.entities || {};

  if (entities[name]) {
    return entities[name];
  }

  // M names are case-sensitive, but an entity is never two names apart by case alone.
  const key: string | undefined = Object.keys(entities).find(
    (entity: string): boolean => {
      return entity.toLowerCase() === name.toLowerCase();
    },
  );

  return key ? entities[key] : undefined;
}

/*
 * What a dataset's dataflow entities read: each entity's tables and the
 * databases they come from, through linked entities a few dataflows deep.
 */
export function resolveDataflowEntities(data: {
  entities: Array<PowerQueryDataflowEntity>;
  definitions: ReadonlyMap<string, PowerBiDataflowDefinition>;
  index: PowerBiDataflowIndex;
}): PowerBiDataflowResolution {
  const tables: Array<BiTableRef> = [];
  const sources: Array<DataBiSource> = [];
  const unreadReasons: Array<string> = [];
  let isPending: boolean = false;
  const visited: Set<string> = new Set();
  let frontier: Array<PowerQueryDataflowEntity> = uniqueDataflowEntities(
    data.entities,
  );

  for (
    let depth: number = 0;
    depth < MAX_LINKED_DEPTH && frontier.length > 0;
    depth++
  ) {
    const next: Array<PowerQueryDataflowEntity> = [];

    for (const entity of frontier) {
      const dataflowId: string | null = findDataflowId(entity, data.index);

      if (!dataflowId) {
        unreadReasons.push(
          `OneUptime found no one dataflow named ${entity.dataflowName || "as the dataset names it"}.`,
        );
        continue;
      }

      const key: string = `${dataflowId}\u0000${entity.entity.toLowerCase()}`;

      if (visited.has(key)) {
        continue;
      }

      visited.add(key);

      const definition: PowerBiDataflowDefinition | undefined =
        data.definitions.get(dataflowId);

      if (!definition) {
        isPending = true;
        continue;
      }

      if (!definition.entities) {
        unreadReasons.push(
          asReasonSentence(
            definition.error || "Power BI did not export its definition.",
          ),
        );
        continue;
      }

      const read: PowerBiDataflowEntityRead | undefined = entityOf(
        definition,
        entity.entity,
      );

      if (!read) {
        unreadReasons.push(
          `Its dataflow has no query named ${entity.entity.slice(0, 100)}.`,
        );
        continue;
      }

      tables.push(...read.tables);
      sources.push(
        ...read.sources.map((source: PowerQuerySource): DataBiSource => {
          return getBiDatabaseSource(
            source.engine,
            source.host,
            source.database,
          );
        }),
      );
      next.push(...read.dataflowEntities);
    }

    frontier = next;
  }

  return {
    tables: uniqueTables(tables),
    sources,
    isPending,
    unreadReasons,
  };
}

// Every dataflow some entities read, through linked entities as far as their definitions are known.
export function getNeededDataflowIds(data: {
  entities: Array<PowerQueryDataflowEntity>;
  definitions: ReadonlyMap<string, PowerBiDataflowDefinition>;
  index: PowerBiDataflowIndex;
}): Array<string> {
  const needed: Array<string> = [];
  const seen: Set<string> = new Set();
  let frontier: Array<PowerQueryDataflowEntity> = data.entities;

  for (
    let depth: number = 0;
    depth < MAX_LINKED_DEPTH && frontier.length > 0;
    depth++
  ) {
    const next: Array<PowerQueryDataflowEntity> = [];

    for (const entity of frontier) {
      const dataflowId: string | null = findDataflowId(entity, data.index);

      if (!dataflowId) {
        continue;
      }

      if (!seen.has(dataflowId)) {
        seen.add(dataflowId);
        needed.push(dataflowId);
      }

      const read: PowerBiDataflowEntityRead | undefined = data.definitions.get(
        dataflowId,
      )
        ? entityOf(data.definitions.get(dataflowId)!, entity.entity)
        : undefined;

      next.push(...(read?.dataflowEntities || []));
    }

    frontier = next;
  }

  return needed;
}

// Whether a dataflow's definition is to be exported now: never read, changed, or read by an older reader.
export function isDataflowDefinitionStale(data: {
  definition: PowerBiDataflowDefinition | undefined;
  // When the dataflow last changed, as the scan says now.
  modifiedAt: string | null;
  now: Date;
}): boolean {
  const definition: PowerBiDataflowDefinition | undefined = data.definition;

  if (!definition) {
    return true;
  }

  const age: number =
    data.now.getTime() - new Date(definition.readAt).getTime();

  if (definition.error) {
    return age >= DATAFLOW_RETRY_AFTER_IN_MS;
  }

  if (definition.version !== POWER_BI_DATAFLOW_READER_VERSION) {
    return true;
  }

  if (data.modifiedAt) {
    return definition.modifiedAt !== data.modifiedAt;
  }

  return age >= DATAFLOW_READ_AGAIN_AFTER_IN_MS;
}

// The exports this read may spend: its own most, and what the last hour's reads left of Power BI's limit.
export function getDataflowExportRoom(data: {
  exportedAt: Array<string>;
  now: Date;
}): number {
  const lastHour: number = data.exportedAt.filter((at: string): boolean => {
    const time: number = new Date(at).getTime();

    return !Number.isNaN(time) && data.now.getTime() - time < HOUR_IN_MS;
  }).length;

  return Math.max(
    0,
    Math.min(
      MAX_DATAFLOW_EXPORTS_PER_READ,
      POWER_BI_DATAFLOW_EXPORTS_PER_HOUR - lastHour,
    ),
  );
}

// The exports of the last hour, as kept: older ones no longer count.
export function keepRecentExports(data: {
  exportedAt: Array<string>;
  now: Date;
}): Array<string> {
  return data.exportedAt.filter((at: string): boolean => {
    const time: number = new Date(at).getTime();

    return !Number.isNaN(time) && data.now.getTime() - time < HOUR_IN_MS;
  });
}

function reasonOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(
    0,
    MAX_REASON_LENGTH,
  );
}

// A definition read now, or why it was not.
export function definitionOf(data: {
  exported: unknown;
  error: unknown;
  modifiedAt: string | null;
  now: Date;
}): PowerBiDataflowDefinition {
  const entities: Record<string, PowerBiDataflowEntityRead> | null =
    data.error === undefined ? readPowerBiDataflowExport(data.exported) : null;

  return {
    modifiedAt: data.modifiedAt,
    readAt: data.now.toISOString(),
    entities,
    error: entities
      ? null
      : data.error !== undefined
        ? reasonOf(data.error)
        : "Power BI's export of the dataflow held no queries.",
    version: POWER_BI_DATAFLOW_READER_VERSION,
  };
}

// How many rounds of exports one read takes: each round reads the dataflows the last one's linked entities named.
const MAX_EXPORT_ROUNDS: number = 3;

export interface PowerBiDataflowsRead {
  // Every definition known now, by id: what the tenant is put together with.
  definitions: Map<string, PowerBiDataflowDefinition>;
  // Those still read by a charted dataset: what the read keeps.
  kept: Map<string, PowerBiDataflowDefinition>;
  // The exports of the last hour, this read's included.
  exportedAt: Array<string>;
}

/*
 * The definitions of the dataflows some entities read: those kept while
 * they are fresh, the others exported now - the dataflows the charted
 * datasets read first, then those their linked entities read - while the
 * read has room under Power BI's hourly limit. A 429 stops the read's
 * exports; anything else Power BI says is kept as why, and asked again a
 * day later.
 */
export async function readPowerBiDataflows(data: {
  entities: Array<PowerQueryDataflowEntity>;
  index: PowerBiDataflowIndex;
  kept: ReadonlyMap<string, PowerBiDataflowDefinition>;
  exportedAt: Array<string>;
  now: Date;
  // Asks Power BI for a dataflow's definition (admin/dataflows/{id}/export).
  exportDefinition: (dataflowId: string) => Promise<unknown>;
}): Promise<PowerBiDataflowsRead> {
  const definitions: Map<string, PowerBiDataflowDefinition> = new Map(
    data.kept,
  );
  const exportedAt: Array<string> = keepRecentExports({
    exportedAt: data.exportedAt,
    now: data.now,
  });
  let room: number = getDataflowExportRoom({ exportedAt, now: data.now });
  let isLimited: boolean = false;
  const asked: Set<string> = new Set();

  for (
    let round: number = 0;
    round < MAX_EXPORT_ROUNDS && room > 0 && !isLimited;
    round++
  ) {
    const stale: Array<string> = getNeededDataflowIds({
      entities: data.entities,
      definitions,
      index: data.index,
    }).filter((dataflowId: string): boolean => {
      return (
        !asked.has(dataflowId) &&
        isDataflowDefinitionStale({
          definition: definitions.get(dataflowId),
          modifiedAt: data.index.byId.get(dataflowId)?.modifiedAt || null,
          now: data.now,
        })
      );
    });

    if (stale.length === 0) {
      break;
    }

    for (const dataflowId of stale) {
      if (room <= 0) {
        break;
      }

      const modifiedAt: string | null =
        data.index.byId.get(dataflowId)?.modifiedAt || null;

      asked.add(dataflowId);
      room--;
      exportedAt.push(data.now.toISOString());

      try {
        definitions.set(
          dataflowId,
          definitionOf({
            exported: await data.exportDefinition(dataflowId),
            error: undefined,
            modifiedAt,
            now: data.now,
          }),
        );
      } catch (error) {
        // Power BI asked for fewer: the rest wait for the next read, what is kept stands.
        if ((error as { statusCode?: unknown })?.statusCode === 429) {
          isLimited = true;
          break;
        }

        definitions.set(
          dataflowId,
          definitionOf({
            exported: undefined,
            error,
            modifiedAt,
            now: data.now,
          }),
        );
      }
    }
  }

  const kept: Map<string, PowerBiDataflowDefinition> = new Map();

  for (const dataflowId of getNeededDataflowIds({
    entities: data.entities,
    definitions,
    index: data.index,
  }).slice(0, MAX_DATAFLOW_DEFINITIONS)) {
    const definition: PowerBiDataflowDefinition | undefined =
      definitions.get(dataflowId);

    if (definition) {
      kept.set(dataflowId, definition);
    }
  }

  return { definitions, kept, exportedAt };
}

function readText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readTimeText(value: unknown): string | null {
  const text: string | null = readText(value);

  return text && !Number.isNaN(new Date(text).getTime()) ? text : null;
}

function readEntityRead(value: unknown): PowerBiDataflowEntityRead | null {
  const read: Record<string, unknown> | null = readObject(value);

  if (!read) {
    return null;
  }

  return {
    tables: (Array.isArray(read["tables"]) ? read["tables"] : []).filter(
      (table: unknown): table is BiTableRef => {
        return Boolean(readText(readObject(table)?.["table"]));
      },
    ),
    sources: (Array.isArray(read["sources"]) ? read["sources"] : []).filter(
      (source: unknown): source is PowerQuerySource => {
        return Boolean(readText(readObject(source)?.["engine"]));
      },
    ),
    dataflowEntities: (Array.isArray(read["dataflowEntities"])
      ? read["dataflowEntities"]
      : []
    ).filter((entity: unknown): entity is PowerQueryDataflowEntity => {
      return Boolean(readText(readObject(entity)?.["entity"]));
    }),
  };
}

// The definitions a read kept, read back: one that does not fit is left out, and read again.
export function readDataflowDefinitions(
  value: unknown,
): Map<string, PowerBiDataflowDefinition> {
  const definitions: Map<string, PowerBiDataflowDefinition> = new Map();

  for (const [id, entryValue] of Object.entries(readObject(value) || {})) {
    const entry: Record<string, unknown> | null = readObject(entryValue);
    const readAt: string | null = readTimeText(entry?.["readAt"]);

    if (!entry || !readAt || definitions.size >= MAX_DATAFLOW_DEFINITIONS) {
      continue;
    }

    const entitiesValue: Record<string, unknown> | null = readObject(
      entry["entities"],
    );
    let entities: Record<string, PowerBiDataflowEntityRead> | null = null;

    if (entitiesValue) {
      entities = {};

      for (const [name, read] of Object.entries(entitiesValue)) {
        const entity: PowerBiDataflowEntityRead | null = readEntityRead(read);

        if (entity) {
          entities[name] = entity;
        }
      }
    }

    definitions.set(id, {
      modifiedAt: readTimeText(entry["modifiedAt"]),
      readAt,
      entities,
      error: entities ? null : readText(entry["error"]) || "Not read.",
      version:
        typeof entry["version"] === "number" ? (entry["version"] as number) : 0,
    });
  }

  return definitions;
}
