import {
  getRefusalText,
  readRefusalValues,
  RefusalWithValues,
} from "../Exception/RefusalWithValues";
import { translationKey } from "../Translator";

/*
 * A NAME THAT IS ONE OF ITS KIND IN A PROJECT, HOWEVER IT IS WRITTEN (#9674).
 *
 * A team's name is what every picker shows of it - Invite User's Team, an
 * escalation rule's teams, an owner, a permission's teams - so two teams
 * called "Tenants" could not be told apart anywhere they were picked, and
 * nothing stopped a second one being made, or a team being renamed to
 * another's name. A label's name had the same gap on a rename: a new label
 * was refused a name another label had, a renamed one was not. On-call
 * policies and on-call schedules are held to the same rule since #9742.
 *
 * Two names are one name when they read alike: whatever their case, the
 * spaces around them, and how many spaces - or which kind of space - stand
 * between their words. A page draws "Platform  Team" and "Platform Team"
 * the same, and a non-breaking space pasted from a document looks like any
 * other, so "tenants", " Tenants " and "Tenants" are all the name
 * "Tenants". A name is stored as it was written: only the comparison reads
 * it this way, so a name written by Terraform or the API reads back exactly
 * as it was sent.
 *
 * The server compares in Postgres (QueryHelper.findWithSameName), with both
 * names read the same way there, so a name a project already holds is
 * matched however it was saved, and lower case is Postgres's own on both
 * sides. getNameKey reads a name the same way here, for the checks that
 * compare two names already in hand: whether a rename changes the name at
 * all.
 *
 * Each kind's refusal is a sentence with the name in it (RefusalWithValues):
 * the server answers in English, and the Dashboard reads the name back and
 * says the sentence in the reader's language, under the form's Name field.
 *
 * React-free and server-safe: the server refuses with these, the Dashboard
 * reads them. A source of the Dashboard's string extractor (keys only).
 */

/*
 * Every character JavaScript's \s matches - the white space a name can hold
 * that a page draws as a space, or not at all (the byte order mark) - as
 * the body of a bracket expression. One list for both readings of a name:
 * this file's, and the pattern Postgres reads it with, where \s would mean
 * only what the database's locale says is a space. Written as character
 * codes: most of them draw as nothing, or as a plain space.
 */
const NAME_WHITE_SPACE_CODES: ReadonlyArray<number> = [
  // Tab, line feed, vertical tab, form feed, carriage return, space.
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20,
  // No-break space, Ogham space mark.
  0xa0, 0x1680,
  // Line and paragraph separators, narrow no-break and medium mathematical spaces.
  0x2028,
  0x2029, 0x202f, 0x205f,
  // Ideographic space, and the byte order mark.
  0x3000, 0xfeff,
];

// The en quad to the hair space, as a range of the bracket expression.
const NAME_WHITE_SPACE_RANGE: string = `${String.fromCharCode(0x2000)}-${String.fromCharCode(0x200a)}`;

export const NAME_WHITE_SPACE_CHARACTERS: string = `${String.fromCharCode(
  ...NAME_WHITE_SPACE_CODES,
)}${NAME_WHITE_SPACE_RANGE}`;

// A run of white space inside a name, as Postgres's pattern and as this file's.
export const NAME_WHITE_SPACE_RUN_PATTERN: string = `[${NAME_WHITE_SPACE_CHARACTERS}]+`;

const NAME_WHITE_SPACE_RUN: RegExp = new RegExp(
  NAME_WHITE_SPACE_RUN_PATTERN,
  "g",
);

/*
 * A name as it reads: every run of white space one space, none around it.
 * Anything that is not text reads as no name.
 */
export const normalizeName: (name: unknown) => string = (
  name: unknown,
): string => {
  if (typeof name !== "string") {
    return "";
  }

  return name.replace(NAME_WHITE_SPACE_RUN, " ").trim();
};

// The form two names are compared in: as it reads, in lower case.
export const getNameKey: (name: unknown) => string = (
  name: unknown,
): string => {
  return normalizeName(name).toLowerCase();
};

// Whether two names are one name.
export const isSameName: (left: unknown, right: unknown) => boolean = (
  left: unknown,
  right: unknown,
): boolean => {
  const leftKey: string = getNameKey(left);

  return leftKey.length > 0 && leftKey === getNameKey(right);
};

/*
 * The SQL that reads a name as getNameKey does: `textSql` is a column, or a
 * bound parameter, and `patternSql` the bound NAME_WHITE_SPACE_RUN_PATTERN.
 * Postgres's LOWER on both sides, so the two always fold case alike.
 */
export const getNameKeySql: (data: {
  textSql: string;
  patternSql: string;
}) => string = (data: { textSql: string; patternSql: string }): string => {
  return `LOWER(BTRIM(REGEXP_REPLACE(${data.textSql}, ${data.patternSql}, ' ', 'g')))`;
};

/*
 * A team's name another team of the project has: said with the name as it
 * was written for the new team or the rename, never the other team's.
 */
export const TEAM_NAME_TAKEN_REFUSAL: RefusalWithValues = {
  template: translationKey(
    "There is already a team called {{name}} in this project. Pick another name.",
  ),
  terms: [],
};

/*
 * One update that would give several teams one name: they would be alike
 * the moment it was made.
 */
export const TEAMS_RENAMED_TOGETHER_REFUSAL: string = translationKey(
  "Several teams cannot be given one name. Rename one team at a time.",
);

// The same for a label.
export const LABEL_NAME_TAKEN_REFUSAL: RefusalWithValues = {
  template: translationKey(
    "There is already a label called {{name}} in this project. Pick another name.",
  ),
  terms: [],
};

export const LABELS_RENAMED_TOGETHER_REFUSAL: string = translationKey(
  "Several labels cannot be given one name. Rename one label at a time.",
);

/*
 * The same for an on-call policy and an on-call schedule (#9742): each is
 * picked by its name alone - an escalation rule's schedules, an incident or
 * alert on-call rule's policies, a monitor criteria's policies, a workflow
 * that pages a policy, Readiness and the Schedule Timeline, the Slack and
 * Microsoft Teams commands - so two schedules called "Primary" could not be
 * told apart in any of them.
 */
export const ON_CALL_POLICY_NAME_TAKEN_REFUSAL: RefusalWithValues = {
  template: translationKey(
    "There is already an on-call policy called {{name}} in this project. Pick another name.",
  ),
  terms: [],
};

/*
 * An archived policy keeps its name: unarchived, it would be a twin of the
 * new one, and unarchiving is never refused. So a new policy, or a rename,
 * that takes an archived policy's name is told where to bring that one back.
 */
export const ARCHIVED_ON_CALL_POLICY_NAME_TAKEN_REFUSAL: RefusalWithValues = {
  template: translationKey(
    "There is already an archived on-call policy called {{name}} in this project. Unarchive it from On-Call > Advanced > Archived Policies, or pick another name.",
  ),
  terms: [],
};

export const ON_CALL_POLICIES_RENAMED_TOGETHER_REFUSAL: string = translationKey(
  "Several on-call policies cannot be given one name. Rename one policy at a time.",
);

export const ON_CALL_SCHEDULE_NAME_TAKEN_REFUSAL: RefusalWithValues = {
  template: translationKey(
    "There is already an on-call schedule called {{name}} in this project. Pick another name.",
  ),
  terms: [],
};

export const ON_CALL_SCHEDULES_RENAMED_TOGETHER_REFUSAL: string =
  translationKey(
    "Several on-call schedules cannot be given one name. Rename one schedule at a time.",
  );

// Every refusal of a name another record of the project has.
export const NAME_TAKEN_REFUSALS: ReadonlyArray<RefusalWithValues> = [
  TEAM_NAME_TAKEN_REFUSAL,
  LABEL_NAME_TAKEN_REFUSAL,
  ON_CALL_POLICY_NAME_TAKEN_REFUSAL,
  ARCHIVED_ON_CALL_POLICY_NAME_TAKEN_REFUSAL,
  ON_CALL_SCHEDULE_NAME_TAKEN_REFUSAL,
];

// Every refusal of one update that would give several records one name.
export const RENAMED_TOGETHER_REFUSALS: ReadonlyArray<string> = [
  TEAMS_RENAMED_TOGETHER_REFUSAL,
  LABELS_RENAMED_TOGETHER_REFUSAL,
  ON_CALL_POLICIES_RENAMED_TOGETHER_REFUSAL,
  ON_CALL_SCHEDULES_RENAMED_TOGETHER_REFUSAL,
];

// A refusal as the server answers it: the name as it reads, never blank.
export const getNameTakenRefusalText: (
  refusal: RefusalWithValues,
  name: unknown,
) => string = (refusal: RefusalWithValues, name: unknown): string => {
  return getRefusalText(refusal, { name: normalizeName(name) });
};

export const getTeamNameTakenRefusal: (name: unknown) => string = (
  name: unknown,
): string => {
  return getNameTakenRefusalText(TEAM_NAME_TAKEN_REFUSAL, name);
};

export const getLabelNameTakenRefusal: (name: unknown) => string = (
  name: unknown,
): string => {
  return getNameTakenRefusalText(LABEL_NAME_TAKEN_REFUSAL, name);
};

/*
 * Whether the server refused a form because its name is taken, or would
 * be shared by the rows of one update: the form says it under its Name
 * field (Field.ownsServerError) rather than above the form.
 */
export const isNameTakenRefusal: (message: string) => boolean = (
  message: string,
): boolean => {
  const text: string = (message || "").trim();

  if (RENAMED_TOGETHER_REFUSALS.includes(text)) {
    return true;
  }

  return NAME_TAKEN_REFUSALS.some((refusal: RefusalWithValues): boolean => {
    return readRefusalValues(refusal, text) !== null;
  });
};

/*
 * THE NAME A RECORD TAKES WHEN ITS OWN IS TAKEN: "Primary", then
 * "Primary 2", "Primary 3" and on - the numbering Duplicate gives a copy
 * (UI/Components/Forms/Utils/UniqueName, "API Monitor 2").
 *
 * For a name OneUptime picks on a person's behalf, where nobody is there to
 * pick another: the first policy a guided setup makes ("Default on-call
 * policy", while an archived one, or one the person may not see, has the
 * name), or two schedules another tool called alike, brought over by one
 * import. Refused, the name would stop the setup or the import part way.
 *
 * The number is the name's, not a word of the page's: it is stored with
 * the name and drawn as written. A name kept to `maxLength` gives up the
 * end of its words, never its number.
 */
export const getNumberedName: (data: {
  name: string;
  number: number;
  maxLength?: number | undefined;
}) => string = (data: {
  name: string;
  number: number;
  maxLength?: number | undefined;
}): string => {
  if (data.number <= 1) {
    return data.name;
  }

  const suffix: string = ` ${data.number}`;
  const base: string = normalizeName(data.name);

  if (!data.maxLength || base.length + suffix.length <= data.maxLength) {
    return `${base}${suffix}`;
  }

  return `${base.slice(0, Math.max(1, data.maxLength - suffix.length)).trim()}${suffix}`;
};

// How many names a create tries, its own included, before it gives up.
export const FREE_NAME_ATTEMPTS: number = 10;

/*
 * Makes a record with the first of its numbered names that is free: the
 * create is tried with the name, and again with the next number for as
 * long as the server refuses it because another record has the name
 * (isNameTakenRefusal). Any other refusal is the create's own, and is
 * thrown as it came. Each try asks the server, so a name taken by a record
 * the person may not read, or by an archived one, is passed over all the
 * same. Nothing is written by a refused try: the name is checked before
 * the record is saved (UniqueNameInProject).
 */
export const createWithFreeName: <T>(data: {
  name: string;
  create: (name: string) => Promise<T>;
  // The words a failed try was refused with: a server's message, or the Dashboard's.
  readRefusal: (error: unknown) => string;
  maxLength?: number | undefined;
  attempts?: number | undefined;
}) => Promise<{ created: T; name: string }> = async <T>(data: {
  name: string;
  create: (name: string) => Promise<T>;
  readRefusal: (error: unknown) => string;
  maxLength?: number | undefined;
  attempts?: number | undefined;
}): Promise<{ created: T; name: string }> => {
  const attempts: number = Math.max(1, data.attempts || FREE_NAME_ATTEMPTS);

  for (let number: number = 1; ; number++) {
    const name: string = getNumberedName({
      name: data.name,
      number: number,
      maxLength: data.maxLength,
    });

    try {
      return { created: await data.create(name), name: name };
    } catch (error) {
      if (number >= attempts || !isNameTakenRefusal(data.readRefusal(error))) {
        throw error;
      }
    }
  }
};
