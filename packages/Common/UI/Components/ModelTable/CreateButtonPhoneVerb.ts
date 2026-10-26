/*
 * What a model table's create button says on a phone, where it shares its
 * line with the ⋯ and "Create Scheduled Maintenance Event" broke onto two
 * lines: its verb alone (CardButtonSchema.phoneTitle), the card's title
 * right above naming the kind. Only the verbs whose word alone every
 * language reads as the verb: not Link, which comes back as the noun, nor
 * Declare, which has no word of its own in most - those keep their whole
 * title.
 */
export const PHONE_CREATE_VERBS: ReadonlyArray<string> = [
  "Create",
  "Add",
  "Invite",
  "Connect",
];

export const getCreateButtonPhoneVerb: (data: {
  verb?: string | undefined;
  itemName: string;
}) => string | undefined = (data: {
  verb?: string | undefined;
  itemName: string;
}): string | undefined => {
  const verb: string = data.verb || "Create";

  // A button that says its verb alone already has nothing to drop.
  if (!data.itemName.trim() || !PHONE_CREATE_VERBS.includes(verb)) {
    return undefined;
  }

  return verb;
};
