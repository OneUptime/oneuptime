import { joinSentences } from "Common/UI/Components/DeleteConfirmation/DeleteConsequences";
import {
  PluralTemplate,
  translatableTerm,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
export interface SyncResultSummary {
  title: string;
  message: string;
  isIncomplete: boolean;
}

// What a sync says it did: how many monitors it reached, of how many linked.
export const SYNCED_ONTO_MONITORS: PluralTemplate = {
  one: "Synced {{subject}} onto {{count}} monitor ({{total}} linked to this template).",
  other:
    "Synced {{subject}} onto {{count}} monitors ({{total}} linked to this template).",
};

// What a short sync says next: how many it did not reach, and what to do.
export const STILL_ON_PREVIOUS_CONFIGURATION: PluralTemplate = {
  one: "{{count}} linked monitor still uses the previous configuration — usually because your permissions do not cover it. Run the sync again as a user who can update every linked monitor.",
  other:
    "{{count}} linked monitors still use the previous configuration — usually because your permissions do not cover them. Run the sync again as a user who can update every linked monitor.",
};

/*
 * Build the after-sync summary shown to the operator, in `translator`'s
 * language.
 *
 * `syncedMonitors` can legitimately fall short of `totalLinkedMonitors`: the
 * linked-monitor count is taken project-wide, while the writes are narrowed to
 * what the caller may actually update, so a label-scoped operator syncs only
 * their slice. Either way the fleet is left partly on the old configuration,
 * which is precisely the state a template sync is meant to resolve — so say so
 * rather than reporting a bare count that reads as success.
 *
 * The counts are written the way the reader's language writes numbers -
 * Persian digits in Persian, "40,000" in English - and the two sentences of
 * a short sync follow one another as the reader's script runs sentences
 * together (joinSentences): with a space, or with none after Chinese's and
 * Japanese's full-width full stop (#7710).
 */
export function buildSyncResultSummary(data: {
  subject: string;
  syncedMonitors: number;
  totalLinkedMonitors: number;
  translator: Translator;
}): SyncResultSummary {
  const synced: number = data.syncedMonitors;
  const total: number = data.totalLinkedMonitors;

  // translatePlural writes {{count}} the reader's way; {{total}} is written so here.
  const message: string = data.translator.translatePlural(
    SYNCED_ONTO_MONITORS,
    synced,
    {
      subject: translatableTerm(data.subject),
      total: data.translator.formatNumber(total),
    },
  );

  if (synced >= total) {
    return {
      title: "Done",
      message: message,
      isIncomplete: false,
    };
  }

  const remaining: number = total - synced;
  const remainingSentence: string = data.translator.translatePlural(
    STILL_ON_PREVIOUS_CONFIGURATION,
    remaining,
  );

  return {
    title: "Partially synced",
    message: joinSentences([message, remainingSentence]),
    isIncomplete: true,
  };
}
