import {
  SessionReplayChunkEnvelope,
  SessionReplayConfigResponse,
} from "Common/Types/Rum/SessionReplay";
import SessionReplayCaptureTrigger from "Common/Types/Rum/SessionReplayCaptureTrigger";
import SessionReplayConsentMode from "Common/Types/Rum/SessionReplayConsentMode";
import SessionReplayMaskingMode from "Common/Types/Rum/SessionReplayMaskingMode";
import { RecorderInitOptions } from "../src/Config";
import { EarlyErrorRecord } from "../src/EarlyErrors";

/*
 * The artifact entry point's bootstrap ordering.
 *
 * The one privacy-critical sequence pinned here: a consent decision the
 * page queued while the artifact downloaded must be applied BEFORE the
 * recorder starts, because replayEarlyErrors() runs at the end of start()
 * and can dispatch the session's very first upload. A revokeConsent that
 * loses that race uploads a recording of a user who already said no.
 */

const INIT_OPTIONS: RecorderInitOptions = {
  host: "https://oneuptime.com",
  token: "tok",
  appIdentifier: "app-1",
  respectDoNotTrack: true,
};

function baseConfig(): SessionReplayConfigResponse {
  return {
    enabled: true,
    recorderVersion: "11.7.3",
    maskingMode: SessionReplayMaskingMode.MaskAllText,
    captureTrigger: SessionReplayCaptureTrigger.OnErrorOrFrustration,
    consentMode: SessionReplayConsentMode.NotRequired,
    samplePercentage: 0,
    maskSelectors: [],
    blockSelectors: [],
    urlAllowlist: [],
    ignoreErrorPatterns: [],
    recordCanvas: false,
    captureUserIdentity: false,
    respectDoNotTrack: true,
    configEpoch: 1,
    directive: "continue",
  };
}

const EARLY_ERROR: EarlyErrorRecord = {
  kind: "error",
  message: "boom during startup",
  atUnixMs: Date.now() - 3000,
};

const VISITOR_KEY: string = "oneuptime.replay.visitor";

/* The envelope line of one posted chunk body. */
function envelopeOf(call: Array<unknown>): SessionReplayChunkEnvelope {
  const init: Record<string, unknown> = call[1] as Record<string, unknown>;
  const text: string = new TextDecoder().decode(init["body"] as Uint8Array);

  return JSON.parse(
    text.slice(0, text.indexOf("\n")),
  ) as SessionReplayChunkEnvelope;
}

describe("Index bootstrap ordering", (): void => {
  let fetchMock: jest.Mock;

  const globalRecord: Record<string, unknown> = globalThis as unknown as Record<
    string,
    unknown
  >;

  beforeEach((): void => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    document.body.innerHTML = "<div id='app'><p>content</p></div>";

    delete globalRecord["CompressionStream"];
    delete globalRecord["__ONEUPTIME_SESSION_REPLAY_STARTED__"];
    delete globalRecord["OneUptimeReplayQueue"];

    fetchMock = jest.fn().mockResolvedValue({
      status: 202,
      headers: {
        get: (): string | null => {
          return null;
        },
      },
      text: async (): Promise<string> => {
        return "";
      },
    });

    globalRecord["fetch"] = fetchMock;
    (window as unknown as Record<string, unknown>)["fetch"] = fetchMock;
  });

  afterEach((): void => {
    delete globalRecord["__ONEUPTIME_SESSION_REPLAY_STARTED__"];
    delete globalRecord["OneUptimeReplayQueue"];
    jest.restoreAllMocks();
  });

  const importIndex: () => Promise<
    typeof import("../src/Index")
  > = async (): Promise<typeof import("../src/Index")> => {
    jest.resetModules();
    return await import("../src/Index");
  };

  const tick: () => Promise<void> = async (): Promise<void> => {
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
  };

  it("a queued revokeConsent is applied BEFORE the early-error replay can upload", async (): Promise<void> => {
    globalRecord["OneUptimeReplayQueue"] = [["revokeConsent"]];

    const index: typeof import("../src/Index") = await importIndex();

    index.bootstrap(INIT_OPTIONS, baseConfig(), [EARLY_ERROR]);

    await tick();
    await tick();

    /*
     * Not one byte left the page. The recorder itself survives the revoke
     * (recording into memory, uploading nothing) so a later grantConsent()
     * can pick up on a fresh session - but every gate says why it is quiet.
     */
    expect(fetchMock).not.toHaveBeenCalled();
    expect(index.getDiagnostics().isUploading).toBe(false);
    expect(index.getDiagnostics().decisions?.uploadBlockedBy).toBe("consent");
    expect(index.getDiagnostics().decisions?.uploadsAllowed).toBe(false);

    index.stop();
  });

  it("without a queued revoke, the same early error uploads (positive control)", async (): Promise<void> => {
    const index: typeof import("../src/Index") = await importIndex();

    index.bootstrap(INIT_OPTIONS, baseConfig(), [EARLY_ERROR]);

    await tick();
    await tick();

    expect(index.getSessionId()).not.toBeNull();
    expect(fetchMock).toHaveBeenCalled();

    index.stop();
  });

  it("non-consent commands queued during load still run, after start", async (): Promise<void> => {
    /*
     * captureSession pre-start would arm a trigger on a recorder with no
     * snapshot; the split drain defers it, not drops it.
     */
    globalRecord["OneUptimeReplayQueue"] = [["captureSession"]];

    const index: typeof import("../src/Index") = await importIndex();

    index.bootstrap(INIT_OPTIONS, baseConfig(), []);

    await tick();
    await tick();

    expect(fetchMock).toHaveBeenCalled();

    index.stop();
  });

  /*
   * The anonymous visitor id follows the same pre-start ordering as the
   * session id: the constructor mints one, and a revoke the page queued while
   * the artifact downloaded clears it before start() - so a user who said no
   * leaves nothing in storage that a later visit could be linked back to.
   */
  it("a queued revokeConsent leaves no visitor id behind", async (): Promise<void> => {
    globalRecord["OneUptimeReplayQueue"] = [["revokeConsent"]];

    const index: typeof import("../src/Index") = await importIndex();

    index.bootstrap(INIT_OPTIONS, baseConfig(), [EARLY_ERROR]);

    await tick();
    await tick();

    expect(index.getVisitorId()).toBe("");
    expect(index.getDiagnostics().visitorId).toBe("");
    expect(window.localStorage.getItem(VISITOR_KEY)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    index.stop();
  });

  /*
   * Consent platforms fire reject-then-accept inside one page life, and both
   * can land before start(). The grant has to mint a visitor id even though
   * it switches no session on a recorder that has not started: the revoke
   * cleared the constructor's id and start() never resolves identity again,
   * so without this the whole page life would upload meta with no visitor id
   * on it.
   */
  it("a queued reject-then-accept still starts with a visitor id", async (): Promise<void> => {
    globalRecord["OneUptimeReplayQueue"] = [
      ["revokeConsent"],
      ["grantConsent"],
    ];

    const index: typeof import("../src/Index") = await importIndex();

    index.bootstrap(
      INIT_OPTIONS,
      { ...baseConfig(), samplePercentage: 100 },
      [],
    );

    await tick();
    await tick();

    const visitorId: string = index.getVisitorId();

    expect(visitorId).toMatch(/^[0-9a-f]{32}$/);
    expect(index.getDiagnostics().visitorId).toBe(visitorId);
    expect(window.localStorage.getItem(VISITOR_KEY)).toBe(visitorId);
    expect(fetchMock).toHaveBeenCalled();

    const chunkZero: SessionReplayChunkEnvelope = envelopeOf(
      fetchMock.mock.calls[0] as Array<unknown>,
    );

    expect(chunkZero.chunkIndex).toBe(0);
    expect(chunkZero.meta?.visitorId).toBe(visitorId);

    index.stop();
  });
});
