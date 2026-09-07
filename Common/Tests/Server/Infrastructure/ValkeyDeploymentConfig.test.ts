import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";

/*
 * The cache and BullMQ queue backend runs the Valkey image rather than Redis:
 * Redis 7.4 left the BSD licence and the bulk of the original contributors moved
 * to the Valkey fork. Valkey speaks the same wire protocol, so nothing above the
 * socket changed -- every REDIS_* setting, the Helm values key and the
 * Kubernetes object names are deliberately untouched.
 *
 * What these tests protect is the part of that swap which is easy to half-undo:
 * the compose service name, the hostname old config.env files still point at,
 * and the two places (compose and Helm) that have to keep running the same
 * engine version.
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

interface ComposeService {
  image?: string;
  command?: string;
  healthcheck?: { test?: Array<string> };
  networks?: Record<string, { aliases?: Array<string> } | null>;
  extends?: { file?: string; service?: string };
}

interface ComposeFile {
  services: Record<string, ComposeService>;
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
    expect(service.healthcheck?.test).toEqual([
      "CMD",
      "valkey-cli",
      "-a",
      "${REDIS_PASSWORD}",
      "ping",
    ]);
  });

  /*
   * Renaming the service moved the hostname. Every config.env written before
   * this change still says REDIS_HOST=redis, and those files are not
   * regenerated on upgrade -- the network alias is the only thing keeping them
   * resolving.
   */
  test("the old redis hostname still resolves to the valkey service", () => {
    const networks: Record<string, { aliases?: Array<string> } | null> =
      base.services["valkey"]!.networks!;

    expect(networks["oneuptime"]?.aliases).toContain("redis");
  });

  test("config.example.env points at the compose service by name", () => {
    expect(readExampleEnvValue("REDIS_HOST")).toBe("valkey");
    /*
     * The variable names themselves are the app's public config surface and are
     * deliberately unchanged.
     */
    expect(readExampleEnvValue("REDIS_PORT")).toBe("6379");
    expect(readExampleEnvValue("REDIS_USERNAME")).toBe("default");
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
      redis: { image: { repository: string; tag: string } };
    } = yaml.load(fs.readFileSync(HELM_VALUES_PATH, "utf8")) as {
      redis: { image: { repository: string; tag: string } };
    };

    expect(values.redis.image.repository).toBe("valkey/valkey");
    expect(`${values.redis.image.repository}:${values.redis.image.tag}`).toBe(
      base.services["valkey"]!.image,
    );
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
