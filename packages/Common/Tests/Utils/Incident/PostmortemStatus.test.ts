import IncidentPostmortemStatus from "../../../Models/DatabaseModels/IncidentPostmortemStatus";
import {
  Gray500,
  Green,
  VeryLightGray,
  Yellow,
} from "../../../Types/BrandColors";
import ObjectID from "../../../Types/ObjectID";
import PostmortemStatusUtil, {
  COMPLETED_STATUS_FLAG,
  DEFAULT_POSTMORTEM_STATUSES,
  DRAFT_STATUS_FLAG,
  DefaultPostmortemStatus,
  NOT_STARTED_STATUS_FLAG,
  PostmortemProgress,
} from "../../../Utils/Incident/PostmortemStatus";
import { STATE_LISTS, StateListType } from "../../../Utils/StateOrder";
import { describe, expect, test } from "@jest/globals";

/*
 * How far an incident's postmortem has come, and what moves it
 * (Common/Utils/Incident/PostmortemStatus), pinned without a database. The
 * server moves postmortems with it, the Postmortems list counts and filters
 * them with it, so both read the same answers:
 *
 *   - what a status counts as - not started, in progress, done - follows
 *     from where it sits, as an incident state's does;
 *   - a new incident's postmortem starts not started, or draft when it is
 *     created with a note, or completed when that note is published;
 *   - writing the first note moves a postmortem that is not started to the
 *     draft status, publishing it moves one that is not done to the
 *     completed status, and nothing ever moves it back or over a status
 *     the same write picked.
 */

const NOT_STARTED: string = "0a000000-0000-4000-8000-000000000001";
const DRAFT: string = "0a000000-0000-4000-8000-000000000002";
const IN_REVIEW: string = "0a000000-0000-4000-8000-000000000003";
const COMPLETED: string = "0a000000-0000-4000-8000-000000000004";
const NOT_NEEDED: string = "0a000000-0000-4000-8000-000000000005";
const ASSIGNED: string = "0a000000-0000-4000-8000-000000000006";
const UNKNOWN: string = "0a000000-0000-4000-8000-0000000000ff";

interface StatusRow {
  _id: string;
  name: string;
  order: number;
  isNotStartedStatus?: boolean;
  isDraftStatus?: boolean;
  isCompletedStatus?: boolean;
  isArchived?: boolean;
}

// The four a project starts with.
const DEFAULTS: Array<StatusRow> = [
  { _id: NOT_STARTED, name: "Not Started", order: 1, isNotStartedStatus: true },
  { _id: DRAFT, name: "Draft", order: 2, isDraftStatus: true },
  { _id: COMPLETED, name: "Completed", order: 3, isCompletedStatus: true },
  { _id: NOT_NEEDED, name: "Not Needed", order: 4 },
];

// A project that added its own: Assigned before Draft, In Review after it.
const CUSTOM: Array<StatusRow> = [
  { _id: NOT_STARTED, name: "Not Started", order: 1, isNotStartedStatus: true },
  { _id: ASSIGNED, name: "Assigned", order: 2 },
  { _id: DRAFT, name: "Draft", order: 3, isDraftStatus: true },
  { _id: IN_REVIEW, name: "In Review", order: 4 },
  { _id: COMPLETED, name: "Completed", order: 5, isCompletedStatus: true },
  { _id: NOT_NEEDED, name: "Not Needed", order: 6, isArchived: true },
];

const idOf: (status: StatusRow | null) => string | null = (
  status: StatusRow | null,
): string | null => {
  return status ? status._id : null;
};

describe("the statuses a project starts with", () => {
  test("are Not Started, Draft, Completed and Not Needed, in that order", () => {
    expect(
      DEFAULT_POSTMORTEM_STATUSES.map(
        (status: DefaultPostmortemStatus): string => {
          return `${status.order}:${status.name}`;
        },
      ),
    ).toEqual(["1:Not Started", "2:Draft", "3:Completed", "4:Not Needed"]);
  });

  test("three are built in, each by its flag; Not Needed is the project's own", () => {
    expect(
      DEFAULT_POSTMORTEM_STATUSES.map(
        (status: DefaultPostmortemStatus): string | undefined => {
          return status.flag;
        },
      ),
    ).toEqual([
      NOT_STARTED_STATUS_FLAG,
      DRAFT_STATUS_FLAG,
      COMPLETED_STATUS_FLAG,
      undefined,
    ]);

    // The flags are the built-ins of the list the statuses form.
    expect(
      STATE_LISTS[StateListType.IncidentPostmortemStatus].builtIns.map(
        (builtIn: { flag: string }): string => {
          return builtIn.flag;
        },
      ),
    ).toEqual([
      NOT_STARTED_STATUS_FLAG,
      DRAFT_STATUS_FLAG,
      COMPLETED_STATUS_FLAG,
    ]);
  });

  test("are coloured gray, yellow, green and light gray", () => {
    expect(
      DEFAULT_POSTMORTEM_STATUSES.map(
        (status: DefaultPostmortemStatus): string => {
          return status.color.toString();
        },
      ),
    ).toEqual([
      Gray500.toString(),
      Yellow.toString(),
      Green.toString(),
      VeryLightGray.toString(),
    ]);
  });

  test("each says what it means in a sentence, and fits the model's columns", () => {
    const model: IncidentPostmortemStatus = new IncidentPostmortemStatus();

    for (const status of DEFAULT_POSTMORTEM_STATUSES) {
      expect(status.description).toMatch(/\.$/);
      expect(status.name.length).toBeLessThanOrEqual(100);
      expect(status.description.length).toBeLessThanOrEqual(500);
      if (status.flag) {
        expect(model.getTableColumnMetadata(status.flag)).toBeTruthy();
      }
    }
  });

  test("Not Needed sits after Completed, so it counts as done", () => {
    expect(
      PostmortemStatusUtil.getProgress({
        statuses: DEFAULTS,
        statusId: NOT_NEEDED,
      }),
    ).toBe(PostmortemProgress.Done);
  });
});

describe("what a status counts as", () => {
  test.each([
    [NOT_STARTED, PostmortemProgress.NotStarted],
    [DRAFT, PostmortemProgress.InProgress],
    [COMPLETED, PostmortemProgress.Done],
    [NOT_NEEDED, PostmortemProgress.Done],
  ])("with the defaults, %s is %s", (statusId: string, progress: string) => {
    expect(
      PostmortemStatusUtil.getProgress({ statuses: DEFAULTS, statusId }),
    ).toBe(progress);
  });

  test.each([
    [ASSIGNED, PostmortemProgress.NotStarted],
    [IN_REVIEW, PostmortemProgress.InProgress],
    [NOT_NEEDED, PostmortemProgress.Done],
  ])(
    "a project's own status counts by where it sits: %s is %s",
    (statusId: string, progress: string) => {
      expect(
        PostmortemStatusUtil.getProgress({ statuses: CUSTOM, statusId }),
      ).toBe(progress);
    },
  );

  test("no status yet is not started; a status that is none of the project's is unknown", () => {
    expect(
      PostmortemStatusUtil.getProgress({ statuses: DEFAULTS, statusId: null }),
    ).toBe(PostmortemProgress.NotStarted);
    expect(
      PostmortemStatusUtil.getProgress({
        statuses: DEFAULTS,
        statusId: undefined,
      }),
    ).toBe(PostmortemProgress.NotStarted);
    expect(
      PostmortemStatusUtil.getProgress({
        statuses: DEFAULTS,
        statusId: UNKNOWN,
      }),
    ).toBeNull();
  });

  test("ids are compared as Postgres compares uuids: whatever their case, ObjectID or text", () => {
    expect(
      PostmortemStatusUtil.getProgress({
        statuses: DEFAULTS,
        statusId: new ObjectID(COMPLETED.toUpperCase()),
      }),
    ).toBe(PostmortemProgress.Done);
  });

  test("a status moved below Completed counts as done, wherever it was before", () => {
    const moved: Array<StatusRow> = DEFAULTS.map((status: StatusRow) => {
      return status._id === DRAFT
        ? { ...status }
        : status._id === COMPLETED
          ? { ...status, order: 2 }
          : status._id === NOT_STARTED
            ? status
            : { ...status, order: 5 };
    });

    expect(
      PostmortemStatusUtil.getProgress({
        statuses: moved,
        statusId: NOT_NEEDED,
      }),
    ).toBe(PostmortemProgress.Done);
  });

  test("the statuses come top first, each with what it counts as", () => {
    expect(
      PostmortemStatusUtil.getStatusesWithProgress([...CUSTOM].reverse()).map(
        (entry: { status: StatusRow; progress: PostmortemProgress }) => {
          return `${entry.status.name}:${entry.progress}`;
        },
      ),
    ).toEqual([
      "Not Started:NotStarted",
      "Assigned:NotStarted",
      "Draft:InProgress",
      "In Review:InProgress",
      "Completed:Done",
      "Not Needed:Done",
    ]);
  });

  test("the statuses a postmortem is still owed in, and done in, top first", () => {
    expect(PostmortemStatusUtil.getOwedStatusIds(CUSTOM)).toEqual([
      NOT_STARTED,
      ASSIGNED,
      DRAFT,
      IN_REVIEW,
    ]);
    expect(PostmortemStatusUtil.getDoneStatusIds(CUSTOM)).toEqual([
      COMPLETED,
      NOT_NEEDED,
    ]);
  });

  test("the built-in statuses are found by their flags, the first from the top", () => {
    const twoDrafts: Array<StatusRow> = [
      ...DEFAULTS,
      { _id: IN_REVIEW, name: "Second Draft", order: 0, isDraftStatus: true },
    ];

    expect(idOf(PostmortemStatusUtil.getNotStartedStatus(DEFAULTS))).toBe(
      NOT_STARTED,
    );
    expect(idOf(PostmortemStatusUtil.getDraftStatus(DEFAULTS))).toBe(DRAFT);
    expect(idOf(PostmortemStatusUtil.getCompletedStatus(DEFAULTS))).toBe(
      COMPLETED,
    );
    expect(idOf(PostmortemStatusUtil.getDraftStatus(twoDrafts))).toBe(
      IN_REVIEW,
    );
    expect(PostmortemStatusUtil.getDraftStatus([])).toBeNull();
  });
});

describe("where a new incident's postmortem starts", () => {
  test("not started, with no note", () => {
    expect(
      idOf(
        PostmortemStatusUtil.getStartingStatus({
          statuses: DEFAULTS,
          postmortem: {},
        }),
      ),
    ).toBe(NOT_STARTED);
    expect(
      idOf(
        PostmortemStatusUtil.getStartingStatus({
          statuses: DEFAULTS,
          postmortem: { postmortemNote: "  \r\n\t " },
        }),
      ),
    ).toBe(NOT_STARTED);
  });

  test("draft, created with a note", () => {
    expect(
      idOf(
        PostmortemStatusUtil.getStartingStatus({
          statuses: DEFAULTS,
          postmortem: { postmortemNote: "## What happened" },
        }),
      ),
    ).toBe(DRAFT);
  });

  test("completed, created with its note published on the status page", () => {
    expect(
      idOf(
        PostmortemStatusUtil.getStartingStatus({
          statuses: DEFAULTS,
          postmortem: {
            postmortemNote: "## What happened",
            showPostmortemOnStatusPage: true,
          },
        }),
      ),
    ).toBe(COMPLETED);
  });

  test("switched on with no note, nothing is published: not started", () => {
    expect(
      idOf(
        PostmortemStatusUtil.getStartingStatus({
          statuses: DEFAULTS,
          postmortem: { showPostmortemOnStatusPage: true, postmortemNote: "" },
        }),
      ),
    ).toBe(NOT_STARTED);
  });

  test("a project with no statuses yet starts it with none", () => {
    expect(
      PostmortemStatusUtil.getStartingStatus({
        statuses: [],
        postmortem: { postmortemNote: "## A note" },
      }),
    ).toBeNull();
  });

  test("a project without one of the statuses falls back to not started", () => {
    const withoutDraft: Array<StatusRow> = DEFAULTS.filter(
      (status: StatusRow): boolean => {
        return status._id !== DRAFT;
      },
    );

    expect(
      idOf(
        PostmortemStatusUtil.getStartingStatus({
          statuses: withoutDraft,
          postmortem: { postmortemNote: "## A note" },
        }),
      ),
    ).toBe(NOT_STARTED);
  });
});

describe("what writing a postmortem does to its status", () => {
  test("its first note moves it from not started to draft", () => {
    expect(
      idOf(
        PostmortemStatusUtil.getAutomaticMove({
          statuses: DEFAULTS,
          stored: { postmortemNote: null, showPostmortemOnStatusPage: false },
          written: { postmortemNote: "## What happened" },
          statusIdBefore: NOT_STARTED,
        }),
      ),
    ).toBe(DRAFT);
  });

  test("a project's own status above Draft counts as not started, and moves too", () => {
    expect(
      idOf(
        PostmortemStatusUtil.getAutomaticMove({
          statuses: CUSTOM,
          stored: { postmortemNote: "" },
          written: { postmortemNote: "## What happened" },
          statusIdBefore: ASSIGNED,
        }),
      ),
    ).toBe(DRAFT);
  });

  test("an incident with no status yet moves to draft with its first note", () => {
    expect(
      idOf(
        PostmortemStatusUtil.getAutomaticMove({
          statuses: DEFAULTS,
          stored: { postmortemNote: null },
          written: { postmortemNote: "## A note" },
          statusIdBefore: null,
        }),
      ),
    ).toBe(DRAFT);
  });

  test("editing a written note moves nothing", () => {
    for (const statusIdBefore of [NOT_STARTED, DRAFT, IN_REVIEW, COMPLETED]) {
      expect(
        PostmortemStatusUtil.getAutomaticMove({
          statuses: CUSTOM,
          stored: { postmortemNote: "## Before" },
          written: { postmortemNote: "## After" },
          statusIdBefore: statusIdBefore,
        }),
      ).toBeNull();
    }
  });

  test("a note that says nothing - white space, line endings - is no note", () => {
    expect(
      PostmortemStatusUtil.getAutomaticMove({
        statuses: DEFAULTS,
        stored: { postmortemNote: "" },
        written: { postmortemNote: " \r\n \n\t" },
        statusIdBefore: NOT_STARTED,
      }),
    ).toBeNull();
  });

  test("a first note never moves a postmortem already under way or done", () => {
    for (const statusIdBefore of [DRAFT, IN_REVIEW, COMPLETED, NOT_NEEDED]) {
      expect(
        PostmortemStatusUtil.getAutomaticMove({
          statuses: CUSTOM,
          stored: { postmortemNote: "" },
          written: { postmortemNote: "## A note" },
          statusIdBefore: statusIdBefore,
        }),
      ).toBeNull();
    }
  });

  test("clearing the note moves nothing back", () => {
    expect(
      PostmortemStatusUtil.getAutomaticMove({
        statuses: DEFAULTS,
        stored: { postmortemNote: "## A note" },
        written: { postmortemNote: null },
        statusIdBefore: DRAFT,
      }),
    ).toBeNull();
  });

  test("an update that writes no note and no switch moves nothing", () => {
    expect(
      PostmortemStatusUtil.getAutomaticMove({
        statuses: DEFAULTS,
        stored: { postmortemNote: "" },
        written: { title: "Renamed" },
        statusIdBefore: NOT_STARTED,
      }),
    ).toBeNull();
  });
});

describe("what publishing a postmortem does to its status", () => {
  test("publishing moves a postmortem not done to completed", () => {
    for (const statusIdBefore of [NOT_STARTED, ASSIGNED, DRAFT, IN_REVIEW]) {
      expect(
        idOf(
          PostmortemStatusUtil.getAutomaticMove({
            statuses: CUSTOM,
            stored: {
              postmortemNote: "## A note",
              showPostmortemOnStatusPage: false,
            },
            written: { showPostmortemOnStatusPage: true },
            statusIdBefore: statusIdBefore,
          }),
        ),
      ).toBe(COMPLETED);
    }
  });

  test("written and published at once, it goes straight to completed", () => {
    expect(
      idOf(
        PostmortemStatusUtil.getAutomaticMove({
          statuses: DEFAULTS,
          stored: { postmortemNote: "", showPostmortemOnStatusPage: false },
          written: {
            postmortemNote: "## A note",
            showPostmortemOnStatusPage: true,
          },
          statusIdBefore: NOT_STARTED,
        }),
      ),
    ).toBe(COMPLETED);
  });

  test("a switch written as the database stores it publishes too", () => {
    expect(
      idOf(
        PostmortemStatusUtil.getAutomaticMove({
          statuses: DEFAULTS,
          stored: { postmortemNote: "## A note" },
          written: { showPostmortemOnStatusPage: "true" },
          statusIdBefore: DRAFT,
        }),
      ),
    ).toBe(COMPLETED);
  });

  test("a postmortem done already stays where it is", () => {
    expect(
      PostmortemStatusUtil.getAutomaticMove({
        statuses: DEFAULTS,
        stored: { postmortemNote: "## A note" },
        written: { showPostmortemOnStatusPage: true },
        statusIdBefore: NOT_NEEDED,
      }),
    ).toBeNull();
    expect(
      PostmortemStatusUtil.getAutomaticMove({
        statuses: DEFAULTS,
        stored: { postmortemNote: "## A note" },
        written: { showPostmortemOnStatusPage: true },
        statusIdBefore: COMPLETED,
      }),
    ).toBeNull();
  });

  test("switched on with no note, nothing is published, so nothing moves", () => {
    expect(
      PostmortemStatusUtil.getAutomaticMove({
        statuses: DEFAULTS,
        stored: { postmortemNote: "", showPostmortemOnStatusPage: false },
        written: { showPostmortemOnStatusPage: true },
        statusIdBefore: NOT_STARTED,
      }),
    ).toBeNull();
  });

  test("saving a published postmortem again moves nothing", () => {
    expect(
      PostmortemStatusUtil.getAutomaticMove({
        statuses: DEFAULTS,
        stored: {
          postmortemNote: "## A note",
          showPostmortemOnStatusPage: true,
        },
        written: {
          postmortemNote: "## A note, edited",
          showPostmortemOnStatusPage: true,
        },
        statusIdBefore: DRAFT,
      }),
    ).toBeNull();
  });

  test("taking it off the status page moves nothing back", () => {
    expect(
      PostmortemStatusUtil.getAutomaticMove({
        statuses: DEFAULTS,
        stored: {
          postmortemNote: "## A note",
          showPostmortemOnStatusPage: true,
        },
        written: { showPostmortemOnStatusPage: false },
        statusIdBefore: COMPLETED,
      }),
    ).toBeNull();
  });

  test("an incident the read before the write did not see counts as unpublished before", () => {
    expect(
      idOf(
        PostmortemStatusUtil.getAutomaticMove({
          statuses: DEFAULTS,
          stored: undefined,
          written: {
            postmortemNote: "## A note",
            showPostmortemOnStatusPage: true,
          },
          statusIdBefore: DRAFT,
        }),
      ),
    ).toBe(COMPLETED);
  });
});

describe("what OneUptime never does", () => {
  test("it never moves a status the same write picked, under either name", () => {
    for (const written of [
      { postmortemNote: "## A note", postmortemStatusId: IN_REVIEW },
      { postmortemNote: "## A note", postmortemStatus: { _id: IN_REVIEW } },
      { showPostmortemOnStatusPage: true, postmortemStatusId: NOT_NEEDED },
    ]) {
      expect(
        PostmortemStatusUtil.getAutomaticMove({
          statuses: CUSTOM,
          stored: { postmortemNote: "" },
          written: written as Record<string, unknown>,
          statusIdBefore: NOT_STARTED,
        }),
      ).toBeNull();
    }
  });

  test("it leaves alone a status that is none of the project's", () => {
    expect(
      PostmortemStatusUtil.getAutomaticMove({
        statuses: DEFAULTS,
        stored: { postmortemNote: "" },
        written: { postmortemNote: "## A note" },
        statusIdBefore: UNKNOWN,
      }),
    ).toBeNull();
  });

  test("it moves nothing in a project with no statuses", () => {
    expect(
      PostmortemStatusUtil.getAutomaticMove({
        statuses: [],
        stored: { postmortemNote: "" },
        written: {
          postmortemNote: "## A note",
          showPostmortemOnStatusPage: true,
        },
        statusIdBefore: null,
      }),
    ).toBeNull();
  });

  test("it never answers with the status the postmortem is already in", () => {
    const draftIsCompleted: Array<StatusRow> = [
      {
        _id: NOT_STARTED,
        name: "Not Started",
        order: 1,
        isNotStartedStatus: true,
      },
      {
        _id: DRAFT,
        name: "Done Either Way",
        order: 2,
        isDraftStatus: true,
        isCompletedStatus: true,
      },
    ];

    expect(
      PostmortemStatusUtil.getAutomaticMove({
        statuses: draftIsCompleted,
        stored: { postmortemNote: "## A note" },
        written: { showPostmortemOnStatusPage: true },
        statusIdBefore: DRAFT,
      }),
    ).toBeNull();
  });
});

describe("the helpers the server reads a write with", () => {
  test("a write names a status under either name, null included", () => {
    expect(
      PostmortemStatusUtil.isStatusWrittenBy({ postmortemStatusId: DRAFT }),
    ).toBe(true);
    expect(
      PostmortemStatusUtil.isStatusWrittenBy({ postmortemStatus: null }),
    ).toBe(true);
    expect(
      PostmortemStatusUtil.isStatusWrittenBy({ postmortemNote: "x" }),
    ).toBe(false);
    expect(PostmortemStatusUtil.isStatusWrittenBy(undefined)).toBe(false);
    expect(
      PostmortemStatusUtil.isStatusWrittenBy({ postmortemStatusId: undefined }),
    ).toBe(false);
  });

  test("a note is started only by a write that gives a blank one its first words", () => {
    expect(
      PostmortemStatusUtil.isNoteStartedBy({
        stored: { postmortemNote: null },
        written: { postmortemNote: "x" },
      }),
    ).toBe(true);
    expect(
      PostmortemStatusUtil.isNoteStartedBy({
        stored: { postmortemNote: "y" },
        written: { postmortemNote: "x" },
      }),
    ).toBe(false);
    expect(
      PostmortemStatusUtil.isNoteStartedBy({
        stored: { postmortemNote: null },
        written: {},
      }),
    ).toBe(false);
    expect(
      PostmortemStatusUtil.isNoteStartedBy({
        stored: undefined,
        written: { postmortemNote: "x" },
      }),
    ).toBe(true);
  });

  test("ids are compared lower case and trimmed; nothing is the empty string", () => {
    expect(PostmortemStatusUtil.toId(` ${DRAFT.toUpperCase()} `)).toBe(DRAFT);
    expect(PostmortemStatusUtil.toId(null)).toBe("");
    expect(PostmortemStatusUtil.toId(new ObjectID(DRAFT))).toBe(DRAFT);
  });

  test("models read like their JSON", () => {
    const models: Array<IncidentPostmortemStatus> = DEFAULTS.map(
      (row: StatusRow): IncidentPostmortemStatus => {
        const model: IncidentPostmortemStatus = new IncidentPostmortemStatus();
        model._id = row._id;
        model.name = row.name;
        model.order = row.order;
        model.isNotStartedStatus = Boolean(row.isNotStartedStatus);
        model.isDraftStatus = Boolean(row.isDraftStatus);
        model.isCompletedStatus = Boolean(row.isCompletedStatus);
        return model;
      },
    );

    expect(PostmortemStatusUtil.getCompletedStatus(models)?._id).toBe(
      COMPLETED,
    );
    expect(
      PostmortemStatusUtil.getProgress({
        statuses: models,
        statusId: NOT_NEEDED,
      }),
    ).toBe(PostmortemProgress.Done);
  });
});
