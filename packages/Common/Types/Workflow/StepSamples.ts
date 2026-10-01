/*
 * What a workflow's steps held the last times they ran, cut down to what a
 * value picker can suggest from: the fields inside each value, with a short
 * sample of what each held.
 *
 * Someone wiring a Slack message to a webhook wants "the incident's title
 * from the body", not {{local.components.webhook-1.returnValues.request-body}}
 * and a guess at what is inside it. Once the webhook has received a request,
 * the run's step trace knows, and this turns it into fields such as
 * incident.title ("Database is down", text).
 *
 * The server reads the runs and calls collectStepSamples. The dashboard turns
 * the result into picker suggestions (UI/Components/Workflow/ValuePicker/
 * StepSampleSource). Both ends share these shapes, so they live here, with no
 * UI or server code.
 *
 * Secrets: the trace is redacted the way the run log is - sensitive settings
 * and the values of secret variables. On top of that, a value under a key that
 * names a secret (an Authorization header, a password, a token) is listed
 * without its sample. The picker offers the field, never what it held.
 */

import { JSONObject, JSONValue } from "../JSON";
import {
  TRUNCATED_VALUE_SUFFIX,
  WorkflowStepStatus,
  WorkflowStepTrace,
  WorkflowStepTraceEntry,
  parseTrace,
} from "./StepTrace";

export enum StepSampleKind {
  Text = "Text",
  Number = "Number",
  Boolean = "Boolean",
  /** null: the field was there with nothing in it. */
  Empty = "Empty",
  Object = "Object",
  List = "List",
}

export interface StepSampleField {
  /**
   * Where it sits inside the value, the way a reference reads it:
   * "incident.title", "alerts[0].status", or "[0].name" inside a list.
   */
  path: string;
  kind: StepSampleKind;
  /**
   * What it held, shortened: '"production"' (text is quoted), "3 fields".
   * Absent when hidden.
   */
  preview?: string | undefined;
  /** Its sample is not shown: it looks like a secret, or the run redacted it. */
  isHidden?: boolean | undefined;
}

export interface StepSampleValue {
  kind: StepSampleKind;
  preview?: string | undefined;
  isHidden?: boolean | undefined;
  /**
   * The fields inside an object or a list, a parent before its own fields.
   * None for anything else.
   */
  fields: Array<StepSampleField>;
  /**
   * Not every field is listed: the value had more than the limits keep, or it
   * was too big to record whole and only a cut-down copy was kept.
   */
  isPartial?: boolean | undefined;
  /**
   * It was too big to record whole, in a run from before cut-down copies were
   * kept, so nothing inside it is known.
   */
  isCutShort?: boolean | undefined;
  /** When the step returned it, as an ISO date. */
  ranAt: string;
}

export interface StepSample {
  /** The step's id on the canvas, e.g. "webhook-1". */
  componentId: string;
  /** By return value id, e.g. "request-body". */
  returnValues: { [returnValueId: string]: StepSampleValue };
}

export interface StepSamplesResponse {
  samples: Array<StepSample>;
}

/** The longest preview of a value, in characters, ellipsis included. */
export const STEP_SAMPLE_PREVIEW_LENGTH: number = 60;

/** The most fields listed inside one value. */
export const STEP_SAMPLE_MAX_FIELDS: number = 150;

/** How many keys deep a field can be: incident.owner.name is 3. */
export const STEP_SAMPLE_MAX_DEPTH: number = 6;

/*
 * How many runs the server reads, newest first, to find a sample of every
 * step it was asked about, and how many it reads at a time. Most of the time
 * the first page has them all.
 */
export const STEP_SAMPLES_MAX_RUNS: number = 30;
export const STEP_SAMPLES_PAGE_SIZE: number = 10;

/** The most step ids one request may ask about. */
export const STEP_SAMPLES_MAX_COMPONENT_IDS: number = 200;

/*
 * What the runner writes in place of a sensitive setting or a secret
 * variable's value (WORKFLOW_LOG_REDACTED_VALUE in the workflow service; a
 * test there holds the two together).
 */
export const STEP_SAMPLE_REDACTED_VALUE: string = "[REDACTED]";

/*
 * Keys whose values are credentials. Matched against the words a key is made
 * of - "X-Api-Key" is x, api, key; "accessToken" is access, token - so that
 * "author" or "keyboard" are not mistaken for one.
 */
const SENSITIVE_WORDS: Array<string> = [
  "auth",
  "authorization",
  "bearer",
  "cookie",
  "cookies",
  "credential",
  "credentials",
  "csrf",
  "jwt",
  "otp",
  "passphrase",
  "passwd",
  "password",
  "pwd",
  "secret",
  "secrets",
  "session",
  "sessionid",
  "signature",
  "token",
  "tokens",
  "xsrf",
  "apikey",
  "privatekey",
];

// Two words that name a secret together, though neither does alone.
const SENSITIVE_WORD_PAIRS: Array<[string, string]> = [
  ["api", "key"],
  ["private", "key"],
  ["access", "key"],
  ["secret", "key"],
  ["signing", "key"],
  ["encryption", "key"],
];

type KeyWordsFunction = (key: string) => Array<string>;

const keyWords: KeyWordsFunction = (key: string): Array<string> => {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word: string) => {
      return word.length > 0;
    });
};

export type IsSensitiveSampleKeyFunction = (key: string) => boolean;

/** Whether a value under this key is a credential, whose sample is hidden. */
export const isSensitiveSampleKey: IsSensitiveSampleKeyFunction = (
  key: string,
): boolean => {
  const words: Array<string> = keyWords(key);

  if (
    words.some((word: string) => {
      return SENSITIVE_WORDS.includes(word);
    })
  ) {
    return true;
  }

  for (let index: number = 0; index < words.length - 1; index++) {
    const first: string = words[index]!;
    const second: string = words[index + 1]!;

    if (
      SENSITIVE_WORD_PAIRS.some((pair: [string, string]) => {
        return pair[0] === first && pair[1] === second;
      })
    ) {
      return true;
    }
  }

  return false;
};

/*
 * A key a reference can name. The runtime splits a path on "." and reads a
 * "[n]" off the end of each part (VMUtil.deepFind), so a key holding either
 * cannot be reached; spaces and quotes would not survive the {{...}} syntax.
 * Header names, JSON keys in camelCase, snake_case or kebab-case, and the odd
 * "@timestamp" all pass.
 */
const ADDRESSABLE_KEY: RegExp = /^[A-Za-z0-9_\-@$]+$/;

export type IsAddressableSampleKeyFunction = (key: string) => boolean;

export const isAddressableSampleKey: IsAddressableSampleKeyFunction = (
  key: string,
): boolean => {
  return ADDRESSABLE_KEY.test(key);
};

export type SampleFieldReferenceFunction = (data: {
  componentId: string;
  returnValueId: string;
  path: string;
}) => string;

/**
 * The reference to a field inside a step's value: "incident.title" inside
 * webhook-1's request-body is
 * {{local.components.webhook-1.returnValues.request-body.incident.title}};
 * "[0].name" is ...request-body[0].name, the index on the value's own name.
 */
export const sampleFieldReference: SampleFieldReferenceFunction = (data: {
  componentId: string;
  returnValueId: string;
  path: string;
}): string => {
  const base: string = `local.components.${data.componentId}.returnValues.${data.returnValueId}`;

  if (!data.path) {
    return `{{${base}}}`;
  }

  return `{{${base}${data.path.startsWith("[") ? "" : "."}${data.path}}}`;
};

type PluralFunction = (count: number, one: string, many: string) => string;

const plural: PluralFunction = (
  count: number,
  one: string,
  many: string,
): string => {
  return `${count} ${count === 1 ? one : many}`;
};

/*
 * A database step returns its record as JSON, where an ID or a date is a
 * small object - {"_type": "ObjectID", "value": "..."} - rather than text. It
 * is one value, so it is shown as what it holds and not opened up.
 */
type UnwrapFunction = (value: unknown) => unknown;

const unwrap: UnwrapFunction = (value: unknown): unknown => {
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value.toISOString();
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const record: Record<string, unknown> = value as Record<string, unknown>;

  // A class instance - an ObjectID, a URL - is what its JSON says it is.
  if (
    Object.getPrototypeOf(record) !== Object.prototype &&
    Object.getPrototypeOf(record) !== null &&
    typeof (record as { toJSON?: unknown }).toJSON === "function"
  ) {
    try {
      return unwrap((record as { toJSON: () => unknown }).toJSON());
    } catch {
      return null;
    }
  }

  const keys: Array<string> = Object.keys(record);

  if (
    keys.length === 2 &&
    typeof record["_type"] === "string" &&
    keys.includes("value")
  ) {
    const inner: unknown = record["value"];

    if (inner === null || typeof inner !== "object") {
      return inner;
    }
  }

  return value;
};

type KindOfFunction = (value: unknown) => StepSampleKind;

const kindOf: KindOfFunction = (value: unknown): StepSampleKind => {
  if (value === null || value === undefined) {
    return StepSampleKind.Empty;
  }

  if (Array.isArray(value)) {
    return StepSampleKind.List;
  }

  switch (typeof value) {
    case "string":
      return StepSampleKind.Text;
    case "number":
    case "bigint":
      return StepSampleKind.Number;
    case "boolean":
      return StepSampleKind.Boolean;
    case "object":
      return StepSampleKind.Object;
    default:
      return StepSampleKind.Text;
  }
};

type ShortenFunction = (text: string, maxLength: number) => string;

const shorten: ShortenFunction = (text: string, maxLength: number): string => {
  const oneLine: string = text.replace(/\s+/g, " ").trim();

  if (oneLine.length <= maxLength) {
    return oneLine;
  }

  return `${oneLine.slice(0, maxLength - 1).trimEnd()}…`;
};

type PreviewOfFunction = (value: unknown) => string;

/** A value in a few words: the text itself in quotes, "3 fields", "2 items", "empty". */
const previewOf: PreviewOfFunction = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "empty";
  }

  if (Array.isArray(value)) {
    return value.length === 0
      ? "empty list"
      : plural(value.length, "item", "items");
  }

  if (typeof value === "object") {
    const count: number = Object.keys(value as Record<string, unknown>).length;

    return count === 0 ? "no fields" : plural(count, "field", "fields");
  }

  /*
   * Text is quoted, so it reads as what the field held and never as a
   * description of it: a field holding the words "2 fields" is not an object.
   */
  if (typeof value === "string") {
    return value.trim() === ""
      ? "empty text"
      : `"${shorten(value, STEP_SAMPLE_PREVIEW_LENGTH - 2)}"`;
  }

  return shorten(String(value), STEP_SAMPLE_PREVIEW_LENGTH);
};

type IsStructuredFunction = (value: unknown) => boolean;

/** An object or a list once unwrapped: something with fields inside it. */
const isStructured: IsStructuredFunction = (value: unknown): boolean => {
  const unwrapped: unknown = unwrap(value);

  return Boolean(unwrapped) && typeof unwrapped === "object";
};

type IsCutShortTextFunction = (value: unknown) => boolean;

/*
 * An object or list the trace could not keep: truncateTraceValue stores its
 * JSON cut off, as text that ends in the truncation marker.
 */
const isCutShortText: IsCutShortTextFunction = (value: unknown): boolean => {
  return (
    typeof value === "string" &&
    value.endsWith(TRUNCATED_VALUE_SUFFIX) &&
    (value.startsWith("{") || value.startsWith("["))
  );
};

interface PendingField {
  value: unknown;
  path: string;
  depth: number;
  isHidden: boolean;
  /** The last part of the path is an index: the runtime reads one per part. */
  endsWithIndex: boolean;
}

type FieldPathSegmentsFunction = (path: string) => Array<string>;

const fieldPathSegments: FieldPathSegmentsFunction = (
  path: string,
): Array<string> => {
  return path.split(".");
};

type CompareFieldsFunction = (a: StepSampleField, b: StepSampleField) => number;

/*
 * Alphabetical, part by part, so a field comes right before the fields inside
 * it: incident, incident.severity, incident.title, tags, tags[0].
 */
const compareFields: CompareFieldsFunction = (
  a: StepSampleField,
  b: StepSampleField,
): number => {
  const first: Array<string> = fieldPathSegments(a.path);
  const second: Array<string> = fieldPathSegments(b.path);
  const length: number = Math.min(first.length, second.length);

  for (let index: number = 0; index < length; index++) {
    const left: string = first[index]!;
    const right: string = second[index]!;

    if (left === right) {
      continue;
    }

    const byName: number = left
      .toLowerCase()
      .localeCompare(right.toLowerCase());

    return byName !== 0 ? byName : left < right ? -1 : 1;
  }

  return first.length - second.length;
};

export interface DescribeSampleValueOptions {
  /** When the step returned the value. */
  ranAt: string;
  /** The value is a cut-down copy, so some of its fields may be missing. */
  isCutDownCopy?: boolean | undefined;
  /** It sits under a key that names a secret. */
  isHidden?: boolean | undefined;
}

export type DescribeSampleValueFunction = (
  value: JSONValue | unknown,
  options: DescribeSampleValueOptions,
) => StepSampleValue;

/**
 * A value and every field inside it, as the picker lists them.
 *
 * Fields are taken nearest first, so when a large value has more than
 * STEP_SAMPLE_MAX_FIELDS it is the deeply nested ones that are left out, then
 * listed alphabetically with each field's own fields after it. A list is read
 * by its first item, the one {{...[0]...}} reads.
 */
export const describeSampleValue: DescribeSampleValueFunction = (
  value: JSONValue | unknown,
  options: DescribeSampleValueOptions,
): StepSampleValue => {
  const isRootHidden: boolean = Boolean(options.isHidden);

  if (isCutShortText(value)) {
    return {
      kind: (value as string).startsWith("[")
        ? StepSampleKind.List
        : StepSampleKind.Object,
      fields: [],
      isCutShort: true,
      ranAt: options.ranAt,
    };
  }

  const root: unknown = unwrap(value);
  const rootHidden: boolean =
    isRootHidden || root === STEP_SAMPLE_REDACTED_VALUE;

  const described: StepSampleValue = {
    kind: kindOf(root),
    fields: [],
    ranAt: options.ranAt,
  };

  if (rootHidden) {
    described.isHidden = true;
  } else {
    described.preview = previewOf(root);
  }

  if (options.isCutDownCopy) {
    described.isPartial = true;
  }

  if (!root || typeof root !== "object") {
    return described;
  }

  type ChildrenFunction = (parent: PendingField) => Array<PendingField>;

  const childrenOf: ChildrenFunction = (
    parent: PendingField,
  ): Array<PendingField> => {
    const parentValue: unknown = parent.value;

    if (Array.isArray(parentValue)) {
      /*
       * deepFind reads one index per part of a path, after a name: a list
       * inside a list cannot be indexed again.
       */
      if (parentValue.length === 0 || parent.endsWithIndex) {
        return [];
      }

      return [
        {
          value: unwrap(parentValue[0]),
          path: `${parent.path}[0]`,
          depth: parent.depth + 1,
          isHidden: parent.isHidden,
          endsWithIndex: true,
        },
      ];
    }

    if (!parentValue || typeof parentValue !== "object") {
      return [];
    }

    return Object.keys(parentValue as Record<string, unknown>)
      .filter((key: string) => {
        return isAddressableSampleKey(key);
      })
      .sort((a: string, b: string) => {
        return a.toLowerCase().localeCompare(b.toLowerCase());
      })
      .map((key: string): PendingField => {
        return {
          value: unwrap((parentValue as Record<string, unknown>)[key]),
          path: parent.path ? `${parent.path}.${key}` : key,
          depth: parent.depth + 1,
          isHidden: parent.isHidden || isSensitiveSampleKey(key),
          endsWithIndex: false,
        };
      });
  };

  const queue: Array<PendingField> = childrenOf({
    value: root,
    path: "",
    depth: 0,
    isHidden: rootHidden,
    endsWithIndex: false,
  });

  const fields: Array<StepSampleField> = [];

  while (queue.length > 0) {
    if (fields.length >= STEP_SAMPLE_MAX_FIELDS) {
      described.isPartial = true;
      break;
    }

    const pending: PendingField = queue.shift()!;
    const isHidden: boolean =
      pending.isHidden || pending.value === STEP_SAMPLE_REDACTED_VALUE;

    const field: StepSampleField = {
      path: pending.path,
      kind: kindOf(pending.value),
    };

    if (isHidden) {
      field.isHidden = true;
    } else {
      field.preview = previewOf(pending.value);
    }

    fields.push(field);

    if (pending.depth < STEP_SAMPLE_MAX_DEPTH) {
      queue.push(...childrenOf({ ...pending, isHidden: isHidden }));
    } else if (childrenOf(pending).length > 0) {
      described.isPartial = true;
    }
  }

  described.fields = fields.sort(compareFields);

  return described;
};

/** One run, as the server reads it off its WorkflowLog row. */
export interface StepSampleRun {
  /** When the run was created; runs are read newest first. */
  createdAt?: Date | string | undefined;
  stepTrace: JSONValue | unknown;
}

export interface CollectStepSamplesOptions {
  /** Only these steps. Every step that ran, when left out. */
  componentIds?: Array<string> | undefined;
}

interface Candidate {
  value: unknown;
  ranAt: string;
  isCutDownCopy: boolean;
  isHidden: boolean;
  /*
   * A value with fields beats text, then a step that worked beats one that
   * failed; the newest wins a tie. A webhook run started by hand, whose body
   * was typed as text, does not hide the fields of a real request before it,
   * and an API's error reply does not stand in for its usual answer.
   */
  score: number;
}

type ToISOFunction = (value: Date | string | undefined) => string;

const toISO: ToISOFunction = (value: Date | string | undefined): string => {
  if (!value) {
    return "";
  }

  const date: Date = value instanceof Date ? value : new Date(value);

  return isNaN(date.getTime()) ? "" : date.toISOString();
};

type TimeOfFunction = (value: Date | string | undefined) => number;

const timeOf: TimeOfFunction = (value: Date | string | undefined): number => {
  const iso: string = toISO(value);

  return iso ? Date.parse(iso) : 0;
};

export type CollectStepSamplesFunction = (
  runs: Array<StepSampleRun>,
  options?: CollectStepSamplesOptions,
) => Array<StepSample>;

/**
 * The latest sample of each step's return values, across the runs given.
 *
 * Each return value is taken from the newest run that has one, preferring a
 * value with fields over text and a step that worked over one that failed.
 * A value too big for the trace to keep whole is read from the cut-down copy
 * the runner kept beside it (WorkflowStepTraceEntry.returnValueSamples).
 */
export const collectStepSamples: CollectStepSamplesFunction = (
  runs: Array<StepSampleRun>,
  options: CollectStepSamplesOptions = {},
): Array<StepSample> => {
  const wanted: Set<string> | null =
    options.componentIds && options.componentIds.length > 0
      ? new Set<string>(options.componentIds)
      : null;

  const newestFirst: Array<StepSampleRun> = [...(runs || [])]
    .filter((run: StepSampleRun) => {
      return Boolean(run);
    })
    .sort((a: StepSampleRun, b: StepSampleRun) => {
      return timeOf(b.createdAt) - timeOf(a.createdAt);
    });

  const best: Map<string, Map<string, Candidate>> = new Map<
    string,
    Map<string, Candidate>
  >();

  for (const run of newestFirst) {
    const trace: WorkflowStepTrace = parseTrace(
      (run.stepTrace as JSONValue) || null,
    );

    // A step that ran twice in one run (it slept and resumed): the later one.
    const steps: Array<WorkflowStepTraceEntry> = [...trace.steps].reverse();

    for (const entry of steps) {
      const componentId: unknown = entry.componentId;

      if (typeof componentId !== "string" || !componentId) {
        continue;
      }

      if (wanted && !wanted.has(componentId)) {
        continue;
      }

      const returnValues: unknown = entry.returnValues;

      if (
        !returnValues ||
        typeof returnValues !== "object" ||
        Array.isArray(returnValues)
      ) {
        continue;
      }

      const cutDownCopies: JSONObject =
        entry.returnValueSamples &&
        typeof entry.returnValueSamples === "object" &&
        !Array.isArray(entry.returnValueSamples)
          ? entry.returnValueSamples
          : {};

      const isSuccess: boolean = entry.status !== WorkflowStepStatus.Error;
      const ranAt: string =
        toISO(entry.completedAt) ||
        toISO(entry.startedAt) ||
        toISO(run.createdAt);

      let byValue: Map<string, Candidate> | undefined = best.get(componentId);

      for (const returnValueId of Object.keys(
        returnValues as Record<string, unknown>,
      )) {
        const hasCutDownCopy: boolean = Object.prototype.hasOwnProperty.call(
          cutDownCopies,
          returnValueId,
        );
        const value: unknown = hasCutDownCopy
          ? cutDownCopies[returnValueId]
          : (returnValues as Record<string, unknown>)[returnValueId];

        if (value === undefined) {
          continue;
        }

        const score: number =
          (isStructured(value) ? 2 : 0) + (isSuccess ? 1 : 0);

        const existing: Candidate | undefined = byValue?.get(returnValueId);

        if (existing && existing.score >= score) {
          continue;
        }

        if (!byValue) {
          byValue = new Map<string, Candidate>();
          best.set(componentId, byValue);
        }

        byValue.set(returnValueId, {
          value: value,
          ranAt: ranAt,
          isCutDownCopy: hasCutDownCopy,
          isHidden: isSensitiveSampleKey(returnValueId),
          score: score,
        });
      }
    }
  }

  return Array.from(best.keys())
    .sort()
    .map((componentId: string): StepSample => {
      const byValue: Map<string, Candidate> = best.get(componentId)!;
      const described: { [returnValueId: string]: StepSampleValue } = {};

      for (const returnValueId of Array.from(byValue.keys()).sort()) {
        const candidate: Candidate = byValue.get(returnValueId)!;

        described[returnValueId] = describeSampleValue(candidate.value, {
          ranAt: candidate.ranAt,
          isCutDownCopy: candidate.isCutDownCopy,
          isHidden: candidate.isHidden,
        });
      }

      return { componentId: componentId, returnValues: described };
    });
};

export type SampledComponentIdsFunction = (
  runs: Array<StepSampleRun>,
) => Set<string>;

/**
 * The steps these runs hold a good sample of: each one that worked and
 * returned something. The server stops reading older runs once every step it
 * was asked about is here.
 */
export const sampledComponentIds: SampledComponentIdsFunction = (
  runs: Array<StepSampleRun>,
): Set<string> => {
  const ids: Set<string> = new Set<string>();

  for (const run of runs || []) {
    if (!run) {
      continue;
    }

    const trace: WorkflowStepTrace = parseTrace(
      (run.stepTrace as JSONValue) || null,
    );

    for (const entry of trace.steps) {
      if (
        typeof entry.componentId === "string" &&
        entry.componentId &&
        entry.status !== WorkflowStepStatus.Error &&
        entry.returnValues &&
        typeof entry.returnValues === "object" &&
        Object.keys(entry.returnValues).length > 0
      ) {
        ids.add(entry.componentId);
      }
    }
  }

  return ids;
};

export type ParseStepSamplesResponseFunction = (
  data: unknown,
) => Array<StepSample>;

/**
 * The samples in a response, with anything that is not one dropped. The
 * picker treats them as a bonus: a response it cannot read means no samples,
 * never a broken list.
 */
export const parseStepSamplesResponse: ParseStepSamplesResponseFunction = (
  data: unknown,
): Array<StepSample> => {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return [];
  }

  const samples: unknown = (data as Record<string, unknown>)["samples"];

  if (!Array.isArray(samples)) {
    return [];
  }

  const kinds: Array<string> = Object.values(StepSampleKind);

  type IsKindFunction = (kind: unknown) => boolean;

  const isKind: IsKindFunction = (kind: unknown): boolean => {
    return typeof kind === "string" && kinds.includes(kind);
  };

  const parsed: Array<StepSample> = [];

  for (const sample of samples) {
    if (!sample || typeof sample !== "object") {
      continue;
    }

    const componentId: unknown = (sample as Record<string, unknown>)[
      "componentId"
    ];
    const returnValues: unknown = (sample as Record<string, unknown>)[
      "returnValues"
    ];

    if (
      typeof componentId !== "string" ||
      !componentId ||
      !returnValues ||
      typeof returnValues !== "object" ||
      Array.isArray(returnValues)
    ) {
      continue;
    }

    const values: { [returnValueId: string]: StepSampleValue } = {};

    for (const returnValueId of Object.keys(
      returnValues as Record<string, unknown>,
    )) {
      const value: unknown = (returnValues as Record<string, unknown>)[
        returnValueId
      ];

      if (!value || typeof value !== "object") {
        continue;
      }

      const record: Record<string, unknown> = value as Record<string, unknown>;

      if (!isKind(record["kind"])) {
        continue;
      }

      const fields: Array<StepSampleField> = (
        Array.isArray(record["fields"])
          ? (record["fields"] as Array<unknown>)
          : []
      )
        .filter((field: unknown) => {
          return (
            Boolean(field) &&
            typeof field === "object" &&
            typeof (field as Record<string, unknown>)["path"] === "string" &&
            Boolean((field as Record<string, unknown>)["path"]) &&
            isKind((field as Record<string, unknown>)["kind"])
          );
        })
        .map((field: unknown): StepSampleField => {
          const fieldRecord: Record<string, unknown> = field as Record<
            string,
            unknown
          >;
          const parsedField: StepSampleField = {
            path: fieldRecord["path"] as string,
            kind: fieldRecord["kind"] as StepSampleKind,
          };

          if (fieldRecord["isHidden"] === true) {
            parsedField.isHidden = true;
          } else if (typeof fieldRecord["preview"] === "string") {
            parsedField.preview = fieldRecord["preview"];
          }

          return parsedField;
        });

      const parsedValue: StepSampleValue = {
        kind: record["kind"] as StepSampleKind,
        fields: fields,
        ranAt: typeof record["ranAt"] === "string" ? record["ranAt"] : "",
      };

      if (record["isHidden"] === true) {
        parsedValue.isHidden = true;
      } else if (typeof record["preview"] === "string") {
        parsedValue.preview = record["preview"];
      }

      if (record["isPartial"] === true) {
        parsedValue.isPartial = true;
      }

      if (record["isCutShort"] === true) {
        parsedValue.isCutShort = true;
      }

      values[returnValueId] = parsedValue;
    }

    parsed.push({ componentId: componentId, returnValues: values });
  }

  return parsed;
};
