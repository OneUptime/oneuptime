import { JSONObject } from "../JSON";

/*
 * WHICH RECORDS OF A PROJECT SHARE A NAME (#9746): what a list asks the
 * server, to mark them.
 *
 * Since #9674 (teams) and #9742 (on-call policies and schedules) a record
 * cannot take a name another record of its kind in the project has. The
 * records that shared one before keep it - no data migration renames them,
 * since whatever finds them by name would break - and can be renamed apart.
 * Nothing said which they were: an admin found out in a picker, where two
 * "Tenants" look alike. Their lists now mark them, read from the server
 * (UniqueNameInProject.findRecordsSharingName): a list's page may hold only
 * one of two twins.
 *
 * GET /shared-names/:kind answers, for the request's project, the groups of
 * records the reader may read whose names read as one name. React-free and
 * server-safe: the server answers with these, the Dashboard reads them.
 */

// The kinds whose names are one record's in a project, as the route names them.
export enum SharedNameKind {
  Team = "team",
  OnCallPolicy = "on-call-policy",
  OnCallSchedule = "on-call-schedule",
}

export const SHARED_NAMES_ROUTE: string = "/shared-names";

// The route for one kind.
export const getSharedNamesRoute: (kind: SharedNameKind) => string = (
  kind: SharedNameKind,
): string => {
  return `${SHARED_NAMES_ROUTE}/${kind}`;
};

export const isSharedNameKind: (value: unknown) => value is SharedNameKind = (
  value: unknown,
): value is SharedNameKind => {
  return Object.values(SharedNameKind).includes(value as SharedNameKind);
};

/*
 * The answer: each group the ids of the records whose names read alike,
 * in lower case. A group may hold one record: the reader may not read the
 * other, which still holds its name.
 */
export interface SharedNamesAnswer {
  groups: Array<Array<string>>;
}

export const toSharedNamesAnswerJSON: (
  answer: SharedNamesAnswer,
) => JSONObject = (answer: SharedNamesAnswer): JSONObject => {
  return { groups: answer.groups };
};

// Reads an answer back; anything that is not one reads as no groups.
export const readSharedNamesAnswer: (value: unknown) => SharedNamesAnswer = (
  value: unknown,
): SharedNamesAnswer => {
  const groups: unknown =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)["groups"]
      : undefined;

  if (!Array.isArray(groups)) {
    return { groups: [] };
  }

  return {
    groups: groups
      .filter((group: unknown): group is Array<unknown> => {
        return Array.isArray(group);
      })
      .map((group: Array<unknown>): Array<string> => {
        return group
          .filter((id: unknown): id is string => {
            return typeof id === "string" && id.length > 0;
          })
          .map((id: string): string => {
            return id.toLowerCase();
          });
      })
      .filter((group: Array<string>): boolean => {
        return group.length > 0;
      }),
  };
};

// The ids of every record of the answer, for a list to mark its rows by.
export const getSharedNameRecordIds: (
  answer: SharedNamesAnswer,
) => Set<string> = (answer: SharedNamesAnswer): Set<string> => {
  const ids: Set<string> = new Set<string>();

  for (const group of answer.groups) {
    for (const id of group) {
      ids.add(id.toLowerCase());
    }
  }

  return ids;
};
