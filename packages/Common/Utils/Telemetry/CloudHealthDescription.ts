import {
  CloudProvider,
  getCloudProviderLabel,
} from "../../Types/Cloud/CloudPlatform";
import Dictionary from "../../Types/Dictionary";
import {
  composedValue,
  createTranslator,
  DEFAULT_LANGUAGE,
  formatList,
  translationKey,
  Translator,
} from "../../Types/Translator";
import {
  ChangeEventFields,
  ChangeEventSource,
  readChangeEventFields,
} from "./ChangeEventFields";

/*
 * A CLOUD HEALTH EVENT'S DESCRIPTION, IN THE READER'S LANGUAGE WHERE IT IS
 * OURS.
 *
 * What a cloud publishes about its health is kept as a change event whose
 * description its connector writes (AwsChanges, AzureChanges, GcpChanges,
 * CloudChangeRecorder) - for the API and OneUptime AI, in English. Two
 * kinds of words are in it:
 *
 *   - the provider's own: an AWS Health event's description, a Google Cloud
 *     incident's, an Azure resource's health title. They are drawn as
 *     written - in English, as those APIs answer - and never put through a
 *     translation or rewritten: OneUptime would be inventing what the
 *     provider said;
 *   - OneUptime's own, a sentence its connector writes from what the event
 *     carries: an Azure Service Health event's kind and tracking id, what
 *     caused an Azure resource's change, the products a Google Cloud
 *     incident affects when it says nothing more, and who published an
 *     event that came without words. Those are worded in the reader's
 *     language, from the facts read back off the stored English - old rows
 *     too, as the titles are (CloudChangeTitle) - every one a whole
 *     sentence (keys of the Dashboard's locale files).
 *
 * A description of any other shape is the provider's words, as written.
 * Plain string reads: no pattern runs on text a cloud wrote.
 */

export enum CloudHealthDescriptionKind {
  // The provider's own words, drawn as written.
  Written = "written",
  // An Azure Service Health event: its kind and tracking id.
  AzureServicePublished = "azure-service-published",
  // An Azure resource's health title, and what caused its change.
  AzureResourceCause = "azure-resource-cause",
  // The products a Google Cloud incident affects, when it says nothing more.
  GoogleCloudAffects = "google-cloud-affects",
  // An event that came without words: who published it, for which account.
  Published = "published",
}

export type CloudHealthDescriptionFacts =
  | { kind: CloudHealthDescriptionKind.Written; text: string }
  | {
      kind: CloudHealthDescriptionKind.AzureServicePublished;
      // Azure's incidentType ("Incident", "Maintenance"): "" when it named none.
      incidentType: string;
      // Azure's tracking id: "" when it gave none.
      trackingId: string;
    }
  | {
      kind: CloudHealthDescriptionKind.AzureResourceCause;
      // The resource's health title, as Azure wrote it: "" when it wrote none.
      written: string;
      cause: AzureResourceHealthCause;
    }
  | {
      kind: CloudHealthDescriptionKind.GoogleCloudAffects;
      // The products, as Google names them.
      products: Array<string>;
    }
  | {
      kind: CloudHealthDescriptionKind.Published;
      // The cloud (cloud.provider): "aws", "azure", "gcp".
      provider: string;
      // The account as the connector named it, with its Region: "123456789012 (us-east-1)".
      account: string;
    };

// What caused an Azure resource's health to change (its Activity Log event's cause).
export enum AzureResourceHealthCause {
  Platform = "PlatformInitiated",
  User = "UserInitiated",
}

/*
 * What the Azure connector writes for each cause, in the stored English,
 * and the sentence each is worded in.
 */
export const AZURE_RESOURCE_HEALTH_CAUSE_SENTENCES: Readonly<
  Record<AzureResourceHealthCause, string>
> = {
  [AzureResourceHealthCause.Platform]: translationKey("Azure caused it."),
  [AzureResourceHealthCause.User]: translationKey(
    "Someone with access caused it.",
  ),
};

/*
 * The kinds of event Azure Service Health publishes (its incidentType), each
 * worded as a whole sentence: the kind is said where it stands, never a
 * word dropped into a frame.
 */
export const AZURE_SERVICE_HEALTH_PUBLISHED_SENTENCES: Readonly<
  Record<string, string>
> = {
  Incident: translationKey("Azure published an incident."),
  Maintenance: translationKey("Azure published planned maintenance."),
  Information: translationKey("Azure published a health advisory."),
  ActionRequired: translationKey(
    "Azure published an advisory that needs your action.",
  ),
  Security: translationKey("Azure published a security advisory."),
};

// An Azure Service Health event of a kind the sentences above do not name.
export const AZURE_SERVICE_HEALTH_PUBLISHED: string = translationKey(
  "Published by Azure.",
);

// Azure's tracking id, the one a support case or the Azure portal asks for.
export const AZURE_SERVICE_HEALTH_TRACKING_ID: string = translationKey(
  "Tracking ID: {{trackingId}}.",
);

// The products a Google Cloud incident affects, as Google names them.
export const GOOGLE_CLOUD_AFFECTS_SENTENCE: string = translationKey(
  "Affects {{products}}.",
);

/*
 * Who published an event that came without words, for which account: the
 * cloud by its name, or - a provider OneUptime does not name - in words.
 */
export const CLOUD_HEALTH_PUBLISHED_SENTENCES: {
  byProvider: string;
  byCloudProvider: string;
} = {
  byProvider: translationKey(
    "Published by {{provider}} for account {{account}}.",
  ),
  byCloudProvider: translationKey(
    "Published by the cloud provider for account {{account}}.",
  ),
};

// The stored English the facts are read back from (the connectors' own shapes).
const AZURE_PUBLISHED: string = "published by Azure";
const AZURE_PUBLISHED_ALONE: string = "Published by Azure";
const AZURE_TRACKING_ID: string = "tracking id ";
const AZURE_STAGE: string = "stage ";
const GOOGLE_CLOUD_AFFECTS: string = "Affects ";
const PUBLISHED_FOR_ACCOUNT: string =
  ", published by the cloud provider for account ";
const PART_SEPARATOR: string = ", ";

const ENGLISH: Translator = createTranslator(undefined, DEFAULT_LANGUAGE);

// The languages whose sentences follow one another with no space between them.
const SENTENCES_RUN_ON: ReadonlyArray<string> = ["ja", "zh"];

/*
 * Two sentences of the reader's language, one after the other: a space
 * between them, but none in Japanese or Chinese, whose full stop ("。")
 * is the gap.
 */
export function joinSentences(
  sentences: ReadonlyArray<string>,
  language: string,
): string {
  const base: string = (language.split("-")[0] || "").toLowerCase();

  return sentences
    .filter((sentence: string): boolean => {
      return sentence.length > 0;
    })
    .join(SENTENCES_RUN_ON.includes(base) ? "" : " ");
}

// The characters a sentence ends with.
const SENTENCE_ENDS: ReadonlyArray<string> = [".", "!", "?"];

/*
 * Text as one sentence: its own full stops at its end become one, and a
 * sentence that ends with its own "!" or "?" keeps it. "" stays "".
 */
export function asOneSentence(text: string): string {
  let end: number = text.length;

  while (end > 0 && (text[end - 1] === "." || text[end - 1] === " ")) {
    end--;
  }

  const sentence: string = text.slice(0, end).trim();

  if (!sentence) {
    return "";
  }

  return SENTENCE_ENDS.includes(sentence[sentence.length - 1]!)
    ? sentence
    : `${sentence}.`;
}

/*
 * An Azure Service Health description as its connector writes it -
 * "Incident published by Azure, tracking id ABC-123, stage Active." - or
 * null for any other shape. The stage is the title's (CloudChangeTitle).
 */
function readAzureServiceDescription(
  description: string,
): CloudHealthDescriptionFacts | null {
  if (!description.endsWith(".")) {
    return null;
  }

  const parts: Array<string> = description.slice(0, -1).split(PART_SEPARATOR);
  const first: string = parts.shift() || "";
  let incidentType: string = "";

  if (first !== AZURE_PUBLISHED_ALONE) {
    if (!first.endsWith(` ${AZURE_PUBLISHED}`)) {
      return null;
    }

    incidentType = first.slice(0, -(AZURE_PUBLISHED.length + 1)).trim();

    if (!incidentType || incidentType.includes(" ")) {
      return null;
    }
  }

  let trackingId: string = "";

  for (const part of parts) {
    if (part.startsWith(AZURE_TRACKING_ID) && !trackingId) {
      trackingId = part.slice(AZURE_TRACKING_ID.length).trim();
      continue;
    }

    if (part.startsWith(AZURE_STAGE)) {
      continue;
    }

    return null;
  }

  return {
    kind: CloudHealthDescriptionKind.AzureServicePublished,
    incidentType,
    trackingId,
  };
}

/*
 * An Azure Resource Health description as its connector writes it - the
 * resource's health title, then what caused the change: "Virtual machine
 * is unavailable. Azure caused it." A title alone is Azure's words.
 */
function readAzureResourceDescription(
  description: string,
): CloudHealthDescriptionFacts | null {
  for (const cause of Object.values(AzureResourceHealthCause)) {
    const sentence: string = AZURE_RESOURCE_HEALTH_CAUSE_SENTENCES[cause];

    if (description !== sentence && !description.endsWith(` ${sentence}`)) {
      continue;
    }

    // Azure's title before it, one sentence - "restarted.. Azure caused it." an older row wrote.
    return {
      kind: CloudHealthDescriptionKind.AzureResourceCause,
      written: asOneSentence(
        description.slice(0, description.length - sentence.length),
      ),
      cause,
    };
  }

  return null;
}

// "Affects Cloud SQL, Compute Engine." - what the Google Cloud connector writes when an incident says nothing more.
function readGoogleCloudAffects(
  description: string,
): CloudHealthDescriptionFacts | null {
  if (
    !description.startsWith(GOOGLE_CLOUD_AFFECTS) ||
    !description.endsWith(".") ||
    description.includes("\n")
  ) {
    return null;
  }

  const list: string = description
    .slice(GOOGLE_CLOUD_AFFECTS.length, -1)
    .trim();

  // A sentence of the provider's own that happens to start the same way.
  if (!list || list.includes(". ")) {
    return null;
  }

  const products: Array<string> = list
    .split(PART_SEPARATOR)
    .map((product: string): string => {
      return product.trim();
    })
    .filter((product: string): boolean => {
      return product.length > 0;
    });

  return products.length > 0
    ? { kind: CloudHealthDescriptionKind.GoogleCloudAffects, products }
    : null;
}

/*
 * The recorder's words for an event that came without any:
 * "AWS_EC2_OPERATIONAL_ISSUE, published by the cloud provider for account
 * 123456789012 (us-east-1)." The event's kind is in its title.
 */
function readPublishedForAccount(
  description: string,
  provider: string,
): CloudHealthDescriptionFacts | null {
  const at: number = description.indexOf(PUBLISHED_FOR_ACCOUNT);

  if (at <= 0 || !description.endsWith(".") || description.includes("\n")) {
    return null;
  }

  const account: string = description
    .slice(at + PUBLISHED_FOR_ACCOUNT.length, -1)
    .trim();

  return account
    ? { kind: CloudHealthDescriptionKind.Published, provider, account }
    : null;
}

/*
 * The facts of a health event's stored description, or null for any other
 * change or an empty description. A description no rule here reads is the
 * provider's words (Written).
 */
export function readCloudHealthDescriptionFacts(change: {
  description?: string | null | undefined;
  attributes?: Dictionary<unknown> | null | undefined;
}): CloudHealthDescriptionFacts | null {
  const fields: ChangeEventFields = readChangeEventFields(change.attributes);

  if (fields.source !== ChangeEventSource.CloudHealth) {
    return null;
  }

  const description: string = (change.description || "").trim();

  if (!description || description === ".") {
    return null;
  }

  const provider: string = (fields.cloudProvider || "").trim().toLowerCase();
  const operation: string = (fields.cloudOperation || "").trim();

  const read: CloudHealthDescriptionFacts | null =
    readPublishedForAccount(description, provider) ||
    (provider === CloudProvider.Azure && operation.startsWith("ServiceHealth")
      ? readAzureServiceDescription(description)
      : null) ||
    (provider === CloudProvider.Azure && operation.startsWith("ResourceHealth")
      ? readAzureResourceDescription(description)
      : null) ||
    (provider === CloudProvider.GCP
      ? readGoogleCloudAffects(description)
      : null);

  return (
    read || { kind: CloudHealthDescriptionKind.Written, text: description }
  );
}

// A health event's description as a page draws it.
export interface CloudHealthDescription {
  // The provider's own words, as written (English): "" when it has none.
  written: string;
  // OneUptime's words about the event, in the translator's language: "" when it has none.
  worded: string;
  /*
   * An identifier in the worded line, which a page keeps whole on its line:
   * Azure's tracking id ("7NQ8-TX0" never broken at its hyphen).
   */
  identifier?: string | undefined;
}

/*
 * A health event's description in the translator's language - English
 * without one: the provider's words as written, OneUptime's own worded.
 */
export function getCloudHealthDescription(
  facts: CloudHealthDescriptionFacts,
  translator: Translator = ENGLISH,
): CloudHealthDescription {
  switch (facts.kind) {
    case CloudHealthDescriptionKind.AzureServicePublished: {
      const kind: string =
        Object.prototype.hasOwnProperty.call(
          AZURE_SERVICE_HEALTH_PUBLISHED_SENTENCES,
          facts.incidentType,
        ) && AZURE_SERVICE_HEALTH_PUBLISHED_SENTENCES[facts.incidentType]
          ? AZURE_SERVICE_HEALTH_PUBLISHED_SENTENCES[facts.incidentType]!
          : AZURE_SERVICE_HEALTH_PUBLISHED;
      const published: string = translator.translateText(kind) || kind;

      return {
        written: "",
        worded: joinSentences(
          [
            published,
            facts.trackingId
              ? translator.translateTemplate(
                  AZURE_SERVICE_HEALTH_TRACKING_ID,
                  { trackingId: facts.trackingId },
                  { setsValuesApart: true },
                )
              : "",
          ],
          translator.language,
        ),
        ...(facts.trackingId ? { identifier: facts.trackingId } : {}),
      };
    }
    case CloudHealthDescriptionKind.AzureResourceCause: {
      const sentence: string =
        AZURE_RESOURCE_HEALTH_CAUSE_SENTENCES[facts.cause];

      return {
        written: facts.written,
        worded: translator.translateText(sentence) || sentence,
      };
    }
    case CloudHealthDescriptionKind.GoogleCloudAffects:
      return {
        written: "",
        worded: translator.translateTemplate(
          GOOGLE_CLOUD_AFFECTS_SENTENCE,
          {
            // Listed the way the sentence's language lists: "a, b", "a、b".
            products: composedValue((sentence: Translator): string => {
              return formatList(facts.products, sentence);
            }),
          },
          { setsValuesApart: true },
        ),
      };
    case CloudHealthDescriptionKind.Published: {
      const provider: string = getCloudProviderLabel(facts.provider);

      return {
        written: "",
        worded: provider
          ? translator.translateTemplate(
              CLOUD_HEALTH_PUBLISHED_SENTENCES.byProvider,
              { provider, account: facts.account },
              { setsValuesApart: true },
            )
          : translator.translateTemplate(
              CLOUD_HEALTH_PUBLISHED_SENTENCES.byCloudProvider,
              { account: facts.account },
              { setsValuesApart: true },
            ),
      };
    }
    case CloudHealthDescriptionKind.Written:
    default:
      return { written: facts.text, worded: "" };
  }
}
