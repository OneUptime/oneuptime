import Config, {
  LATEST_RECORDER_VERSION as CONFIG_LATEST_RECORDER_VERSION,
} from "../src/Config";
import {
  ARTIFACT_CONTENT_TYPE,
  ARTIFACT_ROUTE_PREFIX,
  LATEST_RECORDER_ROUTE_PATH,
  LATEST_RECORDER_VERSION as MANIFEST_LATEST_RECORDER_VERSION,
  LOADER_CACHE_CONTROL,
  LOADER_ROUTE_PATH,
  RECORDER_CACHE_CONTROL,
  RecorderManifest,
  getArtifactFilePath,
  getLatestRecorderPath,
  getRecorderIntegrity,
  getRecorderManifest,
  getRecorderVersion,
  resetRecorderManifestCache,
  validateManifest,
} from "../Manifest";

/*
 * The build manifest is the SINGLE source of truth for which recorder version
 * is published and what its SRI hash is.
 *
 * The defect this file exists to prevent: the artifact was named and stamped
 * from package.json's version (11.7.3, rewritten repo-wide on every release
 * by Scripts/Install/SyncPackageVersions.js) while the config endpoint
 * advertised an env var, SESSION_REPLAY_RECORDER_VERSION, defaulting to the
 * literal "1.0.0". Every loader in every browser was therefore told to fetch
 * an artifact that had never been published. Two independently-defaulted
 * answers to one question cannot be kept in step by hand, so there is now
 * only one answer and it comes from the build; the env var has since been
 * deleted so nobody ships a rollback by setting a value nothing reads.
 */

declare function require(id: string): unknown;
declare const __dirname: string;

interface FileSystem {
  existsSync: (file: string) => boolean;
  readFileSync: (file: string, encoding: string) => string;
}

interface PathModule {
  join: (...parts: Array<string>) => string;
}

interface ChildProcess {
  execFileSync: (
    file: string,
    args: Array<string>,
    options: { cwd: string; env: Record<string, string | undefined> },
  ) => unknown;
}

interface ProcessLike {
  env: Record<string, string | undefined>;
  execPath: string;
}

declare const process: ProcessLike;

const fs: FileSystem = require("fs") as FileSystem;
const nodePath: PathModule = require("path") as PathModule;
const childProcess: ChildProcess = require("child_process") as ChildProcess;

const PACKAGE_ROOT: string = nodePath.join(__dirname, "..");

function buildIfMissing(): void {
  if (
    fs.existsSync(
      nodePath.join(PACKAGE_ROOT, "public", "dist", "manifest.json"),
    )
  ) {
    return;
  }

  childProcess.execFileSync(
    process.execPath,
    [nodePath.join(PACKAGE_ROOT, "esbuild.config.js")],
    {
      cwd: PACKAGE_ROOT,
      env: { ...process.env, NODE_ENV: "production" },
    },
  );
}

const TEST_RECORDER_BASE64: string = "A".repeat(64);

function validManifest(): Record<string, unknown> {
  return {
    recorderVersion: MANIFEST_LATEST_RECORDER_VERSION,
    rrwebVersion: "2.1.1",
    files: {
      "recorder.js": {
        bytes: 100,
        integrity: `sha384-${TEST_RECORDER_BASE64}`,
      },
      "loader.js": { bytes: 10, integrity: `sha384-${"B".repeat(64)}` },
    },
  };
}

describe("recorder manifest", (): void => {
  beforeAll((): void => {
    buildIfMissing();
    resetRecorderManifestCache();
  }, 120000);

  it("advertises the mutable latest artifact", (): void => {
    const manifest: RecorderManifest | null = getRecorderManifest();

    expect(manifest).not.toBeNull();
    expect(CONFIG_LATEST_RECORDER_VERSION).toBe("latest");
    expect(MANIFEST_LATEST_RECORDER_VERSION).toBe("latest");
    expect(getRecorderVersion()).toBe("latest");
    expect(manifest?.recorderVersion).toBe("latest");
    expect(Config.isValidRecorderVersion(getRecorderVersion())).toBe(true);
    expect(Config.isValidRecorderVersion("13.0.4")).toBe(false);
  });

  it("publishes an SHA-384 integrity hash for the latest artifact", (): void => {
    const integrity: string | null = getRecorderIntegrity();

    expect(integrity).toMatch(/^sha384-/);
    expect(integrity).toBe(
      getRecorderManifest()?.files["recorder.js"]?.integrity,
    );
  });

  /*
   * The route the artifacts must be served on, pinned here so the recorder
   * side and whatever mounts the route cannot drift apart silently.
   */
  it("names the routes and cache policy the two-stage load depends on", (): void => {
    expect(ARTIFACT_ROUTE_PREFIX).toBe("/telemetry/session-replay");
    expect(LOADER_ROUTE_PATH).toBe("/telemetry/session-replay/v1/recorder.js");
    expect(LATEST_RECORDER_ROUTE_PATH).toBe(
      "/telemetry/session-replay/latest/recorder.js",
    );

    /* Short, because the stub is the rollback mechanism. */
    expect(LOADER_CACHE_CONTROL).toBe("public, max-age=300");

    /* Mutable latest bytes must never outlive the SRI returned by config. */
    expect(RECORDER_CACHE_CONTROL).toBe("no-store");
    expect(ARTIFACT_CONTENT_TYPE).toContain("application/javascript");
  });

  it("resolves the artifacts it published and nothing else", (): void => {
    expect(getArtifactFilePath("recorder.js")).toContain(
      "public/dist/recorder.js",
    );
    expect(getArtifactFilePath("loader.js")).toContain("public/dist/loader.js");

    /* A URL segment must never be joined onto the dist directory unchecked. */
    expect(getArtifactFilePath("../../../package.json")).toBeNull();
    expect(getArtifactFilePath("manifest.json")).toBeNull();
    expect(getArtifactFilePath("")).toBeNull();
  });

  it("resolves the latest artifact without a caller-controlled path", (): void => {
    expect(getLatestRecorderPath()).toContain("public/dist/recorder.js");
  });

  describe("validateManifest", (): void => {
    it("accepts a well-formed manifest", (): void => {
      expect(validateManifest(validManifest())?.recorderVersion).toBe(
        MANIFEST_LATEST_RECORDER_VERSION,
      );
    });

    it("rejects every recorder label except latest", (): void => {
      for (const recorderVersion of ["11.7.3", "stable", "", "LATEST"]) {
        const manifest: Record<string, unknown> = validManifest();
        manifest["recorderVersion"] = recorderVersion;

        expect(validateManifest(manifest)).toBeNull();
      }
    });

    it("rejects malformed SHA-384 integrity", (): void => {
      for (const recorderIntegrity of [`sha384-${"A".repeat(63)}`, "sha384-"]) {
        const manifest: Record<string, unknown> = validManifest();
        (manifest["files"] as Record<string, unknown>)["recorder.js"] = {
          bytes: 100,
          integrity: recorderIntegrity,
        };

        expect(validateManifest(manifest)).toBeNull();
      }
    });

    /*
     * A weaker or unrecognised algorithm here would silently downgrade the
     * integrity attribute the loader puts on the injected script tag.
     */
    it("rejects anything that is not an SHA-384 hash", (): void => {
      const manifest: Record<string, unknown> = validManifest();
      (manifest["files"] as Record<string, unknown>)["recorder.js"] = {
        bytes: 100,
        integrity: "sha256-aaa",
      };

      expect(validateManifest(manifest)).toBeNull();
    });

    it("rejects a manifest missing either artifact", (): void => {
      const manifest: Record<string, unknown> = validManifest();
      delete (manifest["files"] as Record<string, unknown>)["loader.js"];

      expect(validateManifest(manifest)).toBeNull();
    });

    it("rejects junk rather than throwing", (): void => {
      expect(validateManifest(null)).toBeNull();
      expect(validateManifest("{}")).toBeNull();
      expect(validateManifest({ recorderVersion: "1.0.0" })).toBeNull();
    });
  });
});

/* Marks this file as a module, so its ambient Node declarations stay local. */
export {};
