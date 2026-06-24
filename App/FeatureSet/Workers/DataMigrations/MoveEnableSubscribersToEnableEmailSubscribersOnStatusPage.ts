import DataMigrationBase from "./DataMigrationBase";

/*
 * History and why this migration is an intentional no-op:
 *
 * This class was originally written (Jan 2024) to copy StatusPage.enableSubscribers
 * (the legacy/deprecated master "Can subscribers subscribe?" flag) onto the newer
 * per-channel StatusPage.enableEmailSubscribers column, as if enableEmailSubscribers
 * had just been added and needed a backfill.
 *
 * It has NEVER actually run on any install. Its constructor mistakenly passed the
 * migration name "AddPostedAtToPublicNotes" to super() — the exact name already
 * used by the AddPostedAtToPublicNotes migration. The runner (Workers/Utils/DataMigration.ts)
 * dedupes by migration.name, so once AddPostedAtToPublicNotes was recorded as
 * executed this entry was always skipped, and its copy never executed anywhere.
 *
 * We now fix the duplicate-name collision by passing this class's own unique name,
 * but we deliberately do NOT resurrect the copy, because it is both obsolete and
 * unsafe:
 *
 *   1. No backfill gap ever existed. enableEmailSubscribers was created inline in
 *      the InitialMigration (1717605043663) as `boolean NOT NULL DEFAULT true`,
 *      right beside enableSubscribers. Every existing/new row already holds a
 *      non-null value independent of enableSubscribers — there is nothing to
 *      backfill.
 *
 *   2. Running the copy would CLOBBER admin intent. enableEmailSubscribers is an
 *      independently editable per-channel toggle in the dashboard (Subscriber
 *      settings). Copying the deprecated master flag over it would overwrite a
 *      deliberate per-channel choice in either direction (e.g. master=false would
 *      force-disable an intentionally-enabled email channel).
 *
 *   3. enableSubscribers is deprecated and effectively dead at runtime (model
 *      comment marks it deprecated; it gates no server service, API endpoint, or
 *      send job — its only consumer is a cosmetic dashboard warning banner). Its
 *      value is meaningless to propagate. NOTE: contrary to an earlier assumption,
 *      enableSubscribers=false does NOT block email sends to existing subscribers,
 *      so the copy was never redundant-because-gated either — it was simply
 *      destructive.
 *
 * Net: an empty migrate() lets the (now uniquely named) migration record itself as
 * executed on the next boot without mutating any data. rollback() stays a no-op.
 * Do not re-add the enableSubscribers -> enableEmailSubscribers copy.
 */
export default class MoveEnableSubscribersToEnableEmailSubscribersOnStatusPage extends DataMigrationBase {
  public constructor() {
    super("MoveEnableSubscribersToEnableEmailSubscribersOnStatusPage");
  }

  public override async migrate(): Promise<void> {
    // Intentional no-op. See the file header for the full rationale.
    return;
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
