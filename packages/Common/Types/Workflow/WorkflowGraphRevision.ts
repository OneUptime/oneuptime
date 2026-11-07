/*
 * WHICH GRAPH A SAVE WAS MADE TO (issue #6257).
 *
 * A workflow counts the saves of its graph (Workflow.graphRevision): one more
 * with every save, whoever makes it - the builder, Ask AI, the API - and
 * never for anything else. A save sent with the revision of the graph it was
 * made to, in its miscDataProps under this key, is made only while the
 * workflow is still at that revision (WorkflowService). Once someone else has
 * saved a newer graph it is refused with 409 Conflict, so it never replaces
 * their change unseen: the builder says what happened and lets its reader
 * choose (WorkflowSaveConflictModal). A save sent without one is made as
 * before, over whatever the workflow holds.
 */

export const WORKFLOW_GRAPH_REVISION_KEY: string = "graphRevision";

/*
 * The revision a save names, as sent: a whole number, 0 or more; null for
 * none (a save made over whatever the workflow holds); undefined for
 * anything else, which is refused.
 */
export const readWorkflowGraphRevision: (
  value: unknown,
) => number | null | undefined = (
  value: unknown,
): number | null | undefined => {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  }

  if (typeof value === "string") {
    const text: string = value.trim();

    // At most 15 digits, so the number it is stays exact.
    if (text.length === 0 || text.length > 15) {
      return undefined;
    }

    for (const character of text) {
      if (character < "0" || character > "9") {
        return undefined;
      }
    }

    return Number(text);
  }

  return undefined;
};
