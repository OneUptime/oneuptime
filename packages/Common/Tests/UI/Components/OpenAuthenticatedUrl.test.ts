import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import BaseAPI from "../../../UI/Utils/API/API";
import openAuthenticatedUrl, {
  AuthenticatedLinkClickEvent,
  handleAuthenticatedLinkClick,
} from "../../../UI/Utils/OpenAuthenticatedUrl";

/*
 * Links to authenticated routes (attachments, the pprof export, a private
 * status page's attachments) are plain navigations: they carry the session
 * cookie but none of the API class's refresh-and-replay, so once the
 * 15-minute access cookie had lapsed they opened a bare 401. The helper
 * refreshes the session before the new tab loads.
 *
 * The order is the whole point, so it is what these tests pin: the tab is
 * opened during the click (popup blockers refuse window.open once the
 * handler has awaited anything), and pointed at the URL only after the
 * refresh has worked. A refresh that did not work closes the tab: a refused
 * one means the page is already on its way to the login page, and one with
 * no answer means the server cannot be reached.
 */

const URL_TO_OPEN: string =
  "https://oneuptime.example/api/incident-internal-note/attachment/p/n/f";

interface FakeTab {
  opener: unknown;
  closed: boolean;
  location: { href: string };
  close: () => void;
}

interface Deferred {
  promise: Promise<boolean>;
  resolve: (value: boolean) => void;
}

type RefreshMock = ReturnType<typeof jest.fn<() => Promise<boolean>>>;

type WindowOpenMock = SpyInstance<typeof window.open>;

// Lets every pending promise chain run to completion.
async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 0);
  });
}

function makeDeferred(): Deferred {
  let resolve: (value: boolean) => void = (): void => {};

  const promise: Promise<boolean> = new Promise<boolean>(
    (onResolve: (value: boolean) => void): void => {
      resolve = onResolve;
    },
  );

  return { promise, resolve };
}

function makeTab(): FakeTab {
  const tab: FakeTab = {
    opener: window,
    closed: false,
    location: { href: "" },
    close: (): void => {
      tab.closed = true;
    },
  };

  return tab;
}

/*
 * window.open answers each call with the next queued value: a fake tab, or
 * null for a call the popup blocker refused.
 */
function stubWindowOpen(results: Array<FakeTab | null>): WindowOpenMock {
  return jest.spyOn(window, "open").mockImplementation((): Window | null => {
    const next: FakeTab | null | undefined = results.shift();
    return (next ?? null) as unknown as Window | null;
  });
}

function makeClick(
  overrides: Partial<AuthenticatedLinkClickEvent> = {},
): AuthenticatedLinkClickEvent {
  return {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
    preventDefault: jest.fn<() => void>(),
    ...overrides,
  };
}

let refreshSessionSpy: SpyInstance<typeof BaseAPI.refreshSession>;

beforeEach(() => {
  /*
   * Nothing here may reach the real refresh endpoint; the tests that care
   * about the default refresh assert on this spy.
   */
  refreshSessionSpy = jest
    .spyOn(BaseAPI, "refreshSession")
    .mockResolvedValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("openAuthenticatedUrl", () => {
  test("opens a blank tab straight away and points it at the URL only once the refresh has settled", async () => {
    const tab: FakeTab = makeTab();
    const windowOpen: WindowOpenMock = stubWindowOpen([tab]);
    const refresh: Deferred = makeDeferred();

    const opening: Promise<void> = openAuthenticatedUrl(URL_TO_OPEN, () => {
      return refresh.promise;
    });

    // Synchronously, inside what would be the click: the blank tab only.
    expect(windowOpen).toHaveBeenCalledTimes(1);
    expect(windowOpen).toHaveBeenCalledWith("", "_blank");
    expect(tab.location.href).toBe("");

    // Still waiting on the refresh: no navigation yet.
    await flushPromises();
    expect(tab.location.href).toBe("");

    refresh.resolve(true);
    await opening;

    expect(tab.location.href).toBe(URL_TO_OPEN);
    expect(windowOpen).toHaveBeenCalledTimes(1);
  });

  test("cuts the new tab loose from this page, as rel=noopener did", async () => {
    const tab: FakeTab = makeTab();
    stubWindowOpen([tab]);

    const opening: Promise<void> = openAuthenticatedUrl(
      URL_TO_OPEN,
      async (): Promise<boolean> => {
        return true;
      },
    );

    expect(tab.opener).toBeNull();

    await opening;
  });

  /*
   * A dead session: the refresh's own 401 has already sent this page to the
   * login page. Loading the URL anyway would only show a 401 in the new tab.
   */
  test("closes the tab instead of loading the URL when the session could not be refreshed", async () => {
    const tab: FakeTab = makeTab();
    stubWindowOpen([tab]);

    await openAuthenticatedUrl(URL_TO_OPEN, async (): Promise<boolean> => {
      return false;
    });

    expect(tab.closed).toBe(true);
    expect(tab.location.href).toBe("");
  });

  test("closes the tab when the refresh throws", async () => {
    const tab: FakeTab = makeTab();
    stubWindowOpen([tab]);

    await openAuthenticatedUrl(URL_TO_OPEN, async (): Promise<boolean> => {
      throw new Error("identity service unreachable");
    });

    expect(tab.closed).toBe(true);
    expect(tab.location.href).toBe("");
  });

  /*
   * With the blank tab refused there is no tab to hold while refreshing, and
   * waiting would spend the click that lets the second window.open through.
   */
  test("opens the URL itself, still inside the click and without a refresh, when the popup blocker refused the blank tab", async () => {
    const windowOpen: WindowOpenMock = stubWindowOpen([null, null]);
    const refresh: RefreshMock = jest.fn<() => Promise<boolean>>(
      async (): Promise<boolean> => {
        return true;
      },
    );

    const opening: Promise<void> = openAuthenticatedUrl(URL_TO_OPEN, refresh);

    // Both calls happen synchronously, before anything is awaited.
    expect(windowOpen).toHaveBeenCalledTimes(2);
    expect(windowOpen).toHaveBeenNthCalledWith(1, "", "_blank");
    expect(windowOpen).toHaveBeenNthCalledWith(
      2,
      URL_TO_OPEN,
      "_blank",
      "noopener,noreferrer",
    );

    await opening;

    expect(refresh).not.toHaveBeenCalled();
  });

  test("leaves a tab the user closed during the refresh closed, and opens no other", async () => {
    const tab: FakeTab = makeTab();
    const windowOpen: WindowOpenMock = stubWindowOpen([tab]);
    const refresh: Deferred = makeDeferred();

    const opening: Promise<void> = openAuthenticatedUrl(URL_TO_OPEN, () => {
      return refresh.promise;
    });

    tab.closed = true;
    refresh.resolve(true);
    await opening;

    expect(tab.location.href).toBe("");
    expect(windowOpen).toHaveBeenCalledTimes(1);
  });

  test("refreshes the dashboard session when no refresh function is given", async () => {
    const tab: FakeTab = makeTab();
    stubWindowOpen([tab]);

    await openAuthenticatedUrl(URL_TO_OPEN);

    expect(refreshSessionSpy).toHaveBeenCalledTimes(1);
    expect(tab.location.href).toBe(URL_TO_OPEN);
  });
});

describe("handleAuthenticatedLinkClick", () => {
  test("takes over a plain click: the link's own navigation is prevented and the tab opens during the click", async () => {
    const tab: FakeTab = makeTab();
    const windowOpen: WindowOpenMock = stubWindowOpen([tab]);
    const refresh: Deferred = makeDeferred();
    const click: AuthenticatedLinkClickEvent = makeClick();

    handleAuthenticatedLinkClick(click, URL_TO_OPEN, () => {
      return refresh.promise;
    });

    expect(click.preventDefault).toHaveBeenCalledTimes(1);
    expect(windowOpen).toHaveBeenCalledWith("", "_blank");
    expect(tab.location.href).toBe("");

    refresh.resolve(true);
    await flushPromises();

    expect(tab.location.href).toBe(URL_TO_OPEN);
  });

  test("uses the dashboard session when no refresh function is given", async () => {
    const tab: FakeTab = makeTab();
    stubWindowOpen([tab]);

    handleAuthenticatedLinkClick(makeClick(), URL_TO_OPEN);

    expect(refreshSessionSpy).toHaveBeenCalledTimes(1);

    await flushPromises();

    expect(tab.location.href).toBe(URL_TO_OPEN);
  });

  /*
   * Some popup blockers and in-app browsers refuse window.open but still
   * follow an <a target=_blank>. Taking the click over there would leave a
   * link that does nothing, so the anchor keeps it - without a refresh, as
   * before this helper existed.
   */
  test("leaves the click to the link itself when window.open is refused", async () => {
    const windowOpen: WindowOpenMock = stubWindowOpen([null]);
    const refresh: RefreshMock = jest.fn<() => Promise<boolean>>(
      async (): Promise<boolean> => {
        return true;
      },
    );
    const click: AuthenticatedLinkClickEvent = makeClick();

    handleAuthenticatedLinkClick(click, URL_TO_OPEN, refresh);

    expect(windowOpen).toHaveBeenCalledTimes(1);
    expect(windowOpen).toHaveBeenCalledWith("", "_blank");
    expect(click.preventDefault).not.toHaveBeenCalled();

    await flushPromises();

    expect(refresh).not.toHaveBeenCalled();
    expect(windowOpen).toHaveBeenCalledTimes(1);
  });

  test("closes the tab it opened when the refresh does not work", async () => {
    const tab: FakeTab = makeTab();
    stubWindowOpen([tab]);
    const click: AuthenticatedLinkClickEvent = makeClick();

    handleAuthenticatedLinkClick(
      click,
      URL_TO_OPEN,
      async (): Promise<boolean> => {
        return false;
      },
    );

    expect(click.preventDefault).toHaveBeenCalledTimes(1);

    await flushPromises();

    expect(tab.closed).toBe(true);
    expect(tab.location.href).toBe("");
  });

  test.each([
    ["cmd-click (background tab)", { metaKey: true }],
    ["ctrl-click (background tab)", { ctrlKey: true }],
    ["shift-click (new window)", { shiftKey: true }],
    ["alt-click (download)", { altKey: true }],
    ["a non-primary button", { button: 1 }],
    ["a click something else already handled", { defaultPrevented: true }],
  ])(
    "leaves %s to the browser",
    (_name: string, overrides: Partial<AuthenticatedLinkClickEvent>) => {
      const windowOpen: WindowOpenMock = stubWindowOpen([makeTab()]);
      const refresh: RefreshMock = jest.fn<() => Promise<boolean>>(
        async (): Promise<boolean> => {
          return true;
        },
      );
      const click: AuthenticatedLinkClickEvent = makeClick(overrides);

      handleAuthenticatedLinkClick(click, URL_TO_OPEN, refresh);

      expect(click.preventDefault).not.toHaveBeenCalled();
      expect(windowOpen).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
    },
  );
});
