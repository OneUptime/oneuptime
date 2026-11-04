import { ReactElement } from "react";
import {
  BULK_ACTION_CONCURRENCY,
  BulkItemOutcome,
  bulkItemUnchanged,
  runBulkAction,
} from "Common/UI/Components/BulkUpdate/BulkActionRunner";
import {
  BulkActionProgress,
  useBulkActionProgress,
} from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import {
  BULK_ADD_RESULT_LABELS,
  getBulkAddEntryName,
  StatusPageBulkAddEntry,
} from "./StatusPageBulkAddEntries";

/*
 * ADD IN BULK, ON A STATUS PAGE'S SUBSCRIBER LISTS AND ITS PRIVATE USERS.
 *
 * Each page pastes or uploads a list and says how one entry is added (a
 * create of its own, with every check a single add goes through); this
 * runs the list through the shared bulk runner (runBulkAction) and its
 * progress dialog (useBulkActionProgress), as every bulk action does:
 * several at once, the count and the time left as it goes, Stop, and once
 * it ends what happened to every entry - added, not added with the
 * server's reason, or skipped with why. These pages used to add one entry
 * at a time, each in a loop and a dialog of its own, with no Stop: a few
 * thousand subscribers moved from another tool took as many round trips
 * one after another.
 *
 * Several at once (BULK_ACTION_CONCURRENCY): every subscriber and private
 * user is a row of its own, and nothing one add writes is read by another.
 * A contact already on the page and the Free plan's limit on subscribers
 * are decided with each INSERT, under a lock (StatusPageSubscriberService
 * getCreateLimit), so adds at once cannot pass them together; the list
 * holds each address or number once; and the limits on the messages a new
 * subscriber or private user is sent count each contact, never the team.
 */

export interface StatusPageBulkAdd {
  /*
   * Adds every entry the list holds that is not skipped (add, one entry
   * each), then lets the page read its list again (onFinished).
   */
  run: (
    entries: Array<StatusPageBulkAddEntry>,
    add: (entry: StatusPageBulkAddEntry) => Promise<void>,
  ) => Promise<void>;
  // The progress and the result, while there is one to show.
  dialog: ReactElement;
  isRunning: boolean;
}

export interface StatusPageBulkAddOptions {
  // What an entry becomes: "Subscriber", "Private User".
  singularLabel: string;
  pluralLabel: string;
  // Once the run has ended, however it ended: the list shows what was added.
  onFinished: () => void;
}

const useStatusPageBulkAdd: (
  options: StatusPageBulkAddOptions,
) => StatusPageBulkAdd = (
  options: StatusPageBulkAddOptions,
): StatusPageBulkAdd => {
  const progress: BulkActionProgress<StatusPageBulkAddEntry> =
    useBulkActionProgress<StatusPageBulkAddEntry>({
      singularLabel: options.singularLabel,
      pluralLabel: options.pluralLabel,
      /*
       * Named in the result as the person wrote it: the address, the
       * number, the URL - or, for a Slack or Microsoft Teams row, its
       * workspace, as the list names it.
       */
      itemToString: getBulkAddEntryName,
    });

  const run: StatusPageBulkAdd["run"] = async (
    entries: Array<StatusPageBulkAddEntry>,
    add: (entry: StatusPageBulkAddEntry) => Promise<void>,
  ): Promise<void> => {
    try {
      await runBulkAction<StatusPageBulkAddEntry>({
        actionProps: progress.getActionProps(entries, {
          resultLabels: BULK_ADD_RESULT_LABELS,
        }),
        concurrency: BULK_ACTION_CONCURRENCY,
        step: async (
          entry: StatusPageBulkAddEntry,
        ): Promise<BulkItemOutcome | void> => {
          // Not an address, a number or a URL: nothing is sent, and it says why.
          if (entry.skippedReason) {
            return bulkItemUnchanged(entry.skippedReason);
          }

          await add(entry);
        },
      });
    } finally {
      options.onFinished();
    }
  };

  return {
    run: run,
    dialog: progress.dialog,
    isRunning: progress.isRunning,
  };
};

export default useStatusPageBulkAdd;
