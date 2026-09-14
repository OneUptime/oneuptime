import { renderHook, waitFor } from "@testing-library/react-native";
import type { QueryClient, UseQueryResult } from "@tanstack/react-query";
import {
  useIncidentEpisodes,
  useUnresolvedIncidentEpisodeCount,
} from "./useIncidentEpisodes";
import { fetchIncidentEpisodes } from "../api/incidentEpisodes";
import {
  createQueryWrapper,
  createTestQueryClient,
  makeIncidentEpisode,
  makeListResponse,
} from "../__tests__/testSupport";
import type { IncidentEpisodeItem, ListResponse } from "../api/types";
import { describe, expect, test, beforeEach } from "@jest/globals";

jest.mock("../api/incidentEpisodes", () => {
  return {
    fetchIncidentEpisodes: jest.fn(),
  };
});

/*
 * Two hooks over one endpoint: the paged list a responder scrolls, and the
 * unresolved count that ends up on a badge.
 *
 * Paging is what makes the list hook worth this much attention. `skip` and
 * `limit` decide which slice of the project the request asks for, so both of
 * them have to be part of the cache key. If they were not, page two would be
 * served page one out of the cache - a list that scrolls forever showing the
 * same twenty episodes, with no error and nothing in the logs to explain it.
 * The tests prove it the only way that regression can be caught: render the
 * hook twice against ONE QueryClient with different windows, and watch the api
 * be asked twice.
 *
 * The count hook has a different failure mode. It deliberately asks for one
 * row and reads `count` off the ENVELOPE rather than measuring the rows it got
 * back, because the rows are a sample and the count is the answer. A hook that
 * returned `data.length` here would put "1" on a badge over a project with
 * fifty unresolved episodes, which reads as "almost nothing to do".
 */

function fetchMock(): jest.MockedFunction<typeof fetchIncidentEpisodes> {
  return fetchIncidentEpisodes as jest.MockedFunction<
    typeof fetchIncidentEpisodes
  >;
}

interface EpisodesArgs {
  projectId: string;
  skip?: number;
  limit?: number;
}

/*
 * renderHook is asynchronous in @testing-library/react-native v14 and its
 * result is a live ref, so the helpers hand back the whole render rather than
 * a snapshot of `result.current`.
 */
interface EpisodesRender {
  result: {
    current: UseQueryResult<ListResponse<IncidentEpisodeItem>, Error>;
  };
  rerender: (args: EpisodesArgs) => Promise<void>;
}

interface CountRender {
  result: { current: UseQueryResult<number, Error> };
}

/*
 * `skip` and `limit` are passed straight through as possibly-undefined, which
 * is what lets one helper cover both the explicit windows and the hook's own
 * defaults: calling a defaulted parameter with undefined applies the default,
 * exactly as omitting the argument would.
 */
async function renderEpisodes(
  client: QueryClient,
  args: EpisodesArgs,
): Promise<EpisodesRender> {
  return renderHook(
    (current: EpisodesArgs) => {
      return useIncidentEpisodes(
        current.projectId,
        current.skip,
        current.limit,
      );
    },
    {
      initialProps: args,
      wrapper: createQueryWrapper(client),
    },
  );
}

async function renderLoadedEpisodes(
  client: QueryClient,
  args: EpisodesArgs,
): Promise<EpisodesRender> {
  const rendered: EpisodesRender = await renderEpisodes(client, args);

  await waitFor(() => {
    return expect(rendered.result.current.isSuccess).toBe(true);
  });

  return rendered;
}

async function renderUnresolvedCount(
  client: QueryClient,
  projectId: string,
): Promise<CountRender> {
  return renderHook(
    () => {
      return useUnresolvedIncidentEpisodeCount(projectId);
    },
    {
      wrapper: createQueryWrapper(client),
    },
  );
}

describe("useIncidentEpisodes", () => {
  let client: QueryClient;

  beforeEach(() => {
    /*
     * A fresh client per test, because a cache that outlived a test could
     * answer the next one's fetch and turn a broken key into a green
     * assertion.
     */
    client = createTestQueryClient();
    fetchMock().mockReset();
    fetchMock().mockResolvedValue(makeListResponse<IncidentEpisodeItem>([]));
  });

  test("hands the whole page envelope back to the caller, count and all", async () => {
    /*
     * The rows are only half of what a paged list needs. `count` is the total
     * on the server, and it is what tells the screen whether there is another
     * page to ask for - a hook that unwrapped the envelope down to the rows
     * would leave the list unable to know it had reached the end.
     */
    const page: ListResponse<IncidentEpisodeItem> = makeListResponse(
      [
        makeIncidentEpisode({ _id: "episode-1", episodeNumber: 2 }),
        makeIncidentEpisode({ _id: "episode-2", episodeNumber: 1 }),
      ],
      { count: 31 },
    );
    fetchMock().mockResolvedValue(page);

    const { result } = await renderLoadedEpisodes(client, {
      projectId: "project-1",
    });

    expect(result.current.data).toEqual(page);
  });

  test("asks for the first page of twenty when the caller does not choose a window", async () => {
    await renderLoadedEpisodes(client, { projectId: "project-1" });

    expect(fetchMock()).toHaveBeenCalledTimes(1);
    expect(fetchMock()).toHaveBeenCalledWith("project-1", {
      skip: 0,
      limit: 20,
    });
  });

  test("passes the caller's paging window through to the api untouched", async () => {
    await renderLoadedEpisodes(client, {
      projectId: "project-1",
      skip: 40,
      limit: 10,
    });

    expect(fetchMock()).toHaveBeenCalledWith("project-1", {
      skip: 40,
      limit: 10,
    });
  });

  test("stores the page under a key naming the hook, the project and the window", async () => {
    /*
     * Pinning the literal key earns its own test. Every input the request
     * depends on is in it - and it is worth reading in that order, because the
     * unresolved count below hangs off the same "incident-episodes" prefix and
     * has to stay a different entry.
     */
    const page: ListResponse<IncidentEpisodeItem> = makeListResponse([
      makeIncidentEpisode(),
    ]);
    fetchMock().mockResolvedValue(page);

    await renderLoadedEpisodes(client, {
      projectId: "project-1",
      skip: 20,
      limit: 20,
    });

    expect(
      client.getQueryData(["incident-episodes", "project-1", 20, 20]),
    ).toEqual(page);
    expect(client.getQueryCache().getAll()).toHaveLength(1);
  });

  test("fetches the second page rather than serving the first one again", async () => {
    /*
     * With `skip` missing from the key this is what a responder would see: a
     * list that pages forever and keeps handing back the same twenty episodes.
     * Both hooks stay mounted on the same client, so a shared cache entry
     * shows up here as a single api call.
     */
    const firstPage: ListResponse<IncidentEpisodeItem> = makeListResponse(
      [makeIncidentEpisode({ _id: "episode-1" })],
      { count: 40 },
    );
    const secondPage: ListResponse<IncidentEpisodeItem> = makeListResponse(
      [makeIncidentEpisode({ _id: "episode-21" })],
      { count: 40, skip: 20 },
    );
    fetchMock()
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(secondPage);

    const first: EpisodesRender = await renderLoadedEpisodes(client, {
      projectId: "project-1",
      skip: 0,
      limit: 20,
    });
    const second: EpisodesRender = await renderLoadedEpisodes(client, {
      projectId: "project-1",
      skip: 20,
      limit: 20,
    });

    expect(fetchMock()).toHaveBeenCalledTimes(2);
    expect(fetchMock()).toHaveBeenNthCalledWith(2, "project-1", {
      skip: 20,
      limit: 20,
    });
    expect(first.result.current.data).toEqual(firstPage);
    expect(second.result.current.data).toEqual(secondPage);
  });

  test("asking for a bigger page fetches it instead of reusing the smaller one", async () => {
    /*
     * `limit` is in the key for the same reason `skip` is. A cached window of
     * twenty handed to a caller that asked for fifty would silently truncate
     * the list, and the caller has no way to tell a short page from the end of
     * the data.
     */
    const smallPage: ListResponse<IncidentEpisodeItem> = makeListResponse(
      [makeIncidentEpisode({ _id: "episode-1" })],
      { count: 40, limit: 20 },
    );
    const largePage: ListResponse<IncidentEpisodeItem> = makeListResponse(
      [
        makeIncidentEpisode({ _id: "episode-1" }),
        makeIncidentEpisode({ _id: "episode-2" }),
      ],
      { count: 40, limit: 50 },
    );
    fetchMock()
      .mockResolvedValueOnce(smallPage)
      .mockResolvedValueOnce(largePage);

    await renderLoadedEpisodes(client, {
      projectId: "project-1",
      skip: 0,
      limit: 20,
    });
    const larger: EpisodesRender = await renderLoadedEpisodes(client, {
      projectId: "project-1",
      skip: 0,
      limit: 50,
    });

    expect(fetchMock()).toHaveBeenCalledTimes(2);
    expect(larger.result.current.data).toEqual(largePage);
  });

  test("never serves one project's episodes for another project", async () => {
    /*
     * The worst version of a missing key part. The project id becomes the
     * tenant header, so it decides whose episodes come back; if it fell out of
     * the key, switching projects would leave the previous tenant's episodes
     * on screen under the new project's name.
     */
    const firstProjectPage: ListResponse<IncidentEpisodeItem> =
      makeListResponse([makeIncidentEpisode({ _id: "episode-in-project-1" })]);
    const secondProjectPage: ListResponse<IncidentEpisodeItem> =
      makeListResponse([makeIncidentEpisode({ _id: "episode-in-project-2" })]);
    fetchMock()
      .mockResolvedValueOnce(firstProjectPage)
      .mockResolvedValueOnce(secondProjectPage);

    const first: EpisodesRender = await renderLoadedEpisodes(client, {
      projectId: "project-1",
    });
    const second: EpisodesRender = await renderLoadedEpisodes(client, {
      projectId: "project-2",
    });

    expect(fetchMock()).toHaveBeenCalledTimes(2);
    expect(fetchMock()).toHaveBeenNthCalledWith(2, "project-2", {
      skip: 0,
      limit: 20,
    });
    expect(first.result.current.data).toEqual(firstProjectPage);
    expect(second.result.current.data).toEqual(secondProjectPage);
  });

  test("does not call the api before a project is known", async () => {
    await renderEpisodes(client, { projectId: "" });

    expect(fetchMock()).not.toHaveBeenCalled();
  });

  test("a disabled query reports itself pending with nothing in flight", async () => {
    /*
     * Worth pinning because it is a trap for the next caller. In react-query
     * v5 `isPending` means "there is no data yet", NOT "a request is running",
     * so a query held back by `enabled` reports isPending true forever;
     * `fetchStatus` is the field that says whether anything is actually in
     * flight. A list screen that shows its spinner on isPending therefore
     * spins indefinitely before a project is selected, with no request behind
     * it. `isLoading` - pending AND fetching - is the flag that behaves the
     * way callers expect, and it is false here.
     */
    const { result } = await renderEpisodes(client, { projectId: "" });

    expect(result.current.isPending).toBe(true);
    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isFetching).toBe(false);
    expect(result.current.data).toBeUndefined();
  });

  test("starts fetching as soon as a project id arrives", async () => {
    const page: ListResponse<IncidentEpisodeItem> = makeListResponse([
      makeIncidentEpisode(),
    ]);
    fetchMock().mockResolvedValue(page);

    const rendered: EpisodesRender = await renderEpisodes(client, {
      projectId: "",
    });

    expect(fetchMock()).not.toHaveBeenCalled();

    await rendered.rerender({ projectId: "project-1" });

    await waitFor(() => {
      return expect(rendered.result.current.isSuccess).toBe(true);
    });
    expect(fetchMock()).toHaveBeenCalledWith("project-1", {
      skip: 0,
      limit: 20,
    });
    expect(rendered.result.current.data).toEqual(page);
  });

  test("surfaces an api rejection as an error carrying the reason", async () => {
    fetchMock().mockRejectedValue(new Error("Network request failed"));

    const { result } = await renderEpisodes(client, { projectId: "project-1" });

    await waitFor(() => {
      return expect(result.current.isError).toBe(true);
    });
    expect(result.current.error?.message).toBe("Network request failed");
  });

  test("does not answer a failed request with an empty page", async () => {
    /*
     * `data` staying undefined is the difference between "this project has no
     * episodes" and "we could not reach the server". A hook that folded the
     * failure into an empty envelope would show a reassuring empty state to
     * somebody who is on call and cannot see their work.
     */
    fetchMock().mockRejectedValue(new Error("Network request failed"));

    const { result } = await renderEpisodes(client, { projectId: "project-1" });

    await waitFor(() => {
      return expect(result.current.isError).toBe(true);
    });
    expect(result.current.data).toBeUndefined();
  });
});

describe("useUnresolvedIncidentEpisodeCount", () => {
  let client: QueryClient;

  beforeEach(() => {
    client = createTestQueryClient();
    fetchMock().mockReset();
    fetchMock().mockResolvedValue(makeListResponse<IncidentEpisodeItem>([]));
  });

  test("asks for a single unresolved row rather than reading the whole list", async () => {
    /*
     * A badge needs a number, not the episodes behind it. Asking for limit 1
     * with the unresolved filter is what keeps a project with hundreds of open
     * episodes from paging all of them down a mobile connection every time the
     * badge refreshes.
     */
    const { result } = await renderUnresolvedCount(client, "project-1");

    await waitFor(() => {
      return expect(result.current.isSuccess).toBe(true);
    });
    expect(fetchMock()).toHaveBeenCalledWith("project-1", {
      skip: 0,
      limit: 1,
      unresolvedOnly: true,
    });
  });

  test("reports the server's total, not the number of rows it was sent", async () => {
    /*
     * This is the whole point of the hook, and the one line of it that can be
     * wrong without anything looking wrong. The request asks for one row; the
     * envelope's `count` is the real number of unresolved episodes. Measuring
     * the rows instead would pin the badge at 1 no matter how much work is
     * waiting.
     */
    fetchMock().mockResolvedValue(
      makeListResponse([makeIncidentEpisode()], { count: 42, limit: 1 }),
    );

    const { result } = await renderUnresolvedCount(client, "project-1");

    await waitFor(() => {
      return expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toBe(42);
  });

  test("a project with nothing unresolved reports zero", async () => {
    /*
     * Zero is the value most likely to be mangled on its way to a badge, since
     * every truthiness check in the chain treats it as absent. It has to
     * arrive as a successful 0 rather than as undefined.
     */
    fetchMock().mockResolvedValue(
      makeListResponse<IncidentEpisodeItem>([], { count: 0, limit: 1 }),
    );

    const { result } = await renderUnresolvedCount(client, "project-1");

    await waitFor(() => {
      return expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toBe(0);
  });

  test("counts each project separately", async () => {
    fetchMock()
      .mockResolvedValueOnce(
        makeListResponse([makeIncidentEpisode()], { count: 42, limit: 1 }),
      )
      .mockResolvedValueOnce(
        makeListResponse([makeIncidentEpisode()], { count: 7, limit: 1 }),
      );

    const first: CountRender = await renderUnresolvedCount(client, "project-1");
    await waitFor(() => {
      return expect(first.result.current.isSuccess).toBe(true);
    });
    const second: CountRender = await renderUnresolvedCount(
      client,
      "project-2",
    );
    await waitFor(() => {
      return expect(second.result.current.isSuccess).toBe(true);
    });

    expect(fetchMock()).toHaveBeenCalledTimes(2);
    expect(first.result.current.data).toBe(42);
    expect(second.result.current.data).toBe(7);
  });

  test("does not share a cache entry with the first page of the list", async () => {
    /*
     * Both keys begin with "incident-episodes" - deliberately, so that
     * invalidating that prefix after a state change refreshes the list and the
     * badge together. What must NOT happen is the two collapsing into one
     * entry: they ask different questions of the endpoint (one row, unresolved
     * only, versus a page of everything) and they hand back different types.
     * Whichever mounted second would be served the other's answer.
     */
    fetchMock().mockResolvedValue(
      makeListResponse([makeIncidentEpisode()], { count: 42 }),
    );

    const list: EpisodesRender = await renderLoadedEpisodes(client, {
      projectId: "project-1",
    });
    const count: CountRender = await renderUnresolvedCount(client, "project-1");
    await waitFor(() => {
      return expect(count.result.current.isSuccess).toBe(true);
    });

    expect(fetchMock()).toHaveBeenCalledTimes(2);
    expect(fetchMock()).toHaveBeenNthCalledWith(1, "project-1", {
      skip: 0,
      limit: 20,
    });
    expect(fetchMock()).toHaveBeenNthCalledWith(2, "project-1", {
      skip: 0,
      limit: 1,
      unresolvedOnly: true,
    });
    expect(client.getQueryCache().getAll()).toHaveLength(2);
    expect(count.result.current.data).toBe(42);
    expect(list.result.current.data?.count).toBe(42);
    expect(list.result.current.data?.data).toHaveLength(1);
  });

  test("does not call the api before a project is known", async () => {
    const { result } = await renderUnresolvedCount(client, "");

    expect(fetchMock()).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.data).toBeUndefined();
  });

  test("surfaces an api rejection as an error rather than as a count of nothing", async () => {
    /*
     * A badge that reads 0 because the request failed is worse than a badge
     * that reads nothing: it says, specifically and wrongly, that there is
     * nothing to respond to.
     */
    fetchMock().mockRejectedValue(new Error("Network request failed"));

    const { result } = await renderUnresolvedCount(client, "project-1");

    await waitFor(() => {
      return expect(result.current.isError).toBe(true);
    });
    expect(result.current.error?.message).toBe("Network request failed");
    expect(result.current.data).toBeUndefined();
  });
});
