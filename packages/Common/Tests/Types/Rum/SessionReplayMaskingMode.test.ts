import SessionReplayMaskingMode, {
  doesMaskingModeRecordReadableContent,
  parseSessionReplayMaskingMode,
} from "../../../Types/Rum/SessionReplayMaskingMode";
import { describe, expect, test } from "@jest/globals";

describe("SessionReplayMaskingMode", () => {
  const allModes: Array<SessionReplayMaskingMode> = Object.values(
    SessionReplayMaskingMode,
  );

  describe("parseSessionReplayMaskingMode", () => {
    test("returns each valid mode when given its own value", () => {
      expect(
        parseSessionReplayMaskingMode(
          SessionReplayMaskingMode.MaskSensitiveInputsOnly,
        ),
      ).toBe(SessionReplayMaskingMode.MaskSensitiveInputsOnly);
      expect(
        parseSessionReplayMaskingMode(SessionReplayMaskingMode.MaskInputsOnly),
      ).toBe(SessionReplayMaskingMode.MaskInputsOnly);
      expect(
        parseSessionReplayMaskingMode(SessionReplayMaskingMode.MaskAllText),
      ).toBe(SessionReplayMaskingMode.MaskAllText);
    });

    test("round-trips every enum member", () => {
      for (const mode of allModes) {
        expect(parseSessionReplayMaskingMode(mode)).toBe(mode);
      }
    });

    test("fails closed to MaskAllText for unrecognised values", () => {
      const unknownValues: Array<unknown> = [
        undefined,
        null,
        "",
        "maskallText",
        "MaskEverything",
        "mask_inputs_only",
        0,
        1,
        true,
        false,
        {},
        [],
        { mode: SessionReplayMaskingMode.MaskInputsOnly },
      ];
      for (const value of unknownValues) {
        expect(parseSessionReplayMaskingMode(value)).toBe(
          SessionReplayMaskingMode.MaskAllText,
        );
      }
    });

    test("is case-sensitive and does not coerce near-matches to a relaxed mode", () => {
      // A relaxed-looking-but-wrong string must NOT downgrade privacy.
      expect(parseSessionReplayMaskingMode("maskinputsonly")).toBe(
        SessionReplayMaskingMode.MaskAllText,
      );
      expect(parseSessionReplayMaskingMode("MaskSensitiveInputsOnly ")).toBe(
        SessionReplayMaskingMode.MaskAllText,
      );
    });
  });

  describe("doesMaskingModeRecordReadableContent", () => {
    test("is true for both relaxed modes", () => {
      expect(
        doesMaskingModeRecordReadableContent(
          SessionReplayMaskingMode.MaskSensitiveInputsOnly,
        ),
      ).toBe(true);
      expect(
        doesMaskingModeRecordReadableContent(
          SessionReplayMaskingMode.MaskInputsOnly,
        ),
      ).toBe(true);
    });

    test("is false only for the wireframe mode", () => {
      expect(
        doesMaskingModeRecordReadableContent(
          SessionReplayMaskingMode.MaskAllText,
        ),
      ).toBe(false);
    });

    test("MaskAllText is the single mode that does not record readable content", () => {
      const recordingModes: Array<SessionReplayMaskingMode> = allModes.filter(
        (mode: SessionReplayMaskingMode) => {
          return doesMaskingModeRecordReadableContent(mode);
        },
      );
      expect(recordingModes).not.toContain(
        SessionReplayMaskingMode.MaskAllText,
      );
      expect(recordingModes.length).toBe(allModes.length - 1);
    });
  });
});
