import { describe, expect, test } from "@jest/globals";
import {
  SESSION_REPLAY_MOBILE_APP_IDENTIFIER_HEADER,
  SESSION_REPLAY_MOBILE_RECORDER_CAPABILITIES,
  SESSION_REPLAY_RECORDER_CAPABILITIES,
  SESSION_REPLAY_RECORDER_KIND_HEADER,
  SessionReplayFidelityNotice,
  parseSessionReplayRecorderKindHeader,
} from "../../../Types/Rum/SessionReplay";

describe("session replay recorder transport contract", () => {
  test("pins the public native request header names", () => {
    expect(SESSION_REPLAY_RECORDER_KIND_HEADER).toBe(
      "x-oneuptime-replay-recorder-kind",
    );
    expect(SESSION_REPLAY_MOBILE_APP_IDENTIFIER_HEADER).toBe(
      "x-oneuptime-mobile-app-identifier",
    );
  });

  test.each([undefined, null])(
    "treats an absent recorder-kind header (%s) as the legacy DOM recorder",
    (value: undefined | null) => {
      expect(parseSessionReplayRecorderKindHeader(value)).toBe("dom");
    },
  );

  test.each([
    ["dom", "dom"],
    ["rn-view-tree", "rn-view-tree"],
  ])("accepts exact supported kind %s", (value: string, expected: string) => {
    expect(parseSessionReplayRecorderKindHeader(value)).toBe(expected);
  });

  test.each([
    "",
    "DOM",
    "RN-VIEW-TREE",
    "rn_view_tree",
    " rn-view-tree",
    "rn-view-tree ",
    "browser",
    "mobile",
  ])("rejects unknown or non-exact recorder kind %j", (value: string) => {
    expect(parseSessionReplayRecorderKindHeader(value)).toBeNull();
  });

  test("rejects a repeated/non-scalar recorder-kind header", () => {
    expect(
      parseSessionReplayRecorderKindHeader(["rn-view-tree", "dom"]),
    ).toBeNull();
    expect(parseSessionReplayRecorderKindHeader({ value: "dom" })).toBeNull();
  });

  test("pins the capabilities emitted by the native recorder", () => {
    expect(SESSION_REPLAY_MOBILE_RECORDER_CAPABILITIES).toEqual([
      "mobile-view-tree",
      "mobile-touch-events",
      "custom-events",
      "traits",
      "tags",
      "visibility",
      "visitor-id",
      "route-events",
      "js-errors",
    ]);
    expect(new Set(SESSION_REPLAY_MOBILE_RECORDER_CAPABILITIES).size).toBe(
      SESSION_REPLAY_MOBILE_RECORDER_CAPABILITIES.length,
    );
  });

  test("keeps mobile-only capabilities out of the web recorder baseline", () => {
    expect(SESSION_REPLAY_RECORDER_CAPABILITIES).not.toContain(
      "mobile-view-tree",
    );
    expect(SESSION_REPLAY_RECORDER_CAPABILITIES).not.toContain(
      "mobile-touch-events",
    );
  });

  test("pins mobile fidelity disclosure codes as additive wire values", () => {
    expect(SessionReplayFidelityNotice.MobileImagesOpaque).toBe(
      "mobile-images-opaque",
    );
    expect(SessionReplayFidelityNotice.MobileWebViewOpaque).toBe(
      "mobile-webview-opaque",
    );
    expect(SessionReplayFidelityNotice.MobileCanvasOpaque).toBe(
      "mobile-canvas-opaque",
    );
    expect(SessionReplayFidelityNotice.MobileAnimationSampled).toBe(
      "mobile-animation-sampled",
    );
  });
});
