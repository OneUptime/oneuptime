"use strict";

/**
 * OneUptime's Iron Bank projects (IronBank/<Project>) follow Iron Bank's rules,
 * and the ingress, the runner and the probe ship what their releases ship.
 *
 * Each project's Dockerfile copies what it ships out of a release image,
 * pinned by digest in its hardening_manifest.yaml, onto one of Iron Bank's
 * base images (IronBank/README.md). For every project this holds:
 *
 *   - the folders, PinRelease.js's PROJECTS and the Iron Bank Preflight
 *     workflow's matrix name the same projects, the same release images, and
 *     the same two that run as root;
 *   - its files are in git; its base image is the one its manifest's args
 *     name; it pins one release everywhere, as PinRelease.js moves it, and the
 *     Helm values (IronBank/values.yaml) run that release under the name Iron
 *     Bank will publish it; its manifest's labels are ones Iron Bank's schema
 *     allows; its other
 *     resources (the probe's ODBC driver) are pinned by checksum and copied
 *     by the Dockerfile, which copies nothing else from its build context; its
 *     RUN instructions fetch nothing but Alpine or Debian packages; and its
 *     LICENSE, Renovate configuration and justifications are in order.
 *
 * And for the ingress, the runner and the probe (IronBankApp.test.js holds the
 * App to its release), what the release's Dockerfile sets that a COPY --from
 * does not bring is set again: the start command, entrypoint, shell, working
 * directory, user, environment and labels; the packages the release keeps,
 * npm's settings and links; and every path the release copies or builds in,
 * copied out of the release to the same place. RELEASES says where a project
 * differs on purpose, and why.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const { instructions, parseStages } = require("./Utils/DockerfileTemplate");
const {
  REPO_ROOT,
  read,
  git,
  isGitIgnored,
  pairs,
  all,
  last,
  commands,
  packages,
  copies,
  templateStages,
  readProject,
} = require("./Utils/IronBank");
const PinRelease = require("../../Scripts/IronBank/PinRelease");
const { readJustifications } = require("../../Scripts/IronBank/NewFindings");

const NAMES = ["App", "Ingress", "Runner", "Probe"];

// They run as root, as their releases do (IronBank/README.md says why).
const ROOT = ["Ingress", "Probe"];

// Their new high and critical findings warn for now; the others' fail the job.
const REPORT_ONLY = ["Runner", "Probe"];

const helmValuesText = read("IronBank/values.yaml");

/*
 * The Dockerfile each image's release is built from, its shipped stages (by
 * name, null for the unnamed last one), and where the Iron Bank image differs
 * on purpose.
 */
const RELEASES = {
  Ingress: {
    template: "packages/Nginx/Dockerfile.tpl",
    stages: ["base", null],
    // The release installs njs from nginx.org's repository, which Iron Bank's
    // pipeline cannot reach; Iron Bank's nginx image copies it, with the
    // other modules, out of the official image.
    fromBase: ["nginx-module-njs"],
    builtIn: [],
  },
  Runner: {
    template: "packages/Runner/Dockerfile.tpl",
    stages: ["base", null],
    fromBase: [],
    // kubectl, which the release downloads and checks against its sha256.
    builtIn: ["/usr/local/bin/kubectl"],
  },
  Probe: {
    template: "packages/Probe/Dockerfile.tpl",
    stages: [null],
    fromBase: [],
    // The release downloads with curl and this build does not, nothing in the
    // probe runs it, and with libcurl4 it is 50 of the high and critical
    // findings in Iron Bank's scans.
    leftOut: ["curl"],
    // Node.js, which the release's base image (Node's) has and Iron Bank's
    // Debian image does not; the browsers Playwright downloaded; and the
    // synthetic monitors' helpers it compiled.
    builtIn: [
      "/usr/local/bin/node",
      "/usr/local/lib/node_modules",
      "/ms-playwright-browsers",
      "/usr/lib/oneuptime-probe",
    ],
  },
};

// hardening_manifest.schema.json's labels, which allows no others.
const SCHEMA_LABELS = [
  "mil.dso.ironbank.image.keywords",
  "mil.dso.ironbank.image.type",
  "mil.dso.ironbank.product.name",
  "org.opencontainers.image.description",
  "org.opencontainers.image.licenses",
  "org.opencontainers.image.title",
  "org.opencontainers.image.url",
  "org.opencontainers.image.vendor",
  "org.opencontainers.image.version",
];

/*
 * What a RUN command may do. Iron Bank's pipeline reaches Alpine's and
 * Debian's package repositories through its proxy and nothing else, so no
 * command downloads anything but packages.
 */
const ALLOWED_COMMANDS = [
  /^apk (upgrade|add) --no-cache( [a-z0-9][a-z0-9.+_-]*)*$/,
  /^apt-get (update|upgrade -y|clean)$/,
  /^([A-Z_]+=\S+ )*apt-get install -y --no-install-recommends( [a-z0-9/][a-z0-9.+_/-]*)+$/,
  /^apt-get purge -y --auto-remove( [a-z0-9][a-z0-9.+_-]*)+$/,
  /^update-ca-certificates$/,
  /^rm -rf( \/\S+)+$/,
  /^mkdir (-p )?\/\S+$/,
  /^chmod \d+ \/\S+$/,
  /^chown \d+:\d+ \/\S+$/,
  /^ln -s \/\S+ \/\S+$/,
  /^npm config set [a-z-]+ \S+( --global)?$/,
  // Playwright's own list of the libraries its browsers need, installed with
  // apt-get from Debian's repositories.
  /^node \/usr\/src\/app\/node_modules\/playwright\/cli\.js install-deps( [a-z]+)+$/,
];

// What a release's Dockerfile does that its copy repeats as it is.
const REPEATED =
  /^(npm config set |ln -s |mkdir \/tmp\/npm$|chmod 2777 \/tmp\/npm$|chown 1000:1000 \/tmp\/npm$|update-ca-certificates$)/;

const projects = Object.fromEntries(
  NAMES.map((name) => {
    return [name, readProject(name)];
  }),
);
const matrix = yaml.load(read(".github/workflows/iron-bank.yml")).jobs.preflight
  .strategy.matrix.include;

describe("the Iron Bank projects", () => {
  test("the folders, PinRelease.js and the workflow's matrix name the same projects", () => {
    const folders = fs
      .readdirSync(path.join(REPO_ROOT, "IronBank"), { withFileTypes: true })
      .filter((entry) => {
        return entry.isDirectory() && entry.name !== "Justifications";
      })
      .map((entry) => {
        return entry.name;
      })
      .sort();

    expect(folders).toEqual([...NAMES].sort());
    expect(Object.keys(PinRelease.PROJECTS)).toEqual(NAMES);
    expect(
      matrix.map((entry) => {
        return {
          project: entry.project,
          image: entry.image,
          root: entry.allow_root === "1",
          reportOnly: entry.report_only === "1",
        };
      }),
    ).toEqual(
      NAMES.map((name) => {
        return {
          project: name,
          image: PinRelease.PROJECTS[name].repository,
          root: ROOT.includes(name),
          reportOnly: REPORT_ONLY.includes(name),
        };
      }),
    );
  });
});

describe.each(NAMES)("IronBank/%s follows Iron Bank's rules", (name) => {
  const project = projects[name];
  const release = PinRelease.PROJECTS[name];
  const { manifest } = project;
  const version = manifest.labels["org.opencontainers.image.version"];
  const environment = pairs(project.finalInstructions, "ENV");
  const gitSha = environment["GIT_SHA"];
  const resources = manifest.resources || [];
  const images = resources.filter((resource) => {
    return String(resource.url).startsWith("docker://");
  });
  const files = resources.filter((resource) => {
    return !String(resource.url).startsWith("docker://");
  });
  const digest = images.length === 1 ? images[0].url.split("@")[1] : null;
  const tag = `${release.repository}:${release.tagPrefix}${version}`;

  test("every file Repo1 gets is in git: none is ignored, and each is tracked", () => {
    const tracked = git(["ls-files", "--", project.directory]).stdout.split(
      "\n",
    );

    for (const file of [
      "Dockerfile",
      "hardening_manifest.yaml",
      "LICENSE",
      "README.md",
      "renovate.json",
    ]) {
      const relative = `${project.directory}/${file}`;
      expect({
        file: relative,
        ignored: isGitIgnored(relative),
        tracked: tracked.includes(relative),
      }).toEqual({ file: relative, ignored: false, tracked: true });
    }
  });

  test("its base image is the one the manifest's args name, under registry1's ironbank/ project", () => {
    expect(project.args).toEqual({
      BASE_REGISTRY: "registry1.dso.mil",
      BASE_IMAGE: `ironbank/${manifest.args.BASE_IMAGE}`,
      BASE_TAG: manifest.args.BASE_TAG,
    });
    expect(project.finalStage.from).toBe(
      "${base_registry}/${base_image}:${base_tag}",
    );
  });

  test("it pins one release everywhere: the first tag, the version label, the resource, the release stage, APP_VERSION, GIT_SHA and the revision label", () => {
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.tags[0]).toBe(version);
    expect(images).toEqual([
      { tag, url: `docker://docker.io/${release.repository}@${digest}` },
    ]);
    expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(
      project.stages.map((stage) => {
        return [stage.name, stage.from];
      }),
    ).toEqual([
      ["release", tag],
      ["shipped", "release"],
      [null, "${base_registry}/${base_image}:${base_tag}"],
    ]);
    expect(environment["APP_VERSION"]).toBe(version);
    expect(gitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(pairs(project.finalInstructions, "LABEL")).toEqual(
      expect.objectContaining({ "org.opencontainers.image.revision": gitSha }),
    );
  });

  test("PinRelease.js finds each value once, and moves all of them to another release", () => {
    const current = {
      manifest: project.manifestText,
      dockerfile: project.dockerfileText,
      values: helmValuesText,
    };
    const next = {
      version: "99.1.2",
      digest: `sha256:${"a".repeat(64)}`,
      gitSha: "b".repeat(40),
    };

    expect(
      PinRelease.pin(current, { version, digest, gitSha }, release),
    ).toEqual(current);

    const pinned = PinRelease.pin(current, next, release);
    const moved = yaml.load(pinned.manifest);
    const movedFinal = readStages(pinned.dockerfile);
    const movedTag = `${release.repository}:${release.tagPrefix}99.1.2`;

    expect(moved.tags[0]).toBe("99.1.2");
    expect(moved.labels["org.opencontainers.image.version"]).toBe("99.1.2");
    expect(moved.resources).toEqual([
      ...resources.map((resource) => {
        return resource === images[0]
          ? {
              tag: movedTag,
              url: `docker://docker.io/${release.repository}@${next.digest}`,
            }
          : resource;
      }),
    ]);
    expect(movedFinal.releaseFrom).toBe(movedTag);
    expect(pairs(movedFinal.instructions, "ENV")).toEqual({
      ...environment,
      APP_VERSION: "99.1.2",
      GIT_SHA: next.gitSha,
    });
    expect(pairs(movedFinal.instructions, "LABEL")).toEqual(
      expect.objectContaining({
        "org.opencontainers.image.revision": next.gitSha,
      }),
    );
    expect(yaml.load(pinned.values).image.overrides[release.helmKey]).toBe(
      `registry1.dso.mil/ironbank/${manifest.name}:99.1.2`,
    );
  });

  test("the Helm values run it as Iron Bank will publish it", () => {
    expect(yaml.load(helmValuesText).image.overrides[release.helmKey]).toBe(
      `registry1.dso.mil/ironbank/${manifest.name}:${version}`,
    );
  });

  test("its manifest is v1, names its maintainers, and has only labels Iron Bank's schema allows, in printable ASCII", () => {
    expect(manifest.apiVersion).toBe("v1");
    expect(manifest.name).toMatch(/^oneuptime\/[a-z-]+$/);
    expect(new Set(manifest.tags).size).toBe(manifest.tags.length);
    expect(manifest.tags.length).toBeLessThanOrEqual(10);
    expect(manifest.maintainers.length).toBeGreaterThan(0);
    // Iron Bank's pipeline refuses a manifest with FIXME in it.
    expect(JSON.stringify([manifest.labels, manifest.maintainers])).not.toMatch(
      /fixme/i,
    );
    expect(
      Object.keys(manifest.labels).filter((label) => {
        return !SCHEMA_LABELS.includes(label);
      }),
    ).toEqual([]);
    for (const [label, value] of Object.entries(manifest.labels)) {
      expect({ label, printable: /^(?!\s*$)[ -~]*$/.test(value) }).toEqual({
        label,
        printable: true,
      });
    }
    // The App's ee/ is under the OneUptime Enterprise License.
    expect(manifest.labels["mil.dso.ironbank.image.type"]).toBe(
      name === "App" ? "commercial" : "opensource",
    );
  });

  test("its other resources are pinned by checksum and copied from the build context, which nothing else is copied from", () => {
    for (const file of files) {
      expect(file.url).toMatch(/^https:\/\//);
      expect(file.filename).toMatch(/^[\w.-]+$/);
      expect(file.validation.type).toBe("sha256");
      expect(file.validation.value).toMatch(/^[0-9a-f]{64}$/);
    }
    const fromContext = copies(project.finalInstructions).filter((copy) => {
      return copy.from === null;
    });

    expect(
      fromContext
        .flatMap((copy) => {
          return copy.sources;
        })
        .sort(),
    ).toEqual(
      files
        .map((file) => {
          return file.filename;
        })
        .sort(),
    );
  });

  test("its RUN instructions fetch nothing but Alpine or Debian packages", () => {
    const offenders = commands(project.finalInstructions).filter((command) => {
      return !ALLOWED_COMMANDS.some((pattern) => {
        return pattern.test(command);
      });
    });

    expect(offenders).toEqual([]);
    expect(all(project.finalInstructions, "ADD")).toEqual([]);
    expect(all(instructions(project.releaseStage.body), "RUN")).toEqual([]);
  });

  test("the release's files reach it without the release's tests, in no layer of the image", () => {
    // One of Common's test fixtures is what ClamAV calls phishing, and Iron
    // Bank's pipeline fails an image on any ClamAV detection.
    const shipped = project.stages.find((stage) => {
      return stage.name === "shipped";
    });

    expect(instructions(shipped.body)).toEqual([
      "USER root",
      "RUN rm -rf /usr/src/Common/Tests /usr/src/app/Tests",
    ]);
    expect(
      copies(project.finalInstructions).filter((copy) => {
        return copy.destination === "/usr/src";
      }),
    ).toEqual([
      { from: "shipped", sources: ["/usr/src"], destination: "/usr/src" },
    ]);
  });

  test(`it runs as ${ROOT.includes(name) ? "root, as its release does" : "node"}, from an absolute WORKDIR`, () => {
    expect(last(project.finalInstructions, "USER")).toBe(
      ROOT.includes(name) ? "USER root" : "USER node",
    );
    for (const workdir of all(project.finalInstructions, "WORKDIR")) {
      expect(workdir).toMatch(/^WORKDIR \//);
    }
  });

  test("its LICENSE is the repository's (and the App's is followed by ee/'s, which the image carries)", () => {
    const license = read(`${project.directory}/LICENSE`);

    if (name === "App") {
      expect(license.startsWith(read("LICENSE"))).toBe(true);
      expect(license.endsWith(read("ee/LICENSE"))).toBe(true);
    } else {
      expect(license).toBe(read("LICENSE"));
    }
  });

  test("Renovate moves BASE_TAG in both files, and nothing else", () => {
    const renovate = JSON.parse(read(`${project.directory}/renovate.json`));
    const [manager] = renovate.regexManagers;

    // Renovate's own Dockerfile manager would move the release stage's FROM
    // without APP_VERSION and GIT_SHA: PinRelease.js moves the release.
    expect(renovate.enabledManagers).toEqual(["regex"]);
    expect(renovate.regexManagers).toHaveLength(1);
    expect(manager.depNameTemplate).toBe(
      `registry1.dso.mil/ironbank/${manifest.args.BASE_IMAGE}`,
    );
    expect(manager.datasourceTemplate).toBe("docker");
    for (const [file, text] of [
      ["hardening_manifest.yaml", project.manifestText],
      ["Dockerfile", project.dockerfileText],
    ]) {
      expect(
        manager.fileMatch.some((pattern) => {
          return new RegExp(pattern).test(file);
        }),
      ).toBe(true);
      const found = manager.matchStrings.flatMap((pattern) => {
        return [...text.matchAll(new RegExp(pattern, "g"))].map((match) => {
          return match.groups.currentValue;
        });
      });
      expect({ file, found }).toEqual({
        file,
        found: [manifest.args.BASE_TAG],
      });
    }
  });

  test("its justifications are a list NewFindings.js reads", () => {
    const entries = yaml.load(read(`IronBank/Justifications/${name}.yaml`));

    expect(Array.isArray(entries)).toBe(true);
    expect(() => {
      return readJustifications(entries);
    }).not.toThrow();
  });
});

/*
 * The release stage's image and the final stage's instructions of a
 * Dockerfile's text.
 */
function readStages(text) {
  const stages = parseStages(text);
  return {
    releaseFrom: stages[0].from,
    instructions: instructions(stages[stages.length - 1].body),
  };
}

describe.each(Object.keys(RELEASES))(
  "IronBank/%s runs what its release runs",
  (name) => {
    const spec = RELEASES[name];
    const project = projects[name];
    const ours = project.finalInstructions;
    const version = project.manifest.labels["org.opencontainers.image.version"];
    const gitSha = pairs(ours, "ENV")["GIT_SHA"];

    const releaseStages = templateStages(spec.template);
    const shipped = spec.stages.map((stageName) => {
      return stageName === null
        ? releaseStages[releaseStages.length - 1]
        : releaseStages.find((stage) => {
            return stage.name === stageName;
          });
    });
    const theirs = shipped.flatMap((stage) => {
      return instructions(stage.body);
    });

    // The ARG defaults of the release's stages, for ENV values that use them.
    const argDefaults = Object.fromEntries(
      all(theirs, "ARG")
        .map((line) => {
          return /^ARG (\w+)=(\S*)$/.exec(line);
        })
        .filter(Boolean)
        .map((match) => {
          return [match[1], match[2]];
        }),
    );
    const resolve = (value) => {
      return value.replace(/\$\{(\w+)\}/g, (match, variable) => {
        if (variable === "GIT_SHA") {
          return gitSha;
        }
        if (variable === "APP_VERSION") {
          return version;
        }
        if (variable in argDefaults) {
          return argDefaults[variable];
        }
        throw new Error(`${spec.template}: ${match} has no value to compare`);
      });
    };

    test("reads the release's shipped stages (the checks below are not vacuous)", () => {
      expect(shipped.every(Boolean)).toBe(true);
      expect(theirs.length).toBeGreaterThan(10);
      if (shipped.length === 2) {
        expect(shipped[1].from).toBe(shipped[0].name);
      }
    });

    test("the same start command, entrypoint, shell and working directory, and the same user", () => {
      for (const keyword of ["CMD", "ENTRYPOINT", "SHELL", "WORKDIR"]) {
        expect({ keyword, ironBank: last(ours, keyword) }).toEqual({
          keyword,
          ironBank: last(theirs, keyword),
        });
      }
      // The release's base images run as root unless its Dockerfile says
      // otherwise; Iron Bank's may not, so the copy always says.
      expect(last(ours, "USER")).toBe(last(theirs, "USER") || "USER root");
    });

    test("the same environment, with the release's version and commit for its build arguments", () => {
      const expected = Object.fromEntries(
        Object.entries(pairs(theirs, "ENV")).map(([key, value]) => {
          return [key, resolve(value)];
        }),
      );

      expect(pairs(ours, "ENV")).toEqual(expected);
    });

    test("every label of the release, from the manifest or the Dockerfile", () => {
      const labels = { ...project.manifest.labels, ...pairs(ours, "LABEL") };

      for (const [key, value] of Object.entries(pairs(theirs, "LABEL"))) {
        // Iron Bank's schema allows printable ASCII only.
        const wanted = resolve(value).replace(" — ", ": ");
        expect({ label: key, value: labels[key] }).toEqual({
          label: key,
          value: wanted,
        });
      }
    });

    test("the packages the release keeps, and none it removes", () => {
      const release = packages(commands(theirs));
      const copy = packages(commands(ours));
      const leftOut = spec.leftOut || [];
      const kept = [...release.installed].filter((pkg) => {
        return (
          !release.removed.has(pkg) &&
          !spec.fromBase.includes(pkg) &&
          !leftOut.includes(pkg)
        );
      });

      expect(kept.length).toBeGreaterThan(0);
      expect(
        leftOut.filter((pkg) => {
          return copy.installed.has(pkg) || !release.installed.has(pkg);
        }),
      ).toEqual([]);
      expect(
        kept.filter((pkg) => {
          return !copy.installed.has(pkg);
        }),
      ).toEqual([]);
      expect(
        [...copy.installed].filter((pkg) => {
          return release.removed.has(pkg);
        }),
      ).toEqual([]);
    });

    test("what the release removes from Playwright's list of its browsers' packages, it removes too", () => {
      const browserPurge = (list) => {
        return commands(list).filter((command) => {
          return /^apt-get purge /.test(command) && /libavcodec/.test(command);
        });
      };

      expect(browserPurge(ours)).toEqual(browserPurge(theirs));
    });

    test("npm's settings and links, its cache directory and the CA bundle, as the release makes them", () => {
      const repeated = commands(theirs).filter((command) => {
        return REPEATED.test(command);
      });

      expect(commands(ours)).toEqual(expect.arrayContaining(repeated));
    });

    test("every path the release copies or builds in, copied out of the release to the same place", () => {
      // The shipped stage is the release without its tests.
      const fromRelease = copies(ours).filter((copy) => {
        return copy.from === "release" || copy.from === "shipped";
      });
      const destinations = fromRelease.map((copy) => {
        return copy.destination;
      });
      const covered = (target) => {
        const normalized = target.replace(/\/$/, "");
        return destinations.some((destination) => {
          return (
            normalized === destination ||
            normalized.startsWith(`${destination}/`)
          );
        });
      };

      for (const copy of fromRelease) {
        expect(copy.sources).toEqual([copy.destination]);
      }
      const missing = [
        ...copies(theirs)
          .map((copy) => {
            return copy.destination;
          })
          .filter((destination) => {
            return !destination.startsWith("/tmp/");
          }),
        ...spec.builtIn,
      ].filter((destination) => {
        return !covered(destination);
      });

      expect(missing).toEqual([]);
    });
  },
);
