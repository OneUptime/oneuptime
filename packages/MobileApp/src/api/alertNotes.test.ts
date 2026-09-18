import apiClient from "./client";
import { createAlertNote, fetchAlertNotes } from "./alertNotes";
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
 * The internal notes a responder leaves on an alert: what they tried, who they
 * woke, why they closed it. Three things about these two requests are
 * invisible to the type system and expensive to get wrong.
 *
 * The tenant header is the first. Both functions take the project id and the
 * alert id as adjacent plain strings, so transposing them compiles happily and
 * then either scopes the read to a project that does not exist - the handover
 * notes look like they were never written - or filters on an id that is not an
 * alert.
 *
 * The two body shapes are the second, and they are NOT the same shape. The
 * read filters through a bare `query`; the create builds its row out of a
 * nested `data` object, and anything left outside `data` is simply not part of
 * the row being created.
 *
 * The third is what each function hands back. The endpoint answers with an
 * envelope of `data`, `count`, `skip` and `limit`; the caller here wants the
 * rows inside it, and the notes section maps straight over what it gets.
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

describe("fetchAlertNotes", () => {
  beforeEach(() => {
    const envelope: ListResponse<NoteItem> = makeListResponse([makeNote()]);

    postMock().mockClear();
    postMock().mockResolvedValue({ data: envelope } as never);
  });

  test("reads from the alert internal note list endpoint", async () => {
    await fetchAlertNotes("project-1", "alert-1");

    expect(lastUrl()).toBe("/api/alert-internal-note/get-list?skip=0&limit=50");
  });

  test("filters on the alert being viewed and nothing else", async () => {
    /*
     * The project does not belong in the query - it travels as the tenant
     * header below - but the alert does: without it the request asks for every
     * note in the project and the thread fills with other alerts' notes.
     */
    await fetchAlertNotes("project-1", "alert-1");

    expect(lastBody()["query"]).toEqual({ alertId: "alert-1" });
  });

  test("sends the project id as the tenant header, not the alert id", async () => {
    /*
     * The pair of positional strings that nothing checks. Swapped, the server
     * is asked for the notes of a tenant named after an alert, which is an
     * empty answer rather than an error - and an empty note thread reads as
     * "nobody has written anything here yet".
     */
    await fetchAlertNotes("project-1", "alert-1");

    expect(lastHeaders()["tenantid"]).toBe("project-1");
  });

  test("scopes the read to that one project and nothing wider", async () => {
    /*
     * Several list readers in this app deliberately span every project the
     * user belongs to and say so with an is-multi-tenant-query header instead
     * of a tenant id. Notes are not one of them, and copying that header in
     * here would opt this request out of the scoping that keeps one project's
     * incident chatter out of another's.
     */
    await fetchAlertNotes("project-1", "alert-1");

    expect(lastHeaders()).toEqual({ tenantid: "project-1" });
  });

  test("asks for the note, its timestamp and the user who wrote it", async () => {
    /*
     * createdByUser is a nested select, and it is the one that gets dropped:
     * NoteItem types it as nullable, the notes section renders an unattributed
     * note without complaining, and a handover thread where nobody can tell
     * who said what is worth very little at 3am.
     */
    await fetchAlertNotes("project-1", "alert-1");

    expect(lastBody()["select"]).toEqual({
      _id: true,
      note: true,
      createdAt: true,
      createdByUser: { _id: true, name: true },
    });
  });

  test("orders the notes newest first", async () => {
    /*
     * The thread is read from the top when a responder picks up an alert, so
     * the most recent thing anyone did has to be the first thing they see.
     */
    await fetchAlertNotes("project-1", "alert-1");

    expect(lastBody()["sort"]).toEqual({ createdAt: "DESC" });
  });

  test("returns the notes themselves rather than the list envelope", async () => {
    /*
     * The caller renders this directly. Handing back `response.data` would
     * give it an object with a `data` key and no length, so the thread would
     * come out empty even though the server answered with two notes.
     */
    const rows: NoteItem[] = [
      makeNote({ _id: "note-1", note: "Paged the database team." }),
      makeNote({ _id: "note-2", note: "Failed over to the replica." }),
    ];
    const envelope: ListResponse<NoteItem> = makeListResponse(rows);

    postMock().mockResolvedValue({ data: envelope } as never);

    const notes: NoteItem[] = await fetchAlertNotes("project-1", "alert-1");

    expect(notes).toHaveLength(2);
    expect(notes[0]!.note).toBe("Paged the database team.");
  });

  test("an alert nobody has written on resolves to an empty list", async () => {
    /*
     * The common case for a fresh alert. It has to be an empty array and not
     * undefined, because the notes section maps over the result before it ever
     * checks whether there is anything in it.
     */
    const envelope: ListResponse<NoteItem> = makeListResponse<NoteItem>([]);

    postMock().mockResolvedValue({ data: envelope } as never);

    const notes: NoteItem[] = await fetchAlertNotes("project-1", "alert-1");

    expect(notes).toEqual([]);
  });

  test("lets a failed read reach the caller instead of reporting no notes", async () => {
    /*
     * A swallowed failure is indistinguishable from an alert with no notes on
     * it, and the two call for opposite reactions from whoever is holding the
     * pager. The query hook can only show "could not load" if the rejection
     * gets that far.
     */
    postMock().mockRejectedValue(new Error("Network Error") as never);

    await expect(fetchAlertNotes("project-1", "alert-1")).rejects.toThrow(
      "Network Error",
    );
  });
});

describe("createAlertNote", () => {
  beforeEach(() => {
    postMock().mockClear();
    postMock().mockResolvedValue({ data: { data: makeNote() } } as never);
  });

  test("posts to the note collection endpoint, not the list one", async () => {
    await createAlertNote("project-1", "alert-1", "Restarted the ingester.");

    expect(lastUrl()).toBe("/api/alert-internal-note");
  });

  test("builds the row under a data key, carrying the note and both ids", async () => {
    /*
     * The create API reads the row it is about to write out of `data`. The
     * alert id is what attaches the note to this alert's thread and the
     * project id is what the row is owned by; a note missing either is a note
     * nobody will ever see again.
     */
    await createAlertNote("project-1", "alert-1", "Restarted the ingester.");

    expect(lastBody()["data"]).toEqual({
      alertId: "alert-1",
      note: "Restarted the ingester.",
      projectId: "project-1",
    });
  });

  test("does not leave the note text at the top level of the body", async () => {
    /*
     * The failure mode worth guarding: a body whose `note` sits beside `data`
     * rather than inside it is still a syntactically fine create request, it
     * just describes a row without the one field the responder typed.
     */
    await createAlertNote("project-1", "alert-1", "Restarted the ingester.");

    expect(lastBody()["note"]).toBeUndefined();
    expect(lastBody()["alertId"]).toBeUndefined();
  });

  test("sends the project id as the tenant header as well as in the row", async () => {
    await createAlertNote("project-1", "alert-1", "Restarted the ingester.");

    expect(lastHeaders()).toEqual({ tenantid: "project-1" });
  });

  test("sends the note exactly as it was typed, line breaks and all", async () => {
    /*
     * Responders paste log lines and fenced blocks into these. The modal trims
     * the outer whitespace before it calls in here; anything past that -
     * collapsing the newlines, escaping the backticks - rewrites the record of
     * what was actually seen.
     */
    const note: string =
      "Pod restarted.\n\n```\nCrashLoopBackOff x7\n```\n\nWatching.";

    await createAlertNote("project-1", "alert-1", note);

    const data: Record<string, unknown> = lastBody()["data"] as Record<
      string,
      unknown
    >;

    expect(data["note"]).toBe(note);
  });

  test("lets a failed create reach the caller so the screen can own up to it", async () => {
    /*
     * The detail screen catches this to say "Failed to add note" and leave the
     * composer open. A wrapper that swallowed the rejection would close the
     * modal and discard the text on a note the server never stored.
     */
    postMock().mockRejectedValue(new Error("Request failed") as never);

    await expect(
      createAlertNote("project-1", "alert-1", "Restarted the ingester."),
    ).rejects.toThrow("Request failed");
  });
});
