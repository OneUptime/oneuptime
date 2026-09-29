import { renderHook, act, waitFor } from "@testing-library/react-native";
import type { QueryClient } from "@tanstack/react-query";
import { describe, expect, test, beforeEach } from "@jest/globals";
import { useIncidents, useUnresolvedIncidentCount } from "./useIncidents";
import { fetchIncidents } from "../api/incidents";
import type { IncidentItem, ListResponse } from "../api/types";
import {
  createQueryWrapper,
  createTestQueryClient,
  makeIncident,
  makeListResponse,
} from "../__tests__/testSupport";

/*
 * useIncidents is the list the incident screen pages through and
 * useUnresolvedIncidentCount is the badge above it. They are the incident-side
 * twins of the alert hooks, and they are tested to the same standard for the
 * same reason: nothing about a thin react-query wrapper fails visibly.
 *
 * What is being pinned here is the cache's idea of identity. Every input the
 * request varies on - the project, the offset, the page size - has to be part
 * of the query key, because react-query answers from the key alone. Leave the
 * project out and a responder who works across two projects gets one
 * project's incidents rendered under the other's name; leave the offset out
 * and page two shows page one. Neither looks like a bug from the screen.
 *
 * The other half is the `enabled` guard, which keeps a request from going out
 * before a project has been chosen, and the state the hook reports while that
 * guard holds - which is a trap worth its own test, below.
 *
 * The api module is mocked: what arrives at `fetchIncidents` and what leaves
 * the hook is the entire subject here, and HTTP is somebody else's suite.
 */

jest.mock("../api/incidents", () => {
  return {
    fetchIncidents: jest.fn(),
  };
});

const fetchIncidentsMock: jest.MockedFunction<typeof fetchIncidents> =
  fetchIncidents as jest.MockedFunction<typeof fetchIncidents>;

/*
 * jest is configured with clearMocks, which forgets recorded calls but keeps
 * any implementation a previous test installed. A full reset means a test that
 * forgets to arm the mock fails loudly rather than quietly inheriting its
 * neighbour's canned response.
 */
beforeEach(() => {
  fetchIncidentsMock.mockReset();
});

describe("useIncidents", () => {
  test("hands the caller the envelope the api returned, untouched", async () => {
    /*
     * The envelope, not the rows: `count` is the only thing the screen can
     * decide "is there another page" from. A hook that helpfully unwrapped
     * `.data` would take paging away from every caller.
     */
    const response: ListResponse<IncidentItem> = makeListResponse([
      makeIncident(),
      makeIncident({ _id: "incident-2", title: "Search cluster degraded" }),
    ]);
    fetchIncidentsMock.mockResolvedValue(response);
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useIncidents("project-1");
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toEqual(response);
  });

  test("asks for the first twenty when the caller does not choose a page", async () => {
    /*
     * The defaults exist twice - once on the hook, once on fetchIncidents.
     * Asserting the exact options object is what stops them drifting apart: if
     * the hook stopped forwarding them, the request would carry no paging and
     * the api's own defaults would quietly decide the page size instead.
     */
    fetchIncidentsMock.mockResolvedValue(makeListResponse([makeIncident()]));
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useIncidents("project-1");
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(result.current.isSuccess).toBe(true);
    });
    expect(fetchIncidentsMock).toHaveBeenCalledWith("project-1", {
      skip: 0,
      limit: 20,
    });
  });

  test("passes the caller's paging window straight through to the api", async () => {
    /*
     * Note what is absent from the options object: `unresolvedOnly`. The list
     * is the full history, resolved incidents included - only the badge
     * filters. toHaveBeenCalledWith matches the object exactly, so a filter
     * leaking in here would fail this test.
     */
    fetchIncidentsMock.mockResolvedValue(makeListResponse([makeIncident()]));
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useIncidents("project-1", 40, 10);
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(result.current.isSuccess).toBe(true);
    });
    expect(fetchIncidentsMock).toHaveBeenCalledWith("project-1", {
      skip: 40,
      limit: 10,
    });
  });

  test("a second page is fetched instead of being served the first page's rows", async () => {
    /*
     * One QueryClient across both renders, which is what makes this a question
     * about the key rather than about two independent caches. The telling
     * assertion is the one on the FIRST hook after the second mounts: two
     * observers of a single cache entry always read the same data, so if
     * `skip` were missing from the key, page one would be holding page two's
     * rows by the end of this test.
     */
    const firstPage: ListResponse<IncidentItem> = makeListResponse(
      [makeIncident({ _id: "incident-1", title: "Checkout is down" })],
      { count: 2, skip: 0 },
    );
    const secondPage: ListResponse<IncidentItem> = makeListResponse(
      [makeIncident({ _id: "incident-2", title: "Payments retry storm" })],
      { count: 2, skip: 20 },
    );
    fetchIncidentsMock.mockImplementation(
      async (
        projectId: string,
        options: {
          skip?: number;
          limit?: number;
          unresolvedOnly?: boolean;
        } = {},
      ): Promise<ListResponse<IncidentItem>> => {
        return options.skip === 0 ? firstPage : secondPage;
      },
    );
    const client: QueryClient = createTestQueryClient();

    const { result: pageOne } = await renderHook(
      () => {
        return useIncidents("project-1", 0, 20);
      },
      { wrapper: createQueryWrapper(client) },
    );
    await waitFor(() => {
      return expect(pageOne.current.isSuccess).toBe(true);
    });

    const { result: pageTwo } = await renderHook(
      () => {
        return useIncidents("project-1", 20, 20);
      },
      { wrapper: createQueryWrapper(client) },
    );
    await waitFor(() => {
      return expect(pageTwo.current.isSuccess).toBe(true);
    });

    expect(pageTwo.current.data).toEqual(secondPage);
    expect(pageOne.current.data).toEqual(firstPage);
    expect(fetchIncidentsMock).toHaveBeenCalledWith("project-1", {
      skip: 20,
      limit: 20,
    });
  });

  test("a different page size is a different question, not the same one", async () => {
    /*
     * `limit` is the input most easily forgotten in a key, because changing it
     * still returns "the first page" and still looks plausible. A screen that
     * asked for fifty and was handed the twenty someone else fetched simply
     * stops scrolling early, with no error anywhere.
     */
    const twenty: ListResponse<IncidentItem> = makeListResponse(
      [makeIncident()],
      { limit: 20 },
    );
    const fifty: ListResponse<IncidentItem> = makeListResponse(
      [makeIncident(), makeIncident({ _id: "incident-2" })],
      { limit: 50 },
    );
    fetchIncidentsMock.mockImplementation(
      async (
        projectId: string,
        options: {
          skip?: number;
          limit?: number;
          unresolvedOnly?: boolean;
        } = {},
      ): Promise<ListResponse<IncidentItem>> => {
        return options.limit === 20 ? twenty : fifty;
      },
    );
    const client: QueryClient = createTestQueryClient();

    const { result: smallPage } = await renderHook(
      () => {
        return useIncidents("project-1", 0, 20);
      },
      { wrapper: createQueryWrapper(client) },
    );
    await waitFor(() => {
      return expect(smallPage.current.isSuccess).toBe(true);
    });

    const { result: largePage } = await renderHook(
      () => {
        return useIncidents("project-1", 0, 50);
      },
      { wrapper: createQueryWrapper(client) },
    );
    await waitFor(() => {
      return expect(largePage.current.isSuccess).toBe(true);
    });

    expect(largePage.current.data).toEqual(fifty);
    expect(smallPage.current.data).toEqual(twenty);
  });

  test("another project's incidents are fetched rather than served from this project's cache", async () => {
    /*
     * The failure this guards against does not look like a failure. A
     * responder on two projects switches between them inside one session and
     * one cache; without the tenant in the key, the second project's screen
     * shows the first project's incidents under the second project's name, and
     * every decision taken from that screen is about the wrong system.
     */
    const acmeIncidents: ListResponse<IncidentItem> = makeListResponse([
      makeIncident({ _id: "incident-acme", title: "Acme checkout is down" }),
    ]);
    const globexIncidents: ListResponse<IncidentItem> = makeListResponse([
      makeIncident({ _id: "incident-globex", title: "Globex API timeouts" }),
    ]);
    fetchIncidentsMock.mockImplementation(
      async (projectId: string): Promise<ListResponse<IncidentItem>> => {
        return projectId === "project-acme" ? acmeIncidents : globexIncidents;
      },
    );
    const client: QueryClient = createTestQueryClient();

    const { result: acme } = await renderHook(
      () => {
        return useIncidents("project-acme");
      },
      { wrapper: createQueryWrapper(client) },
    );
    await waitFor(() => {
      return expect(acme.current.isSuccess).toBe(true);
    });

    const { result: globex } = await renderHook(
      () => {
        return useIncidents("project-globex");
      },
      { wrapper: createQueryWrapper(client) },
    );
    await waitFor(() => {
      return expect(globex.current.isSuccess).toBe(true);
    });

    expect(globex.current.data).toEqual(globexIncidents);
    expect(acme.current.data).toEqual(acmeIncidents);
    expect(fetchIncidentsMock).toHaveBeenCalledWith("project-globex", {
      skip: 0,
      limit: 20,
    });
  });

  test("an empty project id never reaches the api", async () => {
    /*
     * This is a real moment, not a hypothetical one: the app relaunches, the
     * screen mounts, and the selected project has not come back from storage
     * yet. A request sent in that window would carry no tenant at all.
     */
    fetchIncidentsMock.mockResolvedValue(makeListResponse([makeIncident()]));
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useIncidents("");
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(result.current.fetchStatus).toBe("idle");
    });
    expect(fetchIncidentsMock).not.toHaveBeenCalled();
  });

  test("while disabled it reports pending forever, which is the trap for callers", async () => {
    /*
     * Pinning what a disabled query looks like, because it catches people out
     * and the cost of being caught is a spinner that never stops.
     *
     * In react-query v5 `pending` means "no data", NOT "a request is running".
     * A disabled query has no data and will not until something enables it, so
     * isPending stays true indefinitely. `fetchStatus` is the half that
     * describes the request, and it is "idle" here. isLoading - defined in v5
     * as pending AND fetching - is the flag that behaves the way a caller
     * expects, and it is false.
     */
    fetchIncidentsMock.mockResolvedValue(makeListResponse([makeIncident()]));
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useIncidents("");
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(result.current.fetchStatus).toBe("idle");
    });
    expect(result.current.isPending).toBe(true);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isFetching).toBe(false);
    expect(result.current.data).toBeUndefined();
  });

  test("a failed fetch surfaces as an error rather than as an empty list", async () => {
    /*
     * Rendering a failed request as zero rows tells a responder that nothing
     * is broken. The error has to arrive as an error, with data still
     * undefined, so the screen can say "could not load" instead of "all
     * clear".
     */
    const failure: Error = new Error("incident list unavailable");
    fetchIncidentsMock.mockRejectedValue(failure);
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useIncidents("project-1");
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(result.current.isError).toBe(true);
    });
    expect(result.current.error).toBe(failure);
    expect(result.current.data).toBeUndefined();
  });
});

describe("useUnresolvedIncidentCount", () => {
  test("asks for a single row, filtered to unresolved, because only the total is wanted", async () => {
    /*
     * The badge needs one number. Asking for limit 1 with the unresolved
     * filter is what keeps it cheap: the server counts everything matching and
     * the handset pays for one row of it. Dropping the limit would pull a full
     * page down behind every badge; dropping unresolvedOnly would count closed
     * incidents as outstanding work.
     */
    fetchIncidentsMock.mockResolvedValue(
      makeListResponse([makeIncident()], { count: 3, limit: 1 }),
    );
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useUnresolvedIncidentCount("project-1");
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(result.current.isSuccess).toBe(true);
    });
    expect(fetchIncidentsMock).toHaveBeenCalledWith("project-1", {
      skip: 0,
      limit: 1,
      unresolvedOnly: true,
    });
  });

  test("reports the server's total, not how many rows came back", async () => {
    /*
     * The distinction the hook exists for. One row comes back, the envelope
     * says 42, and the badge has to say 42. Counting rows instead would show
     * "1" for every project with anything open at all - wrong in the direction
     * that looks calm.
     */
    fetchIncidentsMock.mockResolvedValue(
      makeListResponse([makeIncident()], { count: 42, limit: 1 }),
    );
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useUnresolvedIncidentCount("project-1");
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toBe(42);
  });

  test("reports zero as a successful zero, not as nothing loaded", async () => {
    /*
     * Zero is falsy, and any `|| fallback` in the path from envelope to badge
     * would turn "nothing outstanding" into "still loading". A quiet project
     * is the ordinary case, so it has to come through as a plain successful 0.
     */
    fetchIncidentsMock.mockResolvedValue(
      makeListResponse([] as Array<IncidentItem>, { count: 0, limit: 1 }),
    );
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useUnresolvedIncidentCount("project-1");
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toBe(0);
  });

  test("each project gets its own count rather than the first one asked for", async () => {
    const client: QueryClient = createTestQueryClient();
    fetchIncidentsMock.mockImplementation(
      async (projectId: string): Promise<ListResponse<IncidentItem>> => {
        return makeListResponse([makeIncident()], {
          count: projectId === "project-acme" ? 5 : 11,
          limit: 1,
        });
      },
    );

    const { result: acme } = await renderHook(
      () => {
        return useUnresolvedIncidentCount("project-acme");
      },
      { wrapper: createQueryWrapper(client) },
    );
    await waitFor(() => {
      return expect(acme.current.isSuccess).toBe(true);
    });

    const { result: globex } = await renderHook(
      () => {
        return useUnresolvedIncidentCount("project-globex");
      },
      { wrapper: createQueryWrapper(client) },
    );
    await waitFor(() => {
      return expect(globex.current.isSuccess).toBe(true);
    });

    expect(globex.current.data).toBe(11);
    expect(acme.current.data).toBe(5);
  });

  test("an empty project id never reaches the api", async () => {
    fetchIncidentsMock.mockResolvedValue(
      makeListResponse([makeIncident()], { count: 1, limit: 1 }),
    );
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useUnresolvedIncidentCount("");
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(result.current.fetchStatus).toBe("idle");
    });
    expect(fetchIncidentsMock).not.toHaveBeenCalled();
    expect(result.current.isPending).toBe(true);
    expect(result.current.data).toBeUndefined();
  });

  test("a failed count surfaces as an error rather than as zero", async () => {
    /*
     * A badge is read at a glance and never questioned. Resolving a failure to
     * 0 would tell the responder "nothing outstanding" on exactly the
     * occasions when the app has no idea.
     */
    const failure: Error = new Error("count unavailable");
    fetchIncidentsMock.mockRejectedValue(failure);
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useUnresolvedIncidentCount("project-1");
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(result.current.isError).toBe(true);
    });
    expect(result.current.error).toBe(failure);
    expect(result.current.data).toBeUndefined();
  });
});

describe("the incident list and the incident badge sharing one cache", () => {
  test("the count does not land on top of the list for the same project", async () => {
    /*
     * Both keys open with "incidents" and both carry the same project id; the
     * only thing keeping them apart is the "unresolved-count" segment wedged
     * between them. Drop it and one entry overwrites the other - and the two
     * do not even hold the same shape, so the list screen would be handed a
     * bare number or the badge a whole envelope. Two entries, two shapes, is
     * what this asserts.
     */
    fetchIncidentsMock.mockImplementation(
      async (
        projectId: string,
        options: {
          skip?: number;
          limit?: number;
          unresolvedOnly?: boolean;
        } = {},
      ): Promise<ListResponse<IncidentItem>> => {
        return makeListResponse([makeIncident()], {
          count: options.unresolvedOnly ? 7 : 1,
          limit: options.limit,
        });
      },
    );
    const client: QueryClient = createTestQueryClient();

    const { result: list } = await renderHook(
      () => {
        return useIncidents("project-1");
      },
      { wrapper: createQueryWrapper(client) },
    );
    const { result: badge } = await renderHook(
      () => {
        return useUnresolvedIncidentCount("project-1");
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(list.current.isSuccess).toBe(true);
    });
    await waitFor(() => {
      return expect(badge.current.isSuccess).toBe(true);
    });

    expect(badge.current.data).toBe(7);
    expect(list.current.data?.data).toHaveLength(1);
    expect(client.getQueryCache().getAll()).toHaveLength(2);
  });

  test("both are refreshed by one invalidation of the incidents prefix", async () => {
    /*
     * The upside of that shared first segment. Once a responder acknowledges
     * something, invalidating "incidents" has to refresh the list AND the
     * badge: a badge still showing the old number above a row that has already
     * changed state is the kind of self-contradiction that makes people stop
     * believing the screen.
     */
    fetchIncidentsMock.mockResolvedValue(
      makeListResponse([makeIncident()], { count: 1 }),
    );
    const client: QueryClient = createTestQueryClient();

    const { result: list } = await renderHook(
      () => {
        return useIncidents("project-1");
      },
      { wrapper: createQueryWrapper(client) },
    );
    const { result: badge } = await renderHook(
      () => {
        return useUnresolvedIncidentCount("project-1");
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(list.current.isSuccess).toBe(true);
    });
    await waitFor(() => {
      return expect(badge.current.isSuccess).toBe(true);
    });
    expect(fetchIncidentsMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      await client.invalidateQueries({ queryKey: ["incidents"] });
    });

    await waitFor(() => {
      return expect(fetchIncidentsMock).toHaveBeenCalledTimes(4);
    });
  });
});
