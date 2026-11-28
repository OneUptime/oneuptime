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

/*
 * What a criteria sync resolved (#11453): the open incidents and alerts the
 * criteria the template no longer has had opened, set to resolve on their
 * own - nothing could resolve them once those criteria were gone.
 */
export const RESOLVED_BY_SYNC: PluralTemplate = {
  one: "{{count}} open incident or alert that only the removed criteria could resolve was resolved.",
  other:
    "{{count}} open incidents and alerts that only the removed criteria could resolve were resolved.",
};

// The counts a sync answers with, each 0 when it says none (MonitorTemplateService).
export function readResolvedCounts(answer: unknown): {
  resolvedIncidentCount: number;
  resolvedAlertCount: number;
} {
  const body: Record<string, unknown> =
    answer && typeof answer === "object"
      ? (answer as Record<string, unknown>)
      : {};

  const count: (key: string) => number = (key: string): number => {
    const value: number = Number(body[key]);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  };

  return {
    resolvedIncidentCount: count("resolvedIncidentCount"),
    resolvedAlertCount: count("resolvedAlertCount"),
  };
}

// The sentence for what a sync resolved, or none when it resolved nothing.
export function getResolvedSentence(data: {
  resolvedIncidentCount?: number | undefined;
  resolvedAlertCount?: number | undefined;
  translator: Translator;
}): string | null {
  const resolved: number =
    (data.resolvedIncidentCount || 0) + (data.resolvedAlertCount || 0);

  return resolved > 0
    ? data.translator.translatePlural(RESOLVED_BY_SYNC, resolved, {
        count: data.translator.formatNumber(resolved),
      })
    : null;
}

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
  // What the sync resolved (#11453): only a criteria sync resolves any.
  resolvedIncidentCount?: number | undefined;
  resolvedAlertCount?: number | undefined;
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

  const resolvedSentence: string | null = getResolvedSentence({
    resolvedIncidentCount: data.resolvedIncidentCount,
    resolvedAlertCount: data.resolvedAlertCount,
    translator: data.translator,
  });

  if (synced >= total) {
    return {
      title: "Done",
      message: resolvedSentence
        ? joinSentences([message, resolvedSentence])
        : message,
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
    message: joinSentences(
      resolvedSentence
        ? [message, resolvedSentence, remainingSentence]
        : [message, remainingSentence],
    ),
    isIncomplete: true,
  };
}
