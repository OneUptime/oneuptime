import { Gray500 } from "Common/Types/BrandColors";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import PostmortemStatusUtil, {
  PostmortemProgress,
} from "Common/Utils/Incident/PostmortemStatus";

/*
 * A project's postmortem statuses as the Dashboard offers them - on an
 * incident's Postmortem page, on every row of the Postmortems list, in its
 * filter and in its counts - read from the statuses as the API returns them
 * (IncidentPostmortemStatus models or their JSON). What each counts as -
 * not started, in progress or done - follows from where it sits
 * (Common/Utils/Incident/PostmortemStatus), as on the server.
 *
 * React-free, and free of ModelAPI, so App tests can pin it without a
 * renderer.
 */
export interface PostmortemStatusChoice {
  id: string;
  name: string;
  // A colour the pills and dots can draw: the status's own, else gray.
  color: string;
  description: string;
  isArchived: boolean;
  progress: PostmortemProgress;
}

const readText: (value: unknown) => string = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "object") {
    // A Color, or its JSON ({ _type: "Color", value: "#..." }).
    const record: Record<string, unknown> = value as Record<string, unknown>;

    if (typeof record["value"] === "string") {
      return record["value"] as string;
    }
  }

  return String(value);
};

const readId: (status: unknown) => string = (status: unknown): string => {
  if (!status || typeof status !== "object") {
    return "";
  }

  const record: Record<string, unknown> = status as Record<string, unknown>;

  return readText(record["_id"] ?? record["id"]);
};

/*
 * Every status, top of the list first, with what it counts as. Archived ones
 * are among them: an incident in one keeps it, and a list filters by it.
 */
export const toPostmortemStatusChoices: (
  statuses: Array<unknown>,
) => Array<PostmortemStatusChoice> = (
  statuses: Array<unknown>,
): Array<PostmortemStatusChoice> => {
  return PostmortemStatusUtil.getStatusesWithProgress(statuses)
    .map(
      (entry: {
        status: unknown;
        progress: PostmortemProgress;
      }): PostmortemStatusChoice | null => {
        const record: Record<string, unknown> =
          entry.status && typeof entry.status === "object"
            ? (entry.status as Record<string, unknown>)
            : {};

        const id: string = readId(entry.status);
        const name: string = readText(record["name"]).trim();

        if (!id || !name) {
          return null;
        }

        return {
          id: id,
          name: name,
          color: readText(record["color"]) || Gray500.toString(),
          description: readText(record["description"]).trim(),
          isArchived: record["isArchived"] === true,
          progress: entry.progress,
        };
      },
    )
    .filter(
      (
        choice: PostmortemStatusChoice | null,
      ): choice is PostmortemStatusChoice => {
        return choice !== null;
      },
    );
};

const isSameId: (a: string, b: string | null | undefined) => boolean = (
  a: string,
  b: string | null | undefined,
): boolean => {
  return Boolean(b) && a.toLowerCase() === (b || "").toString().toLowerCase();
};

/*
 * The status a postmortem is shown in: its own, or - for an incident from
 * before statuses that has none yet - the not started status, which is what
 * it counts as. Null while the statuses are not known.
 */
export const getCurrentPostmortemStatusChoice: (data: {
  choices: Array<PostmortemStatusChoice>;
  statusId: string | null | undefined;
}) => PostmortemStatusChoice | null = (data: {
  choices: Array<PostmortemStatusChoice>;
  statusId: string | null | undefined;
}): PostmortemStatusChoice | null => {
  if (data.statusId) {
    return (
      data.choices.find((choice: PostmortemStatusChoice): boolean => {
        return isSameId(choice.id, data.statusId);
      }) || null
    );
  }

  return (
    data.choices.find((choice: PostmortemStatusChoice): boolean => {
      return choice.progress === PostmortemProgress.NotStarted;
    }) || null
  );
};

/*
 * The statuses a postmortem can be moved to, top first: every status that
 * is not archived (the server refuses an archived one). The one it is in
 * stays on the list, ticked.
 */
export const getPickablePostmortemStatusChoices: (
  choices: Array<PostmortemStatusChoice>,
) => Array<PostmortemStatusChoice> = (
  choices: Array<PostmortemStatusChoice>,
): Array<PostmortemStatusChoice> => {
  return choices.filter((choice: PostmortemStatusChoice): boolean => {
    return !choice.isArchived;
  });
};

// Whether a postmortem in this status is still owed: not started, or in progress.
export const isPostmortemOwed: (
  choice: PostmortemStatusChoice | null | undefined,
) => boolean = (choice: PostmortemStatusChoice | null | undefined): boolean => {
  return Boolean(choice) && choice!.progress !== PostmortemProgress.Done;
};

/*
 * The names and descriptions of the four statuses a project starts with
 * (Common/Utils/Incident/PostmortemStatus.DEFAULT_POSTMORTEM_STATUSES), as
 * English keys: a pill and a tile look a status's words up, so a project
 * that kept them reads them in its own language, and one that renamed them
 * reads its own words. PostmortemStatusChoices.test holds this list to the
 * defaults.
 */
export const DEFAULT_POSTMORTEM_STATUS_WORDS: Array<string> = [
  translationKey("Not Started"),
  translationKey("Nobody has written this postmortem yet."),
  translationKey("Draft"),
  translationKey("The postmortem is being written."),
  translationKey("Completed"),
  translationKey("The postmortem is written and done."),
  translationKey("Not Needed"),
  translationKey("This incident does not need a postmortem."),
];
