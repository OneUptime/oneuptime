import { describe, expect, it } from "@jest/globals";
import {
  getReplayClientLabel,
  getReplayEventFormatLabel,
  getReplayRecorderKindLabel,
  isMobileSessionReplay,
} from "../../FeatureSet/Dashboard/src/Components/SessionReplay/ReplayRecorderKind";

describe("replay recorder-kind presentation", () => {
  it("labels React Native view-tree recordings as native app footage", () => {
    expect(isMobileSessionReplay("rn-view-tree")).toBe(true);
    expect(getReplayRecorderKindLabel("rn-view-tree")).toBe("React Native app");
    expect(getReplayClientLabel("rn-view-tree")).toBe("App");
    expect(getReplayEventFormatLabel("rn-view-tree")).toBe(
      "Synthetic rrweb event format",
    );
  });

  it.each(["dom", ""])(
    "keeps existing and legacy web recordings labelled as browsers (%s)",
    (recorderKind: string) => {
      expect(isMobileSessionReplay(recorderKind)).toBe(false);
      expect(getReplayRecorderKindLabel(recorderKind)).toBe("Web browser");
      expect(getReplayClientLabel(recorderKind)).toBe("Browser");
      expect(getReplayEventFormatLabel(recorderKind)).toBe("rrweb version");
    },
  );

  it("does not silently claim an unknown future recorder is a browser", () => {
    expect(getReplayRecorderKindLabel("future-recorder")).toBe(
      "future-recorder",
    );
    expect(isMobileSessionReplay("future-recorder")).toBe(false);
    expect(getReplayClientLabel("future-recorder")).toBe("Client");
    expect(getReplayEventFormatLabel("future-recorder")).toBe("Event format");
  });
});
