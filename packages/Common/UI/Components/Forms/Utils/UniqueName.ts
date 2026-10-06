/*
 * A NAME THE FORM FILLS IN THAT NOTHING ELSE IN THE PROJECT HAS YET.
 *
 * Some forms name the new record for whoever creates it: a dashboard made
 * from a template is called after the template ("Kubernetes Dashboard",
 * Pages/Dashboards), a key made from a setup guide after the guide
 * ("Kubernetes key", Components/Telemetry/IngestionKeyForm), a copy made
 * by Duplicate after its original ("API Monitor 2", getCopyName below,
 * Components/DuplicateModel). Such a name
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

/*
 * A COPY'S NAME.
 *
 * Duplicate (Components/DuplicateModel) names the copy after the record it
 * copies, numbered past the names the project has: a copy of "API Monitor"
 * is "API Monitor 2", the next copy "API Monitor 3". A copy of a copy goes
 * on with the same numbers instead of starting a series of its own: a copy
 * of "API Monitor 2" is "API Monitor 3" (or the next number nothing has),
 * not "API Monitor 2 2", and never a number below its original's.
 *
 * That only holds while the series' first name - "API Monitor" - is one
 * the project has. Otherwise the number at the end is part of the name: a
 * copy of "Windows Server 2019" is "Windows Server 2019 2", not "Windows
 * Server 2020".
 */

// A name that ends in a number, as "<base> <number>" ("API Monitor 2").
const NAME_ENDING_IN_A_NUMBER: RegExp = /^(.*\S)\s+(\d+)$/;

export interface NumberedName {
  // "API Monitor"
  base: string;
  // 2
  number: number;
}

/**
 * "API Monitor 2" as its base and its number; null for a name that does
 * not end in a number after a space, or ends in one too large to count on.
 */
export const splitNumberedName: (name: string) => NumberedName | null = (
  name: string,
): NumberedName | null => {
  const match: RegExpExecArray | null = NAME_ENDING_IN_A_NUMBER.exec(
    name.trim(),
  );

  if (!match) {
    return null;
  }

  const number: number = Number(match[2]);

  if (!Number.isSafeInteger(number)) {
    return null;
  }

  return { base: match[1] as string, number };
};

/**
 * What a lookup of the names a copy must not take searches for: the
 * series' first name when the name ends in a number ("API Monitor" for
 * "API Monitor 2"), else the name itself. Every name that matters -
 * the series' first name, each numbered one, the original - contains it.
 */
export const getCopyNameSearchText: (name: string) => string = (
  name: string,
): string => {
  return splitNumberedName(name)?.base || name.trim();
};

export type GetCopyNameFunction = (data: {
  // The name of the record being copied: "API Monitor".
  name: string;
  /*
   * The names already taken - the ones the lookup could see. The original's
   * own name always counts as taken, whether the lookup saw it or not.
   */
  existingNames: Iterable<string | null | undefined>;
}) => string;

/**
 * The name a copy of a record starts with: "API Monitor 2" for a copy of
 * "API Monitor", "API Monitor 3" for a copy of "API Monitor 2" (see above).
 * Never the original's own name, nor any other name taken. Blank for a
 * blank name: there is nothing to number.
 */
export const getCopyName: GetCopyNameFunction = (data: {
  name: string;
  existingNames: Iterable<string | null | undefined>;
}): string => {
  const name: string = data.name.trim();

  if (name.length === 0) {
    return "";
  }

  const taken: Set<string> = new Set<string>([
    normalizeNameForComparison(name),
  ]);

  for (const existing of data.existingNames) {
    if (typeof existing === "string" && existing.trim().length > 0) {
      taken.add(normalizeNameForComparison(existing));
    }
  }

  const numbered: NumberedName | null = splitNumberedName(name);

  if (numbered && taken.has(normalizeNameForComparison(numbered.base))) {
    // The series goes on past the original's number; one per name is enough.
    for (
      let number: number = numbered.number + 1;
      number <= numbered.number + taken.size + 1;
      number++
    ) {
      const candidate: string = `${numbered.base} ${number}`;

      if (!taken.has(normalizeNameForComparison(candidate))) {
        return candidate;
      }
    }
  }

  return getUniqueName({ name, existingNames: taken });
};
