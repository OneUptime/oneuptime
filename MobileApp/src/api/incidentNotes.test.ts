import apiClient from "./client";
import { createIncidentNote, fetchIncidentNotes } from "./incidentNotes";
import { makeListResponse, makeNote } from "../__tests__/testSupport";
import type { ListResponse, NoteItem } from "./types";
import { describe, expect, test, beforeEach } from "@jest/globals";

jest.mock("./client", () => {
  return {
    __esModule: true,
    default: {
      post: jest.fn(async () => {
        return { data: { data: [], count: 0, skip: 0, limit: 50 } };
      }),
    },
  };
});

/*
 * The internal note thread on an incident: the running commentary responders
 * leave for each other during the incident and read back afterwards when
 * somebody writes it up. These two requests are thin, and every part of them
 * that can break is a part the compiler cannot see.
 *
 * The tenant header is the first of those. The project id and the incident id
 * arrive as adjacent plain strings, so transposing them type-checks and then
 * asks the server for the notes of a tenant that does not exist - which comes
 * back empty rather than failing, and an empty thread reads as "nothing
 * happened here".
 *
 * The two bodies are the second, and they do not share a shape. The read
 * filters through a bare `query`; the create describes its new row inside a
 * nested `data` object, and whatever is left outside `data` is not part of
 * that row.
 *
 * What each function returns is the third. The endpoint answers with an
 * envelope of `data`, `count`, `skip` and `limit`, and the caller wants the
 * rows out of it - it maps over the result without unwrapping anything.
 */

function postMock(): jest.SpyInstance {
  return apiClient.post as unknown as jest.SpyInstance;
}

function lastCall(): Array<unknown> {
  const calls: Array<Array<unknown>> = postMock().mock.calls;

  return calls[calls.length - 1]!;
}

function lastUrl(): string {
  return lastCall()[0] as string;
}

function lastBody(): Record<string, unknown> {
  return lastCall()[1] as Record<string, unknown>;
}

function lastHeaders(): Record<string, unknown> {
  const config: { headers?: Record<string, unknown> } = lastCall()[2] as {
    headers?: Record<string, unknown>;
  };

  return config.headers ?? {};
}

describe("fetchIncidentNotes", () => {
  beforeEach(() => {
    const envelope: ListResponse<NoteItem> = makeListResponse([makeNote()]);

    postMock().mockClear();
    postMock().mockResolvedValue({ data: envelope } as never);
  });

  test("reads from the incident internal note list endpoint", async () => {
    await fetchIncidentNotes("project-1", "incident-1");

    expect(lastUrl()).toBe(
      "/api/incident-internal-note/get-list?skip=0&limit=50",
    );
  });

  test("filters on the incident being viewed and nothing else", async () => {
    /*
     * The project is deliberately absent from the query - it is carried by the
     * tenant header instead - but the incident id has to be here, or the
     * request asks for every note in the project and one incident's thread
     * fills up with another's.
     */
    await fetchIncidentNotes("project-1", "incident-1");

    expect(lastBody()["query"]).toEqual({ incidentId: "incident-1" });
  });

  test("sends the project id as the tenant header, not the incident id", async () => {
    /*
     * Nothing else in the stack distinguishes these two strings. Sent the
     * wrong way round the server answers for a tenant named after an incident,
     * which is a successful, empty response - the worst kind of wrong, since
     * the screen renders it as a thread nobody has written in.
     */
    await fetchIncidentNotes("project-1", "incident-1");

    expect(lastHeaders()["tenantid"]).toBe("project-1");
  });

  test("scopes the read to that one project and nothing wider", async () => {
    /*
     * The cross-project list readers in this app say so with an
     * is-multi-tenant-query header and deliberately send no tenant id. This
     * request is the opposite case, and inheriting that header from a
     * copy-paste would take a project-scoped read out of its scope.
     */
    await fetchIncidentNotes("project-1", "incident-1");

    expect(lastHeaders()).toEqual({ tenantid: "project-1" });
  });

  test("asks for the note, its timestamp and the user who wrote it", async () => {
    /*
     * createdByUser is the nested one, and so the one that goes missing
     * quietly: NoteItem allows it to be null, so a note with no author still
     * renders. A thread that records what was tried but not who tried it is
     * most of the way to useless when the write-up gets written.
     */
    await fetchIncidentNotes("project-1", "incident-1");

    expect(lastBody()["select"]).toEqual({
      _id: true,
      note: true,
      createdAt: true,
      createdByUser: { _id: true, name: true },
    });
  });

  test("orders the notes newest first", async () => {
    /*
     * Somebody joining a live incident reads from the top, and what they need
     * first is the most recent thing anyone did.
     */
    await fetchIncidentNotes("project-1", "incident-1");

    expect(lastBody()["sort"]).toEqual({ createdAt: "DESC" });
  });

  test("returns the notes themselves rather than the list envelope", async () => {
    /*
     * Returning `response.data` would hand the screen an object carrying a
     * `data` key and no length, so a thread with two notes in it would render
     * as no notes at all.
     */
    const rows: NoteItem[] = [
      makeNote({ _id: "note-1", note: "Rolled back the deploy." }),
      makeNote({ _id: "note-2", note: "Error rate back to baseline." }),
    ];
    const envelope: ListResponse<NoteItem> = makeListResponse(rows);

    postMock().mockResolvedValue({ data: envelope } as never);

    const notes: NoteItem[] = await fetchIncidentNotes(
      "project-1",
      "incident-1",
    );

    expect(notes).toHaveLength(2);
    expect(notes[0]!.note).toBe("Rolled back the deploy.");
  });

  test("an incident nobody has written on resolves to an empty list", async () => {
    /*
     * Every incident starts here. The result has to be an empty array rather
     * than undefined, because the notes section maps over it before it decides
     * whether there is anything to show.
     */
    const envelope: ListResponse<NoteItem> = makeListResponse<NoteItem>([]);

    postMock().mockResolvedValue({ data: envelope } as never);

    const notes: NoteItem[] = await fetchIncidentNotes(
      "project-1",
      "incident-1",
    );

    expect(notes).toEqual([]);
  });

  test("lets a failed read reach the caller instead of reporting no notes", async () => {
    /*
     * "The notes did not load" and "there are no notes" call for opposite
     * reactions from a responder, and only the rejection travelling up lets
     * the query hook tell them apart.
     */
    postMock().mockRejectedValue(new Error("Network Error") as never);

    await expect(fetchIncidentNotes("project-1", "incident-1")).rejects.toThrow(
      "Network Error",
    );
  });
});

describe("createIncidentNote", () => {
  beforeEach(() => {
    postMock().mockClear();
    postMock().mockResolvedValue({ data: { data: makeNote() } } as never);
  });

  test("posts to the note collection endpoint, not the list one", async () => {
    await createIncidentNote(
      "project-1",
      "incident-1",
      "Scaled the workers to twelve.",
    );

    expect(lastUrl()).toBe("/api/incident-internal-note");
  });

  test("builds the row under a data key, carrying the note and both ids", async () => {
    /*
     * The create API reads the row out of `data`. The incident id is what
     * files the note against this incident and the project id is what owns it;
     * a note that loses either one is written and then never found again.
     */
    await createIncidentNote(
      "project-1",
      "incident-1",
      "Scaled the workers to twelve.",
    );

    expect(lastBody()["data"]).toEqual({
      incidentId: "incident-1",
      note: "Scaled the workers to twelve.",
      projectId: "project-1",
    });
  });

  test("does not leave the note text at the top level of the body", async () => {
    /*
     * A body whose `note` sits beside `data` instead of inside it is still a
     * well-formed create request - it just describes a row without the one
     * thing the responder actually typed.
     */
    await createIncidentNote(
      "project-1",
      "incident-1",
      "Scaled the workers to twelve.",
    );

    expect(lastBody()["note"]).toBeUndefined();
    expect(lastBody()["incidentId"]).toBeUndefined();
  });

  test("sends the project id as the tenant header as well as in the row", async () => {
    await createIncidentNote(
      "project-1",
      "incident-1",
      "Scaled the workers to twelve.",
    );

    expect(lastHeaders()).toEqual({ tenantid: "project-1" });
  });

  test("sends the note exactly as it was typed, line breaks and all", async () => {
    /*
     * These notes are where pasted log output and fenced blocks end up. The
     * composer trims the outer whitespace before calling in here; anything
     * beyond that - collapsing the blank lines, escaping the backticks -
     * changes what the incident record says was seen.
     */
    const note: string =
      "Queue drained.\n\n```\nlag: 0ms\n```\n\nLeaving monitors up for an hour.";

    await createIncidentNote("project-1", "incident-1", note);

    const data: Record<string, unknown> = lastBody()["data"] as Record<
      string,
      unknown
    >;

    expect(data["note"]).toBe(note);
  });

  test("lets a failed create reach the caller so the screen can own up to it", async () => {
    /*
     * The detail screen relies on this rejection to say "Failed to add note"
     * and keep the composer open with the text still in it. Swallowed, the
     * modal closes on a note the server never stored and the responder
     * believes the thread has it.
     */
    postMock().mockRejectedValue(new Error("Request failed") as never);

    await expect(
      createIncidentNote(
        "project-1",
        "incident-1",
        "Scaled the workers to twelve.",
      ),
    ).rejects.toThrow("Request failed");
  });
});
