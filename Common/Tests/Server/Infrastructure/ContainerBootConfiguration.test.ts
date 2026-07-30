import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Regression tests for container boot time.
 *
 * Every production image already runs `npm run compile` (tsc) at BUILD time, so
 * the codebase is fully type-checked before the image is published. The runtime
 * entrypoint then boots through `node --require ts-node/register Index.ts`,
 * which throws that away and re-runs the entire type-check inside every
 * container, on every start, before the HTTP listener binds.
 *
 * That is minutes of boot per pod. It is the amplifier behind the rolling-update
 * capacity hole: a tier cannot be replaced faster than its pods can start, and
 * recovery from a node failure or OOM kill is just as slow.
 *
 * TS_NODE_TRANSPILE_ONLY=1 strips the types without re-checking them. The dev
 * loop already does exactly this via nodemon; only production did not.
 *
 * The end state is what KubernetesCostAgent and KubernetesLogTailer already do:
 * `CMD ["node", "build/dist/Index.js"]`, with no ts-node in the image at all.
 * These tests encode the rule that gets us there safely: if you boot through
 * ts-node, you must not re-type-check at boot.
 */

const REPO_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

interface ServiceImage {
  service: string;
  /*
   * The part of the Dockerfile that produces the production image. Templated
   * Dockerfiles carry a `{{ if eq .Env.ENVIRONMENT "development" }}` branch that
   * we must not confuse with the production one.
   */
  productionStanza: string;
  // The `start` script the production CMD ultimately runs, if it runs one.
  startScript: string | null;
}

// CMD forms that hand control to `npm start`.
const CMD_NPM_START_EXEC_FORM: RegExp = /CMD\s*\[\s*"npm"\s*,\s*"start"\s*\]/;
const CMD_NPM_START_SHELL_FORM: RegExp = /CMD\s+npm\s+start/;
const CMD_INVOKES_TS_NODE: RegExp = /CMD.*ts-node\/register/;
const TRANSPILE_ONLY_ENV: RegExp = /ENV\s+TS_NODE_TRANSPILE_ONLY=1/;
const CMD_PRECOMPILED_ENTRYPOINT: RegExp =
  /CMD\s*\[\s*"node"\s*,\s*"build\/dist\/Index\.js"\s*\]/;
const TS_NODE_ANYWHERE: RegExp = /ts-node\/register/;

const listServiceImages: () => Array<ServiceImage> =
  (): Array<ServiceImage> => {
    const images: Array<ServiceImage> = [];

    for (const entry of fs.readdirSync(REPO_ROOT, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "node_modules") {
        continue;
      }

      const dockerfilePath: string = path.join(
        REPO_ROOT,
        entry.name,
        "Dockerfile.tpl",
      );
      if (!fs.existsSync(dockerfilePath)) {
        continue;
      }

      const dockerfile: string = fs.readFileSync(dockerfilePath, "utf8");

      /*
       * Everything after the last `{{ else }}` is the production branch. Files
       * with no dev/prod split are production in their entirety.
       */
      const elseIndex: number = dockerfile.lastIndexOf("{{ else }}");
      const productionStanza: string =
        elseIndex === -1 ? dockerfile : dockerfile.slice(elseIndex);

      let startScript: string | null = null;
      const packageJsonPath: string = path.join(
        REPO_ROOT,
        entry.name,
        "package.json",
      );
      if (fs.existsSync(packageJsonPath)) {
        const parsed: { scripts?: Record<string, string> } = JSON.parse(
          fs.readFileSync(packageJsonPath, "utf8"),
        ) as { scripts?: Record<string, string> };
        startScript = parsed.scripts?.["start"] ?? null;
      }

      images.push({ service: entry.name, productionStanza, startScript });
    }

    return images;
  };

// Does this image's production entrypoint go through ts-node?
const bootsThroughTsNode: (image: ServiceImage) => boolean = (
  image: ServiceImage,
): boolean => {
  const runsNpmStart: boolean =
    CMD_NPM_START_EXEC_FORM.test(image.productionStanza) ||
    CMD_NPM_START_SHELL_FORM.test(image.productionStanza);

  if (
    runsNpmStart &&
    image.startScript !== null &&
    image.startScript.includes("ts-node/register")
  ) {
    return true;
  }

  // Some images invoke ts-node straight from CMD or via a wrapper script.
  return CMD_INVOKES_TS_NODE.test(image.productionStanza);
};

const SERVICE_IMAGES: Array<ServiceImage> = listServiceImages();

// The nginx image boots run.sh, which calls `npm start` internally.
const NGINX_WRAPPER_SERVICES: Array<string> = ["Nginx"];

const bootsThroughTsNodeIncludingWrappers: (image: ServiceImage) => boolean = (
  image: ServiceImage,
): boolean => {
  if (NGINX_WRAPPER_SERVICES.includes(image.service)) {
    return (
      image.startScript !== null &&
      image.startScript.includes("ts-node/register")
    );
  }
  return bootsThroughTsNode(image);
};

describe("Container boot configuration", () => {
  test("the repository actually has service images to check", () => {
    /*
     * Guards against the discovery above silently matching nothing, which would
     * make every test below vacuously pass.
     */
    expect(SERVICE_IMAGES.length).toBeGreaterThan(5);
  });

  describe("images that boot through ts-node must not re-type-check at boot", () => {
    /*
     * Skipping the boot-time check is only safe when tsc already ran at build
     * time. That is the precondition, so the rule is scoped to images that meet
     * it -- see the "known gap" block below for the ones that do not.
     */
    const tsNodeImages: Array<ServiceImage> = SERVICE_IMAGES.filter(
      bootsThroughTsNodeIncludingWrappers,
    );
    const typeCheckedAtBuild: Array<ServiceImage> = tsNodeImages.filter(
      (image: ServiceImage) => {
        return image.productionStanza.includes("npm run compile");
      },
    );

    test("at least one such image exists", () => {
      expect(typeCheckedAtBuild.length).toBeGreaterThan(0);
    });

    test.each(
      typeCheckedAtBuild.map((i: ServiceImage) => {
        return i.service;
      }),
    )(
      "%s sets TS_NODE_TRANSPILE_ONLY=1 in its production image",
      (service: string) => {
        const image: ServiceImage | undefined = SERVICE_IMAGES.find(
          (i: ServiceImage) => {
            return i.service === service;
          },
        );

        expect(image).toBeDefined();
        expect(image?.productionStanza).toMatch(TRANSPILE_ONLY_ENV);
      },
    );
  });

  describe("known gap: images that boot through ts-node without a build-time check", () => {
    /*
     * RunbookAgent boots `npm start` through ts-node but its Dockerfile never
     * runs `npm run compile`, so its types are verified NOWHERE except at
     * container boot. It therefore pays the full type-check on every start AND
     * cannot simply have that check disabled -- the fix is to add the build-time
     * compile step first, which needs its own verification that the package
     * actually compiles clean.
     *
     * It is not part of the OneUptime Helm chart, so it is not on the rolling
     * update path this change targets. This test pins the gap so a NEW service
     * cannot quietly join the category.
     */
    const KNOWN_GAP_SERVICES: Array<string> = ["RunbookAgent"];

    test("no service other than the known ones skips the build-time type check", () => {
      const gaps: Array<string> = SERVICE_IMAGES.filter(
        (image: ServiceImage) => {
          return (
            bootsThroughTsNodeIncludingWrappers(image) &&
            !image.productionStanza.includes("npm run compile")
          );
        },
      ).map((image: ServiceImage) => {
        return image.service;
      });

      expect(gaps.sort()).toEqual([...KNOWN_GAP_SERVICES].sort());
    });
  });

  describe("images that run precompiled JavaScript need no such flag", () => {
    /*
     * KubernetesCostAgent and KubernetesLogTailer boot `build/dist/Index.js`
     * directly. They are the model the ts-node services should eventually
     * follow, and they must not regress back to ts-node without the flag.
     */
    const precompiledImages: Array<ServiceImage> = SERVICE_IMAGES.filter(
      (image: ServiceImage) => {
        return CMD_PRECOMPILED_ENTRYPOINT.test(image.productionStanza);
      },
    );

    test("the precompiled pattern is still in use somewhere", () => {
      expect(precompiledImages.length).toBeGreaterThan(0);
    });

    test.each(
      precompiledImages.map((i: ServiceImage) => {
        return i.service;
      }),
    )("%s does not boot through ts-node", (service: string) => {
      const image: ServiceImage | undefined = SERVICE_IMAGES.find(
        (i: ServiceImage) => {
          return i.service === service;
        },
      );

      expect(image).toBeDefined();
      expect(image?.productionStanza).not.toMatch(TS_NODE_ANYWHERE);
    });
  });

  describe("build-time type checking is still in place", () => {
    /*
     * transpile-only is only safe because tsc already ran at build time. If a
     * service ever drops `npm run compile`, disabling the boot check would mean
     * its types are never verified at all.
     */
    const tsNodeImages: Array<ServiceImage> = SERVICE_IMAGES.filter(
      (image: ServiceImage) => {
        return (
          bootsThroughTsNodeIncludingWrappers(image) &&
          TRANSPILE_ONLY_ENV.test(image.productionStanza)
        );
      },
    );

    test.each(
      tsNodeImages.map((i: ServiceImage) => {
        return i.service;
      }),
    )("%s still runs `npm run compile` at build time", (service: string) => {
      const image: ServiceImage | undefined = SERVICE_IMAGES.find(
        (i: ServiceImage) => {
          return i.service === service;
        },
      );

      expect(image).toBeDefined();
      expect(image?.productionStanza).toContain("npm run compile");
    });
  });

  describe("the dev loop keeps its existing transpile-only behaviour", () => {
    const nodemonServices: Array<string> = [
      "App",
      "AIAgent",
      "Home",
      "Probe",
      "TestServer",
    ];

    test.each(nodemonServices)(
      "%s nodemon config still uses transpile-only",
      (service: string) => {
        const nodemonPath: string = path.join(
          REPO_ROOT,
          service,
          "nodemon.json",
        );

        expect(fs.existsSync(nodemonPath)).toBe(true);
        expect(fs.readFileSync(nodemonPath, "utf8")).toContain(
          "TS_NODE_TRANSPILE_ONLY",
        );
      },
    );
  });
});
