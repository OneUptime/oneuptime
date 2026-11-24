import { JSONObject } from "../JSON";

/*
 * WHAT THE DASHBOARD ASKS THE SERVER ABOUT NAMES THAT REPEAT IN A PROJECT
 * (#10761).
 *
 * Two monitors, templates or connections of a project may share a name
 * unless the project requires unique names (Project requireUniqueNames, and
 * the kinds a model marks @UniqueNameWhenRequired). Either way the Dashboard
 * says so where it matters:
 *
 *   - GET /unique-names/check: as a form takes a name, whether another
 *     record of its kind has it - the one the reader may read, to link to -
 *     and whether saving it would be refused. The form warns under the name
 *     (Common/UI/Components/Forms/DuplicateNameNotice), and never blocks:
 *     the server decides.
 *   - GET /unique-names/duplicates: the names the project already holds
 *     more than once, kind by kind, for Project Settings > Project to list
 *     beside the setting - records named alike before it was on keep their
 *     names until someone renames them.
 *
 * For a signed-in member of the project or a project API key. Only records
 * the caller may read are named; a record they may not read is never named,
 * and is said to hold a name only where saving it would be refused anyway.
 * React-free and server-safe: the server answers with these, the Dashboard
 * reads them.
 */

export const UNIQUE_NAMES_ROUTE: string = "/unique-names";

export const UNIQUE_NAME_CHECK_ROUTE: string = `${UNIQUE_NAMES_ROUTE}/check`;

export const UNIQUE_NAME_DUPLICATES_ROUTE: string = `${UNIQUE_NAMES_ROUTE}/duplicates`;

// The check's query parameters.
export const UNIQUE_NAME_CHECK_PARAMS: {
  readonly tableName: "tableName";
  readonly name: "name";
  readonly exceptId: "exceptId";
} = {
  // The kind, by its table: "Monitor".
  tableName: "tableName",
  // The name the form holds.
  name: "name",
  // The record the form edits, which may hold its own name.
  exceptId: "exceptId",
};

// The record that has a name, as the reader may read it.
export interface UniqueNameHolder {
  id: string;
  // Its own name, as it was written.
  name: string;
  isArchived: boolean;
}

export interface UniqueNameCheckAnswer {
  /*
   * Saving a name another record has would be refused: the project
   * requires unique names, or the kind holds its names unique always.
   */
  isRequired: boolean;
  // The record that has the name, where the reader may read it.
  takenBy: UniqueNameHolder | null;
  /*
   * A record the reader may not read has the name. Said only where saving
   * would be refused, which says as much; never otherwise.
   */
  isTakenByUnreadable: boolean;
}

// A record of a name the project holds more than once.
export interface DuplicateNameRecord {
  id: string;
  name: string;
  // When it was made, as the API writes a date.
  createdAt: string | null;
  isArchived: boolean;
}

// The records of one kind whose names read as one name.
export interface DuplicateNameGroup {
  // The name, as the first of them writes it.
  name: string;
  // How many records of the kind have it, those the reader may not read included.
  count: number;
  // The ones the reader may read.
  records: Array<DuplicateNameRecord>;
}

export interface DuplicateNamesOfKind {
  // The kind, by its table: "Monitor".
  tableName: string;
  // How many names the kind holds more than once.
  groupCount: number;
  // The first of them, by name (MAX_DUPLICATE_GROUPS_PER_KIND at most).
  groups: Array<DuplicateNameGroup>;
}

export interface DuplicateNamesAnswer {
  // Whether the project requires unique names now.
  requireUniqueNames: boolean;
  // The kinds that hold a name more than once, by their singular name.
  kinds: Array<DuplicateNamesOfKind>;
}

/*
 * A NAME ONEUPTIME PICKED FOR THE PERSON, NUMBERED RATHER THAN REFUSED.
 *
 * Many writes name a record for the person, who cannot pick another where
 * it is written: a guided setup's monitor named after its address, a
 * recommendation's "web - High CPU", a data product's monitor, a hunt or a
 * playbook from a library, an import. While the project requires unique
 * names, such a write says so in its misc data - `{ "numbersTakenName":
 * true }` - and a taken name is then numbered as Duplicate numbers a copy
 * ("web - High CPU 2", getNumberedName) instead of refused. A name a
 * person typed, Terraform's and the API's, is never numbered: it is
 * refused, and they pick another.
 */
export const NUMBERS_TAKEN_NAME_KEY: string = "numbersTakenName";

// The misc data of a write whose name OneUptime picked for the person.
export const getNumbersTakenNameData: () => JSONObject = (): JSONObject => {
  return { [NUMBERS_TAKEN_NAME_KEY]: true };
};

// Whether a write's misc data asks for a taken name to be numbered.
export const isNumbersTakenName: (miscData: unknown) => boolean = (
  miscData: unknown,
): boolean => {
  return Boolean(
    miscData &&
      typeof miscData === "object" &&
      (miscData as Record<string, unknown>)[NUMBERS_TAKEN_NAME_KEY] === true,
  );
};

// How many names of one kind the answer lists; groupCount says how many there are.
export const MAX_DUPLICATE_GROUPS_PER_KIND: number = 50;

// How many records of one name the answer lists; count says how many there are.
export const MAX_DUPLICATE_RECORDS_PER_GROUP: number = 10;

const readText: (value: unknown) => string = (value: unknown): string => {
  return typeof value === "string" ? value : "";
};

const readCount: (value: unknown) => number = (value: unknown): number => {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
};

const asObject: (value: unknown) => Record<string, unknown> | null = (
  value: unknown,
): Record<string, unknown> | null => {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
};

const readHolder: (value: unknown) => UniqueNameHolder | null = (
  value: unknown,
): UniqueNameHolder | null => {
  const holder: Record<string, unknown> | null = asObject(value);

  if (!holder || !readText(holder["id"])) {
    return null;
  }

  return {
    id: readText(holder["id"]),
    name: readText(holder["name"]),
    isArchived: holder["isArchived"] === true,
  };
};

export const toUniqueNameCheckAnswerJSON: (
  answer: UniqueNameCheckAnswer,
) => JSONObject = (answer: UniqueNameCheckAnswer): JSONObject => {
  return {
    isRequired: answer.isRequired,
    takenBy: answer.takenBy
      ? {
          id: answer.takenBy.id,
          name: answer.takenBy.name,
          isArchived: answer.takenBy.isArchived,
        }
      : null,
    isTakenByUnreadable: answer.isTakenByUnreadable,
  };
};

// Reads a check's answer back; anything that is not one reads as a free name.
export const readUniqueNameCheckAnswer: (
  value: unknown,
) => UniqueNameCheckAnswer = (value: unknown): UniqueNameCheckAnswer => {
  const answer: Record<string, unknown> | null = asObject(value);

  return {
    isRequired: answer?.["isRequired"] === true,
    takenBy: readHolder(answer?.["takenBy"]),
    isTakenByUnreadable: answer?.["isTakenByUnreadable"] === true,
  };
};

export const toDuplicateNamesAnswerJSON: (
  answer: DuplicateNamesAnswer,
) => JSONObject = (answer: DuplicateNamesAnswer): JSONObject => {
  return {
    requireUniqueNames: answer.requireUniqueNames,
    kinds: answer.kinds.map((kind: DuplicateNamesOfKind): JSONObject => {
      return {
        tableName: kind.tableName,
        groupCount: kind.groupCount,
        groups: kind.groups.map((group: DuplicateNameGroup): JSONObject => {
          return {
            name: group.name,
            count: group.count,
            records: group.records.map(
              (record: DuplicateNameRecord): JSONObject => {
                return {
                  id: record.id,
                  name: record.name,
                  createdAt: record.createdAt,
                  isArchived: record.isArchived,
                };
              },
            ),
          };
        }),
      };
    }),
  };
};

const readRecord: (value: unknown) => DuplicateNameRecord | null = (
  value: unknown,
): DuplicateNameRecord | null => {
  const record: Record<string, unknown> | null = asObject(value);

  if (!record || !readText(record["id"])) {
    return null;
  }

  return {
    id: readText(record["id"]),
    name: readText(record["name"]),
    createdAt: readText(record["createdAt"]) || null,
    isArchived: record["isArchived"] === true,
  };
};

const readGroup: (value: unknown) => DuplicateNameGroup | null = (
  value: unknown,
): DuplicateNameGroup | null => {
  const group: Record<string, unknown> | null = asObject(value);

  if (!group) {
    return null;
  }

  const records: Array<DuplicateNameRecord> = (
    Array.isArray(group["records"]) ? group["records"] : []
  )
    .map(readRecord)
    .filter((record: DuplicateNameRecord | null): boolean => {
      return record !== null;
    }) as Array<DuplicateNameRecord>;

  if (records.length === 0) {
    return null;
  }

  return {
    name: readText(group["name"]) || records[0]!.name,
    count: Math.max(readCount(group["count"]), records.length),
    records: records,
  };
};

// Reads the duplicates' answer back; anything that is not one reads as none.
export const readDuplicateNamesAnswer: (
  value: unknown,
) => DuplicateNamesAnswer = (value: unknown): DuplicateNamesAnswer => {
  const answer: Record<string, unknown> | null = asObject(value);
  const kinds: Array<unknown> = Array.isArray(answer?.["kinds"])
    ? (answer!["kinds"] as Array<unknown>)
    : [];

  return {
    requireUniqueNames: answer?.["requireUniqueNames"] === true,
    kinds: kinds
      .map((value: unknown): DuplicateNamesOfKind | null => {
        const kind: Record<string, unknown> | null = asObject(value);
        const tableName: string = readText(kind?.["tableName"]);

        if (!kind || !tableName) {
          return null;
        }

        const groups: Array<DuplicateNameGroup> = (
          Array.isArray(kind["groups"]) ? kind["groups"] : []
        )
          .map(readGroup)
          .filter((group: DuplicateNameGroup | null): boolean => {
            return group !== null;
          }) as Array<DuplicateNameGroup>;

        if (groups.length === 0) {
          return null;
        }

        return {
          tableName: tableName,
          groupCount: Math.max(readCount(kind["groupCount"]), groups.length),
          groups: groups,
        };
      })
      .filter((kind: DuplicateNamesOfKind | null): boolean => {
        return kind !== null;
      }) as Array<DuplicateNamesOfKind>,
  };
};

// How many names of the answer repeat, over every kind.
export const getDuplicateNameCount: (answer: DuplicateNamesAnswer) => number = (
  answer: DuplicateNamesAnswer,
): number => {
  return answer.kinds.reduce((total: number, kind: DuplicateNamesOfKind) => {
    return total + kind.groupCount;
  }, 0);
};
