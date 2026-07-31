import UrlScrubber from "Common/Utils/Rum/UrlScrubber";
import NetworkRecorder, {
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
