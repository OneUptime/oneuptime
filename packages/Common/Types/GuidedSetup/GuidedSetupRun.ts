import BadDataException from "../Exception/BadDataException";
import { JSONObject } from "../JSON";

/*
 * A GUIDED SETUP'S RUN, KEPT ON THE SERVER (#7253).
 *
 * A guided setup (the Dashboard's Components/GuidedSetup) does one job on
 * one page, in a few steps, and each step saves real records. Its run is
 * what one pass through it knows besides those records: the ids of what it
 * made, a few answers ("the test was skipped"), the address it was asked to
 * check - its values - and how each record it makes is getting on, made,
 * failed and why, or being made - its resources, which the setup's panel
 * of what it sets up draws (#10276).
 *
 * The run was kept in one browser's local storage, so another device, a
 * private window or cleared site data opened the setup at its first step
 * with an empty form. It is kept on the server now, one per setup, project
 * and person (Models/DatabaseModels/GuidedSetupRun), and only that person
 * reads or writes it: the routes take no person, they serve the caller's own
 * run (Server/API/GuidedSetupRunAPI.ts):
 *
 *   GET  /guided-setup-run/:setup         the caller's run, or null
 *   POST /guided-setup-run/:setup         { values, resources } - each name
 *                                         set, or removed with null; the
 *                                         run as it now stands
 *   POST /guided-setup-run/:setup/forget  start afresh: the run is deleted
 *
 * A change names only what it changes, and the server merges it into the
 * run name by name, so two devices that save different steps both keep
 * theirs; the same name saved twice keeps the last. Each value is an id of
 * a record that exists, a yes, or what the person typed, so the last write
 * is the one to keep.
 *
 * A run nobody changed for GUIDED_SETUP_RUN_ABANDONED_AFTER_DAYS days is
 * deleted by the Workers' daily clean-up, as is the run of someone who is
 * no longer a member of its project; the records it made stay.
 *
 * This file is the contract both ends read: the routes, the shape of a run
 * and of a change, their limits, and the merge.
 */

export const GUIDED_SETUP_RUN_ROUTE: string = "/guided-setup-run";

// The setups that keep a run. A route for any other answers 400.
export enum GuidedSetupKey {
  WebsiteDown = "website_down",
  OnCall = "on_call",
  StatusPage = "status_page",
  Telemetry = "telemetry",
}

export const GUIDED_SETUP_KEYS: ReadonlyArray<GuidedSetupKey> = [
  GuidedSetupKey.WebsiteDown,
  GuidedSetupKey.OnCall,
  GuidedSetupKey.StatusPage,
  GuidedSetupKey.Telemetry,
];

export const isGuidedSetupKey: (value: unknown) => value is GuidedSetupKey = (
  value: unknown,
): value is GuidedSetupKey => {
  return (
    typeof value === "string" &&
    (GUIDED_SETUP_KEYS as ReadonlyArray<string>).includes(value)
  );
};

export const getGuidedSetupRunRoute: (setup: GuidedSetupKey) => string = (
  setup: GuidedSetupKey,
): string => {
  return `${GUIDED_SETUP_RUN_ROUTE}/${setup}`;
};

export const getGuidedSetupRunForgetRoute: (setup: GuidedSetupKey) => string = (
  setup: GuidedSetupKey,
): string => {
  return `${GUIDED_SETUP_RUN_ROUTE}/${setup}/forget`;
};

/*
 * A run nobody changed for this many days is abandoned: the Workers' daily
 * clean-up deletes it. Coming back after that starts the setup afresh, and
 * everything the run made is still there.
 */
export const GUIDED_SETUP_RUN_ABANDONED_AFTER_DAYS: number = 30;

/*
 * The run's values, by name: an id, true for a step that saves nothing of
 * its own, or what the person typed ("https://example.com").
 */
export type GuidedSetupRunValues = Record<string, string | true>;

/*
 * How a record the setup makes is getting on, as its panel draws it. Waiting
 * is never kept: a record with no progress yet is waiting for its step.
 */
export enum GuidedSetupResourceStatus {
  // Its step has not come yet.
  Waiting = "waiting",
  // A request to make it is out.
  Creating = "creating",
  // This run made it.
  Created = "created",
  // It was there already, and the run goes on with it.
  Existing = "existing",
  // The request failed; `error` says why.
  Failed = "failed",
  // The person chose not to make it (Not now, Skip the test).
  Skipped = "skipped",
}

const KEPT_RESOURCE_STATUSES: ReadonlyArray<GuidedSetupResourceStatus> = [
  GuidedSetupResourceStatus.Creating,
  GuidedSetupResourceStatus.Created,
  GuidedSetupResourceStatus.Existing,
  GuidedSetupResourceStatus.Failed,
  GuidedSetupResourceStatus.Skipped,
];

export interface GuidedSetupResourceProgress {
  status: GuidedSetupResourceStatus;
  // The record, once it exists.
  recordId?: string | undefined;
  // What it is called, as the person or the setup named it.
  name?: string | undefined;
  // Why it failed, in the words the page showed.
  error?: string | undefined;
  // When the status was set (ISO 8601), by the server's clock.
  at: string;
}

export type GuidedSetupRunResources = Record<
  string,
  GuidedSetupResourceProgress
>;

export interface GuidedSetupRunState {
  values: GuidedSetupRunValues;
  resources: GuidedSetupRunResources;
  // Counts the changes kept, from 1: a newer run has a higher one.
  revision: number;
  // When it last changed (ISO 8601).
  updatedAt: string;
}

// What GET and POST answer: the caller's run for the setup, or none.
export interface GuidedSetupRunAnswer {
  setup: GuidedSetupKey;
  run: GuidedSetupRunState | null;
}

// A resource's progress as a change sends it: the server stamps `at`.
export interface GuidedSetupResourceProgressChange {
  status: GuidedSetupResourceStatus;
  recordId?: string | undefined;
  name?: string | undefined;
  error?: string | undefined;
}

/*
 * What a POST sends: each value and each resource it sets, or removes with
 * null. A name it leaves out is left as it is.
 */
export interface GuidedSetupRunChange {
  values: Record<string, string | true | null>;
  resources: Record<string, GuidedSetupResourceProgressChange | null>;
}

/*
 * THE LIMITS. A run is a handful of ids and answers: a setup keeps at most
 * nine values and draws at most eight records, and the longest value is the
 * telemetry setup's list of the monitors it made. These keep a run small
 * however it is called.
 */
export const GUIDED_SETUP_RUN_LIMITS: {
  maxValues: number;
  maxResources: number;
  maxNameLength: number;
  maxValueLength: number;
  maxResourceNameLength: number;
  maxErrorLength: number;
  maxRecordIdLength: number;
} = {
  maxValues: 50,
  maxResources: 50,
  maxNameLength: 64,
  maxValueLength: 4096,
  maxResourceNameLength: 512,
  maxErrorLength: 2000,
  maxRecordIdLength: 64,
};

// A value's or a resource's name: a word the code chooses.
const NAME_PATTERN: RegExp = /^[A-Za-z][A-Za-z0-9_]*$/;

const isName: (name: string) => boolean = (name: string): boolean => {
  return (
    name.length > 0 &&
    name.length <= GUIDED_SETUP_RUN_LIMITS.maxNameLength &&
    NAME_PATTERN.test(name)
  );
};

const isPlainObject: (value: unknown) => value is JSONObject = (
  value: unknown,
): value is JSONObject => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

const cut: (text: string, length: number) => string = (
  text: string,
  length: number,
): string => {
  return text.length > length ? text.slice(0, length) : text;
};

/*
 * A run's values as kept, read leniently: what is not a name with a
 * non-empty string or true is left out. Reads what the server stored and
 * what a browser kept alike.
 */
export const readGuidedSetupRunValues: (
  value: unknown,
) => GuidedSetupRunValues = (value: unknown): GuidedSetupRunValues => {
  const values: GuidedSetupRunValues = {};

  if (!isPlainObject(value)) {
    return values;
  }

  for (const [name, entry] of Object.entries(value)) {
    if (!isName(name)) {
      continue;
    }

    if (
      typeof entry === "string" &&
      entry.length > 0 &&
      entry.length <= GUIDED_SETUP_RUN_LIMITS.maxValueLength
    ) {
      values[name] = entry;
    } else if (entry === true) {
      values[name] = true;
    }
  }

  return values;
};

const isKeptStatus: (value: unknown) => value is GuidedSetupResourceStatus = (
  value: unknown,
): value is GuidedSetupResourceStatus => {
  return (
    typeof value === "string" &&
    (KEPT_RESOURCE_STATUSES as ReadonlyArray<string>).includes(value)
  );
};

const readOptionalText: (
  value: unknown,
  length: number,
) => string | undefined = (
  value: unknown,
  length: number,
): string | undefined => {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  return cut(value, length);
};

/*
 * A run's resources as kept, read leniently: an entry with no status a
 * resource can be kept in, or with no time, is left out.
 */
export const readGuidedSetupRunResources: (
  value: unknown,
) => GuidedSetupRunResources = (value: unknown): GuidedSetupRunResources => {
  const resources: GuidedSetupRunResources = {};

  if (!isPlainObject(value)) {
    return resources;
  }

  for (const [name, entry] of Object.entries(value)) {
    if (!isName(name) || !isPlainObject(entry)) {
      continue;
    }

    const status: unknown = entry["status"];
    const at: unknown = entry["at"];

    if (!isKeptStatus(status) || typeof at !== "string" || !at) {
      continue;
    }

    const progress: GuidedSetupResourceProgress = { status: status, at: at };
    const recordId: string | undefined = readOptionalText(
      entry["recordId"],
      GUIDED_SETUP_RUN_LIMITS.maxRecordIdLength,
    );
    const resourceName: string | undefined = readOptionalText(
      entry["name"],
      GUIDED_SETUP_RUN_LIMITS.maxResourceNameLength,
    );
    const error: string | undefined = readOptionalText(
      entry["error"],
      GUIDED_SETUP_RUN_LIMITS.maxErrorLength,
    );

    if (recordId) {
      progress.recordId = recordId;
    }

    if (resourceName) {
      progress.name = resourceName;
    }

    if (error) {
      progress.error = error;
    }

    resources[name] = progress;
  }

  return resources;
};

/*
 * A POST's body, read strictly: a change the server cannot keep as sent is
 * refused with what is wrong, never kept in part.
 */
export const parseGuidedSetupRunChange: (
  body: unknown,
) => GuidedSetupRunChange = (body: unknown): GuidedSetupRunChange => {
  if (!isPlainObject(body)) {
    throw new BadDataException(
      "A guided setup's run is changed with an object of values and resources.",
    );
  }

  const change: GuidedSetupRunChange = { values: {}, resources: {} };
  const values: unknown = body["values"];
  const resources: unknown = body["resources"];

  if (values !== undefined && values !== null && !isPlainObject(values)) {
    throw new BadDataException(
      "A guided setup's values are an object of names and values.",
    );
  }

  if (
    resources !== undefined &&
    resources !== null &&
    !isPlainObject(resources)
  ) {
    throw new BadDataException(
      "A guided setup's resources are an object of names and their progress.",
    );
  }

  for (const [name, entry] of Object.entries(
    (values as JSONObject | undefined) || {},
  )) {
    if (!isName(name)) {
      throw new BadDataException(
        `The name "${cut(name, 80)}" is not one a guided setup keeps a value under.`,
      );
    }

    if (entry === null || entry === false || entry === "") {
      change.values[name] = null;
    } else if (entry === true) {
      change.values[name] = true;
    } else if (typeof entry === "string") {
      if (entry.length > GUIDED_SETUP_RUN_LIMITS.maxValueLength) {
        throw new BadDataException(
          `The guided setup's value "${name}" is longer than ${GUIDED_SETUP_RUN_LIMITS.maxValueLength} characters.`,
        );
      }

      change.values[name] = entry;
    } else {
      throw new BadDataException(
        `The guided setup's value "${name}" must be text, true or null.`,
      );
    }
  }

  for (const [name, entry] of Object.entries(
    (resources as JSONObject | undefined) || {},
  )) {
    if (!isName(name)) {
      throw new BadDataException(
        `The name "${cut(name, 80)}" is not one a guided setup keeps a resource under.`,
      );
    }

    if (entry === null) {
      change.resources[name] = null;
      continue;
    }

    if (!isPlainObject(entry) || !isKeptStatus(entry["status"])) {
      throw new BadDataException(
        `The guided setup's resource "${name}" needs a status: creating, created, existing, failed or skipped.`,
      );
    }

    const progress: GuidedSetupResourceProgressChange = {
      status: entry["status"],
    };
    const recordId: string | undefined = readOptionalText(
      entry["recordId"],
      GUIDED_SETUP_RUN_LIMITS.maxRecordIdLength,
    );
    const resourceName: string | undefined = readOptionalText(
      entry["name"],
      GUIDED_SETUP_RUN_LIMITS.maxResourceNameLength,
    );
    const error: string | undefined = readOptionalText(
      entry["error"],
      GUIDED_SETUP_RUN_LIMITS.maxErrorLength,
    );

    if (recordId) {
      progress.recordId = recordId;
    }

    if (resourceName) {
      progress.name = resourceName;
    }

    if (error) {
      progress.error = error;
    }

    change.resources[name] = progress;
  }

  return change;
};

/*
 * The run with a change merged in, name by name: a value or a resource set
 * replaces the one kept under its name, null removes it, and what the change
 * leaves out stays. A resource set is stamped with `now`. A run that would
 * hold more than the limits is refused, so a run never grows without bound.
 */
export const applyGuidedSetupRunChange: (data: {
  values: GuidedSetupRunValues;
  resources: GuidedSetupRunResources;
  change: GuidedSetupRunChange;
  now: Date;
}) => {
  values: GuidedSetupRunValues;
  resources: GuidedSetupRunResources;
} = (data: {
  values: GuidedSetupRunValues;
  resources: GuidedSetupRunResources;
  change: GuidedSetupRunChange;
  now: Date;
}): { values: GuidedSetupRunValues; resources: GuidedSetupRunResources } => {
  const values: GuidedSetupRunValues = { ...data.values };
  const resources: GuidedSetupRunResources = { ...data.resources };

  for (const [name, value] of Object.entries(data.change.values)) {
    if (value === null) {
      delete values[name];
    } else {
      values[name] = value;
    }
  }

  for (const [name, progress] of Object.entries(data.change.resources)) {
    if (progress === null) {
      delete resources[name];
    } else {
      resources[name] = { ...progress, at: data.now.toISOString() };
    }
  }

  if (Object.keys(values).length > GUIDED_SETUP_RUN_LIMITS.maxValues) {
    throw new BadDataException(
      `A guided setup's run keeps at most ${GUIDED_SETUP_RUN_LIMITS.maxValues} values.`,
    );
  }

  if (Object.keys(resources).length > GUIDED_SETUP_RUN_LIMITS.maxResources) {
    throw new BadDataException(
      `A guided setup's run keeps at most ${GUIDED_SETUP_RUN_LIMITS.maxResources} resources.`,
    );
  }

  return { values: values, resources: resources };
};

// Whether a change changes nothing: no value and no resource named.
export const isEmptyGuidedSetupRunChange: (
  change: GuidedSetupRunChange,
) => boolean = (change: GuidedSetupRunChange): boolean => {
  return (
    Object.keys(change.values).length === 0 &&
    Object.keys(change.resources).length === 0
  );
};

export const toGuidedSetupRunAnswerJSON: (
  answer: GuidedSetupRunAnswer,
) => JSONObject = (answer: GuidedSetupRunAnswer): JSONObject => {
  return {
    setup: answer.setup,
    run: answer.run
      ? {
          values: { ...answer.run.values },
          resources: JSON.parse(
            JSON.stringify(answer.run.resources),
          ) as JSONObject,
          revision: answer.run.revision,
          updatedAt: answer.run.updatedAt,
        }
      : null,
  };
};

/*
 * An answer as the Dashboard reads it: null when it is not one, so the
 * page goes on with what its browser kept.
 */
export const parseGuidedSetupRunAnswer: (
  value: unknown,
) => GuidedSetupRunAnswer | null = (
  value: unknown,
): GuidedSetupRunAnswer | null => {
  if (!isPlainObject(value) || !isGuidedSetupKey(value["setup"])) {
    return null;
  }

  const run: unknown = value["run"];

  if (run === null || run === undefined) {
    return { setup: value["setup"], run: null };
  }

  if (!isPlainObject(run)) {
    return null;
  }

  const revision: unknown = run["revision"];
  const updatedAt: unknown = run["updatedAt"];

  return {
    setup: value["setup"],
    run: {
      values: readGuidedSetupRunValues(run["values"]),
      resources: readGuidedSetupRunResources(run["resources"]),
      revision:
        typeof revision === "number" && Number.isFinite(revision)
          ? revision
          : 0,
      updatedAt: typeof updatedAt === "string" ? updatedAt : "",
    },
  };
};
