import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";

/*
 * The cache and BullMQ queue backend runs Valkey, the BSD-licensed fork of
 * Redis 7.2 that most of the original Redis contributors moved to after Redis
 * 7.4 left the BSD licence. The engine, the compose service, the settings and
 * the Kubernetes objects are all named for it.
 *
 * What these tests guard is the half of that rename nobody sees until an
 * upgrade goes wrong: every OLD name still has to resolve. A self-hoster who
 * never edits config.env, and an operator whose values.yaml still says `redis:`,
 * must both keep running. So the compose file reads `${VALKEY_X:-${REDIS_X}}`,
 * keeps `redis` as a network alias, and emits the deprecated REDIS_* mirrors for
 * an app image pinned to a pre-rename release.
 *
 * The app-side half of the fallback is covered by
 * Common/Tests/Server/EnvironmentConfigValkey.test.ts, the Helm-side half by
 * HelmChart/Public/oneuptime/tests/valkey-legacy-values_test.yaml, and the
 * config.env upgrade path by Tests/Ops/MergeEnvTemplateRenames.test.js.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const BASE_COMPOSE_PATH: string = path.join(
  REPO_ROOT,
  "docker-compose.base.yml",
);
const EXAMPLE_ENV_PATH: string = path.join(REPO_ROOT, "config.example.env");
const HELM_VALUES_PATH: string = path.join(
  REPO_ROOT,
  "HelmChart",
  "Public",
  "oneuptime",
  "values.yaml",
);

// The three compose files an operator actually invokes; each extends the base.
const OVERLAY_COMPOSE_FILES: Array<string> = [
  "docker-compose.yml",
  "docker-compose.dev.yml",
  "docker-compose.billing.yml",
];

// Every cache setting, by the suffix the two spellings share.
const SETTING_SUFFIXES: Array<string> = [
  "USERNAME",
  "PASSWORD",
  "HOST",
  "PORT",
  "DB",
  "IP_FAMILY",
  "TLS_CA",
  "TLS_SENTINEL_MODE",
];

interface ComposeService {
  image?: string;
  command?: string;
  healthcheck?: { test?: Array<string> };
  networks?: Record<string, { aliases?: Array<string> } | null>;
  extends?: { file?: string; service?: string };
}

interface ComposeFile {
  services: Record<string, ComposeService>;
  "x-common-runtime-variables"?: Record<string, string>;
  "x-common-depends-on"?: Record<string, { condition?: string }>;
}

function readCompose(filePath: string): ComposeFile {
  return yaml.load(fs.readFileSync(filePath, "utf8")) as ComposeFile;
}

function readExampleEnvValue(name: string): string | undefined {
  const source: string = fs.readFileSync(EXAMPLE_ENV_PATH, "utf8");
  const match: RegExpMatchArray | null = source.match(
    new RegExp(`^${name}=(.*)$`, "m"),
  );

  return match?.[1];
}

/* `${VALKEY_X:-${REDIS_X}}` -- the current name, falling back to the old one. */
function fallbackExpression(suffix: string): string {
  return `\${VALKEY_${suffix}:-\${REDIS_${suffix}}}`;
}

/* A bare `REDIS_SOMETHING=` line in config.example.env. */
const LEGACY_ENV_ASSIGNMENT: RegExp = /^REDIS_[A-Z_]+=/;

describe("valkey cache and queue backend", () => {
  const base: ComposeFile = readCompose(BASE_COMPOSE_PATH);

  test("docker compose runs the valkey image and not redis", () => {
    const service: ComposeService | undefined = base.services["valkey"];

    expect(service).toBeDefined();
    expect(service!.image).toMatch(/^valkey\/valkey:/);
    expect(base.services["redis"]).toBeUndefined();
  });

  /*
   * The valkey image ships redis-server/redis-cli symlinks, so leaving the old
   * binary names in place would keep working today and break silently the day
   * those symlinks go. Both the entrypoint and the healthcheck name the real
   * binaries.
   */
  test("docker compose starts and probes valkey by its own binary names", () => {
    const service: ComposeService = base.services["valkey"]!;

    expect(service.command).toMatch(/^valkey-server /);
    expect(service.command).not.toMatch(/redis-server/);
    expect(service.healthcheck?.test?.[1]).toBe("valkey-cli");
  });

  /*
   * The server, the healthcheck and the app must all resolve to ONE password.
   * If any of the three read a different expression, the stack still starts --
   * it just cannot authenticate, or worse, starts on a different secret than
   * the one the operator set.
   */
  test("the server, its healthcheck and the app share one password expression", () => {
    const service: ComposeService = base.services["valkey"]!;
    const expression: string = fallbackExpression("PASSWORD");

    expect(service.command).toContain(`--requirepass "${expression}"`);
    expect(service.healthcheck?.test).toEqual([
      "CMD",
      "valkey-cli",
      "-a",
      expression,
      "ping",
    ]);
    expect(base["x-common-runtime-variables"]!["VALKEY_PASSWORD"]).toBe(
      expression,
    );
  });

  /*
   * The upgrade case: an existing config.env holds only REDIS_*, and
   * `npm run update` deliberately does not rewrite it (see
   * Tests/Ops/MergeEnvTemplateRenames.test.js). The `:-` fallback in the compose
   * file is the only thing that carries those values onto the new names.
   */
  test.each(SETTING_SUFFIXES)(
    "VALKEY_%s falls back to the deprecated REDIS_ name",
    (suffix: string) => {
      expect(base["x-common-runtime-variables"]![`VALKEY_${suffix}`]).toBe(
        fallbackExpression(suffix),
      );
    },
  );

  /*
   * And the mirrors going the other way: APP_TAG lets you pin an image from
   * before the rename against this compose file, and such an image reads
   * REDIS_* only. Both names must carry the identical expression -- a second
   * source of truth here is how the app and the server end up on different
   * credentials.
   */
  test.each(SETTING_SUFFIXES)(
    "the deprecated REDIS_%s mirror carries the identical value",
    (suffix: string) => {
      const common: Record<string, string> =
        base["x-common-runtime-variables"]!;

      expect(common[`REDIS_${suffix}`]).toBe(common[`VALKEY_${suffix}`]);
    },
  );

  /*
   * Renaming the service moved the hostname. Every config.env written before
   * this change still says REDIS_HOST=redis, and those files are not rewritten
   * on upgrade -- the network alias is the only thing keeping them resolving.
   */
  test("the old redis hostname still resolves to the valkey service", () => {
    const networks: Record<string, { aliases?: Array<string> } | null> =
      base.services["valkey"]!.networks!;

    expect(networks["oneuptime"]?.aliases).toContain("redis");
  });

  test("config.example.env ships the current names only", () => {
    expect(readExampleEnvValue("VALKEY_HOST")).toBe("valkey");
    expect(readExampleEnvValue("VALKEY_PORT")).toBe("6379");
    expect(readExampleEnvValue("VALKEY_USERNAME")).toBe("default");
    expect(readExampleEnvValue("VALKEY_DB")).toBe("0");

    /*
     * A leftover REDIS_* line would be actively harmful, not just untidy:
     * Home/Scripts/Install.sh replaces each `please-change-this-to-random-value`
     * occurrence with a SEPARATE freshly generated value, so a duplicated
     * password line hands the server one secret and the app another.
     */
    const example: string = fs.readFileSync(EXAMPLE_ENV_PATH, "utf8");
    const legacyLines: Array<string> = example
      .split("\n")
      .filter((line: string) => {
        return LEGACY_ENV_ASSIGNMENT.test(line);
      });

    expect(legacyLines).toEqual([]);
  });

  test.each(OVERLAY_COMPOSE_FILES)(
    "%s extends and waits on the valkey service",
    (fileName: string) => {
      const overlay: ComposeFile = readCompose(path.join(REPO_ROOT, fileName));

      expect(overlay.services["valkey"]?.extends?.service).toBe("valkey");
      expect(overlay.services["redis"]).toBeUndefined();

      /*
       * Every app container gates its start on this block, so a stale service
       * name here means compose refuses to start the stack at all.
       */
      const dependsOn: Record<string, { condition?: string }> =
        overlay["x-common-depends-on"]!;

      expect(dependsOn["valkey"]?.condition).toBe("service_healthy");
      expect(dependsOn["redis"]).toBeUndefined();
    },
  );

  /*
   * Compose and Helm claim in their comments to run the same engine version.
   * Nothing enforces that but this: the two drift apart the first time only one
   * of them is bumped, and the bug surfaces as behaviour that reproduces in
   * compose but not in Kubernetes (or the reverse).
   */
  test("helm runs the same pinned valkey image as compose", () => {
    const values: {
      valkey: { image: { repository: string; tag: string } };
      redis: Record<string, unknown>;
    } = yaml.load(fs.readFileSync(HELM_VALUES_PATH, "utf8")) as {
      valkey: { image: { repository: string; tag: string } };
      redis: Record<string, unknown>;
    };

    expect(values.valkey.image.repository).toBe("valkey/valkey");
    expect(`${values.valkey.image.repository}:${values.valkey.image.tag}`).toBe(
      base.services["valkey"]!.image,
    );

    /*
     * The deprecated `redis:` alias must stay EMPTY. The merge in
     * `oneuptime.valkey` layers it on top of the real defaults, so anything
     * shipped here would be impossible for an operator to override.
     */
    expect(values.redis).toEqual({});
  });

  /*
   * A floating tag would let a major engine version arrive on an unrelated
   * `docker compose pull` or `helm upgrade`. The pin is to a minor line, so
   * patch releases (including CVE fixes) still flow in.
   */
  test("the valkey image tag is pinned to a version line", () => {
    expect(base.services["valkey"]!.image).toMatch(
      /^valkey\/valkey:\d+\.\d+(\.\d+)?-alpine$/,
    );
  });
});
