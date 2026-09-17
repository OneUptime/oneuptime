import { afterEach, describe, expect, it, jest } from "@jest/globals";

/*
 * How the cache/queue settings are read.
 *
 * They are named VALKEY_* since 13.0.0. The REDIS_* names they shipped under
 * for years are still read as a deprecated fallback, and that fallback is the
 * ONLY reason an existing self-hosted config.env keeps working across the
 * upgrade -- `npm run update` deliberately does not rewrite it. Nothing here is
 * cosmetic: if the fallback breaks, every install that has not hand-edited its
 * config.env silently drops to the built-in defaults (host "redis", password
 * "password") and cannot authenticate to its own cache.
 *
 * EnvironmentConfig reads process.env at module load, so every case sets the
 * environment, resets the module registry and imports afresh.
 */

interface EnvironmentConfigShape {
  RedisHostname: string;
  RedisPort: { toNumber: () => number };
  RedisDb: number;
  RedisUsername: string;
  RedisPassword: string;
  RedisTlsCa: string | undefined;
  RedisTlsCert: string | undefined;
  RedisTlsKey: string | undefined;
  RedisTlsSentinelMode: boolean;
  ShouldRedisTlsEnable: boolean;
  RedisIPFamily: number;
}

const SUFFIXES: Array<string> = [
  "HOST",
  "PORT",
  "DB",
  "USERNAME",
  "PASSWORD",
  "IP_FAMILY",
  "TLS_CA",
  "TLS_CERT",
  "TLS_KEY",
  "TLS_SENTINEL_MODE",
];

const MANAGED_KEYS: Array<string> = SUFFIXES.flatMap((suffix: string) => {
  return [`VALKEY_${suffix}`, `REDIS_${suffix}`];
});

const originalEnv: NodeJS.ProcessEnv = { ...process.env };

async function load(
  overrides: Record<string, string | undefined>,
): Promise<EnvironmentConfigShape> {
  for (const key of MANAGED_KEYS) {
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  jest.resetModules();

  return (await import(
    "../../Server/EnvironmentConfig"
  )) as unknown as EnvironmentConfigShape;
}

afterEach(() => {
  process.env = { ...originalEnv };
  jest.resetModules();
});

describe("cache settings read VALKEY_* first", () => {
  it("reads every setting from its VALKEY_ name", async () => {
    const config: EnvironmentConfigShape = await load({
      VALKEY_HOST: "cache.internal",
      VALKEY_PORT: "6380",
      VALKEY_DB: "3",
      VALKEY_USERNAME: "alice",
      VALKEY_PASSWORD: "sekret",
      VALKEY_IP_FAMILY: "6",
      VALKEY_TLS_CA: "ca-pem",
      VALKEY_TLS_CERT: "cert-pem",
      VALKEY_TLS_KEY: "key-pem",
      VALKEY_TLS_SENTINEL_MODE: "true",
    });

    expect(config.RedisHostname).toBe("cache.internal");
    expect(config.RedisPort.toNumber()).toBe(6380);
    expect(config.RedisDb).toBe(3);
    expect(config.RedisUsername).toBe("alice");
    expect(config.RedisPassword).toBe("sekret");
    expect(config.RedisIPFamily).toBe(6);
    expect(config.RedisTlsCa).toBe("ca-pem");
    expect(config.RedisTlsCert).toBe("cert-pem");
    expect(config.RedisTlsKey).toBe("key-pem");
    expect(config.RedisTlsSentinelMode).toBe(true);
  });
});

describe("the deprecated REDIS_* names still work", () => {
  /*
   * This is the upgrade case: a config.env written before the rename, never
   * touched, mounted into a container built after it.
   */
  it("reads every setting from its REDIS_ name when that is all there is", async () => {
    const config: EnvironmentConfigShape = await load({
      REDIS_HOST: "cache.internal",
      REDIS_PORT: "6380",
      REDIS_DB: "3",
      REDIS_USERNAME: "alice",
      REDIS_PASSWORD: "sekret",
      REDIS_IP_FAMILY: "6",
      REDIS_TLS_CA: "ca-pem",
      REDIS_TLS_CERT: "cert-pem",
      REDIS_TLS_KEY: "key-pem",
      REDIS_TLS_SENTINEL_MODE: "true",
    });

    expect(config.RedisHostname).toBe("cache.internal");
    expect(config.RedisPort.toNumber()).toBe(6380);
    expect(config.RedisDb).toBe(3);
    expect(config.RedisUsername).toBe("alice");
    expect(config.RedisPassword).toBe("sekret");
    expect(config.RedisIPFamily).toBe(6);
    expect(config.RedisTlsCa).toBe("ca-pem");
    expect(config.RedisTlsCert).toBe("cert-pem");
    expect(config.RedisTlsKey).toBe("key-pem");
    expect(config.RedisTlsSentinelMode).toBe(true);
  });

  it("prefers the VALKEY_ name when both are set", async () => {
    const config: EnvironmentConfigShape = await load({
      VALKEY_HOST: "new.internal",
      REDIS_HOST: "old.internal",
      VALKEY_PASSWORD: "new-secret",
      REDIS_PASSWORD: "old-secret",
    });

    expect(config.RedisHostname).toBe("new.internal");
    expect(config.RedisPassword).toBe("new-secret");
  });

  /*
   * The single sharpest edge in the whole rename. docker-compose.base.yml lists
   * every VALKEY_* name, and Compose materialises an unset variable as an EMPTY
   * STRING rather than leaving it undefined -- so inside our containers the new
   * name is always *defined*. A `??` fallback would therefore pick the empty new
   * name over the operator's real old one and fall through to the defaults,
   * with no error. `||` is what makes this case work.
   */
  it("falls back past an empty VALKEY_ value, as compose always sets one", async () => {
    const config: EnvironmentConfigShape = await load({
      VALKEY_HOST: "",
      REDIS_HOST: "cache.internal",
      VALKEY_PASSWORD: "",
      REDIS_PASSWORD: "sekret",
      VALKEY_PORT: "",
      REDIS_PORT: "6380",
      VALKEY_USERNAME: "",
      REDIS_USERNAME: "alice",
    });

    expect(config.RedisHostname).toBe("cache.internal");
    expect(config.RedisPassword).toBe("sekret");
    expect(config.RedisPort.toNumber()).toBe(6380);
    expect(config.RedisUsername).toBe("alice");
  });

  /*
   * TLS is derived from three variables, so an uneven fallback would not throw
   * -- it would quietly flip the connection to plaintext.
   */
  it("still enables TLS from a REDIS_TLS_CA alone", async () => {
    const config: EnvironmentConfigShape = await load({
      REDIS_TLS_CA: "ca-pem",
    });

    expect(config.ShouldRedisTlsEnable).toBe(true);
  });

  it("still enables TLS from a REDIS_TLS_CERT and REDIS_TLS_KEY pair", async () => {
    const config: EnvironmentConfigShape = await load({
      REDIS_TLS_CERT: "cert-pem",
      REDIS_TLS_KEY: "key-pem",
    });

    expect(config.ShouldRedisTlsEnable).toBe(true);
  });

  it("leaves TLS off when nothing is configured under either name", async () => {
    const config: EnvironmentConfigShape = await load({});

    expect(config.ShouldRedisTlsEnable).toBe(false);
  });
});

describe("defaults when neither name is set", () => {
  /*
   * The compose service is called `valkey` now, but this default deliberately
   * stays `redis`: it is only reached when NEITHER variable is set, which never
   * happens in our own compose or Helm. What it covers is hand-written
   * Kubernetes manifests, a bare `docker run` and third-party compose files,
   * where the Service has been called `redis` for years. Compose users are fine
   * either way -- the valkey service answers to `redis` through a network alias.
   */
  it("keeps the historical redis hostname", async () => {
    const config: EnvironmentConfigShape = await load({});

    expect(config.RedisHostname).toBe("redis");
  });

  it("keeps the rest of the historical defaults", async () => {
    const config: EnvironmentConfigShape = await load({});

    expect(config.RedisPort.toNumber()).toBe(6379);
    expect(config.RedisDb).toBe(0);
    expect(config.RedisUsername).toBe("default");
    expect(config.RedisIPFamily).toBe(4);
    expect(config.RedisTlsSentinelMode).toBe(false);
  });
});
