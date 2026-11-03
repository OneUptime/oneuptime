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

  if (!resource) {
    return facts.failed
      ? translator.translateTemplate(
          CLOUD_CHANGE_TITLE_SENTENCES.failed,
          { operation },
          options,
        )
      : operation;
  }

  return translator.translateTemplate(
    facts.failed
      ? CLOUD_CHANGE_TITLE_SENTENCES.failedOnResource
      : CLOUD_CHANGE_TITLE_SENTENCES.onResource,
    { operation, resource },
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
 * What a change is called on a page: a cloud change worded from its facts
 * in the translator's language, any other change by the title it was
 * stored with - or its kind, when it has none.
 */
export function getChangeTitleForReader(data: {
  title?: string | null | undefined;
  eventType?: string | null | undefined;
  facts: CloudChangeTitleFacts | null | undefined;
  translator: Translator;
  options?: SentenceOptions | undefined;
}): string {
  if (data.facts) {
    return getCloudChangeTitle(data.facts, data.translator, data.options);
  }

  return (data.title || "").trim() || (data.eventType || "").trim();
}
