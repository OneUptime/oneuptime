import UrlScrubber from "Common/Utils/Rum/UrlScrubber";
import RouteRecorder, {
  ROUTE_CUSTOM_EVENT_TAG,
  RecordedRoute,
} from "../src/RouteRecorder";

describe("RouteRecorder", (): void => {
  let routes: Array<RecordedRoute> = [];
  let customEvents: Array<{ tag: string; payload: unknown }> = [];
  let snapshotRequests: number = 0;
  let recorder: RouteRecorder;

  beforeEach((): void => {
    routes = [];
    customEvents = [];
    snapshotRequests = 0;

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
    });

    recorder.start(window);
  });

  afterEach((): void => {
    recorder.stop(window);
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

    expect(snapshotRequests).toBe(1);
  });

  it("rate limits forced snapshots", (): void => {
    window.history.pushState({}, "", "/a");
    window.history.pushState({}, "", "/b");
    window.history.pushState({}, "", "/c");

    expect(routes).toHaveLength(3);
    expect(snapshotRequests).toBe(1);
  });

  it("reports the current scrubbed url", (): void => {
    window.history.pushState({}, "", "/cart?utm=x");

    expect(recorder.getCurrentUrl()).toBe("https://shop.example.com/cart");
  });

  it("restores history methods on stop", (): void => {
    const patched: unknown = window.history.pushState;

    recorder.stop(window);

    expect(window.history.pushState).not.toBe(patched);

    window.history.pushState({}, "", "/after");

    expect(routes).toHaveLength(0);
  });
});
