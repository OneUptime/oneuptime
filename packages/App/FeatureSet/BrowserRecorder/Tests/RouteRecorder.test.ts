import UrlScrubber from "Common/Utils/Rum/UrlScrubber";
import RouteRecorder, {
  MAX_ROUTES_RECORDED,
  ROUTE_CUSTOM_EVENT_TAG,
  RecordedRoute,
} from "../src/RouteRecorder";

describe("RouteRecorder", (): void => {
  let routes: Array<RecordedRoute> = [];
  let customEvents: Array<{ tag: string; payload: unknown }> = [];
  let snapshotRequests: number = 0;
  let capReports: Array<number> = [];
  let recorder: RouteRecorder;

  /*
   * Lets the deferred snapshot (next frame, then one macrotask) run. Fake
   * timers cover requestAnimationFrame as well as setTimeout.
   */
  const settle: () => void = (): void => {
    jest.advanceTimersByTime(100);
  };

  beforeEach((): void => {
    jest.useFakeTimers();

    routes = [];
    customEvents = [];
    snapshotRequests = 0;
    capReports = [];

    window.history.replaceState({}, "", "/checkout");

    recorder = new RouteRecorder({
      emitCustomEvent: (tag: string, payload: unknown): void => {
        customEvents.push({ tag: tag, payload: payload });
      },
      scrubUrl: (url: string): string => {
        return UrlScrubber.scrub(url);
      },
      onRouteChange: (_atUnixMs: number, route: RecordedRoute): void => {
        routes.push(route);
      },
      requestFullSnapshot: (): void => {
        snapshotRequests++;
      },
      onCapReached: (cap: number): void => {
        capReports.push(cap);
      },
    });

    recorder.start(window);
  });

  afterEach((): void => {
    recorder.stop(window);
    jest.useRealTimers();
  });

  it("records a pushState navigation", (): void => {
    window.history.pushState({}, "", "/cart");

    expect(routes).toHaveLength(1);
    expect(routes[0]?.kind).toBe("pushState");
    expect(routes[0]?.from).toBe("https://shop.example.com/checkout");
    expect(routes[0]?.to).toBe("https://shop.example.com/cart");
    expect(customEvents[0]?.tag).toBe(ROUTE_CUSTOM_EVENT_TAG);
  });

  it("records a replaceState navigation", (): void => {
    window.history.replaceState({}, "", "/thanks");

    expect(routes[0]?.kind).toBe("replaceState");
  });

  /*
   * A route change is exactly where a password reset token or a magic link
   * shows up, and exitUrl renders in the session list under the WIDER
   * metadata ACL, so scrubbing has to happen before anything is recorded.
   */
  it("scrubs the token out of a reset link", (): void => {
    window.history.pushState(
      {},
      "",
      "/reset-password?token=eyJhbGciOiJIUzI1NiJ9.super.secret",
    );

    expect(JSON.stringify(routes)).not.toContain("token");
    expect(JSON.stringify(routes)).not.toContain("secret");
  });

  it("redacts an identifier path segment", (): void => {
    window.history.pushState({}, "", "/orders/507f1f77bcf86cd799439011");

    expect(routes[0]?.to).toBe("https://shop.example.com/orders/[redacted]");
  });

  /*
   * Compared AFTER scrubbing, so an app that rewrites a dropped query
   * parameter on every keystroke does not fill the route lane with identical
   * entries - or take a full document snapshot for each one.
   */
  it("ignores a navigation that only changes a dropped query parameter", (): void => {
    window.history.pushState({}, "", "/checkout?q=a");
    window.history.pushState({}, "", "/checkout?q=b");

    expect(routes).toHaveLength(0);
  });

  it("forces a full snapshot on the first route change", (): void => {
    window.history.pushState({}, "", "/cart");

    settle();

    expect(snapshotRequests).toBe(1);
  });

  /*
   * Routers call pushState and commit the new tree in a later task, so a
   * snapshot taken INSIDE pushState serialised the page the user just left
   * - a full document's worth of bytes for the wrong route, with the new one
   * still arriving as a mutation batch.
   */
  it("defers the forced snapshot until after the router has had a chance to render", (): void => {
    window.history.pushState({}, "", "/cart");

    /* Synchronously inside pushState: nothing yet. */
    expect(snapshotRequests).toBe(0);

    settle();

    expect(snapshotRequests).toBe(1);
  });

  it("does not take a deferred snapshot after stop", (): void => {
    window.history.pushState({}, "", "/cart");

    recorder.stop(window);
    settle();

    expect(snapshotRequests).toBe(0);
  });

  it("rate limits forced snapshots", (): void => {
    window.history.pushState({}, "", "/a");
    window.history.pushState({}, "", "/b");
    window.history.pushState({}, "", "/c");

    settle();

    expect(routes).toHaveLength(3);
    expect(snapshotRequests).toBe(1);
  });

  it("reports the current scrubbed url", (): void => {
    window.history.pushState({}, "", "/cart?utm=x");

    expect(recorder.getCurrentUrl()).toBe("https://shop.example.com/cart");
  });

  /*
   * Hash routers keep the whole route in the fragment, which UrlScrubber
   * drops - so `#/orders` -> `#/orders/42` used to scrub to identical
   * strings and every hash-routed app reported one page per session.
   */
  describe("hash routing", (): void => {
    it("records a hashchange between hash routes, scrubbed like a path", (): void => {
      window.history.replaceState({}, "", "/app#/orders");
      recorder.handle("replaceState", window);
      routes = [];

      window.location.hash = "#/orders/507f1f77bcf86cd799439011?token=s3cr3t";
      recorder.handle("hashchange", window);

      expect(routes).toHaveLength(1);
      expect(routes[0]?.kind).toBe("hashchange");
      expect(routes[0]?.from).toBe("https://shop.example.com/app#/orders");
      expect(routes[0]?.to).toBe(
        "https://shop.example.com/app#/orders/[redacted]",
      );
      expect(JSON.stringify(routes)).not.toContain("s3cr3t");
      expect(recorder.getCurrentUrl()).toBe(
        "https://shop.example.com/app#/orders/[redacted]",
      );
    });

    it("records a pushState that only changes the hash route", (): void => {
      window.history.pushState({}, "", "/app#/a");
      window.history.pushState({}, "", "/app#/b");

      expect(
        routes.map((route: RecordedRoute): string => {
          return route.to;
        }),
      ).toEqual([
        "https://shop.example.com/app#/a",
        "https://shop.example.com/app#/b",
      ]);
    });

    it("handles the hashbang form", (): void => {
      window.history.pushState({}, "", "/app#!/settings");

      expect(routes[0]?.to).toBe("https://shop.example.com/app#!/settings");
    });

    /* An in-page anchor is not a route: the route lane must not fill with them. */
    it("ignores a plain anchor fragment", (): void => {
      window.history.pushState({}, "", "/checkout#pricing");
      window.history.pushState({}, "", "/checkout#faq");

      expect(routes).toHaveLength(0);
      expect(recorder.getCurrentUrl()).toBe(
        "https://shop.example.com/checkout",
      );
    });

    it("scrubs a hash route on its own", (): void => {
      expect(
        RouteRecorder.scrubHashRoute("https://x.test/#/u/alice@example.com"),
      ).toBe("#/u/[redacted]");
      expect(RouteRecorder.scrubHashRoute("https://x.test/#/a?b=c")).toBe(
        "#/a",
      );
      expect(RouteRecorder.scrubHashRoute("https://x.test/#top")).toBe("");
      expect(RouteRecorder.scrubHashRoute("https://x.test/")).toBe("");
    });
  });

  /*
   * The cap used to exhaust silently: a polling app burned 500 route events
   * in an afternoon and every later session on that tab had an empty route
   * lane with nothing to say why.
   */
  describe("the per-session cap", (): void => {
    it("emits one marker when the cap is hit, and reports it once", (): void => {
      for (let index: number = 0; index < MAX_ROUTES_RECORDED + 10; index++) {
        window.history.pushState({}, "", `/page-${index}`);
      }

      expect(routes).toHaveLength(MAX_ROUTES_RECORDED);
      expect(recorder.getRecordedCount()).toBe(MAX_ROUTES_RECORDED);
      expect(recorder.hasReachedCap()).toBe(true);
      expect(capReports).toEqual([MAX_ROUTES_RECORDED]);

      const markers: Array<RecordedRoute> = customEvents
        .map((event: { tag: string; payload: unknown }): RecordedRoute => {
          return event.payload as RecordedRoute;
        })
        .filter((route: RecordedRoute): boolean => {
          return route.isCapMarker === true;
        });

      expect(markers).toHaveLength(1);
      expect(markers[0]?.to).toBe(
        `https://shop.example.com/page-${MAX_ROUTES_RECORDED}`,
      );
    });

    it("starts a fresh cap when the session rotates", (): void => {
      for (let index: number = 0; index < MAX_ROUTES_RECORDED + 1; index++) {
        window.history.pushState({}, "", `/page-${index}`);
      }

      expect(recorder.hasReachedCap()).toBe(true);

      recorder.resetForNewSession();

      expect(recorder.getRecordedCount()).toBe(0);
      expect(recorder.hasReachedCap()).toBe(false);

      window.history.pushState({}, "", "/after-rotation");

      expect(routes[routes.length - 1]?.to).toBe(
        "https://shop.example.com/after-rotation",
      );
      /* And the URL it is relative to survived the reset. */
      expect(routes[routes.length - 1]?.from).toBe(
        `https://shop.example.com/page-${MAX_ROUTES_RECORDED}`,
      );
    });
  });

  it("restores history methods on stop", (): void => {
    const patched: unknown = window.history.pushState;

    recorder.stop(window);

    expect(window.history.pushState).not.toBe(patched);

    window.history.pushState({}, "", "/after");

    expect(routes).toHaveLength(0);
  });
});
