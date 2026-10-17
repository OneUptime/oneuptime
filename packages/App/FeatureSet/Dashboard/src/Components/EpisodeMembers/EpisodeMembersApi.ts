import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Project from "Common/Models/DatabaseModels/Project";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import Includes from "Common/Types/BaseDatabase/Includes";
import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import MultiSearch from "Common/Types/BaseDatabase/MultiSearch";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import Sort from "Common/Types/BaseDatabase/Sort";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Black } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import EpisodeMembersAdd, {
  EpisodeMembersAddResult,
  MAX_EPISODE_MEMBERS_PER_ADD,
} from "Common/Types/Episode/EpisodeMembersAdd";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { RecordForNewEpisode } from "Common/Utils/Episode/EpisodeFromRecords";
import { SeverityForMapping } from "Common/Utils/Incident/IncidentFromAlerts";
import {
  EpisodeMemberKind,
  EpisodeMemberKindConfig,
} from "./EpisodeMemberKinds";

/*
 * What the dialogs that add incidents or alerts to an episode read and write
 * (EpisodeMembersAdd). Plain functions over ModelAPI and API, so the dialogs
 * stay about what they draw and these can be tested on their own.
 */

// How many incidents or alerts the add dialog lists before a search.
export const EPISODE_MEMBER_PICKER_LIMIT: number = 50;

// How many open episodes, and then resolved ones, the episode picker lists.
export const OPEN_EPISODE_PICKER_LIMIT: number = 50;
export const RESOLVED_EPISODE_PICKER_LIMIT: number = 20;

/*
 * How many member ids the add dialog reads to leave the episode's own out of
 * the list: one request's worth, as FetchEpisodeMembers reads them.
 */
export const EPISODE_MEMBER_IDS_LIMIT: number = 5000;

// The key a search rides on, as the tables' search sends it.
const SEARCH_KEY: string = "_multiFieldSearch";

export interface EpisodePickerPill {
  name: string;
  color: Color;
}

// An incident or alert the add dialog offers.
export interface EpisodeRecordRow {
  id: string;
  // "ALT-63", "#63", or nothing when the number is unknown.
  number: string | undefined;
  title: string;
  isPrivate: boolean;
  state: EpisodePickerPill | undefined;
  severity: EpisodePickerPill | undefined;
  // When it happened: an alert's creation, an incident's declaration.
  date: Date | undefined;
  /*
   * The latest other episode it is in (see EpisodeMembershipReference),
   * when it is in one.
   */
  otherEpisodeId: string | undefined;
}

// An episode the "Add to Existing Episode" dialog offers.
export interface EpisodeRow {
  id: string;
  number: string | undefined;
  title: string;
  isPrivate: boolean;
  state: EpisodePickerPill | undefined;
  severity: EpisodePickerPill | undefined;
  // How many incidents or alerts it holds.
  memberCount: number | undefined;
  /*
   * When it started, or - once resolved - when it was resolved: the time
   * the picker's "Ongoing" and "Recently Resolved" sections are sorted by.
   */
  date: Date | undefined;
  isResolved: boolean;
}

// How an episode is named in a note: its number, and its title for a hover.
export interface EpisodeLabel {
  number: string | undefined;
  title: string | undefined;
}

export interface EpisodeRows {
  open: Array<EpisodeRow>;
  resolved: Array<EpisodeRow>;
}

export interface CreatedEpisode {
  id: string;
  number: string | undefined;
}

type ReadFunction = (model: BaseModel, field: string) => unknown;

const read: ReadFunction = (model: BaseModel, field: string): unknown => {
  return (model as unknown as Record<string, unknown>)[field];
};

const readId: (value: unknown) => string | undefined = (
  value: unknown,
): string | undefined => {
  if (value instanceof ObjectID || typeof value === "string") {
    return EpisodeMembersAdd.normalizeId(value) || undefined;
  }

  return undefined;
};

const readDate: (value: unknown) => Date | undefined = (
  value: unknown,
): Date | undefined => {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === "string" && value) {
    const date: Date = new Date(value);
    return isNaN(date.getTime()) ? undefined : date;
  }

  return undefined;
};

/*
 * "ALT-63" (the number with the project's prefix), "#63", or nothing when
 * the number is unknown - as the members card numbers its rows.
 */
export const getNumberLabel: (
  numberWithPrefix: unknown,
  number: unknown,
) => string | undefined = (
  numberWithPrefix: unknown,
  number: unknown,
): string | undefined => {
  if (typeof numberWithPrefix === "string" && numberWithPrefix.trim()) {
    return numberWithPrefix.trim();
  }

  if (typeof number === "number") {
    return `#${number}`;
  }

  return undefined;
};

/*
 * A state or severity as a pill. A relation that is missing shows nothing;
 * one that lost its name or colour shows "Unknown" / black, as the members
 * card does.
 */
export const getPill: (value: unknown) => EpisodePickerPill | undefined = (
  value: unknown,
): EpisodePickerPill | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const relation: { name?: unknown; color?: unknown } = value as {
    name?: unknown;
    color?: unknown;
  };

  return {
    name:
      typeof relation.name === "string" && relation.name
        ? relation.name
        : "Unknown",
    color: relation.color instanceof Color ? relation.color : Black,
  };
};

/*
 * What a person types to find one: a title, or a number with or without
 * its prefix ("ALT-12", "12", "#12").
 */
export const getSearchText: (text: string) => string = (
  text: string,
): string => {
  const trimmed: string = text.trim();

  return trimmed.startsWith("#") ? trimmed.slice(1).trim() : trimmed;
};

const addSearch: (
  query: Record<string, unknown>,
  fields: Array<string>,
  text: string,
) => void = (
  query: Record<string, unknown>,
  fields: Array<string>,
  text: string,
): void => {
  const searchText: string = getSearchText(text);

  if (searchText) {
    query[SEARCH_KEY] = new MultiSearch({ fields: fields, value: searchText });
  }
};

export const getRecordRow: (
  config: EpisodeMemberKindConfig,
  record: BaseModel,
) => EpisodeRecordRow = (
  config: EpisodeMemberKindConfig,
  record: BaseModel,
): EpisodeRecordRow => {
  const title: unknown = read(record, "title");

  return {
    id: readId(record._id) || "",
    number: getNumberLabel(
      read(record, config.recordNumberWithPrefixField),
      read(record, config.recordNumberField),
    ),
    title: typeof title === "string" ? title : "",
    isPrivate: read(record, "isPrivate") === true,
    state: getPill(read(record, config.recordStateField)),
    severity: getPill(read(record, config.recordSeverityField)),
    date:
      readDate(read(record, config.recordDateField)) ||
      readDate(read(record, "createdAt")),
    otherEpisodeId: readId(read(record, config.recordEpisodeIdField)),
  };
};

export const getEpisodeRow: (
  config: EpisodeMemberKindConfig,
  episode: BaseModel,
) => EpisodeRow = (
  config: EpisodeMemberKindConfig,
  episode: BaseModel,
): EpisodeRow => {
  const title: unknown = read(episode, "title");
  const count: unknown = read(episode, config.episodeCountField);
  const resolvedAt: Date | undefined = readDate(read(episode, "resolvedAt"));

  return {
    id: readId(episode._id) || "",
    number: getNumberLabel(
      read(episode, "episodeNumberWithPrefix"),
      read(episode, "episodeNumber"),
    ),
    title: typeof title === "string" ? title : "",
    isPrivate: read(episode, "isPrivate") === true,
    state: getPill(read(episode, config.episodeStateField)),
    severity: getPill(read(episode, config.episodeSeverityField)),
    memberCount: typeof count === "number" ? count : undefined,
    date: resolvedAt || readDate(read(episode, "createdAt")),
    isResolved: Boolean(read(episode, "resolvedAt")),
  };
};

/*
 * The incidents or alerts the add dialog offers: newest first, those already
 * in the episode left out (`excludedIds`), narrowed by what was typed. Read
 * as the person, so what they cannot see is never offered. With
 * `onlyOutsideEpisodes`, only the ones that are in no episode at all - what
 * a project that allows one in only one episode can still add.
 */
export async function fetchRecordRows(data: {
  config: EpisodeMemberKindConfig;
  searchText: string;
  excludedIds: Array<string>;
  limit?: number | undefined;
  onlyOutsideEpisodes?: boolean | undefined;
}): Promise<Array<EpisodeRecordRow>> {
  const config: EpisodeMemberKindConfig = data.config;
  const query: Record<string, unknown> = {};

  if (data.excludedIds.length > 0) {
    query["_id"] = new IncludesNone(data.excludedIds);
  }

  if (data.onlyOutsideEpisodes) {
    query[config.recordEpisodeIdField] = new IsNull();
  }

  addSearch(
    query,
    ["title", config.recordNumberWithPrefixField, config.recordNumberField],
    data.searchText,
  );

  const result: ListResult<BaseModel> = await ModelAPI.getList<BaseModel>({
    modelType: config.recordModelType,
    query: query as Query<BaseModel>,
    limit: data.limit || EPISODE_MEMBER_PICKER_LIMIT,
    skip: 0,
    select: {
      _id: true,
      title: true,
      isPrivate: true,
      createdAt: true,
      [config.recordDateField]: true,
      [config.recordNumberField]: true,
      [config.recordNumberWithPrefixField]: true,
      [config.recordEpisodeIdField]: true,
      [config.recordStateField]: {
        _id: true,
        name: true,
        color: true,
      },
      [config.recordSeverityField]: {
        _id: true,
        name: true,
        color: true,
      },
    } as Select<BaseModel>,
    sort: {
      [config.recordDateField]: SortOrder.Descending,
    } as Sort<BaseModel>,
  });

  return result.data
    .map((record: BaseModel): EpisodeRecordRow => {
      return getRecordRow(config, record);
    })
    .filter((row: EpisodeRecordRow): boolean => {
      return Boolean(row.id);
    });
}

/*
 * How the episodes these ids name are called, read as the person: an
 * episode they cannot see (a private one) is left out, so a note about it
 * never names it.
 */
export async function fetchEpisodeLabels(data: {
  config: EpisodeMemberKindConfig;
  episodeIds: Array<string>;
}): Promise<Map<string, EpisodeLabel>> {
  const labels: Map<string, EpisodeLabel> = new Map();
  const episodeIds: Array<string> = Array.from(new Set(data.episodeIds));

  if (episodeIds.length === 0) {
    return labels;
  }

  const result: ListResult<BaseModel> = await ModelAPI.getList<BaseModel>({
    modelType: data.config.episodeModelType,
    query: {
      _id: new Includes(episodeIds),
    } as Query<BaseModel>,
    limit: episodeIds.length,
    skip: 0,
    select: {
      _id: true,
      title: true,
      episodeNumber: true,
      episodeNumberWithPrefix: true,
    } as Select<BaseModel>,
    sort: {},
  });

  for (const episode of result.data) {
    const id: string | undefined = readId(episode._id);
    const title: unknown = read(episode, "title");

    if (id) {
      labels.set(id, {
        number: getNumberLabel(
          read(episode, "episodeNumberWithPrefix"),
          read(episode, "episodeNumber"),
        ),
        title: typeof title === "string" ? title : undefined,
      });
    }
  }

  return labels;
}

/*
 * The episodes "Add to Existing Episode" offers: the open ones, newest
 * first, then the most recently resolved - narrowed by what was typed. Read
 * as the person.
 */
export async function fetchEpisodeRows(data: {
  config: EpisodeMemberKindConfig;
  searchText: string;
}): Promise<EpisodeRows> {
  const config: EpisodeMemberKindConfig = data.config;

  const select: Select<BaseModel> = {
    _id: true,
    title: true,
    isPrivate: true,
    createdAt: true,
    resolvedAt: true,
    episodeNumber: true,
    episodeNumberWithPrefix: true,
    [config.episodeCountField]: true,
    [config.episodeStateField]: {
      _id: true,
      name: true,
      color: true,
    },
    [config.episodeSeverityField]: {
      _id: true,
      name: true,
      color: true,
    },
  } as Select<BaseModel>;

  const openQuery: Record<string, unknown> = { resolvedAt: new IsNull() };
  const resolvedQuery: Record<string, unknown> = {
    resolvedAt: new NotNull(),
  };

  for (const query of [openQuery, resolvedQuery]) {
    addSearch(
      query,
      ["title", "episodeNumberWithPrefix", "episodeNumber"],
      data.searchText,
    );
  }

  const [open, resolved] = await Promise.all([
    ModelAPI.getList<BaseModel>({
      modelType: config.episodeModelType,
      query: openQuery as Query<BaseModel>,
      limit: OPEN_EPISODE_PICKER_LIMIT,
      skip: 0,
      select: select,
      sort: { createdAt: SortOrder.Descending } as Sort<BaseModel>,
    }),
    ModelAPI.getList<BaseModel>({
      modelType: config.episodeModelType,
      query: resolvedQuery as Query<BaseModel>,
      limit: RESOLVED_EPISODE_PICKER_LIMIT,
      skip: 0,
      select: select,
      sort: { resolvedAt: SortOrder.Descending } as Sort<BaseModel>,
    }),
  ]);

  const toRows: (list: ListResult<BaseModel>) => Array<EpisodeRow> = (
    list: ListResult<BaseModel>,
  ): Array<EpisodeRow> => {
    return list.data
      .map((episode: BaseModel): EpisodeRow => {
        return getEpisodeRow(config, episode);
      })
      .filter((row: EpisodeRow): boolean => {
        return Boolean(row.id);
      });
  };

  return {
    open: toRows(open),
    resolved: toRows(resolved),
  };
}

/*
 * The ids of what an episode holds, from its membership rows (an incident's
 * own episode column names only the latest episode it is in - see
 * EpisodeMembers.ts), so the add dialog can leave them out.
 */
export async function fetchEpisodeMemberIds(data: {
  config: EpisodeMemberKindConfig;
  episodeId: ObjectID;
}): Promise<Array<string>> {
  const config: EpisodeMemberKindConfig = data.config;

  const result: ListResult<BaseModel> = await ModelAPI.getList<BaseModel>({
    modelType: config.membershipModelType,
    query: {
      [config.membershipEpisodeIdField]: data.episodeId,
    } as Query<BaseModel>,
    limit: EPISODE_MEMBER_IDS_LIMIT,
    skip: 0,
    select: {
      [config.membershipRecordIdField]: true,
    } as Select<BaseModel>,
    sort: {
      createdAt: SortOrder.Ascending,
    } as Sort<BaseModel>,
  });

  const ids: Set<string> = new Set();

  for (const membership of result.data) {
    const id: string | undefined = readId(
      read(membership, config.membershipRecordIdField),
    );

    if (id) {
      ids.add(id);
    }
  }

  return Array.from(ids);
}

/*
 * The selected incidents or alerts as "Add to New Episode" starts from them:
 * their titles, privacy and severities, and the latest other episode each
 * is in. Read fresh, as the person, rather than taken from the list's rows:
 * a "Select all" selection holds only the columns the list shows.
 */
export async function fetchRecordsForNewEpisode(data: {
  config: EpisodeMemberKindConfig;
  ids: Array<string>;
}): Promise<Array<RecordForNewEpisode & { otherEpisodeId?: string }>> {
  const config: EpisodeMemberKindConfig = data.config;

  if (data.ids.length === 0) {
    return [];
  }

  const result: ListResult<BaseModel> = await ModelAPI.getList<BaseModel>({
    modelType: config.recordModelType,
    query: {
      _id: new Includes(data.ids),
    } as Query<BaseModel>,
    limit: Math.min(data.ids.length, LIMIT_PER_PROJECT),
    skip: 0,
    select: {
      _id: true,
      title: true,
      isPrivate: true,
      [config.recordSeverityIdField]: true,
      [config.recordEpisodeIdField]: true,
    } as Select<BaseModel>,
    sort: {},
  });

  const byId: Map<string, BaseModel> = new Map();

  for (const record of result.data) {
    const id: string | undefined = readId(record._id);

    if (id) {
      byId.set(id, record);
    }
  }

  // In the order they were selected.
  const records: Array<RecordForNewEpisode & { otherEpisodeId?: string }> = [];

  for (const id of data.ids) {
    const record: BaseModel | undefined = byId.get(
      EpisodeMembersAdd.normalizeId(id),
    );

    if (!record) {
      continue;
    }

    const title: unknown = read(record, "title");
    const severityId: string | undefined = readId(
      read(record, config.recordSeverityIdField),
    );
    const otherEpisodeId: string | undefined = readId(
      read(record, config.recordEpisodeIdField),
    );

    records.push({
      id: EpisodeMembersAdd.normalizeId(id),
      title: typeof title === "string" ? title : undefined,
      isPrivate: read(record, "isPrivate") === true,
      ...(severityId ? { severityId: severityId } : {}),
      ...(otherEpisodeId ? { otherEpisodeId: otherEpisodeId } : {}),
    });
  }

  return records;
}

// The project's severities, most severe first, for the new episode's picker.
export async function fetchSeverities(data: {
  config: EpisodeMemberKindConfig;
}): Promise<Array<SeverityForMapping & { color?: Color | undefined }>> {
  const result: ListResult<BaseModel> = await ModelAPI.getList<BaseModel>({
    modelType: data.config.severityModelType,
    query: {},
    limit: LIMIT_PER_PROJECT,
    skip: 0,
    select: {
      _id: true,
      name: true,
      color: true,
      order: true,
    } as Select<BaseModel>,
    sort: {
      order: SortOrder.Ascending,
    } as Sort<BaseModel>,
  });

  return result.data
    .map((severity: BaseModel): SeverityForMapping & { color?: Color } => {
      const name: unknown = read(severity, "name");
      const order: unknown = read(severity, "order");
      const color: unknown = read(severity, "color");

      return {
        id: readId(severity._id) || "",
        ...(typeof name === "string" ? { name: name } : {}),
        ...(typeof order === "number" ? { order: order } : {}),
        ...(color instanceof Color ? { color: color } : {}),
      };
    })
    .filter((severity: SeverityForMapping): boolean => {
      return Boolean(severity.id);
    });
}

/*
 * Whether the project allows an incident (or alert) in only one episode
 * (EpisodeSingleMembership): its switch on Incidents -> Settings -> Episodes
 * (or Alerts'). Read fresh each time a dialog opens, so a switch flipped a
 * moment ago counts. Every project member may read it. When it cannot be
 * read, the dialogs act as they always did - several episodes allowed - and
 * the server, which decides, says why one was not added.
 */
export async function fetchIsLimitedToOneEpisode(data: {
  config: EpisodeMemberKindConfig;
}): Promise<boolean> {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!projectId) {
    return false;
  }

  const column: string = data.config.singleMembershipColumn;

  try {
    const project: Project | null = await ModelAPI.getItem<Project>({
      modelType: Project,
      id: projectId,
      select: {
        [column]: true,
      } as Select<Project>,
    });

    return (
      (project as unknown as Record<string, unknown> | null)?.[column] === true
    );
  } catch {
    return false;
  }
}

/*
 * Adds the incidents or alerts to an episode, in one request
 * (EpisodeMembersAdd): what was added, what was in it already, and what was
 * not added and why. The route is written out rather than read from
 * EpisodeMembersAdd so the tenant-header sweep
 * (App/Tests/Dashboard/ProjectScopedApiTenantHeader.test.ts) can see which
 * route the call reaches; a test pins the two together.
 */
export async function addToEpisode(data: {
  config: EpisodeMemberKindConfig;
  episodeId: string;
  ids: Array<string>;
}): Promise<EpisodeMembersAddResult> {
  if (data.ids.length > MAX_EPISODE_MEMBERS_PER_ADD) {
    throw new Error(
      `Select ${MAX_EPISODE_MEMBERS_PER_ADD} or fewer to add them to an episode.`,
    );
  }

  const url: URL = URL.fromString(APP_API_URL.toString()).addRoute(
    data.config.kind === EpisodeMemberKind.Alert
      ? "/alert-episode-member/add-alerts"
      : "/incident-episode-member/add-incidents",
  );

  const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post(
    {
      url: url,
      data: {
        [data.config.episodeIdKey]: data.episodeId,
        [data.config.idsKey]: data.ids,
      },
      headers: ModelAPI.getCommonHeaders(),
    },
  );

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return EpisodeMembersAdd.fromJSON(response.data as JSONObject);
}

/*
 * Creates an episode with the incidents or alerts it is for, in one request:
 * the episode's own create, carrying their ids (EpisodeMembersAdd). The
 * server checks them before the episode exists and adds them once it does.
 */
export async function createEpisodeWith(data: {
  config: EpisodeMemberKindConfig;
  title: string;
  severityId: string | undefined;
  ids: Array<string>;
}): Promise<CreatedEpisode> {
  const config: EpisodeMemberKindConfig = data.config;
  const episode: BaseModel = new config.episodeModelType();
  const values: Record<string, unknown> = episode as unknown as Record<
    string,
    unknown
  >;

  values["title"] = data.title.trim();
  values["isManuallyCreated"] = true;

  if (data.severityId) {
    values[config.episodeSeverityIdField] = new ObjectID(data.severityId);
  }

  const response: HTTPResponse<
    JSONObject | Array<JSONObject> | BaseModel | Array<BaseModel>
  > = await ModelAPI.create<BaseModel>({
    model: episode,
    modelType: config.episodeModelType,
    miscDataProps: {
      [config.idsToAddKey]: data.ids,
    },
  });

  const created: JSONObject = (response.data || {}) as JSONObject;

  return {
    id: readId(created["_id"]) || "",
    number: getNumberLabel(
      created["episodeNumberWithPrefix"],
      created["episodeNumber"],
    ),
  };
}
