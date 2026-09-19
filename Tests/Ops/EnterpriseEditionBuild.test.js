"use strict";

/**
 * How the Community and Enterprise editions are built, tested and shipped.
 *
 * OneUptime's enterprise code lives in ee/ (under ee/LICENSE), and everything
 * else is the Apache-2.0 Community Edition. The split only holds if the build
 * and CI machinery keeps the two apart, and almost none of that machinery runs
 * on a pull request: images are published and the e2e suites run only after a
 * merge. So this suite pins the machinery itself:
 *
 *   - packages/App/Dockerfile.tpl builds both editions as targets
 *     (base -> community-build -> enterprise-build -> enterprise, and community
 *     last so it stays the default). The community target never touches ee/;
 *     the enterprise target installs ee/ the way ee/package.json expects,
 *     type-checks it, rebuilds only the two frontends with an Enterprise UI and
 *     refuses to ship bundles without the ee sentinel strings.
 *   - Every Dockerfile.tpl is built with the repository root as its context,
 *     so no stage of any of them, except the App's enterprise-build and
 *     enterprise, may take anything from ee/ (Utils/DockerfileContext.js).
 *   - .dockerignore keeps key material, build output and tests out of COPY ./ee.
 *   - Core CI is the Community Edition by construction: every core job deletes
 *     ee/ before it installs anything. ee/ gets its own compile and test jobs.
 *   - Build CI builds and checks both targets; the SaaS e2e jobs (billing on,
 *     which requires ee/ to load) run the enterprise tags.
 *   - Nothing that deploys the images (compose, Helm) sets ONEUPTIME_EDITION,
 *     which would override the Enterprise image's own marker.
 *   - The dev loop mounts ee/ and installs its dependencies itself. It builds
 *     from source rather than running an image, so it alone passes
 *     ONEUPTIME_EDITION through (default auto) to allow the Community Edition
 *     from the same checkout.
 *
 * ContainerBootConfiguration.test.ts (packages/Common) covers the boot side of
 * each final stage (USER, TS_NODE_TRANSPILE_ONLY, CMD).
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const yaml = require("js-yaml");

const {
  DockerfileTemplateError,
  render,
  parseStages,
  ancestry,
  instructions,
  findTemplates,
} = require("./Utils/DockerfileTemplate");
const {
  globMatches,
  parseCopy,
  parseRunMounts,
  contextSourceProblem,
  findEnterpriseLeaks,
} = require("./Utils/DockerfileContext");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const EE_DIR = path.join(REPO_ROOT, "ee");
const HAS_EE = fs.existsSync(path.join(EE_DIR, "package.json"));
const describeWhenEnterprisePresent = HAS_EE ? describe : describe.skip;

const APP_TEMPLATE_PATH = path.join(
  REPO_ROOT,
  "packages",
  "App",
  "Dockerfile.tpl",
);
const DASHBOARD_SENTINEL = "ONEUPTIME_EE_DASHBOARD_PLUGIN_v1";
const ADMIN_DASHBOARD_SENTINEL = "ONEUPTIME_EE_ADMIN_DASHBOARD_PLUGIN_v1";

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function readYaml(relativePath) {
  return yaml.load(read(relativePath));
}

const appTemplate = fs.readFileSync(APP_TEMPLATE_PATH, "utf8");
const productionDockerfile = render(appTemplate, "production");
const developmentDockerfile = render(appTemplate, "development");
const productionStages = parseStages(productionDockerfile);
const developmentStages = parseStages(developmentDockerfile);

function stage(name) {
  const found = productionStages.find((candidate) => {
    return candidate.name === name;
  });
  if (!found) {
    throw new Error(`no stage named ${name}`);
  }
  return found;
}

function stageInstructions(name) {
  return instructions(stage(name).body);
}

function ancestryInstructions(name) {
  return ancestry(productionStages, name).flatMap((candidate) => {
    return instructions(candidate.body);
  });
}

const COPIES_EE = /^(?:COPY|ADD)\s+(?:--\S+\s+)*(?:\.\/)?ee(?:\/\S*)?\s/i;

/*
 * Every Dockerfile.tpl configure.sh renders, and the one stage pair that may
 * hold ee/: the App's enterprise-build and the enterprise target built FROM
 * it (production render only; the development image mounts ee/ instead).
 */
const ALL_TEMPLATES = findTemplates(REPO_ROOT);
const APP_TEMPLATE = "packages/App/Dockerfile.tpl";
const APP_ENTERPRISE_STAGES = ["enterprise-build", "enterprise"];

/*
 * gomplate's file.Exists, answered for rendering: true includes every
 * optional block (the superset a leak check must see), false leaves them out.
 */
function renderTemplate(template, environment, optionalFilesExist) {
  return render(
    fs.readFileSync(path.join(REPO_ROOT, template), "utf8"),
    environment,
    {
      fileExists: () => {
        return optionalFilesExist;
      },
    },
  );
}

function allowedEnterpriseStages(template, environment) {
  return template === APP_TEMPLATE && environment === "production"
    ? APP_ENTERPRISE_STAGES
    : [];
}

/*
 * gomplate is what really renders the templates (configure.sh), so the
 * renderer is only trustworthy while it agrees with gomplate. The Ops
 * workflow installs gomplate at the version configure.sh pins: in CI a
 * missing gomplate fails the parity test, and anywhere else it is skipped
 * with the reason logged, never passed.
 */
const GOMPLATE_PROBE = spawnSync("gomplate", ["--version"], {
  encoding: "utf8",
});
const HAS_GOMPLATE = !GOMPLATE_PROBE.error && GOMPLATE_PROBE.status === 0;
const IN_CI = Boolean(process.env["CI"]);

if (!HAS_GOMPLATE && !IN_CI) {
  console.log(
    "gomplate parity check skipped: gomplate is not on PATH (CI installs it, see .github/workflows/test.ops.yaml).",
  );
}

describe("the Dockerfile template renderer", () => {
  test("renders only the chosen branch", () => {
    const template = [
      "FROM x AS base",
      '{{ if eq .Env.ENVIRONMENT "development" }}',
      "CMD dev",
      "{{ else }}",
      "CMD prod",
      "{{ end }}",
      "",
    ].join("\n");

    expect(render(template, "production")).toContain("CMD prod");
    expect(render(template, "production")).not.toContain("CMD dev");
    expect(render(template, "development")).toContain("CMD dev");
    expect(render(template, "development")).not.toContain("CMD prod");
  });

  test("refuses template syntax it does not understand", () => {
    expect(() => {
      return render('{{- if file.Exists "x" }}\n{{- end }}\n', "production");
    }).toThrow(DockerfileTemplateError);
  });

  test("refuses a {{ in a Dockerfile comment, which gomplate would evaluate", () => {
    expect(() => {
      return render("# see the {{ .Env.FOO }} below\nFROM x\n", "production");
    }).toThrow(DockerfileTemplateError);
  });

  test("renders file.Exists blocks only when asked, with Go's whitespace trimming", () => {
    const template = [
      "FROM x",
      "COPY ./packages/Common/SslCertificates /certs",
      '{{- if file.Exists "SslCertificates" }}',
      "COPY ./SslCertificates /certs",
      "{{- end }}",
      "",
      "RUN true",
      "",
    ].join("\n");
    const asked = [];

    const withFile = render(template, "production", {
      fileExists: (relativePath) => {
        asked.push(relativePath);
        return true;
      },
    });
    const withoutFile = render(template, "production", {
      fileExists: () => {
        return false;
      },
    });

    expect(asked).toEqual(["SslCertificates"]);
    expect(withFile).toBe(
      "FROM x\nCOPY ./packages/Common/SslCertificates /certs\nCOPY ./SslCertificates /certs\n\nRUN true\n",
    );
    expect(withoutFile).toBe(
      "FROM x\nCOPY ./packages/Common/SslCertificates /certs\n\nRUN true\n",
    );
    // Without fileExists the block is refused, as before.
    expect(() => {
      return render(template, "production");
    }).toThrow(DockerfileTemplateError);
  });

  test.each([
    [
      "an else inside it",
      '{{ if file.Exists "x" }}\nA\n{{ else }}\nB\n{{ end }}\n',
    ],
    ["no end", '{{- if file.Exists "x" }}\nCOPY ./x /x\n'],
    [
      "another action inside it",
      '{{- if file.Exists "x" }}\n{{ .Env.FOO }}\n{{- end }}\n',
    ],
    ["any other function", '{{- if file.IsDir "x" }}\nA\n{{- end }}\n'],
  ])("refuses a file.Exists block with %s", (_label, template) => {
    expect(() => {
      return render(template, "production", {
        fileExists: () => {
          return true;
        },
      });
    }).toThrow(DockerfileTemplateError);
  });

  test("finds every Dockerfile.tpl configure.sh renders", () => {
    expect(ALL_TEMPLATES).toContain(APP_TEMPLATE);
    expect(ALL_TEMPLATES).toContain("packages/Probe/Dockerfile.tpl");
    expect(ALL_TEMPLATES.length).toBeGreaterThanOrEqual(12);
    expect(
      ALL_TEMPLATES.filter((template) => {
        return template.includes("node_modules");
      }),
    ).toEqual([]);
  });

  test.each(ALL_TEMPLATES)(
    "renders %s for production and development, with and without the optional files",
    (template) => {
      for (const environment of ["production", "development"]) {
        for (const optionalFilesExist of [true, false]) {
          expect(
            parseStages(
              renderTemplate(template, environment, optionalFilesExist),
            ).length,
          ).toBeGreaterThan(0);
        }
      }
    },
  );

  (HAS_GOMPLATE || IN_CI ? test : test.skip)(
    "agrees with gomplate for every Dockerfile.tpl, with and without SslCertificates (required in CI)",
    () => {
      if (!HAS_GOMPLATE) {
        throw new Error(
          `CI is set but gomplate is not on PATH (${
            GOMPLATE_PROBE.error
              ? GOMPLATE_PROBE.error.message
              : GOMPLATE_PROBE.stderr
          }). test.ops.yaml installs it; this parity check must not pass by skipping.`,
        );
      }

      const normalise = (text) => {
        return text
          .split("\n")
          .map((line) => {
            return line.replace(/\s+$/, "");
          })
          .join("\n")
          .replace(/\n{2,}/g, "\n\n")
          .trim();
      };

      /*
       * gomplate answers file.Exists against the directory it runs in, so
       * each template is rendered from an empty directory and from one with
       * an SslCertificates directory, and the renderer is told the same.
       */
      for (const withCertificates of [false, true]) {
        const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "gomplate-parity-"));

        try {
          if (withCertificates) {
            fs.mkdirSync(path.join(cwd, "SslCertificates"));
          }

          for (const template of ALL_TEMPLATES) {
            const templatePath = path.join(REPO_ROOT, template);

            for (const environment of ["production", "development"]) {
              const result = spawnSync("gomplate", ["-f", templatePath], {
                cwd,
                encoding: "utf8",
                env: { ...process.env, ENVIRONMENT: environment },
              });
              const ours = render(
                fs.readFileSync(templatePath, "utf8"),
                environment,
                {
                  fileExists: (relativePath) => {
                    return fs.existsSync(path.join(cwd, relativePath));
                  },
                },
              );

              expect({ template, environment, status: result.status }).toEqual({
                template,
                environment,
                status: 0,
              });
              expect({
                template,
                environment,
                withCertificates,
                rendered: normalise(ours),
              }).toEqual({
                template,
                environment,
                withCertificates,
                rendered: normalise(result.stdout),
              });
            }
          }
        } finally {
          fs.rmSync(cwd, { recursive: true, force: true });
        }
      }
    },
    120000,
  );
});

describe("packages/App/Dockerfile.tpl: the production build", () => {
  test("has the edition stage graph, with community last (the default target)", () => {
    expect(
      productionStages.map((candidate) => {
        return `${candidate.name} <- ${candidate.from}`;
      }),
    ).toEqual([
      "base <- public.ecr.aws/docker/library/node:26-alpine3.24",
      "community-build <- base",
      "enterprise-build <- community-build",
      "enterprise <- enterprise-build",
      "community <- community-build",
    ]);
  });

  test("the whole Community build (frontends and compile) is shared by both targets", () => {
    const shared = stageInstructions("community-build");

    expect(shared).toContain("RUN npm run build-frontends:prod");
    expect(shared).toContain("RUN npm run compile");
    expect(
      ancestry(productionStages, "enterprise").map((s) => {
        return s.name;
      }),
    ).toEqual(["enterprise", "enterprise-build", "community-build", "base"]);
  });

  test("GIT_SHA and APP_VERSION reach the build before the frontends bake them into the service worker", () => {
    const shared = stageInstructions("community-build");
    const buildIndex = shared.indexOf("RUN npm run build-frontends:prod");

    expect(shared.indexOf("ARG GIT_SHA")).toBeGreaterThan(-1);
    expect(shared.indexOf("ARG APP_VERSION")).toBeGreaterThan(-1);
    for (const env of [
      "ENV APP_VERSION=${APP_VERSION}",
      "ENV GIT_SHA=${GIT_SHA}",
    ]) {
      expect(shared.indexOf(env)).toBeGreaterThan(-1);
      expect(shared.indexOf(env)).toBeLessThan(buildIndex);
    }
  });

  test("declares no IS_ENTERPRISE_EDITION build arg: the edition is the target, not an arg", () => {
    expect(productionDockerfile).not.toMatch(
      /^\s*ARG\s+IS_ENTERPRISE_EDITION/m,
    );
  });

  test("no shared stage switches to USER node (enterprise-build still runs as root)", () => {
    for (const name of ["base", "community-build", "enterprise-build"]) {
      expect({
        name,
        user: stageInstructions(name).filter((line) => {
          return /^USER\s/.test(line);
        }),
      }).toEqual({ name, user: [] });
    }
  });

  describe("the community target", () => {
    test("nothing it is built from copies ee/", () => {
      expect(
        ancestryInstructions("community").filter((line) => {
          return COPIES_EE.test(`${line} `);
        }),
      ).toEqual([]);
    });

    test("nothing it is built from mentions /usr/src/ee at all", () => {
      expect(
        ancestryInstructions("community").filter((line) => {
          return line.includes("/usr/src/ee");
        }),
      ).toEqual([]);
    });

    test("refuses bundles that contain the Enterprise UI", () => {
      const guard = stageInstructions("community").find((line) => {
        return line.startsWith("RUN if grep");
      });

      expect(guard).toBeDefined();
      expect(guard).toContain(`-e ${DASHBOARD_SENTINEL}`);
      expect(guard).toContain(`-e ${ADMIN_DASHBOARD_SENTINEL}`);
      expect(guard).toContain("FeatureSet/Dashboard/public/dist");
      expect(guard).toContain("FeatureSet/AdminDashboard/public/dist");
      expect(guard).toMatch(/then .*exit 1; fi$/);
    });

    test("is labelled Apache-2.0 and community, and says IS_ENTERPRISE_EDITION=false", () => {
      const lines = stageInstructions("community");

      expect(lines).toContain(
        'LABEL org.opencontainers.image.licenses="Apache-2.0"',
      );
      expect(lines).toContain('LABEL com.oneuptime.edition="community"');
      expect(lines).toContain("ENV IS_ENTERPRISE_EDITION=false");
    });

    test("leaves ONEUPTIME_EDITION unset (auto)", () => {
      expect(
        ancestryInstructions("community").filter((line) => {
          return /ONEUPTIME_EDITION/.test(line);
        }),
      ).toEqual([]);
    });
  });

  describe("the enterprise target", () => {
    const build = stageInstructions("enterprise-build");

    function indexOfLine(predicate, what) {
      const index = build.findIndex(predicate);
      if (index === -1) {
        throw new Error(`enterprise-build has no ${what}`);
      }
      return index;
    }

    test("recreates the repository layout ee/package.json links against", () => {
      const links = build.find((line) => {
        return line.includes("/usr/src/packages");
      });

      expect(links).toBe(
        "RUN mkdir -p /usr/src/packages && ln -s ../Common /usr/src/packages/Common && ln -s ../app /usr/src/packages/App",
      );
    });

    test("installs ee from its lockfile first, with --ignore-scripts, then copies the sources", () => {
      const lockfile = indexOfLine((line) => {
        return line === "COPY ./ee/package*.json /usr/src/ee/";
      }, "lockfile COPY");
      const install = indexOfLine((line) => {
        return /^RUN .*npm ci\b/.test(line);
      }, "npm ci");
      const sources = indexOfLine((line) => {
        return line === "COPY ./ee /usr/src/ee";
      }, "source COPY");
      const workdir = indexOfLine((line) => {
        return line === "WORKDIR /usr/src/ee";
      }, "WORKDIR /usr/src/ee");

      expect(workdir).toBeLessThan(install);
      expect(lockfile).toBeLessThan(install);
      expect(install).toBeLessThan(sources);
      expect(build[install]).toContain("--ignore-scripts");
    });

    test("type-checks the ee server with ee's own tsc before anything ships", () => {
      const typeCheck = indexOfLine((line) => {
        return line === "RUN ./node_modules/.bin/tsc -p tsconfig.json";
      }, "ee tsc");
      const sources = build.indexOf("COPY ./ee /usr/src/ee");
      const workdirs = build
        .map((line, index) => {
          return { line, index };
        })
        .filter((entry) => {
          return entry.line.startsWith("WORKDIR ") && entry.index < typeCheck;
        });

      expect(typeCheck).toBeGreaterThan(sources);
      expect(workdirs[workdirs.length - 1].line).toBe("WORKDIR /usr/src/ee");
    });

    test("rebuilds ONLY the Dashboard and Admin Dashboard, as the enterprise edition", () => {
      const rebuilds = build.filter((line) => {
        return line.includes("frontend-run.sh");
      });

      expect(rebuilds).toEqual([
        "RUN ONEUPTIME_EDITION=enterprise bash scripts/frontend-run.sh FeatureSet/Dashboard build && ONEUPTIME_EDITION=enterprise bash scripts/frontend-run.sh FeatureSet/AdminDashboard build",
      ]);
      expect(
        build.filter((line) => {
          return /build-frontends|Accounts|StatusPage|PublicDashboard/.test(
            line,
          );
        }),
      ).toEqual([]);
    });

    test("refuses bundles without the ee sentinels, after the rebuild", () => {
      const rebuild = indexOfLine((line) => {
        return line.includes("frontend-run.sh");
      }, "frontend rebuild");
      const dashboardGuard = indexOfLine((line) => {
        return line.startsWith(
          `RUN grep -rqF ${DASHBOARD_SENTINEL} FeatureSet/Dashboard/public/dist ||`,
        );
      }, "Dashboard sentinel check");
      const adminGuard = indexOfLine((line) => {
        return line.startsWith(
          `RUN grep -rqF ${ADMIN_DASHBOARD_SENTINEL} FeatureSet/AdminDashboard/public/dist ||`,
        );
      }, "Admin Dashboard sentinel check");

      expect(dashboardGuard).toBeGreaterThan(rebuild);
      expect(adminGuard).toBeGreaterThan(rebuild);
      expect(build[dashboardGuard]).toMatch(/exit 1; }$/);
      expect(build[adminGuard]).toMatch(/exit 1; }$/);
    });

    test("drops ee's devDependencies only after the type-check needed them", () => {
      const typeCheck = build.indexOf(
        "RUN ./node_modules/.bin/tsc -p tsconfig.json",
      );
      const prune = indexOfLine((line) => {
        return line.startsWith("RUN npm --prefix /usr/src/ee prune");
      }, "prune");

      expect(prune).toBeGreaterThan(typeCheck);
      expect(build[prune]).toBe(
        "RUN npm --prefix /usr/src/ee prune --omit=dev --ignore-scripts",
      );
    });

    test("carries the loader's marker and the Enterprise labels", () => {
      const lines = stageInstructions("enterprise");

      expect(lines).toContain("ENV ONEUPTIME_EDITION=enterprise");
      expect(lines).toContain(
        'LABEL org.opencontainers.image.licenses="Apache-2.0 AND LicenseRef-OneUptime-Enterprise"',
      );
      expect(lines).toContain('LABEL com.oneuptime.edition="enterprise"');
      expect(lines).toContain("ENV IS_ENTERPRISE_EDITION=true");
    });
  });
});

describe("packages/App/Dockerfile.tpl: the development build", () => {
  test("is one stage and never copies ee/ (ee/ is mounted instead)", () => {
    expect(developmentStages).toHaveLength(1);
    expect(
      instructions(developmentStages[0].body).filter((line) => {
        return COPIES_EE.test(`${line} `);
      }),
    ).toEqual([]);
  });

  test("recreates the /usr/src/packages links the mounted ee/ resolves Common and App through", () => {
    expect(instructions(developmentStages[0].body)).toContain(
      "RUN mkdir -p /usr/src/packages && ln -s ../Common /usr/src/packages/Common && ln -s ../app /usr/src/packages/App",
    );
  });

  test("still runs the dev script", () => {
    expect(instructions(developmentStages[0].body)).toContain(
      'CMD [ "npm", "run", "dev" ]',
    );
  });
});

/*
 * Every image is built with the repository root as its context, so ee/ is in
 * every build context: the tests above pin the App's community ancestry, and
 * this block holds EVERY stage of EVERY Dockerfile.tpl (both renders, with
 * and without the optional file.Exists blocks) to "takes nothing from ee/",
 * except the App's enterprise-build and enterprise stages. See
 * Utils/DockerfileContext.js for every way in it checks.
 */
describe("no image but the App's enterprise target can pick up ee/", () => {
  const leaksOf = (dockerfile, allowed) => {
    return findEnterpriseLeaks(parseStages(dockerfile), allowed || []);
  };

  const stageWith = (...lines) => {
    return ["FROM public.ecr.aws/docker/library/node:26-alpine3.24", ...lines]
      .join("\n")
      .concat("\n");
  };

  describe("the leak finder's own machinery", () => {
    test.each([
      ["COPY . /usr/src/app"],
      ["COPY ./ /usr/src"],
      ["COPY --chown=1000:1000 . /usr/src/app"],
      ["ADD . /x"],
      ['COPY ["./ee", "/usr/src/ee"]'],
      ['COPY --chown=1000:1000 [".", "/usr/src/app"]'],
      ['COPY ["./packages/Common", "./ee/Server", "/usr/src/"]'],
      ["COPY ./packages/Common ./ee /usr/src/"],
      ["COPY ee /usr/src/ee"],
      ["COPY ./ee/Server/Index.ts /usr/src/ee/Server/Index.ts"],
      ["COPY ./ee/package*.json /usr/src/ee/"],
      ["COPY / /usr/src/app"],
      ["COPY packages/.. /usr/src/app"],
      ["COPY ../ee /usr/src/ee"],
      ["COPY * /usr/src/"],
      ["COPY e? /usr/src/"],
      ["COPY [e]e /usr/src/"],
      ["COPY */Server /usr/src/Server"],
      ["COPY EE /usr/src/ee"],
      ['COPY "./ee" /usr/src/ee'],
      ["COPY $SOURCE /usr/src/app"],
      ["copy . /usr/src/app"],
      ["COPY --link --chmod=755 . /usr/src/app"],
      ["COPY --exclude=ee . /usr/src/app"],
      ["ONBUILD COPY . /usr/src/app"],
      ['COPY ["./ee", /usr/src/ee]'],
      ["RUN --mount=type=bind,target=/context cp -r /context/ee /usr/src/ee"],
      ["RUN --mount=target=/context cp -r /context/ee /usr/src/ee"],
      ["RUN --mount=type=bind,source=ee,target=/ee cp -r /ee /usr/src/ee"],
      [
        "RUN --mount=type=cache,target=/tmp/npm --mount=type=bind,source=.,target=/src true",
      ],
    ])("refuses %s (negative control)", (line) => {
      expect(leaksOf(stageWith(line))).toHaveLength(1);
    });

    test.each([
      ["COPY ./packages/Common /usr/src/Common"],
      ["COPY --chown=1000:1000 ./packages/App /usr/src/app"],
      ["COPY ./packages/Common/package*.json /usr/src/Common/"],
      ["COPY --chown=1000:1000 ./Tests ."],
      ["COPY ./SslCertificates /usr/local/share/ca-certificates"],
      ["COPY ./free /usr/src/free"],
      ["COPY ./eel /usr/src/eel"],
      ["COPY ./packages/Common/UI/Components/EE /usr/src/x"],
      ["COPY e /usr/src/e"],
      ["ADD https://example.com/archive.tgz /usr/src/"],
      ["ADD git@github.com:OneUptime/oneuptime.git /usr/src/"],
      ["COPY <<EOF /usr/src/app/config.json"],
      ["RUN --mount=type=cache,target=/tmp/npm npm ci --prefer-offline"],
      ["RUN --mount=type=secret,id=npmrc cat /run/secrets/npmrc"],
      [
        "RUN --mount=type=bind,source=packages/Common,target=/common ls /common",
      ],
      ["RUN cp -r . /usr/src/app"],
    ])("allows %s", (line) => {
      expect(leaksOf(stageWith(line))).toEqual([]);
    });

    test("a --from copy reads its stage, not the context, unless that stage holds ee/", () => {
      const dockerfile = [
        "FROM node:26 AS builder",
        "COPY ./packages/Common /usr/src/Common",
        "FROM node:26 AS enterprise-build",
        "COPY ./ee /usr/src/ee",
        "FROM node:26 AS community",
        // From a clean stage, even its root ("."), is fine...
        "COPY --from=builder . /usr/src/app",
        "COPY --from=node:26-alpine /usr/local/bin/node /usr/local/bin/node",
        // ...from the stage that holds ee/, by name or by index, is not.
        "COPY --from=enterprise-build /usr/src/ee /usr/src/ee",
        "COPY --from=1 /usr/src/ee /usr/src/ee",
        "RUN --mount=type=bind,from=enterprise-build,source=/usr/src/ee,target=/ee cp -r /ee /usr/src/ee",
        "RUN --mount=type=cache,from=Enterprise-Build,source=/usr/src/ee,target=/ee true",
        "",
      ].join("\n");

      expect(
        leaksOf(dockerfile, ["enterprise-build"]).map((leak) => {
          return `${leak.stage}: ${leak.instruction}`;
        }),
      ).toEqual([
        "community: COPY --from=enterprise-build /usr/src/ee /usr/src/ee",
        "community: COPY --from=1 /usr/src/ee /usr/src/ee",
        "community: RUN --mount=type=bind,from=enterprise-build,source=/usr/src/ee,target=/ee cp -r /ee /usr/src/ee",
        "community: RUN --mount=type=cache,from=Enterprise-Build,source=/usr/src/ee,target=/ee true",
      ]);
    });

    test("a stage built FROM the allowed stage is a leak", () => {
      const dockerfile = [
        "FROM node:26 AS enterprise-build",
        "COPY ./ee /usr/src/ee",
        "FROM enterprise-build AS community",
        "",
      ].join("\n");

      expect(leaksOf(dockerfile, ["enterprise-build"])).toEqual([
        {
          stage: "community",
          instruction: "FROM enterprise-build",
          problem: "is built FROM a stage that holds ee/",
        },
      ]);
    });

    test("names unnamed stages by index and says why", () => {
      expect(
        leaksOf(
          "FROM node:26\nCOPY ./ee /usr/src/ee\nFROM node:26\nCOPY . /app\n",
        ),
      ).toEqual([
        {
          stage: "#0",
          instruction: "COPY ./ee /usr/src/ee",
          problem: "./ee: has an ee path segment",
        },
        {
          stage: "#1",
          instruction: "COPY . /app",
          problem: ".: copies the whole build context, which includes ee/",
        },
      ]);
    });

    test("parses the shell and JSON forms of COPY and ADD", () => {
      expect(parseCopy("COPY --chown=1000:1000 --link a b /dest/")).toEqual({
        instruction: "COPY",
        from: undefined,
        sources: ["a", "b"],
        destination: "/dest/",
      });
      expect(parseCopy('add --chmod=644 ["a b", "c", "/dest"]')).toEqual({
        instruction: "ADD",
        from: undefined,
        sources: ["a b", "c"],
        destination: "/dest",
      });
      expect(parseCopy("COPY --from=base /usr/src /usr/src").from).toBe("base");
      // Malformed JSON is the shell form to Docker, and is checked both ways.
      expect(parseCopy('COPY ["./ee", /usr/src/ee]')).toEqual({
        instruction: "COPY",
        from: undefined,
        sources: ['["./ee",'],
        alternativeSources: ["./ee"],
        destination: "/usr/src/ee]",
      });
      expect(parseCopy("RUN cp . /x")).toBeNull();
      expect(
        parseRunMounts(
          "RUN --mount=type=bind,source=ee,target=/ee --mount=type=cache,target=/c true",
        ),
      ).toEqual([
        { type: "bind", source: "ee", target: "/ee" },
        { type: "cache", target: "/c" },
      ]);
    });

    test.each([
      ["*", "ee", true],
      ["e?", "ee", true],
      ["?e", "ee", true],
      ["[a-f]e", "ee", true],
      ["[!e]e", "ee", false],
      ["[^e]e", "ee", false],
      ["e\\e", "ee", true],
      ["e", "ee", false],
      ["eee*", "ee", false],
      ["p*", "ee", false],
    ])("glob %s matches %s: %s", (pattern, name, expected) => {
      expect(globMatches(pattern, name)).toBe(expected);
    });

    test.each([
      [".", true],
      ["./", true],
      ["/", true],
      ["packages/..", true],
      ["./packages/../ee/Server", true],
      ["$SOURCE", true],
      ["./packages/App", false],
      ["https://example.com/ee/archive.tgz", false],
    ])("context source %s can reach ee/: %s", (source, expected) => {
      expect(contextSourceProblem(source) !== null).toBe(expected);
    });
  });

  test("the finder sees the App's real ee copies once the allowance is taken away", () => {
    /*
     * Guards the guard: were it blind to the real `COPY ./ee`, the scan
     * below would pass no matter what the templates did.
     */
    expect(
      leaksOf(renderTemplate(APP_TEMPLATE, "production", true)).map((leak) => {
        return `${leak.stage}: ${leak.instruction}`;
      }),
    ).toEqual([
      "enterprise-build: COPY ./ee/package*.json /usr/src/ee/",
      "enterprise-build: COPY ./ee /usr/src/ee",
    ]);
  });

  const renders = ALL_TEMPLATES.flatMap((template) => {
    return ["production", "development"].flatMap((environment) => {
      return [true, false].map((optionalFilesExist) => {
        return [
          `${template} (${environment}, optional files ${
            optionalFilesExist ? "present" : "absent"
          })`,
          template,
          environment,
          optionalFilesExist,
        ];
      });
    });
  });

  test("covers every template in both renders", () => {
    expect(renders).toHaveLength(ALL_TEMPLATES.length * 4);
  });

  test.each(renders)(
    "%s takes nothing from ee/",
    (_label, template, environment, optionalFilesExist) => {
      expect(
        leaksOf(
          renderTemplate(template, environment, optionalFilesExist),
          allowedEnterpriseStages(template, environment),
        ),
      ).toEqual([]);
    },
  );
});

describe("the sentinel strings agree everywhere they are checked", () => {
  test("Scripts/GHA/check_app_image_edition.sh checks the same sentinels", () => {
    const check = read("Scripts/GHA/check_app_image_edition.sh");

    expect(check).toContain(`DASHBOARD_SENTINEL="${DASHBOARD_SENTINEL}"`);
    expect(check).toContain(`ADMIN_SENTINEL="${ADMIN_DASHBOARD_SENTINEL}"`);
  });

  describeWhenEnterprisePresent("with ee/ in the checkout", () => {
    test("the ee Dashboard plugin exports the Dashboard sentinel", () => {
      expect(read("ee/Dashboard/Index.tsx")).toContain(
        `"${DASHBOARD_SENTINEL}"`,
      );
    });

    test("the ee Admin Dashboard plugin exports the Admin Dashboard sentinel", () => {
      expect(read("ee/AdminDashboard/Index.tsx")).toContain(
        `"${ADMIN_DASHBOARD_SENTINEL}"`,
      );
    });
  });
});

describe(".dockerignore", () => {
  const entries = read(".dockerignore")
    .split("\n")
    .map((line) => {
      return line.trim();
    })
    .filter((line) => {
      return line.length > 0 && !line.startsWith("#");
    });

  test.each([
    ["ee/**/*.pem", "license-signing keys anywhere under ee/"],
    ["ee/keys", "the ee/keys directory"],
    ["ee/**/keys/", "any keys/ directory under ee/"],
    ["ee/build", "local ee build output"],
    ["ee/Tests", "ee's tests (the image does not need them)"],
    ["**/node_modules", "host node_modules, including ee/node_modules"],
  ])("excludes %s: %s", (pattern) => {
    expect(entries).toContain(pattern);
  });

  test("does not exclude ee/ itself, which the enterprise target copies", () => {
    expect(entries).not.toContain("ee");
    expect(entries).not.toContain("ee/");
    expect(entries).not.toContain("/ee");
  });
});

describe(".gitignore keeps ee key material out of the repository too", () => {
  const entries = read(".gitignore")
    .split("\n")
    .map((line) => {
      return line.trim();
    });

  test.each(["ee/**/*.pem", "ee/keys/", "ee/**/keys/", "ee/build/"])(
    "ignores %s",
    (pattern) => {
      expect(entries).toContain(pattern);
    },
  );
});

/*
 * Workflow helpers. A "step command" is a step's `run`, or the `command` of a
 * nick-fields/retry step.
 */
function stepCommand(step) {
  if (typeof step.run === "string") {
    return step.run;
  }
  if (step.with && typeof step.with.command === "string") {
    return step.with.command;
  }
  return "";
}

function removesEnterprise(step) {
  return /^\s*rm -rf ee\s*$/m.test(stepCommand(step));
}

function installsPackages(step) {
  return /\bnpm (install|ci)\b|test-setup\.sh/.test(stepCommand(step));
}

function jobsOf(workflowPath) {
  return Object.entries(readYaml(workflowPath).jobs);
}

describe("core CI is the Community Edition by construction", () => {
  const coreWorkflows = [
    ".github/workflows/compile.yml",
    ".github/workflows/test.common.yaml",
    ".github/workflows/test.app.yaml",
  ];

  const coreJobs = coreWorkflows.flatMap((workflow) => {
    return jobsOf(workflow)
      .filter(([name]) => {
        return name !== "compile-ee";
      })
      .map(([name, job]) => {
        return [`${workflow}: ${name}`, job];
      });
  });

  test("there are core jobs to check", () => {
    expect(coreJobs.length).toBeGreaterThan(15);
  });

  test.each(coreJobs)(
    "%s removes ee/ before it installs anything",
    (_label, job) => {
      const steps = job.steps || [];
      const removal = steps.findIndex(removesEnterprise);
      const firstInstall = steps.findIndex(installsPackages);

      expect(removal).toBeGreaterThan(-1);
      if (firstInstall !== -1) {
        expect(removal).toBeLessThan(firstInstall);
      }
    },
  );
});

describe("the Enterprise Edition's own CI", () => {
  test("compile-ee installs what ee type-checks against, then ee, then compiles it", () => {
    const job = readYaml(".github/workflows/compile.yml").jobs["compile-ee"];
    const commands = job.steps.map(stepCommand);
    const indexOf = (pattern) => {
      return commands.findIndex((command) => {
        return pattern.test(command);
      });
    };

    const common = indexOf(/cd packages\/Common && npm install/);
    const app = indexOf(/cd packages\/App && npm install/);
    const dashboard = indexOf(
      /cd packages\/App\/FeatureSet\/Dashboard && npm install/,
    );
    const admin = indexOf(
      /cd packages\/App\/FeatureSet\/AdminDashboard && npm install/,
    );
    const ee = indexOf(
      /cd ee && npm ci --ignore-scripts && npm run compile && npm run dep-check/,
    );

    for (const index of [common, app, dashboard, admin, ee]) {
      expect(index).toBeGreaterThan(-1);
    }
    expect(Math.max(common, app, dashboard, admin)).toBeLessThan(ee);
    expect(job.steps.some(removesEnterprise)).toBe(false);
  });

  test("test.ee.yaml sets up config.env, installs Common, App and ee, and runs ee's tests", () => {
    const workflow = readYaml(".github/workflows/test.ee.yaml");
    const jobs = Object.values(workflow.jobs);

    expect(jobs).toHaveLength(1);

    const steps = jobs[0].steps;
    const find = (predicate) => {
      return steps.findIndex(predicate);
    };
    const inDirectory = (directory, pattern) => {
      return (step) => {
        return (
          step["working-directory"] === directory &&
          pattern.test(stepCommand(step))
        );
      };
    };

    const setup = find(inDirectory("packages/Common", /bash test-setup\.sh/));
    const common = find(inDirectory("packages/Common", /^npm install$/));
    const app = find(inDirectory("packages/App", /^npm install$/));
    const ee = find(inDirectory("ee", /^npm ci --ignore-scripts$/));
    const test = find(inDirectory("ee", /^npm test$/));

    for (const index of [setup, common, app, ee, test]) {
      expect(index).toBeGreaterThan(-1);
    }
    expect(setup).toBeLessThan(test);
    expect(Math.max(common, app)).toBeLessThan(ee);
    expect(ee).toBeLessThan(test);
    expect(steps.some(removesEnterprise)).toBe(false);
    expect(workflow.on).toHaveProperty("pull_request");
  });

  test("test.ee.yaml runs App's Enterprise boundary guards with ee/ present, after installing App", () => {
    /*
     * The guards' ee-direction checks skip without ee/, and the App Test job
     * deletes ee/, so this step is the only place they run.
     */
    const steps = Object.values(
      readYaml(".github/workflows/test.ee.yaml").jobs,
    )[0].steps;
    const indexOf = (predicate) => {
      return steps.findIndex(predicate);
    };
    const app = indexOf((step) => {
      return (
        step["working-directory"] === "packages/App" &&
        /^npm install$/.test(stepCommand(step))
      );
    });
    const guards = indexOf((step) => {
      return (
        step["working-directory"] === "packages/App" &&
        stepCommand(step).trim() ===
          "node node_modules/.bin/jest Tests/EnterpriseImportGuard.test.ts Tests/EnterprisePluginResolution.test.ts --forceExit"
      );
    });

    expect(app).toBeGreaterThan(-1);
    expect(guards).toBeGreaterThan(app);
    expect(steps.slice(0, guards).some(removesEnterprise)).toBe(false);
    for (const guard of [
      "packages/App/Tests/EnterpriseImportGuard.test.ts",
      "packages/App/Tests/EnterprisePluginResolution.test.ts",
    ]) {
      expect(fs.existsSync(path.join(REPO_ROOT, guard))).toBe(true);
    }
  });

  describeWhenEnterprisePresent("with ee/ in the checkout", () => {
    test("ee's test script exports config.env like App's, so it runs with the same BILLING_ENABLED", () => {
      const scripts = JSON.parse(read("ee/package.json")).scripts;

      expect(scripts.test).toContain(
        "export $(grep -v '^#' config.env | xargs)",
      );
      expect(scripts.compile).toContain("tsc -p tsconfig.json");
    });

    test('ee/package.json has no "type" field (the root is ESM; ee must stay CommonJS)', () => {
      expect(JSON.parse(read("ee/package.json"))).not.toHaveProperty("type");
    });
  });
});

describe("the Build workflow builds and checks both App editions", () => {
  const job = readYaml(".github/workflows/build.yml").jobs["docker-build-app"];
  const commands = job.steps.map(stepCommand);
  const indexOf = (pattern) => {
    return commands.findIndex((command) => {
      return pattern.test(command);
    });
  };

  test("builds the community target from scratch, then the enterprise target on its cache", () => {
    const community = indexOf(
      /docker build --no-cache --target community .*-f \.\/packages\/App\/Dockerfile \./,
    );
    const enterprise = indexOf(
      /docker build --target enterprise .*-f \.\/packages\/App\/Dockerfile \./,
    );

    expect(community).toBeGreaterThan(-1);
    expect(enterprise).toBeGreaterThan(community);
    expect(commands[enterprise]).not.toContain("--no-cache");
  });

  test("checks each image is the edition it claims, after both builds", () => {
    const enterprise = indexOf(/--target enterprise/);
    const checkCommunity = indexOf(
      /check_app_image_edition\.sh --image oneuptime-app:community --edition community/,
    );
    const checkEnterprise = indexOf(
      /check_app_image_edition\.sh --image oneuptime-app:enterprise --edition enterprise/,
    );

    expect(checkCommunity).toBeGreaterThan(enterprise);
    expect(checkEnterprise).toBeGreaterThan(enterprise);
  });

  test("the images it checks are the ones it built", () => {
    expect(commands[indexOf(/--target community/)]).toContain(
      "-t oneuptime-app:community",
    );
    expect(commands[indexOf(/--target enterprise/)]).toContain(
      "-t oneuptime-app:enterprise",
    );
  });
});

describe("release workflows", () => {
  const releaseWorkflows = [
    ".github/workflows/release.yml",
    ".github/workflows/test-release.yaml",
  ];

  function appTagExports(job) {
    return job.steps.flatMap((step) => {
      return stepCommand(step)
        .split("\n")
        .map((line) => {
          return line.trim();
        })
        .filter((line) => {
          return (
            /^export APP_TAG=/.test(line) || /^SANITIZED_VERSION=/.test(line)
          );
        });
    });
  }

  function enablesBilling(job) {
    return job.steps.some((step) => {
      return stepCommand(step).includes("enable-billing-env-var.sh");
    });
  }

  const allJobs = releaseWorkflows.flatMap((workflow) => {
    return jobsOf(workflow).map(([name, job]) => {
      return [`${workflow}: ${name}`, name, job];
    });
  });

  const billingJobs = allJobs.filter(([, , job]) => {
    return Array.isArray(job.steps) && enablesBilling(job);
  });

  test("the SaaS e2e jobs are the ones that enable billing", () => {
    expect(
      billingJobs
        .map(([, name]) => {
          return name;
        })
        .sort(),
    ).toEqual(["test-e2e-release-saas", "test-e2e-test-saas"]);
  });

  test.each(billingJobs)(
    "%s runs the enterprise tags (billing on requires ee/ to be loaded)",
    (_label, _name, job) => {
      const exports = appTagExports(job);

      expect(exports.length).toBeGreaterThan(0);
      for (const line of exports) {
        expect(line).toMatch(
          /^(export APP_TAG|SANITIZED_VERSION)="?enterprise-/,
        );
      }
    },
  );

  const selfHostedJobs = allJobs.filter(([, name]) => {
    return /self-hosted/.test(name);
  });

  test("there are self-hosted e2e jobs", () => {
    expect(selfHostedJobs.length).toBe(2);
  });

  test.each(selfHostedJobs)(
    "%s stays on the Community tags",
    (_label, _name, job) => {
      const exports = appTagExports(job);

      expect(exports.length).toBeGreaterThan(0);
      for (const line of exports) {
        expect(line).not.toContain("enterprise-");
      }
    },
  );

  const merges = releaseWorkflows.flatMap((workflow) => {
    return jobsOf(workflow).flatMap(([name, job]) => {
      return (job.steps || [])
        .map(stepCommand)
        .filter((command) => {
          return command.includes("merge_docker_manifests.sh");
        })
        .map((command) => {
          return [`${workflow}: ${name}`, command];
        });
    });
  });

  test("there are image merge jobs to check", () => {
    expect(merges.length).toBeGreaterThan(10);
  });

  test.each(merges)(
    "%s publishes the enterprise- tag the SaaS e2e and Helm pull",
    (_label, command) => {
      expect(command).toMatch(
        /--tags "[^"]*enterprise-\$\{SANITIZED_VERSION\}/,
      );
    },
  );
});

describe("nothing that deploys the images sets ONEUPTIME_EDITION", () => {
  /*
   * The Enterprise image sets ONEUPTIME_EDITION=enterprise itself: it is the
   * loader's marker that ee/ must load. A compose or Helm value for it, even
   * an empty one, would override the marker and let a broken Enterprise image
   * boot as the Community Edition.
   */
  /*
   * Scripts/Dev/docker-compose.dev.yml is not here: it builds the App from
   * source (no image marker to override) and passes ONEUPTIME_EDITION through
   * on purpose; "the dev loop" below pins exactly how.
   */
  test.each([
    "docker-compose.yml",
    "docker-compose.base.yml",
    "packages/E2E/docker-compose.e2e.yml",
    "packages/E2E/docker-compose.billing.yml",
    "packages/E2E/docker-compose.e2e-clickhouse.yml",
  ])("%s", (composeFile) => {
    const code = read(composeFile)
      .split("\n")
      .filter((line) => {
        return !/^\s*#/.test(line);
      })
      .join("\n");

    expect(code).not.toMatch(/ONEUPTIME_EDITION/);
  });

  test("the Helm chart's templates", () => {
    const templatesDir = path.join(
      REPO_ROOT,
      "HelmChart",
      "Public",
      "oneuptime",
      "templates",
    );
    const offenders = fs.readdirSync(templatesDir).filter((file) => {
      const full = path.join(templatesDir, file);
      if (!fs.statSync(full).isFile()) {
        return false;
      }
      const code = fs
        .readFileSync(full, "utf8")
        .replace(/\{\{-?\s*\/\*[\s\S]*?\*\/\s*-?\}\}/g, "");
      return /ONEUPTIME_EDITION/.test(code);
    });

    expect(offenders).toEqual([]);
  });

  test("config.example.env documents the edition as the image tag, and has no ONEUPTIME_EDITION key", () => {
    const example = read("config.example.env");

    expect(example).toMatch(/^APP_TAG=release$/m);
    expect(example).toContain("enterprise-release");
    expect(example).toMatch(/^IS_ENTERPRISE_EDITION=false$/m);
    expect(example).toMatch(/DEPRECATED[^\n]*picks the edition/);
    expect(example).not.toMatch(/^ONEUPTIME_EDITION=/m);
  });
});

describe("the dev loop", () => {
  const devCompose = readYaml("Scripts/Dev/docker-compose.dev.yml");

  test("the dev app mounts ee/ and keeps its node_modules in an anonymous volume", () => {
    const volumes = devCompose.services.app.volumes;

    expect(volumes).toContain("./ee:/usr/src/ee:cached");
    expect(volumes).toContain("/usr/src/ee/node_modules/");
  });

  /*
   * ee/README.md promises ONEUPTIME_EDITION=community runs the Community
   * Edition from the same checkout, and the dev app always mounts ee/. So the
   * dev app passes the variable through, defaulting to auto (never a
   * hard-coded edition), and the extends merge keeps the base variables.
   */
  test("the dev app passes ONEUPTIME_EDITION through, defaulting to auto", () => {
    const environment = devCompose.services.app.environment;

    expect(environment).toEqual({
      ONEUPTIME_EDITION: "${ONEUPTIME_EDITION:-auto}",
    });
    expect(devCompose.services.app.extends).toEqual({
      file: "./docker-compose.base.yml",
      service: "app",
    });
  });

  test("no other dev service sets ONEUPTIME_EDITION", () => {
    const others = Object.entries(devCompose.services).filter(
      ([name, service]) => {
        return (
          name !== "app" &&
          JSON.stringify(service.environment || {}).includes(
            "ONEUPTIME_EDITION",
          )
        );
      },
    );

    expect(others).toEqual([]);
  });

  test("no other dev service mounts ee/", () => {
    const others = Object.entries(devCompose.services).filter(
      ([name, service]) => {
        return (
          name !== "app" &&
          (service.volumes || []).some((volume) => {
            return String(volume).includes("/usr/src/ee");
          })
        );
      },
    );

    expect(others).toEqual([]);
  });

  test("nodemon restarts the App when ee/Server changes", () => {
    expect(JSON.parse(read("packages/App/nodemon.json")).watch).toContain(
      "../ee/Server",
    );
  });

  test("dev.sh installs ee's dependencies before anything builds or boots", () => {
    const devScript = read("packages/App/scripts/dev.sh");
    const call = devScript.indexOf("\ninstall_enterprise_deps /usr/src/ee\n");

    expect(call).toBeGreaterThan(-1);
    expect(call).toBeLessThan(devScript.indexOf("npm run build-frontends"));
    expect(call).toBeLessThan(devScript.indexOf("npm run dev:api"));
  });
});

/*
 * install_enterprise_deps() is run for real, extracted from dev.sh, with a
 * fake npm on PATH.
 */
describe("dev.sh: install_enterprise_deps", () => {
  const devScript = read("packages/App/scripts/dev.sh");
  const functionSource = (devScript.match(
    /^install_enterprise_deps\(\) \{\n[\s\S]*?\n\}\n/m,
  ) || [""])[0];
  const workspaces = [];

  afterAll(() => {
    for (const dir of workspaces) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function workspace() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ee-dev-deps-"));
    workspaces.push(dir);
    const bin = path.join(dir, "bin");
    fs.mkdirSync(bin);
    fs.writeFileSync(
      path.join(bin, "npm"),
      '#!/usr/bin/env bash\necho "$PWD $*" >> "$FAKE_NPM_LOG"\nif [ "${FAKE_NPM_FAILS:-false}" = "true" ]; then exit 1; fi\nmkdir -p node_modules\n',
      { mode: 0o755 },
    );
    fs.writeFileSync(
      path.join(dir, "harness.sh"),
      `set -euo pipefail\n${functionSource}\ninstall_enterprise_deps "$1"\n`,
    );
    return dir;
  }

  function run(dir, eeDir, extraEnv) {
    return spawnSync("bash", [path.join(dir, "harness.sh"), eeDir], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${path.join(dir, "bin")}:${process.env.PATH}`,
        FAKE_NPM_LOG: path.join(dir, "npm.log"),
        ...(extraEnv || {}),
      },
    });
  }

  function npmCalls(dir) {
    const log = path.join(dir, "npm.log");
    return fs.existsSync(log)
      ? fs.readFileSync(log, "utf8").trim().split("\n")
      : [];
  }

  function makeEe(dir, lock) {
    const eeDir = path.join(dir, "ee");
    fs.mkdirSync(eeDir, { recursive: true });
    fs.writeFileSync(path.join(eeDir, "package.json"), "{}\n");
    fs.writeFileSync(path.join(eeDir, "package-lock.json"), lock);
    return eeDir;
  }

  test("is found in dev.sh", () => {
    expect(functionSource).toContain("npm ci --ignore-scripts");
  });

  test("does nothing without ee/ (a Community-only checkout)", () => {
    const dir = workspace();
    const result = run(dir, path.join(dir, "no-ee"));

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("runs as the Community Edition");
    expect(npmCalls(dir)).toEqual([]);
  });

  test("runs npm ci --ignore-scripts in ee/, once per lockfile", () => {
    const dir = workspace();
    const eeDir = makeEe(dir, '{"lockfileVersion":3}\n');

    expect(run(dir, eeDir).status).toBe(0);
    expect(npmCalls(dir)).toEqual([`${eeDir} ci --ignore-scripts`]);

    const second = run(dir, eeDir);
    expect(second.status).toBe(0);
    expect(second.stdout).toContain("up to date");
    expect(npmCalls(dir)).toHaveLength(1);
  });

  test("reinstalls when the lockfile changes", () => {
    const dir = workspace();
    const eeDir = makeEe(dir, '{"lockfileVersion":3}\n');

    run(dir, eeDir);
    fs.writeFileSync(
      path.join(eeDir, "package-lock.json"),
      '{"lockfileVersion":3,"changed":true}\n',
    );
    run(dir, eeDir);

    expect(npmCalls(dir)).toHaveLength(2);
  });

  test("fails loudly, and remembers nothing, when the install fails", () => {
    const dir = workspace();
    const eeDir = makeEe(dir, '{"lockfileVersion":3}\n');

    const failed = run(dir, eeDir, { FAKE_NPM_FAILS: "true" });
    expect(failed.status).not.toBe(0);
    expect(failed.stderr).toContain(
      "Installing the Enterprise Edition dependencies",
    );

    const retried = run(dir, eeDir);
    expect(retried.status).toBe(0);
    expect(npmCalls(dir)).toHaveLength(2);
  });
});

/*
 * The Scripts/Dev node_modules scripts, each run for real in a throwaway
 * repository with a fake npm (and ncu) on PATH that logs "<dir> <args>".
 * ee/package.json links packages/Common and packages/App (file:), so ee/ must
 * come after them, and --ignore-scripts keeps npm from running the linked
 * packages' lifecycle scripts too.
 */
describe("Scripts/Dev node_modules scripts and ee/", () => {
  const workspaces = [];

  afterAll(() => {
    for (const dir of workspaces) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function repository(script, withEnterprise) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dev-node-modules-"));
    workspaces.push(root);
    fs.mkdirSync(path.join(root, "Scripts", "Dev"), { recursive: true });
    fs.copyFileSync(
      path.join(REPO_ROOT, "Scripts", "Dev", script),
      path.join(root, "Scripts", "Dev", script),
    );
    const packages = ["packages/Common", "packages/App", "agents/DockerAgent"];
    if (withEnterprise) {
      packages.push("ee");
    }
    for (const dir of packages) {
      fs.mkdirSync(path.join(root, dir, "node_modules", "left-pad"), {
        recursive: true,
      });
      fs.writeFileSync(path.join(root, dir, "package.json"), "{}\n");
      fs.writeFileSync(path.join(root, dir, "package-lock.json"), "{}\n");
    }
    fs.mkdirSync(path.join(root, "Docs"));
    if (withEnterprise) {
      fs.mkdirSync(path.join(root, "ee", "Server"));
      fs.writeFileSync(
        path.join(root, "ee", "Server", "Index.ts"),
        "export {};\n",
      );
    }
    const bin = path.join(root, "fake-bin");
    fs.mkdirSync(bin);
    for (const tool of ["npm", "ncu"]) {
      fs.writeFileSync(
        path.join(bin, tool),
        `#!/usr/bin/env bash\necho "$(basename "$PWD") ${tool} $*" >> "$FAKE_TOOL_LOG"\n`,
        { mode: 0o755 },
      );
    }
    return root;
  }

  function run(root, script) {
    const log = path.join(root, "tools.log");
    const result = spawnSync(
      "bash",
      [path.join(root, "Scripts", "Dev", script)],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${path.join(root, "fake-bin")}:${process.env.PATH}`,
          FAKE_TOOL_LOG: log,
        },
      },
    );
    return {
      result,
      calls: fs.existsSync(log)
        ? fs.readFileSync(log, "utf8").trim().split("\n")
        : [],
    };
  }

  function enterpriseCalls(calls) {
    return calls.filter((call) => {
      return call.startsWith("ee ");
    });
  }

  test("install-node-modules.sh installs ee/ last, with npm ci --ignore-scripts", () => {
    const root = repository("install-node-modules.sh", true);
    const { result, calls } = run(root, "install-node-modules.sh");

    expect(result.status).toBe(0);
    expect(calls[calls.length - 1]).toBe("ee npm ci --ignore-scripts");
    expect(calls).toContain("Common npm install --force");
    expect(calls).toContain("App npm install --force");
    expect(enterpriseCalls(calls)).toEqual(["ee npm ci --ignore-scripts"]);
    // npm ci installs exactly the lockfile; it must not be touched.
    expect(fs.existsSync(path.join(root, "ee", "package-lock.json"))).toBe(
      true,
    );
  });

  test("install-node-modules.sh never tries ee/ in a checkout without it", () => {
    const { calls } = run(
      repository("install-node-modules.sh", false),
      "install-node-modules.sh",
    );

    expect(calls.length).toBeGreaterThan(0);
    expect(enterpriseCalls(calls)).toEqual([]);
  });

  test("clean-npm-install.sh regenerates ee/ last, with --ignore-scripts", () => {
    const root = repository("clean-npm-install.sh", true);
    const { result, calls } = run(root, "clean-npm-install.sh");

    expect(result.status).toBe(0);
    expect(calls[calls.length - 1]).toBe("ee npm install --ignore-scripts");
    expect(enterpriseCalls(calls)).toEqual(["ee npm install --ignore-scripts"]);
    expect(calls).toContain("Common npm i --force");
    expect(fs.existsSync(path.join(root, "ee", "package-lock.json"))).toBe(
      false,
    );
    expect(fs.existsSync(path.join(root, "ee", "node_modules"))).toBe(false);
  });

  test("update-node-modules.sh updates ee/ last, with --ignore-scripts", () => {
    const { result, calls } = run(
      repository("update-node-modules.sh", true),
      "update-node-modules.sh",
    );

    expect(result.status).toBe(0);
    expect(enterpriseCalls(calls)).toEqual([
      "ee ncu -u",
      "ee npm install --ignore-scripts",
    ]);
    expect(calls[calls.length - 1]).toBe("ee npm install --ignore-scripts");
  });

  test("remove-node-modules.sh removes ee/node_modules and keeps ee/ itself", () => {
    const root = repository("remove-node-modules.sh", true);
    const { result } = run(root, "remove-node-modules.sh");

    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(root, "ee", "node_modules"))).toBe(false);
    expect(fs.existsSync(path.join(root, "ee", "Server", "Index.ts"))).toBe(
      true,
    );
    expect(
      fs.existsSync(path.join(root, "packages", "App", "node_modules")),
    ).toBe(false);
  });
});

describe("the Helm charts", () => {
  test.each(["oneuptime", "kubernetes-agent"])(
    "%s is annotated Apache-2.0 on Artifact Hub",
    (chart) => {
      const chartYaml = readYaml(`HelmChart/Public/${chart}/Chart.yaml`);

      expect(chartYaml.annotations["artifacthub.io/license"]).toBe(
        "Apache-2.0",
      );
    },
  );

  test.each([
    "HelmChart/Public/oneuptime/values.yaml",
    "HelmChart/Public/oneuptime/values.schema.json",
    "HelmChart/Public/oneuptime/README.md",
    "HelmChart/Public/oneuptime/docs/configuration.md",
  ])("%s no longer claims the Enterprise images are hardened", (file) => {
    expect(read(file)).not.toMatch(
      /hardened (container )?images|images are hardened/i,
    );
  });
});

/*
 * The Ops workflow is where the checks that need tools run: gomplate for the
 * renderer parity test, and docker for the .dockerignore runtime check below.
 */
describe("the Ops workflow runs the tool-backed checks", () => {
  const steps = readYaml(".github/workflows/test.ops.yaml").jobs.test.steps;
  const indexOf = (predicate) => {
    return steps.findIndex(predicate);
  };
  const jest = indexOf((step) => {
    return /cd Tests\/Ops && npm run test/.test(stepCommand(step));
  });
  const gomplate = indexOf((step) => {
    return /gomplate --version/.test(stepCommand(step));
  });

  test("runs the jest suite with RUN_ENTERPRISE_IMAGE_RUNTIME_TESTS=1", () => {
    expect(jest).toBeGreaterThan(-1);
    expect(steps[jest].env).toEqual(
      expect.objectContaining({ RUN_ENTERPRISE_IMAGE_RUNTIME_TESTS: "1" }),
    );
  });

  test("installs gomplate before the jest suite, from the release binary, and checks it runs", () => {
    const install = stepCommand(steps[gomplate]).replace(/\\\n\s*/g, " ");

    expect(gomplate).toBeGreaterThan(-1);
    expect(gomplate).toBeLessThan(jest);
    expect(install).toContain("set -euo pipefail");
    expect(install).toMatch(
      /curl -fsSL [^\n]*"https:\/\/github\.com\/hairyhenderson\/gomplate\/releases\/download\/v\$\{GOMPLATE_VERSION\}\/gomplate_linux-amd64"/,
    );
    expect(install).toContain(
      'gomplate --version | grep -F "$GOMPLATE_VERSION"',
    );
  });

  test("the gomplate it installs is the version Scripts/Install/configure.sh pins", () => {
    /*
     * The step reads the pin out of configure.sh rather than repeating it;
     * run that line for real and compare.
     */
    const pinned = (read("Scripts/Install/configure.sh").match(
      /^GOMPLATE_VERSION="(\d+\.\d+\.\d+)"$/m,
    ) || [])[1];
    const readsVersion = stepCommand(steps[gomplate])
      .split("\n")
      .map((line) => {
        return line.trim();
      })
      .find((line) => {
        return line.startsWith("GOMPLATE_VERSION=");
      });

    expect(pinned).toBeDefined();
    expect(readsVersion).toBeDefined();

    const result = spawnSync(
      "bash",
      [
        "-c",
        `set -euo pipefail\n${readsVersion}\nprintf '%s' "$GOMPLATE_VERSION"`,
      ],
      { cwd: REPO_ROOT, encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(pinned);
  });
});

/*
 * .dockerignore semantics with real Docker (off by default: it builds a tiny
 * image; the Ops workflow turns it on). The static checks above pin the
 * entries; this proves they exclude what they are meant to from `COPY ./ee`,
 * including a nested keys/ dir, while the ee sources still go in. With the
 * variable set, an unusable docker fails the test rather than skipping it.
 *
 *   RUN_ENTERPRISE_IMAGE_RUNTIME_TESTS=1 npm test
 */
const RUNTIME = process.env["RUN_ENTERPRISE_IMAGE_RUNTIME_TESTS"] === "1";

/*
 * Every "ee/**" + "/*.<ext>" key-material pattern in .dockerignore, as its
 * extension, so a pattern added there is proven by the runtime check below
 * without touching it.
 */
function dockerignoredEnterpriseKeyExtensions() {
  return read(".dockerignore")
    .split("\n")
    .map((line) => {
      return (/^ee\/\*\*\/\*\.([A-Za-z0-9]+)$/.exec(line.trim()) || [])[1];
    })
    .filter(Boolean);
}

describe("COPY ./ee through the real .dockerignore", () => {
  test("is enabled with RUN_ENTERPRISE_IMAGE_RUNTIME_TESTS=1 (reports why it is idle otherwise)", () => {
    if (!RUNTIME) {
      console.log(
        "COPY ./ee runtime check skipped: set RUN_ENTERPRISE_IMAGE_RUNTIME_TESTS=1 (needs docker).",
      );
    }
    expect(true).toBe(true);
  });

  test("proves every ee key-material extension .dockerignore excludes (at least .pem)", () => {
    expect(dockerignoredEnterpriseKeyExtensions()).toContain("pem");
  });

  (RUNTIME ? test : test.skip)(
    "ships the ee sources and nothing else",
    () => {
      const docker = spawnSync("docker", ["version"], { encoding: "utf8" });

      if (docker.error || docker.status !== 0) {
        throw new Error(
          `RUN_ENTERPRISE_IMAGE_RUNTIME_TESTS=1, but docker is not usable: ${
            docker.error ? docker.error.message : docker.stderr.trim()
          }`,
        );
      }

      const context = fs.mkdtempSync(
        path.join(os.tmpdir(), "ee-dockerignore-"),
      );
      try {
        const write = (relativePath, contents) => {
          fs.mkdirSync(path.dirname(path.join(context, relativePath)), {
            recursive: true,
          });
          fs.writeFileSync(path.join(context, relativePath), contents);
        };
        fs.copyFileSync(
          path.join(REPO_ROOT, ".dockerignore"),
          path.join(context, ".dockerignore"),
        );
        write("ee/package.json", "{}\n");
        write("ee/LICENSE", "license\n");
        write("ee/Server/Index.ts", "export default {};\n");
        write("ee/Server/License/LicenseToken.ts", "export {};\n");
        write("ee/Dashboard/Index.tsx", "export default {};\n");
        write("ee/Scripts/GenerateLicenseSigningKey.ts", "export {};\n");
        write("ee/Server/License/keys/private.pem", "key\n");
        write("ee/Server/License/keys/public.txt", "key\n");
        write("ee/keys/signing.key", "key\n");
        write("ee/signing.pem", "key\n");
        write("ee/Server/nested.pem", "key\n");
        write("ee/build/dist/Index.js", "out\n");
        write("ee/Tests/Server/A.test.ts", "test\n");
        write("ee/node_modules/openid-client/index.js", "module\n");
        for (const extension of dockerignoredEnterpriseKeyExtensions()) {
          write(`ee/stray-key.${extension}`, "key\n");
          write(`ee/Server/License/stray-key.${extension}`, "key\n");
        }
        write(
          "Dockerfile",
          'FROM public.ecr.aws/docker/library/node:26-alpine3.24\nCOPY ./ee /ee\nRUN cd / && find ee -type f | sort > /shipped.txt\nCMD ["cat", "/shipped.txt"]\n',
        );

        const tag = `oneuptime-ee-dockerignore-test:${process.pid}`;
        const build = spawnSync("docker", ["build", "-q", "-t", tag, context], {
          encoding: "utf8",
        });
        expect({ status: build.status, stderr: build.stderr }).toEqual({
          status: 0,
          stderr: expect.any(String),
        });

        const shipped = spawnSync("docker", ["run", "--rm", tag], {
          encoding: "utf8",
        });
        spawnSync("docker", ["image", "rm", tag], { encoding: "utf8" });

        expect(shipped.stdout.trim().split("\n")).toEqual([
          "ee/Dashboard/Index.tsx",
          "ee/LICENSE",
          "ee/Scripts/GenerateLicenseSigningKey.ts",
          "ee/Server/Index.ts",
          "ee/Server/License/LicenseToken.ts",
          "ee/package.json",
        ]);
      } finally {
        fs.rmSync(context, { recursive: true, force: true });
      }
    },
    300000,
  );
});
