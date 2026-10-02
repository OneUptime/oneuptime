import {
  translatableTerm,
  translatePlural,
} from "Common/UI/Utils/TranslateTemplate";
export interface SyncResultSummary {
  title: string;
  message: string;
  isIncomplete: boolean;
}

/*
 * Build the after-sync summary shown to the operator.
 *
 * `syncedMonitors` can legitimately fall short of `totalLinkedMonitors`: the
 * linked-monitor count is taken project-wide, while the writes are narrowed to
 * what the caller may actually update, so a label-scoped operator syncs only
 * their slice. Either way the fleet is left partly on the old configuration,
 * which is precisely the state a template sync is meant to resolve — so say so
 * rather than reporting a bare count that reads as success.
 */
export function buildSyncResultSummary(data: {
  subject: string;
  syncedMonitors: number;
  totalLinkedMonitors: number;
}): SyncResultSummary {
  const synced: number = data.syncedMonitors;
  const total: number = data.totalLinkedMonitors;

  const message: string = translatePlural(
    {
      one: "Synced {{subject}} onto {{count}} monitor ({{total}} linked to this template).",
      other:
        "Synced {{subject}} onto {{count}} monitors ({{total}} linked to this template).",
    },
    synced,
    { subject: translatableTerm(data.subject), total: total },
  );

  if (synced >= total) {
    return {
      title: "Done",
      message: message,
      isIncomplete: false,
    };
  }

  const remaining: number = total - synced;
  const remainingSentence: string = translatePlural(
    {
      one: "{{count}} linked monitor still uses the previous configuration — usually because your permissions do not cover it. Run the sync again as a user who can update every linked monitor.",
      other:
        "{{count}} linked monitors still use the previous configuration — usually because your permissions do not cover them. Run the sync again as a user who can update every linked monitor.",
    },
    remaining,
  );

  return {
    title: "Partially synced",
    message: `${message} ${remainingSentence}`,
    isIncomplete: true,
  };
}
