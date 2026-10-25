import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { Mock } from "jest-mock";
import NewVersion, {
  NEW_SERVICE_WORKER_HOOK,
  NEW_VERSION_CHECK_INTERVAL_IN_MS,
  NEW_VERSION_DISMISSED_KEY,
  NEW_VERSION_FIRST_CHECK_DELAY_IN_MS,
  NEW_VERSION_LOADED_FOR_KEY,
  NEW_VERSION_MINIMUM_CHECK_GAP_IN_MS,
  NEW_VERSION_PLACE_KEY,
  NEW_VERSION_PLACE_MAX_AGE_IN_MS,
  NEW_VERSION_PLACE_RESTORE_TIMEOUT_IN_MS,
  NewVersionAudience,
  NewVersionState,
  NewVersionStatus,
} from "../../../../UI/Utils/NewVersion/NewVersion";
import {
  FetchFunction,
  ServerBuildCheckResult,
  ServerBuildStatus,
} from "../../../../UI/Utils/NewVersion/ServerBuildCheck";
import TabMemory from "../../../../UI/Utils/NewVersion/TabMemory";
import UnsavedChanges from "../../../../UI/Utils/NewVersion/UnsavedChanges";

/*
 * NewVersion watches for a new version of OneUptime deployed under an open
 * tab and decides what the tab does about it. These pin when it looks
 * (a while after the page opens, on focus, on coming back into view, back
 * online, every ten minutes while in view, when a newer service worker takes
 * over - never twice in half a minute), what it concludes from each answer,
 * and the promises it makes the reader: the next page opened loads the new
 * version, but never while something typed is unsaved, never offline, never
 * twice for the same build, and a reload into the new version comes back to
 * the same place.
 */

const RUNNING: string = "14.0.89-aaaa-0001";
const NEWER: string = "14.0.90-bbbb-0002";
const NEWEST: string = "14.0.91-cccc-0003";
const MANIFEST_URL: string = "/dashboard/dist/build.json";

interface FakeServer {
  fetchFunction: FetchFunction;
  requests: () => number;
  serve: (buildId: string) => void;
  answerWith: (status: number, body?: string) => void;
  fail: () => void;
  hold: () => () => void;
}

const makeServer: () => FakeServer = (): FakeServer => {
  let requests: number = 0;
  let status: number = 200;
  let body: string = JSON.stringify({ buildId: RUNNING });
  let isFailing: boolean = false;
  let held: Array<() => void> = [];
  let isHolding: boolean = false;

  const answer: () => Response = (): Response => {
    return {
      status: status,
      ok: status >= 200 && status < 300,
      text: (): Promise<string> => {
        return Promise.resolve(body);
      },
    } as unknown as Response;
  };

  return {
    fetchFunction: (): Promise<Response> => {
      requests++;

      if (isFailing) {
        return Promise.reject(new TypeError("Failed to fetch"));
      }

      if (isHolding) {
        return new Promise<Response>((resolve: (r: Response) => void) => {
          held.push(() => {
            resolve(answer());
          });
        });
      }

      return Promise.resolve(answer());
    },
    requests: (): number => {
      return requests;
    },
    serve: (buildId: string): void => {
      status = 200;
      isFailing = false;
      body = JSON.stringify({ buildId });
    },
    answerWith: (nextStatus: number, nextBody?: string): void => {
      status = nextStatus;
      isFailing = false;
      body = nextBody ?? "";
    },
    fail: (): void => {
      isFailing = true;
    },
    hold: (): (() => void) => {
      isHolding = true;

      return (): void => {
        isHolding = false;
        const pending: Array<() => void> = held;
        held = [];
        for (const release of pending) {
          release();
        }
      };
    },
  };
};

const flush: () => Promise<void> = async (): Promise<void> => {
  for (let i: number = 0; i < 10; i++) {
    await Promise.resolve();
  }
};

const ORIGINAL_LOCATION: Location = window.location;
let reloadMock: Mock<() => void>;
let server: FakeServer;

const setLocation: (href: string) => void = (href: string): void => {
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: { ...ORIGINAL_LOCATION, href: href, reload: reloadMock },
  });
};

const setVisibility: (state: DocumentVisibilityState) => void = (
  state: DocumentVisibilityState,
): void => {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: (): DocumentVisibilityState => {
      return state;
    },
  });
};

const setOnline: (isOnline: boolean) => void = (isOnline: boolean): void => {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    get: (): boolean => {
      return isOnline;
    },
  });
};

const start: (audience?: NewVersionAudience) => void = (
  audience?: NewVersionAudience,
): void => {
  NewVersion.start({
    audience: audience || NewVersionAudience.Members,
    runningBuild: { buildId: RUNNING, manifestUrl: MANIFEST_URL },
    fetchFunction: server.fetchFunction,
  });
};

beforeEach(() => {
  jest.useFakeTimers();
  NewVersion.reset();
  UnsavedChanges.reset();
  window.sessionStorage.clear();
  window.name = "";
  reloadMock = jest.fn<() => void>();
  setLocation("https://oneuptime.example/dashboard/project/home");
  setVisibility("visible");
  setOnline(true);
  server = makeServer();
});

afterEach(() => {
  NewVersion.reset();
  UnsavedChanges.reset();
  jest.useRealTimers();
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: ORIGINAL_LOCATION,
  });
  setVisibility("visible");
  setOnline(true);
  jest.restoreAllMocks();
});

describe("when it looks", () => {
  test("not at all before start", async () => {
    await expect(NewVersion.checkNow()).resolves.toBeNull();
    expect(server.requests()).toBe(0);
  });

  test("not at all when this tab's code names no build (fixtures, tests)", async () => {
    NewVersion.start({
      audience: NewVersionAudience.Members,
      runningBuild: { buildId: "", manifestUrl: MANIFEST_URL },
      fetchFunction: server.fetchFunction,
    });

    jest.advanceTimersByTime(NEW_VERSION_CHECK_INTERVAL_IN_MS * 3);
    window.dispatchEvent(new Event("focus"));
    await flush();

    await expect(NewVersion.checkNow({ force: true })).resolves.toBeNull();
    await expect(NewVersion.probe()).resolves.toBeNull();
    expect(server.requests()).toBe(0);
  });

  test("once, a while after the page opens - not while it is still loading", async () => {
    start();

    jest.advanceTimersByTime(NEW_VERSION_FIRST_CHECK_DELAY_IN_MS - 1);
    await flush();
    expect(server.requests()).toBe(0);

    jest.advanceTimersByTime(1);
    await flush();
    expect(server.requests()).toBe(1);
  });

  test("every ten minutes while the tab is in view, and not while it is hidden", async () => {
    start();
    jest.advanceTimersByTime(NEW_VERSION_FIRST_CHECK_DELAY_IN_MS);
    await flush();
    expect(server.requests()).toBe(1);

    jest.advanceTimersByTime(NEW_VERSION_CHECK_INTERVAL_IN_MS);
    await flush();
    expect(server.requests()).toBe(2);

    setVisibility("hidden");
    jest.advanceTimersByTime(NEW_VERSION_CHECK_INTERVAL_IN_MS * 2);
    await flush();
    expect(server.requests()).toBe(2);
  });

  test("when the tab comes back into view", async () => {
    start();

    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    await flush();
    expect(server.requests()).toBe(0);

    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await flush();
    expect(server.requests()).toBe(1);
  });

  test("when the window gets focus - but not twice in half a minute", async () => {
    start();

    window.dispatchEvent(new Event("focus"));
    await flush();
    window.dispatchEvent(new Event("focus"));
    await flush();
    expect(server.requests()).toBe(1);

    jest.advanceTimersByTime(NEW_VERSION_MINIMUM_CHECK_GAP_IN_MS);
    window.dispatchEvent(new Event("focus"));
    await flush();
    expect(server.requests()).toBe(2);
  });

  test("when the browser is back online, even right after another look", async () => {
    start();

    window.dispatchEvent(new Event("focus"));
    await flush();
    window.dispatchEvent(new Event("online"));
    await flush();

    expect(server.requests()).toBe(2);
  });

  test("on a navigation, within the same half-minute limit", async () => {
    start();

    NewVersion.noteNavigation();
    await flush();
    NewVersion.noteNavigation();
    await flush();

    expect(server.requests()).toBe(1);
  });

  test("when a newer service worker takes over (the index.ejs hook)", async () => {
    start();

    window.dispatchEvent(new Event("focus"));
    await flush();

    const hook: unknown = (window as unknown as Record<string, unknown>)[
      NEW_SERVICE_WORKER_HOOK
    ];

    expect(typeof hook).toBe("function");

    (hook as () => void)();
    await flush();

    // Forced: the takeover is news, whenever the last look was.
    expect(server.requests()).toBe(2);
  });

  test("one request at a time: a look while another is under way joins it", async () => {
    start();
    const release: () => void = server.hold();

    const first: Promise<ServerBuildCheckResult | null> = NewVersion.checkNow({
      force: true,
    });
    const second: Promise<ServerBuildCheckResult | null> = NewVersion.checkNow({
      force: true,
    });
    const third: Promise<ServerBuildCheckResult | null> = NewVersion.probe();

    release();
    await flush();

    expect(server.requests()).toBe(1);
    await expect(first).resolves.toEqual({
      status: ServerBuildStatus.Same,
      serverBuildId: RUNNING,
    });
    await expect(second).resolves.toEqual(await first);
    await expect(third).resolves.toEqual(await first);
  });

  test("probe skips the half-minute limit", async () => {
    start();

    await NewVersion.checkNow({ force: true });
    await NewVersion.probe();

    expect(server.requests()).toBe(2);
  });

  test("start is idempotent: one set of timers and listeners", async () => {
    start();
    start();

    window.dispatchEvent(new Event("focus"));
    await flush();

    expect(server.requests()).toBe(1);
  });

  test("reset stops every timer and listener", async () => {
    start();
    NewVersion.reset();

    jest.advanceTimersByTime(NEW_VERSION_CHECK_INTERVAL_IN_MS * 2);
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));
    await flush();

    expect(server.requests()).toBe(0);
    expect(
      (window as unknown as Record<string, unknown>)[NEW_SERVICE_WORKER_HOOK],
    ).toBeUndefined();
  });
});

describe("what it concludes", () => {
  const states: () => Array<NewVersionState> = (): Array<NewVersionState> => {
    const seen: Array<NewVersionState> = [];
    NewVersion.subscribe((state: NewVersionState) => {
      seen.push(state);
    });
    return seen;
  };

  test("the same build: current, and nothing to announce", async () => {
    start();
    const seen: Array<NewVersionState> = states();

    await NewVersion.checkNow({ force: true });

    expect(NewVersion.getState()).toEqual({
      status: NewVersionStatus.Current,
      serverBuildId: RUNNING,
    });
    expect(seen).toEqual([
      { status: NewVersionStatus.Current, serverBuildId: RUNNING },
    ]);
  });

  test("a new build: available, and every listener hears it", async () => {
    start();
    const seen: Array<NewVersionState> = states();
    const alsoSeen: Array<NewVersionState> = states();
    server.serve(NEWER);

    await NewVersion.checkNow({ force: true });

    const available: NewVersionState = {
      status: NewVersionStatus.Available,
      serverBuildId: NEWER,
    };

    expect(NewVersion.getState()).toEqual(available);
    expect(seen).toEqual([available]);
    expect(alsoSeen).toEqual([available]);
  });

  test("the same answer twice is announced once", async () => {
    start();
    const seen: Array<NewVersionState> = states();
    server.serve(NEWER);

    await NewVersion.checkNow({ force: true });
    await NewVersion.checkNow({ force: true });

    expect(seen).toHaveLength(1);
  });

  test("a newer build again: available, naming the newest", async () => {
    start();
    server.serve(NEWER);
    await NewVersion.checkNow({ force: true });

    server.serve(NEWEST);
    await NewVersion.checkNow({ force: true });

    expect(NewVersion.getState()).toEqual({
      status: NewVersionStatus.Available,
      serverBuildId: NEWEST,
    });
  });

  test("during a rolling deploy, one old server answering does not take the new version back", async () => {
    start();
    server.serve(NEWER);
    await NewVersion.checkNow({ force: true });

    server.serve(RUNNING);
    await NewVersion.checkNow({ force: true });

    expect(NewVersion.getState().status).toBe(NewVersionStatus.Available);

    // ...but two in a row do: the deploy was rolled back.
    await NewVersion.checkNow({ force: true });

    expect(NewVersion.getState()).toEqual({
      status: NewVersionStatus.Current,
      serverBuildId: RUNNING,
    });
  });

  test("a new answer in between starts the count over", async () => {
    start();
    server.serve(NEWER);
    await NewVersion.checkNow({ force: true });

    server.serve(RUNNING);
    await NewVersion.checkNow({ force: true });
    server.serve(NEWER);
    await NewVersion.checkNow({ force: true });
    server.serve(RUNNING);
    await NewVersion.checkNow({ force: true });

    expect(NewVersion.getState().status).toBe(NewVersionStatus.Available);
  });

  test.each<[string, (s: FakeServer) => void]>([
    [
      "the app's page instead of a manifest",
      (s: FakeServer): void => {
        s.answerWith(200, "<!DOCTYPE html>");
      },
    ],
    [
      "a 404",
      (s: FakeServer): void => {
        s.answerWith(404);
      },
    ],
    [
      "a 503 while the server restarts",
      (s: FakeServer): void => {
        s.answerWith(503);
      },
    ],
    [
      "no answer at all",
      (s: FakeServer): void => {
        s.fail();
      },
    ],
  ])(
    "%s changes nothing: no version is claimed without one named",
    async (_label: string, setUp: (s: FakeServer) => void) => {
      start();
      server.serve(NEWER);
      await NewVersion.checkNow({ force: true });

      setUp(server);
      await NewVersion.checkNow({ force: true });

      expect(NewVersion.getState()).toEqual({
        status: NewVersionStatus.Available,
        serverBuildId: NEWER,
      });

      NewVersion.reset();
      start();
      setUp(server);
      await NewVersion.checkNow({ force: true });

      expect(NewVersion.getState()).toEqual({
        status: NewVersionStatus.Unknown,
        serverBuildId: null,
      });
    },
  );

  test("a listener that throws does not keep the others from hearing", async () => {
    start();
    NewVersion.subscribe(() => {
      throw new Error("listener exploded");
    });
    const seen: Array<NewVersionState> = states();
    server.serve(NEWER);

    await expect(NewVersion.checkNow({ force: true })).resolves.toEqual({
      status: ServerBuildStatus.New,
      serverBuildId: NEWER,
    });
    expect(seen).toHaveLength(1);
  });

  test("unsubscribing stops the news", async () => {
    start();
    const seen: Array<NewVersionState> = [];
    const unsubscribe: () => void = NewVersion.subscribe(
      (state: NewVersionState) => {
        seen.push(state);
      },
    );

    unsubscribe();
    server.serve(NEWER);
    await NewVersion.checkNow({ force: true });

    expect(seen).toEqual([]);
  });

  test("remembers who it speaks to", () => {
    start(NewVersionAudience.Visitors);

    expect(NewVersion.getAudience()).toBe(NewVersionAudience.Visitors);
  });
});

describe("the next page opened loads the new version", () => {
  const becomeAvailable: () => Promise<void> = async (): Promise<void> => {
    start();
    server.serve(NEWER);
    await NewVersion.checkNow({ force: true });
  };

  test("once a new version is available", async () => {
    await becomeAvailable();

    expect(NewVersion.shouldLoadNavigationInFull()).toBe(true);
  });

  test("not before anything is known, nor when the version is current", async () => {
    start();
    expect(NewVersion.shouldLoadNavigationInFull()).toBe(false);

    await NewVersion.checkNow({ force: true });
    expect(NewVersion.shouldLoadNavigationInFull()).toBe(false);
  });

  test("not before start, whatever the state", () => {
    expect(NewVersion.shouldLoadNavigationInFull()).toBe(false);
  });

  test("not while something typed is unsaved", async () => {
    await becomeAvailable();
    const release: () => void = UnsavedChanges.hold();

    expect(NewVersion.shouldLoadNavigationInFull()).toBe(false);

    release();
    expect(NewVersion.shouldLoadNavigationInFull()).toBe(true);
  });

  test("not while offline: a full load would end on the browser's error page", async () => {
    await becomeAvailable();
    setOnline(false);

    expect(NewVersion.shouldLoadNavigationInFull()).toBe(false);
  });

  test("loading it remembers the build, and reloads the address the reader went to", async () => {
    await becomeAvailable();

    NewVersion.loadNavigationInFull();

    expect(reloadMock).toHaveBeenCalledTimes(1);
    expect(TabMemory.get(NEW_VERSION_LOADED_FOR_KEY)).toBe(NEWER);
    expect(NewVersion.isReloadInProgress()).toBe(true);
    // No second load while the first is on its way.
    expect(NewVersion.shouldLoadNavigationInFull()).toBe(false);
  });

  test("NEVER TWICE FOR ONE BUILD: a load that did not reach it is not tried again", async () => {
    TabMemory.set(NEW_VERSION_LOADED_FOR_KEY, NEWER);

    await becomeAvailable();

    expect(NewVersion.shouldLoadNavigationInFull()).toBe(false);
  });

  test("a later build is tried again", async () => {
    TabMemory.set(NEW_VERSION_LOADED_FOR_KEY, NEWER);
    start();
    server.serve(NEWEST);
    await NewVersion.checkNow({ force: true });

    expect(NewVersion.shouldLoadNavigationInFull()).toBe(true);
  });

  test("a reload the browser did not carry out stops counting as one in progress", async () => {
    await becomeAvailable();
    NewVersion.loadNavigationInFull();

    jest.advanceTimersByTime(45 * 1000);

    expect(NewVersion.isReloadInProgress()).toBe(false);
  });
});

describe("the notice can be held back", () => {
  test("while a page says it itself, counting each hold once", async () => {
    start();
    const heard: Array<NewVersionState> = [];
    NewVersion.subscribe((state: NewVersionState) => {
      heard.push(state);
    });

    expect(NewVersion.isNoticeHeld()).toBe(false);

    const first: () => void = NewVersion.holdNotice();
    const second: () => void = NewVersion.holdNotice();

    expect(NewVersion.isNoticeHeld()).toBe(true);

    first();
    first();
    expect(NewVersion.isNoticeHeld()).toBe(true);

    second();
    expect(NewVersion.isNoticeHeld()).toBe(false);
    // Every change is heard, so a drawn notice follows it.
    expect(heard).toHaveLength(4);
  });

  test("a reload starting is heard too, with the state unchanged", async () => {
    start();
    server.serve(NEWER);
    await NewVersion.checkNow({ force: true });
    const heard: Array<NewVersionState> = [];
    NewVersion.subscribe((state: NewVersionState) => {
      heard.push(state);
    });

    NewVersion.reloadKeepingPlace();

    expect(heard).toEqual([
      { status: NewVersionStatus.Available, serverBuildId: NEWER },
    ]);
    expect(NewVersion.isReloadInProgress()).toBe(true);
  });
});

describe("the notice can be dismissed", () => {
  test("for the build it announced, and comes back for the next one", async () => {
    start();
    server.serve(NEWER);
    await NewVersion.checkNow({ force: true });

    expect(NewVersion.isNoticeDismissed()).toBe(false);

    NewVersion.dismissNotice();
    expect(NewVersion.isNoticeDismissed()).toBe(true);
    expect(TabMemory.get(NEW_VERSION_DISMISSED_KEY)).toBe(NEWER);

    server.serve(NEWEST);
    await NewVersion.checkNow({ force: true });
    expect(NewVersion.isNoticeDismissed()).toBe(false);
  });

  test("dismissing tells the listeners, so the notice goes away", async () => {
    start();
    server.serve(NEWER);
    await NewVersion.checkNow({ force: true });
    const heard: Array<NewVersionState> = [];
    NewVersion.subscribe((state: NewVersionState) => {
      heard.push(state);
    });

    NewVersion.dismissNotice();

    expect(heard).toHaveLength(1);
  });

  test("there is nothing to dismiss without a build", () => {
    start();
    NewVersion.dismissNotice();

    expect(TabMemory.get(NEW_VERSION_DISMISSED_KEY)).toBeNull();
    expect(NewVersion.isNoticeDismissed()).toBe(false);
  });
});

describe("a reload into the new version comes back to the same place", () => {
  const HREF: string =
    "https://oneuptime.example/dashboard/project/incidents?page=2#notes";

  let scrollY: number = 0;
  let documentHeight: number = 0;
  let scrollToMock: Mock<(x: number, y: number) => void>;

  beforeEach(() => {
    scrollY = 0;
    documentHeight = 0;
    scrollToMock = jest.fn<(x: number, y: number) => void>(
      (_x: number, y: number) => {
        scrollY = Math.min(y, documentHeight);
      },
    );

    Object.defineProperty(window, "scrollTo", {
      configurable: true,
      writable: true,
      value: scrollToMock,
    });
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      get: (): number => {
        return scrollY;
      },
    });
    Object.defineProperty(window, "scrollX", {
      configurable: true,
      get: (): number => {
        return 0;
      },
    });
  });

  test("the place is saved with the address, query and hash", () => {
    setLocation(HREF);
    documentHeight = 5000;
    scrollY = 1200;

    NewVersion.reloadKeepingPlace();

    expect(reloadMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(TabMemory.get(NEW_VERSION_PLACE_KEY) || "{}")).toEqual(
      expect.objectContaining({ href: HREF, scrollX: 0, scrollY: 1200 }),
    );
  });

  test("after the reload, it scrolls back as the page fills in", () => {
    TabMemory.set(
      NEW_VERSION_PLACE_KEY,
      JSON.stringify({
        href: HREF,
        scrollX: 0,
        scrollY: 1200,
        savedAt: Date.now(),
      }),
    );
    setLocation(HREF);

    start();

    // Nothing to scroll to yet: the page is still empty.
    expect(scrollY).toBe(0);

    documentHeight = 600;
    jest.advanceTimersByTime(100);
    expect(scrollY).toBe(600);

    documentHeight = 4000;
    jest.advanceTimersByTime(100);
    expect(scrollY).toBe(1200);

    const callsWhenThere: number = scrollToMock.mock.calls.length;
    jest.advanceTimersByTime(2000);
    expect(scrollToMock.mock.calls.length).toBe(callsWhenThere);

    // The place is used once.
    expect(TabMemory.get(NEW_VERSION_PLACE_KEY)).toBeNull();
  });

  test("stops as soon as the reader scrolls by themselves", () => {
    TabMemory.set(
      NEW_VERSION_PLACE_KEY,
      JSON.stringify({
        href: HREF,
        scrollX: 0,
        scrollY: 1200,
        savedAt: Date.now(),
      }),
    );
    setLocation(HREF);
    start();

    window.dispatchEvent(new Event("wheel"));
    const calls: number = scrollToMock.mock.calls.length;
    documentHeight = 4000;
    jest.advanceTimersByTime(1000);

    expect(scrollToMock.mock.calls.length).toBe(calls);
  });

  test("gives up when the page never gets that long", () => {
    TabMemory.set(
      NEW_VERSION_PLACE_KEY,
      JSON.stringify({
        href: HREF,
        scrollX: 0,
        scrollY: 9000,
        savedAt: Date.now(),
      }),
    );
    setLocation(HREF);
    documentHeight = 500;
    start();

    jest.advanceTimersByTime(NEW_VERSION_PLACE_RESTORE_TIMEOUT_IN_MS + 500);
    const calls: number = scrollToMock.mock.calls.length;
    jest.advanceTimersByTime(5000);

    expect(scrollToMock.mock.calls.length).toBe(calls);
  });

  test.each<[string, Record<string, unknown>]>([
    ["another address", { href: `${HREF}&other=1`, scrollY: 900 }],
    [
      "an old place",
      {
        href: HREF,
        scrollY: 900,
        savedAt: Date.now() - NEW_VERSION_PLACE_MAX_AGE_IN_MS - 1,
      },
    ],
    ["the top of the page", { href: HREF, scrollY: 0 }],
  ])("does nothing for %s", (_label: string, place: Record<string, unknown>) => {
    TabMemory.set(
      NEW_VERSION_PLACE_KEY,
      JSON.stringify({ scrollX: 0, savedAt: Date.now(), ...place }),
    );
    setLocation(HREF);
    documentHeight = 5000;

    start();
    jest.advanceTimersByTime(1000);

    expect(scrollToMock).not.toHaveBeenCalled();
    expect(TabMemory.get(NEW_VERSION_PLACE_KEY)).toBeNull();
  });

  test("a broken saved place is dropped, not thrown", () => {
    TabMemory.set(NEW_VERSION_PLACE_KEY, "{not json");
    setLocation(HREF);

    expect(() => {
      start();
    }).not.toThrow();
    expect(TabMemory.get(NEW_VERSION_PLACE_KEY)).toBeNull();
  });
});
