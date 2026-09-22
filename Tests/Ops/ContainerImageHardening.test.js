"use strict";

/**
 * What keeps OneUptime's container images free of the dependency
 * vulnerabilities scanners reported in September 2026, pinned for every
 * Dockerfile.tpl in the repository.
 *
 * Scanned then (trivy and grype, the published `release` tags), almost none of
 * the findings came from our own dependencies - `npm audit` over every lockfile
 * was clean. They came from what the images carry around them:
 *
 *  - npm's bundled dependencies (tar, undici, brace-expansion, ip-address),
 *    nine CVEs in every Node image. Every Node image now runs
 *    Scripts/Docker/UpdateNpmCli.js, before any install, in the stage that
 *    ships (UpdateNpmCli.test.js covers the script itself).
 *  - The full Debian node images (buildpack-deps) under the Runner and E2E:
 *    compilers, kernel headers and ~70 -dev libraries, thousands of CVEs.
 *    No image may start FROM a full Debian node image.
 *  - Build toolchains left in production images: linux-libc-dev alone was
 *    ~1,900 CVEs in the Probe. A production image that installs a compiler
 *    must remove it after the last step that needs it.
 *  - Unused software: nginx modules nothing loads (tiff via libgd), a second
 *    set of Playwright browsers plus WebKit's libraries in E2E, an aedes
 *    example whose package.json is named like a malware package.
 *  - A stale collector pin in the Docker and Podman agents.
 *
 * Every check here reads the templates the way they are rendered for a real
 * build (DockerfileTemplate.render, both environments), and comments and
 * continuation lines are folded first (instructions()), so a check can never
 * be satisfied by prose.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const {
  render,
  parseStages,
  ancestry,
  instructions,
  findTemplates,
} = require("./Utils/DockerfileTemplate");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

const TEMPLATES = findTemplates(REPO_ROOT);
const ENVIRONMENTS = ["production", "development"];

function renderTemplate(template, environment) {
  return render(read(template), environment, {
    fileExists: (relativePath) => {
      return fs.existsSync(path.join(REPO_ROOT, relativePath));
    },
  });
}

/** Every stage of a rendered template, with its instructions. */
function stagesOf(template, environment) {
  return parseStages(renderTemplate(template, environment)).map((stage) => {
    return { ...stage, instructions: instructions(stage.body) };
  });
}

/**
 * The stages a build of this template ships: the last stage, and for the App
 * its two edition targets. Each is returned with its ancestry, nearest first.
 */
function shippedStages(stages) {
  const targets = stages.filter((stage) => {
    return stage.name === "community" || stage.name === "enterprise";
  });
  const finals = targets.length > 0 ? targets : [stages[stages.length - 1]];
  return finals.map((stage) => {
    return stage.name ? ancestry(stages, stage.name) : [stage];
  });
}

const NODE_IMAGE = /(^|\/)node:/;

// A stage that has Node: FROM a node image, or a copy of the node binary and
// global node_modules out of one (the Nginx image).
function stageHasNode(stage, stages) {
  if (NODE_IMAGE.test(stage.from)) {
    return true;
  }
  const parent = stages.find((candidate) => {
    return candidate.name === stage.from;
  });
  if (parent && stageHasNode(parent, stages)) {
    return true;
  }
  return stage.instructions.some((line) => {
    return /^COPY --from=\S+ \/usr\/local\/lib\/node_modules /.test(line);
  });
}

function nodeTemplates() {
  return TEMPLATES.filter((template) => {
    const stages = stagesOf(template, "production");
    return shippedStages(stages).some((chain) => {
      return stageHasNode(chain[0], stages);
    });
  });
}

const UPDATE_COPY =
  "COPY ./Scripts/Docker/UpdateNpmCli.js /tmp/UpdateNpmCli.js";
const UPDATE_RUN = "RUN node /tmp/UpdateNpmCli.js && rm /tmp/UpdateNpmCli.js";
// Anything that installs packages with npm (or runs a package bin through
// npx) - the npm doing that must already be the updated one.
const NPM_INSTALLS = /\bnpm (ci|install|i|update|rebuild)\b|(^|[\s;&|])npx\s/;
// `npm install -g npm@...`, in any spelling: the bundled snapshot install.
const NPM_SELF_INSTALL =
  /\bnpm\s+(install|i|update|up)\b[^&|;]*\s(-g|--global)\b[^&|;]*\bnpm(@\S*)?(\s|$)/;

describe("which templates build Node images", () => {
  test("detection finds exactly the Node images the repository builds", () => {
    // If this fails because an image was added or removed, update the list:
    // it exists so a detection bug cannot make every check below vacuous.
    expect(nodeTemplates()).toEqual([
      "Tests/Dockerfile.tpl",
      "agents/KubernetesCostAgent/Dockerfile.tpl",
      "agents/KubernetesLogTailer/Dockerfile.tpl",
      "packages/App/Dockerfile.tpl",
      "packages/E2E/Dockerfile.tpl",
      "packages/Home/Dockerfile.tpl",
      "packages/Nginx/Dockerfile.tpl",
      "packages/Probe/Dockerfile.tpl",
      "packages/Runner/Dockerfile.tpl",
      "packages/TestServer/Dockerfile.tpl",
    ]);
  });

  test("and the collector-based agent images are not among them", () => {
    for (const template of [
      "agents/DockerAgent/Dockerfile.tpl",
      "agents/PodmanAgent/Dockerfile.tpl",
    ]) {
      expect(TEMPLATES).toContain(template);
      expect(nodeTemplates()).not.toContain(template);
    }
  });
});

describe("every Node image updates npm with Scripts/Docker/UpdateNpmCli.js", () => {
  const cases = [];
  for (const template of nodeTemplates()) {
    for (const environment of ENVIRONMENTS) {
      cases.push([template, environment]);
    }
  }

  test.each(cases)(
    "%s (%s): never installs npm's bundled snapshot with npm install -g npm",
    (template, environment) => {
      for (const stage of stagesOf(template, environment)) {
        const offenders = stage.instructions.filter((line) => {
          return NPM_SELF_INSTALL.test(line);
        });
        expect({ stage: stage.name, offenders }).toEqual({
          stage: stage.name,
          offenders: [],
        });
      }
    },
  );

  test.each(cases)(
    "%s (%s): the stage that ships runs the update, before anything it installs",
    (template, environment) => {
      const stages = stagesOf(template, environment);

      for (const chain of shippedStages(stages)) {
        // The oldest stage of the chain that has npm is where the update must
        // be: every stage built from it inherits the updated npm, and no stage
        // before it has an npm to install anything with.
        const withNode = [...chain].reverse().find((stage) => {
          return stageHasNode(stage, stages);
        });
        expect(withNode).toBeDefined();

        const lines = withNode.instructions;
        const copyIndex = lines.indexOf(UPDATE_COPY);
        const runIndex = lines.indexOf(UPDATE_RUN);
        expect({ copyIndex: copyIndex >= 0, runIndex }).toEqual({
          copyIndex: true,
          runIndex: copyIndex + 1,
        });
        expect(
          lines.filter((line) => {
            return line === UPDATE_RUN;
          }),
        ).toHaveLength(1);

        // Nothing is installed with npm before the update.
        const firstInstall = lines.findIndex((line) => {
          return line !== UPDATE_RUN && NPM_INSTALLS.test(line);
        });
        if (firstInstall !== -1) {
          expect(firstInstall).toBeGreaterThan(runIndex);
        }
        const nodeCopy = lines.findIndex((line) => {
          return /^COPY --from=\S+ \/usr\/local\/lib\/node_modules /.test(line);
        });
        if (nodeCopy !== -1) {
          // A copied-in npm (Nginx) is updated after it arrives.
          expect(runIndex).toBeGreaterThan(nodeCopy);
        }
      }
    },
  );

  test("the COPY source exists and is the script UpdateNpmCli.test.js covers", () => {
    const script = path.join(REPO_ROOT, "Scripts", "Docker", "UpdateNpmCli.js");
    expect(fs.existsSync(script)).toBe(true);
    expect(typeof require(script).updateNpmCli).toBe("function");
  });
});

/*
 * .dockerignore semantics for plain (glob-free) patterns: a pattern matches a
 * path or any of its parent directories, `!` re-includes, and the last
 * matching line wins. Enough for the lines that decide the script's fate; the
 * real Docker check is in UpdateNpmCli.test.js.
 */
function dockerignored(relativePath) {
  let ignored = false;
  for (const raw of read(".dockerignore").split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    const negated = line.startsWith("!");
    const pattern = (negated ? line.slice(1) : line).replace(/^\/+|\/+$/g, "");
    if (/[*?[]/.test(pattern)) {
      continue;
    }
    const matches =
      relativePath === pattern || relativePath.startsWith(`${pattern}/`);
    if (matches) {
      ignored = !negated;
    }
  }
  return ignored;
}

describe(".dockerignore", () => {
  test("lets the npm update script into every build context", () => {
    expect(dockerignored("Scripts/Docker/UpdateNpmCli.js")).toBe(false);
  });

  test("still keeps the rest of Scripts/ out of it", () => {
    expect(dockerignored("Scripts/Security/ValidateNpmAudit.js")).toBe(true);
    expect(dockerignored("Scripts/Docker/Other.js")).toBe(true);
    expect(dockerignored("Scripts")).toBe(true);
  });
});

// node:<version>[-<variant>] - only these variants are allowed.
const ALLOWED_NODE_VARIANT = /^node:[\d.]+-(alpine[\d.]*|slim|[a-z]+-slim)$/;

describe("no image starts FROM a full Debian node image", () => {
  const froms = [];
  for (const template of TEMPLATES) {
    for (const environment of ENVIRONMENTS) {
      for (const stage of stagesOf(template, environment)) {
        if (NODE_IMAGE.test(stage.from)) {
          froms.push([template, environment, stage.from]);
        }
      }
    }
  }

  test("there are node base images to check", () => {
    expect(froms.length).toBeGreaterThan(10);
  });

  test.each(froms)("%s (%s): %s is alpine or slim", (template, env, from) => {
    const image = from.split("/").pop();
    expect(image).toMatch(ALLOWED_NODE_VARIANT);
  });

  test("the pattern rejects the full images this replaced", () => {
    for (const full of ["node:26", "node:26-bookworm", "node:26-trixie"]) {
      expect(full).not.toMatch(ALLOWED_NODE_VARIANT);
    }
    for (const slim of [
      "node:26-alpine3.24",
      "node:26-bookworm-slim",
      "node:26-trixie-slim",
      "node:26-slim",
    ]) {
      expect(slim).toMatch(ALLOWED_NODE_VARIANT);
    }
  });
});

// apt-get install / apk add lines, and what they install.
function installedPackagesIn(line) {
  const apt = /\bapt-get install\b([^&|;]*)/g;
  const apk = /\bapk add\b([^&|;]*)/g;
  const found = [];
  for (const pattern of [apt, apk]) {
    for (const match of line.matchAll(pattern)) {
      found.push(
        ...match[1]
          .trim()
          .split(/\s+/)
          .filter((word) => {
            return word && !word.startsWith("-") && !word.startsWith("\\");
          }),
      );
    }
  }
  return found;
}

const COMPILERS = ["g++", "gcc", "build-essential"];

describe("production images do not ship a build toolchain", () => {
  const cases = TEMPLATES.map((template) => {
    return [template];
  });

  test.each(cases)("%s", (template) => {
    const stages = stagesOf(template, "production");
    for (const chain of shippedStages(stages)) {
      // Walk the whole chain, oldest stage first, as one instruction list.
      const lines = [...chain].reverse().flatMap((stage) => {
        return stage.instructions;
      });

      const installsCompiler = lines.findIndex((line) => {
        return installedPackagesIn(line).some((name) => {
          return COMPILERS.includes(name);
        });
      });
      if (installsCompiler === -1) {
        continue;
      }

      // Alpine images install it as the .gyp virtual package; Debian ones
      // purge it by name.
      const removal = lines.findIndex((line, index) => {
        return (
          index > installsCompiler &&
          (/\bapk del\b[^&|;]*\.gyp\b/.test(line) ||
            /\bapt-get (purge|remove)\b[^&|;]*\sg\+\+(\s|$)/.test(line))
        );
      });
      expect({ template, removed: removal !== -1 }).toEqual({
        template,
        removed: true,
      });

      // ...after the last step that could still need it. An install with
      // --ignore-scripts compiles nothing.
      const lastBuildStep = lines.reduce((last, line, index) => {
        const builds =
          /\b(npm (ci|install|rebuild)|npx playwright install|node-gyp|gcc )/.test(
            line,
          ) &&
          !/--ignore-scripts/.test(line) &&
          !/\bapt-get (purge|remove)\b/.test(line);
        return builds ? index : last;
      }, -1);
      expect(lastBuildStep).toBeGreaterThanOrEqual(0);
      expect({
        template,
        removalAfterLastBuildStep: removal >= lastBuildStep,
      }).toEqual({ template, removalAfterLastBuildStep: true });
    }
  });

  test("the Debian purges use --auto-remove, which is what takes the kernel headers and binutils", () => {
    for (const template of [
      "packages/Probe/Dockerfile.tpl",
      "packages/Runner/Dockerfile.tpl",
      "packages/E2E/Dockerfile.tpl",
    ]) {
      const lines = stagesOf(template, "production").flatMap((stage) => {
        return stage.instructions;
      });
      const purges = lines.filter((line) => {
        return /\bapt-get purge\b/.test(line);
      });
      const toolchainPurges = purges.filter((line) => {
        return /\bapt-get purge\b[^&|;]*\sg\+\+(\s|$)/.test(line);
      });
      expect({ template, toolchainPurges: toolchainPurges.length }).toEqual({
        template,
        toolchainPurges: 1,
      });
      for (const purge of purges) {
        expect(purge).toMatch(/apt-get purge -y --auto-remove /);
      }
    }
  });

  test("the Probe development image keeps its toolchain (Start.dev.sh rebuilds native modules)", () => {
    const development = stagesOf("packages/Probe/Dockerfile.tpl", "development")
      .flatMap((stage) => {
        return stage.instructions;
      })
      .join("\n");
    expect(development).not.toMatch(/apt-get purge\b[^&|;\n]*\sg\+\+(\s|$)/m);
    expect(development).toMatch(/apt-get install\b[^&|;\n]*\sg\+\+\s/m);
    expect(read("packages/Probe/Start.dev.sh")).toMatch(/npm (ci|install)/);
  });
});

describe("tini is started from where the image's package manager installs it", () => {
  const cases = [];
  for (const template of TEMPLATES) {
    const lines = stagesOf(template, "production").flatMap((stage) => {
      return stage.instructions;
    });
    const entrypoint = lines.find((line) => {
      return /^ENTRYPOINT .*tini/.test(line);
    });
    if (entrypoint) {
      cases.push([template, lines, entrypoint]);
    }
  }

  test("there are tini images to check", () => {
    expect(cases.length).toBeGreaterThanOrEqual(4);
  });

  test.each(cases)("%s", (template, lines, entrypoint) => {
    const viaApk = lines.some((line) => {
      return (
        /\bapk add\b/.test(line) && installedPackagesIn(line).includes("tini")
      );
    });
    const viaApt = lines.some((line) => {
      return (
        /\bapt-get install\b/.test(line) &&
        installedPackagesIn(line).includes("tini")
      );
    });
    expect(viaApk !== viaApt).toBe(true);
    expect(entrypoint).toBe(
      `ENTRYPOINT ["${viaApk ? "/sbin/tini" : "/usr/bin/tini"}", "--"]`,
    );
  });
});

describe("Runner", () => {
  const lines = stagesOf(
    "packages/Runner/Dockerfile.tpl",
    "production",
  ).flatMap((stage) => {
    return stage.instructions;
  });

  test("installs the command-line tools the full node image used to provide", () => {
    const installed = lines.flatMap(installedPackagesIn);
    for (const tool of [
      "bash",
      "ca-certificates",
      "curl",
      "git",
      "tini",
      "wget",
      "openssh-client",
      "procps",
      "unzip",
      "xz-utils",
      "bzip2",
    ]) {
      expect(installed).toContain(tool);
    }
  });

  test("updates the CA store only once ca-certificates is installed", () => {
    const install = lines.findIndex((line) => {
      return installedPackagesIn(line).includes("ca-certificates");
    });
    const update = lines.findIndex((line) => {
      return /\bupdate-ca-certificates\b/.test(line);
    });
    expect(install).toBeGreaterThanOrEqual(0);
    expect(update).toBeGreaterThanOrEqual(install);
    // The slim image has no update-ca-certificates until then.
    expect(
      lines.slice(0, install).some((line) => {
        return /\bupdate-ca-certificates\b/.test(line);
      }),
    ).toBe(false);
  });
});

describe("E2E", () => {
  const template = "packages/E2E/Dockerfile.tpl";
  const lines = stagesOf(template, "production").flatMap((stage) => {
    return stage.instructions;
  });
  const packageJson = readJson("packages/E2E/package.json");
  const lock = readJson("packages/E2E/package-lock.json");

  test("installs the package without its lifecycle scripts", () => {
    const installs = lines.filter((line) => {
      return /\bnpm ci\b/.test(line);
    });
    // Common's install first (its dependencies need their scripts), then
    // E2E's own.
    expect(installs).toHaveLength(2);
    expect(installs[0]).not.toMatch(/--ignore-scripts/);
    expect(installs[1]).toMatch(/--ignore-scripts/);
    const workdirs = lines.filter((line) => {
      return /^WORKDIR /.test(line);
    });
    expect(workdirs).toEqual([
      "WORKDIR /usr/src/Common",
      "WORKDIR /usr/src/app",
    ]);
  });

  test("the flag is only safe while no dependency has an install script", () => {
    // It is there for the root preinstall; if a dependency gains an install
    // script, --ignore-scripts would silently skip it too.
    expect(packageJson.scripts.preinstall).toMatch(/playwright install/);
    const withScripts = Object.entries(lock.packages)
      .filter(([location, entry]) => {
        return location !== "" && entry.hasInstallScript && !entry.optional;
      })
      .map(([location]) => {
        return location;
      });
    expect(withScripts).toEqual([]);
  });

  test("installs exactly the browsers the suite's projects launch, with their system libraries", () => {
    const browserInstall = lines.filter((line) => {
      return /\bnpx playwright install\b/.test(line);
    });
    expect(browserInstall).toHaveLength(1);
    // The FFmpeg stack Playwright lists for Firefox is removed in the same
    // layer, as in the Probe image (ProbeBrowserInstall.test.ts says why).
    expect(browserInstall[0]).toMatch(
      /apt-get update && npx playwright install --with-deps chromium firefox && apt-get purge -y --auto-remove libavcodec59 && rm -rf \/var\/lib\/apt\/lists\/\*/,
    );

    const configs = fs
      .readdirSync(path.join(REPO_ROOT, "packages/E2E"))
      .filter((name) => {
        return /^playwright\..*config\.ts$/.test(name);
      });
    expect(configs.length).toBeGreaterThan(5);
    for (const name of configs) {
      // Commented-out projects (the Pixel/iPhone examples) launch nothing.
      const source = read(`packages/E2E/${name}`)
        .split("\n")
        .filter((line) => {
          return !/^\s*(\/\/|\*|\/\*)/.test(line);
        })
        .join("\n");
      const engines = new Set();
      for (const match of source.matchAll(/devices\[\s*["'](.+?)["']\s*\]/g)) {
        // The engine is the descriptor's defaultBrowserType in Playwright's
        // deviceDescriptorsSource.json. A device missing here fails the test
        // until someone looks it up: every iPhone/iPad and "Desktop Safari"
        // is webkit, which this image does not install.
        const DEVICE_ENGINES = {
          "Desktop Chrome": "chromium",
          "Desktop Firefox": "firefox",
          "Pixel 5": "chromium",
          "Pixel 7": "chromium",
        };
        engines.add(
          DEVICE_ENGINES[match[1]] || `unclassified device ${match[1]}`,
        );
      }
      for (const match of source.matchAll(/browserName:\s*["'](\w+)["']/g)) {
        engines.add(match[1]);
      }
      for (const engine of engines) {
        expect({ name, engine }).toEqual({
          name,
          engine: expect.stringMatching(/^(chromium|firefox)$/),
        });
      }
    }
  });
});

describe("App", () => {
  const lines = stagesOf("packages/App/Dockerfile.tpl", "production").flatMap(
    (stage) => {
      return stage.instructions;
    },
  );

  test("drops aedes' examples in the same layer that installs them", () => {
    const appInstall = lines.filter((line) => {
      return (
        /\bnpm ci\b/.test(line) && /node_modules\/aedes\/examples/.test(line)
      );
    });
    expect(appInstall).toEqual([
      "RUN --mount=type=cache,target=/tmp/npm npm ci --prefer-offline && rm -rf node_modules/aedes/examples",
    ]);
  });

  test("the prune still has something to remove: the App depends on aedes", () => {
    // If aedes ever leaves the App, drop the rm too.
    expect(
      readJson("packages/App/package.json").dependencies.aedes,
    ).toBeDefined();
    expect(
      readJson("packages/App/package-lock.json").packages["node_modules/aedes"],
    ).toBeDefined();
  });
});

describe("Nginx", () => {
  const stages = stagesOf("packages/Nginx/Dockerfile.tpl", "production");
  const final = stages[stages.length - 1];

  function alpineOf(image) {
    const match = /-alpine(\d+\.\d+)$/.exec(image);
    return match ? match[1] : null;
  }

  test("the node donor and the nginx base are pinned to the same Alpine release", () => {
    const donor = stages.find((stage) => {
      return stage.name === "node26";
    });
    expect(donor).toBeDefined();
    expect(alpineOf(donor.from)).not.toBeNull();
    expect(alpineOf(final.from)).toBe(alpineOf(donor.from));
  });

  test("the nginx base names an exact release", () => {
    expect(final.from).toMatch(/^nginx:\d+\.\d+\.\d+-alpine\d+\.\d+$/);
  });

  test("removes exactly the dynamic modules nginx.conf never loads", () => {
    const removal = final.instructions.find((line) => {
      return /\bapk del\b/.test(line);
    });
    expect(removal).toMatch(
      /apk del --no-cache nginx-module-image-filter nginx-module-xslt nginx-module-geoip$/,
    );

    const configuration = [
      read("packages/Nginx/nginx.conf"),
      read("packages/Nginx/default.conf.template"),
    ].join("\n");
    const loaded = [
      ...configuration.matchAll(/^\s*load_module\s+modules\/(\S+?)\.so;/gm),
    ].map((match) => {
      return match[1];
    });
    expect(loaded).toEqual(["ngx_http_js_module"]);
    // ...and nothing uses a directive of a removed module.
    expect(configuration).not.toMatch(/^\s*(image_filter|xslt_|geoip)/m);
  });

  test("keeps the njs module it does load", () => {
    const install = final.instructions.find((line) => {
      return /\bapk add\b/.test(line);
    });
    expect(installedPackagesIn(install)).toEqual(
      expect.arrayContaining(["nginx-module-njs", "libstdc++"]),
    );
  });
});

describe("the OpenTelemetry collector pin", () => {
  const COLLECTOR = /otel\/opentelemetry-collector-contrib:(\d+\.\d+\.\d+)/g;

  function pinsIn(relativePath) {
    return [...read(relativePath).matchAll(COLLECTOR)].map((match) => {
      return match[1];
    });
  }

  const PINNED = [
    "agents/DockerAgent/Dockerfile.tpl",
    "agents/PodmanAgent/Dockerfile.tpl",
    "agents/DockerSwarmAgent/docker-compose.yml",
    "agents/VMwareAgent/docker-compose.yml",
    "Tests/Ops/validate-collector-configs.sh",
    "Tests/Ops/ContainerAgentDockerApiVersionRuntime.test.js",
    "packages/App/FeatureSet/Dashboard/src/Pages/VMware/Utils/DocumentationMarkdown.ts",
  ];

  test("is one version everywhere the agents run it or it is validated", () => {
    const versions = new Set();
    for (const file of PINNED) {
      const pins = pinsIn(file);
      expect({ file, pinned: pins.length > 0 }).toEqual({ file, pinned: true });
      pins.forEach((version) => {
        return versions.add(version);
      });
    }
    expect([...versions]).toHaveLength(1);
  });

  test("the Swarm agent's APP_VERSION default and the severity model follow it", () => {
    const [version] = pinsIn("agents/DockerAgent/Dockerfile.tpl");
    expect(read("agents/DockerSwarmAgent/docker-compose.yml")).toContain(
      `APP_VERSION=\${APP_VERSION:-${version}}`,
    );
    expect(read("Tests/Ops/Utils/StanzaSeverity.js")).toContain(
      `const OTEL_COLLECTOR_VERSION = "${version}";`,
    );
  });

  test("the Swarm and VMware compose files run the pinned collector", () => {
    for (const file of [
      "agents/DockerSwarmAgent/docker-compose.yml",
      "agents/VMwareAgent/docker-compose.yml",
    ]) {
      const compose = yaml.load(read(file));
      const images = Object.values(compose.services)
        .map((service) => {
          return service.image;
        })
        .filter((image) => {
          return /opentelemetry-collector-contrib/.test(image || "");
        });
      expect(images).toEqual([
        `otel/opentelemetry-collector-contrib:${pinsIn("agents/DockerAgent/Dockerfile.tpl")[0]}`,
      ]);
    }
  });
});
