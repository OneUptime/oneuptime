import {
  describeOnCallAcknowledgementTimeout,
  OnCallPageAgainNotice,
} from "./OnCallAcknowledgementTimeout";
import {
  DEFAULT_ALERT_SEVERITY_NAMES,
  isDefaultStatusName,
} from "../StatusPage/DefaultStatusNames";
import {
  composedValue,
  createTranslator,
  DEFAULT_LANGUAGE,
  translationKey,
  Translator,
} from "../Translator";

/*
 * WHAT A PAGE SAYS, IN THE LANGUAGE OF THE PERSON IT PAGES.
 *
 * A page reaches a person through their own on-call rules: an email, a
 * text message, a push notification, a Telegram message, a Slack,
 * Microsoft Teams or Mattermost message to them. Each is written in the
 * person's language (Types/UserLanguage) - OneUptime's own words, that is:
 * the subjects, headings, labels, buttons and sentences, and OneUptime's
 * default names of states and severities (Identified, Critical Incident,
 * High). What the team wrote - a title, a description, a project's or a
 * team's name, a state they named themselves - reads as written.
 *
 * Each sentence is a whole sentence for each kind of record, never one
 * built around the record's name: a language words "this incident" and
 * "this alert" with its own article and its own agreement ("dieser
 * Vorfall", "diese Warnung"). The words live in the server's locale set
 * (Common/Server/Locales), looked up by their English; English is what a
 * translator for no language writes, exactly as the page always read.
 *
 * Three things stay English: a call (it is spoken by a voice that speaks
 * English), WhatsApp (its words are templates Meta approved) and the
 * pages the links open. See Common/Server/Locales/README.md.
 *
 * The person's own page (OnCallPersonPage) and a page again
 * (OnCallAcknowledgementTimeout) word their sentences in their own files,
 * with the same translator.
 *
 * Pure, with no Node, browser or database APIs.
 */

// What a page is about, as its sentences name it.
export enum OnCallPageKind {
  Incident = "incident",
  Alert = "alert",
  IncidentEpisode = "incident episode",
  AlertEpisode = "alert episode",
}

// The translator of what nobody asked to read in another language: English.
let englishTranslator: Translator | null = null;

export const getEnglishPageTranslator: () => Translator = (): Translator => {
  if (!englishTranslator) {
    englishTranslator = createTranslator(undefined, DEFAULT_LANGUAGE);
  }

  return englishTranslator;
};

// Every sentence a page writes about one kind of record.
interface OnCallPageKindWords {
  // "Incident": the record's kind as a label, at the start of a line.
  label: string;
  // "Incident {{number}}": the kind with the record's number.
  labelWithNumber: string;
  // The email's subject, for a first page and a page again.
  emailSubjectCreated: string;
  emailSubjectStillNotResolved: string;
  // The email's Root Cause, when nobody wrote one.
  noRootCause: string;
  // The push's title and body.
  pushTitleNew: string;
  pushTitleNewWithNumber: string;
  pushTitleStillNotResolved: string;
  pushTitleStillNotResolvedWithNumber: string;
  pushBodyNew: string;
  pushBodyStillNotResolved: string;
  pushBodyStillNotResolvedAfter: string;
  // The chat and Telegram message's headline, and its link to the record.
  chatHeadline: string;
  viewInOneUptime: string;
}

const KIND_WORDS: Readonly<Record<OnCallPageKind, OnCallPageKindWords>> = {
  [OnCallPageKind.Incident]: {
    label: translationKey("Incident"),
    labelWithNumber: translationKey("Incident {{number}}"),
    emailSubjectCreated: translationKey(
      "ACTION REQUIRED: Incident {{number}} created - {{title}}",
    ),
    emailSubjectStillNotResolved: translationKey(
      "ACTION REQUIRED: Incident {{number}} still not resolved - {{title}}",
    ),
    noRootCause: translationKey("No root cause identified for this incident"),
    pushTitleNew: translationKey("New Incident: {{title}}"),
    pushTitleNewWithNumber: translationKey(
      "New Incident {{number}}: {{title}}",
    ),
    pushTitleStillNotResolved: translationKey(
      "Incident still not resolved: {{title}}",
    ),
    pushTitleStillNotResolvedWithNumber: translationKey(
      "Incident {{number}} still not resolved: {{title}}",
    ),
    pushBodyNew: translationKey(
      "A new incident has been created: {{identifier}} in {{project}}. Click to view details.",
    ),
    pushBodyStillNotResolved: translationKey(
      "Incident {{identifier}} in {{project}} is still not resolved after it was acknowledged. Click to view details.",
    ),
    pushBodyStillNotResolvedAfter: translationKey(
      "Incident {{identifier}} in {{project}} is still not resolved {{duration}} after it was acknowledged. Click to view details.",
    ),
    chatHeadline: translationKey("New incident assigned to you"),
    viewInOneUptime: translationKey("View incident in OneUptime"),
  },
  [OnCallPageKind.Alert]: {
    label: translationKey("Alert"),
    labelWithNumber: translationKey("Alert {{number}}"),
    emailSubjectCreated: translationKey(
      "ACTION REQUIRED: Alert {{number}} created - {{title}}",
    ),
    emailSubjectStillNotResolved: translationKey(
      "ACTION REQUIRED: Alert {{number}} still not resolved - {{title}}",
    ),
    noRootCause: translationKey("No root cause identified for this alert"),
    pushTitleNew: translationKey("New Alert: {{title}}"),
    pushTitleNewWithNumber: translationKey("New Alert {{number}}: {{title}}"),
    pushTitleStillNotResolved: translationKey(
      "Alert still not resolved: {{title}}",
    ),
    pushTitleStillNotResolvedWithNumber: translationKey(
      "Alert {{number}} still not resolved: {{title}}",
    ),
    pushBodyNew: translationKey(
      "A new alert has been created: {{identifier}} in {{project}}. Click to view details.",
    ),
    pushBodyStillNotResolved: translationKey(
      "Alert {{identifier}} in {{project}} is still not resolved after it was acknowledged. Click to view details.",
    ),
    pushBodyStillNotResolvedAfter: translationKey(
      "Alert {{identifier}} in {{project}} is still not resolved {{duration}} after it was acknowledged. Click to view details.",
    ),
    chatHeadline: translationKey("New alert assigned to you"),
    viewInOneUptime: translationKey("View alert in OneUptime"),
  },
  [OnCallPageKind.IncidentEpisode]: {
    label: translationKey("Incident Episode"),
    labelWithNumber: translationKey("Incident Episode {{number}}"),
    emailSubjectCreated: translationKey(
      "ACTION REQUIRED: Incident Episode {{number}} created - {{title}}",
    ),
    emailSubjectStillNotResolved: translationKey(
      "ACTION REQUIRED: Incident Episode {{number}} still not resolved - {{title}}",
    ),
    noRootCause: translationKey(
      "No root cause identified for this incident episode",
    ),
    pushTitleNew: translationKey("New Incident Episode: {{title}}"),
    pushTitleNewWithNumber: translationKey(
      "New Incident Episode {{number}}: {{title}}",
    ),
    pushTitleStillNotResolved: translationKey(
      "Incident Episode still not resolved: {{title}}",
    ),
    pushTitleStillNotResolvedWithNumber: translationKey(
      "Incident Episode {{number}} still not resolved: {{title}}",
    ),
    pushBodyNew: translationKey(
      "A new incident episode has been created: {{identifier}} in {{project}}. Click to view details.",
    ),
    pushBodyStillNotResolved: translationKey(
      "Incident Episode {{identifier}} in {{project}} is still not resolved after it was acknowledged. Click to view details.",
    ),
    pushBodyStillNotResolvedAfter: translationKey(
      "Incident Episode {{identifier}} in {{project}} is still not resolved {{duration}} after it was acknowledged. Click to view details.",
    ),
    chatHeadline: translationKey("New incident episode assigned to you"),
    viewInOneUptime: translationKey("View incident episode in OneUptime"),
  },
  [OnCallPageKind.AlertEpisode]: {
    label: translationKey("Alert Episode"),
    labelWithNumber: translationKey("Alert Episode {{number}}"),
    emailSubjectCreated: translationKey(
      "ACTION REQUIRED: Alert Episode {{number}} created - {{title}}",
    ),
    emailSubjectStillNotResolved: translationKey(
      "ACTION REQUIRED: Alert Episode {{number}} still not resolved - {{title}}",
    ),
    noRootCause: translationKey(
      "No root cause identified for this alert episode",
    ),
    pushTitleNew: translationKey("New Alert Episode: {{title}}"),
    pushTitleNewWithNumber: translationKey(
      "New Alert Episode {{number}}: {{title}}",
    ),
    pushTitleStillNotResolved: translationKey(
      "Alert Episode still not resolved: {{title}}",
    ),
    pushTitleStillNotResolvedWithNumber: translationKey(
      "Alert Episode {{number}} still not resolved: {{title}}",
    ),
    pushBodyNew: translationKey(
      "A new alert episode has been created: {{identifier}} in {{project}}. Click to view details.",
    ),
    pushBodyStillNotResolved: translationKey(
      "Alert Episode {{identifier}} in {{project}} is still not resolved after it was acknowledged. Click to view details.",
    ),
    pushBodyStillNotResolvedAfter: translationKey(
      "Alert Episode {{identifier}} in {{project}} is still not resolved {{duration}} after it was acknowledged. Click to view details.",
    ),
    chatHeadline: translationKey("New alert episode assigned to you"),
    viewInOneUptime: translationKey("View alert episode in OneUptime"),
  },
};

// Every kind of record a page is about, in the order the product lists them.
export const ON_CALL_PAGE_KINDS: ReadonlyArray<OnCallPageKind> = [
  OnCallPageKind.Incident,
  OnCallPageKind.Alert,
  OnCallPageKind.IncidentEpisode,
  OnCallPageKind.AlertEpisode,
];

/*
 * The default names a new project's alert severities start with, kept
 * beside the other default names (StatusPage/DefaultStatusNames); a page
 * shows them to its person.
 */
export { DEFAULT_ALERT_SEVERITY_NAMES };

/*
 * A state's or a severity's name as a page shows it: OneUptime's own
 * default names in the person's language ("Identifiziert", "Kritischer
 * Vorfall", "Hoch"), a name the project gave it as written.
 */
export const getOnCallPageStateName: (
  translator: Translator,
  name: string | null | undefined,
) => string = (
  translator: Translator,
  name: string | null | undefined,
): string => {
  if (!name) {
    return "";
  }

  const trimmed: string = name.trim();

  if (
    !isDefaultStatusName(trimmed) &&
    !DEFAULT_ALERT_SEVERITY_NAMES.includes(trimmed)
  ) {
    return name;
  }

  return translator.translateText(trimmed) || name;
};

// "Incident", "Alert episode": a record's kind as a label.
export const getOnCallPageKindLabel: (
  translator: Translator,
  kind: OnCallPageKind,
) => string = (translator: Translator, kind: OnCallPageKind): string => {
  const label: string = KIND_WORDS[kind].label;

  return translator.translateText(label) || label;
};

/*
 * A record by its kind and number: "Incident INC-42", or "Incident" for a
 * record without a number.
 */
export const getOnCallPageRecordLabel: (
  translator: Translator,
  kind: OnCallPageKind,
  number: string | null | undefined,
) => string = (
  translator: Translator,
  kind: OnCallPageKind,
  number: string | null | undefined,
): string => {
  const trimmed: string = (number || "").trim();

  if (!trimmed) {
    return getOnCallPageKindLabel(translator, kind);
  }

  return translator.translateTemplate(KIND_WORDS[kind].labelWithNumber, {
    number: trimmed,
  });
};

// The marks a language read from the right sets a value apart with.
const BIDI_MARKS_REGEX: RegExp = /[‎‏⁦-⁩]/g;
const WHITESPACE_REGEX: RegExp = /\s+/g;
const NUMBER_STAND_IN: string = "~#~";

/*
 * The words a record's label names its kind with, without the number:
 * "Vorfall" of "Vorfall INC-42", "Episodio de incidente" of "Episodio de
 * incidente EP-7" - the kind as the page's own sentences word it.
 */
export const getOnCallPageKindWords: (
  translator: Translator,
  kind: OnCallPageKind,
) => string = (translator: Translator, kind: OnCallPageKind): string => {
  return translator
    .translateTemplate(KIND_WORDS[kind].labelWithNumber, {
      number: NUMBER_STAND_IN,
    })
    .split(NUMBER_STAND_IN)
    .join(" ")
    .replace(BIDI_MARKS_REGEX, "")
    .replace(WHITESPACE_REGEX, " ")
    .trim();
};

/*
 * The subject of a page's email: "ACTION REQUIRED: Incident INC-42 created
 * - <title>", or "... still not resolved - <title>" for a page again. The
 * number goes in as the page always put it, empty or not.
 */
export const getOnCallPageEmailSubject: (
  translator: Translator,
  data: {
    kind: OnCallPageKind;
    number: string;
    title: string;
    isPageAgain: boolean;
  },
) => string = (
  translator: Translator,
  data: {
    kind: OnCallPageKind;
    number: string;
    title: string;
    isPageAgain: boolean;
  },
): string => {
  const words: OnCallPageKindWords = KIND_WORDS[data.kind];

  return translator.translateTemplate(
    data.isPageAgain
      ? words.emailSubjectStillNotResolved
      : words.emailSubjectCreated,
    { number: data.number, title: data.title },
  );
};

// What a page's email shows under Root Cause when nobody wrote one.
export const getOnCallPageNoRootCause: (
  translator: Translator,
  kind: OnCallPageKind,
) => string = (translator: Translator, kind: OnCallPageKind): string => {
  const sentence: string = KIND_WORDS[kind].noRootCause;

  return translator.translateText(sentence) || sentence;
};

// What a page's email shows under Resources Affected when none is linked.
export const getOnCallPageNoResources: (translator: Translator) => string = (
  translator: Translator,
): string => {
  return (
    translator.translateText(translationKey("No resources identified")) ||
    "No resources identified"
  );
};

/*
 * An episode's member without a title, in the list of its incidents or
 * alerts.
 */
export const getOnCallPageUntitledMember: (
  translator: Translator,
  kind: OnCallPageKind.Incident | OnCallPageKind.Alert,
) => string = (
  translator: Translator,
  kind: OnCallPageKind.Incident | OnCallPageKind.Alert,
): string => {
  const sentence: string =
    kind === OnCallPageKind.Incident
      ? translationKey("Untitled Incident")
      : translationKey("Untitled Alert");

  return translator.translateText(sentence) || sentence;
};

// "Monitor: <name>", under an episode member in its email's list.
export const getOnCallPageMemberMonitor: (
  translator: Translator,
  monitorName: string,
) => string = (translator: Translator, monitorName: string): string => {
  return translator.translateTemplate("Monitor: {{monitorName}}", {
    monitorName: monitorName,
  });
};

// The link beside an episode member in its email's list.
export const getOnCallPageMemberView: (translator: Translator) => string = (
  translator: Translator,
): string => {
  return translator.translateText(translationKey("View →")) || "View →";
};

/*
 * The record in a push: "INC-42 (Checkout is down)", or its title alone
 * for a record without a number.
 */
const getPushIdentifier: (number: string, title: string) => string = (
  number: string,
  title: string,
): string => {
  return number ? `${number} (${title})` : title;
};

// A page's push: its title and its body.
export interface OnCallPagePushWords {
  title: string;
  body: string;
}

/*
 * A first page's or a page again's push: "New Incident INC-42: <title>"
 * and "A new incident has been created: INC-42 (<title>) in Acme. Click
 * to view details.", or "Incident INC-42 still not resolved: <title>" and
 * why. (A person's page has its own: getOnCallPagePersonPagePushBody.)
 */
export const getOnCallPagePushWords: (
  translator: Translator,
  data: {
    kind: OnCallPageKind;
    number: string;
    title: string;
    projectName: string;
    pageAgain?: OnCallPageAgainNotice | undefined;
  },
) => OnCallPagePushWords = (
  translator: Translator,
  data: {
    kind: OnCallPageKind;
    number: string;
    title: string;
    projectName: string;
    pageAgain?: OnCallPageAgainNotice | undefined;
  },
): OnCallPagePushWords => {
  const words: OnCallPageKindWords = KIND_WORDS[data.kind];
  const identifier: string = getPushIdentifier(data.number, data.title);

  if (!data.pageAgain) {
    return {
      title: translator.translateTemplate(
        data.number ? words.pushTitleNewWithNumber : words.pushTitleNew,
        { number: data.number, title: data.title },
      ),
      body: translator.translateTemplate(words.pushBodyNew, {
        identifier: identifier,
        project: data.projectName,
      }),
    };
  }

  const minutes: number = Number(data.pageAgain.minutes || 0);
  const hasMinutes: boolean = Number.isFinite(minutes) && minutes > 0;

  return {
    title: translator.translateTemplate(
      data.number
        ? words.pushTitleStillNotResolvedWithNumber
        : words.pushTitleStillNotResolved,
      { number: data.number, title: data.title },
    ),
    body: translator.translateTemplate(
      hasMinutes
        ? words.pushBodyStillNotResolvedAfter
        : words.pushBodyStillNotResolved,
      {
        identifier: identifier,
        project: data.projectName,
        duration: composedValue((sentence: Translator): string => {
          return describeOnCallAcknowledgementTimeout(minutes, sentence);
        }),
      },
    ),
  };
};

/*
 * A person's page's push body, after what it is about and the message:
 * "<what> Click to view details.".
 */
export const getOnCallPagePersonPagePushBody: (
  translator: Translator,
  what: string,
) => string = (translator: Translator, what: string): string => {
  return translator.translateTemplate("{{text}} Click to view details.", {
    text: what,
  });
};

// A first page's chat and Telegram headline: "New incident assigned to you".
export const getOnCallPageChatHeadline: (
  translator: Translator,
  kind: OnCallPageKind,
) => string = (translator: Translator, kind: OnCallPageKind): string => {
  const sentence: string = KIND_WORDS[kind].chatHeadline;

  return translator.translateText(sentence) || sentence;
};

// Why a first page's chat or Telegram message reaches the person.
export const getOnCallPageOnCallWhyLine: (translator: Translator) => string = (
  translator: Translator,
): string => {
  const sentence: string = translationKey(
    "You're getting this because you're on call.",
  );

  return translator.translateText(sentence) || sentence;
};

// The link to the record from a chat or Telegram message.
export const getOnCallPageViewInOneUptime: (
  translator: Translator,
  kind: OnCallPageKind,
) => string = (translator: Translator, kind: OnCallPageKind): string => {
  const sentence: string = KIND_WORDS[kind].viewInOneUptime;

  return translator.translateText(sentence) || sentence;
};

// A Telegram message's acknowledge link.
export const getOnCallPageTapToAcknowledge: (
  translator: Translator,
) => string = (translator: Translator): string => {
  return (
    translator.translateText(translationKey("Tap to acknowledge")) ||
    "Tap to acknowledge"
  );
};

// A chat message's acknowledge link.
export const getOnCallPageAcknowledge: (translator: Translator) => string = (
  translator: Translator,
): string => {
  return (
    translator.translateText(translationKey("Acknowledge")) || "Acknowledge"
  );
};

/*
 * "Can't take it? Escalate" - a link's text where one line says both
 * (OnCallPagePassOn's CANT_TAKE_IT_ESCALATE, in the person's language).
 */
export const getOnCallPageCantTakeItEscalate: (
  translator: Translator,
) => string = (translator: Translator): string => {
  return (
    translator.translateText(translationKey("Can't take it? Escalate")) ||
    "Can't take it? Escalate"
  );
};

/*
 * THE WORDS OF A PAGE'S TEXT MESSAGE (Utils/Sms/OnCallPageSms) in a
 * language other than English: what the page is about, where and what it
 * asks, around the same values - the product, the record, the project,
 * the title and the link - and fitted by the same rule.
 */
export interface OnCallPageSmsWords {
  /*
   * The record: its kind, number and severity - "Warnung ALR-7 (Hoch)",
   * or "Kritischer Vorfall INC-42" when the severity names the kind.
   */
  record: (data: {
    kind: OnCallPageKind;
    number: string;
    severityName: string;
  }) => string;
  // What the text says before the title, without the product.
  head: (data: {
    record: string;
    projectName: string;
    isPageAgain: boolean;
    lead: string;
  }) => string;
  // The words before the link: "Ack or escalate:".
  action: string;
}

export const getOnCallPageSmsWords: (
  translator: Translator,
) => OnCallPageSmsWords = (translator: Translator): OnCallPageSmsWords => {
  return {
    record: (data: {
      kind: OnCallPageKind;
      number: string;
      severityName: string;
    }): string => {
      const withNumber: string = getOnCallPageRecordLabel(
        translator,
        data.kind,
        data.number,
      );
      const severityName: string = data.severityName.trim();

      if (!severityName) {
        return withNumber;
      }

      /*
       * A severity that names the kind already - OneUptime's default
       * "Kritischer Vorfall" - leads, as an English text's "Critical
       * Incident INC-42" does, so the kind is not said twice. The kind is
       * read off the record's own label ("Vorfall" of "Vorfall INC-42"),
       * so it is the word this text uses.
       */
      const kindWords: string = getOnCallPageKindWords(
        translator,
        data.kind,
      ).toLocaleLowerCase(translator.language);

      if (
        kindWords &&
        severityName.toLocaleLowerCase(translator.language).includes(kindWords)
      ) {
        return [severityName, data.number.trim()]
          .filter((part: string): boolean => {
            return part.length > 0;
          })
          .join(" ");
      }

      return `${withNumber} (${severityName})`;
    },
    head: (data: {
      record: string;
      projectName: string;
      isPageAgain: boolean;
      lead: string;
    }): string => {
      if (data.lead) {
        return data.projectName
          ? translator.translateTemplate(
              "{{lead}} about {{record}} in {{project}}",
              {
                lead: data.lead,
                record: data.record,
                project: data.projectName,
              },
            )
          : translator.translateTemplate("{{lead}} about {{record}}", {
              lead: data.lead,
              record: data.record,
            });
      }

      if (data.isPageAgain) {
        return data.projectName
          ? translator.translateTemplate(
              "{{record}} in {{project}} is still not resolved",
              { record: data.record, project: data.projectName },
            )
          : translator.translateTemplate("{{record}} is still not resolved", {
              record: data.record,
            });
      }

      return data.projectName
        ? translator.translateTemplate("{{record}} in {{project}}", {
            record: data.record,
            project: data.projectName,
          })
        : data.record;
    },
    action:
      translator.translateText(translationKey("Ack or escalate:")) ||
      "Ack or escalate:",
  };
};
