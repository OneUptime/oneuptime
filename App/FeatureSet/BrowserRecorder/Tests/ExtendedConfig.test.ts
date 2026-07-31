import { LoaderConfig } from "../src/Config";
import {
  ExtendedReplayConfig,
  readExtendedConfig,
} from "../src/ExtendedConfig";

/*
 * The artifact-side normaliser for config fields the loader passes through
 * UNVALIDATED. Everything here is a hostile-input test in disguise: the
 * source object is whatever the server (or a man-in-the-middle the SRI
 * pin failed to stop) put on the wire, and every wrong shape must resolve
 * to the feature-OFF default rather than to a crash or an always-fires
 * comparison.
 */

const OFF: ExtendedReplayConfig = {
  tracePropagationOrigins: [],
  lcpBudgetMs: 0,
  longTaskBudgetMs: 0,
  slowRequestBudgetMs: 0,
  isTargeted: false,
};

function configWithRaw(raw: unknown): LoaderConfig {
  return { raw: raw } as unknown as LoaderConfig;
}

describe("readExtendedConfig", (): void => {
  it("reads well-formed values from the raw passthrough", (): void => {
    expect(
      readExtendedConfig(
        configWithRaw({
          tracePropagationOrigins: ["https://api.example.com"],
          lcpBudgetMs: 4000,
          longTaskBudgetMs: 200,
          slowRequestBudgetMs: 5000,
          isTargeted: true,
        }),
      ),
    ).toEqual({
      tracePropagationOrigins: ["https://api.example.com"],
      lcpBudgetMs: 4000,
      longTaskBudgetMs: 200,
      slowRequestBudgetMs: 5000,
      isTargeted: true,
    });
  });

  /*
   * A cached pre-Wave-4 loader stub hands the artifact a config with no
   * raw passthrough at all. That must mean "these features are off", not
   * an exception during bootstrap.
   */
  it("defaults everything OFF when there is no raw passthrough", (): void => {
    expect(readExtendedConfig({} as unknown as LoaderConfig)).toEqual(OFF);
    expect(readExtendedConfig(null)).toEqual(OFF);
    expect(readExtendedConfig(undefined)).toEqual(OFF);
  });

  it("defaults everything OFF when raw omits the fields", (): void => {
    expect(readExtendedConfig(configWithRaw({}))).toEqual(OFF);
  });

  it("falls back to the config object itself when raw is absent", (): void => {
    const config: LoaderConfig = {
      tracePropagationOrigins: ["https://api.example.com"],
      lcpBudgetMs: 1500,
      isTargeted: true,
    } as unknown as LoaderConfig;

    const result: ExtendedReplayConfig = readExtendedConfig(config);

    expect(result.tracePropagationOrigins).toEqual(["https://api.example.com"]);
    expect(result.lcpBudgetMs).toBe(1500);
    expect(result.isTargeted).toBe(true);
  });

  describe("budget normalisation", (): void => {
    it("treats zero, negative, NaN, Infinity and wrong types as OFF", (): void => {
      for (const hostile of [
        0,
        -1,
        -0.5,
        NaN,
        Infinity,
        -Infinity,
        "4000",
        true,
        null,
        undefined,
        {},
        [],
      ]) {
        const result: ExtendedReplayConfig = readExtendedConfig(
          configWithRaw({
            lcpBudgetMs: hostile,
            longTaskBudgetMs: hostile,
            slowRequestBudgetMs: hostile,
          }),
        );

        expect(result.lcpBudgetMs).toBe(0);
        expect(result.longTaskBudgetMs).toBe(0);
        expect(result.slowRequestBudgetMs).toBe(0);
      }
    });

    it("keeps positive fractional budgets as-is", (): void => {
      expect(
        readExtendedConfig(configWithRaw({ lcpBudgetMs: 0.5 })).lcpBudgetMs,
      ).toBe(0.5);
    });
  });

  describe("origin list normalisation", (): void => {
    it("drops non-arrays entirely", (): void => {
      for (const hostile of ["https://x.com", 42, {}, null, true]) {
        expect(
          readExtendedConfig(
            configWithRaw({ tracePropagationOrigins: hostile }),
          ).tracePropagationOrigins,
        ).toEqual([]);
      }
    });

    it("keeps only non-empty strings from a mixed array", (): void => {
      expect(
        readExtendedConfig(
          configWithRaw({
            tracePropagationOrigins: [
              "https://a.example.com",
              "",
              7,
              null,
              { origin: "https://evil.example.com" },
              "https://b.example.com",
            ],
          }),
        ).tracePropagationOrigins,
      ).toEqual(["https://a.example.com", "https://b.example.com"]);
    });
  });

  describe("isTargeted", (): void => {
    it("requires a literal true", (): void => {
      for (const hostile of ["true", 1, {}, [], "yes", null]) {
        expect(
          readExtendedConfig(configWithRaw({ isTargeted: hostile })).isTargeted,
        ).toBe(false);
      }
    });
  });
});
