import {
  getUniqueName,
  normalizeNameForComparison,
} from "Common/UI/Components/Forms/Utils/UniqueName";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * Adding a resource the way a host is added (Add Host): the list's Add
 * button opens the resource's setup guide in a dialog - where it runs, the
 * key, the commands, already filled in - and the guide's last step watches
 * for the resource to connect and says so, with a link to it. While the
 * project has none, the list shows what the product gives under its empty
 * table instead (Components/ResourceShowcase), with the same Add button.
 *
 * Kubernetes clusters, Docker and Podman hosts, Docker Swarm, Proxmox and
 * Ceph clusters, storage arrays, IoT fleets, serverless functions, cloud
 * environments and RUM applications register themselves when their first
 * data arrives, named after what the agent reports (clusterName,
 * DOCKER_HOST_NAME, iot.fleet.name ...). So their lists have no form: a
 * record typed in by hand only waits for data nothing sends, and data
 * reported under another name registers a second record. Where the agent
 * is told the name, the guide asks for it above its steps and writes it
 * into every command.
 *
 * A database or a queue is added with a form - its address is what the
 * agent is pointed at - so their lists keep it, and the guide for the one
 * just added opens on its own once it is saved.
 *
 * React-free, so App tests can read it: ResourceNameField,
 * ResourceConnectionWatch, AddResourceGuide and AddResourceModal draw it.
 */

/*
 * How often the last step asks whether the resource has connected. Agents
 * report within a minute of starting, and the step says so.
 */
export const RESOURCE_CONNECTION_POLL_INTERVAL_MS: number = 5000;

// ---- the name the commands carry -------------------------------------------

/*
 * The longest name the guide writes into its commands. Longer typing is
 * cut, and a paste of any length is cut before anything reads it.
 */
export const RESOURCE_NAME_MAX_LENGTH: number = 100;

// Letters, digits, dots, dashes and underscores: safe in every command.
const NAME_CHARACTER: RegExp = /^[A-Za-z0-9._-]$/;

/**
 * The name as every command carries it: what was typed, its accents
 * dropped ("Zürich" is "Zurich"), with each run of anything else (spaces,
 * quotes, commas, `$`) made one dash, and no dash or dot at either end.
 * Helm's --set, a shell word, an env file and a YAML list all take such a
 * name as it is, so no command needs quoting it and no agent reads it
 * differently. Empty when nothing usable was typed.
 *
 * A loop, not a regular expression, over a paste cut short first: a paste
 * can be long (Docs/notifications/README.md, "Megabyte-long values").
 */
export function toResourceName(typed: string): string {
  const characters: Array<string> = Array.from(
    typed.slice(0, RESOURCE_NAME_MAX_LENGTH * 4).normalize("NFKD"),
  ).filter((character: string): boolean => {
    return !isCombiningMark(character);
  });
  let name: string = "";
  /*
   * Something was left out since the last character kept: a dash goes in
   * before the next one, unless there is a dash or a dot there already.
   */
  let isDashPending: boolean = false;

  for (const character of characters) {
    if (!NAME_CHARACTER.test(character)) {
      isDashPending = name.length > 0;
      continue;
    }

    if (
      isDashPending &&
      !isEndCharacter(character) &&
      !isEndCharacter(name.charAt(name.length - 1))
    ) {
      name += "-";
    }

    name += character;
    isDashPending = false;
  }

  return trimNameEnds(name.slice(0, RESOURCE_NAME_MAX_LENGTH));
}

// No dash or dot at the start or the end.
function trimNameEnds(name: string): string {
  let start: number = 0;
  let end: number = name.length;

  while (start < end && isEndCharacter(name.charAt(start))) {
    start++;
  }

  while (end > start && isEndCharacter(name.charAt(end - 1))) {
    end--;
  }

  return name.slice(start, end);
}

function isEndCharacter(character: string): boolean {
  return character === "-" || character === ".";
}

// An accent NFKD split off its letter (U+0300 to U+036F).
function isCombiningMark(character: string): boolean {
  const code: number = character.charCodeAt(0);
  return character.length === 1 && code >= 0x0300 && code <= 0x036f;
}

/**
 * The name the guide starts with: its example ("my-cluster") while the
 * project has none of that name, else the first of "my-cluster-2",
 * "my-cluster-3", ... that it has not. Two clusters installed with one name
 * would report into one record.
 */
export function getSuggestedResourceName(data: {
  example: string;
  existingNames: Iterable<string | null | undefined>;
}): string {
  return getUniqueName({
    name: data.example,
    existingNames: data.existingNames,
    separator: "-",
  });
}

/**
 * Whether two names are one resource's: ingest matches what an agent
 * reports case-insensitively (findOrCreateBy...), so "Prod" is "prod".
 */
export function isSameResourceName(
  first: string | null | undefined,
  second: string | null | undefined,
): boolean {
  if (typeof first !== "string" || typeof second !== "string") {
    return false;
  }

  if (first.trim().length === 0) {
    return false;
  }

  return (
    normalizeNameForComparison(first) === normalizeNameForComparison(second)
  );
}

/**
 * Of the records that registered since the guide opened (newest first), the
 * one it was waiting for: the one with the guide's name, else the newest -
 * the command may have been edited. Not when the project already has a
 * resource of the guide's name (`isNameTaken`): the agent's data goes to
 * that one, so another one registering is someone else's.
 */
export function pickConnectedRecord<TRecord>(data: {
  records: Array<TRecord>;
  name?: string | undefined;
  getName: (record: TRecord) => string | null | undefined;
  isNameTaken?: boolean | undefined;
}): TRecord | undefined {
  if (data.name) {
    const named: TRecord | undefined = data.records.find(
      (record: TRecord): boolean => {
        return isSameResourceName(data.getName(record), data.name);
      },
    );

    if (named) {
      return named;
    }
  }

  return data.isNameTaken ? undefined : data.records[0];
}

/**
 * A resource that was in the project under the guide's name before it
 * opened: it has connected once it reports again - its lastSeenAt is later
 * than the one it had when the guide looked it up. Both are the server's
 * clock, so a browser clock that is off changes nothing.
 *
 * Whether or not it was reporting then: one that stopped minutes ago still
 * reads as connected for a while (its lastSeenAt can lag five minutes behind
 * live data, and it is marked disconnected after fifteen), and a reinstall
 * under its name is what it is waiting for.
 */
export function hasReportedSince(data: {
  lastSeenAtThen: Date | string | null | undefined;
  lastSeenAtNow: Date | string | null | undefined;
}): boolean {
  if (!data.lastSeenAtNow) {
    return false;
  }

  const now: number = new Date(data.lastSeenAtNow).getTime();

  if (!Number.isFinite(now)) {
    return false;
  }

  if (!data.lastSeenAtThen) {
    return true;
  }

  const then: number = new Date(data.lastSeenAtThen).getTime();

  return !Number.isFinite(then) || now > then;
}

/**
 * The first data a telemetry guide's ingestion key sends (#7754): the key
 * had sent nothing when the step first looked at it (no lastUsedAt), and
 * now it has. Telemetry that names no service - FluentBit's logs as the
 * guide configures them, OTLP without service.name - registers no
 * service, so this is how the step sees it arrive.
 *
 * Only a key's first data counts. Ingest stamps lastUsedAt at most once
 * every five minutes per process (TelemetryIngestionKeyService.markUsed),
 * so the stamp of a key something already sends with moves on whether or
 * not the shipper just set up sent anything: a later stamp would pass that
 * shipper off as connected. Such a key leaves the step to the service
 * check. Both values are the server's clock, as everywhere in the watch.
 */
export function hasKeySentFirstData(data: {
  lastUsedAtThen: Date | string | null | undefined;
  lastUsedAtNow: Date | string | null | undefined;
}): boolean {
  if (data.lastUsedAtThen || !data.lastUsedAtNow) {
    return false;
  }

  return Number.isFinite(new Date(data.lastUsedAtNow).getTime());
}

/**
 * Whether only a new service can finish a telemetry guide's last step
 * (#9456): the project had every first-data mark of the guide's signals
 * when the step first looked, and the key the step watches - when it
 * watches one - had sent before that look. Then neither a mark nor the
 * key's first data is still to come, and data that names no service - a
 * second FluentBit, beside the logs the project already has - cannot be
 * told from the data that came before it. The step says so, and where that
 * data shows, instead of waiting for "the first data" for good.
 *
 * Unknown until both first looks are in: a mark not looked for yet, a key
 * not looked at yet.
 */
export function canOnlySpotNewService(data: {
  // Every mark was kept at the first look; null before that look.
  hadEveryMarkAtFirstLook: boolean | null;
  isWatchingKey: boolean;
  // The key's lastUsedAt at its first look; undefined before that look.
  keyLastUsedAtFirstLook: Date | string | null | undefined;
}): boolean {
  if (data.hadEveryMarkAtFirstLook !== true) {
    return false;
  }

  if (!data.isWatchingKey) {
    return true;
  }

  return Boolean(data.keyLastUsedAtFirstLook);
}

// ---- what the guide says ---------------------------------------------------

/*
 * Under the name field. The guide's own notes say what changing the name
 * later does ("a new name registers a new cluster").
 */
export const RESOURCE_NAME_FIELD_HINT: string = translationKey(
  "How it shows up in OneUptime. The commands below use this name.",
);

// Under the field when what was typed is not the name the commands carry.
export const RESOURCE_NAME_REPORTED_AS: string = translationKey(
  "The agent reports it as {{name}}.",
);

/*
 * Under the field when the project already has a resource of that name:
 * the agent's data goes to it (ingest finds it by name), so the guide says
 * so rather than adding a second one nobody asked for.
 */
export const RESOURCE_NAME_TAKEN: string = translationKey(
  "{{name}} is already in this project, so the agent's data goes to it. {{link}}",
);

// The live last step of every Add guide.
export const RESOURCE_CONNECTION_STEP_TITLE: string = translationKey(
  "Wait for it to connect",
);

// Under that step's title, on a list's Add guide.
export const RESOURCE_CONNECTION_STEP_DESCRIPTION: string = translationKey(
  "It shows up in this list as soon as it connects.",
);

export const RESOURCE_CONNECTION_WAITING_FOR_NAME: string = translationKey(
  "Waiting for {{name}} to connect. This step updates by itself.",
);

// For a guide that names nothing: functions and environments name themselves.
export const RESOURCE_CONNECTION_WAITING: string = translationKey(
  "Waiting for the first data. This step updates by itself.",
);

export const RESOURCE_CONNECTION_CONNECTED: string = translationKey(
  "{{name}} is connected. Its data arrives within a minute or two.",
);

/*
 * A telemetry guide's key sent its first data, and no service registered:
 * the data names none (hasKeySentFirstData). {{name}} is the key's name.
 */
export const RESOURCE_CONNECTION_DATA_ARRIVED: string = translationKey(
  "The first data arrived with the key {{name}}. It shows up within a minute or two.",
);

/*
 * The project's first data of a telemetry guide's signal arrived, and no
 * service registered (#7888): its first logs for the logs guide, whichever
 * key sent them - a key that already sends traces too - and whether or not
 * they name a service. Ingest keeps the mark once the data is stored, so it
 * is there to view.
 */
export const RESOURCE_CONNECTION_FIRST_DATA_ARRIVED: string = translationKey(
  "The first data arrived.",
);

/*
 * The project receives the guide's data already, on the key the step
 * watches (canOnlySpotNewService, #9456): only a new service finishes the
 * step, and data that names none - a second shipper's - shows in the
 * explorer, which the step links to.
 */
export const RESOURCE_CONNECTION_ALREADY_RECEIVING: string = translationKey(
  "This project already receives this data, so this step finishes when a new service reports. Data that names no service shows up in the explorer as it arrives.",
);

/*
 * A guide that only a service finishes (the telemetry guided setup alerts
 * on that service) saw data arrive that names none (#7888): it says how to
 * finish, and keeps waiting. {{attribute}} is service.name, drawn as code.
 */
export const RESOURCE_CONNECTION_DATA_NAMES_NO_SERVICE: string = translationKey(
  "Data arrived, but it names no service. Set {{attribute}} in your app to finish this step.",
);

// The resource attribute that names a telemetry service.
export const SERVICE_NAME_ATTRIBUTE: string = "service.name";

/*
 * At the top of the guide that opens once a form has added a resource
 * (ResourceAddedModal): the form did its part, and the steps do the rest.
 */
export const RESOURCE_ADDED: string = translationKey(
  "{{name}} is added. Follow the steps below to start receiving its data.",
);
