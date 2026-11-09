/*
 * WHERE A WRITE CAME FROM, when it was not made by the person's own hand
 * (DatabaseCommonInteractionProps.writeSource). For attribution only: no
 * permission check reads it, and the write is the person's - made with
 * their permissions, under their name.
 *
 * A workflow's version history keeps Ask AI's changes apart from the
 * person's own (issue #6258): each one is a version of its own, which says
 * Ask AI made it for them (WorkflowVersionPolicy).
 */
enum WriteSource {
  // Ask AI, acting for the person in userId: a change they asked for and approved.
  AskAi = "AskAi",
}

export const WRITE_SOURCES: ReadonlyArray<WriteSource> = [WriteSource.AskAi];

export const isWriteSource: (value: unknown) => value is WriteSource = (
  value: unknown,
): value is WriteSource => {
  return (
    typeof value === "string" &&
    (WRITE_SOURCES as ReadonlyArray<string>).includes(value)
  );
};

export default WriteSource;
