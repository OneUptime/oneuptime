import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * THE WORDS OF APPLYING THE PROJECT'S DEFAULT LADDER FROM ON-CALL READINESS
 * (#7450): the bulk action, its confirmation that names the members and the
 * ladder, and what happened to each member. React-free, so a test reads
 * every sentence.
 */

export const APPLY_DEFAULT_LADDER_COPY: {
  action: string;
  question: string;
  ladderHeading: string;
  membersHeading: string;
  skipped: string;
  alreadyOnIt: string;
  leftOut: string;
  leftOutKeepingOwn: string;
  noPhone: string;
  tickHint: string;
} = {
  action: translationKey("Apply Default Ladder"),
  question: translationKey(
    "Their own rules for every severity are replaced by the project's default ladder. A way somebody has not verified is left out, and they keep their own steps in its place. Each of them gets one email.",
  ),
  ladderHeading: translationKey("The default ladder"),
  membersHeading: translationKey("Members"),
  // Why a member was left as they are.
  skipped: translationKey(
    "Has verified none of the ways the default ladder uses, so their own rules stay as they are.",
  ),
  alreadyOnIt: translationKey("Already pages by the default ladder."),
  // After the run, for a member it was applied to without a way they lack.
  leftOut: translationKey(
    "{{name}} has not verified {{channels}} yet, so those steps were left out.",
  ),
  leftOutKeepingOwn: translationKey(
    "{{name}} has not verified {{channels}} yet, so those steps were left out, and they keep their own {{kept}} steps meanwhile.",
  ),
  // A responder's chip, when the project asks for a phone method and they have none.
  noPhone: translationKey("No phone method"),
  // Over the table, for somebody who may also apply the default.
  tickHint: translationKey(
    "Tick responders to remind them, or to apply the project's default ladder.",
  ),
};

export const APPLY_DEFAULT_LADDER_TITLE: PluralTemplate = {
  one: "Apply the default ladder to {{count}} member?",
  other: "Apply the default ladder to {{count}} members?",
};

export const APPLY_DEFAULT_LADDER_RESULT_LABELS: {
  succeeded: PluralTemplate;
  failed: PluralTemplate;
  unchanged: PluralTemplate;
} = {
  succeeded: {
    one: "{{count}} member now pages by the default ladder",
    other: "{{count}} members now page by the default ladder",
  },
  failed: {
    one: "{{count}} member not changed",
    other: "{{count}} members not changed",
  },
  unchanged: {
    one: "{{count}} member left as they were",
    other: "{{count}} members left as they were",
  },
};
