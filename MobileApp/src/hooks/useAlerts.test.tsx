import { renderHook, act, waitFor } from "@testing-library/react-native";
import type { QueryClient } from "@tanstack/react-query";
import { describe, expect, test, beforeEach } from "@jest/globals";
import { useAlerts, useUnresolvedAlertCount } from "./useAlerts";
import { fetchAlerts } from "../api/alerts";
import type { AlertItem, ListResponse } from "../api/types";
import {
  createQueryWrapper,
  createTestQueryClient,
  makeAlert,
  makeListResponse,
} from "../__tests__/testSupport";

/*
 * useAlerts is the list every project's alert screen pages through, and
 * useUnresolvedAlertCount is the badge sitting on top of it. Both are thin
 * react-query wrappers, which is precisely why they are worth pinning down:
 * the few things a wrapper this small can get wrong are invisible on the
 * screen until they are expensive.
 *
 * The query key is the cache's notion of identity. Everything the fetch varies
 * on - the project, the page offset, the page size - has to appear in it, or
 * react-query will cheerfully answer a request for one thing with a copy of
 * another. The failure that matters is not an off-by-one page: it is one
 * project's alerts rendered under a different project's name, because the
 * tenant was not part of what the cache considered the question.
 *
 * The `enabled` guard is what stops a fetch going out with no tenant to send
 * it to. It is asserted both ways below - that nothing is requested, and what
 * the hook reports while nothing is requested - because the second half is a
 * trap for callers (see the comment on that test).
 *
 * The api module is mocked because none of that is about HTTP. What reaches
 * `fetchAlerts` and what comes back out of the hook is the whole subject.
 */

jest.mock("../api/alerts", () => {
  return {
    fetchAlerts: jest.fn(),
  };
});

const fetchAlertsMock: jest.MockedFunction<typeof fetchAlerts> =
  fetchAlerts as jest.MockedFunction<typeof fetchAlerts>;

/*
 * jest is configured with clearMocks, which forgets recorded calls but keeps
 * whatever implementation a previous test installed. Resetting fully means a
 * test that forgets to arm the mock fails loudly instead of quietly reusing
 * its neighbour's canned response.
 */
beforeEach(() => {
  fetchAlertsMock.mockReset();
});

describe("useAlerts", () => {
  test("hands the caller the envelope the api returned, untouched", async () => {
    /*
     * The screen needs the whole envelope, not just the rows: `count` is what
     * tells it whether there is another page to ask for. A hook that helpfully
     * unwrapped `.data` would strip the only thing paging can be driven by.
     */
    const response: ListResponse<AlertItem> = makeListResponse([
      makeAlert(),
      makeAlert({ _id: "alert-2", title: "CPU pegged at 100%" }),
    ]);
    fetchAlertsMock.mockResolvedValue(response);
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAlerts("project-1");
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
     * The defaults live on the hook AND on fetchAlerts. Asserting the exact
     * options object here is what keeps them from drifting apart: if the hook
     * ever stopped passing them, this call would arrive with no paging at all
     * and the api's own defaults would silently decide the page size.
     */
    fetchAlertsMock.mockResolvedValue(makeListResponse([makeAlert()]));
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAlerts("project-1");
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(result.current.isSuccess).toBe(true);
    });
    expect(fetchAlertsMock).toHaveBeenCalledWith("project-1", {
      skip: 0,
      limit: 20,
    });
  });

  test("passes the caller's paging window straight through to the api", async () => {
    /*
     * Note what is NOT in the options object: `unresolvedOnly`. The list is
     * the whole history, resolved alerts included; only the badge filters.
     * toHaveBeenCalledWith compares the object exactly, so a stray filter
     * appearing here would fail this test.
     */
    fetchAlertsMock.mockResolvedValue(makeListResponse([makeAlert()]));
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAlerts("project-1", 40, 10);
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(result.current.isSuccess).toBe(true);
    });
    expect(fetchAlertsMock).toHaveBeenCalledWith("project-1", {
      skip: 40,
      limit: 10,
    });
  });

  test("a second page is fetched instead of being served the first page's rows", async () => {
    /*
     * Both renders share one QueryClient, so this is the real question: does
     * the cache consider "page 1" and "page 2" the same question? The tell is
     * the FIRST hook after the second one mounts. Two observers of one cache
     * entry always show the same data, so if `skip` had been left out of the
     * key, page one's screen would be holding page two's rows here.
     */
    const firstPage: ListResponse<AlertItem> = makeListResponse(
      [makeAlert({ _id: "alert-1", title: "Disk almost full" })],
      { count: 2, skip: 0 },
    );
    const secondPage: ListResponse<AlertItem> = makeListResponse(
      [makeAlert({ _id: "alert-2", title: "Queue backing up" })],
      { count: 2, skip: 20 },
    );
    fetchAlertsMock.mockImplementation(
      async (
        projectId: string,
        options: {
          skip?: number;
          limit?: number;
          unresolvedOnly?: boolean;
        } = {},
      ): Promise<ListResponse<AlertItem>> => {
        return options.skip === 0 ? firstPage : secondPage;
      },
    );
    const client: QueryClient = createTestQueryClient();

    const { result: pageOne } = await renderHook(
      () => {
        return useAlerts("project-1", 0, 20);
      },
      { wrapper: createQueryWrapper(client) },
    );
    await waitFor(() => {
      return expect(pageOne.current.isSuccess).toBe(true);
    });

    const { result: pageTwo } = await renderHook(
      () => {
        return useAlerts("project-1", 20, 20);
      },
      { wrapper: createQueryWrapper(client) },
    );
    await waitFor(() => {
      return expect(pageTwo.current.isSuccess).toBe(true);
    });

    expect(pageTwo.current.data).toEqual(secondPage);
    expect(pageOne.current.data).toEqual(firstPage);
    expect(fetchAlertsMock).toHaveBeenCalledWith("project-1", {
      skip: 20,
      limit: 20,
    });
  });

  test("a different page size is a different question, not the same one", async () => {
    /*
     * `limit` is the easiest input to leave out of a key, because changing it
     * usually still returns "the first page" and looks right. It is not right:
     * a screen that asked for fifty would be handed the twenty another screen
     * had already fetched, and would stop scrolling early.
     */
    const twenty: ListResponse<AlertItem> = makeListResponse([makeAlert()], {
      limit: 20,
    });
    const fifty: ListResponse<AlertItem> = makeListResponse(
      [makeAlert(), makeAlert({ _id: "alert-2" })],
      { limit: 50 },
    );
    fetchAlertsMock.mockImplementation(
      async (
        projectId: string,
        options: {
          skip?: number;
          limit?: number;
          unresolvedOnly?: boolean;
        } = {},
      ): Promise<ListResponse<AlertItem>> => {
        return options.limit === 20 ? twenty : fifty;
      },
    );
    const client: QueryClient = createTestQueryClient();

    const { result: smallPage } = await renderHook(
      () => {
        return useAlerts("project-1", 0, 20);
      },
      { wrapper: createQueryWrapper(client) },
    );
    await waitFor(() => {
      return expect(smallPage.current.isSuccess).toBe(true);
    });

    const { result: largePage } = await renderHook(
      () => {
        return useAlerts("project-1", 0, 50);
      },
      { wrapper: createQueryWrapper(client) },
    );
    await waitFor(() => {
      return expect(largePage.current.isSuccess).toBe(true);
    });

    expect(largePage.current.data).toEqual(fifty);
    expect(smallPage.current.data).toEqual(twenty);
  });

  test("another project's alerts are fetched rather than served from this project's cache", async () => {
    /*
     * This is the one that matters. A responder who belongs to two projects
     * switches between them in the same session against the same cache; if the
     * tenant were missing from the key, the second project's screen would show
     * the first project's alerts under the second project's name. Nothing on
     * screen would look broken, and every triage decision made from it would
     * be about the wrong system.
     */
    const acmeAlerts: ListResponse<AlertItem> = makeListResponse([
      makeAlert({ _id: "alert-acme", title: "Acme checkout latency" }),
    ]);
    const globexAlerts: ListResponse<AlertItem> = makeListResponse([
      makeAlert({ _id: "alert-globex", title: "Globex queue backlog" }),
    ]);
    fetchAlertsMock.mockImplementation(
      async (projectId: string): Promise<ListResponse<AlertItem>> => {
        return projectId === "project-acme" ? acmeAlerts : globexAlerts;
      },
    );
    const client: QueryClient = createTestQueryClient();

    const { result: acme } = await renderHook(
      () => {
        return useAlerts("project-acme");
      },
      { wrapper: createQueryWrapper(client) },
    );
    await waitFor(() => {
      return expect(acme.current.isSuccess).toBe(true);
    });

    const { result: globex } = await renderHook(
      () => {
        return useAlerts("project-globex");
      },
      { wrapper: createQueryWrapper(client) },
    );
    await waitFor(() => {
      return expect(globex.current.isSuccess).toBe(true);
    });

    expect(globex.current.data).toEqual(globexAlerts);
    expect(acme.current.data).toEqual(acmeAlerts);
    expect(fetchAlertsMock).toHaveBeenCalledWith("project-globex", {
      skip: 0,
      limit: 20,
    });
  });

  test("an empty project id never reaches the api", async () => {
    /*
     * There is a real moment where this happens: the app is restored, the
     * screen mounts, and the selected project has not been read back from
     * storage yet. A request sent then would have no tenant header at all.
     */
    fetchAlertsMock.mockResolvedValue(makeListResponse([makeAlert()]));
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAlerts("");
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(result.current.fetchStatus).toBe("idle");
    });
    expect(fetchAlertsMock).not.toHaveBeenCalled();
  });

  test("while disabled it reports pending forever, which is the trap for callers", async () => {
    /*
     * Pinning the exact shape of a disabled query, because it surprises people
     * and the surprise costs a permanent spinner.
     *
     * In react-query v5 `pending` means "there is no data", NOT "something is
     * in flight". A disabled query has no data and never will until it is
     * enabled, so isPending stays true indefinitely. `fetchStatus` is the half
     * that says whether a request is actually running, and it is "idle" here.
     *
     * So a screen that renders its spinner on isPending will spin forever on a
     * project that has not loaded yet. isLoading - which v5 defines as pending
     * AND fetching - is the flag that behaves the way callers expect, and it
     * is false here.
     */
    fetchAlertsMock.mockResolvedValue(makeListResponse([makeAlert()]));
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAlerts("");
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
     * An on-call app that renders a failed request as zero rows is telling a
     * responder that nothing is on fire. The error has to arrive as an error,
     * with data still undefined, so the screen can say "could not load"
     * instead of "all clear".
     */
    const failure: Error = new Error("alert list unavailable");
    fetchAlertsMock.mockRejectedValue(failure);
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAlerts("project-1");
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

describe("useUnresolvedAlertCount", () => {
  test("asks for a single row, filtered to unresolved, because only the total is wanted", async () => {
    /*
     * The badge needs one number. Requesting limit 1 with the unresolved
     * filter is what makes it cheap: the server still counts everything that
     * matches, and the handset only pays for one row of it. A regression that
     * dropped the limit would pull a full page down on every screen that
     * renders the badge, and one that dropped unresolvedOnly would count
     * resolved alerts as outstanding work.
     */
    fetchAlertsMock.mockResolvedValue(
      makeListResponse([makeAlert()], { count: 3, limit: 1 }),
    );
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useUnresolvedAlertCount("project-1");
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(result.current.isSuccess).toBe(true);
    });
    expect(fetchAlertsMock).toHaveBeenCalledWith("project-1", {
      skip: 0,
      limit: 1,
      unresolvedOnly: true,
    });
  });

  test("reports the server's total, not how many rows came back", async () => {
    /*
     * The distinction the whole hook rests on. The response carries one row
     * and a count of 42; the badge has to say 42. Reading `data.length` here
     * would show "1" for any project with anything outstanding at all - a
     * badge that is wrong in the direction of looking calm.
     */
    fetchAlertsMock.mockResolvedValue(
      makeListResponse([makeAlert()], { count: 42, limit: 1 }),
    );
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useUnresolvedAlertCount("project-1");
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
     * Zero is falsy, and hooks that reach for `|| something` turn "nothing
     * outstanding" into "no data yet". The empty case is the ordinary case for
     * a healthy project, so it has to be a plain successful 0.
     */
    fetchAlertsMock.mockResolvedValue(
      makeListResponse([] as Array<AlertItem>, { count: 0, limit: 1 }),
    );
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useUnresolvedAlertCount("project-1");
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
    fetchAlertsMock.mockImplementation(
      async (projectId: string): Promise<ListResponse<AlertItem>> => {
        return makeListResponse([makeAlert()], {
          count: projectId === "project-acme" ? 5 : 11,
          limit: 1,
        });
      },
    );

    const { result: acme } = await renderHook(
      () => {
        return useUnresolvedAlertCount("project-acme");
      },
      { wrapper: createQueryWrapper(client) },
    );
    await waitFor(() => {
      return expect(acme.current.isSuccess).toBe(true);
    });

    const { result: globex } = await renderHook(
      () => {
        return useUnresolvedAlertCount("project-globex");
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
    fetchAlertsMock.mockResolvedValue(
      makeListResponse([makeAlert()], { count: 1, limit: 1 }),
    );
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useUnresolvedAlertCount("");
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(result.current.fetchStatus).toBe("idle");
    });
    expect(fetchAlertsMock).not.toHaveBeenCalled();
    expect(result.current.isPending).toBe(true);
    expect(result.current.data).toBeUndefined();
  });

  test("a failed count surfaces as an error rather than as zero", async () => {
    /*
     * A badge is a single glance. If a failed request resolved to 0 the glance
     * would say "nothing outstanding" on the exact occasions the app cannot
     * tell.
     */
    const failure: Error = new Error("count unavailable");
    fetchAlertsMock.mockRejectedValue(failure);
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useUnresolvedAlertCount("project-1");
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

describe("the alert list and the alert badge sharing one cache", () => {
  test("the count does not land on top of the list for the same project", async () => {
    /*
     * Both keys start with "alerts" and both carry the same project, so they
     * are only kept apart by the "unresolved-count" segment sitting between
     * them. If that segment were ever dropped, one of these two would
     * overwrite the other - and the shapes are not even compatible: the list
     * screen would be handed a bare number, or the badge an envelope. Two
     * entries in the cache, holding two different shapes, is the assertion.
     */
    fetchAlertsMock.mockImplementation(
      async (
        projectId: string,
        options: {
          skip?: number;
          limit?: number;
          unresolvedOnly?: boolean;
        } = {},
      ): Promise<ListResponse<AlertItem>> => {
        return makeListResponse([makeAlert()], {
          count: options.unresolvedOnly ? 7 : 1,
          limit: options.limit,
        });
      },
    );
    const client: QueryClient = createTestQueryClient();

    const { result: list } = await renderHook(
      () => {
        return useAlerts("project-1");
      },
      { wrapper: createQueryWrapper(client) },
    );
    const { result: badge } = await renderHook(
      () => {
        return useUnresolvedAlertCount("project-1");
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

  test("both are refreshed by one invalidation of the alerts prefix", async () => {
    /*
     * The flip side of sharing that first segment, and the reason it is worth
     * having: after a responder acknowledges something, invalidating "alerts"
     * has to refresh the list AND the badge. A badge that kept its old number
     * while the row beneath it changed state is the kind of disagreement that
     * makes people distrust the whole screen.
     */
    fetchAlertsMock.mockResolvedValue(
      makeListResponse([makeAlert()], { count: 1 }),
    );
    const client: QueryClient = createTestQueryClient();

    const { result: list } = await renderHook(
      () => {
        return useAlerts("project-1");
      },
      { wrapper: createQueryWrapper(client) },
    );
    const { result: badge } = await renderHook(
      () => {
        return useUnresolvedAlertCount("project-1");
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(list.current.isSuccess).toBe(true);
    });
    await waitFor(() => {
      return expect(badge.current.isSuccess).toBe(true);
    });
    expect(fetchAlertsMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      await client.invalidateQueries({ queryKey: ["alerts"] });
    });

    await waitFor(() => {
      return expect(fetchAlertsMock).toHaveBeenCalledTimes(4);
    });
  });
});
