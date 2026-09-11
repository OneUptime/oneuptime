import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { describe, expect, test } from "@jest/globals";
import NotesSection from "./NotesSection";
import { makeNote } from "../__tests__/testSupport";
import type { NoteItem } from "../api/types";

const mockOpenUrl: jest.Mock = jest.fn(async () => {
  return true;
});
jest.mock("expo-linking", () => {
  return {
    openURL: (url: string) => {
      return mockOpenUrl(url);
    },
  };
});

/*
 * The internal notes on an incident or an episode. They are the handover: what
 * the last responder tried, what they were watching, what they want the next
 * person not to repeat. Three data shapes decide what this renders, and all
 * three come off the wire rather than out of the app:
 *
 *   - undefined notes, meaning the request has not answered yet. That is NOT
 *     the same as an empty list, and saying "No notes yet." while the notes
 *     are still loading tells the responder there is no handover when there
 *     may be a screenful of it.
 *   - a note whose author is null, which happens whenever the note was written
 *     by an automation or by a user who has since been removed.
 *   - a note body that arrived wrapped in the API's { _type, value } envelope
 *     rather than as a bare string.
 */

const ADD_NOTE: string = "Add Note";
const EMPTY_MESSAGE: string = "No notes yet.";

describe("Loading and recovering team notes", () => {
  test("shows progress without claiming that a pending list is empty", async () => {
    await render(
      <NotesSection notes={[]} setNoteModalVisible={noop} isLoading />,
    );
    expect(screen.getByText("Loading notes…")).toBeTruthy();
    expect(screen.queryByText(EMPTY_MESSAGE)).toBeNull();
  });

  test("a failed request explains that updates may be missing and can be retried", async () => {
    const onRetry: jest.Mock = jest.fn();
    await render(
      <NotesSection
        notes={[]}
        setNoteModalVisible={noop}
        isError
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      /Your team's updates may be missing/,
    );
    expect(screen.queryByText(EMPTY_MESSAGE)).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Retry notes" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test("preserves cached notes and the add action after a refresh fails", async () => {
    const setVisible: jest.Mock = jest.fn();
    await render(
      <NotesSection
        notes={[makeNote({ note: "Rollback is in progress." })]}
        setNoteModalVisible={setVisible}
        isError
        onRetry={noop}
      />,
    );
    expect(screen.getByText("Rollback is in progress.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry notes" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: ADD_NOTE }));
    expect(setVisible).toHaveBeenCalledWith(true);
  });
});

function noop(): void {
  return undefined;
}

describe("A section with notes on it", () => {
  test("formats handover notes and opens their runbook links", async () => {
    await render(
      <NotesSection
        notes={[
          makeNote({
            note: "**Recovery steps**\n\n- Restart workers\n- Follow the [runbook](https://example.com/runbook).",
          }),
        ]}
        setNoteModalVisible={noop}
      />,
    );

    expect(screen.getByText("Recovery steps")).toBeTruthy();
    expect(screen.getByText("Restart workers")).toBeTruthy();
    expect(screen.queryByText(/\*\*Recovery steps\*\*/)).toBeNull();
    await fireEvent.press(screen.getByText("runbook"));
    expect(mockOpenUrl).toHaveBeenCalledWith("https://example.com/runbook");
  });

  test("each note's text is rendered", async () => {
    const notes: NoteItem[] = [
      makeNote({ _id: "note-1", note: "Restarted the checkout pods." }),
      makeNote({ _id: "note-2", note: "Latency back under 200ms." }),
    ];

    await render(<NotesSection notes={notes} setNoteModalVisible={noop} />);

    expect(screen.getByText("Restarted the checkout pods.")).toBeTruthy();
    expect(screen.getByText("Latency back under 200ms.")).toBeTruthy();
  });

  test("the author is named", async () => {
    await render(
      <NotesSection
        notes={[
          makeNote({ createdByUser: { _id: "u1", name: "Ada Lovelace" } }),
        ]}
        setNoteModalVisible={noop}
      />,
    );

    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
  });

  test("a serialized author name is rendered without Common model instances", async () => {
    await render(
      <NotesSection
        notes={[
          makeNote({
            createdByUser: {
              _id: "user-1",
              name: { _type: "Name", value: "Grace Hopper" },
            },
          }),
        ]}
        setNoteModalVisible={noop}
      />,
    );

    expect(screen.getByText("Grace Hopper")).toBeTruthy();
  });

  test("the note is timestamped", async () => {
    await render(
      <NotesSection
        notes={[makeNote({ createdAt: "2026-08-30T10:07:00.000Z" })]}
        setNoteModalVisible={noop}
      />,
    );

    expect(screen.getByText(/2026/)).toBeTruthy();
  });

  test("a note with no usable timestamp says so rather than inventing one", async () => {
    await render(
      <NotesSection
        notes={[makeNote({ createdAt: undefined as unknown as string })]}
        setNoteModalVisible={noop}
      />,
    );

    expect(screen.getByText("—")).toBeTruthy();
  });

  test("a note body wrapped in the API's envelope is unwrapped", async () => {
    await render(
      <NotesSection
        notes={[
          makeNote({
            note: {
              _type: "Markdown",
              value: "Paged the database team.",
            } as unknown as string,
          }),
        ]}
        setNoteModalVisible={noop}
      />,
    );

    expect(screen.getByText("Paged the database team.")).toBeTruthy();
  });

  test("notes the server sent without an id still all render", async () => {
    /*
     * The key falls back to createdAt plus the index. Two notes written in the
     * same second would collide on createdAt alone, and React drops the
     * duplicate - one of the two notes silently disappears from the handover.
     */
    const sameSecond: string = "2026-08-30T10:07:00.000Z";
    const notes: NoteItem[] = [
      makeNote({
        _id: undefined as unknown as string,
        note: "First thing I tried.",
        createdAt: sameSecond,
      }),
      makeNote({
        _id: undefined as unknown as string,
        note: "Second thing I tried.",
        createdAt: sameSecond,
      }),
    ];

    await render(<NotesSection notes={notes} setNoteModalVisible={noop} />);

    expect(screen.getByText("First thing I tried.")).toBeTruthy();
    expect(screen.getByText("Second thing I tried.")).toBeTruthy();
  });

  test("no empty-state message is shown when there are notes", async () => {
    await render(
      <NotesSection notes={[makeNote()]} setNoteModalVisible={noop} />,
    );

    expect(screen.queryByText(EMPTY_MESSAGE)).toBeNull();
  });
});

describe("A note whose author the server could not name", () => {
  /*
   * createdByUser is null for a note written by an automation, or by an
   * account that has since been removed from the project.
   */
  const anonymous: NoteItem = makeNote({
    _id: "note-1",
    note: "Auto-resolved by the monitor.",
    createdByUser: null,
  });

  test("the note itself is still shown", async () => {
    await render(
      <NotesSection notes={[anonymous]} setNoteModalVisible={noop} />,
    );

    expect(screen.getByText("Auto-resolved by the monitor.")).toBeTruthy();
  });

  test("no author line is invented for it", async () => {
    /*
     * An empty author line reads as a name that failed to load, and an
     * "Unknown" would read as a claim about who wrote it. The named note
     * alongside it is what makes this an assertion about the anonymous one
     * rather than about the author line never rendering at all.
     */
    await render(
      <NotesSection
        notes={[
          anonymous,
          makeNote({
            _id: "note-2",
            note: "Confirmed, latency is flat.",
            createdByUser: { _id: "user-1", name: "Ada Lovelace" },
          }),
        ]}
        setNoteModalVisible={noop}
      />,
    );

    expect(screen.getAllByText("Ada Lovelace")).toHaveLength(1);
    expect(screen.getByText("Auto-resolved by the monitor.")).toBeTruthy();
  });

  test("its timestamp survives the missing author", async () => {
    await render(
      <NotesSection
        notes={[
          makeNote({
            createdByUser: null,
            createdAt: "2026-08-30T10:07:00.000Z",
          }),
        ]}
        setNoteModalVisible={noop}
      />,
    );

    expect(screen.getByText(/2026/)).toBeTruthy();
  });
});

describe("A section with no notes", () => {
  test("an empty list says so", async () => {
    await render(<NotesSection notes={[]} setNoteModalVisible={noop} />);

    expect(screen.getByText(EMPTY_MESSAGE)).toBeTruthy();
  });

  test("notes that have not arrived yet do NOT say so", async () => {
    /*
     * undefined is "still loading", not "there are none". Claiming the latter
     * during a fetch tells a responder there is no handover to read, and they
     * act on that before the notes appear.
     */
    await render(<NotesSection notes={undefined} setNoteModalVisible={noop} />);

    expect(screen.queryByText(EMPTY_MESSAGE)).toBeNull();
  });

  test("the heading is there either way", async () => {
    await render(<NotesSection notes={undefined} setNoteModalVisible={noop} />);

    expect(screen.getByText("Internal Notes")).toBeTruthy();
  });
});

describe("Adding a note", () => {
  test("the affordance is offered", async () => {
    await render(<NotesSection notes={[]} setNoteModalVisible={noop} />);

    expect(screen.getByText(ADD_NOTE)).toBeTruthy();
  });

  test("pressing it opens the compose modal", async () => {
    const setNoteModalVisible: jest.Mock = jest.fn();

    await render(
      <NotesSection
        notes={[makeNote()]}
        setNoteModalVisible={setNoteModalVisible}
      />,
    );

    await fireEvent.press(screen.getByText(ADD_NOTE));

    expect(setNoteModalVisible).toHaveBeenCalledWith(true);
    expect(setNoteModalVisible).toHaveBeenCalledTimes(1);
  });

  test("it is offered while the notes are still loading", async () => {
    /*
     * Writing a note does not depend on having read the existing ones, and a
     * responder who has just done something wants to record it now.
     */
    const setNoteModalVisible: jest.Mock = jest.fn();

    await render(
      <NotesSection
        notes={undefined}
        setNoteModalVisible={setNoteModalVisible}
      />,
    );

    await fireEvent.press(screen.getByText(ADD_NOTE));

    expect(setNoteModalVisible).toHaveBeenCalledWith(true);
  });

  test("it is offered from the empty state, where it matters most", async () => {
    const setNoteModalVisible: jest.Mock = jest.fn();

    await render(
      <NotesSection notes={[]} setNoteModalVisible={setNoteModalVisible} />,
    );

    await fireEvent.press(screen.getByText(ADD_NOTE));

    expect(setNoteModalVisible).toHaveBeenCalledWith(true);
  });

  test("two presses ask twice rather than latching", async () => {
    /*
     * The parent owns the flag; this control only reports. If it ever stopped
     * reporting after the first press, a modal the responder dismissed could
     * never be reopened without leaving the screen.
     */
    const setNoteModalVisible: jest.Mock = jest.fn();

    await render(
      <NotesSection notes={[]} setNoteModalVisible={setNoteModalVisible} />,
    );

    await fireEvent.press(screen.getByText(ADD_NOTE));
    await fireEvent.press(screen.getByText(ADD_NOTE));

    expect(setNoteModalVisible).toHaveBeenCalledTimes(2);
  });
});
