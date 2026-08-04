import UrlScrubber from "Common/Utils/Rum/UrlScrubber";
import NetworkRecorder, {
  GeneratedTraceParent,
  NETWORK_CUSTOM_EVENT_TAG,
  RecordedRequest,
} from "../src/NetworkRecorder";

describe("NetworkRecorder", (): void => {
  let requests: Array<{ request: RecordedRequest; traceId: string | null }> =
    [];
  let customEvents: Array<{ tag: string; payload: unknown }> = [];
  let activity: Array<number> = [];
  let recorder: NetworkRecorder;

  const makeRecorder: () => NetworkRecorder = (): NetworkRecorder => {
    requests = [];
    customEvents = [];
    activity = [];

    return new NetworkRecorder({
      emitCustomEvent: (tag: string, payload: unknown): void => {
        customEvents.push({ tag: tag, payload: payload });
      },
      onRequestComplete: (
        _atUnixMs: number,
        request: RecordedRequest,
        traceId: string | null,
      ): void => {
        requests.push({ request: request, traceId: traceId });
      },
      onActivity: (atUnixMs: number): void => {
        activity.push(atUnixMs);
      },
      scrubUrl: (url: string): string => {
        return UrlScrubber.scrub(url);
      },
      isSelfRequest: (url: string): boolean => {
        return url.indexOf("https://oneuptime.com") === 0;
      },
    });
  };

  const okResponse: (status?: number) => Response = (
    status?: number,
  ): Response => {
    return {
      status: status === undefined ? 200 : status,
      headers: {
        get: (name: string): string | null => {
          return name.toLowerCase() === "content-length" ? "1234" : null;
        },
      },
    } as unknown as Response;
  };

  beforeEach((): void => {
    recorder = makeRecorder();
  });

  afterEach((): void => {
    recorder.stop(window);
    jest.restoreAllMocks();
  });

  describe("fetch", (): void => {
    it("records method, scrubbed url, status and size", async (): Promise<void> => {
      const original: jest.Mock = jest.fn().mockResolvedValue(okResponse(200));

      (window as unknown as Record<string, unknown>)["fetch"] = original;

      recorder.start(window);

      await window.fetch(
        "https://api.example.com/users/alice@example.com?token=abc123",
        { method: "POST" },
      );

      expect(requests).toHaveLength(1);
      expect(requests[0]?.request.method).toBe("POST");
      expect(requests[0]?.request.status).toBe(200);
      expect(requests[0]?.request.responseBytes).toBe(1234);

      /* Query dropped, email path segment redacted. */
      expect(requests[0]?.request.url).toBe(
        "https://api.example.com/users/[redacted]",
      );
      expect(requests[0]?.request.url).not.toContain("token");
      expect(requests[0]?.request.url).not.toContain("alice");
    });

    it("flags a 5xx as an error so the recorder can trigger on it", async (): Promise<void> => {
      (window as unknown as Record<string, unknown>)["fetch"] = jest
        .fn()
        .mockResolvedValue(okResponse(503));

      recorder.start(window);

      await window.fetch("https://api.example.com/x");

      expect(requests[0]?.request.isError).toBe(true);
    });

    it("records a network failure as status 0 and rethrows unchanged", async (): Promise<void> => {
      const failure: Error = new Error("offline");

      (window as unknown as Record<string, unknown>)["fetch"] = jest
        .fn()
        .mockRejectedValue(failure);

      recorder.start(window);

      await expect(window.fetch("https://api.example.com/x")).rejects.toBe(
        failure,
      );

      expect(requests[0]?.request.status).toBe(0);
      expect(requests[0]?.request.isError).toBe(true);
    });

    /*
     * Without this the recorder's own flush would create a network event that
     * lands in the next chunk, which triggers another flush - a feedback loop
     * that never converges.
     */
    it("never records its own ingest requests", async (): Promise<void> => {
      (window as unknown as Record<string, unknown>)["fetch"] = jest
        .fn()
        .mockResolvedValue(okResponse());

      recorder.start(window);

      await window.fetch("https://oneuptime.com/session-replay/v1/chunk");

      expect(requests).toHaveLength(0);
      expect(customEvents).toHaveLength(0);
    });

    it("captures an outgoing traceparent for correlation", async (): Promise<void> => {
      (window as unknown as Record<string, unknown>)["fetch"] = jest
        .fn()
        .mockResolvedValue(okResponse());

      recorder.start(window);

      await window.fetch("https://api.example.com/x", {
        headers: {
          traceparent: `00-${"a".repeat(32)}-${"b".repeat(16)}-01`,
        },
      });

      expect(requests[0]?.traceId).toBe("a".repeat(32));
    });

    it("emits a type-5 custom event and reports activity", async (): Promise<void> => {
      (window as unknown as Record<string, unknown>)["fetch"] = jest
        .fn()
        .mockResolvedValue(okResponse());

      recorder.start(window);

      await window.fetch("https://api.example.com/x");

      expect(customEvents[0]?.tag).toBe(NETWORK_CUSTOM_EVENT_TAG);
      expect(activity).toHaveLength(1);
    });

    it("restores the original fetch on stop", (): void => {
      const original: jest.Mock = jest.fn();

      (window as unknown as Record<string, unknown>)["fetch"] = original;

      recorder.start(window);
      expect(window.fetch).not.toBe(original);

      recorder.stop(window);
      expect(window.fetch).toBe(original);
    });

    /*
     * The payload never carries a body, and Authorization / Cookie are never
     * even read - only traceparent is inspected.
     */
    it("records nothing from the request body or auth headers", async (): Promise<void> => {
      (window as unknown as Record<string, unknown>)["fetch"] = jest
        .fn()
        .mockResolvedValue(okResponse());

      recorder.start(window);

      await window.fetch("https://api.example.com/login", {
        method: "POST",
        body: JSON.stringify({ password: "hunter2" }),
        headers: { Authorization: "Bearer super-secret" },
      });

      const serialised: string = JSON.stringify(customEvents);

      expect(serialised).not.toContain("hunter2");
      expect(serialised).not.toContain("super-secret");
      expect(serialised).not.toContain("Authorization");
    });
  });

  describe("parseTraceParent", (): void => {
    it("accepts a well-formed header", (): void => {
      expect(
        NetworkRecorder.parseTraceParent(
          `00-${"f".repeat(32)}-${"1".repeat(16)}-01`,
        ),
      ).toBe("f".repeat(32));
    });

    it("rejects anything malformed", (): void => {
      expect(NetworkRecorder.parseTraceParent("garbage")).toBeNull();
      expect(NetworkRecorder.parseTraceParent("00-short-1234-01")).toBeNull();
    });
  });
});

/*
 * Traceparent INJECTION - the opt-in half of correlation. The passive half
 * (reading a header the page set itself) is covered above; everything here
 * asserts the conditions under which the recorder adds a header to someone
 * else's request, because a wrongly-added header is a broken CORS preflight
 * on a page we do not own.
 */
describe("NetworkRecorder traceparent injection", (): void => {
  const TRACEPARENT_SHAPE: RegExp = /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/;

  let requests: Array<{ request: RecordedRequest; traceId: string | null }> =
    [];
  let customEvents: Array<{ tag: string; payload: unknown }> = [];
  let recorder: NetworkRecorder | null = null;

  type FetchMock = jest.Mock;

  const makeRecorder: (origins: Array<string>) => NetworkRecorder = (
    origins: Array<string>,
  ): NetworkRecorder => {
    requests = [];
    customEvents = [];

    return new NetworkRecorder({
      emitCustomEvent: (tag: string, payload: unknown): void => {
        customEvents.push({ tag: tag, payload: payload });
      },
      onRequestComplete: (
        _atUnixMs: number,
        request: RecordedRequest,
        traceId: string | null,
      ): void => {
        requests.push({ request: request, traceId: traceId });
      },
      onActivity: (): void => {},
      scrubUrl: (url: string): string => {
        return UrlScrubber.scrub(url);
      },
      isSelfRequest: (url: string): boolean => {
        return url.indexOf("https://oneuptime.com") === 0;
      },
      tracePropagationOrigins: origins,
    });
  };

  const installFetchMock: () => FetchMock = (): FetchMock => {
    const mock: FetchMock = jest.fn().mockResolvedValue({
      status: 200,
      headers: {
        get: (): string | null => {
          return null;
        },
      },
    } as unknown as Response);

    (window as unknown as Record<string, unknown>)["fetch"] = mock;

    return mock;
  };

  /* The header the mock actually received, whatever HeadersInit shape. */
  const sentTraceParent: (mock: FetchMock) => string | null = (
    mock: FetchMock,
  ): string | null => {
    const init: RequestInit | undefined = mock.mock.calls[0]?.[1];

    if (!init || !init.headers) {
      return null;
    }

    if (init.headers instanceof Headers) {
      return init.headers.get("traceparent");
    }

    if (Array.isArray(init.headers)) {
      const pair: Array<string> | undefined = (
        init.headers as Array<Array<string>>
      ).find((entry: Array<string>): boolean => {
        return (entry[0] || "").toLowerCase() === "traceparent";
      });

      return pair ? pair[1] || null : null;
    }

    const record: Record<string, string> = init.headers as Record<
      string,
      string
    >;

    const key: string | undefined = Object.keys(record).find(
      (name: string): boolean => {
        return name.toLowerCase() === "traceparent";
      },
    );

    return key === undefined ? null : record[key] || null;
  };

  afterEach((): void => {
    if (recorder) {
      recorder.stop(window);
      recorder = null;
    }

    jest.restoreAllMocks();
  });

  describe("generateTraceParent", (): void => {
    it("mints a spec-shaped, sampled header whose trace id round-trips", (): void => {
      const generated: GeneratedTraceParent | null =
        NetworkRecorder.generateTraceParent();

      expect(generated).not.toBeNull();
      expect(generated?.header).toMatch(TRACEPARENT_SHAPE);
      expect(NetworkRecorder.parseTraceParent(generated?.header || "")).toBe(
        generated?.traceId,
      );
    });

    it("mints distinct ids per call", (): void => {
      const first: GeneratedTraceParent | null =
        NetworkRecorder.generateTraceParent();
      const second: GeneratedTraceParent | null =
        NetworkRecorder.generateTraceParent();

      expect(first?.traceId).not.toBe(second?.traceId);
    });

    it("returns null instead of guessable ids when randomness fails", (): void => {
      jest
        .spyOn(window.crypto, "getRandomValues")
        .mockImplementation((): never => {
          throw new Error("no entropy");
        });

      expect(NetworkRecorder.generateTraceParent()).toBeNull();
    });
  });

  describe("fetch injection", (): void => {
    it("injects into an allowlisted absolute URL and reports the same id everywhere", async (): Promise<void> => {
      const mock: FetchMock = installFetchMock();

      recorder = makeRecorder(["https://api.allowed.com"]);
      recorder.start(window);

      await window.fetch("https://api.allowed.com/orders", {
        method: "POST",
      });

      const header: string | null = sentTraceParent(mock);

      expect(header).toMatch(TRACEPARENT_SHAPE);

      const traceId: string | null = NetworkRecorder.parseTraceParent(
        header || "",
      );

      /* One id, three witnesses: header, completion callback, payload. */
      expect(requests[0]?.traceId).toBe(traceId);
      expect(
        (customEvents[0]?.payload as RecordedRequest | undefined)?.traceId,
      ).toBe(traceId);

      /* The rest of the init survives the copy. */
      expect(mock.mock.calls[0]?.[1]?.method).toBe("POST");
    });

    it("resolves relative URLs against the page before matching", async (): Promise<void> => {
      const mock: FetchMock = installFetchMock();

      /* jest.config.json pins the test page to https://shop.example.com. */
      recorder = makeRecorder(["https://shop.example.com"]);
      recorder.start(window);

      await window.fetch("/api/cart");

      expect(sentTraceParent(mock)).toMatch(TRACEPARENT_SHAPE);
    });

    it("does not inject for an origin that is not allowlisted", async (): Promise<void> => {
      const mock: FetchMock = installFetchMock();

      recorder = makeRecorder(["https://api.allowed.com"]);
      recorder.start(window);

      await window.fetch("https://other.example.com/x");

      expect(sentTraceParent(mock)).toBeNull();

      /* Recorded, just not annotated. */
      expect(requests).toHaveLength(1);
      expect(requests[0]?.traceId).toBeNull();
    });

    it("never injects while the allowlist is empty", async (): Promise<void> => {
      const mock: FetchMock = installFetchMock();

      recorder = makeRecorder([]);
      recorder.start(window);

      await window.fetch("https://api.allowed.com/x");

      /* No injection means the init is not even rebuilt. */
      expect(mock.mock.calls[0]?.[1]).toBeUndefined();
    });

    it("matches an allowlist entry by ORIGIN, ignoring path and case", async (): Promise<void> => {
      const mock: FetchMock = installFetchMock();

      recorder = makeRecorder(["HTTPS://API.Allowed.COM/v2/deep/path"]);
      recorder.start(window);

      await window.fetch("https://api.allowed.com/entirely/other/path");

      expect(sentTraceParent(mock)).toMatch(TRACEPARENT_SHAPE);
    });

    it("drops allowlist entries that do not parse as URLs", async (): Promise<void> => {
      const mock: FetchMock = installFetchMock();

      recorder = makeRecorder(["not a url at all"]);
      recorder.start(window);

      await window.fetch("https://not-a-url-at-all/x");

      expect(sentTraceParent(mock)).toBeNull();
    });

    it("leaves a traceparent the page set itself untouched", async (): Promise<void> => {
      const mock: FetchMock = installFetchMock();
      const pageHeader: string = `00-${"a".repeat(32)}-${"b".repeat(16)}-01`;

      recorder = makeRecorder(["https://api.allowed.com"]);
      recorder.start(window);

      await window.fetch("https://api.allowed.com/x", {
        headers: { traceparent: pageHeader },
      });

      expect(sentTraceParent(mock)).toBe(pageHeader);
      expect(requests[0]?.traceId).toBe("a".repeat(32));
    });

    it("respects an existing traceparent in every HeadersInit shape", async (): Promise<void> => {
      const pageHeader: string = `00-${"c".repeat(32)}-${"d".repeat(16)}-01`;

      for (const headers of [
        new Headers({ traceparent: pageHeader }),
        [["traceparent", pageHeader]] as Array<[string, string]>,
        { TraceParent: pageHeader },
      ]) {
        const mock: FetchMock = installFetchMock();

        recorder = makeRecorder(["https://api.allowed.com"]);
        recorder.start(window);

        await window.fetch("https://api.allowed.com/x", {
          headers: headers as HeadersInit,
        });

        expect(sentTraceParent(mock)).toBe(pageHeader);

        /*
         * The recorded trace id must be the PAGE's, not a freshly minted
         * one — this is what actually fails if any shape's detection
         * breaks and injection adds a second header behind the first.
         */
        expect(requests[0]?.traceId).toBe("c".repeat(32));

        /* And exactly one traceparent goes on the wire. */
        const init: RequestInit | undefined = mock.mock.calls[0]?.[1];

        if (Array.isArray(init?.headers)) {
          expect(
            (init?.headers as Array<Array<string>>).filter(
              (pair: Array<string>): boolean => {
                return (pair[0] || "").toLowerCase() === "traceparent";
              },
            ),
          ).toHaveLength(1);
        }

        recorder.stop(window);
        recorder = null;
      }
    });

    /*
     * Presence beats parseability: a future-version or vendor-lenient
     * traceparent the page's own backend accepts must be neither
     * overwritten (record/Headers shapes) nor doubled (array shape).
     */
    it("stands down for a page-set traceparent it cannot parse", async (): Promise<void> => {
      const futureVersionHeader: string = `01-${"a".repeat(32)}-${"b".repeat(
        16,
      )}-01-extrafield`;

      const mock: FetchMock = installFetchMock();

      recorder = makeRecorder(["https://api.allowed.com"]);
      recorder.start(window);

      await window.fetch("https://api.allowed.com/x", {
        headers: { traceparent: futureVersionHeader },
      });

      /* The page's header goes out exactly as set; no id is reported. */
      expect(sentTraceParent(mock)).toBe(futureVersionHeader);
      expect(requests[0]?.traceId).toBeNull();
    });

    /*
     * HeadersInit's sequence branch accepts ANY iterable of pairs. A Map
     * spread into a plain object loses every entry, so the merge must go
     * through the Headers constructor — dropping the page's Authorization
     * header here would break their API calls, which is worse than any
     * missing correlation.
     */
    it("merges Map headers without dropping the page's own entries", async (): Promise<void> => {
      const mock: FetchMock = installFetchMock();

      recorder = makeRecorder(["https://api.allowed.com"]);
      recorder.start(window);

      await window.fetch("https://api.allowed.com/x", {
        headers: new Map([
          ["authorization", "Bearer page-token"],
        ]) as unknown as HeadersInit,
      });

      const sent: RequestInit | undefined = mock.mock.calls[0]?.[1];
      const merged: Headers = sent?.headers as Headers;

      expect(merged instanceof Headers).toBe(true);
      expect(merged.get("authorization")).toBe("Bearer page-token");
      expect(merged.get("traceparent")).toMatch(TRACEPARENT_SHAPE);
    });

    it("stands down for a traceparent set inside a Map", async (): Promise<void> => {
      const pageHeader: string = `00-${"d".repeat(32)}-${"e".repeat(16)}-01`;
      const mock: FetchMock = installFetchMock();

      recorder = makeRecorder(["https://api.allowed.com"]);
      recorder.start(window);

      await window.fetch("https://api.allowed.com/x", {
        headers: new Map([
          ["traceparent", pageHeader],
        ]) as unknown as HeadersInit,
      });

      /* No merge happened: the page's own Map rides through untouched. */
      expect(mock.mock.calls[0]?.[1]?.headers instanceof Map).toBe(true);
      expect(requests[0]?.traceId).toBe("d".repeat(32));
    });

    /*
     * fetch and XHR resolve relative URLs against the DOCUMENT BASE URL,
     * which <base href> can point at another origin. Matching against
     * location.href instead would inject into a request that really goes
     * to a never-allowlisted origin — the exact preflight breakage the
     * allowlist exists to prevent.
     */
    it("resolves relative URLs against a cross-origin <base href>, not the page origin", async (): Promise<void> => {
      const base: HTMLBaseElement = document.createElement("base");

      base.href = "https://cdn.other.example/";
      document.head.appendChild(base);

      try {
        const mock: FetchMock = installFetchMock();

        /* The PAGE origin is allowlisted; the BASE origin is not. */
        recorder = makeRecorder(["https://shop.example.com"]);
        recorder.start(window);

        await window.fetch("/api/cart");

        expect(mock.mock.calls[0]?.[1]).toBeUndefined();

        recorder.stop(window);

        /* Allowlisting the BASE origin is what enables injection. */
        const mock2: FetchMock = installFetchMock();

        recorder = makeRecorder(["https://cdn.other.example"]);
        recorder.start(window);

        await window.fetch("/api/cart");

        expect(sentTraceParent(mock2)).toMatch(TRACEPARENT_SHAPE);
      } finally {
        base.remove();
      }
    });

    it("does not throw synchronously for fetch(null), matching native fetch", async (): Promise<void> => {
      installFetchMock();

      recorder = makeRecorder(["https://api.allowed.com"]);
      recorder.start(window);

      await expect(
        window.fetch(null as unknown as RequestInfo),
      ).resolves.toBeDefined();
    });

    it("skips Request-object inputs rather than rebuilding them", async (): Promise<void> => {
      const mock: FetchMock = installFetchMock();

      recorder = makeRecorder(["https://api.allowed.com"]);
      recorder.start(window);

      /*
       * A Request-shaped object rather than new Request(): jsdom does not
       * ship the constructor, and the code under test only cares that the
       * input is neither a string nor a URL.
       */
      const requestLike: RequestInfo = {
        url: "https://api.allowed.com/x",
        method: "POST",
      } as unknown as RequestInfo;

      await window.fetch(requestLike);

      /* The Request rides through with no second argument added. */
      expect(mock.mock.calls[0]?.[0]).toBe(requestLike);
      expect(mock.mock.calls[0]?.[1]).toBeUndefined();
      expect(requests[0]?.traceId).toBeNull();
    });

    it("never mutates the caller's own init object", async (): Promise<void> => {
      installFetchMock();

      const callerInit: RequestInit = {
        method: "PUT",
        headers: { "content-type": "application/json" },
      };

      recorder = makeRecorder(["https://api.allowed.com"]);
      recorder.start(window);

      await window.fetch("https://api.allowed.com/x", callerInit);

      expect(callerInit.headers).toEqual({
        "content-type": "application/json",
      });
    });

    it("does not inject into the recorder's own ingest requests", async (): Promise<void> => {
      const mock: FetchMock = installFetchMock();

      /* Even a hostile allowlist naming our own host must not annotate. */
      recorder = makeRecorder(["https://oneuptime.com"]);
      recorder.start(window);

      await window.fetch("https://oneuptime.com/session-replay/v1/chunk");

      expect(mock.mock.calls[0]?.[1]).toBeUndefined();
    });

    it("does not inject into non-http(s) schemes", async (): Promise<void> => {
      const mock: FetchMock = installFetchMock();

      recorder = makeRecorder(["https://api.allowed.com"]);
      recorder.start(window);

      await window.fetch("data:text/plain,hello");

      expect(mock.mock.calls[0]?.[1]).toBeUndefined();
    });
  });

  describe("XHR injection", (): void => {
    /*
     * The prototype methods are replaced with inert spies BEFORE the
     * recorder patches them, so "the original" the recorder calls through
     * to is fully observable and nothing touches the network.
     */
    let openSpy: jest.Mock;
    let sendSpy: jest.Mock;
    let setHeaderSpy: jest.Mock;

    let savedOpen: unknown;
    let savedSend: unknown;
    let savedSetHeader: unknown;

    const prototype: Record<string, unknown> =
      XMLHttpRequest.prototype as unknown as Record<string, unknown>;

    beforeEach((): void => {
      openSpy = jest.fn();
      sendSpy = jest.fn();
      setHeaderSpy = jest.fn();

      savedOpen = prototype["open"];
      savedSend = prototype["send"];
      savedSetHeader = prototype["setRequestHeader"];

      prototype["open"] = openSpy;
      prototype["send"] = sendSpy;
      prototype["setRequestHeader"] = setHeaderSpy;
    });

    afterEach((): void => {
      if (recorder) {
        recorder.stop(window);
        recorder = null;
      }

      prototype["open"] = savedOpen;
      prototype["send"] = savedSend;
      prototype["setRequestHeader"] = savedSetHeader;
    });

    it("injects via the original setRequestHeader and reports the id on loadend", (): void => {
      recorder = makeRecorder(["https://api.allowed.com"]);
      recorder.start(window);

      const xhr: XMLHttpRequest = new XMLHttpRequest();

      xhr.open("GET", "https://api.allowed.com/data");
      xhr.send();

      expect(setHeaderSpy).toHaveBeenCalledTimes(1);

      const headerName: string = setHeaderSpy.mock.calls[0]?.[0];
      const headerValue: string = setHeaderSpy.mock.calls[0]?.[1];

      expect(headerName).toBe("traceparent");
      expect(headerValue).toMatch(TRACEPARENT_SHAPE);

      /* The underlying send still runs exactly once. */
      expect(sendSpy).toHaveBeenCalledTimes(1);

      xhr.dispatchEvent(new Event("loadend"));

      expect(requests).toHaveLength(1);
      expect(requests[0]?.traceId).toBe(
        NetworkRecorder.parseTraceParent(headerValue),
      );
    });

    it("does not inject when the page set its own traceparent", (): void => {
      const pageHeader: string = `00-${"e".repeat(32)}-${"f".repeat(16)}-01`;

      recorder = makeRecorder(["https://api.allowed.com"]);
      recorder.start(window);

      const xhr: XMLHttpRequest = new XMLHttpRequest();

      xhr.open("GET", "https://api.allowed.com/data");
      xhr.setRequestHeader("traceparent", pageHeader);
      xhr.send();

      /* Exactly the page's own call reached the platform - no second one. */
      expect(setHeaderSpy).toHaveBeenCalledTimes(1);
      expect(setHeaderSpy.mock.calls[0]?.[1]).toBe(pageHeader);

      xhr.dispatchEvent(new Event("loadend"));

      expect(requests[0]?.traceId).toBe("e".repeat(32));
    });

    it("does not inject for a non-allowlisted origin", (): void => {
      recorder = makeRecorder(["https://api.allowed.com"]);
      recorder.start(window);

      const xhr: XMLHttpRequest = new XMLHttpRequest();

      xhr.open("GET", "https://other.example.com/data");
      xhr.send();

      expect(setHeaderSpy).not.toHaveBeenCalled();
    });

    it("resolves relative XHR URLs against the page before matching", (): void => {
      recorder = makeRecorder(["https://shop.example.com"]);
      recorder.start(window);

      const xhr: XMLHttpRequest = new XMLHttpRequest();

      xhr.open("GET", "/api/cart");
      xhr.send();

      expect(setHeaderSpy).toHaveBeenCalledTimes(1);
      expect(setHeaderSpy.mock.calls[0]?.[0]).toBe("traceparent");
    });

    /*
     * XHR objects are legally reusable, and pooling/polling code reuses
     * them. Each request must record exactly once, against its own
     * method/url/timing — a stale listener from request 1 must not fire
     * for request 2's response.
     */
    it("records a reused XHR exactly once per request, with the right attribution", (): void => {
      recorder = makeRecorder([]);
      recorder.start(window);

      const xhr: XMLHttpRequest = new XMLHttpRequest();

      xhr.open("GET", "https://one.example.com/first");
      xhr.send();
      xhr.dispatchEvent(new Event("loadend"));

      xhr.open("GET", "https://two.example.com/second");
      xhr.send();
      xhr.dispatchEvent(new Event("loadend"));

      expect(requests).toHaveLength(2);
      expect(requests[0]?.request.url).toContain("one.example.com");
      expect(requests[1]?.request.url).toContain("two.example.com");
    });

    it("stands down for an unparseable page-set traceparent instead of adding a second one", (): void => {
      recorder = makeRecorder(["https://api.allowed.com"]);
      recorder.start(window);

      const xhr: XMLHttpRequest = new XMLHttpRequest();

      xhr.open("GET", "https://api.allowed.com/data");
      xhr.setRequestHeader("traceparent", "not-a-w3c-header");
      xhr.send();

      /* Only the page's own call reached the platform. */
      expect(setHeaderSpy).toHaveBeenCalledTimes(1);
      expect(setHeaderSpy.mock.calls[0]?.[1]).toBe("not-a-w3c-header");
    });

    it("proceeds un-annotated when setRequestHeader throws", (): void => {
      setHeaderSpy.mockImplementation((): never => {
        throw new Error("InvalidStateError");
      });

      recorder = makeRecorder(["https://api.allowed.com"]);
      recorder.start(window);

      const xhr: XMLHttpRequest = new XMLHttpRequest();

      xhr.open("GET", "https://api.allowed.com/data");

      expect((): void => {
        xhr.send();
      }).not.toThrow();

      xhr.dispatchEvent(new Event("loadend"));

      expect(requests[0]?.traceId).toBeNull();
      expect(sendSpy).toHaveBeenCalledTimes(1);
    });
  });
});
