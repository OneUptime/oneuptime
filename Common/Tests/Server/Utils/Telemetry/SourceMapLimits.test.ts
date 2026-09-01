import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import { afterEach, describe, expect, it, jest } from "@jest/globals";

/*
 * The five operator knobs that size source map ingestion and resolution.
 *
 * These used to be one hardcoded 100 that did two unrelated jobs: it gated
 * uploads AND bounded what the resolver would read. Raising it was therefore
 * unsafe (more maps stored than the reader would ever look at), and leaving it
 * meant route-split builds — a Vite/Next app emitting hundreds of chunk maps
 * per release — silently lost the maps that did not fit. The count is now a
 * pure WRITE gate with a much higher default, and a byte budget bounds the
 * READ path instead.
 *
 * EnvironmentConfig reads process.env once at module load, so every case here
 * sets the environment, resets the module registry, and imports afresh.
 */

interface SourceMapConfigShape {
  SourceMapMaxMapsPerRelease: number;
  SourceMapRetentionInDays: number;
  SourceMapMaxFileSizeInBytes: number;
  SourceMapMaxFilesPerRequest: number;
  SourceMapMaxBytesPerResolve: number;
}

interface SourceMapResolverShape {
  MAX_SOURCE_MAP_SIZE_IN_BYTES: number;
  MAX_FRAMES_TO_RESOLVE: number;
  MAX_FRAMES_PER_RESOLVE_REQUEST: number;
}

interface MultipartLimitsShape {
  MAX_MULTIPART_FILE_BYTES: number;
  MAX_MULTIPART_FILES: number;
}

const MEGABYTE: number = 1024 * 1024;

/* The ceilings EnvironmentConfig hardcodes, named once. */
const FIFTY_MEGABYTES: number = 50 * MEGABYTE;
const FIFTY_FILES: number = 50;

/* Defaults, named so a change to one is a deliberate edit here too. */
const DEFAULT_MAPS_PER_RELEASE: number = 1000;
const DEFAULT_RETENTION_DAYS: number = 90;
const DEFAULT_BYTES_PER_RESOLVE: number = 512 * MEGABYTE;

const MANAGED_KEYS: Array<string> = [
  "SOURCE_MAP_MAX_MAPS_PER_RELEASE",
  "SOURCE_MAP_RETENTION_DAYS",
  "SOURCE_MAP_MAX_FILE_SIZE_BYTES",
  "SOURCE_MAP_MAX_FILES_PER_REQUEST",
  "SOURCE_MAP_MAX_BYTES_PER_RESOLVE",
];

/*
 * Every shape of value an operator can get wrong. "" and "   " are what
 * Docker Compose's ${VAR:-} and a Helm value left blank actually pass
 * through, so they must read as unset rather than as zero.
 */
const INVALID_VALUES: Array<string> = [
  "",
  "   ",
  "0",
  "-5",
  "1.5",
  "abc",
  "NaN",
  "Infinity",
];

const originalEnv: NodeJS.ProcessEnv = { ...process.env };

/*
 * Clears every knob first, so a value that happens to be set in the shell
 * running the suite cannot make a "default" case pass for the wrong reason.
 */
async function loadConfig(
  overrides: Record<string, string | undefined>,
): Promise<SourceMapConfigShape> {
  for (const key of MANAGED_KEYS) {
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  jest.resetModules();

  return (await import(
    "../../../../Server/EnvironmentConfig"
  )) as unknown as SourceMapConfigShape;
}

/*
 * Loads the resolver against the same freshly-read config, so the two are
 * observed from one module registry rather than from separate loads that
 * could disagree.
 */
async function loadConfigAndResolver(
  overrides: Record<string, string | undefined>,
): Promise<{
  config: SourceMapConfigShape;
  resolver: SourceMapResolverShape;
}> {
  const config: SourceMapConfigShape = await loadConfig(overrides);

  const resolver: SourceMapResolverShape = (await import(
    "../../../../Server/Utils/Telemetry/SourceMapResolver"
  )) as unknown as SourceMapResolverShape;

  return { config, resolver };
}

afterEach(() => {
  process.env = { ...originalEnv };
  jest.resetModules();
});

describe("SOURCE_MAP_MAX_MAPS_PER_RELEASE", () => {
  it("defaults to 1000 distinct bundles per release", async () => {
    /*
     * The old value was 100. A route-split build blows past that on its own,
     * which is the whole reason this knob exists.
     */
    const config: SourceMapConfigShape = await loadConfig({});

    expect(config.SourceMapMaxMapsPerRelease).toBe(DEFAULT_MAPS_PER_RELEASE);
  });

  it("honours an operator's raised value", async () => {
    const config: SourceMapConfigShape = await loadConfig({
      SOURCE_MAP_MAX_MAPS_PER_RELEASE: "4000",
    });

    expect(config.SourceMapMaxMapsPerRelease).toBe(4000);
  });

  it("can be lowered below the default", async () => {
    /*
     * The gate is also a cost control: an operator who wants a tighter cap
     * than the default must be able to set one.
     */
    const config: SourceMapConfigShape = await loadConfig({
      SOURCE_MAP_MAX_MAPS_PER_RELEASE: "25",
    });

    expect(config.SourceMapMaxMapsPerRelease).toBe(25);
  });

  it("accepts exactly LIMIT_MAX, the highest value it can enforce", async () => {
    const config: SourceMapConfigShape = await loadConfig({
      SOURCE_MAP_MAX_MAPS_PER_RELEASE: String(LIMIT_MAX),
    });

    expect(config.SourceMapMaxMapsPerRelease).toBe(LIMIT_MAX);
  });

  it("clamps one over LIMIT_MAX back down to LIMIT_MAX", async () => {
    /*
     * The write gate counts a release's existing maps with limit LIMIT_MAX.
     * A configured cap above that could never be reached by the count, so it
     * would be a limit the app silently failed to enforce. Clamping makes the
     * effective value honest.
     */
    const config: SourceMapConfigShape = await loadConfig({
      SOURCE_MAP_MAX_MAPS_PER_RELEASE: String(LIMIT_MAX + 1),
    });

    expect(config.SourceMapMaxMapsPerRelease).toBe(LIMIT_MAX);
  });

  it("clamps an absurd value rather than trusting it", async () => {
    const config: SourceMapConfigShape = await loadConfig({
      SOURCE_MAP_MAX_MAPS_PER_RELEASE: "999999999",
    });

    expect(config.SourceMapMaxMapsPerRelease).toBe(LIMIT_MAX);
  });

  it("falls back to the default for anything that is not a positive whole number", async () => {
    for (const value of INVALID_VALUES) {
      const config: SourceMapConfigShape = await loadConfig({
        SOURCE_MAP_MAX_MAPS_PER_RELEASE: value,
      });

      expect({ value, resolved: config.SourceMapMaxMapsPerRelease }).toEqual({
        value,
        resolved: DEFAULT_MAPS_PER_RELEASE,
      });
    }
  });

  it("tolerates surrounding whitespace on an otherwise valid value", async () => {
    const config: SourceMapConfigShape = await loadConfig({
      SOURCE_MAP_MAX_MAPS_PER_RELEASE: "  2500 ",
    });

    expect(config.SourceMapMaxMapsPerRelease).toBe(2500);
  });
});

describe("SOURCE_MAP_RETENTION_DAYS", () => {
  it("defaults to 90 days", async () => {
    const config: SourceMapConfigShape = await loadConfig({});

    expect(config.SourceMapRetentionInDays).toBe(DEFAULT_RETENTION_DAYS);
  });

  it("honours an operator's value in both directions", async () => {
    const shortened: SourceMapConfigShape = await loadConfig({
      SOURCE_MAP_RETENTION_DAYS: "7",
    });

    expect(shortened.SourceMapRetentionInDays).toBe(7);

    const lengthened: SourceMapConfigShape = await loadConfig({
      SOURCE_MAP_RETENTION_DAYS: "365",
    });

    expect(lengthened.SourceMapRetentionInDays).toBe(365);
  });

  it("is not clamped, so a long-retention install can keep maps for years", async () => {
    /*
     * Retention has no in-code ceiling to honour — nothing reads a bounded
     * page of days — so unlike the count and size knobs it passes any
     * positive integer straight through.
     */
    const config: SourceMapConfigShape = await loadConfig({
      SOURCE_MAP_RETENTION_DAYS: "36500",
    });

    expect(config.SourceMapRetentionInDays).toBe(36500);
  });

  it("falls back to 90 days for anything that is not a positive whole number", async () => {
    for (const value of INVALID_VALUES) {
      const config: SourceMapConfigShape = await loadConfig({
        SOURCE_MAP_RETENTION_DAYS: value,
      });

      expect({ value, resolved: config.SourceMapRetentionInDays }).toEqual({
        value,
        resolved: DEFAULT_RETENTION_DAYS,
      });
    }
  });
});

describe("SOURCE_MAP_MAX_FILE_SIZE_BYTES", () => {
  it("defaults to 50 MiB for a single map", async () => {
    const config: SourceMapConfigShape = await loadConfig({});

    expect(config.SourceMapMaxFileSizeInBytes).toBe(FIFTY_MEGABYTES);
  });

  it("can be lowered to a tighter per-file ceiling", async () => {
    const config: SourceMapConfigShape = await loadConfig({
      SOURCE_MAP_MAX_FILE_SIZE_BYTES: String(5 * MEGABYTE),
    });

    expect(config.SourceMapMaxFileSizeInBytes).toBe(5 * MEGABYTE);
  });

  it("accepts exactly 50 MiB, the multipart per-file ceiling", async () => {
    const config: SourceMapConfigShape = await loadConfig({
      SOURCE_MAP_MAX_FILE_SIZE_BYTES: String(FIFTY_MEGABYTES),
    });

    expect(config.SourceMapMaxFileSizeInBytes).toBe(FIFTY_MEGABYTES);
  });

  it("clamps one byte over 50 MiB back down to 50 MiB", async () => {
    /*
     * Raising this past what multer accepts would not raise anything: multer
     * aborts the request first, so the clear 400 this ceiling is meant to
     * produce becomes a confusing 413. The knob can only ever be lowered.
     */
    const config: SourceMapConfigShape = await loadConfig({
      SOURCE_MAP_MAX_FILE_SIZE_BYTES: String(FIFTY_MEGABYTES + 1),
    });

    expect(config.SourceMapMaxFileSizeInBytes).toBe(FIFTY_MEGABYTES);
  });

  it("clamps an operator who asks for gigabyte maps", async () => {
    const config: SourceMapConfigShape = await loadConfig({
      SOURCE_MAP_MAX_FILE_SIZE_BYTES: String(2 * 1024 * MEGABYTE),
    });

    expect(config.SourceMapMaxFileSizeInBytes).toBe(FIFTY_MEGABYTES);
  });

  it("falls back to 50 MiB for anything that is not a positive whole number", async () => {
    for (const value of INVALID_VALUES) {
      const config: SourceMapConfigShape = await loadConfig({
        SOURCE_MAP_MAX_FILE_SIZE_BYTES: value,
      });

      expect({ value, resolved: config.SourceMapMaxFileSizeInBytes }).toEqual({
        value,
        resolved: FIFTY_MEGABYTES,
      });
    }
  });
});

describe("SOURCE_MAP_MAX_FILES_PER_REQUEST", () => {
  it("defaults to 50 files in one upload request", async () => {
    const config: SourceMapConfigShape = await loadConfig({});

    expect(config.SourceMapMaxFilesPerRequest).toBe(FIFTY_FILES);
  });

  it("can be lowered so CI splits the upload into smaller batches", async () => {
    /*
     * This is deliberately separate from the per-release cap: a release may
     * hold 1000 maps while no single request may carry more than a handful.
     */
    const config: SourceMapConfigShape = await loadConfig({
      SOURCE_MAP_MAX_FILES_PER_REQUEST: "10",
    });

    expect(config.SourceMapMaxFilesPerRequest).toBe(10);
  });

  it("accepts exactly 50, the shared multipart file ceiling", async () => {
    const config: SourceMapConfigShape = await loadConfig({
      SOURCE_MAP_MAX_FILES_PER_REQUEST: String(FIFTY_FILES),
    });

    expect(config.SourceMapMaxFilesPerRequest).toBe(FIFTY_FILES);
  });

  it("clamps 51 back down to 50", async () => {
    /*
     * The multipart middleware runs BEFORE authentication on every route that
     * mounts it. Letting this knob widen it would widen the pre-auth surface
     * that Pyroscope and inbound email also sit behind, so it narrows only.
     */
    const config: SourceMapConfigShape = await loadConfig({
      SOURCE_MAP_MAX_FILES_PER_REQUEST: String(FIFTY_FILES + 1),
    });

    expect(config.SourceMapMaxFilesPerRequest).toBe(FIFTY_FILES);
  });

  it("clamps a large value rather than widening the pre-auth upload surface", async () => {
    const config: SourceMapConfigShape = await loadConfig({
      SOURCE_MAP_MAX_FILES_PER_REQUEST: "5000",
    });

    expect(config.SourceMapMaxFilesPerRequest).toBe(FIFTY_FILES);
  });

  it("falls back to 50 for anything that is not a positive whole number", async () => {
    for (const value of INVALID_VALUES) {
      const config: SourceMapConfigShape = await loadConfig({
        SOURCE_MAP_MAX_FILES_PER_REQUEST: value,
      });

      expect({ value, resolved: config.SourceMapMaxFilesPerRequest }).toEqual({
        value,
        resolved: FIFTY_FILES,
      });
    }
  });
});

describe("SOURCE_MAP_MAX_BYTES_PER_RESOLVE", () => {
  it("defaults to 512 MiB of map bytes per resolve request", async () => {
    /*
     * Roughly ten maps at the per-file ceiling, or every map of a
     * realistically sized release many times over.
     */
    const config: SourceMapConfigShape = await loadConfig({});

    expect(config.SourceMapMaxBytesPerResolve).toBe(DEFAULT_BYTES_PER_RESOLVE);
  });

  it("honours an operator's value in both directions", async () => {
    const tightened: SourceMapConfigShape = await loadConfig({
      SOURCE_MAP_MAX_BYTES_PER_RESOLVE: String(64 * MEGABYTE),
    });

    expect(tightened.SourceMapMaxBytesPerResolve).toBe(64 * MEGABYTE);

    const loosened: SourceMapConfigShape = await loadConfig({
      SOURCE_MAP_MAX_BYTES_PER_RESOLVE: String(2048 * MEGABYTE),
    });

    expect(loosened.SourceMapMaxBytesPerResolve).toBe(2048 * MEGABYTE);
  });

  it("is not clamped, because it is the knob that replaced the row count", async () => {
    /*
     * This is the bound that actually protects the process now, and it is the
     * one an operator with lots of memory has a legitimate reason to raise a
     * long way. Clamping it to any of the other ceilings would recreate the
     * exact coupling this change removed.
     */
    const config: SourceMapConfigShape = await loadConfig({
      SOURCE_MAP_MAX_BYTES_PER_RESOLVE: String(1024 * 1024 * MEGABYTE),
    });

    expect(config.SourceMapMaxBytesPerResolve).toBe(1024 * 1024 * MEGABYTE);
  });

  it("falls back to 512 MiB for anything that is not a positive whole number", async () => {
    for (const value of INVALID_VALUES) {
      const config: SourceMapConfigShape = await loadConfig({
        SOURCE_MAP_MAX_BYTES_PER_RESOLVE: value,
      });

      expect({ value, resolved: config.SourceMapMaxBytesPerResolve }).toEqual({
        value,
        resolved: DEFAULT_BYTES_PER_RESOLVE,
      });
    }
  });
});

describe("the five knobs together", () => {
  it("reads each variable independently", async () => {
    /*
     * They are five separate settings that happen to share a prefix; setting
     * one must not move another.
     */
    const config: SourceMapConfigShape = await loadConfig({
      SOURCE_MAP_MAX_MAPS_PER_RELEASE: "2000",
      SOURCE_MAP_RETENTION_DAYS: "30",
      SOURCE_MAP_MAX_FILE_SIZE_BYTES: String(8 * MEGABYTE),
      SOURCE_MAP_MAX_FILES_PER_REQUEST: "12",
      SOURCE_MAP_MAX_BYTES_PER_RESOLVE: String(256 * MEGABYTE),
    });

    expect({
      maps: config.SourceMapMaxMapsPerRelease,
      days: config.SourceMapRetentionInDays,
      size: config.SourceMapMaxFileSizeInBytes,
      files: config.SourceMapMaxFilesPerRequest,
      bytes: config.SourceMapMaxBytesPerResolve,
    }).toEqual({
      maps: 2000,
      days: 30,
      size: 8 * MEGABYTE,
      files: 12,
      bytes: 256 * MEGABYTE,
    });
  });

  it("does not let one misconfigured variable disturb the others", async () => {
    const config: SourceMapConfigShape = await loadConfig({
      SOURCE_MAP_MAX_MAPS_PER_RELEASE: "not-a-number",
      SOURCE_MAP_RETENTION_DAYS: "45",
      SOURCE_MAP_MAX_FILES_PER_REQUEST: "20",
    });

    expect({
      maps: config.SourceMapMaxMapsPerRelease,
      days: config.SourceMapRetentionInDays,
      files: config.SourceMapMaxFilesPerRequest,
    }).toEqual({
      maps: DEFAULT_MAPS_PER_RELEASE,
      days: 45,
      files: 20,
    });
  });

  it("gives every knob a positive whole number, whatever the environment says", async () => {
    /*
     * Each of these feeds a database limit, a multer limit or a byte budget.
     * A fractional, zero or negative value reaching any of them would be a
     * different class of failure than a rejected upload, so the invariant is
     * asserted across the whole set rather than per-variable.
     */
    for (const value of INVALID_VALUES) {
      const config: SourceMapConfigShape = await loadConfig({
        SOURCE_MAP_MAX_MAPS_PER_RELEASE: value,
        SOURCE_MAP_RETENTION_DAYS: value,
        SOURCE_MAP_MAX_FILE_SIZE_BYTES: value,
        SOURCE_MAP_MAX_FILES_PER_REQUEST: value,
        SOURCE_MAP_MAX_BYTES_PER_RESOLVE: value,
      });

      const resolved: Array<number> = [
        config.SourceMapMaxMapsPerRelease,
        config.SourceMapRetentionInDays,
        config.SourceMapMaxFileSizeInBytes,
        config.SourceMapMaxFilesPerRequest,
        config.SourceMapMaxBytesPerResolve,
      ];

      for (const number of resolved) {
        expect({ value, number, integer: Number.isInteger(number) }).toEqual({
          value,
          number,
          integer: true,
        });
        expect(number).toBeGreaterThan(0);
      }
    }
  });

  it("keeps the per-request file cap at or below the per-release cap's default", async () => {
    /*
     * Sanity on the division of labour: one request may never carry more maps
     * than a release is allowed to hold, or the upload path could accept a
     * batch the write gate must then reject wholesale.
     */
    const config: SourceMapConfigShape = await loadConfig({});

    expect(config.SourceMapMaxFilesPerRequest).toBeLessThanOrEqual(
      config.SourceMapMaxMapsPerRelease,
    );
  });
});

describe("MAX_SOURCE_MAP_SIZE_IN_BYTES in SourceMapResolver", () => {
  it("equals the configured per-file ceiling by default", async () => {
    const { config, resolver } = await loadConfigAndResolver({});

    expect(resolver.MAX_SOURCE_MAP_SIZE_IN_BYTES).toBe(
      config.SourceMapMaxFileSizeInBytes,
    );
    expect(resolver.MAX_SOURCE_MAP_SIZE_IN_BYTES).toBe(FIFTY_MEGABYTES);
  });

  it("tracks a lowered SOURCE_MAP_MAX_FILE_SIZE_BYTES", async () => {
    /*
     * The resolver's own ceiling used to be an independent literal. If it
     * stops tracking the config, an operator who lowers the knob gets maps
     * rejected on upload but still decoded at read time — the two halves of
     * one limit disagreeing.
     */
    const { config, resolver } = await loadConfigAndResolver({
      SOURCE_MAP_MAX_FILE_SIZE_BYTES: String(3 * MEGABYTE),
    });

    expect(resolver.MAX_SOURCE_MAP_SIZE_IN_BYTES).toBe(3 * MEGABYTE);
    expect(resolver.MAX_SOURCE_MAP_SIZE_IN_BYTES).toBe(
      config.SourceMapMaxFileSizeInBytes,
    );
  });

  it("tracks the clamp too, so it never exceeds what multer accepts", async () => {
    const { resolver } = await loadConfigAndResolver({
      SOURCE_MAP_MAX_FILE_SIZE_BYTES: String(FIFTY_MEGABYTES * 4),
    });

    expect(resolver.MAX_SOURCE_MAP_SIZE_IN_BYTES).toBe(FIFTY_MEGABYTES);
  });

  it("exposes the frame ceilings the API layer needs to enforce", async () => {
    /*
     * MAX_FRAMES_TO_RESOLVE was module-private and is now exported, and
     * MAX_FRAMES_PER_RESOLVE_REQUEST is new: TelemetryAPI rejects a frames
     * array larger than the latter before sanitizing it. Both are fixed, not
     * configurable — the frames array is caller-supplied, so its bounds are
     * not an operator's to raise.
     */
    const { resolver } = await loadConfigAndResolver({});

    expect(resolver.MAX_FRAMES_TO_RESOLVE).toBe(500);
    expect(resolver.MAX_FRAMES_PER_RESOLVE_REQUEST).toBe(10000);
    expect(resolver.MAX_FRAMES_PER_RESOLVE_REQUEST).toBeGreaterThan(
      resolver.MAX_FRAMES_TO_RESOLVE,
    );
  });
});

describe("the ceilings EnvironmentConfig duplicates as literals", () => {
  /*
   * EnvironmentConfig cannot import MultipartFormData — that module pulls in
   * multer and express, and config has no business dragging those in — so it
   * repeats MAX_MULTIPART_FILE_BYTES and MAX_MULTIPART_FILES as bare literals
   * in its clamps.
   *
   * These two cases are the only thing keeping that duplication honest. If
   * someone raises a multipart limit and does not touch EnvironmentConfig,
   * the clamp silently becomes the tighter of the two and the knob stops
   * reaching the value the middleware would now allow; if someone lowers one,
   * the clamp lets through a value multer will reject with a 413. Either way
   * these fail here rather than in production.
   */

  it("pins the per-file byte clamp to MAX_MULTIPART_FILE_BYTES", async () => {
    jest.resetModules();

    const multipart: MultipartLimitsShape = (await import(
      "../../../../Server/Middleware/MultipartFormData"
    )) as unknown as MultipartLimitsShape;

    expect(multipart.MAX_MULTIPART_FILE_BYTES).toBe(FIFTY_MEGABYTES);
  });

  it("pins the per-request file clamp to MAX_MULTIPART_FILES", async () => {
    jest.resetModules();

    const multipart: MultipartLimitsShape = (await import(
      "../../../../Server/Middleware/MultipartFormData"
    )) as unknown as MultipartLimitsShape;

    expect(multipart.MAX_MULTIPART_FILES).toBe(FIFTY_FILES);
  });

  it("cannot be configured above either middleware limit", async () => {
    /*
     * Stated as the behaviour an operator sees, against the middleware's own
     * exported values rather than against the literals repeated above.
     */
    jest.resetModules();

    const multipart: MultipartLimitsShape = (await import(
      "../../../../Server/Middleware/MultipartFormData"
    )) as unknown as MultipartLimitsShape;

    const config: SourceMapConfigShape = await loadConfig({
      SOURCE_MAP_MAX_FILE_SIZE_BYTES: String(
        multipart.MAX_MULTIPART_FILE_BYTES * 10,
      ),
      SOURCE_MAP_MAX_FILES_PER_REQUEST: String(
        multipart.MAX_MULTIPART_FILES * 10,
      ),
    });

    expect(config.SourceMapMaxFileSizeInBytes).toBe(
      multipart.MAX_MULTIPART_FILE_BYTES,
    );
    expect(config.SourceMapMaxFilesPerRequest).toBe(
      multipart.MAX_MULTIPART_FILES,
    );
  });

  it("pins the per-release count clamp to LIMIT_MAX", async () => {
    /*
     * Same duplication hazard, different ceiling: the write gate's countBy
     * uses LIMIT_MAX, so a change to LIMIT_MAX must be a deliberate change
     * to the reachable range of this knob.
     */
    expect(LIMIT_MAX).toBe(10000);

    const config: SourceMapConfigShape = await loadConfig({
      SOURCE_MAP_MAX_MAPS_PER_RELEASE: String(LIMIT_MAX * 10),
    });

    expect(config.SourceMapMaxMapsPerRelease).toBe(LIMIT_MAX);
  });
});
