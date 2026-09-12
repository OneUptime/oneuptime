import {
  SESSION_REPLAY_INPUT_SAMPLING,
  SESSION_REPLAY_MOUSEMOVE_SAMPLE_MS,
  SESSION_REPLAY_SCROLL_SAMPLE_MS,
  SessionReplayConfigResponse,
} from "Common/Types/Rum/SessionReplay";
import SessionReplayCaptureTrigger from "Common/Types/Rum/SessionReplayCaptureTrigger";
import SessionReplayConsentMode from "Common/Types/Rum/SessionReplayConsentMode";
import SessionReplayMaskingMode from "Common/Types/Rum/SessionReplayMaskingMode";
import { record } from "rrweb";
import { RecorderInitOptions } from "../src/Config";
import Recorder from "../src/Recorder";

/*
 * The one place rrweb is a double. Recorder.test.ts deliberately runs the
 * real library so its assertions are about what gets recorded; this file
 * only needs the OPTIONS the recorder hands to record(), because the
 * sampling cadences are a contract with the player (the stage draws its
 * cursor transition exactly one mousemove sample long) and with the
 * customer's byte budget, and a behavioural test cannot tell 50 ms from 60.
 *
 * The mock has to be a function with the three members the recorder
 * reaches for outside of startRrweb: mirror (attribute-mutation
 * sanitising), addCustomEvent (custom events) and takeFullSnapshot
 * (identify). A bare jest.fn() would make start() throw on the first of
 * them it touched.
 */
jest.mock("rrweb", (): Record<string, unknown> => {
  const recordMock: jest.Mock = jest.fn((): (() => void) => {
    return (): void => {};
  });

  Object.assign(recordMock, {
    mirror: {
      getNode: (): Node | null => {
        return null;
      },
      getId: (): number => {
        return -1;
      },
    },
    addCustomEvent: jest.fn(),
    takeFullSnapshot: jest.fn(),
  });

  return { record: recordMock };
});

interface SamplingOptions {
  mousemove: unknown;
  mouseInteraction: unknown;
  scroll: unknown;
  input: unknown;
}

const INIT_OPTIONS: RecorderInitOptions = {
  host: "https://oneuptime.com",
  token: "test-token",
  appIdentifier: "app-1",
};

function baseConfig(): SessionReplayConfigResponse {
  return {
    enabled: true,
    recorderVersion: "11.7.3",
    maskingMode: SessionReplayMaskingMode.MaskSensitiveInputsOnly,
    captureTrigger: SessionReplayCaptureTrigger.Always,
    consentMode: SessionReplayConsentMode.NotRequired,
    samplePercentage: 100,
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

describe("Recorder rrweb sampling", (): void => {
  let recorder: Recorder | null = null;

  beforeEach((): void => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    document.body.innerHTML = "<div id='app'><p>content</p></div>";

    (globalThis as unknown as Record<string, unknown>)["fetch"] = jest
      .fn()
      .mockResolvedValue({
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

    (record as unknown as jest.Mock).mockClear();
  });

  afterEach((): void => {
    if (recorder) {
      recorder.stop();
      recorder = null;
    }
  });

  const recordedSampling: () => SamplingOptions = (): SamplingOptions => {
    const recordMock: jest.Mock = record as unknown as jest.Mock;

    expect(recordMock).toHaveBeenCalledTimes(1);

    const options: Record<string, unknown> = recordMock.mock
      .calls[0]?.[0] as Record<string, unknown>;

    expect(options).toBeDefined();
    expect(options["sampling"]).toBeDefined();

    return options["sampling"] as SamplingOptions;
  };

  it("hands rrweb the shared sampling cadences", (): void => {
    recorder = new Recorder({
      initOptions: INIT_OPTIONS,
      config: baseConfig(),
    });

    recorder.start();

    const sampling: SamplingOptions = recordedSampling();

    expect(sampling.mousemove).toBe(SESSION_REPLAY_MOUSEMOVE_SAMPLE_MS);
    expect(sampling.scroll).toBe(SESSION_REPLAY_SCROLL_SAMPLE_MS);
    expect(sampling.input).toBe(SESSION_REPLAY_INPUT_SAMPLING);
    expect(sampling.mouseInteraction).toBe(true);
  });

  /*
   * The literal values, on purpose and separately from the constants: the
   * "mousemove-50ms" capability the recorder advertises on chunk 0 is a
   * promise to the player about the number itself, and a change to the
   * constant would otherwise pass the test above while breaking every
   * player that trusted the capability.
   */
  it("samples mouse at 50 ms, scroll at 100 ms and every input event", (): void => {
    recorder = new Recorder({
      initOptions: INIT_OPTIONS,
      config: baseConfig(),
    });

    recorder.start();

    const sampling: SamplingOptions = recordedSampling();

    expect(sampling.mousemove).toBe(50);
    expect(sampling.scroll).toBe(100);
    expect(sampling.input).toBe("all");
    expect(sampling.mouseInteraction).toBe(true);
  });

  it("advertises the mousemove cadence it records with", (): void => {
    recorder = new Recorder({
      initOptions: INIT_OPTIONS,
      config: baseConfig(),
    });

    recorder.start();

    expect(recorder.getCapabilities()).toContain("mousemove-50ms");
    expect(recordedSampling().mousemove).toBe(50);
  });

  /*
   * Exactly the four keys. mousemoveCallback would change how positions
   * are batched, and canvas or a stray "mousemove: false" would silently
   * change what the player receives; a new key has to be added here on
   * purpose.
   */
  it("passes no sampling key the player does not know about", (): void => {
    recorder = new Recorder({
      initOptions: INIT_OPTIONS,
      config: baseConfig(),
    });

    recorder.start();

    expect(Object.keys(recordedSampling()).sort()).toEqual([
      "input",
      "mouseInteraction",
      "mousemove",
      "scroll",
    ]);
  });
});
