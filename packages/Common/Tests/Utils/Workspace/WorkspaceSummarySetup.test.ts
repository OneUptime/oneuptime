import { describe, expect, test } from "@jest/globals";
import BadDataException from "../../../Types/Exception/BadDataException";
import WorkspaceSummarySetup, {
  WORKSPACE_SUMMARY_NO_CHANNELS_REASON,
  WORKSPACE_SUMMARY_NO_ITEMS_REASON,
  WORKSPACE_SUMMARY_NO_PROJECT_REASON,
  WorkspaceSummaryNotSendableException,
} from "../../../Utils/Workspace/WorkspaceSummarySetup";

/*
 * #7116: WHAT A WORKSPACE SUMMARY NEEDS BEFORE IT CAN BE SENT AT ALL - a
 * project, a channel to post in, something to include - read the same way
 * by the service that stores a summary, the report worker and the
 * dashboard's form (WorkspaceSummarySetup).
 */

describe("readChannelNames: the channels a summary names", () => {
  test("a list's names, each trimmed, the blank ones left out, in their order", () => {
    expect(
      WorkspaceSummarySetup.readChannelNames([
        " #ops ",
        "",
        "   ",
        "engineering",
        "#ops",
      ]),
    ).toEqual(["#ops", "engineering", "#ops"]);
  });

  test("REGRESSION: the text the dashboard's edit form saved them as is the names between its commas - not a channel per letter", () => {
    expect(
      WorkspaceSummarySetup.readChannelNames("#ops, engineering ,, #alerts,"),
    ).toEqual(["#ops", "engineering", "#alerts"]);
    expect(WorkspaceSummarySetup.readChannelNames("#ops")).toEqual(["#ops"]);
  });

  test("text of commas and spaces names none", () => {
    expect(WorkspaceSummarySetup.readChannelNames(" , ,")).toEqual([]);
    expect(WorkspaceSummarySetup.readChannelNames("")).toEqual([]);
  });

  test("anything but a list or a text names none, and a list's other values are left out", () => {
    for (const value of [undefined, null, 7, true, { name: "#ops" }]) {
      expect(WorkspaceSummarySetup.readChannelNames(value)).toEqual([]);
    }

    expect(
      WorkspaceSummarySetup.readChannelNames([
        "#ops",
        7,
        null,
        { name: "#x" },
        ["#y"],
      ]),
    ).toEqual(["#ops"]);
  });
});

describe("readSummaryItems: what a summary includes", () => {
  test("a list's items, each trimmed, the blank ones left out", () => {
    expect(
      WorkspaceSummarySetup.readSummaryItems([
        "Total Count",
        " ",
        " Severity Breakdown ",
      ]),
    ).toEqual(["Total Count", "Severity Breakdown"]);
  });

  test("one text is one item - never split, as an item's name has spaces", () => {
    expect(WorkspaceSummarySetup.readSummaryItems("List with Links")).toEqual([
      "List with Links",
    ]);
    expect(WorkspaceSummarySetup.readSummaryItems("  ")).toEqual([]);
  });

  test("an empty list, or anything else, includes nothing", () => {
    for (const value of [[], undefined, null, 3, { All: true }]) {
      expect(WorkspaceSummarySetup.readSummaryItems(value)).toEqual([]);
    }
  });
});

describe("getSendProblem: why a summary cannot be sent as it is set up", () => {
  const READY: {
    hasProject: boolean;
    channelNames: Array<string>;
    summaryItems: Array<string>;
  } = {
    hasProject: true,
    channelNames: ["#ops"],
    summaryItems: ["All"],
  };

  test("a summary with a project, a channel and something to include: none", () => {
    expect(WorkspaceSummarySetup.getSendProblem(READY)).toBeNull();
  });

  /*
   * A person reads the channel and item problems - the summary form's
   * refusal, Send Test Now's Test Failed, the Notification Logs' Error row -
   * so they say what is missing and where it is picked. They were "No
   * channel names configured for summary" and "No summary items selected".
   */
  test("each problem in words a person reads where they meet them: what is missing, and where it is picked", () => {
    expect(
      WorkspaceSummarySetup.getSendProblem({ ...READY, hasProject: false }),
    ).toBe("Summary project ID not found");
    expect(
      WorkspaceSummarySetup.getSendProblem({ ...READY, channelNames: [] }),
    ).toBe("The summary has no channel to post in.");
    expect(
      WorkspaceSummarySetup.getSendProblem({ ...READY, summaryItems: [] }),
    ).toBe("The summary has no items picked under What to Include.");
  });

  test("asked in sendSummary's order: the project, then the channels, then the items", () => {
    expect(
      WorkspaceSummarySetup.getSendProblem({
        hasProject: false,
        channelNames: [],
        summaryItems: [],
      }),
    ).toBe(WORKSPACE_SUMMARY_NO_PROJECT_REASON);
    expect(
      WorkspaceSummarySetup.getSendProblem({
        hasProject: true,
        channelNames: [],
        summaryItems: [],
      }),
    ).toBe(WORKSPACE_SUMMARY_NO_CHANNELS_REASON);
  });
});

describe("normalizeWrite: a create or an update of a summary", () => {
  test("its channel names and items are written back as the lists they name", () => {
    const write: Record<string, unknown> = {
      name: "Daily incidents",
      channelNames: "#ops, engineering",
      summaryItems: [" Total Count ", ""],
    };

    expect(WorkspaceSummarySetup.normalizeWrite(write)).toBeNull();
    expect(write).toEqual({
      name: "Daily incidents",
      channelNames: ["#ops", "engineering"],
      summaryItems: ["Total Count"],
    });
  });

  test("blank-only channels, none, or null: refused as having no channel", () => {
    for (const channelNames of [[" ", ""], [], ", ,", null]) {
      expect(
        WorkspaceSummarySetup.normalizeWrite({
          channelNames: channelNames,
          summaryItems: ["All"],
        }),
      ).toBe(WORKSPACE_SUMMARY_NO_CHANNELS_REASON);
    }
  });

  test("no items, or null: refused as including nothing", () => {
    for (const summaryItems of [[], [" "], null]) {
      expect(
        WorkspaceSummarySetup.normalizeWrite({
          channelNames: ["#ops"],
          summaryItems: summaryItems,
        }),
      ).toBe(WORKSPACE_SUMMARY_NO_ITEMS_REASON);
    }
  });

  test("neither: the channels are said first", () => {
    expect(
      WorkspaceSummarySetup.normalizeWrite({
        channelNames: [],
        summaryItems: [],
      }),
    ).toBe(WORKSPACE_SUMMARY_NO_CHANNELS_REASON);
  });

  test("a write that does not touch them - a new name, the worker's next send, a column left undefined - is never refused, and is left as it was", () => {
    for (const write of [
      { name: "Renamed" },
      { nextSendAt: new Date("2026-11-16T09:00:00.000Z") },
      { channelNames: undefined, summaryItems: undefined, isEnabled: false },
    ] as Array<Record<string, unknown>>) {
      const before: Record<string, unknown> = { ...write };

      expect(WorkspaceSummarySetup.normalizeWrite(write)).toBeNull();
      expect(write).toEqual(before);
    }
  });

  test("an update of the channels alone is read alone: no items asked for", () => {
    const write: Record<string, unknown> = { channelNames: ["#alerts"] };

    expect(WorkspaceSummarySetup.normalizeWrite(write)).toBeNull();
    expect("summaryItems" in write).toBe(false);
  });
});

test("a summary that cannot be sent is a BadDataException, so the API answers it as it did - and told apart by its class", () => {
  const error: WorkspaceSummaryNotSendableException =
    new WorkspaceSummaryNotSendableException(
      WORKSPACE_SUMMARY_NO_CHANNELS_REASON,
    );

  expect(error).toBeInstanceOf(BadDataException);
  expect(error.message).toBe("The summary has no channel to post in.");
  expect(new BadDataException("Summary not found")).not.toBeInstanceOf(
    WorkspaceSummaryNotSendableException,
  );
});
