/*
 * THE KINDS OF ACTION A ⋯ MENU AND BULK ACTIONS DRAW TOGETHER.
 *
 * A row of an incidents list offers Acknowledge, Resolve, Change State,
 * Change Severity, Assign to Me, Add Owner, Show ID and Delete; its Bulk
 * Actions a dozen more. Read as one column of fifteen items, a menu like
 * that hides what it holds. Drawn in short runs of one kind each - the
 * record's own state and values, its people, its labels, where it belongs -
 * with a gap between runs, it reads at a glance, the way Linear's and
 * GitHub's do.
 *
 * An action names its kind (ActionButtonSchema.menuGroup for a row's ⋯ menu,
 * BulkActionButtonSchema.menuGroup for Bulk Actions); the shared actions name
 * theirs here, and a list's own may name one of these or one of its own (an
 * alert's Link to Incident). An action that names none sits in the run of
 * its unnamed neighbours, so a list that names no kinds is drawn exactly as
 * before. Destructive actions keep their own place at the bottom, after a
 * gap, whatever they name.
 */
export enum ActionMenuGroup {
  // A record's own state and values: Acknowledge, Resolve, Change State, Change Severity.
  Change = "change",
  // Who it belongs to: Assign to Me, Assign to Someone Else, Add Owner, Remove Owner.
  People = "people",
  // Its labels: Add Labels, Remove Labels.
  Labels = "labels",
  // The rows taken out of OneUptime: Export CSV.
  Export = "export",
}

/*
 * Whether an action starts a new run in its menu: it names another kind
 * than the action above it, and one of the two names a kind at all.
 */
export const startsNewMenuGroup: (
  previous: string | undefined,
  next: string | undefined,
) => boolean = (
  previous: string | undefined,
  next: string | undefined,
): boolean => {
  return (previous || "") !== (next || "") && Boolean(previous || next);
};
