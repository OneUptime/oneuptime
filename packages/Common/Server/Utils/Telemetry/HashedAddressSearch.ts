import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import EndsWith from "../../../Types/BaseDatabase/EndsWith";
import EqualTo from "../../../Types/BaseDatabase/EqualTo";
import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import NotContains from "../../../Types/BaseDatabase/NotContains";
import NotEqual from "../../../Types/BaseDatabase/NotEqual";
import NotWildcard from "../../../Types/BaseDatabase/NotWildcard";
import QueryOperator from "../../../Types/BaseDatabase/QueryOperator";
import Search from "../../../Types/BaseDatabase/Search";
import StartsWith from "../../../Types/BaseDatabase/StartsWith";
import Wildcard from "../../../Types/BaseDatabase/Wildcard";
import {
  MAX_WILDCARD_PATTERNS,
  escapeWildcards,
} from "../../../Types/BaseDatabase/WildcardPattern";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import { ObjectType } from "../../../Types/JSON";
import LogScrubAction from "../../../Types/Log/LogScrubAction";
import LogScrubPatternType from "../../../Types/Log/LogScrubPatternType";
import ObjectID from "../../../Types/ObjectID";
import {
  HASHED_ADDRESS_SEARCH_FIELDS,
  HashedAddressSearchFields,
  HashedAddressSignal,
  getHashedAddressSearchTexts,
} from "../../../Types/Telemetry/HashedAddressSearch";
import TraceScrubAction from "../../../Types/Trace/TraceScrubAction";
import TraceScrubPatternType from "../../../Types/Trace/TraceScrubPatternType";
import { readOwnValue } from "../../../Utils/LookupTable";
import ScrubIpAddress, {
  ScrubIpAddressRange,
} from "../../../Utils/Telemetry/ScrubIpAddress";
import InMemoryTTLCache from "../../Infrastructure/InMemoryTTLCache";
import LogScrubRuleService from "../../Services/LogScrubRuleService";
import TraceScrubRuleService from "../../Services/TraceScrubRuleService";
import {
  SQL,
  Statement,
  escapeIlikePattern,
} from "../AnalyticsDatabase/Statement";
import logger from "../Logger";
import ScrubHashToken from "./ScrubHashToken";

/*
 * ---------------------------------------------------------------------------
 * A SEARCH FOR AN IP ADDRESS FINDS THE RECORDS WHERE A RULE HASHED IT
 * (#10418).
 *
 * Once a project hashes IP addresses out of its logs and traces (an IP
 * Address scrub rule with the Hash action), its records hold
 * "[HASHED:3f9a1c0be27d4e5a]" where 203.0.113.7 was. A customer who says
 * "my IP is 203.0.113.7", a log monitor, a dashboard or a saved view that
 * filters on the address used to find nothing - the cost that pushed teams
 * back to Redact or to no rule at all.
 *
 * So the server reads a search for an address, in such a project, as "the
 * address, or the project's token for it":
 *
 *  - which texts: what the search compares on the fields a scrub rule
 *    scrubs (Types/Telemetry/HashedAddressSearch: a log's body and
 *    attributes, a span's name, status message and attributes, an
 *    exception's message, stack trace and attributes) - a value as typed,
 *    free text, each value of a list, each glob;
 *  - which addresses: exactly those an IP Address rule hides in that text,
 *    found by the rule's own function (ScrubIpAddress.findRanges), so a
 *    search finds what ingest hashed: a public address however it is
 *    typed (::ffff:203.0.113.7 and 203.0.113.7 make one token, as
 *    2001:DB8::1 and 2001:db8::1 do), never a private one, which no rule
 *    hashes;
 *  - which token: the one ingest left, ScrubHashToken.ofIpAddress under the
 *    project's own key - so an address searched in one project matches
 *    that project's token only, never another's;
 *  - how: the text with each address in it replaced by its token is
 *    matched as well as the text itself, by the same comparison - equal
 *    (`IN`), contains, starts or ends with, a glob - and negated the same
 *    way, so "-@client.address:203.0.113.7" leaves out its hashed records
 *    too;
 *  - where: every read of logs, spans and exceptions takes it - the
 *    explorers' lists and totals, their charts, facets, analytics and
 *    exports, monitors and their previews, dashboards and saved views -
 *    through the services' read hook (AnalyticsDatabaseService
 *    .bindReadQuery) and the aggregation services' filters;
 *  - only in a project with an IP Address rule with the Hash action, for
 *    the records it scrubs (log rules for logs, trace rules for spans,
 *    either for exceptions, which both write), on or off: records hashed
 *    while it was on keep their tokens. Everywhere else a search runs the
 *    query it ran before, byte for byte.
 *
 * Fail toward privacy: it only ever adds the token of an address the person
 * typed. It never turns a token back into an address, never reads anything
 * but the rules, and grants nothing: whoever may read the records may search
 * them, as before the rule, and the read's own permission check and rate
 * limits apply after. A token from before #10394 (8 hex characters, unkeyed)
 * is not matched: it is shared by different addresses, so a match would
 * name records of someone else; the explorers say so. When the rules cannot
 * be read, the search runs as it was.
 * ---------------------------------------------------------------------------
 */

// How long a project's answer is kept: a new rule hashes from its next minute on.
const RULES_CACHE_TTL_MS: number = 60 * 1000;
const MAX_CACHED_PROJECTS: number = 10_000;

interface ProjectHashing {
  logs: boolean;
  traces: boolean;
}

const projectHashing: InMemoryTTLCache<ProjectHashing> =
  new InMemoryTTLCache<ProjectHashing>(MAX_CACHED_PROJECTS);

// The serialized shape of a query operator off the wire.
interface SerializedOperator {
  _type: string;
  value?: unknown;
}

const isSerializedOperator: (value: unknown) => value is SerializedOperator = (
  value: unknown,
): value is SerializedOperator => {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !(value instanceof QueryOperator) &&
    typeof (value as { _type?: unknown })._type === "string"
  );
};

// A glob that matches a text containing `text`, as Search compares it.
const containsGlob: (text: string) => string = (text: string): string => {
  return `*${escapeWildcards(text)}*`;
};

/*
 * Values with a hashed form added for each that holds an address, each once.
 * Values that are no text are kept as they are.
 */
const withHashedForms: (
  values: ReadonlyArray<unknown>,
  hashedFormOf: (text: string) => string | null,
) => Array<unknown> = (
  values: ReadonlyArray<unknown>,
  hashedFormOf: (text: string) => string | null,
): Array<unknown> => {
  const bound: Array<unknown> = [...values];
  const seen: Set<string> = new Set<string>(
    values.map((value: unknown): string => {
      return String(value);
    }),
  );

  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }

    const hashed: string | null = hashedFormOf(value);

    if (hashed !== null && !seen.has(hashed)) {
      seen.add(hashed);
      bound.push(hashed);
    }
  }

  return bound;
};

/*
 * The token an IP Address Hash rule of one project leaves for each address
 * in a text, made as ingest makes it.
 */
export class HashedAddressTokens {
  public readonly projectId: ObjectID;

  public constructor(projectId: ObjectID) {
    this.projectId = projectId;
  }

  /*
   * The text as the project's IP Address Hash rules store it: each address
   * they hide replaced by its token, the rest as it is. Null when the text
   * holds no such address - a private address, a fragment ("203.0.113"),
   * a token already.
   */
  public hashedFormOf(text: string): string | null {
    if (!text) {
      return null;
    }

    const ranges: Array<ScrubIpAddressRange> = ScrubIpAddress.findRanges(text);

    if (ranges.length === 0) {
      return null;
    }

    const parts: Array<string> = [];
    let at: number = 0;

    for (const [start, end] of ranges) {
      parts.push(
        text.slice(at, start),
        ScrubHashToken.ofIpAddress({
          projectId: this.projectId,
          address: text.slice(start, end),
        }),
      );
      at = end;
    }

    parts.push(text.slice(at));

    return parts.join("");
  }
}

export default class HashedAddressSearch {
  // The addresses an IP Address rule hides in a text, as they are written there.
  public static getAddressesIn(text: string): Array<string> {
    if (!text) {
      return [];
    }

    return ScrubIpAddress.findRanges(text).map(
      (range: ScrubIpAddressRange): string => {
        return text.slice(range[0], range[1]);
      },
    );
  }

  public static holdsAddress(texts: ReadonlyArray<string>): boolean {
    return texts.some((text: string): boolean => {
      return HashedAddressSearch.getAddressesIn(text).length > 0;
    });
  }

  /*
   * The project a read reads, as the read's permission check scopes it
   * (ModelPermission.checkReadPermission): the caller's project when the
   * read names one and is not one across projects, or - for OneUptime's
   * own reads - the one project its query names. Null when there is no one
   * project, and then nothing is bound: a token is one project's.
   */
  public static getReadProjectId(
    query: unknown,
    props: DatabaseCommonInteractionProps | undefined,
  ): ObjectID | null {
    if (!props || props.isMultiTenantRequest) {
      return null;
    }

    if (props.tenantId) {
      return new ObjectID(props.tenantId.toString());
    }

    if (!props.isRoot && !props.isMasterAdmin) {
      return null;
    }

    const projectId: unknown =
      query && typeof query === "object"
        ? readOwnValue(query as Record<string, unknown>, "projectId")
        : undefined;

    if (projectId instanceof ObjectID) {
      return projectId;
    }

    if (typeof projectId === "string" && ObjectID.isValidUUID(projectId)) {
      return new ObjectID(projectId);
    }

    return null;
  }

  // Whether the project's records of a signal may hold an IP Address rule's tokens.
  public static async isHashingAddresses(data: {
    projectId: ObjectID;
    signal: HashedAddressSignal;
  }): Promise<boolean> {
    let hashing: ProjectHashing;

    try {
      hashing = await HashedAddressSearch.getProjectHashing(data.projectId);
    } catch (error) {
      // The search runs as it was: it never shows more than it did.
      logger.warn(
        "A search could not read the project's IP Address scrub rules, so it does not match hashed addresses",
        { projectId: data.projectId.toString() },
      );
      logger.debug(error);
      return false;
    }

    switch (data.signal) {
      case HashedAddressSignal.Logs:
        return hashing.logs;
      case HashedAddressSignal.Traces:
        return hashing.traces;
      case HashedAddressSignal.Exceptions:
        // An exception is written from a span (trace rules) or a log line (log rules).
        return hashing.logs || hashing.traces;
      default:
        return false;
    }
  }

  /*
   * The tokens for a read whose texts are these: only when one of them
   * holds an address a rule hides and the project's records of the signal
   * may hold its token - so a search that names no address reads no rule.
   */
  public static async getTokensForTexts(data: {
    projectId: ObjectID | null | undefined;
    signal: HashedAddressSignal;
    texts: ReadonlyArray<string>;
  }): Promise<HashedAddressTokens | undefined> {
    if (!data.projectId || !HashedAddressSearch.holdsAddress(data.texts)) {
      return undefined;
    }

    const isHashing: boolean = await HashedAddressSearch.isHashingAddresses({
      projectId: data.projectId,
      signal: data.signal,
    });

    return isHashing ? new HashedAddressTokens(data.projectId) : undefined;
  }

  /*
   * The texts an aggregation request (a histogram, facets, analytics, an
   * export) compares on the fields a search for an address reads.
   */
  public static getRequestTexts(request: {
    bodySearchText?: string | undefined;
    nameSearchText?: string | undefined;
    statusMessageSearchText?: string | undefined;
    messageSearchText?: string | undefined;
    spanNames?: Array<string> | undefined;
    excludedSpanNames?: Array<string> | undefined;
    spanNameSearches?: Array<string> | undefined;
    statusMessages?: Array<string> | undefined;
    attributes?: Record<string, unknown> | undefined;
    attributeSearches?: Record<string, string> | undefined;
  }): Array<string> {
    const texts: Array<string> = [];
    const addText: (value: unknown) => void = (value: unknown): void => {
      if (typeof value === "string" && value.length > 0) {
        texts.push(value);
      }
    };

    addText(request.bodySearchText);
    addText(request.nameSearchText);
    addText(request.statusMessageSearchText);
    addText(request.messageSearchText);

    for (const list of [
      request.spanNames,
      request.excludedSpanNames,
      request.spanNameSearches,
      request.statusMessages,
    ]) {
      for (const value of list || []) {
        addText(value);
      }
    }

    for (const value of Object.values(request.attributeSearches || {})) {
      addText(value);
    }

    texts.push(
      ...getHashedAddressSearchTexts(
        { attributes: request.attributes },
        HashedAddressSignal.Logs,
      ),
    );

    return texts;
  }

  // The tokens for an aggregation request of one project, or none (getTokensForTexts).
  public static async getTokensForRequest(data: {
    projectId: ObjectID | null | undefined;
    signal: HashedAddressSignal;
    request: Parameters<typeof HashedAddressSearch.getRequestTexts>[0];
  }): Promise<HashedAddressTokens | undefined> {
    return await HashedAddressSearch.getTokensForTexts({
      projectId: data.projectId,
      signal: data.signal,
      texts: HashedAddressSearch.getRequestTexts(data.request),
    });
  }

  /*
   * A read's query, bound: in a project whose records of the signal may
   * hold IP Address tokens, every comparison on the fields a search for an
   * address reads also matches the hashed form of what it compares. A new
   * query; the one given is left as it was, and handed back as it is when
   * nothing is bound.
   */
  public static async bindQuery<TQuery>(data: {
    query: TQuery;
    props: DatabaseCommonInteractionProps | undefined;
    signal: HashedAddressSignal;
  }): Promise<TQuery> {
    if (!data.query || typeof data.query !== "object") {
      return data.query;
    }

    const tokens: HashedAddressTokens | undefined =
      await HashedAddressSearch.getTokensForTexts({
        projectId: HashedAddressSearch.getReadProjectId(data.query, data.props),
        signal: data.signal,
        texts: getHashedAddressSearchTexts(data.query, data.signal),
      });

    if (!tokens) {
      return data.query;
    }

    return HashedAddressSearch.bindQueryWith({
      query: data.query,
      signal: data.signal,
      tokens,
    });
  }

  // The binding itself, with the project's tokens in hand (bindQuery).
  public static bindQueryWith<TQuery>(data: {
    query: TQuery;
    signal: HashedAddressSignal;
    tokens: HashedAddressTokens;
  }): TQuery {
    const record: Record<string, unknown> = data.query as unknown as Record<
      string,
      unknown
    >;
    const fields: HashedAddressSearchFields =
      HASHED_ADDRESS_SEARCH_FIELDS[data.signal];
    const bound: Record<string, unknown> = { ...record };
    let isChanged: boolean = false;

    for (const column of fields.textColumns) {
      if (!Object.prototype.hasOwnProperty.call(record, column)) {
        continue;
      }

      const value: unknown = record[column];
      const boundValue: unknown = HashedAddressSearch.bindQueryValue(
        value,
        data.tokens,
      );

      if (boundValue !== value) {
        bound[column] = boundValue;
        isChanged = true;
      }
    }

    for (const column of fields.mapColumns) {
      const map: unknown = readOwnValue(record, column);

      if (
        !map ||
        typeof map !== "object" ||
        Array.isArray(map) ||
        map instanceof QueryOperator
      ) {
        continue;
      }

      const mapRecord: Record<string, unknown> = map as Record<string, unknown>;
      const boundMap: Record<string, unknown> = { ...mapRecord };
      let isMapChanged: boolean = false;

      for (const key of Object.keys(mapRecord)) {
        const value: unknown = mapRecord[key];
        const boundValue: unknown = HashedAddressSearch.bindQueryValue(
          value,
          data.tokens,
        );

        if (boundValue !== value) {
          boundMap[key] = boundValue;
          isMapChanged = true;
        }
      }

      if (isMapChanged) {
        bound[column] = boundMap;
        isChanged = true;
      }
    }

    return (isChanged ? bound : record) as unknown as TQuery;
  }

  /*
   * One filter value, bound: the same comparison, of the value or its
   * hashed form. The value itself when it compares no address.
   */
  public static bindQueryValue(
    value: unknown,
    tokens: HashedAddressTokens,
  ): unknown {
    const hashedFormOf: (text: string) => string | null = (
      text: string,
    ): string | null => {
      return tokens.hashedFormOf(text);
    };

    if (typeof value === "string") {
      const hashed: string | null = hashedFormOf(value);

      return hashed === null ? value : new Includes([value, hashed]);
    }

    // Several comparisons AND-ed on one field: each bound on its own.
    if (Array.isArray(value)) {
      if (
        value.length === 0 ||
        !value.every((entry: unknown): boolean => {
          return entry instanceof QueryOperator;
        })
      ) {
        return value;
      }

      let isChanged: boolean = false;
      const bound: Array<unknown> = value.map((entry: unknown): unknown => {
        const boundEntry: unknown = HashedAddressSearch.bindQueryValue(
          entry,
          tokens,
        );

        if (boundEntry !== entry) {
          isChanged = true;
        }

        return boundEntry;
      });

      return isChanged ? bound : value;
    }

    if (value instanceof EqualTo) {
      const text: unknown = value.value;

      if (typeof text !== "string") {
        return value;
      }

      const hashed: string | null = hashedFormOf(text);

      return hashed === null ? value : new Includes([text, hashed]);
    }

    if (value instanceof NotEqual) {
      const text: unknown = value.value;

      if (typeof text !== "string") {
        return value;
      }

      const hashed: string | null = hashedFormOf(text);

      return hashed === null ? value : new IncludesNone([text, hashed]);
    }

    if (value instanceof Includes || value instanceof IncludesNone) {
      const values: Array<unknown> = [...(value.values || [])];
      const bound: Array<unknown> = withHashedForms(values, hashedFormOf);

      if (bound.length === values.length) {
        return value;
      }

      return value instanceof Includes
        ? new Includes(bound as Array<string>)
        : new IncludesNone(bound as Array<string>);
    }

    if (
      value instanceof Search ||
      value instanceof NotContains ||
      value instanceof StartsWith ||
      value instanceof EndsWith
    ) {
      const text: string = String(value.value ?? "");
      const hashed: string | null = hashedFormOf(text);

      if (hashed === null) {
        return value;
      }

      const globOf: (literal: string) => string = (literal: string): string => {
        if (value instanceof StartsWith) {
          return `${escapeWildcards(literal)}*`;
        }

        if (value instanceof EndsWith) {
          return `*${escapeWildcards(literal)}`;
        }

        return containsGlob(literal);
      };

      const globs: Array<string> = [globOf(text), globOf(hashed)];

      return value instanceof NotContains
        ? new NotWildcard(globs)
        : new Wildcard(globs);
    }

    if (value instanceof Wildcard || value instanceof NotWildcard) {
      const globs: Array<string> = value.values.map((glob: string): string => {
        return String(glob ?? "");
      });
      const bound: Array<unknown> = withHashedForms(globs, hashedFormOf);

      // A wildcard filter carries at most so many globs: past it, as it was.
      if (
        bound.length === globs.length ||
        bound.length > MAX_WILDCARD_PATTERNS
      ) {
        return value;
      }

      return value instanceof Wildcard
        ? new Wildcard(bound as Array<string>)
        : new NotWildcard(bound as Array<string>);
    }

    return value;
  }

  /*
   * An aggregation request's attribute filters, bound as a read's are
   * (bindQueryValue), in the serialized shape they arrive in: a value, a
   * list, or an operator's {_type, value}. A new map; the one given is left
   * as it was, and handed back as it is with no tokens or nothing bound.
   */
  public static bindSerializedAttributes<
    TAttributes extends Record<string, unknown> | undefined,
  >(
    attributes: TAttributes,
    tokens: HashedAddressTokens | undefined,
  ): TAttributes {
    if (!attributes || !tokens) {
      return attributes;
    }

    const bound: Record<string, unknown> = { ...attributes };
    let isChanged: boolean = false;

    for (const key of Object.keys(attributes)) {
      const value: unknown = attributes[key];
      const boundValue: unknown = HashedAddressSearch.bindSerializedValue(
        value,
        tokens,
      );

      if (boundValue !== value) {
        bound[key] = boundValue;
        isChanged = true;
      }
    }

    return (isChanged ? bound : attributes) as TAttributes;
  }

  private static bindSerializedValue(
    value: unknown,
    tokens: HashedAddressTokens,
  ): unknown {
    const hashedFormOf: (text: string) => string | null = (
      text: string,
    ): string | null => {
      return tokens.hashedFormOf(text);
    };

    // A value: equals. A blank one means "is empty", and holds no address.
    if (typeof value === "string") {
      const hashed: string | null = hashedFormOf(value);

      return hashed === null ? value : [value, hashed];
    }

    // A list: is any of.
    if (Array.isArray(value)) {
      const bound: Array<unknown> = withHashedForms(value, hashedFormOf);

      return bound.length === value.length ? value : bound;
    }

    if (!isSerializedOperator(value)) {
      return value;
    }

    const text: unknown = value.value;

    switch (value._type) {
      case ObjectType.EqualTo:
      case ObjectType.NotEqual: {
        if (typeof text !== "string") {
          return value;
        }

        const hashed: string | null = hashedFormOf(text);

        if (hashed === null) {
          return value;
        }

        return {
          _type:
            value._type === ObjectType.EqualTo
              ? ObjectType.Includes
              : ObjectType.IncludesNone,
          value: [text, hashed],
        };
      }

      case ObjectType.Includes:
      case ObjectType.IncludesNone: {
        if (!Array.isArray(text)) {
          return value;
        }

        const bound: Array<unknown> = withHashedForms(text, hashedFormOf);

        return bound.length === text.length
          ? value
          : { _type: value._type, value: bound };
      }

      case ObjectType.Search:
      case ObjectType.NotContains:
      case ObjectType.StartsWith:
      case ObjectType.EndsWith: {
        if (typeof text !== "string") {
          return value;
        }

        const hashed: string | null = hashedFormOf(text);

        if (hashed === null) {
          return value;
        }

        const globOf: (literal: string) => string = (
          literal: string,
        ): string => {
          if (value._type === ObjectType.StartsWith) {
            return `${escapeWildcards(literal)}*`;
          }

          if (value._type === ObjectType.EndsWith) {
            return `*${escapeWildcards(literal)}`;
          }

          return containsGlob(literal);
        };

        return {
          _type:
            value._type === ObjectType.NotContains
              ? ObjectType.NotWildcard
              : ObjectType.Wildcard,
          value: [globOf(text), globOf(hashed)],
        };
      }

      case ObjectType.Wildcard:
      case ObjectType.NotWildcard: {
        const globs: Array<unknown> = Array.isArray(text) ? text : [text];
        const bound: Array<unknown> = withHashedForms(globs, hashedFormOf);

        if (
          bound.length === globs.length ||
          bound.length > MAX_WILDCARD_PATTERNS
        ) {
          return value;
        }

        return { _type: value._type, value: bound };
      }

      default:
        return value;
    }
  }

  /*
   * A list of values compared exactly ("is any of", "is none of"), with the
   * hashed form of each that holds an address: the same list when there
   * are no tokens or none does.
   */
  public static withHashedForms(
    values: Array<string> | undefined,
    tokens: HashedAddressTokens | undefined,
  ): Array<string> | undefined {
    if (!values || !tokens) {
      return values;
    }

    const bound: Array<unknown> = withHashedForms(
      values,
      (text: string): string | null => {
        return tokens.hashedFormOf(text);
      },
    );

    return bound.length === values.length ? values : (bound as Array<string>);
  }

  /*
   * `<column> ILIKE '%text%'` as an aggregation compiles free text - or,
   * when the text holds an address the project's rules hash, the same
   * comparison of the text or its hashed form, in brackets:
   * `(<column> ILIKE '%text%' OR <column> ILIKE '%[HASHED:...]%')`. The
   * pattern is escaped so `%` and `_` match literally, as the list's is.
   * The column is one of the caller's own names, never input.
   */
  public static containsCondition(data: {
    column: string;
    text: string;
    tokens: HashedAddressTokens | undefined;
  }): Statement {
    const texts: Array<string> = [data.text];
    const hashed: string | null = data.tokens
      ? data.tokens.hashedFormOf(data.text)
      : null;

    if (hashed !== null) {
      texts.push(hashed);
    }

    const condition: Statement = new Statement();

    if (texts.length > 1) {
      condition.append("(");
    }

    texts.forEach((text: string, index: number): void => {
      if (index > 0) {
        condition.append(" OR ");
      }

      condition.append(`${data.column} ILIKE `).append(
        SQL`${{
          type: TableColumnType.Text,
          value: `%${escapeIlikePattern(text)}%`,
        }}`,
      );
    });

    if (texts.length > 1) {
      condition.append(")");
    }

    return condition;
  }

  /*
   * What a search's note says (an explorer's "Includes records where this
   * address was hashed."): the addresses among these texts the search also
   * matches by token, each once, as first written - none when the project's
   * records of the signal hold no IP Address tokens. Reads only the rules.
   */
  public static async getAddressesMatchedByToken(data: {
    projectId: ObjectID;
    signal: HashedAddressSignal;
    texts: ReadonlyArray<string>;
  }): Promise<Array<string>> {
    const tokens: HashedAddressTokens | undefined =
      await HashedAddressSearch.getTokensForTexts(data);

    if (!tokens) {
      return [];
    }

    const addresses: Array<string> = [];
    const seen: Set<string> = new Set<string>();

    for (const text of data.texts) {
      for (const address of HashedAddressSearch.getAddressesIn(text)) {
        const token: string = ScrubHashToken.ofIpAddress({
          projectId: tokens.projectId,
          address,
        });

        if (!seen.has(token)) {
          seen.add(token);
          addresses.push(address);
        }
      }
    }

    return addresses;
  }

  // The rules, as root: who may search is decided by the read, not by them.
  private static async getProjectHashing(
    projectId: ObjectID,
  ): Promise<ProjectHashing> {
    const key: string = projectId.toString();
    const cached: ProjectHashing | undefined = projectHashing.get(key);

    if (cached) {
      return cached;
    }

    const [logRules, traceRules] = await Promise.all([
      LogScrubRuleService.countBy({
        query: {
          projectId,
          patternType: LogScrubPatternType.IPAddress,
          scrubAction: LogScrubAction.Hash,
        },
        props: { isRoot: true },
      }),
      TraceScrubRuleService.countBy({
        query: {
          projectId,
          patternType: TraceScrubPatternType.IPAddress,
          scrubAction: TraceScrubAction.Hash,
        },
        props: { isRoot: true },
      }),
    ]);

    const hashing: ProjectHashing = {
      logs: logRules.toNumber() > 0,
      traces: traceRules.toNumber() > 0,
    };

    projectHashing.set(key, hashing, RULES_CACHE_TTL_MS);

    return hashing;
  }

  // For tests: forget every project's answer.
  public static clearCache(): void {
    projectHashing.clear();
  }
}
