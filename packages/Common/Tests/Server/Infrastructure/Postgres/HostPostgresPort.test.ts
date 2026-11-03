import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  DEFAULT_PUBLISHED_POSTGRES_PORT,
  HOST_POSTGRES_PORT_SETTINGS,
  getHostPostgresPort,
} from "../../../../Server/Infrastructure/Postgres/HostPostgresPort";

/*
 * Where the tools a developer runs on the machine itself reach the stack's
 * PostgreSQL (npm run generate-postgres-migration, npm run
 * check-postgres-schema-drift): DATABASE_MIGRATIONS_PORT when it is set,
 * else DATABASE_PUBLISHED_PORT - the port docker-compose.yml and the dev
 * stack publish it on - else 5400. They assumed 5400 whatever config.env
 * said, so a server that moved PostgreSQL to 5401 generated its migrations
 * against whatever else held 5400 (#5324's follow-ups).
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../../..");

describe("getHostPostgresPort", () => {
  test("nothing set: 5400, where the stack publishes PostgreSQL by default", () => {
    expect(DEFAULT_PUBLISHED_POSTGRES_PORT).toBe(5400);
    expect(getHostPostgresPort({})).toBe(5400);
  });

  test("DATABASE_PUBLISHED_PORT moves it, as it moves the published port", () => {
    expect(getHostPostgresPort({ DATABASE_PUBLISHED_PORT: "5401" })).toBe(5401);
  });

  test("DATABASE_MIGRATIONS_PORT wins, so a check can be pointed at a throwaway database", () => {
    expect(
      getHostPostgresPort({
        DATABASE_MIGRATIONS_PORT: "55432",
        DATABASE_PUBLISHED_PORT: "5401",
      }),
    ).toBe(55432);
    expect(HOST_POSTGRES_PORT_SETTINGS).toEqual([
      "DATABASE_MIGRATIONS_PORT",
      "DATABASE_PUBLISHED_PORT",
    ]);
  });

  test("an empty or blank setting is not set (config.example.env leaves DATABASE_MIGRATIONS_PORT empty)", () => {
    expect(
      getHostPostgresPort({
        DATABASE_MIGRATIONS_PORT: "",
        DATABASE_PUBLISHED_PORT: "5402",
      }),
    ).toBe(5402);
    expect(
      getHostPostgresPort({
        DATABASE_MIGRATIONS_PORT: "   ",
        DATABASE_PUBLISHED_PORT: "",
      }),
    ).toBe(5400);
  });

  test("the spaces a config.env line keeps around a value do not count", () => {
    expect(getHostPostgresPort({ DATABASE_PUBLISHED_PORT: " 5403 " })).toBe(
      5403,
    );
  });

  test.each([
    ["a letter for a digit", "54O1"],
    ["a port with an address", "127.0.0.1:5400"],
    ["zero", "0"],
    ["past the last port", "65536"],
    ["a negative number", "-5400"],
    ["a decimal", "5400.5"],
    ["too many digits", "000005400"],
  ])(
    "%s stops the tool with the setting's name, rather than reach a database nobody meant",
    (_name: string, value: string) => {
      expect(() => {
        return getHostPostgresPort({ DATABASE_PUBLISHED_PORT: value });
      }).toThrow(`DATABASE_PUBLISHED_PORT=${value} is not a port`);
      expect(() => {
        return getHostPostgresPort({ DATABASE_MIGRATIONS_PORT: value });
      }).toThrow(`DATABASE_MIGRATIONS_PORT=${value} is not a port`);
    },
  );

  test("the first and last ports are ports", () => {
    expect(getHostPostgresPort({ DATABASE_PUBLISHED_PORT: "1" })).toBe(1);
    expect(getHostPostgresPort({ DATABASE_PUBLISHED_PORT: "65535" })).toBe(
      65535,
    );
  });
});

describe("the migration generator reads it", () => {
  test("LocalMigrationGenerationDataSource takes its port from getHostPostgresPort(process.env), not a 5400 of its own", () => {
    const source: string = fs.readFileSync(
      path.join(
        REPO_ROOT,
        "packages/Common/Server/Infrastructure/Postgres/LocalMigrationGenerationDataSource.ts",
      ),
      "utf8",
    );

    expect(source).toContain("port: getHostPostgresPort(process.env)");
    expect(source).not.toContain('"5400"');
  });

  test("config.example.env leaves DATABASE_MIGRATIONS_PORT empty, so a new config.env follows DATABASE_PUBLISHED_PORT", () => {
    const lines: Array<string> = fs
      .readFileSync(path.join(REPO_ROOT, "config.example.env"), "utf8")
      .split("\n");

    expect(lines).toContain("DATABASE_MIGRATIONS_PORT=");
    expect(lines).toContain("DATABASE_PUBLISHED_PORT=5400");
    expect(
      lines.filter((line: string) => {
        return line.startsWith("DATABASE_MIGRATIONS_PORT=");
      }),
    ).toEqual(["DATABASE_MIGRATIONS_PORT="]);
  });
});
