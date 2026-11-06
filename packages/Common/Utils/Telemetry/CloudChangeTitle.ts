import Dictionary from "../../Types/Dictionary";
import {
  createTranslator,
  DEFAULT_LANGUAGE,
  SentenceOptions,
  translationKey,
  Translator,
} from "../../Types/Translator";
import {
  ChangeEventFields,
  ChangeEventSource,
  ChangeEventStatus,
  readChangeEventFields,
} from "./ChangeEventFields";

/*
 * A CLOUD CHANGE'S TITLE, IN THE READER'S LANGUAGE.
 *
 * What a cloud account's activity log recorded is kept as a change event
 * whose title the server writes in English - "Failed: DeleteLoadBalancer on
 * web-alb" (CloudChangeRecorder) - for the API, an export and OneUptime AI,
 * which read it as data. The facts it is made of are kept beside it: the
 * operation as the cloud named it (oneuptime.cloud.operation), whether it
 * failed (oneuptime.change.status) and the resource it changed, by the name
 * OneUptime holds for it (oneuptime.cloud.resource_name) or the cloud's own
 * id (cloud.resource_id).
 *
 * Every place that shows such a change - a cloud resource's and a cloud
 * account's Changes, the chart markers, the Security Connections card, a
 * security case's story and impact - words it from those facts in the
 * reader's language: only the frame is translated; the operation and the
 * resource are the cloud's words and OneUptime's names, drawn as written.
 *
 * A change written before the resource's name was kept has only its title
 * and its operation: the title is read back by the recorder's own shape
 * ("[Failed: ]<operation>[ on <resource>]"), so an old row reads in the
 * reader's language too. A title of any other shape - a health event's, a
 * deploy's, one a pipeline posted - is the source's own words, drawn as
 * written: it has no facts here.
 *
 * Pure, React-free and server-safe: the recorder words the English title
 * with getCloudChangeTitle too, so the stored title and the reader's never
 * say different things.
 */

// What a cloud change's title says.
export interface CloudChangeTitleFacts {
  // The operation as the cloud named it: "DeleteLoadBalancer".
  operation: string;
  // The resource it changed, by name or the cloud's id: "" when it names none.
  resource: string;
  // Whether the cloud refused or failed it.
  failed: boolean;
}

/*
 * The sentences a title is worded in. Keys of the Dashboard's locale files
 * (the extractor reads what this file marks with translationKey): only the
 * frame is translated, never what fills it.
 */
export const CLOUD_CHANGE_TITLE_SENTENCES: {
  onResource: string;
  failedOnResource: string;
  failed: string;
} = {
  onResource: translationKey("{{operation}} on {{resource}}"),
  failedOnResource: translationKey("Failed: {{operation}} on {{resource}}"),
  failed: translationKey("Failed: {{operation}}"),
};

// What the recorder's English title starts with when the change failed.
const FAILED_TITLE_PREFIX: string = "Failed: ";

// What sits between the operation and the resource in the English title.
const ON_RESOURCE: string = " on ";

const ENGLISH: Translator = createTranslator(undefined, DEFAULT_LANGUAGE);

/*
 * The sentence a change's title is worded in (CLOUD_CHANGE_TITLE_SENTENCES),
 * by its facts: "{{operation}} on {{resource}}", its "Failed: " forms, or
 * null when the title is the operation alone - one that did not fail and
 * names no resource. A page that draws the operation and the resource as
 * elements of their own (TranslatedSentence) picks its sentence here, so it
 * says what getCloudChangeTitle says.
 */
export function getCloudChangeTitleSentence(
  facts: CloudChangeTitleFacts,
): string | null {
  if (!facts.resource.trim()) {
    return facts.failed ? CLOUD_CHANGE_TITLE_SENTENCES.failed : null;
  }

  return facts.failed
    ? CLOUD_CHANGE_TITLE_SENTENCES.failedOnResource
    : CLOUD_CHANGE_TITLE_SENTENCES.onResource;
}

/*
 * A change's title in the translator's language - English without one, word
 * for word what the recorder stores. `options` are the sentence's
 * (SentenceOptions): a title drawn on a page sets its values apart, so a
 * Latin operation keeps its place in a Persian sentence.
 */
export function getCloudChangeTitle(
  facts: CloudChangeTitleFacts,
  translator: Translator = ENGLISH,
  options?: SentenceOptions | undefined,
): string {
  const operation: string = facts.operation.trim();
  const resource: string = facts.resource.trim();
  const sentence: string | null = getCloudChangeTitleSentence(facts);

  if (!sentence) {
    return operation;
  }

  return translator.translateTemplate(
    sentence,
    resource ? { operation, resource } : { operation },
    options,
  );
}

/*
 * The resource a title written before the resource's name was kept names,
 * read by the recorder's own shape - "[Failed: ]<operation>[ on
 * <resource>]" - or null when the title has another shape (one cut short
 * inside its operation, one written some other way), which is then drawn as
 * written. Plain string reads: no pattern runs on text a cloud wrote.
 */
export function readResourceFromCloudChangeTitle(data: {
  title: string;
  operation: string;
}): string | null {
  const operation: string = data.operation.trim();
  let rest: string = data.title.trim();

  if (!operation) {
    return null;
  }

  if (rest.startsWith(FAILED_TITLE_PREFIX)) {
    rest = rest.slice(FAILED_TITLE_PREFIX.length);
  }

  if (!rest.startsWith(operation)) {
    return null;
  }

  rest = rest.slice(operation.length);

  if (rest === "") {
    return "";
  }

  if (!rest.startsWith(ON_RESOURCE)) {
    return null;
  }

  return rest.slice(ON_RESOURCE.length).trim();
}

/*
 * The facts of a stored change event, when it is one a cloud account's
 * activity log recorded (oneuptime.change.source "cloud"): its operation,
 * whether it failed, and the resource - by the name kept beside it, else by
 * its title's own words (a row written before the name was kept, or one
 * whose resource OneUptime does not hold, which its title names by the
 * cloud's id). Null for every other change: a health event's title is its
 * provider's words, a deploy's its pipeline's.
 */
export function readCloudChangeTitleFacts(change: {
  title?: string | null | undefined;
  attributes?: Dictionary<unknown> | null | undefined;
}): CloudChangeTitleFacts | null {
  const fields: ChangeEventFields = readChangeEventFields(change.attributes);

  if (fields.source !== ChangeEventSource.Cloud || !fields.cloudOperation) {
    return null;
  }

  const failed: boolean = fields.status === ChangeEventStatus.Failed;

  if (fields.cloudResourceName) {
    return {
      operation: fields.cloudOperation,
      resource: fields.cloudResourceName,
      failed,
    };
  }

  const resource: string | null = readResourceFromCloudChangeTitle({
    title: change.title || "",
    operation: fields.cloudOperation,
  });

  if (resource === null) {
    return null;
  }

  return { operation: fields.cloudOperation, resource, failed };
}

/*
 * Facts as an API answer carries them (a security case's story, its
 * impact, its connected resources): the shape checked, so a value from the
 * wire is used only when it is one. Null otherwise.
 */
export function readCloudChangeTitleFactsJson(
  value: unknown,
): CloudChangeTitleFacts | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record: Dictionary<unknown> = value as Dictionary<unknown>;
  const operation: unknown = record["operation"];
  const resource: unknown = record["resource"];
  const failed: unknown = record["failed"];

  if (
    typeof operation !== "string" ||
    !operation.trim() ||
    typeof resource !== "string" ||
    typeof failed !== "boolean"
  ) {
    return null;
  }

  return { operation, resource, failed };
}

/*
 * ---- Health events --------------------------------------------------------
 *
 * What a cloud published about its health - AWS Health, Azure Service and
 * Resource Health, Google Cloud's Service Health - is stored with the
 * English title its connector writes: "AWS Health: EC2 operational issue
 * (open)", "Azure Resource Health: Available → Unavailable". The event is
 * the provider's own words and is drawn as written; the frame and the
 * state the provider reports it in are worded in the reader's language. A
 * state no rule here knows is left in the event, drawn as written, so a
 * title is never cut wrongly.
 */

export enum CloudHealthSource {
  Aws = "aws",
  AzureService = "azure-service",
  AzureResource = "azure-resource",
  GoogleCloud = "gcp",
}

// What a health event's title says.
export interface CloudHealthTitleFacts {
  source: CloudHealthSource;
  // The event as its provider names it, or a resource's state now (Azure Resource Health).
  event: string;
  // The state the provider reports the event in ("open"), or a resource's state before: "" when none.
  status: string;
}

/*
 * The sentences a health title is worded in: the provider's name is its
 * own, never translated. Keys of the Dashboard's locale files.
 */
export const CLOUD_HEALTH_TITLE_SENTENCES: Record<
  CloudHealthSource,
  { event: string; eventWithStatus: string }
> = {
  [CloudHealthSource.Aws]: {
    event: translationKey("AWS Health: {{event}}"),
    eventWithStatus: translationKey("AWS Health: {{event}} ({{status}})"),
  },
  [CloudHealthSource.AzureService]: {
    event: translationKey("Azure Service Health: {{event}}"),
    eventWithStatus: translationKey(
      "Azure Service Health: {{event}} ({{status}})",
    ),
  },
  [CloudHealthSource.AzureResource]: {
    event: translationKey("Azure Resource Health: {{event}}"),
    // A resource's state before and now.
    eventWithStatus: translationKey(
      "Azure Resource Health: {{status}} → {{event}}",
    ),
  },
  [CloudHealthSource.GoogleCloud]: {
    event: translationKey("Google Cloud Service Health: {{event}}"),
    eventWithStatus: translationKey(
      "Google Cloud Service Health: {{event}} ({{status}})",
    ),
  },
};

// How each connector's title starts (AwsChanges, AzureChanges, GcpChanges).
const HEALTH_TITLE_PREFIXES: ReadonlyArray<{
  source: CloudHealthSource;
  prefix: string;
}> = [
  { source: CloudHealthSource.Aws, prefix: "AWS Health: " },
  { source: CloudHealthSource.AzureService, prefix: "Azure Service Health: " },
  {
    source: CloudHealthSource.AzureResource,
    prefix: "Azure Resource Health: ",
  },
  {
    source: CloudHealthSource.GoogleCloud,
    prefix: "Google Cloud Service Health: ",
  },
];

// What sits between a resource's state before and now in Azure Resource Health's title.
const STATE_ARROW: string = " → ";

/*
 * The states each provider reports, as its connector writes them, and the
 * words they are said in (keys of the Dashboard's locale files). AWS
 * Health's statusCode, Azure Service Health's stage, Google Cloud's
 * incident state (lower-cased by its connector), Azure Resource Health's
 * availability.
 */
export const CLOUD_HEALTH_STATE_WORDS: Record<
  CloudHealthSource,
  Readonly<Record<string, string>>
> = {
  [CloudHealthSource.Aws]: {
    open: translationKey("open"),
    closed: translationKey("closed"),
    upcoming: translationKey("upcoming"),
  },
  [CloudHealthSource.AzureService]: {
    Active: translationKey("Active"),
    Resolved: translationKey("Resolved"),
  },
  [CloudHealthSource.AzureResource]: {
    Available: translationKey("Available"),
    Unavailable: translationKey("Unavailable"),
    Degraded: translationKey("Degraded"),
    Unknown: translationKey("Unknown"),
  },
  [CloudHealthSource.GoogleCloud]: {
    active: translationKey("active"),
    closed: translationKey("closed"),
  },
};

function knownState(source: CloudHealthSource, state: string): boolean {
  return Object.prototype.hasOwnProperty.call(
    CLOUD_HEALTH_STATE_WORDS[source],
    state,
  );
}

/*
 * The facts of a stored health event's title, or null for any other change
 * or a title of another shape (drawn as written). Plain string reads: no
 * pattern runs on text a cloud wrote.
 */
export function readCloudHealthTitleFacts(change: {
  title?: string | null | undefined;
  attributes?: Dictionary<unknown> | null | undefined;
}): CloudHealthTitleFacts | null {
  const fields: ChangeEventFields = readChangeEventFields(change.attributes);

  if (fields.source !== ChangeEventSource.CloudHealth) {
    return null;
  }

  const title: string = (change.title || "").trim();
  const shape: { source: CloudHealthSource; prefix: string } | undefined =
    HEALTH_TITLE_PREFIXES.find(
      (candidate: { source: CloudHealthSource; prefix: string }): boolean => {
        return title.startsWith(candidate.prefix);
      },
    );

  if (!shape) {
    return null;
  }

  const rest: string = title.slice(shape.prefix.length).trim();

  if (!rest) {
    return null;
  }

  if (shape.source === CloudHealthSource.AzureResource) {
    const arrow: number = rest.indexOf(STATE_ARROW);

    if (arrow > 0) {
      const before: string = rest.slice(0, arrow).trim();
      const now: string = rest.slice(arrow + STATE_ARROW.length).trim();

      if (knownState(shape.source, before) && knownState(shape.source, now)) {
        return { source: shape.source, event: now, status: before };
      }
    }

    return { source: shape.source, event: rest, status: "" };
  }

  // "<event> (<state>)": the state only when the provider reports such a state.
  if (rest.endsWith(")")) {
    const open: number = rest.lastIndexOf(" (");

    if (open > 0) {
      const state: string = rest.slice(open + 2, -1);

      if (knownState(shape.source, state)) {
        return {
          source: shape.source,
          event: rest.slice(0, open).trim(),
          status: state,
        };
      }
    }
  }

  return { source: shape.source, event: rest, status: "" };
}

/*
 * A health event's title in the translator's language - English without
 * one, word for word what its connector stores.
 */
export function getCloudHealthTitle(
  facts: CloudHealthTitleFacts,
  translator: Translator = ENGLISH,
  options?: SentenceOptions | undefined,
): string {
  const sentences: { event: string; eventWithStatus: string } =
    CLOUD_HEALTH_TITLE_SENTENCES[facts.source];
  const words: Readonly<Record<string, string>> =
    CLOUD_HEALTH_STATE_WORDS[facts.source];
  // A resource's state is said in the reader's words; any other event as written.
  const event: string =
    facts.source === CloudHealthSource.AzureResource &&
    knownState(facts.source, facts.event)
      ? translator.translateTerm(words[facts.event]!)
      : facts.event;

  if (!facts.status || !knownState(facts.source, facts.status)) {
    return translator.translateTemplate(sentences.event, { event }, options);
  }

  return translator.translateTemplate(
    sentences.eventWithStatus,
    { event, status: translator.translateTerm(words[facts.status]!) },
    options,
  );
}

/*
 * What a change is called on a page: a cloud change worded from its facts
 * in the translator's language, a health event from its title's facts, any
 * other change by the title it was stored with - or its kind, when it has
 * none.
 */
export function getChangeTitleForReader(data: {
  title?: string | null | undefined;
  eventType?: string | null | undefined;
  facts: CloudChangeTitleFacts | null | undefined;
  health?: CloudHealthTitleFacts | null | undefined;
  translator: Translator;
  options?: SentenceOptions | undefined;
}): string {
  if (data.facts) {
    return getCloudChangeTitle(data.facts, data.translator, data.options);
  }

  if (data.health) {
    return getCloudHealthTitle(data.health, data.translator, data.options);
  }

  return (data.title || "").trim() || (data.eventType || "").trim();
}
