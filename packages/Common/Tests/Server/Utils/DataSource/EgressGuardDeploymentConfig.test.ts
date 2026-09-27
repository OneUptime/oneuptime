import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import DataSourceEgressGuard, {
  ResolvedAddress,
} from "../../../../Server/Utils/DataSource/EgressGuard";

/*
 * DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES lets a self-hosted operator make the
 * egress guard refuse private ranges for data sources, LLM providers, SMTP,
 * OAuth token URLs, OIDC discovery and runbook HTTP steps. The guard has read
 * it for a long time, and the docs told operators to set it, but Docker
 * Compose never passed it to the app container and config.example.env had no
 * line for it -- so setting it in config.env did nothing.
 *
 * This pins the Compose half of the wiring (the Helm half is covered by
 * HelmChart/Public/oneuptime/tests/outbound-connections-egress_test.yaml) and
 * ties it to the name the guard actually reads, by feeding the interpolated
 * value to the real guard rather than comparing strings.
 */

const ENV_VAR_NAME: string = "DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES";
// The webhook half of the egress policy, already wired end to end.
const SIBLING_ENV_VAR_NAME: string = "ALLOW_PRIVATE_NETWORK_WEBHOOKS";

const REPO_ROOT: string = path.resolve(__dirname, "../../../../../..");
const COMPOSE_PATH: string = path.join(REPO_ROOT, "docker-compose.base.yml");
const EXAMPLE_ENV_PATH: string = path.join(REPO_ROOT, "config.example.env");

type ComposeEnvironment = Record<string, string | number | boolean | null>;

interface ComposeService {
  environment?: ComposeEnvironment;
}

interface ComposeConfig {
  "x-common-variables": ComposeEnvironment;
  services: Record<string, ComposeService>;
}

// js-yaml resolves the `<<: *anchor` merge keys, as Compose does.
const loadCompose: () => ComposeConfig = (): ComposeConfig => {
  return yaml.load(fs.readFileSync(COMPOSE_PATH, "utf8")) as ComposeConfig;
};

const exampleEnvLines: (name: string) => Array<string> = (
  name: string,
): Array<string> => {
  const source: string = fs.readFileSync(EXAMPLE_ENV_PATH, "utf8");
  return source.split("\n").filter((line: string) => {
    return line.startsWith(`${name}=`);
  });
};

/*
 * Resolve a Compose `${NAME:-default}` reference the way Compose does: the
 * default applies when the variable is unset OR empty. config.env is exported
 * into the shell before `docker compose up`, so `shellEnv` stands in for it.
 */
const interpolate: (
  reference: string,
  shellEnv: Record<string, string | undefined>,
) => string = (
  reference: string,
  shellEnv: Record<string, string | undefined>,
): string => {
  const match: RegExpMatchArray | null = reference.match(
    /^\$\{([A-Z0-9_]+):-(.*)\}$/,
  );
  if (!match) {
    throw new Error(`Not a defaulted Compose reference: ${reference}`);
  }
  const value: string | undefined = shellEnv[match[1]!];
  return value ? value : match[2]!;
};

const appReference: () => string = (): string => {
  const reference: unknown =
    loadCompose().services["app"]?.environment?.[ENV_VAR_NAME];
  expect(typeof reference).toBe("string");
  return reference as string;
};

describe("DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES deployment wiring", () => {
  let savedValue: string | undefined = undefined;
  let savedBilling: string | undefined = undefined;

  beforeEach(() => {
    savedValue = process.env[ENV_VAR_NAME];
    savedBilling = process.env["BILLING_ENABLED"];
  });

  afterEach(() => {
    for (const [name, saved] of [
      [ENV_VAR_NAME, savedValue],
      ["BILLING_ENABLED", savedBilling],
    ] as Array<[string, string | undefined]>) {
      if (saved === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = saved;
      }
    }
  });

  test("Docker Compose passes it in the shared environment, defaulted off", () => {
    expect(loadCompose()["x-common-variables"][ENV_VAR_NAME]).toBe(
      `\${${ENV_VAR_NAME}:-false}`,
    );
  });

  /*
   * The app container runs the API, the queue workers, workflows and the
   * notification (SMTP) code, which is every server-side caller of the guard.
   */
  test("the app container receives it", () => {
    expect(appReference()).toBe(`\${${ENV_VAR_NAME}:-false}`);
  });

  test("every Compose service that gets the webhook policy gets this one too", () => {
    const services: Record<string, ComposeService> = loadCompose().services;
    const withWebhookPolicy: Array<string> = Object.keys(services).filter(
      (name: string) => {
        return (
          services[name]?.environment?.[SIBLING_ENV_VAR_NAME] !== undefined
        );
      },
    );

    expect(withWebhookPolicy).toContain("app");
    for (const name of withWebhookPolicy) {
      expect({
        service: name,
        value: services[name]?.environment?.[ENV_VAR_NAME],
      }).toEqual({ service: name, value: `\${${ENV_VAR_NAME}:-false}` });
    }
  });

  /*
   * One line, so an operator flips it instead of appending a second one (the
   * later line would win), and MergeEnvTemplate adds it to an existing
   * config.env on upgrade.
   */
  test("config.example.env ships exactly one line, set to false", () => {
    expect(exampleEnvLines(ENV_VAR_NAME)).toEqual([`${ENV_VAR_NAME}=false`]);
  });

  test("a self-hosted install keeps private ranges reachable with the shipped line", () => {
    const shipped: string = exampleEnvLines(ENV_VAR_NAME)[0]!.split("=")[1]!;
    process.env["BILLING_ENABLED"] = "false";
    process.env[ENV_VAR_NAME] = interpolate(appReference(), {
      [ENV_VAR_NAME]: shipped,
    });

    expect(DataSourceEgressGuard.shouldBlockPrivateAddresses()).toBe(false);
  });

  test("a config.env written before the line existed keeps private ranges reachable", () => {
    process.env["BILLING_ENABLED"] = "false";
    process.env[ENV_VAR_NAME] = interpolate(appReference(), {});

    expect(process.env[ENV_VAR_NAME]).toBe("false");
    expect(DataSourceEgressGuard.shouldBlockPrivateAddresses()).toBe(false);
  });

  // The regression itself: the operator's value has to reach the guard.
  test("setting it to true in config.env makes the guard block private ranges", () => {
    process.env["BILLING_ENABLED"] = "false";
    process.env[ENV_VAR_NAME] = interpolate(appReference(), {
      [ENV_VAR_NAME]: "true",
    });

    expect(DataSourceEgressGuard.shouldBlockPrivateAddresses()).toBe(true);
    expect(DataSourceEgressGuard.checkAddress("10.0.0.5").blocked).toBe(true);
  });

  /*
   * The self-hosted docs quote the refusal an operator sees once the switch is
   * on, so they can match it against a log. Produce it with the real guard,
   * the way LLMService calls it, rather than trusting the copy.
   */
  test("the docs quote the refusal the guard actually reports", async () => {
    const docs: string = fs.readFileSync(
      path.join(
        REPO_ROOT,
        "packages/App/FeatureSet/Docs/Content/en/self-hosted/private-network-access.md",
      ),
      "utf8",
    );
    const quote: RegExpMatchArray | null = docs.match(
      /_"(LLM provider host [^"]+)"_/,
    );
    expect(quote).not.toBeNull();

    process.env["BILLING_ENABLED"] = "false";
    process.env[ENV_VAR_NAME] = "true";

    let message: string = "";
    try {
      await DataSourceEgressGuard.assertUrlAllowedAndPin(
        "http://ollama.internal:11434/v1/chat/completions",
        {
          targetLabel: "LLM provider",
          resolveFunction: async (): Promise<Array<ResolvedAddress>> => {
            return [{ address: "10.0.4.12", family: 4 }];
          },
        },
      );
    } catch (err) {
      message = (err as Error).message;
    }

    expect(message).toBe(quote![1]);
  });
});
