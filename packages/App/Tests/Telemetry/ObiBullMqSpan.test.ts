import {
  BULLMQ_DEFAULT_PREFIX,
  BULLMQ_MESSAGING_SYSTEM,
  BULLMQ_OPERATION_TYPES,
  BULLMQ_SCRIPT_SIGNATURES,
  BullMqScriptSignature,
  ObiBullMqCall,
  applyObiBullMqSpan,
  getObiBullMqSpanKind,
  getObiBullMqSpanName,
  readObiBullMqCall,
} from "../../FeatureSet/Telemetry/Utils/ObiBullMqSpan";
import type { SpanKind } from "Common/Models/AnalyticsModels/Span";
import { describe, expect, test } from "@jest/globals";

/*
 * OBI records BullMQ's work as Redis calls: an `evalsha` of one of BullMQ's
 * Lua scripts, or the worker's blocking pop on its queue's marker. Ingest
 * reads which script ran from the keys OBI's (often cut) text shows, and
 * gives a publish, a receive and a settle their queue. These pin:
 *
 *   - the production span, as OBI v0.14 recorded it;
 *   - every script read here, in each of the key orders BullMQ 5.0 to 6.x
 *     gives it, with any prefix, cut at every character: read exactly when
 *     the keys that tell the script apart are shown whole;
 *   - every other script of BullMQ 5.76 and 6.5, cut anywhere: never read;
 *   - Redis calls that are no BullMQ's, SERVER spans and SDK spans: left
 *     alone;
 *   - the attributes, name and kind a call is stored with.
 *
 * Span attributes are the maps the ingest service builds: span keys bare,
 * resource keys `resource.`-prefixed.
 */

type Attributes = Record<string, unknown>;

// SpanKind's values, checked against the enum when this compiles.
function spanKind(text: `${SpanKind}`): SpanKind {
  return text as SpanKind;
}

const CLIENT: SpanKind = spanKind("SPAN_KIND_CLIENT");
const SERVER: SpanKind = spanKind("SPAN_KIND_SERVER");
const PRODUCER: SpanKind = spanKind("SPAN_KIND_PRODUCER");
const CONSUMER: SpanKind = spanKind("SPAN_KIND_CONSUMER");
const INTERNAL: SpanKind = spanKind("SPAN_KIND_INTERNAL");

const SHA: string = "d898c9a1b24ab7ed9510995fa28eb5874d0cf10e";

// What OBI wrote for an addStandardJob on OneUptime's Telemetry queue.
const PRODUCTION_QUERY_TEXT: string =
  "evalsha d898c9a1b24ab7ed9510995fa28eb5874d0cf10e 9 bull:Telemetry:wait bull:Telemetry:paused bull:Telemetry:meta bull:Telemetry:id bull:Telemetry:completed bull:Telemetry:delayed";

const OBI_RESOURCE: Attributes = {
  "resource.service.name": "oneuptime-app",
  "resource.telemetry.sdk.language": "nodejs",
  "resource.telemetry.distro.name": "opentelemetry-ebpf-instrumentation",
  "resource.telemetry.distro.version": "v0.14.0",
  "resource.k8s.namespace.name": "default",
};

// OBI's span of a Redis command, as in production.
function redisCall(queryText: string, overrides: Attributes = {}): Attributes {
  const space: number = queryText.indexOf(" ");
  const command: string = space === -1 ? queryText : queryText.slice(0, space);
  return {
    ...OBI_RESOURCE,
    "server.address": "oneuptime-valkey-master",
    "server.port": "6379",
    "service.peer.name": "oneuptime-valkey-master",
    "db.system.name": "redis",
    "db.operation.name": command,
    "db.query.text": queryText,
    "network.peer.address": "10.96.100.12",
    "network.peer.port": "6379",
    ...overrides,
  };
}

function read(
  attributes: Attributes,
  kind: SpanKind = CLIENT,
): ObiBullMqCall | null {
  return readObiBullMqCall({ kind: kind, attributes: attributes });
}

function readText(queryText: string): ObiBullMqCall | null {
  return read(redisCall(queryText));
}

/*
 * BullMQ's arguments, as OBI would write the start of them: msgpack bytes
 * and a job's JSON. Only their presence is read.
 */
const ARGUMENTS: Array<string> = [
  "\u0098©bull:Telemetry: ",
  '{"projectId":"6f0d8bb1","body":"…"}',
  "\u0081¨attempts\u0003",
];

function evalsha(
  keys: ReadonlyArray<string>,
  args: Array<string> = ARGUMENTS,
): string {
  return ["evalsha", SHA, String(keys.length), ...keys, ...args].join(" ");
}

// A key a script names, as BullMQ builds it for `<prefix>:<queue>`.
type ScriptKey = string | ReadonlyArray<string> | null;

function keyOf(base: string, key: ScriptKey): string {
  if (key === null) {
    // A job's key.
    return `${base}:1042`;
  }
  return `${base}:${typeof key === "string" ? key : key[0]!}`;
}

function keysOf(base: string, keys: ReadonlyArray<ScriptKey>): Array<string> {
  return keys.map((key: ScriptKey): string => {
    return keyOf(base, key);
  });
}

// The signature of a script, its last listed when it has several.
function signatureOf(script: string): BullMqScriptSignature {
  const signatures: Array<BullMqScriptSignature> =
    BULLMQ_SCRIPT_SIGNATURES.filter(
      (signature: BullMqScriptSignature): boolean => {
        return signature.script === script;
      },
    );
  expect(signatures.length).toBeGreaterThan(0);
  return signatures[signatures.length - 1]!;
}

// The prefixes a queue may be keyed under, and the queue they key.
const PREFIXES: Array<string> = [
  BULLMQ_DEFAULT_PREFIX,
  "{bull}",
  "myapp:bull",
  "q",
];

describe("readObiBullMqCall: the production span", () => {
  test("OBI's addStandardJob on the Telemetry queue, cut after six of its nine keys: a publish", () => {
    expect(readText(PRODUCTION_QUERY_TEXT)).toEqual({
      operation: "publish",
      queue: "Telemetry",
      prefix: "bull",
      command: "addStandardJob",
    });
  });

  test("the command's case does not matter", () => {
    expect(
      readText(PRODUCTION_QUERY_TEXT.replace("evalsha", "EVALSHA")),
    ).toMatchObject({ operation: "publish", queue: "Telemetry" });
    expect(
      readText(PRODUCTION_QUERY_TEXT.replace(SHA, SHA.toUpperCase())),
    ).toMatchObject({ operation: "publish", queue: "Telemetry" });
  });
});

describe("readObiBullMqCall: every script read here, cut anywhere", () => {
  /*
   * Where in `text` each key ends: a key is whole once the text reaches its
   * last character.
   */
  function keyEnds(text: string, keys: ReadonlyArray<string>): Array<number> {
    const ends: Array<number> = [];
    let from: number = `evalsha ${SHA} ${keys.length} `.length;
    for (const key of keys) {
      const at: number = text.indexOf(key, from);
      ends.push(at + key.length);
      from = at + key.length + 1;
    }
    return ends;
  }

  test.each(
    BULLMQ_SCRIPT_SIGNATURES.map(
      (signature: BullMqScriptSignature): [string, BullMqScriptSignature] => {
        return [
          `${signature.script} (${signature.keys.length} keys)`,
          signature,
        ];
      },
    ),
  )(
    "%s: read exactly when its first requiredKeys keys are whole, with every prefix",
    (_label: string, signature: BullMqScriptSignature) => {
      for (const prefix of PREFIXES) {
        const base: string = `${prefix}:Telemetry`;
        const keys: Array<string> = keysOf(base, signature.keys);
        const text: string = evalsha(keys);
        const ends: Array<number> = keyEnds(text, keys);

        for (let cut: number = 0; cut <= text.length; cut++) {
          const whole: number = ends.filter((end: number): boolean => {
            return end <= cut;
          }).length;
          const expected: ObiBullMqCall | null =
            whole >= signature.requiredKeys
              ? {
                  operation: signature.operation,
                  queue: "Telemetry",
                  prefix: prefix,
                  command: signature.script,
                }
              : null;
          const actual: ObiBullMqCall | null = readText(text.slice(0, cut));
          if (JSON.stringify(actual) !== JSON.stringify(expected)) {
            // Report the one cut that went wrong, not thousands of passes.
            expect({ prefix: prefix, cut: text.slice(0, cut), actual }).toEqual(
              {
                prefix: prefix,
                cut: text.slice(0, cut),
                actual: expected,
              },
            );
          }
        }
      }
    },
  );

  test("every script needs two whole keys at least, an add script its id key", () => {
    for (const signature of BULLMQ_SCRIPT_SIGNATURES) {
      expect(signature.requiredKeys).toBeGreaterThanOrEqual(2);
      if (signature.operation === "publish") {
        expect(signature.keys[signature.requiredKeys - 1]).toBe("id");
      }
    }
  });

  test("no two scripts of as many keys start alike through the keys either requires", () => {
    for (const a of BULLMQ_SCRIPT_SIGNATURES) {
      for (const b of BULLMQ_SCRIPT_SIGNATURES) {
        if (a === b || a.keys.length !== b.keys.length) {
          continue;
        }
        const length: number = Math.min(a.requiredKeys, b.requiredKeys);
        expect({
          a: a.script,
          b: b.script,
          same:
            JSON.stringify(a.keys.slice(0, length)) ===
            JSON.stringify(b.keys.slice(0, length)),
        }).toEqual({ a: a.script, b: b.script, same: false });
      }
    }
  });

  test("a queue's name is what follows the prefix, which may hold ':' and braces", () => {
    expect(
      readText(
        evalsha(keysOf("a:b:c:Orders", signatureOf("moveToActive").keys)),
      ),
    ).toEqual({
      operation: "receive",
      queue: "Orders",
      prefix: "a:b:c",
      command: "moveToActive",
    });
    expect(
      readText(
        evalsha(
          keysOf("{bull}:Orders-v2_ü", signatureOf("moveToFinished").keys),
        ),
      ),
    ).toEqual({
      operation: "settle",
      queue: "Orders-v2_ü",
      prefix: "{bull}",
      command: "moveToFinished",
    });
  });

  test("moveToFinished reads alike whether it completes or fails the job", () => {
    const moveToFinished: BullMqScriptSignature = signatureOf("moveToFinished");
    for (const target of ["completed", "failed"]) {
      const keys: Array<string> = keysOf("bull:Telemetry", moveToFinished.keys);
      keys[10] = `bull:Telemetry:${target}`;
      keys[12] = `bull:Telemetry:metrics:${target}`;
      expect({ target: target, call: readText(evalsha(keys)) }).toEqual({
        target: target,
        call: {
          operation: "settle",
          queue: "Telemetry",
          prefix: "bull",
          command: "moveToFinished",
        },
      });
    }
  });
});

/*
 * BullMQ's other scripts, as their KEYS name them in 5.76.2 (and 6.5 where
 * it differs). `null` is a key of a job, the rest suffixes of the queue's
 * `<prefix>:<queue>:`; "" is the queue's base key itself.
 */
const OTHER_SCRIPTS: Array<[string, ReadonlyArray<ScriptKey>]> = [
  [
    "addJobScheduler",
    [
      "repeat",
      "delayed",
      "wait",
      "paused",
      "meta",
      "prioritized",
      "marker",
      "id",
      "events",
      "pc",
      "active",
    ],
  ],
  ["addLog", [null, "1042:logs"]],
  ["addRepeatableJob", ["repeat", "delayed"]],
  ["changeDelay", ["delayed", "meta", "marker", "events"]],
  [
    "changePriority",
    ["wait", "paused", "meta", "prioritized", "active", "pc", "marker"],
  ],
  ["cleanJobsInSet", ["completed", "events", "repeat"]],
  ["drain", ["wait", "paused", "delayed", "prioritized", "repeat"]],
  ["extendLock", ["1042:lock", "stalled"]],
  ["extendLocks", ["stalled"]],
  ["getCounts", [""]],
  ["getCountsPerPriority", ["wait", "paused", "meta", "prioritized"]],
  [
    "getDependencyCounts",
    ["1042:processed", "1042:dependencies", "1042:ignored", "1042:failed"],
  ],
  ["getMetrics", ["metrics:completed", "metrics:completed:data"]],
  ["getRateLimitTtl", ["limiter", "meta"]],
  [
    "getState",
    [
      "completed",
      "failed",
      "delayed",
      "active",
      "wait",
      "paused",
      "waiting-children",
      "prioritized",
    ],
  ],
  ["isFinished", ["completed", "failed", null]],
  ["isMaxed", ["meta", "active"]],
  [
    "moveJobFromActiveToWait",
    [
      "active",
      "wait",
      "stalled",
      "paused",
      "meta",
      "limiter",
      "prioritized",
      "marker",
      "events",
    ],
  ],
  [
    "moveJobsToWait",
    ["", "events", "failed", "wait", "paused", "meta", "active", "marker"],
  ],
  [
    "moveStalledJobsToWait",
    [
      "stalled",
      "wait",
      "active",
      "stalled-check",
      "meta",
      "paused",
      "marker",
      "events",
    ],
  ],
  [
    "moveStalledJobsToWait (6.x)",
    [
      "stalled",
      "wait",
      "active",
      "stalled-check",
      "meta",
      "paused",
      "marker",
      "events",
      "repeat",
    ],
  ],
  [
    "moveToDelayed",
    [
      "marker",
      "active",
      "prioritized",
      "delayed",
      null,
      "events",
      "meta",
      "stalled",
      "wait",
      "limiter",
      "paused",
      "pc",
    ],
  ],
  [
    "moveToDelayed (6.5)",
    [
      "marker",
      "active",
      "prioritized",
      "delayed",
      null,
      "events",
      "meta",
      "stalled",
      "wait",
      "limiter",
      "pc",
    ],
  ],
  [
    "moveToWaitingChildren",
    [
      "active",
      "waiting-children",
      null,
      "1042:dependencies",
      "1042:unsuccessful",
      "stalled",
      "events",
    ],
  ],
  ["obliterate", ["meta", ""]],
  [
    "pause",
    ["wait", "paused", "meta", "prioritized", "events", "delayed", "marker"],
  ],
  [
    "resume",
    ["paused", "wait", "meta", "prioritized", "events", "delayed", "marker"],
  ],
  [
    "promote",
    [
      "delayed",
      "wait",
      "paused",
      "meta",
      "prioritized",
      "active",
      "pc",
      "events",
      "marker",
    ],
  ],
  ["releaseLock", ["1042:lock"]],
  ["removeJob", [null, "repeat"]],
  ["removeJobScheduler", ["repeat", "delayed", "events"]],
  ["removeUnprocessedChildren", [null, "meta"]],
  [
    "reprocessJob",
    [null, "events", "failed", "wait", "meta", "paused", "active", "marker"],
  ],
  [
    "reprocessJob (6.5)",
    [
      null,
      "events",
      "failed",
      "wait",
      "meta",
      "active",
      "marker",
      "prioritized",
      "pc",
    ],
  ],
  [
    "retryJob",
    [
      "active",
      "wait",
      "paused",
      null,
      "meta",
      "events",
      "delayed",
      "prioritized",
      "pc",
      "marker",
      "stalled",
    ],
  ],
  ["updateData", [null]],
  [
    "updateJobScheduler",
    [
      "repeat",
      "delayed",
      "wait",
      "paused",
      "meta",
      "prioritized",
      "marker",
      "id",
      "events",
      "pc",
      null,
      "active",
    ],
  ],
  ["updateProgress", [null, "events", "meta"]],
];

describe("readObiBullMqCall: BullMQ's other scripts are left alone", () => {
  function otherKeyOf(base: string, key: ScriptKey): string {
    return key === "" ? `${base}:` : keyOf(base, key);
  }

  test.each(OTHER_SCRIPTS)(
    "%s, cut anywhere, with every prefix",
    (_script: string, scriptKeys: ReadonlyArray<ScriptKey>) => {
      for (const prefix of PREFIXES) {
        const keys: Array<string> = scriptKeys.map((key: ScriptKey): string => {
          return otherKeyOf(`${prefix}:Telemetry`, key);
        });
        const text: string = evalsha(keys);
        for (let cut: number = 0; cut <= text.length; cut++) {
          const actual: ObiBullMqCall | null = readText(text.slice(0, cut));
          if (actual !== null) {
            expect({ cut: text.slice(0, cut), actual }).toEqual({
              cut: text.slice(0, cut),
              actual: null,
            });
          }
        }
      }
    },
  );
});

describe("readObiBullMqCall: Redis calls that are no BullMQ script", () => {
  test.each([
    [
      "a rate limiter's script",
      `evalsha ${SHA} 2 ratelimit:user:42 ratelimit:user:42:ts 10 60`,
    ],
    [
      "Sidekiq-style keys",
      `evalsha ${SHA} 3 queue:default queue:critical stat:processed 1`,
    ],
    [
      "the right suffixes on two queues",
      `evalsha ${SHA} 9 bull:A:wait bull:B:paused bull:A:meta bull:A:id bull:A:completed bull:A:delayed bull:A:active bull:A:events bull:A:marker x`,
    ],
    [
      "the right keys, the wrong number of them",
      `evalsha ${SHA} 8 bull:Q:wait bull:Q:paused bull:Q:meta bull:Q:id bull:Q:completed bull:Q:delayed bull:Q:active bull:Q:events x`,
    ],
    [
      "addStandardJob's keys in another order",
      `evalsha ${SHA} 9 bull:Q:paused bull:Q:wait bull:Q:meta bull:Q:id bull:Q:completed bull:Q:delayed bull:Q:active bull:Q:events bull:Q:marker x`,
    ],
    [
      "a key without a queue",
      `evalsha ${SHA} 11 bull:wait bull:active bull:prioritized bull:events bull:stalled bull:limiter bull:delayed bull:paused bull:meta bull:pc bull:marker x`,
    ],
    [
      "an empty queue",
      `evalsha ${SHA} 11 bull::wait bull::active bull::prioritized x`,
    ],
    ["an empty prefix", `evalsha ${SHA} 11 :Q:wait :Q:active :Q:prioritized x`],
    ["no SHA", `evalsha 11 bull:Q:wait bull:Q:active bull:Q:prioritized x`],
    [
      "a SHA that is not hexadecimal",
      `evalsha ${SHA.slice(0, 39)}g 11 bull:Q:wait bull:Q:active x`,
    ],
    ["a SHA cut short", `evalsha ${SHA.slice(0, 20)}`],
    ["no key count", `evalsha ${SHA} bull:Q:wait bull:Q:active x`],
    ["a key count of zero", `evalsha ${SHA} 0 x`],
    [
      "a key count beyond any script's",
      `evalsha ${SHA} 99 bull:Q:wait bull:Q:active x`,
    ],
    ["a signed key count", `evalsha ${SHA} +11 bull:Q:wait bull:Q:active x`],
    [
      "EVAL, which sends the script itself",
      `eval --[[ Adds a job ]] local rcall = redis.call 9 bull:Q:wait bull:Q:paused bull:Q:meta bull:Q:id`,
    ],
    [
      "EVALSHA_RO",
      `evalsha_ro ${SHA} 9 bull:Q:wait bull:Q:paused bull:Q:meta bull:Q:id x`,
    ],
    ["a plain command", "get bull:Telemetry:meta"],
    [
      "BullMQ 4's blocking pop",
      "brpoplpush bull:Telemetry:wait bull:Telemetry:active 5",
    ],
    ["an empty text", ""],
    ["white space", "   "],
  ])("%s", (_label: string, queryText: string) => {
    expect(readText(queryText)).toBeNull();
  });
});

describe("readObiBullMqCall: the blocking pop on a queue's marker", () => {
  test("bzpopmin of bull:<queue>:marker with a timeout: a receive", () => {
    for (const timeout of ["5", "10", "0.001", "4.999", "0"]) {
      expect({
        timeout: timeout,
        call: readText(`bzpopmin bull:Telemetry:marker ${timeout}`),
      }).toEqual({
        timeout: timeout,
        call: {
          operation: "receive",
          queue: "Telemetry",
          prefix: "bull",
          command: "bzpopmin",
        },
      });
    }
    expect(readText("BZPOPMIN bull:Telemetry:marker 5")).toMatchObject({
      operation: "receive",
      queue: "Telemetry",
    });
  });

  test.each([
    [
      "a custom prefix: one key cannot show it is BullMQ's",
      "bzpopmin {bull}:Telemetry:marker 5",
    ],
    ["a prefix holding ':'", "bzpopmin bull:a:Telemetry:marker 5"],
    ["another key of the queue", "bzpopmin bull:Telemetry:wait 5"],
    ["a marker of no queue", "bzpopmin bull::marker 5"],
    ["a bare marker", "bzpopmin bull:marker 5"],
    ["no timeout", "bzpopmin bull:Telemetry:marker"],
    ["a timeout that is no number", "bzpopmin bull:Telemetry:marker soon"],
    ["a timeout with two points", "bzpopmin bull:Telemetry:marker 1.2.3"],
    ["two keys", "bzpopmin bull:Telemetry:marker bull:Other:marker 5"],
    ["a sorted set of its own", "bzpopmin jobs 5"],
    ["bzpopmax", "bzpopmax bull:Telemetry:marker 5"],
  ])("not %s", (_label: string, queryText: string) => {
    expect(readText(queryText)).toBeNull();
  });
});

describe("readObiBullMqCall: only OBI's CLIENT spans of Redis calls", () => {
  test("any kind but CLIENT: the span OBI records inside Redis, and the rest", () => {
    for (const kind of [SERVER, PRODUCER, CONSUMER, INTERNAL]) {
      expect({
        kind: kind,
        call: read(redisCall(PRODUCTION_QUERY_TEXT), kind),
      }).toEqual({ kind: kind, call: null });
    }
  });

  test("an application SDK's span, or one with no distro", () => {
    expect(
      read(
        redisCall(PRODUCTION_QUERY_TEXT, {
          "resource.telemetry.distro.name": "opentelemetry-js-instrumentation",
        }),
      ),
    ).toBeNull();
    const withoutDistro: Attributes = redisCall(PRODUCTION_QUERY_TEXT);
    delete withoutDistro["resource.telemetry.distro.name"];
    expect(read(withoutDistro)).toBeNull();
  });

  test("a call to another database, or no database", () => {
    for (const system of ["postgresql", "valkey", "mongodb", "", null]) {
      expect({
        system: system,
        call: read(
          redisCall(PRODUCTION_QUERY_TEXT, { "db.system.name": system }),
        ),
      }).toEqual({ system: system, call: null });
    }
  });

  test("the older db.system names Redis as well", () => {
    const attributes: Attributes = redisCall(PRODUCTION_QUERY_TEXT);
    delete attributes["db.system.name"];
    attributes["db.system"] = "redis";
    expect(read(attributes)).toMatchObject({ operation: "publish" });
  });

  test("a span that already names a messaging system", () => {
    expect(
      read(redisCall(PRODUCTION_QUERY_TEXT, { "messaging.system": "bullmq" })),
    ).toBeNull();
  });

  test("no query text, or one that is no string", () => {
    for (const text of [undefined, null, 7, ["evalsha"]]) {
      expect({
        text: text,
        call: read(redisCall(PRODUCTION_QUERY_TEXT, { "db.query.text": text })),
      }).toEqual({ text: text, call: null });
    }
    expect(readObiBullMqCall({ kind: CLIENT, attributes: null })).toBeNull();
  });
});

describe("the stored span", () => {
  test("operations, their messaging.operation.type, names and kinds", () => {
    expect(BULLMQ_OPERATION_TYPES).toEqual({
      publish: "send",
      receive: "receive",
      settle: "settle",
    });
    const call: (operation: ObiBullMqCall["operation"]) => ObiBullMqCall = (
      operation: ObiBullMqCall["operation"],
    ): ObiBullMqCall => {
      return { operation, queue: "Telemetry", prefix: "bull", command: "x" };
    };
    expect(getObiBullMqSpanName(call("publish"))).toBe("publish Telemetry");
    expect(getObiBullMqSpanName(call("receive"))).toBe("receive Telemetry");
    expect(getObiBullMqSpanName(call("settle"))).toBe("settle Telemetry");
    expect(getObiBullMqSpanKind(call("publish"), CLIENT)).toBe(CLIENT);
    expect(getObiBullMqSpanKind(call("receive"), CLIENT)).toBe(CLIENT);
    expect(getObiBullMqSpanKind(call("settle"), CLIENT)).toBe(CONSUMER);
  });

  test("applyObiBullMqSpan adds the queue's messaging attributes and keeps the Redis ones", () => {
    const moveToFinished: BullMqScriptSignature = signatureOf("moveToFinished");
    const moveToActive: BullMqScriptSignature = signatureOf("moveToActive");
    const cases: Array<{
      text: string;
      name: string;
      kind: SpanKind;
      operationType: string;
      operationName: string;
    }> = [
      {
        text: PRODUCTION_QUERY_TEXT,
        name: "publish Telemetry",
        kind: CLIENT,
        operationType: "send",
        operationName: "publish",
      },
      {
        text: evalsha(keysOf("bull:Telemetry", moveToActive.keys)),
        name: "receive Telemetry",
        kind: CLIENT,
        operationType: "receive",
        operationName: "receive",
      },
      {
        text: "bzpopmin bull:Telemetry:marker 5",
        name: "receive Telemetry",
        kind: CLIENT,
        operationType: "receive",
        operationName: "receive",
      },
      {
        text: evalsha(keysOf("bull:Telemetry", moveToFinished.keys)).slice(
          0,
          220,
        ),
        name: "settle Telemetry",
        kind: CONSUMER,
        operationType: "settle",
        operationName: "settle",
      },
    ];

    for (const expected of cases) {
      const original: Attributes = redisCall(expected.text);
      const attributes: Attributes = { ...original };
      expect({
        text: expected.text,
        stored: applyObiBullMqSpan({ kind: CLIENT, attributes }),
        attributes: attributes,
      }).toEqual({
        text: expected.text,
        stored: { name: expected.name, kind: expected.kind },
        attributes: {
          ...original,
          "messaging.system": BULLMQ_MESSAGING_SYSTEM,
          "messaging.destination.name": "Telemetry",
          "messaging.operation.type": expected.operationType,
          "messaging.operation.name": expected.operationName,
        },
      });
    }
    expect(BULLMQ_MESSAGING_SYSTEM).toBe("bullmq");
  });

  test("applyObiBullMqSpan changes nothing on a span that is no BullMQ call", () => {
    for (const attributes of [
      redisCall("get bull:Telemetry:meta"),
      redisCall(`evalsha ${SHA} 2 ratelimit:a ratelimit:b 1`),
      redisCall(PRODUCTION_QUERY_TEXT, {
        "resource.telemetry.distro.name": "opentelemetry-js-instrumentation",
      }),
    ]) {
      const before: Attributes = { ...attributes };
      expect(applyObiBullMqSpan({ kind: CLIENT, attributes })).toBeNull();
      expect(attributes).toEqual(before);
    }
    const server: Attributes = redisCall(PRODUCTION_QUERY_TEXT);
    expect(applyObiBullMqSpan({ kind: SERVER, attributes: server })).toBeNull();
    expect(server).toEqual(redisCall(PRODUCTION_QUERY_TEXT));
  });
});

describe("only the start of a text is read", () => {
  test("a command of megabytes after its keys", () => {
    const text: string = `${PRODUCTION_QUERY_TEXT} bull:Telemetry:active bull:Telemetry:events bull:Telemetry:marker ${"x".repeat(1_000_000)} ${"y ".repeat(500_000)}`;
    expect(readText(text)).toMatchObject({
      operation: "publish",
      queue: "Telemetry",
    });
  });

  test("megabytes of white space, of one word, or of words", () => {
    expect(readText(`evalsha${" ".repeat(1_000_000)}`)).toBeNull();
    expect(readText(`evalsha ${"a".repeat(1_000_000)}`)).toBeNull();
    expect(readText(`bzpopmin ${"bull:q:marker ".repeat(200_000)}`)).toBeNull();
    expect(readText("a ".repeat(1_000_000))).toBeNull();
  });
});
