import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { PROJECT_ID } from "./SideMenuHarness";

/*
 * THE TWO DIALOGS OF AN INCIDENT CALL'S TRANSCRIPT (issue #4875).
 *
 * Add transcript takes the file the meeting tool saved - WebVTT, SRT or
 * text - or the transcript pasted, says where each provider keeps it, and
 * checks what it can before anything is sent: a file too large, a text
 * with no remark. The transcript dialog reads the transcript when it opens
 * (the page's list of calls never carries it), one remark a row, with a box
 * that narrows it to the remarks holding a word, a long call drawn a few
 * hundred rows at a time, and - opened from what OneUptime AI read - the
 * quoted lines drawn, highlighted and scrolled to.
 */

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

import AddCallTranscriptModal, {
  formatFileSize,
  getTranscriptSourceHint,
} from "../../../../App/FeatureSet/Dashboard/src/Components/VideoCall/AddCallTranscriptModal";
import CallTranscriptModal, {
  TRANSCRIPT_ROWS_SHOWN_AT_ONCE,
  filterTranscriptLines,
  getRowsShownFirst,
} from "../../../../App/FeatureSet/Dashboard/src/Components/VideoCall/CallTranscriptModal";
import { MAX_TRANSCRIPT_FILE_BYTES } from "../../../../App/FeatureSet/Dashboard/src/Components/VideoCall/CallTranscriptState";
import IncidentVideoCall from "../../../Models/DatabaseModels/IncidentVideoCall";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { CallSummaryStatus } from "../../../Types/VideoCall/CallSummary";
import VideoCallProvider from "../../../Types/VideoCall/VideoCallProvider";
import TranscriptText, {
  TranscriptLine,
} from "../../../Utils/VideoCall/TranscriptText";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { CALL_ID, TRANSCRIPT_LINES, storedTranscript } from "./CallTranscriptFixtures";

const VTT: string = [
  "WEBVTT",
  "",
  "1",
  "00:04:03.000 --> 00:04:07.000",
  "<v Sam Rivera>The new release has DB_POOL_MAX=10, it was 40 before.",
  "",
].join("\n");

let post: ReturnType<typeof jest.spyOn>;
let postAnswer: () => HTTPResponse<JSONObject> | HTTPErrorResponse;

beforeEach(() => {
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({
    tenantid: PROJECT_ID,
  } as never);

  postAnswer = (): HTTPResponse<JSONObject> => {
    return new HTTPResponse<JSONObject>(
      200,
      { callSummaryStatus: CallSummaryStatus.Pending },
      {},
    );
  };
  post = jest.spyOn(API, "post").mockImplementation((async () => {
    return postAnswer();
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function renderAdd(data: {
  provider?: VideoCallProvider;
  isReplacing?: boolean;
}): { onAdded: MockFunction; onClose: MockFunction } {
  const onAdded: MockFunction = getJestMockFunction();
  const onClose: MockFunction = getJestMockFunction();

  render(
    <AddCallTranscriptModal
      callId={new ObjectID(CALL_ID)}
      callLabel="Microsoft Teams meeting"
      provider={data.provider || VideoCallProvider.MicrosoftTeams}
      isReplacing={data.isReplacing}
      onClose={() => {
        onClose();
      }}
      onAdded={(result: unknown) => {
        onAdded(result);
      }}
    />,
  );

  return { onAdded, onClose };
}

// A file as the browser hands it over; jsdom's File has no text().
function transcriptFile(content: string, name: string): File {
  const file: File = new File([content], name, { type: "text/vtt" });

  Object.defineProperty(file, "text", {
    value: async (): Promise<string> => {
      return content;
    },
  });

  return file;
}

function chooseFile(file: File): void {
  fireEvent.change(screen.getByTestId("add-call-transcript-file-input"), {
    target: { files: [file] },
  });
}

function sentBody(): JSONObject {
  return (post.mock.calls[0]![0] as { data: JSONObject }).data;
}

describe("Add transcript", () => {
  test("says where the meeting tool keeps it, and cannot be sent empty", () => {
    renderAdd({});

    expect(screen.getByText("Add the call's transcript")).toBeVisible();
    expect(screen.getByTestId("add-call-transcript-hint")).toHaveTextContent(
      "In Microsoft Teams, open the meeting's Recap, then Transcript, and download it as a .vtt file.",
    );
    expect(screen.getByText("or drop it here: .vtt, .srt or .txt, up to 5 MB")).toBeVisible();
    expect(screen.getByTestId("modal-footer-submit-button")).toBeDisabled();
  });

  test("each provider's hint says where its transcript is", () => {
    expect(getTranscriptSourceHint(VideoCallProvider.Zoom)).toContain(
      "Recordings and Transcripts",
    );
    expect(getTranscriptSourceHint(VideoCallProvider.GoogleMeet)).toContain(
      "Google Drive",
    );
    expect(getTranscriptSourceHint(VideoCallProvider.SlackHuddle)).toContain(
      "huddle's notes",
    );
    expect(getTranscriptSourceHint(VideoCallProvider.CustomLink)).toContain(
      ".vtt or .txt",
    );
  });

  test("pasted text is sent as it is, and the incident page hears what was added", async () => {
    const { onAdded } = renderAdd({});

    fireEvent.change(screen.getByTestId("add-call-transcript-text"), {
      target: { value: "[00:12:03] Priya Shah: The pool maxes at 50." },
    });
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(onAdded).toHaveBeenCalledWith({
        callSummaryStatus: CallSummaryStatus.Pending,
        callSummaryStatusMessage: undefined,
      });
    });
    expect(sentBody()).toEqual({
      text: "[00:12:03] Priya Shah: The pool maxes at 50.",
    });
    expect(
      (post.mock.calls[0]![0] as { url: { toString: () => string } }).url.toString(),
    ).toContain(`/incident-video-call/${CALL_ID}/transcript`);
  });

  test("a file is read in the browser and sent as text with its name", async () => {
    const { onAdded } = renderAdd({});

    chooseFile(transcriptFile(VTT, "checkout-call.vtt"));

    const chosen: HTMLElement = await screen.findByTestId(
      "add-call-transcript-file",
    );

    expect(chosen).toHaveTextContent("checkout-call.vtt");
    // Pasting is put away while a file is chosen.
    expect(screen.queryByTestId("add-call-transcript-text")).toBeNull();

    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(onAdded).toHaveBeenCalledTimes(1);
    });
    expect(sentBody()).toEqual({ text: VTT, fileName: "checkout-call.vtt" });
  });

  test("a chosen file can be taken back", async () => {
    renderAdd({});

    chooseFile(transcriptFile(VTT, "checkout-call.vtt"));
    fireEvent.click(await screen.findByTestId("add-call-transcript-file-remove"));

    expect(screen.queryByTestId("add-call-transcript-file")).toBeNull();
    expect(screen.getByTestId("add-call-transcript-text")).toBeVisible();
  });

  test("a file too large is refused at once, without sending it", async () => {
    renderAdd({});

    const large: File = new File(["x"], "all-hands.vtt", { type: "text/vtt" });
    Object.defineProperty(large, "size", {
      value: MAX_TRANSCRIPT_FILE_BYTES + 1,
    });

    chooseFile(large);

    expect(
      await screen.findByText(
        "This file is larger than 5 MB. Add the part of the call about the incident.",
      ),
    ).toBeVisible();
    expect(screen.queryByTestId("add-call-transcript-file")).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });

  test("a text with no remark in it is refused at once, as the server would", async () => {
    renderAdd({});

    fireEvent.change(screen.getByTestId("add-call-transcript-text"), {
      target: { value: "WEBVTT\n\n" },
    });
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(screen.getByTestId("add-call-transcript")).toBeVisible();
    });

    let message: string = "";

    try {
      TranscriptText.prepare({ text: "WEBVTT\n\n" });
    } catch (err) {
      message = (err as Error).message;
    }

    expect(message).not.toBe("");
    expect(await screen.findByText(message)).toBeVisible();
    expect(post).not.toHaveBeenCalled();
  });

  test("the server's refusal is said, and the dialog stays open", async () => {
    postAnswer = (): HTTPErrorResponse => {
      return new HTTPErrorResponse(
        400,
        { message: "This call's transcript is being replaced by someone else." },
        {},
      );
    };

    const { onAdded } = renderAdd({});

    fireEvent.change(screen.getByTestId("add-call-transcript-text"), {
      target: { value: "Sam: it is the pool" },
    });
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    expect(
      await screen.findByText(
        "This call's transcript is being replaced by someone else.",
      ),
    ).toBeVisible();
    expect(onAdded).not.toHaveBeenCalled();
  });

  test("replacing says so", () => {
    renderAdd({ isReplacing: true });

    expect(screen.getByText("Replace the call's transcript")).toBeVisible();
    expect(screen.getByTestId("modal-footer-submit-button")).toHaveTextContent(
      "Replace transcript",
    );
  });

  test("file sizes read as a person writes them", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2 KB");
    expect(formatFileSize(MAX_TRANSCRIPT_FILE_BYTES)).toBe("5 MB");
    expect(formatFileSize(2.44 * 1024 * 1024)).toBe("2.4 MB");
  });
});

function renderTranscript(data: {
  transcript?: string | undefined;
  highlightLines?: Array<number> | undefined;
  failWith?: string | undefined;
}): { getItem: ReturnType<typeof jest.spyOn> } {
  let failures: number = data.failWith ? 1 : 0;

  const getItem: ReturnType<typeof jest.spyOn> = jest
    .spyOn(ModelAPI, "getItem")
    .mockImplementation(async (): Promise<IncidentVideoCall> => {
      if (failures > 0) {
        failures--;
        throw new Error(data.failWith);
      }

      const call: IncidentVideoCall = new IncidentVideoCall();
      call.id = new ObjectID(CALL_ID);
      call.transcript =
        data.transcript === undefined ? storedTranscript() : data.transcript;
      return call;
    });

  render(
    <CallTranscriptModal
      callId={new ObjectID(CALL_ID)}
      callLabel="Zoom meeting"
      highlightLines={data.highlightLines}
      onClose={() => {}}
    />,
  );

  return { getItem };
}

function shownLines(): Array<HTMLElement> {
  return within(screen.getByTestId("call-transcript-lines")).getAllByTestId(
    "call-transcript-line",
  );
}

function longTranscript(count: number): string {
  const lines: Array<TranscriptLine> = [];

  for (let index: number = 0; index < count; index++) {
    lines.push({
      offsetInSeconds: index * 5,
      speaker: index % 2 === 0 ? "Sam Rivera" : "Maya Chen",
      text: `Remark ${index + 1}`,
    });
  }

  return TranscriptText.serialize(lines);
}

describe("the transcript dialog", () => {
  test("reads the transcript when it opens: one remark a row, its time and speaker", async () => {
    renderTranscript({});

    expect(await screen.findByTestId("call-transcript-lines")).toBeVisible();
    expect(shownLines()).toHaveLength(TRANSCRIPT_LINES.length);

    const sixth: HTMLElement = shownLines()[5]!;

    expect(sixth).toHaveAttribute("data-line", "6");
    expect(sixth).toHaveTextContent(
      "00:04:03Sam RiveraThe new release has DB_POOL_MAX=10, it was 40 before.",
    );
    expect(screen.getByText("Transcript of the Zoom meeting")).toBeVisible();
    // Nothing is highlighted when nothing is quoted.
    expect(screen.queryByTestId("call-transcript-highlight-legend")).toBeNull();
  });

  test("the find box narrows it to the remarks holding a word, a speaker's too, in any case", async () => {
    renderTranscript({});

    await screen.findByTestId("call-transcript-lines");

    fireEvent.change(screen.getByTestId("call-transcript-search"), {
      target: { value: "ROLLBACK" },
    });

    expect(
      shownLines().map((line: HTMLElement): string | null => {
        return line.getAttribute("data-line");
      }),
    ).toEqual(["10"]);

    fireEvent.change(screen.getByTestId("call-transcript-search"), {
      target: { value: "maya" },
    });

    expect(shownLines()).toHaveLength(3);

    fireEvent.change(screen.getByTestId("call-transcript-search"), {
      target: { value: "kubernetes" },
    });

    expect(screen.getByText("No remark has these words.")).toBeVisible();
  });

  test("a long call is drawn a few hundred rows at a time", async () => {
    renderTranscript({ transcript: longTranscript(TRANSCRIPT_ROWS_SHOWN_AT_ONCE + 30) });

    await screen.findByTestId("call-transcript-lines");

    expect(shownLines()).toHaveLength(TRANSCRIPT_ROWS_SHOWN_AT_ONCE);

    const more: HTMLElement = screen.getByTestId("call-transcript-show-more");

    expect(more).toHaveTextContent("Show 30 more remarks");

    fireEvent.click(more);

    expect(shownLines()).toHaveLength(TRANSCRIPT_ROWS_SHOWN_AT_ONCE + 30);
    expect(screen.queryByTestId("call-transcript-show-more")).toBeNull();
  });

  test("opened on a quoted line far into the call, draws far enough to show it, and scrolls to it", async () => {
    const scrolled: Array<string | null> = [];
    const original: typeof HTMLElement.prototype.scrollIntoView =
      HTMLElement.prototype.scrollIntoView;

    HTMLElement.prototype.scrollIntoView = function (this: HTMLElement): void {
      scrolled.push(this.getAttribute("data-line"));
    };

    try {
      renderTranscript({
        transcript: longTranscript(TRANSCRIPT_ROWS_SHOWN_AT_ONCE * 2 + 10),
        highlightLines: [TRANSCRIPT_ROWS_SHOWN_AT_ONCE + 7, 3],
      });

      await screen.findByTestId("call-transcript-lines");

      expect(shownLines()).toHaveLength(TRANSCRIPT_ROWS_SHOWN_AT_ONCE);

      await waitFor(() => {
        expect(scrolled).toEqual(["3"]);
      });
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }

    cleanup();

    renderTranscript({
      transcript: longTranscript(TRANSCRIPT_ROWS_SHOWN_AT_ONCE * 2 + 10),
      highlightLines: [TRANSCRIPT_ROWS_SHOWN_AT_ONCE + 7],
    });

    await screen.findByTestId("call-transcript-lines");

    expect(shownLines()).toHaveLength(TRANSCRIPT_ROWS_SHOWN_AT_ONCE * 2);
    expect(
      shownLines()[TRANSCRIPT_ROWS_SHOWN_AT_ONCE + 6]!,
    ).toHaveAttribute("data-highlighted", "true");
  });

  test("a transcript that could not be read says why, and reads it again", async () => {
    const { getItem } = renderTranscript({ failWith: "The database is asleep." });

    expect(await screen.findByText("The database is asleep.")).toBeVisible();

    fireEvent.click(screen.getByTestId("refresh-button"));

    expect(await screen.findByTestId("call-transcript-lines")).toBeVisible();
    expect(getItem).toHaveBeenCalledTimes(2);
  });

  test("a call whose transcript was removed meanwhile says it has none", async () => {
    renderTranscript({ transcript: "" });

    expect(await screen.findByText("This call has no transcript.")).toBeVisible();
  });

  test("filterTranscriptLines keeps every remark's number in the whole transcript", () => {
    expect(
      filterTranscriptLines(TRANSCRIPT_LINES, "  pool ").map(
        (entry: { number: number }): number => {
          return entry.number;
        },
      ),
    ).toEqual([3, 6, 11]);
    expect(filterTranscriptLines(TRANSCRIPT_LINES, "")).toHaveLength(
      TRANSCRIPT_LINES.length,
    );
  });

  test("getRowsShownFirst reaches the first quoted line, in steps", () => {
    expect(getRowsShownFirst()).toBe(TRANSCRIPT_ROWS_SHOWN_AT_ONCE);
    expect(getRowsShownFirst([12])).toBe(TRANSCRIPT_ROWS_SHOWN_AT_ONCE);
    expect(getRowsShownFirst([TRANSCRIPT_ROWS_SHOWN_AT_ONCE + 1, 900])).toBe(
      TRANSCRIPT_ROWS_SHOWN_AT_ONCE * 2,
    );
    expect(getRowsShownFirst([0, -4, Number.NaN])).toBe(
      TRANSCRIPT_ROWS_SHOWN_AT_ONCE,
    );
  });
});
