import DataMigrationBase from "./DataMigrationBase";
import StatusPageSubscriberService, {
  StatusPageSubscriberUnsubscribeBackfillResult,
} from "Common/Server/Services/StatusPageSubscriberService";
import logger from "Common/Server/Utils/Logger";

/*
 * Fills the two StatusPageSubscriber columns that unsubscribing without
 * signing in added, for every subscriber that existed before the upgrade:
 *
 *   - unsubscribeToken: the secret in the subscriber's unsubscribe link,
 *     {statusPageUrl}/unsubscribe/{id}-{token}. Every create mints one; this
 *     gives one to everyone else, soft-deleted subscribers included.
 *   - isAddedByTeam: set for every subscriber with a creator (Created By), as
 *     only a teammate's create carries one. It decides whether the status
 *     page's owners are told when the subscriber unsubscribes itself.
 *     Subscribers an API key or a workflow added before the upgrade have no
 *     creator and cannot be told from sign-ups; they stay unmarked.
 *
 * Not in the schema migrations that added the columns
 * (1795600000000-AddStatusPageSubscriberUnsubscribeToken,
 * 1795700000000-AddStatusPageSubscriberIsAddedByTeam): each runs in one
 * transaction, and an UPDATE of every row there would hold ADD COLUMN's
 * exclusive lock on the table - stopping every notification, sign-up and
 * subscriber list - for as long as it took, and on a large table run past the
 * connection's statement timeout and fail the deploy. Here the table is walked
 * in primary key order, a batch at a time, each batch in short statements of
 * its own (StatusPageSubscriberService.backfillUnsubscribeColumns).
 *
 * Until it reaches a subscriber nothing breaks: the first sender to need that
 * subscriber's link gives it a token (ensureUnsubscribeTokens), and the
 * service reads Created By alongside Is Added By Team.
 *
 * Idempotent, and safe to run twice concurrently as this runner requires
 * (see Workers/Utils/DataMigration.ts): every write only fills what is still
 * empty, re-checked under the row lock, so a token already sent in a message
 * is never replaced.
 */
export default class BackfillStatusPageSubscriberUnsubscribeColumns extends DataMigrationBase {
  public constructor() {
    super("BackfillStatusPageSubscriberUnsubscribeColumns");
  }

  public override async migrate(): Promise<void> {
    const result: StatusPageSubscriberUnsubscribeBackfillResult =
      await StatusPageSubscriberService.backfillUnsubscribeColumns();

    logger.info(
      `BackfillStatusPageSubscriberUnsubscribeColumns: gave ${result.tokensGiven} status page subscriber(s) an unsubscribe token and marked ${result.markedAddedByTeam} as added by the team.`,
    );
  }

  public override async rollback(): Promise<void> {
    // Nothing to undo: the columns stay, and a filled one is what they should hold.
    return;
  }
}
