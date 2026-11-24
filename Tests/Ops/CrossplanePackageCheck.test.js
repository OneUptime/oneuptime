"use strict";

/**
 * The Crossplane provider's packages are checked before they are published
 * (#6617).
 *
 * Every release builds provider-oneuptime for linux/amd64 and linux/arm64
 * (Scripts/CrossplaneProvider/build-package.sh) and publishes both, but the
 * end-to-end test installs the amd64 package only: an arm64 package that
 * embedded the amd64 runtime image, or a binary built for another
 * architecture, would have been published unnoticed, and the provider's pod
 * would crash on every arm64 node ("exec format error").
 * Scripts/CrossplaneProvider/check-package.sh reads each package - its image
 * config's platform, its entrypoint binary's ELF header, its package.yaml -
 * and with --run starts the binary under that platform.
 *
 * This drives the script with packages made here, one break at a time, and
 * holds the workflows to running it: the release before anything is pushed
 * (with QEMU, for the arm64 binary), the end-to-end job on its own
 * platform's package, and the nightly run on an arm64 runner too, while
 * pull requests stay on amd64 alone.
 */

const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const yaml = require("js-yaml");

const { stepCommand } = require("./Utils/WorkflowStep");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CHECK = path.join(
  REPO_ROOT,
  "Scripts",
  "CrossplaneProvider",
  "check-package.sh",
);
const RELEASE = ".github/workflows/release.yml";
const CROSSPLANE = ".github/workflows/crossplane-provider.yml";
const TOOLS_ACTION = ".github/actions/setup-crossplane-tools/action.yml";

// ELF e_machine values the script knows.
const MACHINES = { amd64: 0x3e, arm64: 0xb7, riscv64: 0xf3 };

function readYaml(relativePath) {
  return yaml.load(fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8"));
}

// The first 64 bytes of a static ELF executable for `arch`.
function elfHeader(arch) {
  const header = Buffer.alloc(64);
  header.write("\x7fELF", 0, "latin1");
  header[4] = 2; // 64-bit
  header[5] = 1; // little endian
  header[6] = 1; // version
  header.writeUInt16LE(2, 16); // an executable
  header.writeUInt16LE(MACHINES[arch], 18);
  return header;
}

function tar(args, cwd) {
  childProcess.execFileSync("tar", args, { cwd });
}

/*
 * A package as build-package.sh writes one: a docker-loadable tarball of
 * the runtime image with a package.yaml layer. Each option breaks one thing.
 */
function writePackage(directory, arch, options = {}) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "xpkg-"));
  const layers = [];

  // The runtime image's layer: the provider binary.
  const binaryLayer = path.join(work, "binary");
  fs.mkdirSync(path.join(binaryLayer, "usr", "local", "bin"), {
    recursive: true,
  });
  if (!options.noBinary) {
    fs.writeFileSync(
      path.join(binaryLayer, "usr", "local", "bin", "provider"),
      options.notElf
        ? Buffer.from("#!/bin/sh\necho not a binary\n")
        : elfHeader(options.binaryArch || arch),
    );
  }
  tar(["czf", path.join(work, "binary.tar.gz"), "-C", binaryLayer, "."], work);
  layers.push("binary.tar.gz");

  // The package's layer, which Crossplane reads.
  const packageLayer = path.join(work, "package");
  fs.mkdirSync(packageLayer);
  if (!options.noPackageYaml) {
    fs.writeFileSync(
      path.join(packageLayer, "package.yaml"),
      "apiVersion: meta.pkg.crossplane.io/v1\nkind: Provider\n",
    );
  } else {
    fs.writeFileSync(path.join(packageLayer, "README"), "nothing\n");
  }
  tar(
    ["czf", path.join(work, "package.tar.gz"), "-C", packageLayer, "."],
    work,
  );
  layers.push("package.tar.gz");

  fs.writeFileSync(
    path.join(work, "config.json"),
    JSON.stringify({
      architecture: options.imageArch || arch,
      os: options.imageOs || "linux",
      config: {
        Entrypoint: [options.entrypoint || "/usr/local/bin/provider"],
      },
    }),
  );
  fs.writeFileSync(
    path.join(work, "manifest.json"),
    JSON.stringify([{ Config: "config.json", RepoTags: null, Layers: layers }]),
  );

  tar(
    [
      "cf",
      path.join(directory, `provider-oneuptime-${arch}.xpkg`),
      "manifest.json",
      "config.json",
      ...layers,
    ],
    work,
  );
  fs.rmSync(work, { recursive: true, force: true });
}

function check(directory, platforms = "linux/amd64,linux/arm64") {
  return childProcess.spawnSync(
    "bash",
    [CHECK, "--input", directory, "--platforms", platforms],
    { encoding: "utf8" },
  );
}

function packagesWith(armOptions) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "packages-"));
  writePackage(directory, "amd64");
  if (armOptions !== null) {
    writePackage(directory, "arm64", armOptions);
  }
  return directory;
}

describe("check-package.sh", () => {
  test("passes both platforms' packages as build-package.sh makes them", () => {
    const result = check(packagesWith({}));

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("image linux/amd64, binary amd64");
    expect(result.stdout).toContain("image linux/arm64, binary arm64");
  });

  test.each([
    [
      "the amd64 runtime image embedded in the arm64 package",
      { imageArch: "amd64", binaryArch: "amd64" },
      "embeds a linux/amd64 runtime image, not linux/arm64",
    ],
    [
      "an arm64 image around an amd64 binary",
      { binaryArch: "amd64" },
      "is built for amd64, not arm64",
    ],
    [
      "a binary for an architecture it does not know",
      { binaryArch: "riscv64" },
      "is built for e_machine-0xf3, not arm64",
    ],
    [
      "an image for another operating system",
      { imageOs: "windows" },
      "embeds a windows/arm64 runtime image, not linux/arm64",
    ],
    ["no provider binary", { noBinary: true }, "no layer holds"],
    [
      "a binary that is no ELF executable",
      { notElf: true },
      "not an ELF executable",
    ],
    ["another entrypoint", { entrypoint: "/bin/sh" }, "its entrypoint is"],
    ["no package.yaml", { noPackageYaml: true }, "holds no package.yaml"],
  ])("fails %s", (_name, options, message) => {
    const result = check(packagesWith(options));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("linux/arm64");
    expect(result.stderr).toContain(message);
    // The amd64 package is still checked, and passes.
    expect(result.stdout).toContain("image linux/amd64, binary amd64");
  });

  test("fails a platform whose package is missing", () => {
    const result = check(packagesWith(null));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("provider-oneuptime-arm64.xpkg is missing");
  });

  test("fails a file that is no image tarball", () => {
    const directory = packagesWith({});
    fs.writeFileSync(
      path.join(directory, "provider-oneuptime-arm64.xpkg"),
      "not a tarball",
    );
    const result = check(directory);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("not an image tarball");
  });

  test("checks only the platforms it is given", () => {
    const result = check(packagesWith(null), "linux/amd64");

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("arm64");
  });

  test("refuses an option it does not know", () => {
    const result = childProcess.spawnSync("bash", [CHECK, "--sign"], {
      encoding: "utf8",
    });

    expect(result.status).toBe(2);
  });
});

function stepIndex(steps, matches) {
  return steps.findIndex((step) => {
    return matches(step);
  });
}

function runs(text) {
  return (step) => {
    return stepCommand(step).includes(text);
  };
}

function usesAction(name) {
  return (step) => {
    return typeof step.uses === "string" && step.uses.startsWith(`${name}@`);
  };
}

describe("the release checks both packages before it publishes them", () => {
  const job = readYaml(RELEASE).jobs["publish-crossplane-provider"];
  const steps = job.steps;

  test("after building them, with QEMU for the binary of the other platform", () => {
    const build = stepIndex(steps, runs("build-package.sh"));
    const qemu = stepIndex(steps, usesAction("docker/setup-qemu-action"));
    const checkStep = stepIndex(steps, runs("check-package.sh"));

    expect(build).toBeGreaterThan(-1);
    expect(qemu).toBeGreaterThan(build);
    expect(checkStep).toBeGreaterThan(qemu);
    // Every platform the build makes is checked, and started.
    expect(stepCommand(steps[build])).not.toContain("--platforms");
    expect(stepCommand(steps[checkStep])).not.toContain("--platforms");
    expect(stepCommand(steps[checkStep])).toContain("--run");
    expect(steps[qemu].with.platforms).toBe("arm64");
  });

  test("before anything is pushed or signed", () => {
    const checkStep = stepIndex(steps, runs("check-package.sh"));
    const publish = stepIndex(steps, runs("publish-package.sh"));
    const cosign = stepIndex(steps, usesAction("sigstore/cosign-installer"));

    expect(publish).toBeGreaterThan(checkStep);
    expect(cosign).toBeGreaterThan(checkStep);
  });

  test("pins QEMU's action by commit and its image by version", () => {
    const qemu =
      steps[stepIndex(steps, usesAction("docker/setup-qemu-action"))];

    expect(qemu.uses).toMatch(/^docker\/setup-qemu-action@[0-9a-f]{40}$/);
    expect(qemu.with.image).toMatch(
      /^docker\.io\/tonistiigi\/binfmt:qemu-v\d+\.\d+\.\d+$/,
    );
  });
});

describe("the end-to-end job tests each platform's package on its own runner", () => {
  const workflow = readYaml(CROSSPLANE);
  const job = workflow.jobs["crossplane-e2e"];
  const steps = job.steps;
  const raw = fs.readFileSync(path.join(REPO_ROOT, CROSSPLANE), "utf8");

  test("builds, checks and runs only the platform of its runner", () => {
    const build = steps[stepIndex(steps, runs("build-package.sh"))];
    const checkStep = stepIndex(steps, runs("check-package.sh"));

    expect(stepCommand(build)).toContain(
      "--platforms linux/${{ matrix.arch }}",
    );
    expect(checkStep).toBeGreaterThan(
      stepIndex(steps, runs("build-package.sh")),
    );
    expect(stepCommand(steps[checkStep])).toContain(
      "--platforms linux/${{ matrix.arch }} --run",
    );
  });

  test("on an arm64 runner only in the nightly run, so pull requests stay fast", () => {
    expect(job["runs-on"]).toBe("${{ matrix.runner }}");
    const include = job.strategy.matrix.include;

    // One expression picks the legs, by the event.
    expect(include).toContain("github.event_name == 'schedule'");
    const [nightly, other] = include.match(/'(\[[^']+\])'/g).map((quoted) => {
      return JSON.parse(quoted.slice(1, -1));
    });

    expect(nightly).toEqual([
      { arch: "amd64", runner: "ubuntu-latest" },
      { arch: "arm64", runner: "ubuntu-24.04-arm" },
    ]);
    expect(other).toEqual([{ arch: "amd64", runner: "ubuntu-latest" }]);
    expect(job.strategy["fail-fast"]).toBe(false);
  });

  test("keeps the amd64 leg's name, the check pull requests wait on", () => {
    expect(job.name).toBe(
      "Crossplane provider${{ matrix.arch == 'arm64' && ' on arm64' || '' }}",
    );
    expect(raw).toContain("--platforms linux/${{ matrix.arch }}");
  });

  test("installs kubectl for the runner's own architecture when it is missing", () => {
    const install = steps[stepIndex(steps, runs("command -v kubectl"))];

    expect(stepCommand(install)).not.toContain("linux/amd64/kubectl");
    expect(stepCommand(install)).toContain("bin/linux/${arch}/kubectl");
  });
});

describe("setup-crossplane-tools pins both architectures", () => {
  const action = readYaml(TOOLS_ACTION);
  const pin = action.runs.steps.find((step) => {
    return step.id === "pin";
  });

  test("a crossplane CLI and a kind for amd64 and arm64, each by its digest", () => {
    // Each runner's branch of the case sets its architecture and both digests.
    const branches = pin.run.split(";;");

    for (const [runner, arch] of [
      ["Linux/X64", "amd64"],
      ["Linux/ARM64", "arm64"],
    ]) {
      const branch = branches.find((text) => {
        return text.includes(`${runner})`);
      });

      expect(branch).toContain(`arch="${arch}"`);
      expect(branch).toMatch(/crossplane_sha256="[0-9a-f]{64}"/);
      expect(branch).toMatch(/kind_sha256="[0-9a-f]{64}"/);
    }
    // Not one digest for both.
    expect(new Set(pin.run.match(/[0-9a-f]{64}/g)).size).toBe(4);
    // Unknown runners fail, rather than download an unpinned binary.
    expect(pin.run).toContain("No pinned Crossplane tools");
  });

  test("caches each architecture's tools under a key of its own", () => {
    const restore = action.runs.steps.find((step) => {
      return step.id === "cache";
    });

    expect(restore.with.key).toContain("${{ steps.pin.outputs.platform }}");
  });

  test("downloads the binary of the runner's architecture", () => {
    const fetch = action.runs.steps.find((step) => {
      return String(step.run || "").includes("fetch_pinned_artifact.sh");
    });

    expect(fetch.run).toContain("bin/${PLATFORM_UNDERSCORE}/crossplane");
    expect(fetch.run).toContain("kind-${PLATFORM_HYPHEN}");
    expect(fetch.run).not.toContain("linux_amd64");
    expect(fetch.run).not.toContain("kind-linux-amd64");
  });
});
