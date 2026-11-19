"use strict";

/**
 * How the Android device agent (agents/AndroidAgent) is tested and released.
 *
 *  - test.android-agent.yaml runs on every pull request that changes the
 *    agent: its unit and Robolectric tests, lint, both builds, a signing of
 *    the release APK with a key made for the run, and its on-device tests on
 *    an Android 15 emulator, with READ_LOGS granted before they start.
 *  - release.yml's android-agent-build builds the release APK with the
 *    release's version and signs it with scripts/sign-release.sh, from the
 *    ANDROID_AGENT_* secrets; finalize-github-release attaches it when that
 *    succeeded (ReleaseCriticalPath.test.js holds the attaching).
 *  - scripts/sign-release.sh signs with apksigner, v1 included - the Android
 *    Gradle plugin leaves v1 out with a minSdk of 24, and Esper refuses an
 *    APK without it - and refuses to finish unless v1, v2 and v3 verify. It
 *    runs here against stand-ins for zipalign and apksigner.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const yaml = require("js-yaml");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const AGENT = "agents/AndroidAgent";
const SIGN = `${AGENT}/scripts/sign-release.sh`;

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function commands(job) {
  return (job.steps || [])
    .map((step) => {
      return [step.run || "", JSON.stringify(step.with || {})].join("\n");
    })
    .join("\n");
}

describe("test.android-agent.yaml", () => {
  const workflow = yaml.load(read(".github/workflows/test.android-agent.yaml"));
  const triggers = workflow.on;

  test("runs for pull requests that change the agent, nightly, and by hand", () => {
    expect(triggers.pull_request.paths).toEqual([
      "agents/AndroidAgent/**",
      ".github/workflows/test.android-agent.yaml",
    ]);
    expect(triggers.schedule).toHaveLength(1);
    expect(triggers).toHaveProperty("workflow_dispatch");
    expect(triggers).not.toHaveProperty("push");
    expect(workflow.permissions).toEqual({ contents: "read" });
  });

  test("tests, lints and builds both variants, then signs the release APK with a key made for the run", () => {
    const run = commands(workflow.jobs.test);

    expect(run).toContain("./gradlew test lint assembleDebug assembleRelease");
    expect(run).toContain("keytool -genkeypair");
    expect(run).toContain(
      "scripts/sign-release.sh app/build/outputs/apk/release/app-release-unsigned.apk",
    );
  });

  test("runs the on-device tests with READ_LOGS granted before they start, and checks their result", () => {
    const run = commands(workflow.jobs["on-device"]);
    const grant = run.indexOf(
      "pm grant com.oneuptime.androidagent android.permission.READ_LOGS",
    );
    const instrument = run.indexOf("am instrument -w");

    expect(grant).toBeGreaterThan(-1);
    expect(instrument).toBeGreaterThan(grant);
    expect(run).toContain('grep -q \\"^OK (\\"');
    expect(run).toContain("api-level");
  });
});

describe("release.yml: android-agent-build", () => {
  const job = yaml.load(read(".github/workflows/release.yml")).jobs[
    "android-agent-build"
  ];
  const run = commands(job);

  test("builds the release APK with the release's own version", () => {
    expect(job.needs).toEqual(["read-version"]);
    expect(run).toContain(
      "./gradlew assembleRelease -PagentVersion=${{ needs.read-version.outputs.major_minor }}",
    );
  });

  test("signs it with sign-release.sh from the ANDROID_AGENT_* secrets, and deletes the keystore after", () => {
    const sign = job.steps.find((step) => {
      return step.name === "Sign the Android agent's release APK";
    });

    expect(Object.keys(sign.env).sort()).toEqual([
      "ANDROID_AGENT_KEYSTORE_BASE64",
      "ANDROID_AGENT_KEYSTORE_PASSWORD",
      "ANDROID_AGENT_KEY_ALIAS",
      "ANDROID_AGENT_KEY_PASSWORD",
    ]);
    for (const value of Object.values(sign.env)) {
      expect(value).toMatch(/^\$\{\{ secrets\.ANDROID_AGENT_[A-Z0-9_]+ \}\}$/);
    }
    expect(sign.run).toContain("agents/AndroidAgent/scripts/sign-release.sh");
    expect(sign.run).toContain('rm -f "$ANDROID_AGENT_KEYSTORE_FILE"');
    // A release made before the secrets exist says why it has no APK.
    expect(sign.run).toContain(
      "ANDROID_AGENT_KEYSTORE_BASE64 secret is not set",
    );
    // The secrets are never printed: no echo of the variables that hold them.
    expect(sign.run).not.toMatch(
      /echo[^\n]*\$ANDROID_AGENT_(KEYSTORE_PASSWORD|KEY_PASSWORD|KEYSTORE_BASE64)/,
    );
  });

  test("keeps the signed APK and its SHA-256 for the release", () => {
    expect(run).toContain("oneuptime-android-agent.apk");
    expect(run).toContain("sha256sum oneuptime-android-agent.apk");
  });
});

describe("agents/AndroidAgent", () => {
  test("signs and verifies v1, v2 and v3, with the passwords read from the environment by name", () => {
    const script = read(SIGN);

    expect(fs.statSync(path.join(REPO_ROOT, SIGN)).mode & 0o111).not.toBe(0);
    for (const flag of [
      "--v1-signing-enabled true",
      "--v2-signing-enabled true",
      "--v3-signing-enabled true",
      "--ks-pass env:ANDROID_AGENT_KEYSTORE_PASSWORD",
      "--key-pass env:ANDROID_AGENT_KEY_PASSWORD",
      // apksigner verifies v1 only for an SDK that reads it.
      "verify --verbose --print-certs --min-sdk-version 23",
    ]) {
      expect(script).toContain(flag);
    }
  });

  test("its Gradle wrapper downloads Gradle only with the checksum it pins", () => {
    const properties = read(
      `${AGENT}/gradle/wrapper/gradle-wrapper.properties`,
    );

    expect(properties).toMatch(/^distributionSha256Sum=[0-9a-f]{64}$/m);
    expect(properties).toMatch(
      /^distributionUrl=https\\:\/\/services\.gradle\.org\/distributions\/gradle-[0-9.]+-bin\.zip$/m,
    );
  });

  test("its release version code grows with OneUptime's version", () => {
    const build = read(`${AGENT}/app/build.gradle.kts`);

    expect(build).toContain(
      "return major * 10_000_000 + minor * 10_000 + patch",
    );
    expect(build).toContain('findProperty("agentVersion")');
  });
});

/*
 * sign-release.sh, run against stand-ins: zipalign copies, apksigner "signs"
 * by copying and "verifies" by printing the report a test sets.
 */
describe("scripts/sign-release.sh", () => {
  let work;
  let buildTools;
  let environment;

  function standIn(name, body) {
    const file = path.join(buildTools, name);
    fs.writeFileSync(file, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`);
    fs.chmodSync(file, 0o755);
  }

  beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), "android-agent-sign-"));
    buildTools = path.join(work, "sdk", "build-tools", "36.0.0");
    fs.mkdirSync(buildTools, { recursive: true });
    standIn("zipalign", 'cp "${@: -2:1}" "${@: -1}"');
    standIn(
      "apksigner",
      [
        'if [ "$1" = "sign" ]; then',
        '  echo "$@" > "$CALLS"',
        '  out=""; prev=""',
        '  for arg in "$@"; do if [ "$prev" = "--out" ]; then out=$arg; fi; prev=$arg; done',
        '  cp "${@: -1}" "$out"',
        "else",
        '  printf "%s\\n" "$FAKE_REPORT"',
        "fi",
      ].join("\n"),
    );
    fs.writeFileSync(path.join(work, "unsigned.apk"), "apk");
    fs.writeFileSync(path.join(work, "release.jks"), "keystore");
    environment = {
      ...process.env,
      ANDROID_HOME: path.join(work, "sdk"),
      ANDROID_AGENT_KEYSTORE_FILE: path.join(work, "release.jks"),
      ANDROID_AGENT_KEYSTORE_PASSWORD: "store-secret",
      ANDROID_AGENT_KEY_ALIAS: "agent",
      ANDROID_AGENT_KEY_PASSWORD: "key-secret",
      CALLS: path.join(work, "calls.txt"),
      FAKE_REPORT: [
        "Verifies",
        "Verified using v1 scheme (JAR signing): true",
        "Verified using v2 scheme (APK Signature Scheme v2): true",
        "Verified using v3 scheme (APK Signature Scheme v3): true",
        "Signer #1 certificate SHA-256 digest: 4f090b79",
      ].join("\n"),
    };
  });

  afterEach(() => {
    fs.rmSync(work, { recursive: true, force: true });
  });

  function sign(env = environment) {
    return spawnSync(
      "bash",
      [
        path.join(REPO_ROOT, SIGN),
        path.join(work, "unsigned.apk"),
        path.join(work, "signed.apk"),
      ],
      { env, encoding: "utf8" },
    );
  }

  test("signs with every scheme, never putting a password on the command line, and prints the certificate", () => {
    const run = sign();

    expect(run.status).toBe(0);
    expect(fs.existsSync(path.join(work, "signed.apk"))).toBe(true);
    const call = fs.readFileSync(path.join(work, "calls.txt"), "utf8");
    expect(call).toContain("--v1-signing-enabled true");
    expect(call).not.toContain("store-secret");
    expect(call).not.toContain("key-secret");
    expect(run.stdout).toContain("Signed");
    expect(run.stdout).toContain("certificate SHA-256 digest: 4f090b79");
  });

  test.each(["v1", "v2", "v3"])(
    "refuses an APK whose %s signature does not verify",
    (scheme) => {
      environment.FAKE_REPORT = environment.FAKE_REPORT.replace(
        new RegExp(`(Verified using ${scheme} scheme [^\\n]*): true`),
        "$1: false",
      );

      const run = sign();

      expect(run.status).toBe(1);
      expect(run.stderr).toContain(`is not signed with the ${scheme} scheme`);
    },
  );

  test.each([
    "ANDROID_AGENT_KEYSTORE_FILE",
    "ANDROID_AGENT_KEYSTORE_PASSWORD",
    "ANDROID_AGENT_KEY_ALIAS",
    "ANDROID_AGENT_KEY_PASSWORD",
    "ANDROID_HOME",
  ])("says which setting is missing: %s", (name) => {
    const env = { ...environment };
    delete env[name];

    const run = sign(env);

    expect(run.status).toBe(1);
    expect(run.stderr).toContain(`${name} is not set.`);
  });
});
