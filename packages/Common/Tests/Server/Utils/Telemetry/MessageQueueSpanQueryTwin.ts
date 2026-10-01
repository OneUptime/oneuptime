import {
  MESSAGE_QUEUE_DISCOVERY_EXCLUDED_SPAN_KIND,
  MESSAGE_QUEUE_DISCOVERY_SHADOWED_VALUE,
  MESSAGE_QUEUE_NATS_GENERATED_SUBJECTS,
  MESSAGE_QUEUE_RABBITMQ_DEFAULT_EXCHANGES,
  MessagingSpanDiscoveryRow,
  getMessagingDiscoveryColumn,
} from "../../../../Server/Utils/Telemetry/MessageQueueDiscovery";
import {
  MessagingSystemDescriptor,
  getMessagingSystemDescriptor,
} from "../../../../Types/MessageQueue/MessagingSystem";
import {
  AZURE_MESSAGING_PROVIDER_NAMESPACES,
  AZURE_RESOURCE_PROVIDER_ATTRIBUTES,
  MESSAGING_DESTINATION_ATTRIBUTES,
  MESSAGING_RESOLVER_INPUT_ATTRIBUTES,
  MESSAGING_SYSTEM_ATTRIBUTE,
  MESSAGING_TEMPORARY_FLAG_ATTRIBUTES,
  MESSAGING_TRIGGER_ATTRIBUTES,
  RABBITMQ_ROUTING_KEY_ATTRIBUTES,
} from "../../../../Types/MessageQueue/MessagingTelemetryResolver";

/*
 * The message queue span query's per-span half — which stored spans its
 * WHERE reads, and what its folding of values that vary per message
 * (MessageQueueDiscovery, "Values that vary per message") makes of their
 * attributes — in TypeScript, with ClickHouse's semantics:
 *
 *   - lower() and the case-insensitive searches fold ASCII letters only;
 *   - match(value, '[!-~]') finds a printable, non-space ASCII character;
 *   - a key a span lacks reads '' from its attribute map.
 *
 * Two suites hold it: the unit tests hold it to the resolver (whatever it
 * drops names no queue, whatever it folds resolves exactly as before), and
 * the real-ClickHouse suite holds the query to it (ClickHouse's groups are
 * exactly the ones it makes, over every stored span).
 */

// A span as the table keeps it: the kind column, attributeKeys, the map.
export interface StoredSpan {
  kind: string | null;
  attributeKeys: ReadonlyArray<string>;
  attributes: Readonly<Record<string, string>>;
}

// ClickHouse's lower() on a String: ASCII letters only.
export function clickhouseLower(value: string): string {
  return value.replace(/[A-Z]/g, (letter: string): string => {
    return letter.toLowerCase();
  });
}

// What `attributes['key']` reads: the stored text, '' when absent.
function storedValue(span: StoredSpan, key: string): string {
  const value: unknown = Object.prototype.hasOwnProperty.call(
    span.attributes,
    key,
  )
    ? span.attributes[key]
    : undefined;
  return typeof value === "string" ? value : "";
}

// ClickHouse's match(value, '[!-~]'): a printable, non-space ASCII character.
const PRINTABLE_ASCII: RegExp = /[!-~]/;

function certainlyHoldsText(value: string): boolean {
  return PRINTABLE_ASCII.test(value);
}

// The spellings the catalog maps to NATS, lowercased.
export function natsSpellings(): Array<string> {
  const descriptor: MessagingSystemDescriptor | null =
    getMessagingSystemDescriptor("nats");
  return (descriptor ? [descriptor.system, ...descriptor.aliases] : ["nats"])
    .map((spelling: string): string => {
      return spelling.toLowerCase();
    })
    .sort();
}

/*
 * The WHERE's reads before its fold: not a stored SERVER span, a trigger key
 * among attributeKeys, and either a trigger key other than the Azure
 * provider ones or an Azure provider value naming a messaging provider
 * (multiSearchAnyCaseInsensitive: an ASCII-case-insensitive substring).
 */
export function isReadBySpanQuery(span: StoredSpan): boolean {
  if ((span.kind ?? "") === MESSAGE_QUEUE_DISCOVERY_EXCLUDED_SPAN_KIND) {
    return false;
  }
  const keys: ReadonlyArray<string> = span.attributeKeys;
  if (
    !keys.some((key: string): boolean => {
      return MESSAGING_TRIGGER_ATTRIBUTES.includes(key);
    })
  ) {
    return false;
  }
  const presence: boolean = keys.some((key: string): boolean => {
    return (
      MESSAGING_TRIGGER_ATTRIBUTES.includes(key) &&
      !AZURE_RESOURCE_PROVIDER_ATTRIBUTES.includes(key)
    );
  });
  const provider: boolean = AZURE_RESOURCE_PROVIDER_ATTRIBUTES.some(
    (key: string): boolean => {
      const value: string = clickhouseLower(storedValue(span, key));
      return AZURE_MESSAGING_PROVIDER_NAMESPACES.some(
        (namespace: string): boolean => {
          return value.includes(namespace);
        },
      );
    },
  );
  return presence || provider;
}

// Rule 1: a temporary or anonymous flag, or a NATS generated subject.
function certainlyNamesNoQueue(span: StoredSpan): boolean {
  for (const key of MESSAGING_TEMPORARY_FLAG_ATTRIBUTES) {
    if (clickhouseLower(storedValue(span, key)) === "true") {
      return true;
    }
  }
  if (
    !natsSpellings().includes(
      clickhouseLower(storedValue(span, MESSAGING_SYSTEM_ATTRIBUTE)),
    )
  ) {
    return false;
  }
  const first: string = clickhouseLower(
    MESSAGING_DESTINATION_ATTRIBUTES.map((key: string): string => {
      return storedValue(span, key);
    }).find((value: string): boolean => {
      return value !== "";
    }) || "",
  );
  return MESSAGE_QUEUE_NATS_GENERATED_SUBJECTS.some(
    (subject: string): boolean => {
      return first === subject || first.startsWith(`${subject}.`);
    },
  );
}

/**
 * The value of every attribute the span query selects for this span, by
 * key, after rules 2 and 3 — or null when rule 1 leaves the span out.
 */
export function foldStoredSpan(
  span: StoredSpan,
): Record<string, string> | null {
  if (certainlyNamesNoQueue(span)) {
    return null;
  }

  const destinations: Array<string> = MESSAGING_DESTINATION_ATTRIBUTES.map(
    (key: string): string => {
      return storedValue(span, key);
    },
  );
  const joined: string = destinations.join("");
  const anyText: boolean = destinations.some(certainlyHoldsText);
  const routingKeyUnread: boolean =
    anyText &&
    !joined.includes(":") &&
    !joined.includes(",") &&
    !MESSAGE_QUEUE_RABBITMQ_DEFAULT_EXCHANGES.some(
      (exchange: string): boolean => {
        return clickhouseLower(joined).includes(exchange);
      },
    );

  const folded: Record<string, string> = {};
  for (const key of MESSAGING_RESOLVER_INPUT_ATTRIBUTES) {
    const value: string = storedValue(span, key);
    const position: number = MESSAGING_DESTINATION_ATTRIBUTES.indexOf(key);
    if (position > 0) {
      folded[key] =
        destinations.slice(0, position).some(certainlyHoldsText) &&
        certainlyHoldsText(value)
          ? MESSAGE_QUEUE_DISCOVERY_SHADOWED_VALUE
          : value;
    } else if (RABBITMQ_ROUTING_KEY_ATTRIBUTES.includes(key)) {
      folded[key] = routingKeyUnread ? "" : value;
    } else {
      folded[key] = value;
    }
  }
  return folded;
}

/*
 * The group a span lands in, as a comparable text: its kind (NULL apart
 * from '') and every selected column after the fold. Null when the query
 * does not read the span or rule 1 leaves it out.
 */
export function spanQueryGroupKey(span: StoredSpan): string | null {
  if (!isReadBySpanQuery(span)) {
    return null;
  }
  const folded: Record<string, string> | null = foldStoredSpan(span);
  if (!folded) {
    return null;
  }
  return JSON.stringify([
    span.kind,
    ...MESSAGING_RESOLVER_INPUT_ATTRIBUTES.map((key: string): string => {
      return folded[key]!;
    }),
  ]);
}

// The same text for a row the span query returned.
export function spanQueryRowGroupKey(row: MessagingSpanDiscoveryRow): string {
  return JSON.stringify([
    row.kind ?? null,
    ...MESSAGING_RESOLVER_INPUT_ATTRIBUTES.map(
      (_key: string, index: number): string => {
        return String(row[getMessagingDiscoveryColumn(index)] ?? "");
      },
    ),
  ]);
}

// A span query row carrying the folded values, as ClickHouse returns one.
export function foldedSpanRow(
  kind: string | null,
  folded: Record<string, string>,
  overrides: Partial<MessagingSpanDiscoveryRow> = {},
): MessagingSpanDiscoveryRow {
  const row: MessagingSpanDiscoveryRow = {
    kind: kind,
    spanCount: "1",
    errorCount: "0",
    lastSeenUnixMs: "1790243100123",
  };
  MESSAGING_RESOLVER_INPUT_ATTRIBUTES.forEach(
    (key: string, index: number): void => {
      row[getMessagingDiscoveryColumn(index)] = folded[key];
    },
  );
  return { ...row, ...overrides };
}
