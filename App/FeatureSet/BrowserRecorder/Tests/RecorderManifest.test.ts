import Config, { RECORDER_VERSION_PATTERN } from "../src/Config";
import {
  ARTIFACT_CONTENT_TYPE,
  ARTIFACT_ROUTE_PREFIX,
  LOADER_CACHE_CONTROL,
  LOADER_ROUTE_PATH,
  RECORDER_CACHE_CONTROL,
  RecorderManifest,
  RECORDER_VERSION_PATTERN as MANIFEST_VERSION_PATTERN,
  getArtifactFilePath,
  getPinnedRecorderPath,
  getRecorderIntegrity,
  getRecorderManifest,
  getRecorderVersion,
  isRecorderVersionContentAddressed,
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

interface BufferLike {
  toString: (encoding: string) => string;
}

interface BufferConstructorLike {
  from: (value: string, encoding: string) => BufferLike;
}

interface BufferModuleLike {
  Buffer: BufferConstructorLike;
}

interface ProcessLike {
  env: Record<string, string | undefined>;
  execPath: string;
}

declare const process: ProcessLike;

const fs: FileSystem = require("fs") as FileSystem;
const nodePath: PathModule = require("path") as PathModule;
const childProcess: ChildProcess = require("child_process") as ChildProcess;
const NodeBuffer: BufferConstructorLike = (
  require("buffer") as BufferModuleLike
).Buffer;

const PACKAGE_ROOT: string = nodePath.join(__dirname, "..");

const packageJson: { version: string } = require(
  nodePath.join(PACKAGE_ROOT, "package.json"),
) as { version: string };

/*
 * Read as TEXT, not required: esbuild.config.js loads esbuild, whose startup
 * invariant check fails under jsdom. The regex literal is what needs
 * comparing, and it is unambiguous in the source.
 */
function readBuildVersionPattern(): string {
  const source: string = fs.readFileSync(
    nodePath.join(PACKAGE_ROOT, "esbuild.config.js"),
    "utf8",
  );

  /*
   * Hoisted to a const rather than used inline: prettier and wrap-regex
   * disagree about parenthesising a regex literal in a member expression,
   * and fixing for one re-breaks the other.
   */
  const declarationPattern: RegExp =
    /^const RECORDER_VERSION_PATTERN = \/(.+)\/;$/m;

  const match: RegExpExecArray | null = declarationPattern.exec(source);

  return match && match[1] !== undefined ? match[1] : "";
}

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
const TEST_RECORDER_HEX: string = "00".repeat(48);
const TEST_RECORDER_VERSION: string = `11.7.3-sha384-${TEST_RECORDER_HEX}`;

function validManifest(): Record<string, unknown> {
  return {
    recorderVersion: TEST_RECORDER_VERSION,
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

  /*
   * The pattern is written out three times - in the browser config, in this
   * server-side reader, and in the build - because none of the three may
   * import either of the others. If they ever drift, the build stamps a
   * version the loader then refuses to turn into a URL, and the recorder goes
   * silent with no error anywhere.
   */
  it("uses one version grammar in the browser, the server and the build", (): void => {
    expect(MANIFEST_VERSION_PATTERN.source).toBe(
      RECORDER_VERSION_PATTERN.source,
    );
    expect(readBuildVersionPattern()).toBe(RECORDER_VERSION_PATTERN.source);
  });

  /*
   * THE regression test for immutable cache skew. The version the server
   * advertises has to include the exact recorder bytes' digest, and it has to
   * be one an already-cached loader will accept.
   */
  it("advertises a version content-addressed to the built recorder", (): void => {
    const manifest: RecorderManifest | null = getRecorderManifest();
    const integrity: string = manifest?.files["recorder.js"]?.integrity || "";
    const sha384Hex: string = NodeBuffer.from(
      integrity.replace(/^sha384-/, ""),
      "base64",
    ).toString("hex");
    const expectedVersion: string = `${packageJson.version}-sha384-${sha384Hex}`;

    expect(manifest).not.toBeNull();
    expect(getRecorderVersion()).toBe(expectedVersion);
    expect(manifest?.recorderVersion).toBe(expectedVersion);
    expect(manifest?.recorderVersion).not.toBe(packageJson.version);
    expect(isRecorderVersionContentAddressed(expectedVersion, integrity)).toBe(
      true,
    );
    expect(Config.isValidRecorderVersion(getRecorderVersion())).toBe(true);
  });

  it("publishes an SHA-384 integrity hash for the pinned artifact", (): void => {
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

    /* Short, because the stub is the rollback mechanism. */
    expect(LOADER_CACHE_CONTROL).toBe("public, max-age=300");

    /* A year and immutable, because the path is content-addressed. */
    expect(RECORDER_CACHE_CONTROL).toBe("public, max-age=31536000, immutable");
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

  /*
   * The immutable cache header is only truthful for an exact digest match.
   * Serving today's bytes under yesterday's content address, cached for a
   * year, is unrecoverable.
   */
  it("serves the pinned path only for the content address it published", (): void => {
    const version: string | null = getRecorderVersion();
    const changedVersion: string = version
      ? `${version.slice(0, -1)}${version.endsWith("0") ? "1" : "0"}`
      : "";

    expect(version).not.toBeNull();
    expect(getPinnedRecorderPath(version as string)).toContain("recorder.js");
    expect(getPinnedRecorderPath(changedVersion)).toBeNull();
    expect(getPinnedRecorderPath(packageJson.version)).toBeNull();
    expect(getPinnedRecorderPath("../../../etc/passwd")).toBeNull();
  });

  describe("validateManifest", (): void => {
    it("accepts a well-formed manifest", (): void => {
      expect(validateManifest(validManifest())?.recorderVersion).toBe(
        TEST_RECORDER_VERSION,
      );
    });

    it("accepts a prerelease package version with a content address", (): void => {
      const manifest: Record<string, unknown> = validManifest();
      manifest["recorderVersion"] = `11.7.3-beta.1-sha384-${TEST_RECORDER_HEX}`;

      expect(validateManifest(manifest)?.recorderVersion).toBe(
        manifest["recorderVersion"],
      );
    });

    it("rejects a version the loader would refuse to use", (): void => {
      const manifest: Record<string, unknown> = validManifest();
      manifest["recorderVersion"] = "latest";

      expect(validateManifest(manifest)).toBeNull();
    });

    it("rejects a mutable version even when its SRI is valid", (): void => {
      const manifest: Record<string, unknown> = validManifest();
      manifest["recorderVersion"] = "11.7.3";

      expect(validateManifest(manifest)).toBeNull();
    });

    it("rejects a content address that does not match recorder SRI", (): void => {
      const manifest: Record<string, unknown> = validManifest();
      manifest["recorderVersion"] = `11.7.3-sha384-${"11".repeat(48)}`;

      expect(validateManifest(manifest)).toBeNull();
    });

    it("rejects truncated or uppercase content addresses", (): void => {
      for (const recorderVersion of [
        `11.7.3-sha384-${TEST_RECORDER_HEX.slice(0, -1)}`,
        `11.7.3-sha384-${TEST_RECORDER_HEX.slice(0, -1)}A`,
      ]) {
        const manifest: Record<string, unknown> = validManifest();
        manifest["recorderVersion"] = recorderVersion;

        expect(validateManifest(manifest)).toBeNull();
      }
    });

    it("rejects malformed or mismatched SHA-384 integrity", (): void => {
      for (const recorderIntegrity of [
        `sha384-${"A".repeat(63)}`,
        `sha384-${"C".repeat(64)}`,
      ]) {
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
