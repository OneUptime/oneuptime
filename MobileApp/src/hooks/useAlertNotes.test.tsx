import { renderHook, waitFor } from "@testing-library/react-native";
import type { QueryClient, UseQueryResult } from "@tanstack/react-query";
import { useAlertNotes } from "./useAlertNotes";
import { fetchAlertNotes } from "../api/alertNotes";
import {
  createQueryWrapper,
  createTestQueryClient,
  makeNote,
} from "../__tests__/testSupport";
import type { NoteItem } from "../api/types";
import { describe, expect, test, beforeEach } from "@jest/globals";

jest.mock("../api/alertNotes", () => {
  return {
    fetchAlertNotes: jest.fn(),
  };
});

/*
 * The internal notes on an alert: what was tried, who was woken, why it was
 * closed. The hook is six lines of react-query around one api call, which is
 * exactly why it is worth pinning - everything that can go wrong with it goes
 * wrong silently, on somebody's phone, at three in the morning.
 *
 * The cache key is the dangerous part. It has to carry BOTH the project and
 * the alert, because both of them change what the request asks for. If either
 * fell out of it, the notes belonging to whichever alert was opened first
 * would be handed to every alert opened afterwards, and nothing on the screen
 * would say so - the responder would simply be reading somebody else's
 * investigation. The tests below prove the key the only way that regression
 * can be caught: render the hook twice against ONE QueryClient with different
 * arguments, and watch the api be asked twice. With an argument missing from
 * the key, the second render is served the first one's cache and the api is
 * only ever called once.
 *
 * The `enabled` guard is the other half. A detail screen mounts before its
 * navigation params have settled, so this hook is routinely called with empty
 * strings; a request built from an empty alert id filters on nothing useful
 * and spends a round trip of the responder's mobile connection to find that
 * out.
 */

function fetchMock(): jest.MockedFunction<typeof fetchAlertNotes> {
  return fetchAlertNotes as jest.MockedFunction<typeof fetchAlertNotes>;
}

interface NotesArgs {
  projectId: string;
  alertId: string;
}

/*
 * renderHook is asynchronous in @testing-library/react-native v14 and its
 * result is a live ref, so every helper here hands back the whole render
 * rather than a snapshot of `result.current`.
 */
interface NotesRender {
  result: { current: UseQueryResult<NoteItem[], Error> };
  rerender: (args: NotesArgs) => Promise<void>;
}

async function renderNotes(
  client: QueryClient,
  args: NotesArgs,
): Promise<NotesRender> {
  return renderHook(
    (current: NotesArgs) => {
      return useAlertNotes(current.projectId, current.alertId);
    },
    {
      initialProps: args,
      wrapper: createQueryWrapper(client),
    },
  );
}

async function renderLoadedNotes(
  client: QueryClient,
  args: NotesArgs,
): Promise<NotesRender> {
  const rendered: NotesRender = await renderNotes(client, args);

  await waitFor(() => {
    return expect(rendered.result.current.isSuccess).toBe(true);
  });

  return rendered;
}

describe("useAlertNotes", () => {
  let client: QueryClient;

  beforeEach(() => {
    /*
     * A fresh client per test, because a query cache that outlived a test
     * could answer the next one's fetch and turn a broken key into a passing
     * assertion.
     */
    client = createTestQueryClient();
    fetchMock().mockReset();
    fetchMock().mockResolvedValue([]);
  });

  test("hands back the notes the api answered with, in the order it answered", async () => {
    /*
     * The api sorts newest-first and the notes section renders straight down
     * whatever it is given, so the hook re-ordering or re-shaping the rows
     * would silently rewrite the handover.
     */
    const notes: NoteItem[] = [
      makeNote({ _id: "note-newest", note: "Paged the database team." }),
      makeNote({ _id: "note-oldest", note: "Acknowledged from the phone." }),
    ];
    fetchMock().mockResolvedValue(notes);

    const { result } = await renderLoadedNotes(client, {
      projectId: "project-1",
      alertId: "alert-1",
    });

    expect(result.current.data).toEqual(notes);
  });

  test("an alert nobody has written on yet loads as an empty list, not as a failure", async () => {
    fetchMock().mockResolvedValue([]);

    const { result } = await renderLoadedNotes(client, {
      projectId: "project-1",
      alertId: "alert-1",
    });

    expect(result.current.data).toEqual([]);
    expect(result.current.isError).toBe(false);
  });

  test("asks the api for exactly the project and alert it was handed, once", async () => {
    /*
     * Both arguments are plain strings in adjacent positions, so transposing
     * them compiles perfectly happily; the assertion on the call is the only
     * thing that notices.
     */
    await renderLoadedNotes(client, {
      projectId: "project-1",
      alertId: "alert-1",
    });

    expect(fetchMock()).toHaveBeenCalledTimes(1);
    expect(fetchMock()).toHaveBeenCalledWith("project-1", "alert-1");
  });

  test("stores its answer under a key naming the hook, the project and the alert", async () => {
    /*
     * Pinning the literal key is worth one test on its own: the "alert-notes"
     * prefix is what keeps these rows out of the incident notes cache, and the
     * two ids after it are what keep one alert's rows out of another's.
     * Reading it back by exact key and then checking the cache holds nothing
     * else proves the key has these three parts and no more.
     */
    const notes: NoteItem[] = [makeNote()];
    fetchMock().mockResolvedValue(notes);

    await renderLoadedNotes(client, {
      projectId: "project-1",
      alertId: "alert-1",
    });

    expect(
      client.getQueryData(["alert-notes", "project-1", "alert-1"]),
    ).toEqual(notes);
    expect(client.getQueryCache().getAll()).toHaveLength(1);
  });

  test("fetches a second alert's notes rather than serving the first alert's", async () => {
    /*
     * The regression this catches is the one a responder cannot see: open
     * alert-1, read its notes, back out, open alert-2 and be shown alert-1's
     * notes because the alert id was not in the key. Both hooks stay mounted
     * on the same client here, so a shared cache entry would show up as a
     * single api call.
     */
    const firstNotes: NoteItem[] = [
      makeNote({ _id: "note-a", note: "Restarted the pod." }),
    ];
    const secondNotes: NoteItem[] = [
      makeNote({ _id: "note-b", note: "Rolled the deploy back." }),
    ];
    fetchMock()
      .mockResolvedValueOnce(firstNotes)
      .mockResolvedValueOnce(secondNotes);

    const first: NotesRender = await renderLoadedNotes(client, {
      projectId: "project-1",
      alertId: "alert-1",
    });
    const second: NotesRender = await renderLoadedNotes(client, {
      projectId: "project-1",
      alertId: "alert-2",
    });

    expect(fetchMock()).toHaveBeenCalledTimes(2);
    expect(fetchMock()).toHaveBeenNthCalledWith(1, "project-1", "alert-1");
    expect(fetchMock()).toHaveBeenNthCalledWith(2, "project-1", "alert-2");
    expect(first.result.current.data).toEqual(firstNotes);
    expect(second.result.current.data).toEqual(secondNotes);
  });

  test("fetches again when the project changes, even for the same alert id", async () => {
    /*
     * The project id is not decoration on the way to the same request: it
     * becomes the tenant header, so it decides which project the server reads
     * the notes out of. Anything that changes the request has to be in the key
     * that identifies the answer, or a project switch is served the previous
     * tenant's response.
     */
    const firstNotes: NoteItem[] = [makeNote({ _id: "note-a" })];
    const secondNotes: NoteItem[] = [makeNote({ _id: "note-b" })];
    fetchMock()
      .mockResolvedValueOnce(firstNotes)
      .mockResolvedValueOnce(secondNotes);

    const first: NotesRender = await renderLoadedNotes(client, {
      projectId: "project-1",
      alertId: "alert-1",
    });
    const second: NotesRender = await renderLoadedNotes(client, {
      projectId: "project-2",
      alertId: "alert-1",
    });

    expect(fetchMock()).toHaveBeenCalledTimes(2);
    expect(fetchMock()).toHaveBeenNthCalledWith(2, "project-2", "alert-1");
    expect(first.result.current.data).toEqual(firstNotes);
    expect(second.result.current.data).toEqual(secondNotes);
  });

  test("does not call the api before the project id is known", async () => {
    await renderNotes(client, { projectId: "", alertId: "alert-1" });

    expect(fetchMock()).not.toHaveBeenCalled();
  });

  test("does not call the api before the alert id is known", async () => {
    await renderNotes(client, { projectId: "project-1", alertId: "" });

    expect(fetchMock()).not.toHaveBeenCalled();
  });

  test("a disabled query reports itself pending with nothing in flight", async () => {
    /*
     * Worth pinning because it is a trap for the next caller. In react-query
     * v5 `isPending` means "there is no data yet", NOT "a request is running",
     * so a query held back by `enabled` reports isPending true forever;
     * `fetchStatus` is the field that says whether anything is actually in
     * flight. A screen that shows its spinner on isPending therefore spins
     * indefinitely while the route params are still empty, with no request
     * behind it. `isLoading` - pending AND fetching - is the flag that
     * behaves the way callers expect, and it is false here.
     */
    const { result } = await renderNotes(client, {
      projectId: "project-1",
      alertId: "",
    });

    expect(result.current.isPending).toBe(true);
    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isFetching).toBe(false);
    expect(result.current.data).toBeUndefined();
  });

  test("starts fetching as soon as both ids arrive", async () => {
    /*
     * The guard has to hold the query back and then let it go: a detail screen
     * that mounted a beat before its params resolved would otherwise sit on an
     * empty notes section until something else forced a re-render.
     */
    const notes: NoteItem[] = [makeNote()];
    fetchMock().mockResolvedValue(notes);

    const rendered: NotesRender = await renderNotes(client, {
      projectId: "project-1",
      alertId: "",
    });

    expect(fetchMock()).not.toHaveBeenCalled();

    await rendered.rerender({ projectId: "project-1", alertId: "alert-1" });

    await waitFor(() => {
      return expect(rendered.result.current.isSuccess).toBe(true);
    });
    expect(fetchMock()).toHaveBeenCalledWith("project-1", "alert-1");
    expect(rendered.result.current.data).toEqual(notes);
  });

  test("surfaces an api rejection as an error carrying the reason", async () => {
    fetchMock().mockRejectedValue(new Error("Network request failed"));

    const { result } = await renderNotes(client, {
      projectId: "project-1",
      alertId: "alert-1",
    });

    await waitFor(() => {
      return expect(result.current.isError).toBe(true);
    });
    expect(result.current.error?.message).toBe("Network request failed");
  });

  test("does not answer a failed request with an empty note list", async () => {
    /*
     * `data` staying undefined is the entire difference between "this alert
     * has no notes" and "we could not find out". The detail screen renders the
     * notes section straight from `data`, so a hook that turned a failure into
     * [] would tell a responder there is no handover to read when there may be
     * pages of it.
     */
    fetchMock().mockRejectedValue(new Error("Network request failed"));

    const { result } = await renderNotes(client, {
      projectId: "project-1",
      alertId: "alert-1",
    });

    await waitFor(() => {
      return expect(result.current.isError).toBe(true);
    });
    expect(result.current.data).toBeUndefined();
  });
});
