/*
 * What archiving an SLO does, in the words every surface that offers it uses.
 *
 * The shared archive card and bulk actions default to copy written for
 * telemetry resources: "hidden from the list but keeps collecting telemetry".
 * An archived SLO does the opposite of carrying on - the worker stops
 * evaluating it, and its open burn-rate alerts and incidents are resolved - so
 * the SLO surfaces pass these instead.
 *
 * Kept in one React-free module so the Settings card and the bulk actions
 * cannot describe the same action two different ways, and so App tests can
 * pin the wording without a renderer.
 */

// Settings card description while the SLO is live.
export const SLO_ARCHIVE_CARD_DESCRIPTION: string =
  "Archived SLOs are hidden from the SLO list and are not evaluated. Open burn-rate alerts and incidents are resolved. You can unarchive at any time to resume measuring.";

/*
 * Settings card description while the SLO is archived. Says what is kept, so
 * nobody deletes and recreates an SLO to get its configuration back.
 */
export const SLO_UNARCHIVE_CARD_DESCRIPTION: string =
  "This SLO is archived: it is hidden from the SLO list and is not being evaluated. Its settings, history and burn rate rules are kept. Unarchive it to resume measuring - its SLI and error budget are recomputed from its monitors' history on the next evaluation.";

// Settings card confirmation before archiving one SLO.
export const SLO_ARCHIVE_CONFIRM_MESSAGE: string =
  "Are you sure you want to archive this SLO? It will be hidden from the SLO list and will stop being evaluated, and its open burn-rate alerts and incidents will be resolved.";

/*
 * Settings card confirmation before unarchiving one SLO. Says what does NOT
 * happen as well: archive and enabled are separate flags, and a user who
 * archived a paused SLO should not expect unarchiving to start paging again.
 */
export const SLO_UNARCHIVE_CONFIRM_MESSAGE: string =
  "Are you sure you want to unarchive this SLO? It will reappear in the SLO list and be evaluated again on the next cycle. If it was disabled before it was archived, it stays disabled.";

/*
 * Bulk confirmations. Written to read correctly for one SLO or many: the
 * confirmation title above them already carries the count.
 */
export const SLO_BULK_ARCHIVE_CONFIRM_MESSAGE: string =
  "Archived SLOs are hidden from the SLO list and are not evaluated, and their open burn-rate alerts and incidents are resolved. You can unarchive them anytime from the Archived page.";

export const SLO_BULK_UNARCHIVE_CONFIRM_MESSAGE: string =
  "Unarchived SLOs reappear in the SLO list and are evaluated again on the next cycle. An SLO that was disabled before it was archived stays disabled.";
