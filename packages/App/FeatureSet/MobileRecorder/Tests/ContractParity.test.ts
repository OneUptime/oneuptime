import SessionReplayWireEncoding, {
  SESSION_REPLAY_ENVELOPE_TERMINATOR as COMMON_ENVELOPE_TERMINATOR,
} from "../../../../Common/Utils/Rum/SessionReplayWireEncoding";
import {
  SESSION_REPLAY_APP_IDENTIFIER_HEADER as COMMON_APP_HEADER,
  SESSION_REPLAY_CONTENT_TYPE as COMMON_CONTENT_TYPE,
  SESSION_REPLAY_LEGACY_CONTENT_TYPE as COMMON_LEGACY_CONTENT_TYPE,
  SESSION_REPLAY_MAX_OFFLINE_DELAY_MS as COMMON_MAX_OFFLINE_DELAY_MS,
  SESSION_REPLAY_MOBILE_APP_IDENTIFIER_HEADER as COMMON_MOBILE_HEADER,
  SESSION_REPLAY_MOBILE_RECORDER_CAPABILITIES as COMMON_MOBILE_CAPABILITIES,
  SESSION_REPLAY_RECORDER_KIND_HEADER as COMMON_KIND_HEADER,
  SESSION_REPLAY_USER_REF_HEADER as COMMON_USER_REF_HEADER,
  SESSION_REPLAY_SCHEMA_VERSION as COMMON_SCHEMA_VERSION,
  SESSION_REPLAY_WIRE_VERSION as COMMON_WIRE_VERSION,
  SessionReplayFidelityNotice as CommonFidelityNotice,
} from "../../../../Common/Types/Rum/SessionReplay";
import {
  encodeSessionReplayEnvelopeLine,
  escapeSessionReplayJson,
  SESSION_REPLAY_APP_IDENTIFIER_HEADER,
  SESSION_REPLAY_CONTENT_TYPE,
  SESSION_REPLAY_ENVELOPE_TERMINATOR,
  SESSION_REPLAY_LEGACY_CONTENT_TYPE,
  SESSION_REPLAY_MAX_OFFLINE_DELAY_MS,
  SESSION_REPLAY_MOBILE_APP_IDENTIFIER_HEADER,
  SESSION_REPLAY_MOBILE_RECORDER_CAPABILITIES,
  SESSION_REPLAY_RECORDER_KIND_HEADER,
  SESSION_REPLAY_USER_REF_HEADER,
  SESSION_REPLAY_SCHEMA_VERSION,
  SESSION_REPLAY_WIRE_VERSION,
  SessionReplayFidelityNotice,
} from "../src/Contract";

describe("published SDK wire contract", () => {
  test("stays in lockstep with Common without creating a runtime dependency", () => {
    expect(SESSION_REPLAY_WIRE_VERSION).toBe(COMMON_WIRE_VERSION);
    expect(SESSION_REPLAY_SCHEMA_VERSION).toBe(COMMON_SCHEMA_VERSION);
    expect(SESSION_REPLAY_CONTENT_TYPE).toBe(COMMON_CONTENT_TYPE);
    expect(SESSION_REPLAY_APP_IDENTIFIER_HEADER).toBe(COMMON_APP_HEADER);
    expect(SESSION_REPLAY_RECORDER_KIND_HEADER).toBe(COMMON_KIND_HEADER);
    expect(SESSION_REPLAY_MOBILE_APP_IDENTIFIER_HEADER).toBe(
      COMMON_MOBILE_HEADER,
    );
    expect(SESSION_REPLAY_USER_REF_HEADER).toBe(COMMON_USER_REF_HEADER);
    expect(SESSION_REPLAY_MOBILE_RECORDER_CAPABILITIES).toEqual(
      COMMON_MOBILE_CAPABILITIES,
    );
    /*
     * Offline mode: the device discards what it held longer than the
     * server is willing to place on the recording's real timeline.
     */
    expect(SESSION_REPLAY_MAX_OFFLINE_DELAY_MS).toBe(
      COMMON_MAX_OFFLINE_DELAY_MS,
    );
  });

  test("uses the exact stored mobile fidelity vocabulary", () => {
    expect(SessionReplayFidelityNotice.MobileImagesOpaque).toBe(
      CommonFidelityNotice.MobileImagesOpaque,
    );
    expect(SessionReplayFidelityNotice.MobileWebViewOpaque).toBe(
      CommonFidelityNotice.MobileWebViewOpaque,
    );
    expect(SessionReplayFidelityNotice.MobileCanvasOpaque).toBe(
      CommonFidelityNotice.MobileCanvasOpaque,
    );
    expect(SessionReplayFidelityNotice.MobileAnimationSampled).toBe(
      CommonFidelityNotice.MobileAnimationSampled,
    );
  });
  /*
   * The frame encoding is a copy, not an import, so a published SDK never
   * drags Common into a customer's bundle. A drift here would be a mobile
   * chunk that a customer's firewall blocks while the browser's passes.
   */
  test("frames envelopes exactly the way Common does", () => {
    expect(SESSION_REPLAY_CONTENT_TYPE).toBe("application/octet-stream");
    expect(SESSION_REPLAY_LEGACY_CONTENT_TYPE).toBe(COMMON_LEGACY_CONTENT_TYPE);
    expect(SESSION_REPLAY_ENVELOPE_TERMINATOR).toBe(COMMON_ENVELOPE_TERMINATOR);

    const samples: Array<Record<string, unknown>> = [
      {},
      { url: "https://shop.example.com/search/gadget+case%20x%0Ay" },
      { meta: { identifiedUserTraits: { name: "Bridget Jones & Co" } } },
      { note: "GET /v1/users HTTP/1.1 or Http/2", other: "https://x/y" },
      { big: 1e21, nested: [{ "100%": ["&", "%", "http/", "日本", "😀"] }] },
    ];

    for (const sample of samples) {
      expect(encodeSessionReplayEnvelopeLine(sample)).toBe(
        SessionReplayWireEncoding.encodeEnvelopeLine(sample),
      );
      expect(escapeSessionReplayJson(JSON.stringify(sample))).toBe(
        SessionReplayWireEncoding.escapeJson(JSON.stringify(sample)),
      );
    }

    const alphabet: string = '%&+/ \\"hHtTpP0123aZ\n日😀';
    let seed: number = 7;

    for (let iteration: number = 0; iteration < 1000; iteration++) {
      let text: string = "";

      for (let index: number = 0; index < 20; index++) {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        text += alphabet.charAt(seed % alphabet.length);
      }

      const sample: Record<string, unknown> = { [text]: text };

      expect(encodeSessionReplayEnvelopeLine(sample)).toBe(
        SessionReplayWireEncoding.encodeEnvelopeLine(sample),
      );
    }
  });
});
