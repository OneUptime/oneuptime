import { afterEach, describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { getProductVersion } from "../../UI/Config";

/*
 * THE VERSION A PAGE SAYS IS THE SERVER'S (issue #8893).
 *
 * Give Feedback said "the OneUptime version (1.0.0)" on a server running
 * 14.3.0. Every image is built with APP_VERSION (packages/App/
 * Dockerfile.tpl's build argument, from the root VERSION file); the server
 * reports it at /api/version and env.js hands it to every page. The pages
 * read VERSION, a name nothing sets, and fell back to "1.0.0", so every
 * page that named the version named one that never existed: Give
 * Feedback's line, every answer kept with it (Admin Dashboard > Feedback),
 * and the Developer pages, which pinned no CLI or Terraform version.
 *
 * UI/Config's VERSION now reads APP_VERSION, then VERSION, and is "" where
 * neither is a version: never a made-up one, and never a throw that stops
 * a page loading.
 */

const COMMON_ROOT: string = path.resolve(__dirname, "..", "..");
const REPOSITORY_ROOT: string = path.resolve(COMMON_ROOT, "..", "..");

const KEYS: ReadonlyArray<string> = ["APP_VERSION", "VERSION"];

const SOURCE_FILE: RegExp = /\.(ts|tsx)$/;

const saved: Record<string, string | undefined> = {};

for (const key of KEYS) {
  saved[key] = process.env[key];
}

// The settings as env.js hands them to the page (a test's page reads process.env).
const setPageEnvironment: (env: Record<string, string>) => void = (
  env: Record<string, string>,
): void => {
  for (const key of KEYS) {
    delete process.env[key];
  }

  Object.assign(process.env, env);
};

const readPageVersion: (env: Record<string, string>) => string = (
  env: Record<string, string>,
): string => {
  setPageEnvironment(env);

  let version: string | undefined;

  jest.isolateModules(() => {
    version = (
      jest.requireActual(path.join(COMMON_ROOT, "UI/Config")) as {
        VERSION: string;
      }
    ).VERSION;
  });

  return version as string;
};

const reader: (env: Record<string, string>) => (key: string) => string = (
  env: Record<string, string>,
): ((key: string) => string) => {
  return (key: string): string => {
    return env[key] || "";
  };
};

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = saved[key];
    }
  }
});

describe("getProductVersion", () => {
  test("reads APP_VERSION, the version every image is built with", () => {
    expect(getProductVersion(reader({ APP_VERSION: "14.3.0" }))).toBe("14.3.0");
  });

  test("APP_VERSION wins over VERSION, which nothing sets", () => {
    expect(
      getProductVersion(reader({ APP_VERSION: "14.3.0", VERSION: "1.0.0" })),
    ).toBe("14.3.0");
  });

  test("an install that sets VERSION by hand is still read", () => {
    expect(getProductVersion(reader({ VERSION: "14.2.7" }))).toBe("14.2.7");
  });

  test("a version is written as the release is: no leading v, no spaces", () => {
    expect(getProductVersion(reader({ APP_VERSION: " v14.3.0\n" }))).toBe(
      "14.3.0",
    );
  });

  test("a test or build's suffix is kept, as the image's version holds it", () => {
    expect(getProductVersion(reader({ APP_VERSION: "14.3.0-test" }))).toBe(
      "14.3.0-test",
    );
    expect(getProductVersion(reader({ APP_VERSION: "13.1.0+build.7" }))).toBe(
      "13.1.0+build.7",
    );
  });

  test.each([[""], ["unknown"], ["dev"], ["latest"], ["14.3"], ["1.0.0.0"]])(
    'APP_VERSION "%s" is no version: VERSION is read next, and nothing at all says ""',
    (value: string) => {
      expect(getProductVersion(reader({ APP_VERSION: value }))).toBe("");
      expect(
        getProductVersion(reader({ APP_VERSION: value, VERSION: "14.1.2" })),
      ).toBe("14.1.2");
    },
  );

  test('nothing set is "", never the made-up "1.0.0" the pages showed', () => {
    expect(getProductVersion(reader({}))).toBe("");
  });

  test("a reader that answers nothing a string is no version, and nothing throws", () => {
    expect(
      getProductVersion((): string => {
        return undefined as unknown as string;
      }),
    ).toBe("");
  });
});

describe("a page's VERSION", () => {
  test("is the version env.js carries from the image's APP_VERSION (the screenshot's 1.0.0)", () => {
    expect(readPageVersion({ APP_VERSION: "14.3.0" })).toBe("14.3.0");
  });

  test('is "" in a development build, where the image was built without one', () => {
    expect(readPageVersion({})).toBe("");
    expect(readPageVersion({ APP_VERSION: "" })).toBe("");
  });

  test("a version that is not one never stops the page loading", () => {
    expect(readPageVersion({ APP_VERSION: "unknown" })).toBe("");
    expect(readPageVersion({ VERSION: "not-a-version" })).toBe("");
  });

  test("is what Give Feedback sends and says (ProductFeedback.getVersion)", () => {
    setPageEnvironment({ APP_VERSION: "14.3.0" });

    let version: string | undefined;

    jest.isolateModules(() => {
      const productFeedback: { default: { getVersion: () => string } } =
        jest.requireActual(
          path.join(COMMON_ROOT, "UI/Utils/ProductFeedback"),
        ) as { default: { getVersion: () => string } };

      version = productFeedback.default.getVersion();
    });

    expect(version).toBe("14.3.0");
  });
});

describe("the version reaches the page from the image", () => {
  test("the server hands APP_VERSION to every page in env.js", () => {
    setPageEnvironment({ APP_VERSION: "14.3.0" });

    let frontendEnvironment: Record<string, unknown> = {};

    jest.isolateModules(() => {
      const environmentConfig: {
        getFrontendEnvVars: () => Record<string, unknown>;
      } = jest.requireActual(
        path.join(COMMON_ROOT, "Server/EnvironmentConfig"),
      ) as { getFrontendEnvVars: () => Record<string, unknown> };

      frontendEnvironment = environmentConfig.getFrontendEnvVars();
    });

    expect(frontendEnvironment["APP_VERSION"]).toBe("14.3.0");
  });

  test("the App image sets APP_VERSION from its build argument before the frontends are built", () => {
    const dockerfile: string = fs.readFileSync(
      path.join(REPOSITORY_ROOT, "packages/App/Dockerfile.tpl"),
      "utf8",
    );

    const argument: number = dockerfile.indexOf("ARG APP_VERSION");
    const environment: number = dockerfile.indexOf(
      "ENV APP_VERSION=${APP_VERSION}",
    );

    expect(argument).toBeGreaterThan(-1);
    expect(environment).toBeGreaterThan(argument);
  });

  test("a release builds its images with the release's version as APP_VERSION", () => {
    const buildScript: string = fs.readFileSync(
      path.join(REPOSITORY_ROOT, "Scripts/GHA/build_docker_images.sh"),
      "utf8",
    );

    expect(buildScript).toContain('--build-arg "APP_VERSION=${VERSION}"');
  });

  test("no page reads the version's variables itself: every one goes through UI/Config", () => {
    const roots: Array<string> = [
      path.join(COMMON_ROOT, "UI"),
      path.join(REPOSITORY_ROOT, "packages/App/FeatureSet/Dashboard/src"),
      path.join(REPOSITORY_ROOT, "packages/App/FeatureSet/AdminDashboard/src"),
      path.join(REPOSITORY_ROOT, "packages/App/FeatureSet/Accounts/src"),
      path.join(REPOSITORY_ROOT, "packages/App/FeatureSet/StatusPage/src"),
    ];

    const readsVersionItself: RegExp =
      /\benv\(\s*["'](?:APP_)?VERSION["']\s*\)/;

    const listFiles: (directory: string) => Array<string> = (
      directory: string,
    ): Array<string> => {
      if (!fs.existsSync(directory)) {
        return [];
      }

      return fs
        .readdirSync(directory, { withFileTypes: true })
        .flatMap((entry: fs.Dirent): Array<string> => {
          const full: string = path.join(directory, entry.name);

          if (entry.isDirectory()) {
            return entry.name === "node_modules" ? [] : listFiles(full);
          }

          return SOURCE_FILE.test(entry.name) ? [full] : [];
        });
    };

    const config: string = path.join(COMMON_ROOT, "UI", "Config.ts");

    const found: Array<string> = roots
      .flatMap(listFiles)
      .filter((file: string): boolean => {
        return (
          file !== config &&
          readsVersionItself.test(fs.readFileSync(file, "utf8"))
        );
      })
      .map((file: string): string => {
        return path.relative(REPOSITORY_ROOT, file);
      });

    expect(found).toEqual([]);
  });
});
