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
 *  - release.yml's publish-android-agent-to-google-play builds the release
 *    bundle once the release is published, signs it with the upload key
 *    (scripts/sign-bundle.sh, from the ANDROID_AGENT_UPLOAD_* secrets) and
 *    has Gradle Play Publisher upload it and the store listing, with the
 *    service account in ANDROID_AGENT_GOOGLE_PLAY_SERVICE_ACCOUNT_JSON, as a
 *    draft on the internal track. Without its secrets it is skipped with a
 *    notice, never failed. scripts/sign-bundle.sh runs here against
 *    stand-ins for jarsigner and keytool, and against the real ones where a
 *    JDK is installed.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const yaml = require("js-yaml");

const { needsOf, ancestorsOf } = require("./Utils/ReleaseWorkflow");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const AGENT = "agents/AndroidAgent";
const SIGN = `${AGENT}/scripts/sign-release.sh`;
const SIGN_BUNDLE = `${AGENT}/scripts/sign-bundle.sh`;
const GOOGLE_PLAY_JOB = "publish-android-agent-to-google-play";
const UPLOAD_SECRETS = [
  "ANDROID_AGENT_UPLOAD_KEYSTORE_BASE64",
  "ANDROID_AGENT_UPLOAD_KEYSTORE_PASSWORD",
  "ANDROID_AGENT_UPLOAD_KEY_ALIAS",
  "ANDROID_AGENT_UPLOAD_KEY_PASSWORD",
];
const SERVICE_ACCOUNT_SECRET = "ANDROID_AGENT_GOOGLE_PLAY_SERVICE_ACCOUNT_JSON";
const GOOGLE_PLAY_SECRETS = [...UPLOAD_SECRETS, SERVICE_ACCOUNT_SECRET];
const E2E_JOBS = [
  "test-e2e-release-saas",
  "test-e2e-release-self-hosted",
  "test-e2e-release-enterprise",
];
const PUBLISH_GATE = "steps.secrets.outputs.publish == 'true'";

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

/*
 * A release.yml step's script, run the way the step runs it (bash -e), with
 * nothing in its environment but PATH and what the test hands it.
 */
function runStepScript(script, env) {
  const result = spawnSync("bash", ["-e", "-c", script], {
    encoding: "utf8",
    timeout: 60000,
    env: { PATH: process.env.PATH, ...env },
  });
  if (result.error) {
    throw result.error;
  }
  return result;
}

describe(`release.yml: ${GOOGLE_PLAY_JOB}`, () => {
  const jobs = yaml.load(read(".github/workflows/release.yml")).jobs;
  const job = jobs[GOOGLE_PLAY_JOB];
  const steps = job.steps;
  const check = steps[0];

  function stepNamed(name) {
    return (
      steps.find((candidate) => {
        return candidate.name === name;
      }) || {}
    );
  }

  const build = stepNamed("Build the Android agent's release bundle");
  const sign = stepNamed("Sign the bundle with the upload key");
  const keep = stepNamed("Keep the signed bundle");
  const publish = stepNamed(
    "Publish the bundle and the store listing to Google Play",
  );

  test("checks its secrets, builds, signs, keeps and publishes, in that order (the checks below are not vacuous)", () => {
    expect(
      steps.map((step) => {
        return step.name || step.uses;
      }),
    ).toEqual([
      "Check the publishing secrets",
      "actions/checkout@v4",
      "actions/setup-java@v4",
      "gradle/actions/setup-gradle@v4",
      "Install the Android SDK packages the agent builds with",
      "Build the Android agent's release bundle",
      "Sign the bundle with the upload key",
      "Keep the signed bundle",
      "Publish the bundle and the store listing to Google Play",
    ]);
  });

  test("runs once the release is published, so only after the e2e jobs pass, and only for `release`", () => {
    expect(needsOf(job)).toEqual(["read-version", "finalize-github-release"]);
    const waitsFor = ancestorsOf(jobs, GOOGLE_PLAY_JOB);
    for (const e2e of E2E_JOBS) {
      expect({ e2e, waited: waitsFor.has(e2e) }).toEqual({ e2e, waited: true });
    }
    // No status function: Actions requires every job it needs to succeed.
    expect(job.if).toBe("github.ref == 'refs/heads/release'");
  });

  test("may read the repository and nothing else, has a timeout, and runs one at a time without cancelling another", () => {
    expect(job.permissions).toEqual({ contents: "read" });
    expect(Number.isInteger(job["timeout-minutes"])).toBe(true);
    expect(job["timeout-minutes"]).toBeGreaterThan(0);
    expect(job.concurrency).toEqual({
      group: "android-agent-google-play",
      "cancel-in-progress": false,
    });
  });

  test("checks its secrets first, and every later step runs only when they are all set", () => {
    expect(check.id).toBe("secrets");
    expect(Object.keys(check.env).sort()).toEqual(
      [...GOOGLE_PLAY_SECRETS].sort(),
    );
    for (const secret of GOOGLE_PLAY_SECRETS) {
      expect(check.env[secret]).toBe(`\${{ secrets.${secret} }}`);
    }
    for (const step of steps.slice(1)) {
      expect({ step: step.name || step.uses, if: step.if }).toEqual({
        step: step.name || step.uses,
        if: PUBLISH_GATE,
      });
    }
  });

  test("is skipped with a notice naming what is missing, not failed, while a secret is not set, and publishes once all are", () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "android-agent-play-"));
    try {
      let runs = 0;
      const outcome = (values) => {
        runs += 1;
        const output = path.join(work, `output-${runs}`);
        const result = runStepScript(check.run, {
          GITHUB_OUTPUT: output,
          ...values,
        });
        expect(result.status).toBe(0);
        const printed = `${result.stdout}${result.stderr}`;
        // A secret's value is never printed, only the names of those unset.
        for (const value of Object.values(values)) {
          if (value) {
            expect(printed).not.toContain(value);
          }
        }
        return {
          output: fs.readFileSync(output, "utf8").trim(),
          notice: /^::notice title=Google Play skipped::/m.test(result.stdout),
          printed,
        };
      };
      const all = Object.fromEntries(
        GOOGLE_PLAY_SECRETS.map((secret, index) => {
          return [secret, `secret-value-${index}`];
        }),
      );

      expect(outcome(all)).toEqual({
        output: "publish=true",
        notice: false,
        printed: "",
      });
      for (const secret of GOOGLE_PLAY_SECRETS) {
        const { printed, ...result } = outcome({ ...all, [secret]: "" });
        expect({ missing: secret, ...result }).toEqual({
          missing: secret,
          output: "publish=false",
          notice: true,
        });
        expect(printed).toContain(secret);
        expect(printed).toContain("agents/AndroidAgent/RELEASING.md");
      }
      const none = outcome({});
      expect(none.output).toBe("publish=false");
      for (const secret of GOOGLE_PLAY_SECRETS) {
        expect(none.printed).toContain(secret);
      }
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  });

  test("checks out the commit that triggered the run, and hands values to commands only through env", () => {
    const checkouts = steps.filter((step) => {
      return (step.uses || "").startsWith("actions/checkout@");
    });
    expect(checkouts).toHaveLength(1);
    expect((checkouts[0].with || {}).ref).toBe(undefined);
    expect(
      steps
        .filter((step) => {
          return (step.run || "").includes("${{");
        })
        .map((step) => {
          return step.name || step.uses;
        }),
    ).toEqual([]);
  });

  test("builds the release bundle in agents/AndroidAgent, with the release's own version", () => {
    expect(build["working-directory"]).toBe(AGENT);
    expect(build.env).toEqual({
      AGENT_VERSION: "${{ needs.read-version.outputs.major_minor }}",
    });
    expect(build.run).toContain(
      './gradlew bundleRelease -PagentVersion="$AGENT_VERSION"',
    );
  });

  test("signs it with sign-bundle.sh, from the ANDROID_AGENT_UPLOAD_* secrets, and deletes the keystore whatever happens", () => {
    expect(Object.keys(sign.env).sort()).toEqual([...UPLOAD_SECRETS].sort());
    for (const secret of UPLOAD_SECRETS) {
      expect(sign.env[secret]).toBe(`\${{ secrets.${secret} }}`);
    }
    expect(sign.run).toContain(`${SIGN_BUNDLE} \\`);
    expect(sign.run).toContain(
      `${AGENT}/app/build/outputs/bundle/release/app-release.aab`,
    );
    expect(sign.run).toContain(
      '"$RUNNER_TEMP/android-agent-google-play/oneuptime-android-agent.aab"',
    );
    const trap = sign.run.indexOf(
      "trap 'rm -f \"$ANDROID_AGENT_UPLOAD_KEYSTORE_FILE\"' EXIT",
    );
    const decode = sign.run.indexOf("base64 --decode");
    expect(trap).toBeGreaterThan(-1);
    expect(decode).toBeGreaterThan(trap);
    expect(sign.run).toContain("set -euo pipefail");
  });

  test("keeps the signed bundle, for the first upload by hand and for a look after a failure", () => {
    expect(keep.uses).toBe("actions/upload-artifact@v4");
    expect(keep.with).toEqual(
      expect.objectContaining({
        name: "android-agent-google-play-bundle",
        path: "${{ runner.temp }}/android-agent-google-play/oneuptime-android-agent.aab",
        "if-no-files-found": "error",
        overwrite: true,
      }),
    );
    expect(steps.indexOf(keep)).toBeGreaterThan(steps.indexOf(sign));
    expect(steps.indexOf(keep)).toBeLessThan(steps.indexOf(publish));
  });

  test("uploads that bundle as it is, and the store listing, with the service account from its own secret", () => {
    expect(publish["working-directory"]).toBe(AGENT);
    expect(publish.env).toEqual({
      AGENT_VERSION: "${{ needs.read-version.outputs.major_minor }}",
      ANDROID_PUBLISHER_CREDENTIALS: `\${{ secrets.${SERVICE_ACCOUNT_SECRET} }}`,
    });
    const command = publish.run.replace(/\\\n\s*/g, " ");
    expect(command).toContain(
      'publishReleaseBundle --artifact-dir "$RUNNER_TEMP/android-agent-google-play"',
    );
    expect(command).toContain("publishReleaseListing");
    expect(command).toContain('-PagentVersion="$AGENT_VERSION"');
    // Never a bundle of its own: the one signed with the upload key.
    expect(command).not.toMatch(/\bbundleRelease\b/);
    expect(steps.indexOf(publish)).toBe(steps.length - 1);
  });

  /*
   * No echo or printf of a variable that holds a secret. The one printf of
   * one pipes the keystore's base64 into base64 --decode, and a file, and
   * prints nothing.
   */
  test("never prints a secret", () => {
    const decodesTheKeystore =
      /printf '%s' "\$ANDROID_AGENT_UPLOAD_KEYSTORE_BASE64" \| base64 --decode > /;
    const printsASecret =
      /\b(echo|printf)\b[^\n|]*\$\{?(ANDROID_AGENT_UPLOAD_KEY|ANDROID_AGENT_GOOGLE_PLAY|ANDROID_PUBLISHER_CREDENTIALS)/;

    expect(printsASecret.test('echo "$ANDROID_PUBLISHER_CREDENTIALS"')).toBe(
      true,
    );
    expect(sign.run).toMatch(decodesTheKeystore);
    for (const step of steps) {
      const run = (step.run || "").replace(decodesTheKeystore, "");
      expect({
        step: step.name || step.uses,
        prints: printsASecret.test(run),
      }).toEqual({ step: step.name || step.uses, prints: false });
    }
  });

  test("is the only job that reads the upload key or the Play service account", () => {
    for (const [other, definition] of Object.entries(jobs)) {
      if (other === GOOGLE_PLAY_JOB) {
        continue;
      }
      for (const secret of GOOGLE_PLAY_SECRETS) {
        expect({
          other,
          secret,
          reads: JSON.stringify(definition).includes(secret),
        }).toEqual({ other, secret, reads: false });
      }
    }
  });
});

/*
 * What Gradle Play Publisher does with the bundle (app/build.gradle.kts): a
 * draft on the internal track that a maintainer rolls out, a version Play
 * already has skipped, and the credentials only ever from the environment.
 */
describe("agents/AndroidAgent: Google Play", () => {
  const build = read(`${AGENT}/app/build.gradle.kts`);
  const catalog = read(`${AGENT}/gradle/libs.versions.toml`);

  test("applies Gradle Play Publisher at a version pinned in the catalog", () => {
    expect(build).toContain("alias(libs.plugins.play.publisher)");
    expect(catalog).toMatch(
      /^play-publisher = \{ id = "com\.github\.triplet\.play", version\.ref = "playPublisher" \}$/m,
    );
    // An exact version: no range, no "+", no "latest".
    expect(catalog).toMatch(/^playPublisher = "\d+\.\d+\.\d+"$/m);
  });

  test("publishes a draft on the internal track, and skips a version Play already has", () => {
    expect(build).toContain('track.set("internal")');
    expect(build).toContain("releaseStatus.set(ReleaseStatus.DRAFT)");
    expect(build).toContain(
      "resolutionStrategy.set(ResolutionStrategy.IGNORE)",
    );
    expect(build).toContain("defaultToAppBundles.set(true)");
  });

  test("names no credentials and no signing key: the service account comes from the environment, and the scripts sign", () => {
    expect(build).not.toMatch(/\bserviceAccountCredentials\b\s*(\.set|=)/);
    expect(build).not.toMatch(
      /\buseApplicationDefaultCredentials\b\s*(\.set|=)/,
    );
    expect(build).not.toMatch(/\bsigningConfig\s*=/);
    expect(build).not.toMatch(/\bsigningConfigs\s*\{/);
  });

  test("keeps the store listing where Gradle Play Publisher reads it", () => {
    for (const file of [
      "default-language.txt",
      "listings/en-US/title.txt",
      "listings/en-US/short-description.txt",
      "listings/en-US/full-description.txt",
      "listings/en-US/graphics/icon/1.png",
      "listings/en-US/graphics/feature-graphic/1.png",
      "release-notes/en-US/default.txt",
    ]) {
      expect({
        file,
        exists: fs.existsSync(
          path.join(REPO_ROOT, AGENT, "app/src/main/play", file),
        ),
      }).toEqual({ file, exists: true });
    }
  });

  test("keeps no key, keystore or service account key in the repository", () => {
    const tracked = spawnSync("git", ["ls-files", "--", AGENT], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    expect(tracked.status).toBe(0);
    const files = tracked.stdout.split("\n").filter(Boolean);
    expect(files.length).toBeGreaterThan(10);
    expect(
      files.filter((file) => {
        return /\.(jks|keystore|p12|pem|pepk|zip)$/i.test(file);
      }),
    ).toEqual([]);
    for (const file of files.filter((candidate) => {
      return /\.(json|txt|properties|kts|toml|sh)$/.test(candidate);
    })) {
      const text = read(file);
      expect({ file, privateKey: text.includes("PRIVATE KEY") }).toEqual({
        file,
        privateKey: false,
      });
      expect({
        file,
        serviceAccount: text.includes('"type": "service_account"'),
      }).toEqual({ file, serviceAccount: false });
    }
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

/*
 * sign-bundle.sh, run against stand-ins on PATH: jarsigner "signs" by
 * copying and recording its arguments, and "verifies" by printing the report
 * a test sets; keytool prints a certificate's fingerprints.
 */
describe("scripts/sign-bundle.sh", () => {
  let work;
  let bin;
  let environment;

  function standIn(name, body) {
    const file = path.join(bin, name);
    fs.writeFileSync(file, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`);
    fs.chmodSync(file, 0o755);
  }

  beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), "android-agent-sign-bundle-"));
    bin = path.join(work, "bin");
    fs.mkdirSync(bin);
    standIn(
      "jarsigner",
      [
        'if [ "$1" = "-verify" ]; then',
        '  printf "%s\\n" "$FAKE_VERIFY_REPORT"',
        '  exit "${FAKE_VERIFY_STATUS:-0}"',
        "fi",
        'echo "$@" > "$CALLS"',
        'if [ -n "${FAKE_SIGN_ERROR:-}" ]; then echo "$FAKE_SIGN_ERROR"; exit 1; fi',
        'out=""; prev=""',
        'for arg in "$@"; do if [ "$prev" = "-signedjar" ]; then out=$arg; fi; prev=$arg; done',
        'cp "${@: -2:1}" "$out"',
        'echo "jar signed."',
      ].join("\n"),
    );
    standIn(
      "keytool",
      [
        'printf "Signer #1:\\n\\nCertificate fingerprints:\\n"',
        'printf "\\t SHA1: 01:02\\n\\t SHA256: AB:CD:EF\\n"',
      ].join("\n"),
    );
    fs.writeFileSync(path.join(work, "unsigned.aab"), "aab");
    fs.writeFileSync(path.join(work, "upload.jks"), "keystore");
    environment = {
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      ANDROID_AGENT_UPLOAD_KEYSTORE_FILE: path.join(work, "upload.jks"),
      ANDROID_AGENT_UPLOAD_KEYSTORE_PASSWORD: "store-secret",
      ANDROID_AGENT_UPLOAD_KEY_ALIAS: "upload",
      ANDROID_AGENT_UPLOAD_KEY_PASSWORD: "key-secret",
      CALLS: path.join(work, "calls.txt"),
      FAKE_VERIFY_REPORT: "jar verified.",
    };
  });

  afterEach(() => {
    fs.rmSync(work, { recursive: true, force: true });
  });

  function signBundle(env = environment, unsigned = "unsigned.aab") {
    return spawnSync(
      "bash",
      [
        path.join(REPO_ROOT, SIGN_BUNDLE),
        path.join(work, unsigned),
        path.join(work, "signed.aab"),
      ],
      { env, encoding: "utf8" },
    );
  }

  test("is executable, as release.yml runs it", () => {
    expect(
      fs.statSync(path.join(REPO_ROOT, SIGN_BUNDLE)).mode & 0o111,
    ).not.toBe(0);
  });

  test("signs with the upload key, SHA-256 with RSA, never putting a password on the command line, and prints the certificate", () => {
    const run = signBundle();

    expect(run.status).toBe(0);
    expect(fs.existsSync(path.join(work, "signed.aab"))).toBe(true);
    const call = fs.readFileSync(path.join(work, "calls.txt"), "utf8").trim();
    for (const flag of [
      `-keystore ${path.join(work, "upload.jks")}`,
      "-storepass:env ANDROID_AGENT_UPLOAD_KEYSTORE_PASSWORD",
      "-keypass:env ANDROID_AGENT_UPLOAD_KEY_PASSWORD",
      "-sigalg SHA256withRSA",
      "-digestalg SHA-256",
      `-signedjar ${path.join(work, "signed.aab")}`,
    ]) {
      expect(call).toContain(flag);
    }
    // The bundle, then the key's alias, last, as jarsigner takes them.
    expect(call.endsWith(`${path.join(work, "unsigned.aab")} upload`)).toBe(
      true,
    );
    expect(call).not.toContain("store-secret");
    expect(call).not.toContain("key-secret");
    expect(run.stdout).toContain("Signed");
    expect(run.stdout).toContain("Upload certificate SHA256: AB:CD:EF");
  });

  test("says why jarsigner could not sign, such as a wrong password", () => {
    environment.FAKE_SIGN_ERROR =
      "jarsigner error: java.lang.RuntimeException: keystore load: keystore password was incorrect";

    const run = signBundle();

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("jarsigner could not sign");
    expect(run.stderr).toContain("keystore password was incorrect");
  });

  test("refuses a bundle that does not verify", () => {
    environment.FAKE_VERIFY_REPORT =
      "jarsigner: java.lang.SecurityException: invalid SHA-256 signature file digest";
    environment.FAKE_VERIFY_STATUS = "1";

    const run = signBundle();

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("does not verify");
  });

  test("refuses a bundle that is only signed in part, which jarsigner verifies with a warning", () => {
    environment.FAKE_VERIFY_REPORT = [
      "jar verified.",
      "",
      "Warning: ",
      "This jar contains unsigned entries which have not been integrity-checked. ",
    ].join("\n");

    const run = signBundle();

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("is not signed in full");
  });

  test("refuses a bundle jarsigner does not call verified", () => {
    environment.FAKE_VERIFY_REPORT = "jar is unsigned.";

    const run = signBundle();

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("is not signed in full");
  });

  test.each([
    "ANDROID_AGENT_UPLOAD_KEYSTORE_FILE",
    "ANDROID_AGENT_UPLOAD_KEYSTORE_PASSWORD",
    "ANDROID_AGENT_UPLOAD_KEY_ALIAS",
    "ANDROID_AGENT_UPLOAD_KEY_PASSWORD",
  ])("says which setting is missing: %s", (name) => {
    const env = { ...environment };
    delete env[name];

    const run = signBundle(env);

    expect(run.status).toBe(1);
    expect(run.stderr).toContain(`${name} is not set.`);
    expect(fs.existsSync(path.join(work, "calls.txt"))).toBe(false);
  });

  test("says when there is no bundle, or no keystore, before signing anything", () => {
    const noBundle = signBundle(environment, "missing.aab");
    expect(noBundle.status).toBe(1);
    expect(noBundle.stderr).toContain("No bundle at");

    const noKeystore = signBundle({
      ...environment,
      ANDROID_AGENT_UPLOAD_KEYSTORE_FILE: path.join(work, "missing.jks"),
    });
    expect(noKeystore.status).toBe(1);
    expect(noKeystore.stderr).toContain(
      "No keystore at ANDROID_AGENT_UPLOAD_KEYSTORE_FILE.",
    );
    expect(fs.existsSync(path.join(work, "calls.txt"))).toBe(false);
  });
});

/*
 * sign-bundle.sh with the JDK's own jarsigner and keytool, where they are on
 * PATH (GitHub's runners have a JDK): a throwaway key signs a small bundle,
 * which jarsigner then verifies, with the certificate the key's. Without a
 * JDK this is skipped, saying so; the stand-ins above still run.
 */
describe("scripts/sign-bundle.sh with the JDK's tools", () => {
  const hasJdk = ["jarsigner", "keytool", "jar"].every((tool) => {
    const probe = spawnSync(tool, ["--help"], { encoding: "utf8" });
    return !probe.error;
  });

  if (!hasJdk) {
    test.skip("needs jarsigner, keytool and jar on PATH", () => {});
    return;
  }

  let work;

  beforeAll(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), "android-agent-jdk-sign-"));
  });

  afterAll(() => {
    fs.rmSync(work, { recursive: true, force: true });
  });

  function tool(name, args, options = {}) {
    const result = spawnSync(name, args, {
      encoding: "utf8",
      timeout: 120000,
      ...options,
    });
    if (result.error) {
      throw result.error;
    }
    return result;
  }

  test("signs a bundle that jarsigner verifies, with the upload key's certificate", () => {
    // keytool makes a PKCS12 keystore, whose key has the keystore's
    // password: RELEASING.md has both secrets set to the one password.
    const keystore = path.join(work, "upload.jks");
    const created = tool("keytool", [
      "-genkeypair",
      "-keystore",
      keystore,
      "-storepass",
      "throwaway",
      "-alias",
      "upload",
      "-keyalg",
      "RSA",
      "-keysize",
      "2048",
      "-validity",
      "1",
      "-dname",
      "CN=Throwaway upload key",
    ]);
    expect(created.status).toBe(0);

    const content = path.join(work, "content");
    fs.mkdirSync(path.join(content, "base", "manifest"), { recursive: true });
    fs.writeFileSync(
      path.join(content, "base", "manifest", "AndroidManifest.xml"),
      "manifest",
    );
    fs.writeFileSync(path.join(content, "BundleConfig.pb"), "config");
    const unsigned = path.join(work, "unsigned.aab");
    expect(
      tool("jar", ["--create", "--file", unsigned, "-C", content, "."]).status,
    ).toBe(0);

    const signed = path.join(work, "signed.aab");
    const run = tool(
      "bash",
      [path.join(REPO_ROOT, SIGN_BUNDLE), unsigned, signed],
      {
        env: {
          PATH: process.env.PATH,
          ANDROID_AGENT_UPLOAD_KEYSTORE_FILE: keystore,
          ANDROID_AGENT_UPLOAD_KEYSTORE_PASSWORD: "throwaway",
          ANDROID_AGENT_UPLOAD_KEY_ALIAS: "upload",
          ANDROID_AGENT_UPLOAD_KEY_PASSWORD: "throwaway",
        },
      },
    );
    expect({ status: run.status, stderr: run.stderr }).toEqual({
      status: 0,
      stderr: "",
    });

    expect(tool("jarsigner", ["-verify", signed]).stdout).toMatch(
      /^jar verified\.$/m,
    );
    const listed = tool("keytool", [
      "-list",
      "-v",
      "-keystore",
      keystore,
      "-storepass",
      "throwaway",
      "-alias",
      "upload",
    ]).stdout;
    const fingerprint = /SHA256: ([0-9A-F:]+)/.exec(listed)[1];
    expect(run.stdout).toContain(`Upload certificate SHA256: ${fingerprint}`);
  });
});
