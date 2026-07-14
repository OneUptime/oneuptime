import AIChatPermissionMode, {
  AIChatPermissionModeHelper,
  AIChatPermissionModeOption,
} from "../../../Types/AI/AIChatPermissionMode";

describe("AIChatPermissionModeHelper", () => {
  describe("getDefault", () => {
    test("defaults to AskForApproval", () => {
      expect(AIChatPermissionModeHelper.getDefault()).toBe(
        AIChatPermissionMode.AskForApproval,
      );
    });

    test("never defaults to the permissive AutoRun mode", () => {
      // This mode gates every MUTATING tool, so the default must be the safe one.
      expect(AIChatPermissionModeHelper.getDefault()).not.toBe(
        AIChatPermissionMode.AutoRun,
      );
    });
  });

  describe("isValid", () => {
    test("accepts every permission mode", () => {
      for (const mode of Object.values(AIChatPermissionMode)) {
        expect(AIChatPermissionModeHelper.isValid(mode)).toBe(true);
      }
    });

    test.each([
      undefined,
      "",
      "autorun", // wrong case
      "AutoRun ", // trailing whitespace
      "NotAMode",
    ])("rejects %p", (value: string | undefined) => {
      expect(AIChatPermissionModeHelper.isValid(value)).toBe(false);
    });
  });

  describe("parse", () => {
    test("round-trips every valid permission mode", () => {
      for (const mode of Object.values(AIChatPermissionMode)) {
        expect(AIChatPermissionModeHelper.parse(mode)).toBe(mode);
      }
    });

    test.each([undefined, "", "NotAMode", "autorun"])(
      "falls back to the default for the unrecognized value %p",
      (value: string | undefined) => {
        expect(AIChatPermissionModeHelper.parse(value)).toBe(
          AIChatPermissionModeHelper.getDefault(),
        );
      },
    );

    test("never fails open to AutoRun for unrecognized input", () => {
      /*
       * A malformed or missing persisted value must not silently grant the
       * agent permission to run mutating tools without approval.
       */
      const unrecognized: Array<string | undefined> = [
        undefined,
        "",
        "autorun",
        "AUTO_RUN",
        "NotAMode",
      ];

      for (const value of unrecognized) {
        expect(AIChatPermissionModeHelper.parse(value)).not.toBe(
          AIChatPermissionMode.AutoRun,
        );
      }
    });
  });

  describe("getOptions", () => {
    test("exposes one option per permission mode, exactly once", () => {
      const options: Array<AIChatPermissionModeOption> =
        AIChatPermissionModeHelper.getOptions();

      const values: Array<AIChatPermissionMode> = options.map(
        (o: AIChatPermissionModeOption): AIChatPermissionMode => {
          return o.value;
        },
      );

      expect(values.length).toBe(Object.values(AIChatPermissionMode).length);
      expect(new Set(values).size).toBe(values.length); // no duplicates

      for (const mode of Object.values(AIChatPermissionMode)) {
        expect(values).toContain(mode);
      }
    });

    test("every option has a title and a description", () => {
      for (const option of AIChatPermissionModeHelper.getOptions()) {
        expect(option.title.length).toBeGreaterThan(0);
        expect(option.description.length).toBeGreaterThan(0);
      }
    });

    test("every offered option is a parseable mode", () => {
      for (const option of AIChatPermissionModeHelper.getOptions()) {
        expect(AIChatPermissionModeHelper.isValid(option.value)).toBe(true);
        expect(AIChatPermissionModeHelper.parse(option.value)).toBe(
          option.value,
        );
      }
    });
  });
});
