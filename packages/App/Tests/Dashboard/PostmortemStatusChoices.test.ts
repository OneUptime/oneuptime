import { describe, expect, test } from "@jest/globals";
import {
  DEFAULT_POSTMORTEM_STATUS_WORDS,
  PostmortemStatusChoice,
  getCurrentPostmortemStatusChoice,
  getPickablePostmortemStatusChoices,
  isPostmortemOwed,
  toPostmortemStatusChoices,
} from "../../FeatureSet/Dashboard/src/Components/Postmortem/PostmortemStatusChoices";
import IncidentPostmortemStatus from "Common/Models/DatabaseModels/IncidentPostmortemStatus";
import { Gray500 } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import {
  DEFAULT_POSTMORTEM_STATUSES,
  DefaultPostmortemStatus,
  PostmortemProgress,
} from "Common/Utils/Incident/PostmortemStatus";

/*
 * A project's postmortem statuses as the Dashboard offers them: the pill on
 * an incident's Postmortem page and on every row of the Postmortems list,
 * the menu that moves it, the list's tiles and its Postmortem Status chip
 * all draw from these choices. What each status counts as - not started,
 * in progress, done - is the server's rule (Common/Utils/Incident/
 * PostmortemStatus), read here from the statuses as the API sends them.
 */

const NOT_STARTED: string = "5b000000-0000-4000-8000-000000000001";
const ASSIGNED: string = "5b000000-0000-4000-8000-000000000002";
const DRAFT: string = "5b000000-0000-4000-8000-000000000003";
const IN_REVIEW: string = "5b000000-0000-4000-8000-000000000004";
const COMPLETED: string = "5b000000-0000-4000-8000-000000000005";
const NOT_NEEDED: string = "5b000000-0000-4000-8000-000000000006";
const OLD_PROCESS: string = "5b000000-0000-4000-8000-000000000007";

// A status as the API's JSON carries it: its colour as a Color's JSON.
function json(
  id: string,
  name: string,
  order: number,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    _id: id,
    name: name,
    order: order,
    description: `${name}, described.`,
    color: { _type: "Color", value: "#123456" },
    isNotStartedStatus: false,
    isDraftStatus: false,
    isCompletedStatus: false,
    isArchived: false,
    ...extra,
  };
}

/*
 * A project that made the list its own: Assigned before Draft, In Review
 * after it, and an archived status nobody moves a postmortem to any more.
 * Sent in no particular order, as a list read without a sort would be.
 */
const PROJECT_STATUSES: Array<Record<string, unknown>> = [
  json(COMPLETED, "Completed", 5, { isCompletedStatus: true }),
  json(NOT_STARTED, "Not Started", 1, { isNotStartedStatus: true }),
  json(IN_REVIEW, "In Review", 4),
  json(OLD_PROCESS, "Old Process", 7, { isArchived: true }),
  json(DRAFT, "Draft", 3, { isDraftStatus: true }),
  json(NOT_NEEDED, "Not Needed", 6),
  json(ASSIGNED, "Assigned", 2),
];

function choices(): Array<PostmortemStatusChoice> {
  return toPostmortemStatusChoices(PROJECT_STATUSES);
}

function idsOf(list: Array<PostmortemStatusChoice>): Array<string> {
  return list.map((choice: PostmortemStatusChoice): string => {
    return choice.id;
  });
}

function choiceFor(id: string): PostmortemStatusChoice {
  const found: PostmortemStatusChoice | undefined = choices().find(
    (choice: PostmortemStatusChoice): boolean => {
      return choice.id === id;
    },
  );

  if (!found) {
    throw new Error(`No choice for ${id}`);
  }

  return found;
}

describe("a project's statuses, as the Dashboard offers them", () => {
  test("come top of the list first, whatever order they were read in", () => {
    expect(idsOf(choices())).toEqual([
      NOT_STARTED,
      ASSIGNED,
      DRAFT,
      IN_REVIEW,
      COMPLETED,
      NOT_NEEDED,
      OLD_PROCESS,
    ]);
  });

  test("each counts as what its place makes it: above Draft not started, from Draft in progress, from Completed done", () => {
    expect(
      choices().map((choice: PostmortemStatusChoice): string => {
        return `${choice.name}:${choice.progress}`;
      }),
    ).toEqual([
      `Not Started:${PostmortemProgress.NotStarted}`,
      `Assigned:${PostmortemProgress.NotStarted}`,
      `Draft:${PostmortemProgress.InProgress}`,
      `In Review:${PostmortemProgress.InProgress}`,
      `Completed:${PostmortemProgress.Done}`,
      `Not Needed:${PostmortemProgress.Done}`,
      `Old Process:${PostmortemProgress.Done}`,
    ]);
  });

  test("carry the name, the colour and the description the pills and tiles draw", () => {
    expect(choiceFor(IN_REVIEW)).toEqual({
      id: IN_REVIEW,
      name: "In Review",
      color: "#123456",
      description: "In Review, described.",
      isArchived: false,
      progress: PostmortemProgress.InProgress,
    });
  });

  test("an archived status is still a choice: incidents in it keep it, and the chip finds them", () => {
    expect(choiceFor(OLD_PROCESS).isArchived).toBe(true);
  });

  test("models read like their JSON", () => {
    const model: IncidentPostmortemStatus = new IncidentPostmortemStatus();
    model._id = DRAFT;
    model.name = "Draft";
    model.order = 2;
    model.description = "The postmortem is being written.";
    model.color = new Color("#facc15");
    model.isDraftStatus = true;

    const notStarted: IncidentPostmortemStatus = new IncidentPostmortemStatus();
    notStarted._id = NOT_STARTED;
    notStarted.name = "Not Started";
    notStarted.order = 1;
    notStarted.isNotStartedStatus = true;

    expect(toPostmortemStatusChoices([model, notStarted])).toEqual([
      {
        id: NOT_STARTED,
        name: "Not Started",
        color: Gray500.toString(),
        description: "",
        isArchived: false,
        progress: PostmortemProgress.NotStarted,
      },
      {
        id: DRAFT,
        name: "Draft",
        color: "#facc15",
        description: "The postmortem is being written.",
        isArchived: false,
        progress: PostmortemProgress.InProgress,
      },
    ]);
  });

  test("a colour sent as text is drawn as it is; none is gray", () => {
    expect(
      toPostmortemStatusChoices([
        json(NOT_STARTED, "Not Started", 1, { color: "#ff0000" }),
        json(DRAFT, "Draft", 2, { color: null }),
      ]).map((choice: PostmortemStatusChoice): string => {
        return choice.color;
      }),
    ).toEqual(["#ff0000", Gray500.toString()]);
  });

  test("names and descriptions are trimmed; a status with no id or no name is left out", () => {
    expect(
      toPostmortemStatusChoices([
        json(NOT_STARTED, "  Not Started  ", 1, {
          description: "  Nobody has written it.  ",
        }),
        json(DRAFT, "   ", 2),
        json("", "Nameless id", 3),
        null,
        "text",
      ]),
    ).toEqual([
      {
        id: NOT_STARTED,
        name: "Not Started",
        color: "#123456",
        description: "Nobody has written it.",
        isArchived: false,
        progress: PostmortemProgress.NotStarted,
      },
    ]);
  });

  test("a project whose statuses could not be read has no choices", () => {
    expect(toPostmortemStatusChoices([])).toEqual([]);
  });
});

describe("the status a postmortem is shown in", () => {
  test("its own, found whatever the case of its id", () => {
    expect(
      getCurrentPostmortemStatusChoice({
        choices: choices(),
        statusId: IN_REVIEW.toUpperCase(),
      })?.name,
    ).toBe("In Review");
  });

  test("an archived one it is in is still shown", () => {
    expect(
      getCurrentPostmortemStatusChoice({
        choices: choices(),
        statusId: OLD_PROCESS,
      })?.name,
    ).toBe("Old Process");
  });

  test("none yet - an incident from before statuses - shows the not started status, which is what it counts as", () => {
    for (const statusId of [null, undefined, ""]) {
      expect(
        getCurrentPostmortemStatusChoice({
          choices: choices(),
          statusId: statusId,
        })?.id,
      ).toBe(NOT_STARTED);
    }
  });

  test("a status that is none of the project's shows nothing rather than a wrong name", () => {
    expect(
      getCurrentPostmortemStatusChoice({
        choices: choices(),
        statusId: "5b000000-0000-4000-8000-0000000000ff",
      }),
    ).toBeNull();
  });

  test("nothing while the statuses are not known", () => {
    expect(
      getCurrentPostmortemStatusChoice({ choices: [], statusId: DRAFT }),
    ).toBeNull();
    expect(
      getCurrentPostmortemStatusChoice({ choices: [], statusId: null }),
    ).toBeNull();
  });
});

describe("the statuses a postmortem can be moved to", () => {
  test("every one not archived, top first: the server refuses an archived one", () => {
    expect(idsOf(getPickablePostmortemStatusChoices(choices()))).toEqual([
      NOT_STARTED,
      ASSIGNED,
      DRAFT,
      IN_REVIEW,
      COMPLETED,
      NOT_NEEDED,
    ]);
  });

  test("none while the statuses are not known", () => {
    expect(getPickablePostmortemStatusChoices([])).toEqual([]);
  });
});

describe("whether a postmortem is still owed", () => {
  test("not started and in progress are owed; done is not", () => {
    expect(
      choices().map((choice: PostmortemStatusChoice): string => {
        return `${choice.name}:${isPostmortemOwed(choice)}`;
      }),
    ).toEqual([
      "Not Started:true",
      "Assigned:true",
      "Draft:true",
      "In Review:true",
      "Completed:false",
      "Not Needed:false",
      "Old Process:false",
    ]);
  });

  test("a status nobody knows is not called owed", () => {
    expect(isPostmortemOwed(null)).toBe(false);
    expect(isPostmortemOwed(undefined)).toBe(false);
  });
});

describe("the words of the statuses a project starts with", () => {
  /*
   * A pill and a tile look a status's name and description up, so a
   * project that kept the four it started with reads them in its own
   * language. The keys must be the defaults' words exactly, in order.
   */
  test("are each default's name and description, in the defaults' order", () => {
    expect(DEFAULT_POSTMORTEM_STATUS_WORDS).toEqual(
      DEFAULT_POSTMORTEM_STATUSES.flatMap(
        (status: DefaultPostmortemStatus): Array<string> => {
          return [status.name, status.description];
        },
      ),
    );
  });
});
