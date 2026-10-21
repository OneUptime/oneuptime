import {
  DEFAULT_HSTS_MAX_AGE_SECONDS,
  parseHstsMaxAgeSeconds,
} from "../../../Server/EnvironmentConfig";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import yaml from "js-yaml";
import path from "path";

/*
 * HSTS_MAX_AGE_SECONDS reaches every service that answers browsers.
 *
 * An installation with HTTP_PROTOCOL=https tells browsers to reach its own
 * address over HTTPS only, for HSTS_MAX_AGE_SECONDS (a year unless set). An
 * operator who has to serve that address over plain HTTP again sets it to 0
 * first, so browsers forget the rule - which works only if the setting
 * reaches the containers. These pin the Docker Compose half of the wiring
 * (Helm takes it through the chart-wide extraEnv, as its configuration page
 * says), and tie it to the name EnvironmentConfig reads by feeding the value
 * Compose would hand over to the real parser.
 */

const ENV_VAR_NAME: string = "HSTS_MAX_AGE_SECONDS";
const REFERENCE: string = `\${${ENV_VAR_NAME}:-}`;

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");
const COMPOSE_PATH: string = path.join(REPO_ROOT, "docker-compose.base.yml");
const EXAMPLE_ENV_PATH: string = path.join(REPO_ROOT, "config.example.env");
const ENVIRONMENT_CONFIG_PATH: string = path.join(
  REPO_ROOT,
  "packages/Common/Server/EnvironmentConfig.ts",
);

type ComposeEnvironment = Record<string, string | number | boolean | null>;

interface ComposeService {
  environment?: ComposeEnvironment;
}

interface ComposeConfig {
  "x-common-variables": ComposeEnvironment;
  services: Record<string, ComposeService>;
}

// js-yaml resolves the `<<: *anchor` merge keys, as Compose does.
function loadCompose(): ComposeConfig {
  return yaml.load(fs.readFileSync(COMPOSE_PATH, "utf8")) as ComposeConfig;
}

/*
 * Compose's `${NAME:-}`: the shell's value (config.env is exported before
 * `docker compose up`), or empty when it is unset or empty.
 */
function interpolate(shellValue: string | undefined): string {
  return shellValue ? shellValue : "";
}

describe("HSTS_MAX_AGE_SECONDS deployment wiring", () => {
  test("config.example.env ships it at one year, next to HTTP_PROTOCOL", () => {
    const lines: Array<string> = fs
      .readFileSync(EXAMPLE_ENV_PATH, "utf8")
      .split("\n");

    const settings: Array<string> = lines.filter((line: string) => {
      return line.startsWith(`${ENV_VAR_NAME}=`);
    });

    expect(settings).toEqual([`${ENV_VAR_NAME}=31536000`]);
    expect(parseHstsMaxAgeSeconds("31536000")).toBe(
      DEFAULT_HSTS_MAX_AGE_SECONDS,
    );

    const protocolLine: number = lines.indexOf("HTTP_PROTOCOL=http");
    const hstsLine: number = lines.indexOf(`${ENV_VAR_NAME}=31536000`);

    expect(protocolLine).toBeGreaterThan(-1);
    expect(hstsLine).toBeGreaterThan(protocolLine);
    expect(hstsLine - protocolLine).toBeLessThan(6);
  });

  test("Docker Compose passes it in the shared environment", () => {
    expect(loadCompose()["x-common-variables"][ENV_VAR_NAME]).toBe(REFERENCE);
  });

  test("every Compose service that is told HTTP_PROTOCOL is told this too", () => {
    const services: Record<string, ComposeService> = loadCompose().services;
    const told: Array<string> = Object.keys(services).filter((name: string) => {
      return services[name]?.environment?.["HTTP_PROTOCOL"] !== undefined;
    });

    // The app and the marketing site answer browsers on HOST.
    expect(told).toEqual(expect.arrayContaining(["app", "home"]));

    for (const name of told) {
      expect({
        service: name,
        value: services[name]?.environment?.[ENV_VAR_NAME],
      }).toEqual({ service: name, value: REFERENCE });
    }
  });

  test("what Compose hands over is what the app reads", () => {
    expect(fs.readFileSync(ENVIRONMENT_CONFIG_PATH, "utf8")).toContain(
      `process.env["${ENV_VAR_NAME}"]`,
    );

    const cases: Array<[string | undefined, number]> = [
      // An older config.env without the line: the year.
      [undefined, DEFAULT_HSTS_MAX_AGE_SECONDS],
      ["", DEFAULT_HSTS_MAX_AGE_SECONDS],
      ["31536000", 31536000],
      // The way back to plain HTTP.
      ["0", 0],
      ["600", 600],
      // A typo keeps the protection.
      ["1y", DEFAULT_HSTS_MAX_AGE_SECONDS],
    ];

    for (const [shellValue, seconds] of cases) {
      expect({
        shellValue,
        seconds: parseHstsMaxAgeSeconds(interpolate(shellValue)),
      }).toEqual({ shellValue, seconds });
    }
  });
});
