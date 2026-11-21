import { readOwnValue } from "../../Utils/LookupTable";

/*
 * WHERE A TELEMETRY SEARCH FOR AN IP ADDRESS ALSO MATCHES ITS HASH TOKEN
 * (#10418).
 *
 * An IP Address scrub rule with the Hash action stores "[HASHED:" and 16 hex
 * characters where an address was (Server/Utils/Telemetry/ScrubHashToken.ts,
 * keyed per project). A person who searches for 203.0.113.7 - a customer
 * said "it's broken for me, my IP is 203.0.113.7" - would find nothing,
 * because no record holds the address any more. So in a project with such a
 * rule, the server reads a search for an address as "the address, or the
 * project's token for it" (Server/Utils/Telemetry/HashedAddressSearch.ts),
 * on the fields a scrub rule scrubs:
 *
 *  - a log's body and attributes;
 *  - a span's name, status message and attributes;
 *  - an exception's message, stack trace and attributes.
 *
 * It only ever adds the token of an address the person typed to their
 * search: it never turns a token back into an address, and a project's
 * token matches only that project's records.
 *
 * Here, apart from the server code, so an explorer reads the same fields to
 * know when its results include hashed records, and says so above them.
 * No server imports: the Dashboard reads this module too.
 */

export enum HashedAddressSignal {
  Logs = "logs",
  Traces = "traces",
  Exceptions = "exceptions",
}

export interface HashedAddressSearchFields {
  // The text columns a search compares as a whole or contains.
  textColumns: ReadonlyArray<string>;
  // The map columns, every value of which a search may compare.
  mapColumns: ReadonlyArray<string>;
}

export const HASHED_ADDRESS_SEARCH_FIELDS: Readonly<
  Record<HashedAddressSignal, HashedAddressSearchFields>
> = {
  [HashedAddressSignal.Logs]: {
    textColumns: ["body"],
    mapColumns: ["attributes"],
  },
  [HashedAddressSignal.Traces]: {
    textColumns: ["name", "statusMessage"],
    mapColumns: ["attributes"],
  },
  [HashedAddressSignal.Exceptions]: {
    textColumns: ["message", "stackTrace"],
    mapColumns: ["attributes"],
  },
};

/*
 * How much one question about a search may ask: an explorer sends the texts
 * of its search (the free text, each value it compares), never more than
 * this many, nor longer.
 */
export const MAX_HASHED_ADDRESS_SEARCH_TEXTS: number = 100;
export const MAX_HASHED_ADDRESS_SEARCH_TEXT_LENGTH: number = 2000;

// The serialized shape of a query operator: {_type: "Search", value: "..."}.
interface SerializedOperator {
  _type?: unknown;
  value?: unknown;
}

// An operator object, as it is or as it reads once serialized.
const serializedFormOf: (
  value: Record<string, unknown>,
) => SerializedOperator = (
  value: Record<string, unknown>,
): SerializedOperator => {
  const toJSON: unknown = (value as { toJSON?: unknown }).toJSON;

  if (typeof toJSON === "function") {
    const json: unknown = (toJSON as () => unknown).call(value);

    if (json && typeof json === "object" && !Array.isArray(json)) {
      return json as SerializedOperator;
    }
  }

  return value as SerializedOperator;
};

// The texts one filter value compares: a value, each value of a list, each glob.
const textsOfValue: (value: unknown, texts: Array<string>) => void = (
  value: unknown,
  texts: Array<string>,
): void => {
  if (typeof value === "string") {
    if (value.length > 0) {
      texts.push(value);
    }

    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      textsOfValue(entry, texts);
    }

    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  const serialized: SerializedOperator = serializedFormOf(
    value as Record<string, unknown>,
  );

  if (typeof serialized._type !== "string") {
    return;
  }

  textsOfValue(serialized.value, texts);
};

/*
 * The texts a query compares on the fields a search for an address reads,
 * in the order met: a value as written, each value of a list, each glob of
 * a wildcard. Reads a query's operators (Search, Wildcard, Includes, ...)
 * and their serialized form ({_type, value}) alike, and nothing but those
 * fields, by their own keys.
 */
export function getHashedAddressSearchTexts(
  query: unknown,
  signal: HashedAddressSignal,
): Array<string> {
  const texts: Array<string> = [];

  if (!query || typeof query !== "object") {
    return texts;
  }

  const record: Record<string, unknown> = query as Record<string, unknown>;
  const fields: HashedAddressSearchFields =
    HASHED_ADDRESS_SEARCH_FIELDS[signal];

  for (const column of fields.textColumns) {
    textsOfValue(readOwnValue(record, column), texts);
  }

  for (const column of fields.mapColumns) {
    const map: unknown = readOwnValue(record, column);

    if (!map || typeof map !== "object" || Array.isArray(map)) {
      continue;
    }

    for (const key of Object.keys(map)) {
      textsOfValue(readOwnValue(map as Record<string, unknown>, key), texts);
    }
  }

  return texts;
}
