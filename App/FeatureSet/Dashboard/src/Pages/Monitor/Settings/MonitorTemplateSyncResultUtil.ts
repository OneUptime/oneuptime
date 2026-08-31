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

  const message: string = `Synced ${data.subject} onto ${synced} monitor${
    synced === 1 ? "" : "s"
  } (${total} linked to this template).`;

  if (synced >= total) {
    return {
      title: "Done",
      message: message,
      isIncomplete: false,
    };
  }

  const remaining: number = total - synced;
  const isOne: boolean = remaining === 1;

  return {
    title: "Partially synced",
    message: `${message} ${remaining} linked monitor${isOne ? "" : "s"} still ${
      isOne ? "uses" : "use"
    } the previous configuration — usually because your permissions do not cover ${
      isOne ? "it" : "them"
    }. Run the sync again as a user who can update every linked monitor.`,
    isIncomplete: true,
  };
}
