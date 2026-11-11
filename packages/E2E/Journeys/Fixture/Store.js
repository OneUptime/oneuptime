/*
 * The journeys' server, in memory: every table of a project made a minute
 * ago, and the ModelAPI / AnalyticsModelAPI / API boundary the Dashboard and
 * the Admin Dashboard read and write through, answered from it.
 *
 * A table nobody wrote to is empty, as a new project's is, so a page the
 * journeys pass through reads what a newcomer's reads: nothing. A write is
 * kept, and every later read of its table finds it, so a journey that makes
 * something sees it where the product shows it. Queries are evaluated as the
 * database would for the operators the pages use (equality, Includes, IsNull,
 * NotNull, NotEqual, Search, nested relation filters), and a relation a read
 * selects is joined from its table, as the API does. An operator not modelled
 * here matches.
 *
 * Nothing is timed and nothing is random: ids are counted, and every record
 * is made at the fixture's pinned instant (NOW), so two runs of a journey
 * read the same pages.
 */
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Includes from "Common/Types/BaseDatabase/Includes";
import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import EqualTo from "Common/Types/BaseDatabase/EqualTo";
import Search from "Common/Types/BaseDatabase/Search";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";

// The instant every journey runs at; the spec pins the browser's clock to it.
export const NOW = new Date("2026-11-11T10:00:00.000Z");

export function serialize(value) {
  return JSON.parse(JSON.stringify(value === undefined ? null : value));
}

export function ok(data) {
  return new HTTPResponse(200, serialize(data), {});
}

export function fail(statusCode, message) {
  return new HTTPErrorResponse(statusCode, { message }, {});
}

function idOf(value) {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "object" && "_id" in value && value._id) {
    return String(value._id).toLowerCase();
  }
  return String(value).toLowerCase();
}

function comparable(value) {
  if (value === null || value === undefined) {
    return value;
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "object" && value.constructor !== Object) {
    return value.toString();
  }
  return value;
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    (value.constructor === Object || value.constructor === undefined)
  );
}

function isEmpty(value) {
  return (
    value === null ||
    value === undefined ||
    (Array.isArray(value) && value.length === 0)
  );
}

function sameValue(actual, expected) {
  if (Array.isArray(actual)) {
    return actual.some((item) => {
      return sameValue(item, expected);
    });
  }
  if (actual && typeof actual === "object" && "_id" in actual) {
    return idOf(actual) === idOf(expected);
  }
  const left = comparable(actual);
  const right = comparable(expected);
  if (typeof left === "string" && typeof right === "string") {
    return left.toLowerCase() === right.toLowerCase();
  }
  return String(left) === String(right);
}

export function createStore(options) {
  const projectId = options.projectId;
  const tables = new Map();
  const log = options.log;
  let counter = 0;

  function tableName(modelType) {
    return String(new modelType().tableName);
  }

  function table(modelType) {
    const name = tableName(modelType);
    if (!tables.has(name)) {
      tables.set(name, { modelType, records: [] });
    }
    return tables.get(name).records;
  }

  // Ids are counted, never random: 90000000-0000-4000-8000-000000000001, ...
  function nextId() {
    counter += 1;
    return `90000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
  }

  function hasColumn(modelType, column) {
    try {
      return Boolean(new modelType().getTableColumnMetadata(column));
    } catch {
      return false;
    }
  }

  // A record as the database keeps it: a plain object of its columns.
  function insert(modelType, record) {
    const full = {
      _id: record._id ? String(record._id) : nextId(),
      createdAt: NOW,
      updatedAt: NOW,
      ...(hasColumn(modelType, "projectId") ? { projectId } : {}),
      ...(hasColumn(modelType, "isArchived") ? { isArchived: false } : {}),
      ...record,
    };
    full._id = String(full._id);
    table(modelType).push(full);
    return full;
  }

  function find(modelType, id) {
    return table(modelType).find((record) => {
      return idOf(record._id) === idOf(id);
    });
  }

  function relationOf(modelType, column) {
    try {
      const metadata = new modelType().getTableColumnMetadata(column);
      if (metadata && metadata.modelType) {
        return metadata;
      }
    } catch {
      // Not a column.
    }
    return null;
  }

  /*
   * A relation value as the API joins it: the related record from its
   * table, found by the id column beside it (monitor by monitorId) or by
   * the ids a form sent ({ _id } in a many-to-many list).
   */
  function joined(modelType, record, column) {
    const relation = relationOf(modelType, column);
    if (!relation) {
      return record[column];
    }
    const related = relation.modelType;
    const value = record[column];
    if (Array.isArray(value)) {
      return value
        .map((item) => {
          return find(related, idOf(item)) || item;
        })
        .filter(Boolean);
    }
    if (value && typeof value === "object" && idOf(value)) {
      return find(related, idOf(value)) || value;
    }
    if (relation.manyToOneRelationColumn) {
      const id = record[relation.manyToOneRelationColumn];
      if (id) {
        return find(related, id) || undefined;
      }
    }
    return value;
  }

  function matchesCondition(modelType, record, key, condition) {
    const actual = joined(modelType, record, key);
    if (condition instanceof Includes) {
      const values = condition.values.map(idOf);
      if (Array.isArray(actual)) {
        return actual.some((item) => {
          return values.includes(idOf(item));
        });
      }
      return values.includes(idOf(actual));
    }
    if (condition instanceof IncludesNone) {
      const values = condition.values.map(idOf);
      if (Array.isArray(actual)) {
        return !actual.some((item) => {
          return values.includes(idOf(item));
        });
      }
      return !values.includes(idOf(actual));
    }
    if (condition instanceof IsNull) {
      return isEmpty(actual);
    }
    if (condition instanceof NotNull) {
      return !isEmpty(actual);
    }
    if (condition instanceof NotEqual) {
      return !sameValue(actual, condition.value);
    }
    if (condition instanceof EqualTo) {
      return sameValue(actual, condition.value);
    }
    if (condition instanceof Search) {
      return String(actual ?? "")
        .toLowerCase()
        .includes(String(condition.value).toLowerCase());
    }
    if (condition instanceof ObjectID || condition instanceof Date) {
      return sameValue(actual, condition);
    }
    if (isPlainObject(condition)) {
      // A nested relation filter: { monitor: { _id: "..." } }.
      const relation = relationOf(modelType, key);
      if (!relation) {
        return true;
      }
      const items = Array.isArray(actual) ? actual : actual ? [actual] : [];
      return items.some((item) => {
        return matches(relation.modelType, item, condition);
      });
    }
    if (condition !== null && typeof condition === "object") {
      // An operator this fixture does not model (GreaterThan, InBetween...).
      return true;
    }
    if (typeof condition === "boolean") {
      return Boolean(actual) === condition;
    }
    return sameValue(actual, condition);
  }

  function matches(modelType, record, query) {
    for (const [key, condition] of Object.entries(query || {})) {
      if (condition === undefined || key === "projectId") {
        continue;
      }
      if (!matchesCondition(modelType, record, key, condition)) {
        return false;
      }
    }
    return true;
  }

  function sortRecords(records, sort) {
    const entries = Object.entries(sort || {});
    if (entries.length === 0) {
      return records;
    }
    return [...records].sort((left, right) => {
      for (const [key, order] of entries) {
        const a = comparable(left[key]);
        const b = comparable(right[key]);
        if (a === b) {
          continue;
        }
        const direction = order === SortOrder.Descending ? -1 : 1;
        if (a === undefined || a === null) {
          return direction;
        }
        if (b === undefined || b === null) {
          return -direction;
        }
        return a > b ? direction : -direction;
      }
      return 0;
    });
  }

  // A record as a read gives it: a fresh model, with its relations joined.
  function toModel(modelType, record, select) {
    const out = { ...record };
    for (const column of Object.keys(select || {})) {
      const value = joined(modelType, record, column);
      if (value !== undefined) {
        const relation = relationOf(modelType, column);
        if (relation && value && typeof value === "object") {
          out[column] = Array.isArray(value)
            ? value.map((item) => {
                return toModel(relation.modelType, item, select[column]);
              })
            : toModel(relation.modelType, value, select[column]);
        } else {
          out[column] = value;
        }
      }
    }
    if (out._id) {
      out._id = String(out._id);
    }
    return Object.assign(new modelType(), out);
  }

  function list(modelType, query, sort) {
    return sortRecords(
      table(modelType).filter((record) => {
        return matches(modelType, record, query);
      }),
      sort,
    );
  }

  /*
   * A write as the database keeps it: the model's columns as the Dashboard
   * sent them (BaseModel.toJSON, read back), so a relation the form named
   * by id keeps its id.
   */
  function columnsOf(model, modelType) {
    const json = BaseModel.toJSON(model, modelType);
    const record = BaseModel.fromJSONObject(json, modelType);
    const out = {};
    for (const [key, value] of Object.entries(record)) {
      if (value !== undefined && typeof value !== "function") {
        out[key] = value;
      }
    }
    return out;
  }

  return {
    NOW,
    projectId,
    tables,
    tableName,
    table,
    insert,
    find,
    list,
    toModel,
    columnsOf,
    nextId,
    log,
  };
}

/*
 * The ModelAPI and AnalyticsModelAPI boundary, answered from the store.
 * `hooks[tableName]` runs after a create, as a service's onCreateSuccess
 * does (a new monitor's status, an on-call policy's rules).
 */
export function installModelApi(ModelAPI, store, hooks) {
  const writes = store.log.writes;

  ModelAPI.getList = async (options) => {
    const records = store.list(options.modelType, options.query, options.sort);
    const skip = Number(options.skip || 0);
    const limit = Number(options.limit || 10);
    store.log.reads.push(`list ${store.tableName(options.modelType)}`);
    return {
      data: records.slice(skip, skip + limit).map((record) => {
        return store.toModel(options.modelType, record, options.select);
      }),
      count: records.length,
      skip,
      limit,
    };
  };

  ModelAPI.count = async (options) => {
    store.log.reads.push(`count ${store.tableName(options.modelType)}`);
    return store.list(options.modelType, options.query).length;
  };
  ModelAPI.getCount = ModelAPI.count;

  ModelAPI.getItem = async (options) => {
    store.log.reads.push(`item ${store.tableName(options.modelType)}`);
    const record = store.find(options.modelType, options.id);
    return record
      ? store.toModel(options.modelType, record, options.select)
      : null;
  };

  ModelAPI.createOrUpdate = async (options) => {
    const modelType = options.modelType;
    const name = store.tableName(modelType);
    const columns = store.columnsOf(options.model, modelType);
    const existing = columns._id ? store.find(modelType, columns._id) : null;
    let record;

    if (existing) {
      Object.assign(existing, columns, { updatedAt: NOW });
      record = existing;
      writes.push({ kind: "update", table: name, data: serialize(columns) });
    } else {
      record = store.insert(modelType, columns);
      writes.push({
        kind: "create",
        table: name,
        data: serialize(record),
        misc: serialize(options.miscDataProps || {}),
      });
      if (hooks[name]) {
        await hooks[name](record, options.miscDataProps || {});
      }
    }

    const json = BaseModel.toJSON(store.toModel(modelType, record), modelType);
    const response = new HTTPResponse(200, json, {});
    response.data = BaseModel.fromJSONObject(json, modelType);
    return response;
  };

  ModelAPI.create = async (options) => {
    return ModelAPI.createOrUpdate(options);
  };

  ModelAPI.update = async (options) => {
    return ModelAPI.createOrUpdate(options);
  };

  ModelAPI.updateById = async (options) => {
    const name = store.tableName(options.modelType);
    const existing = store.find(options.modelType, options.id);
    const data = { ...(options.data || {}) };
    writes.push({
      kind: "update",
      table: name,
      id: String(options.id),
      data: serialize(data),
    });
    if (existing) {
      Object.assign(existing, data, { updatedAt: NOW });
    }
    return ok(existing ? serialize(existing) : {});
  };

  ModelAPI.deleteItem = async (options) => {
    const name = store.tableName(options.modelType);
    const records = store.table(options.modelType);
    const index = records.findIndex((record) => {
      return idOf(record._id) === idOf(options.id);
    });
    writes.push({ kind: "delete", table: name, id: String(options.id) });
    if (index !== -1) {
      records.splice(index, 1);
    }
  };
}

/*
 * Telemetry (logs, metrics, traces, exceptions) is read through
 * AnalyticsModelAPI from ClickHouse: a new project has none.
 */
export function installAnalyticsModelApi(AnalyticsModelAPI, store) {
  AnalyticsModelAPI.getList = async (options) => {
    store.log.reads.push(`analytics ${String(new options.modelType().tableName)}`);
    return { data: [], count: 0, skip: 0, limit: Number(options.limit || 10) };
  };
  AnalyticsModelAPI.count = async () => {
    return 0;
  };
  AnalyticsModelAPI.getItem = async () => {
    return null;
  };
}

/*
 * Every other request (the API's own routes: limits, summaries, tests,
 * verification codes) goes to `routes`, a list of [method, path ending,
 * answer]; what none of them answers is logged and gets an empty answer, as
 * an endpoint over a new project's empty tables gives.
 */
export function installApi(apis, store, routes) {
  async function handle(method, options) {
    const url = new window.URL(options.url.toString());
    const body = serialize(options.data) || {};
    for (const [routeMethod, ending, answer] of routes) {
      const endingMatches =
        typeof ending === "string"
          ? url.pathname.endsWith(ending)
          : ending.test(url.pathname);
      if (routeMethod === method && endingMatches) {
        store.log.api.push({ method, path: url.pathname, body });
        return answer({ url, body, method });
      }
    }
    store.log.unhandled.push({ method, path: url.pathname });
    return ok({ data: [], count: 0 });
  }

  // The Dashboard's API and the base one under it (GlobalConfig reads that).
  for (const API of apis) {
    API.get = async (options) => {
      return handle("GET", options);
    };
    API.post = async (options) => {
      return handle("POST", options);
    };
    API.put = async (options) => {
      return handle("PUT", options);
    };
    API.patch = async (options) => {
      return handle("PATCH", options);
    };
    API.delete = async (options) => {
      return handle("DELETE", options);
    };
    API.fetch = async (options) => {
      return handle(String(options.method || "GET").toUpperCase(), options);
    };
  }
}

/*
 * The live connection (Common/UI/Utils/Realtime): there is no server to
 * hear from, so lists keep what they read, and nothing connects anywhere.
 */
export function silenceRealtime(Realtime) {
  const socket = {
    connected: false,
    io: { on() {}, off() {}, opts: {} },
    on() {
      return socket;
    },
    off() {
      return socket;
    },
    emit() {
      return socket;
    },
    connect() {
      return socket;
    },
    disconnect() {
      return socket;
    },
  };
  Realtime.socket = socket;
  Realtime.init = () => {};
}
