/*
 * A NAME THE FORM FILLS IN FROM A PICK, UNTIL SOMEBODY TYPES THEIR OWN.
 *
 * Some names have an obvious answer the moment something is picked: a
 * status page resource's display name is the picked monitor's name
 * (StatusPageResourceFormFields), a new ingestion key on the Settings page
 * is a "Server key" or a "Browser key" after its type (IngestionKeyForm).
 * The form fills the name in and keeps filling it in as the pick changes -
 * but never over a name somebody typed: that one is theirs, and stays.
 *
 * One rule, so every such name behaves alike: the name the form holds is
 * still the form's own while it is empty, or one the form filled in itself -
 * the last one it filled in, or the name of what was picked before (an Edit
 * form that never filled anything in, holding a name nobody changed).
 */

export type GetNameAfterPickFunction = (data: {
  // The name the form holds now.
  name: unknown;
  // The name of what is picked now; null when there is none to fill in.
  pickedName: string | null | undefined;
  /*
   * Names the form filled in itself, or that went with what was picked
   * before. Anything that is not text is passed over.
   */
  filledInNames: Array<unknown>;
}) => string | null;

/**
 * The name once something else is picked: the picked name, while the name
 * the form holds is still the form's own. Null when it stays as it is -
 * somebody typed a name of their own, or there is no name to fill in.
 */
export const getNameAfterPick: GetNameAfterPickFunction = (data: {
  name: unknown;
  pickedName: string | null | undefined;
  filledInNames: Array<unknown>;
}): string | null => {
  if (!data.pickedName) {
    return null;
  }

  const name: string = typeof data.name === "string" ? data.name : "";

  const isTheFormsOwn: boolean =
    name.trim().length === 0 ||
    data.filledInNames.some((filledIn: unknown): boolean => {
      return typeof filledIn === "string" && filledIn === name;
    });

  return isTheFormsOwn ? data.pickedName : null;
};
