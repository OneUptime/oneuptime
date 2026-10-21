import ObjectID from "../../../Types/ObjectID";

/*
 * The ids a Slack or Microsoft Teams create form submits. They are not bound
 * to the form that was sent - a submit can carry another project's ids, a
 * record deleted since, or one its member may not read - so they are never
 * checked or written as root: the record is created with the props of the
 * member the chat account is connected to, and the create holds every id it
 * names to what that member may name (DatabaseService's reference checks -
 * RelationListPermission and the project reference check), answering one
 * they may not name like one the project does not have.
 */
export default class WorkspaceProjectReferenceValidator {
  // Adaptive Card multi-selects submit their values as one comma-separated string.
  public static parseCommaSeparatedIds(
    value: string | undefined | null,
  ): Array<ObjectID> {
    if (!value) {
      return [];
    }

    return value
      .split(",")
      .map((id: string) => {
        return id.trim();
      })
      .filter((id: string) => {
        return id;
      })
      .map((id: string) => {
        return new ObjectID(id);
      });
  }
}
