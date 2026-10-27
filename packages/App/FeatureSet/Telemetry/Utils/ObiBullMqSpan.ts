import type { SpanKind } from "Common/Models/AnalyticsModels/Span";
import {
  CLIENT_SPAN_KIND,
  CONSUMER_SPAN_KIND,
  MutableSpanAttributeMap,
  SpanAttributeMap,
  hasAnyValue,
  isObiSpan,
  readNonEmptyString,
} from "./ObiSpan";

/*
 * OBI (OpenTelemetry eBPF Instrumentation, the Kubernetes agent's tracer)
 * records the Redis commands an application sends, so BullMQ — a job queue
 * kept in Redis — reaches OneUptime as Redis calls, mostly `evalsha` of one
 * of BullMQ's Lua scripts. From production:
 *
 *   name           evalsha
 *   db.query.text  evalsha d898c9a1b24ab7ed9510995fa28eb5874d0cf10e 9
 *                  bull:Telemetry:wait bull:Telemetry:paused
 *                  bull:Telemetry:meta bull:Telemetry:id
 *                  bull:Telemetry:completed bull:Telemetry:delayed
 *
 * OBI reads only the start of a long command, so a script's text often stops
 * after a few keys — sometimes in the middle of one — before its arguments.
 * The script's SHA is no help (it changes whenever BullMQ changes the
 * script), but the keys are: every script documents its KEYS (bullmq's
 * `commands/<script>-<number of keys>.lua`), each key is
 * `<prefix>:<queue>:<suffix>`, and the number of keys and the order of the
 * suffixes tell the scripts apart. BULLMQ_SCRIPT_SIGNATURES lists the ones
 * read here, in every order BullMQ 5.0 to 6.x gives them (checked against
 * the released packages):
 *
 *   publish  addStandardJob, addPrioritizedJob, addDelayedJob, addParentJob:
 *            a job added to the queue;
 *   receive  moveToActive: a worker asking for the next job;
 *   settle   moveToFinished: a worker recording a job's result (completed,
 *            or failed for good).
 *
 * plus the worker's blocking pop on the queue's marker
 * (`bzpopmin bull:<queue>:marker <timeout>`), a receive: a worker with
 * nothing to do waits there for a job to be added.
 *
 * A call is read as a script only when the number of keys is that script's
 * and every key the text shows is the one the script names there, all with
 * one `<prefix>:<queue>`, and at least the script's first `requiredKeys`
 * keys are shown whole: two, or for an add script up to its `id` key (the
 * queue's job counter), which only adding a job reads — changePriority and
 * pause start like addStandardJob of BullMQ 5.0, and differ at that key.
 * The key the text stops in may be cut short, so that one alone is not
 * compared. The prefix is BullMQ's `prefix` option, `bull` unless set, and
 * may be anything, a `:` included; a queue's name cannot hold a `:`
 * (BullMQ refuses one), so the queue is what follows the base's last `:`.
 * A blocking pop names one key, which cannot show that a custom prefix is
 * BullMQ's, so only the default prefix is read there.
 *
 * Such a span gets the messaging attributes the Queues product reads, the
 * ones OneUptime's docs have BullMQ's own telemetry carry —
 * messaging.system `bullmq` and messaging.destination.name the queue — with
 * messaging.operation.type `send`, `receive` or `settle`,
 * messaging.operation.name `publish`, `receive` or `settle`, and the
 * messaging span name `{operation} {queue}` (`publish Telemetry`). Its db.*
 * attributes are kept: it is still a Redis call.
 *
 * Its kind decides where the Queues product counts it. Ingest gives every
 * messaging span that is not SERVER its queue's key (MessagingEntityKeys),
 * and a queue's page then reads PRODUCER spans as publishes, the CLIENT
 * sends of a service that records no PRODUCER span as its publishes
 * instead, and CONSUMER spans as messages consumed; the Databases product
 * and the service map read a Redis call from its CLIENT span. So:
 *
 *   - a publish stays CLIENT, as a send: its service is a producer of the
 *     queue, it is never counted twice beside a PRODUCER span the same
 *     service's SDK records, and the call still counts towards Redis;
 *   - a receive stays CLIENT: the blocking pop returns a marker, not a job,
 *     and a busy worker calls moveToActive only when it has run dry —
 *     moveToFinished takes the next job in the same call — so neither says
 *     how many jobs were consumed;
 *   - a settle is stored as CONSUMER: moveToFinished runs once for every
 *     job a worker processes, so the queue counts each job consumed once,
 *     and the services whose workers take its jobs are its consumers. The
 *     costs: these calls leave the Redis counts of the Databases product,
 *     which reads CLIENT spans, and the processing time a queue's page
 *     shows is the time this call took, not the job's — OBI never sees a
 *     job run.
 *
 * Left alone: every other script (extendLock, retryJob, moveToDelayed,
 * moveStalledJobsToWait, addJobScheduler, …); EVAL, which sends the script
 * itself; BullMQ 4 and earlier, whose scripts take other keys and whose
 * worker pops the job's id with BRPOPLPUSH; and every span that is not an
 * OBI CLIENT span of a Redis call, among them the SERVER spans OBI records
 * inside Redis itself. Only the start of the text is read, a word at a
 * time, whatever its length.
 */

export type ObiBullMqOperation = "publish" | "receive" | "settle";

export interface ObiBullMqCall {
  operation: ObiBullMqOperation;
  // The queue, as BullMQ names it.
  queue: string;
  // The key prefix: BullMQ's `prefix` option, `bull` unless set.
  prefix: string;
  // What BullMQ ran: the script, or the blocking pop.
  command: string;
}

export const BULLMQ_MESSAGING_SYSTEM: string = "bullmq";

// BullMQ's key prefix when its `prefix` option is not set.
export const BULLMQ_DEFAULT_PREFIX: string = "bull";

// messaging.operation.type per operation (a publish is a send since semconv 1.28).
export const BULLMQ_OPERATION_TYPES: Readonly<
  Record<ObiBullMqOperation, string>
> = {
  publish: "send",
  receive: "receive",
  settle: "settle",
};

/*
 * One key of a script: the suffixes it may end in after `<prefix>:<queue>:`,
 * or null for a key of its own shape (the job's key, `<prefix>:<queue>:<id>`).
 */
type BullMqKey = string | ReadonlyArray<string> | null;

export interface BullMqScriptSignature {
  script: string;
  operation: ObiBullMqOperation;
  // The script's KEYS, in order.
  keys: ReadonlyArray<BullMqKey>;
  /*
   * How many leading keys a call must show whole: through the one that
   * tells the script apart from every other script with as many keys.
   */
  requiredKeys: number;
}

/*
 * BullMQ's scripts as their KEYS name them, from the released packages:
 * addStandardJob has 7 keys in 5.0, 8 from 5.12 and 9 from 5.60 to 6.x;
 * addPrioritizedJob 7, 8 and 9 alike; addParentJob 4 up to 5.45, 5 in 5.60
 * and 6 from 5.76; addDelayedJob 6, moveToActive 11 and moveToFinished 14
 * from 5.0 to 6.x.
 */
export const BULLMQ_SCRIPT_SIGNATURES: ReadonlyArray<BullMqScriptSignature> = [
  {
    script: "addStandardJob",
    operation: "publish",
    keys: ["wait", "paused", "meta", "id", "completed", "events", "marker"],
    requiredKeys: 4,
  },
  {
    script: "addStandardJob",
    operation: "publish",
    keys: [
      "wait",
      "paused",
      "meta",
      "id",
      "completed",
      "active",
      "events",
      "marker",
    ],
    requiredKeys: 4,
  },
  {
    script: "addStandardJob",
    operation: "publish",
    keys: [
      "wait",
      "paused",
      "meta",
      "id",
      "completed",
      "delayed",
      "active",
      "events",
      "marker",
    ],
    requiredKeys: 4,
  },
  {
    script: "addPrioritizedJob",
    operation: "publish",
    keys: ["marker", "meta", "id", "prioritized", "completed", "events", "pc"],
    requiredKeys: 3,
  },
  {
    script: "addPrioritizedJob",
    operation: "publish",
    keys: [
      "marker",
      "meta",
      "id",
      "prioritized",
      "completed",
      "active",
      "events",
      "pc",
    ],
    requiredKeys: 3,
  },
  {
    script: "addPrioritizedJob",
    operation: "publish",
    keys: [
      "marker",
      "meta",
      "id",
      "prioritized",
      "delayed",
      "completed",
      "active",
      "events",
      "pc",
    ],
    requiredKeys: 3,
  },
  {
    script: "addDelayedJob",
    operation: "publish",
    keys: ["marker", "meta", "id", "delayed", "completed", "events"],
    requiredKeys: 3,
  },
  {
    script: "addParentJob",
    operation: "publish",
    keys: ["meta", "id", "completed", "events"],
    requiredKeys: 2,
  },
  {
    script: "addParentJob",
    operation: "publish",
    keys: ["meta", "id", "delayed", "completed", "events"],
    requiredKeys: 2,
  },
  {
    script: "addParentJob",
    operation: "publish",
    keys: ["meta", "id", "delayed", "waiting-children", "completed", "events"],
    requiredKeys: 2,
  },
  {
    script: "moveToActive",
    operation: "receive",
    keys: [
      "wait",
      "active",
      "prioritized",
      "events",
      "stalled",
      "limiter",
      "delayed",
      "paused",
      "meta",
      "pc",
      "marker",
    ],
    requiredKeys: 2,
  },
  {
    script: "moveToFinished",
    operation: "settle",
    keys: [
      "wait",
      "active",
      "prioritized",
      "events",
      "stalled",
      "limiter",
      "delayed",
      "paused",
      "meta",
      "pc",
      ["completed", "failed"],
      null,
      ["metrics:completed", "metrics:failed"],
      "marker",
    ],
    requiredKeys: 2,
  },
];

const EVALSHA_COMMAND: string = "evalsha";
const BLOCKING_POP_COMMAND: string = "bzpopmin";
const MARKER_SUFFIX: string = "marker";

// No BullMQ script takes more keys; a larger count is not BullMQ's.
const MAX_SCRIPT_KEYS: number = Math.max(
  ...BULLMQ_SCRIPT_SIGNATURES.map(
    (signature: BullMqScriptSignature): number => {
      return signature.keys.length;
    },
  ),
);

// EVALSHA <sha> <numkeys> <keys…>: the words before the first key.
const EVALSHA_KEYS_START: number = 3;

const SHA1_HEX_LENGTH: number = 40;

// Keys as the ingest service's per-span attribute map holds them.
const DB_SYSTEM_ATTRIBUTES: ReadonlyArray<string> = [
  "db.system.name",
  "db.system",
];
const DB_QUERY_TEXT_ATTRIBUTE: string = "db.query.text";
const MESSAGING_SYSTEM_ATTRIBUTE: string = "messaging.system";
// A span that names a messaging system already is some other client's.
const MESSAGING_SYSTEM_ATTRIBUTES: ReadonlyArray<string> = [
  MESSAGING_SYSTEM_ATTRIBUTE,
];
const MESSAGING_DESTINATION_NAME_ATTRIBUTE: string =
  "messaging.destination.name";
const MESSAGING_OPERATION_TYPE_ATTRIBUTE: string = "messaging.operation.type";
const MESSAGING_OPERATION_NAME_ATTRIBUTE: string = "messaging.operation.name";

const REDIS_DB_SYSTEM: string = "redis";

// ---- reading the command ----------------------------------------------------

function isWhiteSpaceCode(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

interface LeadingWords {
  words: Array<string>;
  // Whether the text goes on after the last word read.
  more: boolean;
}

/*
 * The text's first `limit` words, split on white space, read a character at
 * a time and no further: a command's text can be very long.
 */
function readLeadingWords(text: string, limit: number): LeadingWords {
  const words: Array<string> = [];
  let index: number = 0;
  while (index < text.length) {
    while (index < text.length && isWhiteSpaceCode(text.charCodeAt(index))) {
      index++;
    }
    if (index >= text.length) {
      break;
    }
    if (words.length === limit) {
      return { words: words, more: true };
    }
    const start: number = index;
    while (index < text.length && !isWhiteSpaceCode(text.charCodeAt(index))) {
      index++;
    }
    words.push(text.slice(start, index));
  }
  return { words: words, more: false };
}

function isDigitCode(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

// A count written in decimal digits, from 1 to `max`; null for anything else.
function readCount(word: string | undefined, max: number): number | null {
  if (!word || word.length > 3) {
    return null;
  }
  for (let index: number = 0; index < word.length; index++) {
    if (!isDigitCode(word.charCodeAt(index))) {
      return null;
    }
  }
  const count: number = Number(word);
  return count >= 1 && count <= max ? count : null;
}

function isHexDigitCode(code: number): boolean {
  return (
    isDigitCode(code) ||
    (code >= 0x41 && code <= 0x46) ||
    (code >= 0x61 && code <= 0x66)
  );
}

// A script's SHA-1, as EVALSHA names it: 40 hexadecimal digits.
function isSha1Hex(word: string | undefined): boolean {
  if (!word || word.length !== SHA1_HEX_LENGTH) {
    return false;
  }
  for (let index: number = 0; index < word.length; index++) {
    if (!isHexDigitCode(word.charCodeAt(index))) {
      return false;
    }
  }
  return true;
}

// A timeout in seconds as BullMQ sends one: digits, with at most one point.
function isTimeout(word: string | undefined): boolean {
  if (!word) {
    return false;
  }
  let digits: number = 0;
  let points: number = 0;
  for (let index: number = 0; index < word.length; index++) {
    const code: number = word.charCodeAt(index);
    if (isDigitCode(code)) {
      digits++;
    } else if (code === 0x2e) {
      points++;
    } else {
      return false;
    }
  }
  return digits > 0 && points <= 1;
}

interface QueueBase {
  prefix: string;
  queue: string;
}

/*
 * `<prefix>:<queue>` split at its last ":" (a queue's name holds none), or
 * null when either side is empty.
 */
function splitQueueBase(base: string): QueueBase | null {
  const colon: number = base.lastIndexOf(":");
  if (colon <= 0 || colon === base.length - 1) {
    return null;
  }
  return { prefix: base.slice(0, colon), queue: base.slice(colon + 1) };
}

function suffixesOf(key: BullMqKey): ReadonlyArray<string> | null {
  return typeof key === "string" ? [key] : key;
}

/*
 * Whether `word` is the key a script names at a position: `keyStart` (the
 * queue's `<prefix>:<queue>:`) and then one of its suffixes.
 */
function isScriptKey(word: string, keyStart: string, key: BullMqKey): boolean {
  if (!word.startsWith(keyStart)) {
    return false;
  }
  const suffixes: ReadonlyArray<string> | null = suffixesOf(key);
  if (suffixes === null) {
    // A job's key: the queue's, then the job's id.
    return word.length > keyStart.length;
  }
  for (const suffix of suffixes) {
    if (
      word.length === keyStart.length + suffix.length &&
      word.endsWith(suffix)
    ) {
      return true;
    }
  }
  return false;
}

/*
 * The queue a call of one script names, or null when the keys the text
 * shows are not that script's (see the rule above). `lastMayBeCut`: the
 * text stops at, or in, the last key shown.
 */
function matchScript(
  signature: BullMqScriptSignature,
  keys: ReadonlyArray<string>,
  lastMayBeCut: boolean,
): QueueBase | null {
  const firstKey: string | undefined = keys[0];
  const firstSuffixes: ReadonlyArray<string> | null = suffixesOf(
    signature.keys[0] ?? null,
  );
  if (firstKey === undefined || firstSuffixes === null) {
    return null;
  }

  let base: string | null = null;
  for (const suffix of firstSuffixes) {
    if (firstKey.endsWith(`:${suffix}`)) {
      base = firstKey.slice(0, firstKey.length - suffix.length - 1);
      break;
    }
  }
  const queueBase: QueueBase | null =
    base === null ? null : splitQueueBase(base);
  if (base === null || queueBase === null) {
    return null;
  }

  const keyStart: string = `${base}:`;
  let whole: number = 0;
  for (let index: number = 0; index < keys.length; index++) {
    const word: string = keys[index]!;
    if (isScriptKey(word, keyStart, signature.keys[index] ?? null)) {
      whole++;
      continue;
    }
    // Only the key the text stops in may differ: it may be cut.
    if (!(lastMayBeCut && index === keys.length - 1)) {
      return null;
    }
  }

  return whole >= signature.requiredKeys ? queueBase : null;
}

// An EVALSHA of one of BullMQ's scripts, or null.
function readScriptCall(text: string): ObiBullMqCall | null {
  const read: LeadingWords = readLeadingWords(
    text,
    EVALSHA_KEYS_START + MAX_SCRIPT_KEYS + 1,
  );
  const words: Array<string> = read.words;
  if (!isSha1Hex(words[1])) {
    return null;
  }
  const keyCount: number | null = readCount(words[2], MAX_SCRIPT_KEYS);
  if (keyCount === null) {
    return null;
  }

  const keys: Array<string> = words.slice(
    EVALSHA_KEYS_START,
    EVALSHA_KEYS_START + keyCount,
  );
  /*
   * A script always takes arguments after its keys: a text that shows none
   * was cut, at or in the last key it shows.
   */
  const lastMayBeCut: boolean = words.length <= EVALSHA_KEYS_START + keyCount;

  let found: ObiBullMqCall | null = null;
  for (const signature of BULLMQ_SCRIPT_SIGNATURES) {
    if (signature.keys.length !== keyCount) {
      continue;
    }
    const queueBase: QueueBase | null = matchScript(
      signature,
      keys,
      lastMayBeCut,
    );
    if (queueBase === null) {
      continue;
    }
    if (
      found !== null &&
      (found.operation !== signature.operation ||
        found.queue !== queueBase.queue ||
        found.prefix !== queueBase.prefix)
    ) {
      // Two readings that disagree: neither is certain.
      return null;
    }
    found = found || {
      operation: signature.operation,
      queue: queueBase.queue,
      prefix: queueBase.prefix,
      command: signature.script,
    };
  }
  return found;
}

// `bzpopmin bull:<queue>:marker <timeout>`, the worker's wait, or null.
function readBlockingPop(text: string): ObiBullMqCall | null {
  const read: LeadingWords = readLeadingWords(text, 3);
  const key: string | undefined = read.words[1];
  if (
    read.more ||
    read.words.length !== 3 ||
    key === undefined ||
    !isTimeout(read.words[2]) ||
    !key.startsWith(`${BULLMQ_DEFAULT_PREFIX}:`) ||
    !key.endsWith(`:${MARKER_SUFFIX}`)
  ) {
    return null;
  }

  const queueBase: QueueBase | null = splitQueueBase(
    key.slice(0, key.length - MARKER_SUFFIX.length - 1),
  );
  if (queueBase === null || queueBase.prefix !== BULLMQ_DEFAULT_PREFIX) {
    return null;
  }
  return {
    operation: "receive",
    queue: queueBase.queue,
    prefix: queueBase.prefix,
    command: BLOCKING_POP_COMMAND,
  };
}

// The command a text starts with, lower-cased, read no further than it.
function readCommand(text: string): string {
  const read: LeadingWords = readLeadingWords(text, 1);
  return (read.words[0] || "").toLowerCase();
}

// ---- the rule ---------------------------------------------------------------

/**
 * The BullMQ operation an OBI span of a Redis call is, or null when it is
 * none (see the rule above). Returns after a few property reads for a span
 * that is not an OBI CLIENT span of a Redis call.
 */
export function readObiBullMqCall(data: {
  kind: SpanKind;
  attributes: SpanAttributeMap | null | undefined;
}): ObiBullMqCall | null {
  const attributes: SpanAttributeMap | null | undefined = data.attributes;
  if (
    data.kind !== CLIENT_SPAN_KIND ||
    !attributes ||
    !isObiSpan(attributes) ||
    hasAnyValue(attributes, MESSAGING_SYSTEM_ATTRIBUTES)
  ) {
    return null;
  }

  let isRedis: boolean = false;
  for (const key of DB_SYSTEM_ATTRIBUTES) {
    const system: string | null = readNonEmptyString(attributes, key);
    if (system !== null) {
      isRedis = system === REDIS_DB_SYSTEM;
      break;
    }
  }
  if (!isRedis) {
    return null;
  }

  const text: string | null = readNonEmptyString(
    attributes,
    DB_QUERY_TEXT_ATTRIBUTE,
  );
  if (text === null) {
    return null;
  }

  const command: string = readCommand(text);
  if (command === EVALSHA_COMMAND) {
    return readScriptCall(text);
  }
  if (command === BLOCKING_POP_COMMAND) {
    return readBlockingPop(text);
  }
  return null;
}

// The messaging span name: `{operation} {queue}`.
export function getObiBullMqSpanName(call: ObiBullMqCall): string {
  return `${call.operation} ${call.queue}`;
}

// The kind a call is stored as: a settle is CONSUMER, the rest keep theirs.
export function getObiBullMqSpanKind(
  call: ObiBullMqCall,
  kind: SpanKind,
): SpanKind {
  return call.operation === "settle" ? CONSUMER_SPAN_KIND : kind;
}

/**
 * Gives an OBI span of a BullMQ call its messaging attributes, and returns
 * the name and kind it is stored with; null (and nothing changed) for any
 * other span.
 */
export function applyObiBullMqSpan(data: {
  kind: SpanKind;
  attributes: MutableSpanAttributeMap | null | undefined;
}): { name: string; kind: SpanKind } | null {
  const call: ObiBullMqCall | null = readObiBullMqCall(data);
  if (!call || !data.attributes) {
    return null;
  }

  const attributes: MutableSpanAttributeMap = data.attributes;
  attributes[MESSAGING_SYSTEM_ATTRIBUTE] = BULLMQ_MESSAGING_SYSTEM;
  attributes[MESSAGING_DESTINATION_NAME_ATTRIBUTE] = call.queue;
  attributes[MESSAGING_OPERATION_TYPE_ATTRIBUTE] =
    BULLMQ_OPERATION_TYPES[call.operation];
  attributes[MESSAGING_OPERATION_NAME_ATTRIBUTE] = call.operation;

  return {
    name: getObiBullMqSpanName(call),
    kind: getObiBullMqSpanKind(call, data.kind),
  };
}
