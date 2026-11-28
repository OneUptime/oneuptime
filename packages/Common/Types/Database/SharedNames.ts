import { JSONObject } from "../JSON";

/*
 * WHICH RECORDS OF A PROJECT SHARE A NAME (#9746): what a list asks the
 * server, to mark them.
 *
 * Since #9674 (teams), #9723 (labels, renamed) and #9742 (on-call policies
 * and schedules) a record cannot take a name another record of its kind in
 * the project has. The records that shared one before keep it - no data
 * migration renames them, since whatever finds them by name would break -
 * and can be renamed apart. Nothing said which they were: an admin found
 * out in a picker, where two "Tenants" look alike. Their lists now mark
 * them, read from the server (UniqueNameInProject.findRecordsSharingName):
 * a list's page may hold only one of two twins. Labels are marked too
 * (#9856), on Project Settings > Labels.
 *
 * GET /shared-names/:kind answers, for the request's project, the groups of
 * records the reader may read whose names read as one name. React-free and
 * server-safe: the server answers with these, the Dashboard reads them.
 *
 * EVERY KIND REQUIRE UNIQUE NAMES HOLDS (#11021). The kinds a model marks
 * @UniqueNameWhenRequired - monitors, templates, API keys, pipelines and
 * the rest - are asked for by their table's name: GET
 * /shared-names/Monitor. Every list of them marks its twins from that
 * answer (Common/UI/Components/ModelTable/SharedNameMarks), so a kind
 * marked tomorrow is marked in its list without a line of its own. Their
 * answer differs from the four kinds' in two ways:
 *
 *   - a group holds two records the reader may read, or more: a mark never
 *     says that a record the reader may not read has the name. (The four
 *     kinds' names are one record's always, so a create onto one says as
 *     much, and their group may hold the one record the reader sees.)
 *   - it says when each record was made (createdAt), by which a list tells
 *     twins apart.
 *
 * A kind with an archive counts its records in service and its archived
 * ones apart, as each list shows the one or the other.
 */

// The kinds whose names are one record's in a project, as the route names them.
export enum SharedNameKind {
  Team = "team",
  Label = "label",
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

/*
 * The route for a kind Require Unique Names holds, by its table's name:
 * "/shared-names/Monitor" (#11021).
 */
export const getSharedNamesRouteOfTable: (tableName: string) => string = (
  tableName: string,
): string => {
  return `${SHARED_NAMES_ROUTE}/${encodeURIComponent(tableName)}`;
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
  /*
   * When each record of the groups was made, by its id in lower case, as
   * the API writes a date: for a kind Require Unique Names holds, whose
   * list tells twins apart by it (#11021). Left out for the four kinds.
   */
  createdAt?: Record<string, string> | undefined;
}

export const toSharedNamesAnswerJSON: (
  answer: SharedNamesAnswer,
) => JSONObject = (answer: SharedNamesAnswer): JSONObject => {
  return {
    groups: answer.groups,
    ...(answer.createdAt ? { createdAt: answer.createdAt } : {}),
  };
};

// When each record was made, as an answer writes it: only ids and dates as text.
const readCreatedAt: (value: unknown) => Record<string, string> | undefined = (
  value: unknown,
): Record<string, string> | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const createdAt: Record<string, string> = {};

  for (const [id, date] of Object.entries(value as Record<string, unknown>)) {
    if (id && typeof date === "string" && date) {
      createdAt[id.toLowerCase()] = date;
    }
  }

  return createdAt;
};

// Reads an answer back; anything that is not one reads as no groups.
export const readSharedNamesAnswer: (value: unknown) => SharedNamesAnswer = (
  value: unknown,
): SharedNamesAnswer => {
  const answer: Record<string, unknown> | undefined =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : undefined;
  const groups: unknown = answer ? answer["groups"] : undefined;

  if (!Array.isArray(groups)) {
    return { groups: [] };
  }

  const createdAt: Record<string, string> | undefined = readCreatedAt(
    answer?.["createdAt"],
  );

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
    ...(createdAt ? { createdAt: createdAt } : {}),
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
