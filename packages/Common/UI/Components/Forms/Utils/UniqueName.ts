/*
 * A NAME THE FORM FILLS IN THAT NOTHING ELSE IN THE PROJECT HAS YET.
 *
 * Some forms name the new record for whoever creates it: a dashboard made
 * from a template is called after the template ("Kubernetes Dashboard",
 * Pages/Dashboards), a key made from a setup guide after the guide
 * ("Kubernetes key", Components/Telemetry/IngestionKeyForm). Such a name
 * must not be one the project already has: where the column is unique in
 * the project (@UniqueColumnBy("projectId"), as a dashboard's name is) the
 * server would refuse it, and anywhere else two records of one name cannot
 * be told apart in a list or a picker. So the form fills in the wanted name
 * while nothing has it, and otherwise the first of "<name> 2",
 * "<name> 3", ... that nothing has.
 *
 * Names are compared the way the server's unique check compares them
 * (DatabaseService.checkUniqueColumnBy with QueryHelper.findWithSameText):
 * without case or surrounding spaces. This only spares the creator a
 * refusal - the server's check still decides. A name taken between the
 * lookup and the save (two people creating the same thing at once), or by
 * a record the creator is not allowed to see, is refused with the server's
 * own message, in the form, where the name can be changed.
 */

export type NormalizeNameFunction = (name: string) => string;

// How two names are told apart: not by case, nor by spaces around them.
export const normalizeNameForComparison: NormalizeNameFunction = (
  name: string,
): string => {
  return name.trim().toLowerCase();
};

export type GetUniqueNameFunction = (data: {
  // The name wanted: "Kubernetes Dashboard".
  name: string;
  /*
   * The names already taken - the ones the lookup could see. Anything that
   * is not text, or is blank, is passed over.
   */
  existingNames: Iterable<string | null | undefined>;
}) => string;

/**
 * The wanted name while nothing has it, else the first of "name 2",
 * "name 3", ... that nothing has. A blank name is handed back as it is:
 * there is nothing to number.
 */
export const getUniqueName: GetUniqueNameFunction = (data: {
  name: string;
  existingNames: Iterable<string | null | undefined>;
}): string => {
  const name: string = data.name.trim();

  if (name.length === 0) {
    return data.name;
  }

  const taken: Set<string> = new Set<string>();

  for (const existing of data.existingNames) {
    if (typeof existing === "string" && existing.trim().length > 0) {
      taken.add(normalizeNameForComparison(existing));
    }
  }

  if (!taken.has(normalizeNameForComparison(name))) {
    return name;
  }

  // One more than there are names is always enough.
  for (let number: number = 2; number <= taken.size + 2; number++) {
    const candidate: string = `${name} ${number}`;

    if (!taken.has(normalizeNameForComparison(candidate))) {
      return candidate;
    }
  }

  // Unreachable (see the loop bound); kept so the function always returns.
  return `${name} ${taken.size + 2}`;
};
