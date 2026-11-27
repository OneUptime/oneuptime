/**
 * Always-Ask Writes
 *
 * WHAT ONEUPTIME ASKS A PERSON BEFORE IS NOT WRITTEN HERE (#11177).
 *
 * Ask AI asks a person on a card before some changes in every mode, and the
 * Data Security tools refuse those on this server, which has no card to
 * show (Common/Server/Utils/AI/Toolbox/DataSecurityActionRunner). Most of
 * them are a plain write of a record - an issue's status set to Accepted, a
 * finding marked suppressed, a residency rule made - and this server's
 * generated tools write records: update_data_security_issue could accept a
 * risk that change_data_security_issue is refused, with no one asked.
 *
 * So every write this server sends to a record's route - a generated
 * create, update or delete, or a hand-written tool's request to the same
 * route - is read here first, the way the route reads it, against
 * Common's one list of those changes (Types/AI/AIAlwaysAskChanges), which
 * Ask AI's actions ask by too. A write that makes one is refused before
 * anything is sent, in the sentence the Data Security tools are refused in
 * - why, as the card says it, and the page in OneUptime where the person
 * makes the change - and the agent is told not to retry it nor make it
 * another way (ToolHandler.getAsksAPersonSuggestion). Any other write of the
 * same record goes on as it did: assigning an issue, reopening it, naming a
 * rule.
 *
 * A change asked about only in some projects - Confirm where a Critical
 * issue pages someone - is read in the project, with the caller's
 * credential, as Ask AI's card reads it, and refused where it holds or
 * cannot be read: a change that could not be judged is never made unseen.
 */

import DatabaseBaseModel, {
  DatabaseBaseModelType,
} from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import {
  AlwaysAskCondition,
  AlwaysAskPage,
  AlwaysAskWrite,
  AlwaysAskWriteFound,
  doCriticalIssuesPage,
  findAlwaysAskChange,
  getAlwaysAskChangesOfTable,
  getAsksInEveryModeRefusal,
} from "Common/Types/AI/AIAlwaysAskChanges";
import { AIChatCitationTarget } from "Common/Types/AI/AIChatTypes";
import {
  ADD_TO_LIST_KEY,
  REMOVE_FROM_LIST_KEY,
} from "Common/Types/Database/ListChanges";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  readCrudCreateItem,
  readCrudUpdateData,
} from "Common/Server/Utils/Database/CrudRouteWrites";
import {
  getAlwaysAskPageTarget,
  getDataSecurityPageUrl,
} from "Common/Server/Utils/DataSecurity/DataSecurityPages";
import DatabaseModels from "Common/Models/DatabaseModels/Index";
import McpCredentialUtil, {
  McpCredential,
  McpCredentialInput,
  McpCredentialType,
} from "../Types/McpCredential";
import OneUptimeOperation from "../Types/OneUptimeOperation";

/*
 * The refusal of a write that asks a person first. Its message opens with
 * ASKS_IN_EVERY_MODE_REFUSAL_PREFIX, as the Data Security tools' refusal
 * does, so the agent is told the same thing next.
 */
export class AsksAPersonFirstError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "AsksAPersonFirstError";
  }
}

// A write of one record, as this server sends it to the record's route.
export interface RecordWrite {
  tableName: string;
  write: AlwaysAskWrite;
  // The record an update or a delete names.
  id?: string | undefined;
  // The columns the request's `data` holds, as sent. A delete has none.
  data?: JSONObject | undefined;
}

/*
 * A read of the API with the caller's credential: what the page a refusal
 * names, and whether a change asks in this project, are read with it.
 */
export type ApiRead = (path: string, body: JSONObject) => Promise<JSONValue>;

const WRITES_BY_OPERATION: Partial<Record<OneUptimeOperation, AlwaysAskWrite>> =
  {
    [OneUptimeOperation.Create]: AlwaysAskWrite.Create,
    [OneUptimeOperation.Update]: AlwaysAskWrite.Update,
    [OneUptimeOperation.Delete]: AlwaysAskWrite.Delete,
  };

// The write an operation makes, or null for a read.
export function getWriteOfOperation(
  operation: OneUptimeOperation,
): AlwaysAskWrite | null {
  return WRITES_BY_OPERATION[operation] || null;
}

interface RecordRoute {
  ModelClass: DatabaseBaseModelType;
  tableName: string;
  apiPath: string;
}

let recordRoutes: Array<RecordRoute> | null = null;

// Every record's route, longest first, so /data-store-finding is not read as /data-store.
function getRecordRoutes(): Array<RecordRoute> {
  if (!recordRoutes) {
    const routes: Array<RecordRoute> = [];

    for (const ModelClass of DatabaseModels) {
      try {
        const model: DatabaseBaseModel = new ModelClass();
        const apiPath: string | undefined = model.crudApiPath?.toString();

        if (model.tableName && apiPath) {
          routes.push({
            ModelClass: ModelClass as DatabaseBaseModelType,
            tableName: model.tableName,
            apiPath: apiPath.replace(/\/+$/, ""),
          });
        }
      } catch {
        // A model that cannot be made has no route this server writes.
      }
    }

    recordRoutes = routes.sort((a: RecordRoute, b: RecordRoute): number => {
      return b.apiPath.length - a.apiPath.length;
    });
  }

  return recordRoutes;
}

function findRouteOfTable(tableName: string): RecordRoute | null {
  return (
    getRecordRoutes().find((route: RecordRoute): boolean => {
      return route.tableName === tableName;
    }) || null
  );
}

const UUID: string =
  "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

/*
 * The write a request to the API makes on a record, as BaseAPI routes it -
 * POST /<record> creates, PUT /<record>/:id and POST /<record>/:id/
 * update-item update, DELETE /<record>/:id and POST /<record>/:id/
 * delete-item delete - or null for any other request: a read, a count, a
 * move in a list, or a route of its own such as a Data Security action's.
 */
export function readRecordWriteOfRequest(data: {
  method: "POST" | "PUT" | "DELETE";
  path: string;
  body?: JSONObject | undefined;
}): RecordWrite | null {
  // Express routes a path whatever its case, and with or without a slash at its end.
  const path: string = (data.path.split("?")[0] || "")
    .toLowerCase()
    .replace(/^\/api(?=\/)/, "")
    .replace(/\/+$/, "");

  for (const route of getRecordRoutes()) {
    if (path !== route.apiPath && !path.startsWith(`${route.apiPath}/`)) {
      continue;
    }

    const rest: string = path.slice(route.apiPath.length);
    const columns: JSONObject | undefined = readBodyData(data.body);

    if (rest === "") {
      return data.method === "POST"
        ? {
            tableName: route.tableName,
            write: AlwaysAskWrite.Create,
            data: columns,
          }
        : null;
    }

    const byId: RegExpMatchArray | null = rest.match(
      new RegExp(`^/(${UUID})(/update-item|/delete-item)?$`),
    );

    if (!byId) {
      // Another route under the record's path, such as get-list or move-in-list.
      return null;
    }

    const id: string = byId[1]!;
    const suffix: string | undefined = byId[2];

    if (
      (data.method === "PUT" && !suffix) ||
      (data.method === "POST" && suffix === "/update-item")
    ) {
      return {
        tableName: route.tableName,
        write: AlwaysAskWrite.Update,
        id,
        data: columns,
      };
    }

    if (
      (data.method === "DELETE" && !suffix) ||
      (data.method === "POST" && suffix === "/delete-item")
    ) {
      return { tableName: route.tableName, write: AlwaysAskWrite.Delete, id };
    }

    return null;
  }

  return null;
}

/*
 * A request body's columns: its `data`, as the record's route reads it,
 * and each list it adds entries to or takes them off beside it
 * (Common/Types/Database/ListChanges' addToList and removeFromList), which
 * writes that list as surely as `data` would.
 */
function readBodyData(body: JSONObject | undefined): JSONObject | undefined {
  const data: JSONValue | undefined = body?.["data"];
  const columns: JSONObject =
    data && typeof data === "object" && !Array.isArray(data)
      ? { ...(data as JSONObject) }
      : {};

  for (const key of [ADD_TO_LIST_KEY, REMOVE_FROM_LIST_KEY]) {
    const lists: JSONValue | undefined = body?.[key];

    if (lists && typeof lists === "object" && !Array.isArray(lists)) {
      for (const [column, entries] of Object.entries(lists as JSONObject)) {
        if (columns[column] === undefined) {
          columns[column] = entries;
        }
      }
    }
  }

  return Object.keys(columns).length > 0 ? columns : undefined;
}

/*
 * A write's columns as the record's route reads them: deserialized, and
 * each switch, date, number and name turned into what the database stores
 * (CrudRouteWrites, which BaseAPI reads every write with) - so "true" for
 * a switch, or a status sent as a name's object, is read as what it saves.
 * A write that cannot be read so is read as it was sent: the route refuses
 * it, and it is held to the list either way.
 */
export function readWriteColumns(write: RecordWrite): Array<JSONObject> {
  const sent: JSONObject = write.data || {};
  const route: RecordRoute | null = findRouteOfTable(write.tableName);

  if (!route || write.write === AlwaysAskWrite.Delete) {
    return [sent];
  }

  try {
    const read: JSONObject =
      write.write === AlwaysAskWrite.Create
        ? (readCrudCreateItem(sent, route.ModelClass) as unknown as JSONObject)
        : (readCrudUpdateData(
            sent,
            new route.ModelClass(),
          ) as unknown as JSONObject);

    return [read, sent];
  } catch {
    return [sent];
  }
}

/*
 * The change a write makes that asks a person first, or null. `stored` is
 * the record as it is now, for a change that compares the write with it
 * (AlwaysAskRecordWrite.comparesWith): left out, such a change is judged
 * as if the write could make it.
 */
export function findAlwaysAskChangeOfWrite(
  write: RecordWrite,
  stored?: JSONObject | null | undefined,
): AlwaysAskWriteFound | null {
  for (const columns of readWriteColumns(write)) {
    const found: AlwaysAskWriteFound | null = findAlwaysAskChange({
      tableName: write.tableName,
      write: write.write,
      data: columns,
      stored: stored || null,
    });

    if (found) {
      return found;
    }
  }

  return null;
}

// The columns a table's changes compare a write with.
function getComparedColumns(tableName: string): Array<string> {
  const columns: Set<string> = new Set();

  for (const each of getAlwaysAskChangesOfTable(tableName)) {
    for (const column of each.record.comparesWith || []) {
      columns.add(column);
    }
  }

  return Array.from(columns);
}

/*
 * An id as the API answers with it, once its answer is read
 * (HTTPResponse deserializes it): an ObjectID, text, or the
 * { _type: "ObjectID", value } it is sent as.
 */
export function readId(value: unknown): string | null {
  const text: unknown =
    value instanceof ObjectID
      ? value.toString()
      : value && typeof value === "object" && !Array.isArray(value)
        ? (value as JSONObject)["value"] || (value as JSONObject)["_id"]
        : value;

  return typeof text === "string" && ObjectID.isValidUUID(text) ? text : null;
}

function readRows(response: JSONValue): Array<JSONObject> {
  const rows: unknown = Array.isArray(response)
    ? response
    : (response as JSONObject | null)?.["data"];

  return Array.isArray(rows)
    ? (rows.filter((row: unknown): boolean => {
        return Boolean(row) && typeof row === "object";
      }) as Array<JSONObject>)
    : [];
}

// A record's columns, read as the caller; null when they may not read it.
async function readRecord(data: {
  read: ApiRead;
  tableName: string;
  id: string | undefined;
  columns: Array<string>;
}): Promise<JSONObject | null> {
  const route: RecordRoute | null = findRouteOfTable(data.tableName);

  if (!route || !data.id || !ObjectID.isValidUUID(data.id)) {
    return null;
  }

  try {
    const select: JSONObject = { _id: true };

    for (const column of data.columns) {
      select[column] = true;
    }

    // The route answers with the record itself (Response.sendEntityResponse).
    const answer: JSONValue = await data.read(
      `/api${route.apiPath}/${data.id}/get-item`,
      { select },
    );

    /*
     * A record the caller may not read is answered as {}: unread, never
     * taken for a record that holds nothing.
     */
    return answer &&
      typeof answer === "object" &&
      !Array.isArray(answer) &&
      readId((answer as JSONObject)["_id"]) !== null
      ? (answer as JSONObject)
      : null;
  } catch {
    return null;
  }
}

// The project the caller acts in: a sign-in's, or the one an API key sees.
async function readProjectId(data: {
  read: ApiRead;
  credential: McpCredential;
  record: JSONObject | null;
}): Promise<string | null> {
  if (data.credential.type === McpCredentialType.OAuth) {
    return readId(data.credential.principal.grant.projectId);
  }

  const fromRecord: string | null = readId(data.record?.["projectId"]);

  if (fromRecord) {
    return fromRecord;
  }

  try {
    const rows: Array<JSONObject> = readRows(
      await data.read("/api/project/get-list", {
        query: {},
        select: { _id: true },
        skip: 0,
        limit: 1,
      }),
    );

    return readId(rows[0]?.["_id"]);
  } catch {
    return null;
  }
}

// The pages that are a store's: its findings, owners, settings, the store itself.
const STORE_PAGES: ReadonlyArray<AlwaysAskPage> = [
  AlwaysAskPage.DataStoreFindings,
  AlwaysAskPage.DataStoreOwners,
  AlwaysAskPage.DataStoreSettings,
  AlwaysAskPage.DataStore,
];

const DATA_STORE_TABLE_NAME: string = "DataStore";

// Whether a table has a column, so a read never selects one it has not.
function hasColumn(tableName: string, column: string): boolean {
  const route: RecordRoute | null = findRouteOfTable(tableName);

  return Boolean(
    route && new route.ModelClass().getTableColumnMetadata(column),
  );
}

/*
 * The page where the person makes the change, as the action's card opens
 * it: an issue's by its id, a finding's store's findings, a store's owners
 * or settings, the settings of each kind of rule, a playbook. Read as the
 * caller; null when it cannot be, and the refusal then names the product.
 */
async function readPageUrl(data: {
  write: RecordWrite;
  found: AlwaysAskWriteFound;
  credential: McpCredential;
  read: ApiRead;
}): Promise<string | null> {
  const page: AlwaysAskPage = data.found.record.page;
  const isStore: boolean = data.write.tableName === DATA_STORE_TABLE_NAME;
  // A store's own write names it; any other record names its store.
  const needsStoreId: boolean =
    STORE_PAGES.includes(page) &&
    !isStore &&
    hasColumn(data.write.tableName, "dataStoreId");

  const record: JSONObject | null =
    data.write.id &&
    (needsStoreId || data.credential.type !== McpCredentialType.OAuth)
      ? await readRecord({
          read: data.read,
          tableName: data.write.tableName,
          id: data.write.id,
          columns: needsStoreId ? ["projectId", "dataStoreId"] : ["projectId"],
        })
      : null;

  const projectId: string | null = await readProjectId({
    read: data.read,
    credential: data.credential,
    record,
  });

  if (!projectId) {
    return null;
  }

  const dataStoreId: string | null = isStore
    ? data.write.id || null
    : readId(record?.["dataStoreId"]) ||
      readId(data.write.data?.["dataStoreId"]);

  const target: AIChatCitationTarget | null = getAlwaysAskPageTarget({
    page,
    recordId: data.write.id,
    dataStoreId,
  });

  return target
    ? getDataSecurityPageUrl({ projectId: new ObjectID(projectId), target })
    : null;
}

/*
 * Whether a change asked about only where something holds is asked about
 * in this project: read as the caller, as Ask AI's card reads it - true
 * where it holds, and where it cannot be read or judged.
 */
async function isAskedHere(data: {
  condition: AlwaysAskCondition;
  read: ApiRead;
}): Promise<boolean> {
  switch (data.condition) {
    case AlwaysAskCondition.CriticalIssuesPage: {
      try {
        const rows: Array<JSONObject> = readRows(
          await data.read("/api/data-security-setting/get-list", {
            query: {},
            select: {
              raiseAlertsForCriticalIssues: true,
              declareIncidentsForCriticalIssues: true,
            },
            skip: 0,
            limit: 1,
          }),
        );

        // No setting: Data Security pages nobody yet, as Ask AI reads it.
        return doCriticalIssuesPage(
          rows[0] as
            | {
                raiseAlertsForCriticalIssues?: boolean;
                declareIncidentsForCriticalIssues?: boolean;
              }
            | undefined,
        );
      } catch {
        return true;
      }
    }
    /*
     * What reads an attribute a scrub would hide is Scrub It's to read
     * (DataSecurityButtons.getScrubImpact); a rule written as a record is
     * not checked here, so it asks.
     */
    case AlwaysAskCondition.SomethingReadsWhatItHides:
    default:
      return true;
  }
}

/*
 * What a resource's tools refuse because a person is asked first, for
 * oneuptime_describe_resource: each change by its name and the write that
 * makes it. Null for a resource with none - nearly every one.
 */
export function describeWritesThatAskAPerson(tableName: string): string | null {
  const found: Array<AlwaysAskWriteFound> =
    getAlwaysAskChangesOfTable(tableName);

  if (found.length === 0) {
    return null;
  }

  const changes: Array<string> = found.map(
    (each: AlwaysAskWriteFound): string => {
      return `${each.change.name}: ${each.record.written}`;
    },
  );

  return `OneUptime asks a person before these in every mode, so its tools refuse them and name the page in OneUptime where the person makes the change; do not retry one or make it another way. ${changes.join(". ")}. Every other write is made as usual.`;
}

/*
 * Refuses a write that makes a change OneUptime asks a person before, in
 * every mode: with why, as the card says it, and the page where the person
 * makes it. Resolves for any other write, which is sent as it always was.
 */
export async function refuseWriteThatAsksAPerson(data: {
  write: RecordWrite;
  // The tool the agent called, as the refusal names it.
  toolName?: string | undefined;
  credential: McpCredentialInput;
  read: ApiRead;
}): Promise<void> {
  /*
   * Judged first as if it could make what it compares with the record: a
   * write that could make no change even then - nearly every write - is
   * sent at once, with nothing read for it.
   */
  let found: AlwaysAskWriteFound | null = findAlwaysAskChangeOfWrite(
    data.write,
  );

  if (!found) {
    return;
  }

  /*
   * A change judged against what the record holds now - a list it adds
   * to, steps it changes - reads the record as the caller and is judged
   * again. A record that cannot be read is judged as before: a change that
   * could not be told from an ordinary edit is refused, never made unseen.
   */
  if (
    data.write.write !== AlwaysAskWrite.Create &&
    getComparedColumns(data.write.tableName).length > 0
  ) {
    const stored: JSONObject | null = await readRecord({
      read: data.read,
      tableName: data.write.tableName,
      id: data.write.id,
      columns: getComparedColumns(data.write.tableName),
    });

    found = findAlwaysAskChangeOfWrite(data.write, stored);

    if (!found) {
      return;
    }
  }

  if (
    found.change.onlyWhen &&
    !(await isAskedHere({ condition: found.change.onlyWhen, read: data.read }))
  ) {
    return;
  }

  const pageUrl: string | null = await readPageUrl({
    write: data.write,
    found,
    credential: McpCredentialUtil.from(data.credential),
    read: data.read,
  });

  throw new AsksAPersonFirstError(
    getAsksInEveryModeRefusal({
      action: data.toolName || "this call",
      // The card's own sentence, in English, as the Data Security tools' refusal says it.
      reason: found.change.asksBecause,
      pageUrl,
      product: found.change.product,
    }),
  );
}
