import ObjectID from "../ObjectID";
import {
  composedValue,
  createTranslator,
  DEFAULT_LANGUAGE,
  translatableTerm,
  TranslatableTerm,
  translationKey,
  Translator,
} from "../Translator";

/*
 * A PAGE A PERSON ASKED FOR.
 *
 * Somebody in Slack or Microsoft Teams paged people, a team or whoever is
 * on call in a schedule, by name - `/oneuptime page`, "page" typed to the
 * Teams bot, an incident's Page Someone. It is a direct page
 * (OnCallDirectPage): no on-call policy behind it, and no workflow. It
 * reaches each person through their own On-Call Rules, as every page does,
 * and differs from a page OneUptime starts on its own in two ways.
 *
 * IT GOES ON UNTIL ONE OF THE PEOPLE IT PAGED ANSWERS IT, OR ITS INCIDENT OR
 * ALERT IS RESOLVED. Somebody else acknowledging the incident does not stop
 * it: the person who paged asked for these people, and that somebody else is
 * on the incident does not mean they have seen it. Paging from an incident's
 * own channel is mostly paging somebody into an incident that is being
 * worked on - acknowledged already - and a page that stopped because of that
 * reached them by its first notification only: no call ten minutes later, no
 * push that repeats. Answering it - its link, a call's 1, a text -
 * acknowledges the incident or alert too when nobody has yet, and stops the
 * page for everybody it paged, as acknowledging always did.
 *
 * IT SAYS WHO PAGED, AND WHY YOU. Worded as a page OneUptime starts, a page
 * about an incident that was declared an hour ago told the person paged
 * that "a new incident has been created", and nobody could tell who wanted
 * them or that they were paged as a member of a team. A person's page says
 * it in every notification that is OneUptime's own words - a push, a text, a
 * call, an email, a Slack or Microsoft Teams message, Telegram - with the
 * team or the schedule they were paged through, and the message the person
 * who paged wrote, where the notification has room for it (OnCallPersonPageNotice).
 * WhatsApp's words are a template Meta approved, and stay as they are.
 *
 * AN ON-CALL POLICY A PERSON STARTED BY HAND (OnCallPolicyStartedByHand) IS
 * ASKED FOR TOO, AND SAYS SO THE SAME WAY. Execute On-Call Policy in the
 * Dashboard, Slack, Microsoft Teams or Mattermost, or a page that names a
 * policy, is mostly started on a record somebody is on already, and its
 * notifications told the people its levels page that "a new incident has
 * been created", at every level and every repeat, from nobody
 * (https://github.com/OneUptime/oneuptime/issues/7838). Its notice names the
 * policy (policyName) and the level that pages this person (policyLevel),
 * and every sentence below words it for a policy: "Alice Kim started
 * Database escalation", "You're getting this because you're on level 2 of
 * Database escalation." - never "paged you by name", which the policy's
 * level did, not the person. The message a page that names a policy carries
 * (pageMessage) is said in every channel, as a person's page's is.
 *
 * This file holds the rule and its words, for the server (the workers that
 * end runs, the notifications, the runs' chat messages) and for the docs
 * tests. It imports nothing that needs a server or React.
 *
 * The words a person's page sends the people it pages are written in each
 * one's language (Types/UserLanguage): each function that writes one takes
 * the translator of their language, and writes English - exactly as it
 * always has - without one. So do a call's, which a voice of that language
 * speaks where the call has one (Utils/Call/OnCallPageCall, #11066).
 */

// The translator of what nobody asked to read in another language: English.
let englishTranslator: Translator | null = null;

const getEnglishTranslator: () => Translator = (): Translator => {
  if (!englishTranslator) {
    englishTranslator = createTranslator(undefined, DEFAULT_LANGUAGE);
  }

  return englishTranslator;
};

// A run, read with what tells a person's page apart.
export interface OnCallPersonPageRun {
  onCallDutyPolicyId?: ObjectID | string | null | undefined;
  onCallDutyPolicy?: unknown;
  triggeredByUserId?: ObjectID | string | null | undefined;
  triggeredByWorkflowId?: ObjectID | string | null | undefined;
}

/*
 * Whether a run is a page a person asked for: a direct page - no policy, by
 * its id or by the policy read with it - started by a person, with no
 * workflow behind it. Asked only of a run read with all four of those
 * columns: one read without them would not look like one.
 */
export function isOnCallPersonPage(
  run: OnCallPersonPageRun | null | undefined,
): boolean {
  if (!run) {
    return false;
  }

  if (run.onCallDutyPolicyId || run.onCallDutyPolicy) {
    return false;
  }

  return Boolean(run.triggeredByUserId) && !run.triggeredByWorkflowId;
}

/*
 * The longest message a person's page carries: what an alert's title holds,
 * so a message reads the same whichever kind of record the page is about.
 */
export const ON_CALL_PERSON_PAGE_MESSAGE_MAX_LENGTH: number = 500;

// A run of white space: a message is kept on one line.
const WHITE_SPACE_RUN: RegExp = /\s+/g;

/*
 * A page's message as it is kept: on one line, without white space at its
 * ends, cut to ON_CALL_PERSON_PAGE_MESSAGE_MAX_LENGTH with "…". Empty for
 * none.
 */
export function toOnCallPersonPageMessage(
  message: string | null | undefined,
): string {
  const text: string = (message || "").replace(WHITE_SPACE_RUN, " ").trim();

  if (text.length <= ON_CALL_PERSON_PAGE_MESSAGE_MAX_LENGTH) {
    return text;
  }

  return `${text
    .substring(0, ON_CALL_PERSON_PAGE_MESSAGE_MAX_LENGTH - 1)
    .trimEnd()}…`;
}

/*
 * WHAT A PERSON'S PAGE SAYS TO THE PEOPLE IT PAGES, besides what it is
 * about: who paged, how this person was reached - by name, as a member of a
 * team, as on call in a schedule - and the message, when there is one.
 */
export interface OnCallPersonPageNotice {
  // Who paged: their name, or their email address.
  pagedByName: string;
  // The team the person was paged as a member of.
  teamName?: string | undefined;
  // The schedule the person was paged as on call in.
  scheduleName?: string | undefined;
  // What the person who paged wrote. Empty for none.
  message?: string | undefined;
  /*
   * For an on-call policy a person started by hand (OnCallPolicyStartedByHand):
   * the policy's name. Every sentence then says they started the policy,
   * not that they paged somebody. None for a person's page.
   */
  policyName?: string | undefined;
  /*
   * The level of that policy that pages this person: 1 for its first. None
   * when it is not known: the sentences then name the policy only.
   */
  policyLevel?: number | undefined;
}

// The name of who paged, never empty.
function pager(notice: OnCallPersonPageNotice): string {
  return notice.pagedByName.trim() || "Someone";
}

/*
 * Whether a notice is of an on-call policy a person started by hand
 * (OnCallPolicyStartedByHand): it names the policy.
 */
export function isOnCallPolicyStartedByHandNotice(
  notice: OnCallPersonPageNotice | null | undefined,
): boolean {
  return Boolean(notice && (notice.policyName || "").trim());
}

// The policy a notice names, as written. Empty for a person's page.
function startedPolicy(notice: OnCallPersonPageNotice): string {
  return (notice.policyName || "").trim();
}

// The level a notice names, as a whole number from 1. Null for none.
function startedLevel(notice: OnCallPersonPageNotice): number | null {
  const level: number = Number(notice.policyLevel);

  return Number.isInteger(level) && level >= 1 ? level : null;
}

/*
 * The name of who paged as a sentence's value: their name as written, or
 * "Someone" in the sentence's language. An observer's page words its own
 * sentences around it (OnCallObserverPage).
 */
export function getOnCallPersonPagePager(
  notice: OnCallPersonPageNotice,
): string | TranslatableTerm {
  const name: string = notice.pagedByName.trim();

  return name || translatableTerm(translationKey("Someone"));
}

/*
 * The page's first words, where a page OneUptime starts says "New incident
 * assigned to you": "Alice Kim paged you", "Alice Kim paged Platform",
 * "Alice Kim paged whoever is on call in Primary" - who was paged as the
 * person who paged named them: the team first, then the person reading it
 * is one of its members.
 */
export function getOnCallPersonPageLead(
  notice: OnCallPersonPageNotice,
  translator: Translator = getEnglishTranslator(),
): string {
  const policyName: string = startedPolicy(notice);

  /*
   * A policy started by hand: "Alice Kim started Database escalation" -
   * whom it pages is the policy's, said by the why line.
   */
  if (policyName) {
    return translator.translateTemplate("{{pager}} started {{policy}}", {
      pager: getOnCallPersonPagePager(notice),
      policy: policyName,
    });
  }

  const teamName: string = (notice.teamName || "").trim();

  if (teamName) {
    return translator.translateTemplate("{{pager}} paged {{team}}", {
      pager: getOnCallPersonPagePager(notice),
      team: teamName,
    });
  }

  const scheduleName: string = (notice.scheduleName || "").trim();

  if (scheduleName) {
    return translator.translateTemplate(
      "{{pager}} paged whoever is on call in {{schedule}}",
      {
        pager: getOnCallPersonPagePager(notice),
        schedule: scheduleName,
      },
    );
  }

  return translator.translateTemplate("{{pager}} paged you", {
    pager: getOnCallPersonPagePager(notice),
  });
}

/*
 * Why the person reading it was paged, where a page OneUptime starts says
 * "You're getting this because you're on call.": "You're getting this
 * because you're a member of Platform.", "... because you're on call in
 * Primary.", "... because Alice Kim paged you by name."
 */
export function getOnCallPersonPageWhyLine(
  notice: OnCallPersonPageNotice,
  translator: Translator = getEnglishTranslator(),
): string {
  if (startedPolicy(notice)) {
    return getPolicyStartedByHandWhyLine(notice, translator);
  }

  const teamName: string = (notice.teamName || "").trim();

  if (teamName) {
    return translator.translateTemplate(
      "You're getting this because you're a member of {{team}}.",
      { team: teamName },
    );
  }

  const scheduleName: string = (notice.scheduleName || "").trim();

  if (scheduleName) {
    return translator.translateTemplate(
      "You're getting this because you're on call in {{schedule}}.",
      { schedule: scheduleName },
    );
  }

  return translator.translateTemplate(
    "You're getting this because {{pager}} paged you by name.",
    { pager: getOnCallPersonPagePager(notice) },
  );
}

/*
 * Why the person reading it was paged by a policy a person started by hand:
 * the policy's level - through a team, a schedule, or naming them - where a
 * person's page says "... because Alice Kim paged you by name.":
 * "You're getting this because you're a member of Platform, on level 2 of
 * Database escalation.", "... because you're on call in Primary, on level 1
 * of Database escalation.", "... because you're on level 1 of Database
 * escalation." Without a level, the policy, the team or the schedule alone.
 */
function getPolicyStartedByHandWhyLine(
  notice: OnCallPersonPageNotice,
  translator: Translator,
): string {
  const policyName: string = startedPolicy(notice);
  const level: number | null = startedLevel(notice);
  const teamName: string = (notice.teamName || "").trim();
  const scheduleName: string = (notice.scheduleName || "").trim();

  if (level === null) {
    if (teamName) {
      return translator.translateTemplate(
        "You're getting this because you're a member of {{team}}.",
        { team: teamName },
      );
    }

    if (scheduleName) {
      return translator.translateTemplate(
        "You're getting this because you're on call in {{schedule}}.",
        { schedule: scheduleName },
      );
    }

    return translator.translateTemplate(
      "You're getting this because {{policy}} pages you.",
      { policy: policyName },
    );
  }

  if (teamName) {
    return translator.translateTemplate(
      "You're getting this because you're a member of {{team}}, on level {{level}} of {{policy}}.",
      { team: teamName, level: String(level), policy: policyName },
    );
  }

  if (scheduleName) {
    return translator.translateTemplate(
      "You're getting this because you're on call in {{schedule}}, on level {{level}} of {{policy}}.",
      { schedule: scheduleName, level: String(level), policy: policyName },
    );
  }

  return translator.translateTemplate(
    "You're getting this because you're on level {{level}} of {{policy}}.",
    { level: String(level), policy: policyName },
  );
}

// The page's message, when it has one: what the person who paged wrote.
export function getOnCallPersonPageMessage(
  notice: OnCallPersonPageNotice,
): string {
  return toOnCallPersonPageMessage(notice.message);
}

/*
 * The page's message in quotation marks, as a chat or Telegram message
 * shows it under the record: "“Can you check the database?”" - with the
 * marks of the person's language („…“, «…», 「…」), the message set
 * apart in a language read from the right. Empty for none.
 */
export function getOnCallPersonPageQuotedMessage(
  notice: OnCallPersonPageNotice,
  translator: Translator = getEnglishTranslator(),
): string {
  const message: string = getOnCallPersonPageMessage(notice);

  return message
    ? translator.translateTemplate("“{{message}}”", { message: message })
    : "";
}

/*
 * A push notification's title, where a page OneUptime starts says "New
 * Incident INC-42: <title>": "Alice Kim paged you: Incident INC-42".
 * `recordLabel` is the record's kind and number: "Incident INC-42".
 */
export function getOnCallPersonPagePushTitle(data: {
  recordLabel: string;
  notice: OnCallPersonPageNotice;
  translator?: Translator | undefined;
}): string {
  const translator: Translator = data.translator || getEnglishTranslator();

  return translator.translateTemplate("{{lead}}: {{record}}", {
    lead: composedValue((sentence: Translator): string => {
      return getOnCallPersonPageLead(data.notice, sentence);
    }),
    record: data.recordLabel.trim(),
  });
}

/*
 * A push notification's body: the record's title and project, then the
 * message - "Checkout is down, in Acme. “Can you check the database?”" -
 * where a page OneUptime starts says "A new incident has been created".
 */
export function getOnCallPersonPagePushBody(data: {
  recordTitle: string;
  projectName: string;
  notice: OnCallPersonPageNotice;
  translator?: Translator | undefined;
}): string {
  const translator: Translator = data.translator || getEnglishTranslator();
  const title: string = data.recordTitle.trim();
  const project: string = data.projectName.trim();
  const message: string = getOnCallPersonPageMessage(data.notice);

  const what: string = project
    ? translator.translateTemplate("{{title}}, in {{project}}.", {
        title: title,
        project: project,
      })
    : translator.translateTemplate("{{title}}.", { title: title });

  return message
    ? translator.translateTemplate("{{what}} “{{message}}”", {
        what: what,
        message: message,
      })
    : what;
}

/*
 * What a call says first, where a first page's says "A new incident has
 * been created": "Alice Kim paged you about an incident", "Alice Kim paged
 * Platform about an incident". Every kind of record starts with a vowel.
 */
export function getOnCallPersonPageCallSentence(data: {
  recordNoun: string;
  notice: OnCallPersonPageNotice;
}): string {
  const policyName: string = startedPolicy(data.notice);

  /*
   * A policy started by hand: "Alice Kim started the on-call policy
   * Database escalation for an incident" - said, a policy's name alone
   * would not say what it is.
   */
  if (policyName) {
    return `${pager(data.notice)} started the on-call policy ${policyName} for an ${data.recordNoun}`;
  }

  return `${getOnCallPersonPageLead(data.notice)} about an ${data.recordNoun}`;
}

/*
 * What a call says after the record, when the page has a message: "Alice
 * Kim says: Can you check the database?" - in the call's language (#11066),
 * the message as its writer wrote it. Empty for none.
 */
export function getOnCallPersonPageCallMessage(
  notice: OnCallPersonPageNotice,
  translator: Translator = getEnglishTranslator(),
): string {
  const message: string = getOnCallPersonPageMessage(notice);

  return message
    ? translator.translateTemplate("{{pager}} says: {{message}}", {
        pager: getOnCallPersonPagePager(notice),
        message: message,
      })
    : "";
}

/*
 * What an email says first, where a first page's says "A new incident has
 * been created in the project - Acme": "Alice Kim paged you about this
 * incident in the project Acme.", "Alice Kim paged Platform about this
 * incident in the project Acme. You're a member of Platform."
 */
/*
 * The first sentence of a person's page's email, for each kind of record
 * a person can page about, each whole so a language words it for its own
 * noun.
 */
interface PersonPageRecordWords {
  inProject: string;
  alone: string;
}

const PERSON_PAGE_RECORD_WORDS: Readonly<
  Record<string, PersonPageRecordWords>
> = {
  incident: {
    inProject: translationKey(
      "{{lead}} about this incident in the project {{project}}.",
    ),
    alone: translationKey("{{lead}} about this incident."),
  },
  alert: {
    inProject: translationKey(
      "{{lead}} about this alert in the project {{project}}.",
    ),
    alone: translationKey("{{lead}} about this alert."),
  },
};

export function getOnCallPersonPageEmailLine(data: {
  recordNoun: string;
  projectName: string;
  notice: OnCallPersonPageNotice;
  /*
   * The record by its kind and number - "Incident INC-42" - which a policy
   * started by hand names: "Alice Kim started Database escalation for
   * Incident INC-42 in the project Acme." The record's kind without it.
   */
  recordLabel?: string | undefined;
  translator?: Translator | undefined;
}): string {
  if (startedPolicy(data.notice)) {
    return getPolicyStartedByHandEmailLine({
      record: (data.recordLabel || "").trim() || data.recordNoun.trim(),
      projectName: data.projectName,
      notice: data.notice,
      translator: data.translator || getEnglishTranslator(),
    });
  }

  const project: string = data.projectName.trim();
  const teamName: string = (data.notice.teamName || "").trim();
  const scheduleName: string = (data.notice.scheduleName || "").trim();
  const words: PersonPageRecordWords | undefined =
    PERSON_PAGE_RECORD_WORDS[data.recordNoun.trim()];

  if (!words) {
    const first: string = `${getOnCallPersonPageLead(data.notice)} about this ${
      data.recordNoun
    }${project ? ` in the project ${project}` : ""}.`;

    if (teamName) {
      return `${first} You're a member of ${teamName}.`;
    }

    if (scheduleName) {
      return `${first} You're on call in ${scheduleName}.`;
    }

    return first;
  }

  const translator: Translator = data.translator || getEnglishTranslator();

  const first: string = translator.translateTemplate(
    project ? words.inProject : words.alone,
    {
      lead: composedValue((sentence: Translator): string => {
        return getOnCallPersonPageLead(data.notice, sentence);
      }),
      project: project,
    },
  );

  const second: string = teamName
    ? translator.translateTemplate("You're a member of {{team}}.", {
        team: teamName,
      })
    : scheduleName
      ? translator.translateTemplate("You're on call in {{schedule}}.", {
          schedule: scheduleName,
        })
      : "";

  if (!second) {
    return first;
  }

  // Two sentences, as the language puts one after another.
  return translator.translateTemplate("{{first}} {{second}}", {
    first: first,
    second: second,
  });
}

/*
 * What a policy started by hand's email says first: who started which
 * policy for the record, then why this person - "Alice Kim started
 * Database escalation for Incident INC-42 in the project Acme. You're
 * getting this because you're a member of Platform, on level 2 of Database
 * escalation."
 */
function getPolicyStartedByHandEmailLine(data: {
  record: string;
  projectName: string;
  notice: OnCallPersonPageNotice;
  translator: Translator;
}): string {
  const translator: Translator = data.translator;
  const project: string = data.projectName.trim();

  const first: string = translator.translateTemplate(
    project
      ? translationKey("{{lead}} for {{record}} in the project {{project}}.")
      : translationKey("{{lead}} for {{record}}."),
    {
      lead: composedValue((sentence: Translator): string => {
        return getOnCallPersonPageLead(data.notice, sentence);
      }),
      record: data.record,
      project: project,
    },
  );

  // Two sentences, as the language puts one after another.
  return translator.translateTemplate("{{first}} {{second}}", {
    first: first,
    second: getOnCallPersonPageWhyLine(data.notice, translator),
  });
}

/*
 * The line an email shows the message on, when the page has one: "Alice
 * Kim wrote: “Can you check the database?”". Empty for none.
 */
export function getOnCallPersonPageEmailMessageLine(
  notice: OnCallPersonPageNotice,
  translator: Translator = getEnglishTranslator(),
): string {
  const message: string = getOnCallPersonPageMessage(notice);

  return message
    ? translator.translateTemplate("{{pager}} wrote: “{{message}}”", {
        pager: getOnCallPersonPagePager(notice),
        message: message,
      })
    : "";
}

/*
 * An email's subject, where a first page's says "ACTION REQUIRED: Incident
 * INC-42 created - <title>": "ACTION REQUIRED: Alice Kim paged you about
 * Incident INC-42 - <title>".
 */
export function getOnCallPersonPageEmailSubject(data: {
  recordLabel: string;
  recordTitle: string;
  notice: OnCallPersonPageNotice;
  translator?: Translator | undefined;
}): string {
  const translator: Translator = data.translator || getEnglishTranslator();

  /*
   * A policy started by hand: "ACTION REQUIRED: Alice Kim started Database
   * escalation for Incident INC-42 - <title>".
   */
  return translator.translateTemplate(
    startedPolicy(data.notice)
      ? translationKey("ACTION REQUIRED: {{lead}} for {{record}} - {{title}}")
      : translationKey(
          "ACTION REQUIRED: {{lead}} about {{record}} - {{title}}",
        ),
    {
      lead: composedValue((sentence: Translator): string => {
        return getOnCallPersonPageLead(data.notice, sentence);
      }),
      record: data.recordLabel.trim(),
      title: data.recordTitle.trim(),
    },
  );
}
