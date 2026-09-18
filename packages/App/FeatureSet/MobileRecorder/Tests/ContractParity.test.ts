import {
  SESSION_REPLAY_APP_IDENTIFIER_HEADER as COMMON_APP_HEADER,
  SESSION_REPLAY_CONTENT_TYPE as COMMON_CONTENT_TYPE,
  SESSION_REPLAY_MOBILE_APP_IDENTIFIER_HEADER as COMMON_MOBILE_HEADER,
  SESSION_REPLAY_MOBILE_RECORDER_CAPABILITIES as COMMON_MOBILE_CAPABILITIES,
  SESSION_REPLAY_RECORDER_KIND_HEADER as COMMON_KIND_HEADER,
  SESSION_REPLAY_USER_REF_HEADER as COMMON_USER_REF_HEADER,
  SESSION_REPLAY_SCHEMA_VERSION as COMMON_SCHEMA_VERSION,
  SESSION_REPLAY_WIRE_VERSION as COMMON_WIRE_VERSION,
  SessionReplayFidelityNotice as CommonFidelityNotice,
} from "../../../../Common/Types/Rum/SessionReplay";
import {
  SESSION_REPLAY_APP_IDENTIFIER_HEADER,
  SESSION_REPLAY_CONTENT_TYPE,
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
});
