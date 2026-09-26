import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import {
  TOPOLOGY_CONNECTION_SECTIONS,
  TopologyApiLimits,
  TopologyCollectionCursorJSON,
  TopologyConnectionSection,
} from "../../../Types/Topology/TopologyApi";
import { isFlatInfrastructureType } from "../../../Types/Topology/TopologyTypeRules";

/*
 * Strict parsing of Topology API request bodies. Everything the SQL binds
 * comes out of here typed, bounded and normalized; anything else is a 400
 * (BadDataException) before a connection is taken.
 */

/* A request's range start may run ahead of this server's clock by this much. */
export const RANGE_START_MAX_FUTURE_SKEW_MS: number = 5 * 60 * 1000;

/* Earliest accepted range start; Postgres has no year 0 and nothing is older. */
const RANGE_START_MIN_MS: number = Date.UTC(1970, 0, 1);

/* Entity keys and types are varchar(100); a little slack for multi-byte text. */
export const MAX_ENTITY_KEY_LENGTH: number = 512;
export const MAX_ENTITY_TYPE_LENGTH: number = 200;
export const MAX_CURSOR_NAME_LENGTH: number = 512;

const ISO_DATE_TIME_PATTERN: RegExp =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})$/;

export interface TopologyRangeRequest {
  /* Floored to the minute: every "in range" decision and the cache use it. */
  rangeStart: Date;
}

export interface TopologyCollectionRequest extends TopologyRangeRequest {
  entityType: string;
  includeInactive: boolean;
  nameTerms: Array<string>;
  cursor: TopologyCollectionCursorJSON | null;
  limit: number;
}

export interface TopologyCollectionSearchType {
  entityType: string;
  nameTerms: Array<string>;
}

export interface TopologyCollectionSearchRequest extends TopologyRangeRequest {
  includeInactive: boolean;
  types: Array<TopologyCollectionSearchType>;
}

export interface TopologyEntityRequest extends TopologyRangeRequest {
  entityKey: string;
  entityType: string | null;
}

export interface TopologyEntityConnectionsRequest
  extends TopologyEntityRequest {
  section: TopologyConnectionSection;
  offset: number;
  limit: number;
}

/* Rows a section returns before "Show more", and the default page size. */
export function rowsForSection(section: TopologyConnectionSection): number {
  return section === "calls" || section === "calledBy"
    ? TopologyApiLimits.EntityDependencyRows
    : TopologyApiLimits.EntityOtherRows;
}

/* Floors a date to the whole minute (what the server uses and echoes). */
export function floorToMinute(date: Date): Date {
  return new Date(Math.floor(date.getTime() / 60_000) * 60_000);
}

export default class TopologyRequest {
  public static parseRangeRequest(
    body: unknown,
    now: Date = new Date(),
  ): TopologyRangeRequest {
    const json: JSONObject = TopologyRequest.asObject(body);
    return { rangeStart: TopologyRequest.parseRangeStart(json, now) };
  }

  public static parseCollectionRequest(
    body: unknown,
    now: Date = new Date(),
  ): TopologyCollectionRequest {
    const json: JSONObject = TopologyRequest.asObject(body);
    return {
      rangeStart: TopologyRequest.parseRangeStart(json, now),
      entityType: TopologyRequest.parseCollectionType(
        json["entityType"],
        "entityType",
      ),
      includeInactive: TopologyRequest.parseBoolean(
        json["includeInactive"],
        "includeInactive",
      ),
      nameTerms: TopologyRequest.parseNameTerms(
        json["nameTerms"],
        "nameTerms",
        true,
      ),
      cursor: TopologyRequest.parseCursor(json["cursor"]),
      limit: TopologyRequest.parseInteger(json["limit"], "limit", {
        min: 1,
        max: TopologyApiLimits.CollectionPageSizeMax,
        defaultValue: TopologyApiLimits.CollectionPageSizeDefault,
      }),
    };
  }

  public static parseCollectionSearchRequest(
    body: unknown,
    now: Date = new Date(),
  ): TopologyCollectionSearchRequest {
    const json: JSONObject = TopologyRequest.asObject(body);
    const rawTypes: unknown = json["types"];
    if (!Array.isArray(rawTypes)) {
      throw new BadDataException("types must be an array");
    }
    if (rawTypes.length > TopologyApiLimits.MaxCollectionSearchTypes) {
      throw new BadDataException(
        `types cannot have more than ${TopologyApiLimits.MaxCollectionSearchTypes} entries`,
      );
    }
    const seen: Set<string> = new Set<string>();
    const types: Array<TopologyCollectionSearchType> = rawTypes.map(
      (rawType: unknown, index: number): TopologyCollectionSearchType => {
        const entry: JSONObject = TopologyRequest.asObject(
          rawType,
          `types[${index}]`,
        );
        const entityType: string = TopologyRequest.parseCollectionType(
          entry["entityType"],
          `types[${index}].entityType`,
        );
        if (seen.has(entityType)) {
          throw new BadDataException(
            `types lists "${entityType}" more than once`,
          );
        }
        seen.add(entityType);
        return {
          entityType,
          nameTerms: TopologyRequest.parseNameTerms(
            entry["nameTerms"],
            `types[${index}].nameTerms`,
            false,
          ),
        };
      },
    );
    return {
      rangeStart: TopologyRequest.parseRangeStart(json, now),
      includeInactive: TopologyRequest.parseBoolean(
        json["includeInactive"],
        "includeInactive",
      ),
      types,
    };
  }

  public static parseEntityRequest(
    body: unknown,
    now: Date = new Date(),
  ): TopologyEntityRequest {
    const json: JSONObject = TopologyRequest.asObject(body);
    return {
      rangeStart: TopologyRequest.parseRangeStart(json, now),
      entityKey: TopologyRequest.parseString(json["entityKey"], "entityKey", {
        maxLength: MAX_ENTITY_KEY_LENGTH,
        allowEmpty: false,
      }),
      entityType: TopologyRequest.parseOptionalEntityType(json["entityType"]),
    };
  }

  public static parseEntityConnectionsRequest(
    body: unknown,
    now: Date = new Date(),
  ): TopologyEntityConnectionsRequest {
    const json: JSONObject = TopologyRequest.asObject(body);
    const entity: TopologyEntityRequest = TopologyRequest.parseEntityRequest(
      json,
      now,
    );
    const rawSection: unknown = json["section"];
    const section: TopologyConnectionSection | undefined =
      TOPOLOGY_CONNECTION_SECTIONS.find(
        (candidate: TopologyConnectionSection): boolean => {
          return candidate === rawSection;
        },
      );
    if (!section) {
      throw new BadDataException(
        `section must be one of ${TOPOLOGY_CONNECTION_SECTIONS.join(", ")}`,
      );
    }
    return {
      ...entity,
      section,
      offset: TopologyRequest.parseInteger(json["offset"], "offset", {
        min: 0,
        max: TopologyApiLimits.EntityConnectionScanLimit,
        defaultValue: undefined,
      }),
      limit: TopologyRequest.parseInteger(json["limit"], "limit", {
        min: 1,
        max: TopologyApiLimits.EntityConnectionsPageSizeMax,
        defaultValue: rowsForSection(section),
      }),
    };
  }

  // -------------------------------------------------------------- fields

  private static asObject(value: unknown, field: string = "body"): JSONObject {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new BadDataException(`${field} must be a JSON object`);
    }
    return value as JSONObject;
  }

  private static parseRangeStart(json: JSONObject, now: Date): Date {
    const value: unknown = json["rangeStart"];
    if (typeof value !== "string" || value.length > 64) {
      throw new BadDataException("rangeStart must be an ISO 8601 date-time");
    }
    if (!ISO_DATE_TIME_PATTERN.test(value)) {
      throw new BadDataException("rangeStart must be an ISO 8601 date-time");
    }
    const parsed: number = Date.parse(value);
    if (Number.isNaN(parsed)) {
      throw new BadDataException("rangeStart is not a valid date");
    }
    if (parsed > now.getTime() + RANGE_START_MAX_FUTURE_SKEW_MS) {
      throw new BadDataException("rangeStart cannot be in the future");
    }
    if (parsed < RANGE_START_MIN_MS) {
      throw new BadDataException("rangeStart is too far in the past");
    }
    return floorToMinute(new Date(parsed));
  }

  private static parseString(
    value: unknown,
    field: string,
    options: { maxLength: number; allowEmpty: boolean },
  ): string {
    if (typeof value !== "string") {
      throw new BadDataException(`${field} must be a string`);
    }
    if (!options.allowEmpty && value.length === 0) {
      throw new BadDataException(`${field} cannot be empty`);
    }
    if (value.length > options.maxLength) {
      throw new BadDataException(
        `${field} cannot be longer than ${options.maxLength} characters`,
      );
    }
    return value;
  }

  private static parseOptionalEntityType(value: unknown): string | null {
    if (value === undefined || value === null || value === "") {
      return null;
    }
    return TopologyRequest.parseString(value, "entityType", {
      maxLength: MAX_ENTITY_TYPE_LENGTH,
      allowEmpty: false,
    });
  }

  private static parseCollectionType(value: unknown, field: string): string {
    const entityType: string = TopologyRequest.parseString(value, field, {
      maxLength: MAX_ENTITY_TYPE_LENGTH,
      allowEmpty: false,
    });
    if (!isFlatInfrastructureType(entityType)) {
      throw new BadDataException(
        `${field} "${entityType}" is not a flat infrastructure type`,
      );
    }
    return entityType;
  }

  private static parseBoolean(value: unknown, field: string): boolean {
    if (typeof value !== "boolean") {
      throw new BadDataException(`${field} must be a boolean`);
    }
    return value;
  }

  private static parseInteger(
    value: unknown,
    field: string,
    options: { min: number; max: number; defaultValue: number | undefined },
  ): number {
    if (value === undefined || value === null) {
      if (options.defaultValue === undefined) {
        throw new BadDataException(`${field} is required`);
      }
      return options.defaultValue;
    }
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < options.min ||
      value > options.max
    ) {
      throw new BadDataException(
        `${field} must be an integer from ${options.min} to ${options.max}`,
      );
    }
    return value;
  }

  /*
   * Search terms: trimmed and lowercased (the match is case-insensitive
   * anyway), each non-empty and bounded, at most MaxSearchTerms of them.
   */
  private static parseNameTerms(
    value: unknown,
    field: string,
    optional: boolean,
  ): Array<string> {
    if (value === undefined || value === null) {
      if (optional) {
        return [];
      }
      throw new BadDataException(`${field} must be an array of strings`);
    }
    if (!Array.isArray(value)) {
      throw new BadDataException(`${field} must be an array of strings`);
    }
    if (value.length > TopologyApiLimits.MaxSearchTerms) {
      throw new BadDataException(
        `${field} cannot have more than ${TopologyApiLimits.MaxSearchTerms} terms`,
      );
    }
    return value.map((term: unknown): string => {
      if (typeof term !== "string") {
        throw new BadDataException(`${field} must be an array of strings`);
      }
      const normalized: string = term.trim().toLowerCase();
      if (normalized.length === 0) {
        throw new BadDataException(`${field} cannot contain an empty term`);
      }
      if (normalized.length > TopologyApiLimits.MaxSearchTermLength) {
        throw new BadDataException(
          `${field} terms cannot be longer than ${TopologyApiLimits.MaxSearchTermLength} characters`,
        );
      }
      return normalized;
    });
  }

  private static parseCursor(
    value: unknown,
  ): TopologyCollectionCursorJSON | null {
    if (value === undefined || value === null) {
      return null;
    }
    const cursor: JSONObject = TopologyRequest.asObject(value, "cursor");
    return {
      name: TopologyRequest.parseString(cursor["name"], "cursor.name", {
        maxLength: MAX_CURSOR_NAME_LENGTH,
        allowEmpty: true,
      }),
      key: TopologyRequest.parseString(cursor["key"], "cursor.key", {
        maxLength: MAX_ENTITY_KEY_LENGTH,
        allowEmpty: false,
      }),
    };
  }
}
