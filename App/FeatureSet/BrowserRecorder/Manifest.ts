/*
 * The SERVER's view of the built recorder artifacts.
 *
 * This is the single source of truth for "which recorder artifact is
 * published, and what is its SRI hash". Everything that needs to answer that
 * question - the config endpoint's recorderVersion and recorderIntegrity
 * fields, and whatever route serves public/dist - must read it from here.
 *
 * The version was previously answered twice, independently: esbuild stamped
 * package.json's version into the artifact and named the file after it, while
 * the config endpoint returned an env var that defaulted to "1.0.0". Those two
 * numbers have never matched, and Scripts/Install/SyncPackageVersions.js
 * rewrites the first on every release, so they could not be kept matching by
 * hand either. A loader told to fetch v1.0.0 requests an artifact that was
 * never published.
 *
 * NOT under src/. src/ is browser code that esbuild bundles and ships to
 * third-party origins; this file reads the filesystem and only ever runs in
 * the App server process. It is deliberately outside this package's own
 * tsconfig "include" for the same reason - @types/node is absent there on
 * purpose - so the handful of Node globals it needs are declared locally,
 * exactly as Tests/SourceHygiene.test.ts does.
 */

declare function require(id: string): unknown;
declare const __dirname: string;

interface FileSystemLike {
  existsSync: (file: string) => boolean;
  readFileSync: (file: string, encoding: string) => string;
}

interface PathModuleLike {
  join: (...parts: Array<string>) => string;
}

interface BufferLike {
  length: number;
  toString: (encoding: string) => string;
}

interface BufferConstructorLike {
  from: (value: string, encoding: string) => BufferLike;
}

interface BufferModuleLike {
  Buffer: BufferConstructorLike;
}

const fs: FileSystemLike = require("fs") as FileSystemLike;
const nodePath: PathModuleLike = require("path") as PathModuleLike;
const NodeBuffer: BufferConstructorLike = (
  require("buffer") as BufferModuleLike
).Buffer;

/*
 * Must stay identical to RECORDER_VERSION_PATTERN in src/Config.ts and in
 * esbuild.config.js. Duplicated rather than imported because importing
 * src/Config.ts here would pull browser code (and its Common/* path alias)
 * into the server bundle. Tests/RecorderManifest.test.ts asserts all three
 * agree.
 */
export const RECORDER_VERSION_PATTERN: RegExp =
  /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/;

/* Mount point for both artifacts. Mirrors ARTIFACT_PATH_PREFIX in src/Config.ts. */
export const ARTIFACT_ROUTE_PREFIX: string = "/telemetry/session-replay";

/*
 * The loader stub lives at a FIXED "v1" path with a short cache, and the
 * recorder lives at a content-addressed path cached for a year. That
 * asymmetry is the whole two-stage design: a bad masking release is rolled
 * back by changing which artifact the config advertises, not by waiting out
 * an immutable cache in browsers we cannot reach.
 */
export const LOADER_ROUTE_PATH: string = `${ARTIFACT_ROUTE_PREFIX}/v1/recorder.js`;

export const LOADER_CACHE_CONTROL: string = "public, max-age=300";

export const RECORDER_CACHE_CONTROL: string =
  "public, max-age=31536000, immutable";

export const ARTIFACT_CONTENT_TYPE: string =
  "application/javascript; charset=utf-8";

export interface RecorderArtifact {
  bytes: number;
  integrity: string;
}

export interface RecorderManifest {
  recorderVersion: string;
  rrwebVersion: string;
  files: Record<string, RecorderArtifact>;
}

const SHA384_INTEGRITY_PATTERN: RegExp = /^sha384-([A-Za-z0-9+/]{64})$/;
const CONTENT_ADDRESSED_VERSION_PATTERN: RegExp =
  /^(.*)-sha384-([0-9a-f]{96})$/;

function getSha384Hex(integrity: string): string | null {
  const match: RegExpExecArray | null =
    SHA384_INTEGRITY_PATTERN.exec(integrity);
  const base64Digest: string | undefined = match ? match[1] : undefined;

  if (!base64Digest) {
    return null;
  }

  const digest: BufferLike = NodeBuffer.from(base64Digest, "base64");

  /* SHA-384 is exactly 48 bytes (96 lowercase hexadecimal characters). */
  return digest.length === 48 ? digest.toString("hex") : null;
}

/*
 * The artifact locator and SRI must identify the same bytes. Keeping this
 * invariant in the manifest reader is deliberate: a hand-written or stale
 * manifest with a bare package version would otherwise make the server send
 * mutable bytes under a one-year immutable URL again.
 */
export function isRecorderVersionContentAddressed(
  recorderVersion: string,
  recorderIntegrity: string,
): boolean {
  const sha384Hex: string | null = getSha384Hex(recorderIntegrity);
  const versionMatch: RegExpExecArray | null =
    CONTENT_ADDRESSED_VERSION_PATTERN.exec(recorderVersion);
  const packageVersion: string | undefined = versionMatch
    ? versionMatch[1]
    : undefined;
  const versionSha384Hex: string | undefined = versionMatch
    ? versionMatch[2]
    : undefined;

  return Boolean(
    packageVersion &&
      RECORDER_VERSION_PATTERN.test(packageVersion) &&
      sha384Hex &&
      versionSha384Hex === sha384Hex,
  );
}

const DIST_DIRECTORY: string = nodePath.join(__dirname, "public", "dist");

const MANIFEST_PATH: string = nodePath.join(DIST_DIRECTORY, "manifest.json");

/*
 * Read once and memoised. The artifacts are produced at image build time and
 * cannot change while the process is alive, and the config endpoint is on a
 * hot path that must not do a synchronous read per request.
 *
 * `null` means "not built", which is the normal state in a dev checkout that
 * has never run `npm run build-frontend:browser-recorder`. Callers must treat
 * it as "session replay cannot be served" rather than substituting a guess -
 * a guessed version is the exact defect this module exists to remove.
 */
let cached: RecorderManifest | null = null;
let hasRead: boolean = false;

export function getRecorderManifest(): RecorderManifest | null {
  if (hasRead) {
    return cached;
  }

  hasRead = true;
  cached = readManifest();

  return cached;
}

/* Test seam only. Production never has a reason to re-read. */
export function resetRecorderManifestCache(): void {
  hasRead = false;
  cached = null;
}

function readManifest(): RecorderManifest | null {
  if (!fs.existsSync(MANIFEST_PATH)) {
    return null;
  }

  let parsed: unknown = null;

  try {
    parsed = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  } catch {
    /*
     * A truncated or half-written manifest must not take down App boot. The
     * caller sees "not built" and session replay stays off.
     */
    return null;
  }

  return validateManifest(parsed);
}

export function validateManifest(parsed: unknown): RecorderManifest | null {
  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const raw: Record<string, unknown> = parsed as Record<string, unknown>;

  const recorderVersion: unknown = raw["recorderVersion"];
  const rrwebVersion: unknown = raw["rrwebVersion"];
  const files: unknown = raw["files"];

  if (
    typeof recorderVersion !== "string" ||
    !RECORDER_VERSION_PATTERN.test(recorderVersion)
  ) {
    return null;
  }

  if (typeof rrwebVersion !== "string" || !rrwebVersion) {
    return null;
  }

  if (!files || typeof files !== "object") {
    return null;
  }

  const rawFiles: Record<string, unknown> = files as Record<string, unknown>;
  const validated: Record<string, RecorderArtifact> = {};

  for (const name of Object.keys(rawFiles)) {
    const entry: unknown = rawFiles[name];

    if (!entry || typeof entry !== "object") {
      return null;
    }

    const file: Record<string, unknown> = entry as Record<string, unknown>;
    const bytes: unknown = file["bytes"];
    const integrity: unknown = file["integrity"];

    if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) {
      return null;
    }

    /*
     * SHA-384 specifically: it is what the build emits, and accepting a
     * weaker or unrecognised algorithm here would silently downgrade the
     * integrity attribute the loader puts on the injected script tag.
     */
    if (typeof integrity !== "string" || !getSha384Hex(integrity)) {
      return null;
    }

    validated[name] = { bytes: bytes, integrity: integrity };
  }

  const recorder: RecorderArtifact | undefined = validated["recorder.js"];
  const loader: RecorderArtifact | undefined = validated["loader.js"];

  if (!recorder || !loader) {
    return null;
  }

  if (!isRecorderVersionContentAddressed(recorderVersion, recorder.integrity)) {
    return null;
  }

  return {
    recorderVersion: recorderVersion,
    rrwebVersion: rrwebVersion,
    files: validated,
  };
}

/*
 * The version the config endpoint must advertise. Null when nothing is built,
 * in which case the endpoint has to report the feature as disabled: telling a
 * recorder to load an artifact that does not exist gets it a 404 and a silent
 * no-op on the customer's page.
 */
export function getRecorderVersion(): string | null {
  const manifest: RecorderManifest | null = getRecorderManifest();

  return manifest ? manifest.recorderVersion : null;
}

/* SRI hash for the pinned artifact, for the config response's recorderIntegrity. */
export function getRecorderIntegrity(): string | null {
  const manifest: RecorderManifest | null = getRecorderManifest();
  const file: RecorderArtifact | undefined = manifest
    ? manifest.files["recorder.js"]
    : undefined;

  return file ? file.integrity : null;
}

/*
 * Absolute path of an artifact on disk, or null when the name is not one this
 * build published. Name-based rather than path-based on purpose: the caller
 * passes a URL segment, and joining an unvalidated segment onto a directory
 * is a path traversal.
 */
export function getArtifactFilePath(fileName: string): string | null {
  const manifest: RecorderManifest | null = getRecorderManifest();

  if (!manifest || !manifest.files[fileName]) {
    return null;
  }

  return nodePath.join(DIST_DIRECTORY, fileName);
}

/*
 * The pinned artifact path for a given content-addressed version, or null
 * when the requested version is not the one this build published. The
 * immutable cache header is only truthful for an exact match: serving
 * today's bytes under yesterday's locator, cached for a year, is
 * unrecoverable.
 */
export function getPinnedRecorderPath(version: string): string | null {
  const manifest: RecorderManifest | null = getRecorderManifest();

  if (!manifest || manifest.recorderVersion !== version) {
    return null;
  }

  return getArtifactFilePath("recorder.js");
}
