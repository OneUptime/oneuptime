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
 *
 * The one deliberate exception is captureWebVitals: informational, at
 * most five events per page, wanted on every recording - so it is ON
 * unless the server says a literal false.
 */

const DEFAULTS: ExtendedReplayConfig = {
  tracePropagationOrigins: [],
  lcpBudgetMs: 0,
  longTaskBudgetMs: 0,
  slowRequestBudgetMs: 0,
  captureWebVitals: true,
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
          captureWebVitals: false,
          isTargeted: true,
        }),
      ),
    ).toEqual({
      tracePropagationOrigins: ["https://api.example.com"],
      lcpBudgetMs: 4000,
      longTaskBudgetMs: 200,
      slowRequestBudgetMs: 5000,
      captureWebVitals: false,
      isTargeted: true,
    });
  });

  /*
   * A cached pre-Wave-4 loader stub hands the artifact a config with no
   * raw passthrough at all. That must mean "these features are off", not
   * an exception during bootstrap.
   */
  it("defaults every trigger OFF (and vitals ON) when there is no raw passthrough", (): void => {
    expect(readExtendedConfig({} as unknown as LoaderConfig)).toEqual(DEFAULTS);
    expect(readExtendedConfig(null)).toEqual(DEFAULTS);
    expect(readExtendedConfig(undefined)).toEqual(DEFAULTS);
  });

  it("defaults every trigger OFF (and vitals ON) when raw omits the fields", (): void => {
    expect(readExtendedConfig(configWithRaw({}))).toEqual(DEFAULTS);
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

  describe("captureWebVitals", (): void => {
    /*
     * Vitals are independent of the budgets: a server that configured no
     * budget at all (the fresh-install case) still gets them, and a
     * server too old to know the field cannot switch them off by
     * omission.
     */
    it("is ON when the field is absent, whatever the budgets say", (): void => {
      expect(
        readExtendedConfig(configWithRaw({ lcpBudgetMs: 0 })).captureWebVitals,
      ).toBe(true);
      expect(
        readExtendedConfig(configWithRaw({ lcpBudgetMs: 2500 }))
          .captureWebVitals,
      ).toBe(true);
    });

    it("is OFF only on a literal false", (): void => {
      expect(
        readExtendedConfig(configWithRaw({ captureWebVitals: false }))
          .captureWebVitals,
      ).toBe(false);

      for (const notFalse of ["false", 0, null, "", "no", {}]) {
        expect(
          readExtendedConfig(configWithRaw({ captureWebVitals: notFalse }))
            .captureWebVitals,
        ).toBe(true);
      }
    });

    it("leaves the budgets at 0 = off regardless", (): void => {
      const result: ExtendedReplayConfig = readExtendedConfig(
        configWithRaw({ captureWebVitals: true }),
      );

      expect(result.lcpBudgetMs).toBe(0);
      expect(result.longTaskBudgetMs).toBe(0);
      expect(result.slowRequestBudgetMs).toBe(0);
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
