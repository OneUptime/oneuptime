import PrivateNetworkMonitorPolicy, {
  PRIVATE_NETWORK_MONITORS_ENV_VAR,
  PRIVATE_NETWORK_MONITORS_HELM_VALUE,
  PrivateNetworkMonitorPolicyReason,
  PrivateNetworkMonitorStartupMessage,
  ResolvedPrivateNetworkMonitorPolicy,
} from "../../Utils/PrivateNetworkMonitorPolicy";
import DataSourceEgressGuard, {
  ResolvedAddress,
} from "Common/Server/Utils/DataSource/EgressGuard";
import SSRFProtection from "Common/Server/Utils/SSRFProtection";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Regression suite for OneUptime issue #3879, from the deployment side.
 *
 * From 13.0.0 the probe ignored PROBE_ALLOW_PRIVATE_NETWORK_MONITORS whenever
 * REGISTER_PROBE_KEY was set. Every probe the Helm chart and Docker Compose
 * bundle is started with REGISTER_PROBE_KEY, so the setting both of them
 * exposed (probes.<name>.allowPrivateNetworkMonitors, and the config.env line)
 * was accepted and then silently dropped, and the comments and docs beside it
 * were rewritten to say so. Operators upgrading an instance that monitored its
 * own internal services lost those monitors with no way back.
 *
 * The decision now lives in Utils/PrivateNetworkMonitorPolicy.ts and has its
 * own unit tests. What this file pins is everything AROUND it, which is where
 * the regression actually reached users:
 *
 *  - the wiring: each surface still carries the setting to the probe process
 *    under the name the probe reads, alongside the REGISTER_PROBE_KEY that
 *    makes it a global probe (and, on Helm, the BILLING_ENABLED flag that
 *    decides the one remaining exception), and what the probe then decides
 *    for the values each surface can produce;
 *  - the words: no comment beside the setting and no docs page still tells an
 *    operator the bundled probes ignore it; and
 *  - the docs quote the refusal a monitor actually reports, character for
 *    character, because the hint strings are imported from the probe rather
 *    than copied here and the refusals are produced by the real guards.
 *
 * It reads repository files directly, so it needs no Docker, no Helm and no
 * running stack.
 */

const REPO_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

const COMPOSE_BASE_FILE: string = "docker-compose.base.yml";
// Compose files that run the bundled probes by extending the base file.
const COMPOSE_EXTENDING_FILES: ReadonlyArray<string> = [
  "docker-compose.yml",
  path.join("Scripts", "Dev", "docker-compose.dev.yml"),
];
const CONFIG_EXAMPLE_ENV_FILE: string = "config.example.env";
const HELM_CHART_DIR: string = path.join("HelmChart", "Public", "oneuptime");
const HELM_VALUES_FILE: string = path.join(HELM_CHART_DIR, "values.yaml");
const HELM_SCHEMA_FILE: string = path.join(
  HELM_CHART_DIR,
  "values.schema.json",
);
const HELM_PROBE_TEMPLATE_FILE: string = path.join(
  HELM_CHART_DIR,
  "templates",
  "probe.yaml",
);
const HELM_CONFIGURATION_DOC_FILE: string = path.join(
  HELM_CHART_DIR,
  "docs",
  "configuration.md",
);
const PROBE_DIAGNOSTICS_FILE: string = path.join(
  "packages",
  "Probe",
  "Utils",
  "ProbeApiDiagnostics.ts",
);

type DocsLocale = "en" | "fa";

const DOCS_LOCALES: ReadonlyArray<DocsLocale> = ["en", "fa"];

const docsFile: (locale: DocsLocale) => string = (
  locale: DocsLocale,
): string => {
  return path.join(
    "packages",
    "App",
    "FeatureSet",
    "Docs",
    "Content",
    locale,
    "self-hosted",
    "private-network-access.md",
  );
};

const BUNDLED_PROBE_SERVICES: ReadonlyArray<string> = ["probe-1", "probe-2"];
const PROBE_SERVICE_NAME: RegExp = /^probe-\d+$/;

const REGISTER_PROBE_KEY_ENV_VAR: string = "REGISTER_PROBE_KEY";
const BILLING_ENABLED_ENV_VAR: string = "BILLING_ENABLED";

interface YamlModule {
  load: (source: string) => unknown;
}

/*
 * Probe declares no YAML parser of its own. Resolve Common's copy explicitly,
 * as ProbeContainerBrowserSandbox.test.ts does, rather than whatever
 * transitive js-yaml happens to be hoisted into Probe/node_modules.
 */
/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const yaml: YamlModule = require(
  require.resolve("js-yaml", {
    paths: [path.join(REPO_ROOT, "packages", "Common")],
  }),
) as YamlModule;
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

const readRepoFile: (relativePath: string) => string = (
  relativePath: string,
): string => {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
};

const escapeRegExp: (text: string) => string = (text: string): string => {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

/*
 * The comment lines directly above every line that mentions `marker`, plus
 * that line itself: the text an operator reads while editing the setting.
 * Scanning only these keeps a stale-claim pattern from tripping over an
 * unrelated sentence elsewhere in a 3,000-line values file.
 */
const commentBlocksAbove: (content: string, marker: string) => Array<string> = (
  content: string,
  marker: string,
): Array<string> => {
  const lines: Array<string> = content.split("\n");
  const blocks: Array<string> = [];

  lines.forEach((line: string, index: number) => {
    if (!line.includes(marker)) {
      return;
    }
    const block: Array<string> = [line];
    for (let above: number = index - 1; above >= 0; above--) {
      const candidate: string = lines[above] ?? "";
      if (!candidate.trim().startsWith("#")) {
        break;
      }
      block.unshift(candidate);
    }
    blocks.push(block.join("\n"));
  });

  return blocks;
};

// ---------------------------------------------------------------- compose

type ComposeEnvironment = Record<string, string | number | boolean | null>;

interface ComposeService {
  environment?: ComposeEnvironment;
  extends?: { file: string; service: string };
}

interface ComposeFile {
  services: Record<string, ComposeService>;
}

const loadCompose: (relativePath: string) => ComposeFile = (
  relativePath: string,
): ComposeFile => {
  return yaml.load(readRepoFile(relativePath)) as ComposeFile;
};

const composeBase: ComposeFile = loadCompose(COMPOSE_BASE_FILE);

const composeService: (name: string) => ComposeService = (
  name: string,
): ComposeService => {
  const service: ComposeService | undefined = composeBase.services[name];
  if (!service) {
    throw new Error(`${COMPOSE_BASE_FILE} has no service named ${name}`);
  }
  return service;
};

/*
 * config.env is exported into the shell before `docker compose up` (see the
 * root package.json scripts), so its lines are what Compose interpolates. The
 * format is plain KEY=VALUE, one per line, with # comments.
 */
const parseEnvFile: (content: string) => Record<string, string> = (
  content: string,
): Record<string, string> => {
  const variables: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed: string = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separator: number = trimmed.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    variables[trimmed.slice(0, separator)] = trimmed.slice(separator + 1);
  }
  return variables;
};

const configExampleEnvContent: string = readRepoFile(CONFIG_EXAMPLE_ENV_FILE);
const configExampleEnv: Record<string, string> = parseEnvFile(
  configExampleEnvContent,
);

/*
 * Just enough of Compose's interpolation for the values these probes use: a
 * whole-value ${NAME} (empty when unset) or ${NAME:-default} (the default
 * when unset OR empty). Anything else fails loudly rather than being guessed.
 */
const interpolate: (value: string, shell: Record<string, string>) => string = (
  value: string,
  shell: Record<string, string>,
): string => {
  if (!value.includes("$")) {
    return value;
  }
  const match: RegExpMatchArray | null = value.match(
    /^\$\{([A-Za-z0-9_]+)(?::-([^${}]*))?\}$/,
  );
  if (!match || !match[1]) {
    throw new Error(`Unsupported Compose interpolation in test: ${value}`);
  }
  const current: string | undefined = shell[match[1]];
  if (match[2] !== undefined) {
    return current ? current : match[2];
  }
  return current ?? "";
};

/*
 * What a bundled Compose probe's process decides, given the config.env it was
 * started with: the variables are interpolated exactly as Compose would and
 * then read the way Config.ts and Common/Server/EnvironmentConfig read them.
 */
const resolveComposeProbePolicy: (
  serviceName: string,
  configEnv: Record<string, string>,
) => ResolvedPrivateNetworkMonitorPolicy = (
  serviceName: string,
  configEnv: Record<string, string>,
): ResolvedPrivateNetworkMonitorPolicy => {
  const environment: ComposeEnvironment =
    composeService(serviceName).environment || {};

  const processEnv: (name: string) => string | undefined = (
    name: string,
  ): string | undefined => {
    const raw: string | number | boolean | null | undefined = environment[name];
    if (raw === undefined || raw === null) {
      return undefined;
    }
    return interpolate(String(raw), configEnv);
  };

  return PrivateNetworkMonitorPolicy.resolve({
    configuredValue: processEnv(PRIVATE_NETWORK_MONITORS_ENV_VAR),
    isAutoRegisteredGlobalProbe: Boolean(
      processEnv(REGISTER_PROBE_KEY_ENV_VAR),
    ),
    isBillingEnabled: processEnv(BILLING_ENABLED_ENV_VAR) === "true",
  });
};

const withConfigEnv: (
  overrides: Record<string, string | undefined>,
) => Record<string, string> = (
  overrides: Record<string, string | undefined>,
): Record<string, string> => {
  const merged: Record<string, string> = { ...configExampleEnv };
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete merged[name];
    } else {
      merged[name] = value;
    }
  }
  return merged;
};

// ------------------------------------------------------------------- helm

interface HelmProbeValues {
  allowPrivateNetworkMonitors?: unknown;
}

interface HelmValues {
  probes: Record<string, HelmProbeValues>;
}

const helmValuesContent: string = readRepoFile(HELM_VALUES_FILE);
const helmValues: HelmValues = yaml.load(helmValuesContent) as HelmValues;
const helmProbeTemplate: string = readRepoFile(HELM_PROBE_TEMPLATE_FILE);

interface HelmSchemaProperty {
  type?: string;
  description?: string;
}

const helmProbeSchemaProperty: () => HelmSchemaProperty =
  (): HelmSchemaProperty => {
    const schema: {
      properties: {
        probes: {
          patternProperties: Record<
            string,
            { properties: Record<string, HelmSchemaProperty> }
          >;
        };
      };
    } = JSON.parse(readRepoFile(HELM_SCHEMA_FILE));
    const probeSchema:
      | { properties: Record<string, HelmSchemaProperty> }
      | undefined = schema.properties.probes.patternProperties["^.*$"];
    const property: HelmSchemaProperty | undefined =
      probeSchema?.properties["allowPrivateNetworkMonitors"];
    if (!property) {
      throw new Error(
        `${HELM_SCHEMA_FILE} does not describe probes.*.allowPrivateNetworkMonitors`,
      );
    }
    return property;
  };

/*
 * The env value probe.yaml renders for a probe entry:
 * {{ default false $val.allowPrivateNetworkMonitors | squote }}. An unset or
 * false value takes the default, and squote turns the boolean into the string
 * the probe compares against.
 */
const renderHelmAllowPrivateNetworkMonitors: (
  value: boolean | undefined,
) => string = (value: boolean | undefined): string => {
  return value === true ? "true" : "false";
};

// ------------------------------------------------------------------- docs

const docsContent: Record<DocsLocale, string> = {
  en: readRepoFile(docsFile("en")),
  fa: readRepoFile(docsFile("fa")),
};

interface CodeFence {
  language: string;
  body: string;
}

const codeFences: (markdown: string) => Array<CodeFence> = (
  markdown: string,
): Array<CodeFence> => {
  const fences: Array<CodeFence> = [];
  const pattern: RegExp = /^```([^\n]*)\n([\s\S]*?)^```[ \t]*$/gm;
  let match: RegExpExecArray | null = pattern.exec(markdown);
  while (match) {
    fences.push({ language: (match[1] ?? "").trim(), body: match[2] ?? "" });
    match = pattern.exec(markdown);
  }
  return fences;
};

const FENCE_LINE: RegExp = /^\s*```/;

const headingLevels: (markdown: string) => Array<number> = (
  markdown: string,
): Array<number> => {
  const levels: Array<number> = [];
  let inFence: boolean = false;
  for (const line of markdown.split("\n")) {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
      continue;
    }
    const heading: RegExpMatchArray | null = inFence
      ? null
      : line.match(/^(#{1,6})\s/);
    if (heading && heading[1]) {
      levels.push(heading[1].length);
    }
  }
  return levels;
};

/*
 * The error strings the troubleshooting list quotes. The fa corpus keeps them
 * in English inside guillemets, so an operator can match them against a log.
 */
const quotedErrors: (locale: DocsLocale) => Array<string> = (
  locale: DocsLocale,
): Array<string> => {
  const pattern: RegExp = locale === "fa" ? /_«(.+?)»_/g : /_"(.+?)"_/g;
  const quotes: Array<string> = [];
  let match: RegExpExecArray | null = pattern.exec(docsContent[locale]);
  while (match) {
    quotes.push(match[1] ?? "");
    match = pattern.exec(docsContent[locale]);
  }
  return quotes;
};

// A quoted error with "..." standing for the part that varies per monitor.
const quoteMatches: (quote: string, message: string) => boolean = (
  quote: string,
  message: string,
): boolean => {
  const pattern: RegExp = new RegExp(
    `^${quote.split("...").map(escapeRegExp).join(".*")}$`,
  );
  return pattern.test(message);
};

// -------------------------------------------------------- probe contexts

interface ProbeContext {
  description: string;
  isAutoRegisteredGlobalProbe: boolean;
  isBillingEnabled: boolean;
}

const PROBE_CONTEXTS: ReadonlyArray<ProbeContext> = [
  {
    description: "a private probe",
    isAutoRegisteredGlobalProbe: false,
    isBillingEnabled: false,
  },
  {
    description: "a private probe on a billing-enabled instance",
    isAutoRegisteredGlobalProbe: false,
    isBillingEnabled: true,
  },
  {
    description: "a self-hosted global probe",
    isAutoRegisteredGlobalProbe: true,
    isBillingEnabled: false,
  },
  {
    description: "a global probe on a billing-enabled instance",
    isAutoRegisteredGlobalProbe: true,
    isBillingEnabled: true,
  },
];

const refusalHint: (context: ProbeContext) => string = (
  context: ProbeContext,
): string => {
  return PrivateNetworkMonitorPolicy.getRefusalHint({
    isAutoRegisteredGlobalProbe: context.isAutoRegisteredGlobalProbe,
    isBillingEnabled: context.isBillingEnabled,
  });
};

const PRIVATE_LITERAL_TARGET: string = "http://10.0.0.5/health";
const PRIVATE_HOSTNAME_TARGET: string = "http://internal.example.test/health";

const refusalMessage: (run: () => Promise<unknown>) => Promise<string> = async (
  run: () => Promise<unknown>,
): Promise<string> => {
  try {
    await run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("Expected the guard to refuse the target, but it allowed it");
};

/*
 * What an API, Website or External Status Page monitor reports: the options
 * HttpMonitorRequest passes to the egress guard while the policy is off.
 */
const httpMonitorRefusal: (
  target: string,
  hint: string,
) => Promise<string> = async (
  target: string,
  hint: string,
): Promise<string> => {
  return refusalMessage(() => {
    return DataSourceEgressGuard.assertUrlAllowed(target, {
      blockPrivateAddresses: true,
      targetLabel: "Monitor target",
      privateNetworkHint: hint,
      includeResolvedAddressInError: false,
      resolveFunction: async (): Promise<Array<ResolvedAddress>> => {
        return [{ address: "10.0.0.5", family: 4 }];
      },
    });
  });
};

/*
 * What a Custom JavaScript Code monitor reports: the options VMRunner passes
 * to the sandbox bridge's guard for CustomCodeMonitor while the policy is off.
 */
const customCodeMonitorRefusal: (hint: string) => Promise<string> = async (
  hint: string,
): Promise<string> => {
  return refusalMessage(() => {
    return SSRFProtection.validateWebhookTargetIsSafe(PRIVATE_LITERAL_TARGET, {
      allowPrivateNetworkTargets: false,
      privateNetworkAccessIsAllowed: false,
      targetLabel: "Request URL",
      privateNetworkHint: hint,
    });
  });
};

// ----------------------------------------------------------- stale claims

interface StaleClaim {
  description: string;
  pattern: RegExp;
  // The pre-fix wording this pattern exists to catch, so it cannot go vacuous.
  example: string;
}

/*
 * The Persian patterns spell the zero-width non-joiner Persian writes inside
 * words as \u200c, so the character is visible in review; the examples are
 * copied from the pre-fix page and carry it literally.
 */
const STALE_CLAIMS: ReadonlyArray<StaleClaim> = [
  {
    description: "the probe ignores this setting",
    pattern: /\bignores? this\b/i,
    example:
      "Bundled probes auto-register as global probes, so the process ignores this private-probe opt-in",
  },
  {
    description: "global probes always ignore it",
    pattern: /\balways ignores?\b/i,
    example:
      "The probes bundled with Docker Compose and the Helm chart auto-register as global probes, so they always ignore this switch.",
  },
  {
    description: "the global-probe policy cannot be relaxed",
    pattern: /\bcannot be relaxed\b/i,
    example:
      "select a project-owned private probe; the global-probe policy cannot be relaxed.",
  },
  {
    description: "it is ignored by auto-registered global probes",
    pattern: /\bignored by (auto-registered|global)\b/i,
    example: "addresses. Ignored by auto-registered global probes.",
  },
  {
    description: "global probes always enforce a public-only policy",
    pattern:
      /\balways (use|uses|enforce|enforces) (the )?(strict )?public[- ](only|network)\b/i,
    example:
      "Auto-registered global probes always use the strict public-network policy,",
  },
  {
    description: "it belongs only on a separately deployed private probe",
    pattern: /\bonly on a separately deployed private probe\b/i,
    example: "Set it only on a separately deployed private probe.",
  },
  {
    description: "it is ignored even if present",
    pattern: /\beven if this variable is present\b/i,
    example: "even if this variable is present.",
  },
  {
    description: "(fa) the bundled probes always ignore this switch",
    pattern: /همیشه این کلید را نادیده/,
    example: "همیشه این کلید را نادیده می‌گیرند.",
  },
  {
    description: "(fa) the global-probe policy cannot be relaxed",
    pattern: /نمی\u200cتوان شل کرد/,
    example: "سیاست پروب سراسری را نمی‌توان شل کرد.",
  },
  {
    description: "(fa) global probes always use the strict public policy",
    pattern: /همیشه سیاست سخت\u200cگیرانه شبکه عمومی/,
    example:
      "پروب‌های سراسری خودثبت همیشه سیاست سخت‌گیرانه شبکه عمومی را به کار می‌برند،",
  },
  {
    description: "(fa) it is ignored even if the variable is present",
    pattern: /حتی اگر این متغیر باشد/,
    example: "حتی اگر این متغیر باشد.",
  },
];

interface Surface {
  name: string;
  text: () => Array<string>;
}

const SURFACES: ReadonlyArray<Surface> = [
  {
    name: COMPOSE_BASE_FILE,
    text: (): Array<string> => {
      return commentBlocksAbove(
        readRepoFile(COMPOSE_BASE_FILE),
        PRIVATE_NETWORK_MONITORS_ENV_VAR,
      );
    },
  },
  {
    name: CONFIG_EXAMPLE_ENV_FILE,
    text: (): Array<string> => {
      return commentBlocksAbove(
        configExampleEnvContent,
        PRIVATE_NETWORK_MONITORS_ENV_VAR,
      );
    },
  },
  {
    name: HELM_VALUES_FILE,
    text: (): Array<string> => {
      return commentBlocksAbove(
        helmValuesContent,
        "allowPrivateNetworkMonitors",
      );
    },
  },
  {
    name: HELM_PROBE_TEMPLATE_FILE,
    text: (): Array<string> => {
      return commentBlocksAbove(
        helmProbeTemplate,
        PRIVATE_NETWORK_MONITORS_ENV_VAR,
      );
    },
  },
  {
    name: HELM_SCHEMA_FILE,
    text: (): Array<string> => {
      return [helmProbeSchemaProperty().description || ""];
    },
  },
  {
    // The chart's values reference: only the row for this value.
    name: HELM_CONFIGURATION_DOC_FILE,
    text: (): Array<string> => {
      return readRepoFile(HELM_CONFIGURATION_DOC_FILE)
        .split("\n")
        .filter((line: string) => {
          return line.includes("allowPrivateNetworkMonitors");
        });
    },
  },
  {
    name: docsFile("en"),
    text: (): Array<string> => {
      return [docsContent.en];
    },
  },
  {
    name: docsFile("fa"),
    text: (): Array<string> => {
      return [docsContent.fa];
    },
  },
];

// ================================================================== tests

describe("private network monitors across deployment surfaces (issue #3879)", () => {
  describe(`${COMPOSE_BASE_FILE} bundled probes`, () => {
    test("are exactly probe-1 and probe-2", () => {
      expect(
        Object.keys(composeBase.services).filter((name: string) => {
          return PROBE_SERVICE_NAME.test(name);
        }),
      ).toEqual([...BUNDLED_PROBE_SERVICES]);
    });

    test.each(BUNDLED_PROBE_SERVICES)(
      "%s takes the setting from config.env and defaults it to off",
      (serviceName: string) => {
        expect(
          composeService(serviceName).environment?.[
            PRIVATE_NETWORK_MONITORS_ENV_VAR
          ],
        ).toBe(`\${${PRIVATE_NETWORK_MONITORS_ENV_VAR}:-false}`);
      },
    );

    test.each(BUNDLED_PROBE_SERVICES)(
      "%s registers with REGISTER_PROBE_KEY, so it runs as a global probe",
      (serviceName: string) => {
        expect(
          composeService(serviceName).environment?.[REGISTER_PROBE_KEY_ENV_VAR],
        ).toBe(`\${${REGISTER_PROBE_KEY_ENV_VAR}}`);
      },
    );

    test.each(BUNDLED_PROBE_SERVICES)(
      "%s keeps private network monitoring off with the stock config.example.env",
      (serviceName: string) => {
        const policy: ResolvedPrivateNetworkMonitorPolicy =
          resolveComposeProbePolicy(serviceName, configExampleEnv);

        expect(policy.isAutoRegisteredGlobalProbe).toBe(true);
        expect(policy.allowed).toBe(false);
        expect(policy.reason).toBe(
          PrivateNetworkMonitorPolicyReason.NotRequested,
        );
      },
    );

    test.each(BUNDLED_PROBE_SERVICES)(
      "%s allows private network monitors when config.env turns the setting on",
      (serviceName: string) => {
        // The exact case 13.0.0 broke: a global probe told "true" said no.
        const policy: ResolvedPrivateNetworkMonitorPolicy =
          resolveComposeProbePolicy(
            serviceName,
            withConfigEnv({ [PRIVATE_NETWORK_MONITORS_ENV_VAR]: "true" }),
          );

        expect(policy.isAutoRegisteredGlobalProbe).toBe(true);
        expect(policy.allowed).toBe(true);
        expect(policy.reason).toBe(PrivateNetworkMonitorPolicyReason.Allowed);
      },
    );

    test.each(BUNDLED_PROBE_SERVICES)(
      "%s warns at startup that turning it on opens the probe to every project",
      (serviceName: string) => {
        const startupMessage: PrivateNetworkMonitorStartupMessage =
          PrivateNetworkMonitorPolicy.getStartupMessage(
            resolveComposeProbePolicy(
              serviceName,
              withConfigEnv({ [PRIVATE_NETWORK_MONITORS_ENV_VAR]: "true" }),
            ),
          );

        expect(startupMessage.level).toBe("warn");
        expect(startupMessage.message).toContain("every project");
      },
    );

    test.each(BUNDLED_PROBE_SERVICES)(
      "%s stays off when an older config.env has no line for the setting",
      (serviceName: string) => {
        const policy: ResolvedPrivateNetworkMonitorPolicy =
          resolveComposeProbePolicy(
            serviceName,
            withConfigEnv({ [PRIVATE_NETWORK_MONITORS_ENV_VAR]: undefined }),
          );

        expect(policy.configuredValue).toBe("false");
        expect(policy.allowed).toBe(false);
        expect(policy.reason).toBe(
          PrivateNetworkMonitorPolicyReason.NotRequested,
        );
      },
    );

    test.each(BUNDLED_PROBE_SERVICES)(
      "%s stays off, and says why at startup, when config.env has a value other than true",
      (serviceName: string) => {
        const policy: ResolvedPrivateNetworkMonitorPolicy =
          resolveComposeProbePolicy(
            serviceName,
            withConfigEnv({ [PRIVATE_NETWORK_MONITORS_ENV_VAR]: "TRUE" }),
          );

        expect(policy.allowed).toBe(false);
        expect(policy.reason).toBe(
          PrivateNetworkMonitorPolicyReason.UnrecognizedValue,
        );
        expect(
          PrivateNetworkMonitorPolicy.getStartupMessage(policy).level,
        ).toBe("warn");
      },
    );

    test.each(BUNDLED_PROBE_SERVICES)(
      "%s is given BILLING_ENABLED from config.env, as the Helm chart's probes are",
      (serviceName: string) => {
        expect(
          composeService(serviceName).environment?.[BILLING_ENABLED_ENV_VAR],
        ).toBe(`\${${BILLING_ENABLED_ENV_VAR}}`);
      },
    );

    test.each(BUNDLED_PROBE_SERVICES)(
      "%s keeps the stock config.example.env's BILLING_ENABLED=false, so the opt-in is honored on a self-hosted install",
      (serviceName: string) => {
        const policy: ResolvedPrivateNetworkMonitorPolicy =
          resolveComposeProbePolicy(
            serviceName,
            withConfigEnv({ [PRIVATE_NETWORK_MONITORS_ENV_VAR]: "true" }),
          );

        expect(configExampleEnv[BILLING_ENABLED_ENV_VAR]).toBe("false");
        expect(policy.isBillingEnabled).toBe(false);
        expect(policy.allowed).toBe(true);
      },
    );

    test.each(BUNDLED_PROBE_SERVICES)(
      "%s stays public-only, and warns that the opt-in is ignored, on a billing-enabled instance",
      (serviceName: string) => {
        const policy: ResolvedPrivateNetworkMonitorPolicy =
          resolveComposeProbePolicy(
            serviceName,
            withConfigEnv({
              [PRIVATE_NETWORK_MONITORS_ENV_VAR]: "true",
              [BILLING_ENABLED_ENV_VAR]: "true",
            }),
          );
        const startupMessage: PrivateNetworkMonitorStartupMessage =
          PrivateNetworkMonitorPolicy.getStartupMessage(policy);

        expect(policy.isAutoRegisteredGlobalProbe).toBe(true);
        expect(policy.isBillingEnabled).toBe(true);
        expect(policy.allowed).toBe(false);
        expect(policy.reason).toBe(
          PrivateNetworkMonitorPolicyReason.RefusedOnHostedGlobalProbe,
        );
        expect(startupMessage.level).toBe("warn");
        expect(startupMessage.message).toContain("IGNORED");
      },
    );

    test.each(BUNDLED_PROBE_SERVICES)(
      "%s treats a config.env with no BILLING_ENABLED line as self-hosted",
      (serviceName: string) => {
        const policy: ResolvedPrivateNetworkMonitorPolicy =
          resolveComposeProbePolicy(
            serviceName,
            withConfigEnv({
              [PRIVATE_NETWORK_MONITORS_ENV_VAR]: "true",
              [BILLING_ENABLED_ENV_VAR]: undefined,
            }),
          );

        expect(policy.isBillingEnabled).toBe(false);
        expect(policy.allowed).toBe(true);
      },
    );

    test("both bundled probes read the same config.env variable, so one line sets both", () => {
      const settings: Array<unknown> = BUNDLED_PROBE_SERVICES.map(
        (serviceName: string) => {
          return composeService(serviceName).environment?.[
            PRIVATE_NETWORK_MONITORS_ENV_VAR
          ];
        },
      );

      expect(new Set<unknown>(settings).size).toBe(1);
    });

    test("the comment beside each probe's setting says it is honored on both bundled probes", () => {
      const blocks: Array<string> = commentBlocksAbove(
        readRepoFile(COMPOSE_BASE_FILE),
        `${PRIVATE_NETWORK_MONITORS_ENV_VAR}:`,
      );

      expect(blocks).toHaveLength(BUNDLED_PROBE_SERVICES.length);
      for (const block of blocks) {
        expect(block).toMatch(/honored/i);
        expect(block).toMatch(/both bundled probes/i);
        expect(block).toMatch(/every project/i);
      }
    });
  });

  describe("compose files that run the bundled probes", () => {
    /*
     * The release stack (docker-compose.yml) runs probe-1 only and the dev
     * stack runs both, so check whichever probes each file actually runs.
     */
    test.each(COMPOSE_EXTENDING_FILES)(
      "%s inherits the private-network wiring from the base file unchanged",
      (relativePath: string) => {
        const compose: ComposeFile = loadCompose(relativePath);
        const probeServiceNames: Array<string> = Object.keys(
          compose.services,
        ).filter((name: string) => {
          return PROBE_SERVICE_NAME.test(name);
        });

        expect(probeServiceNames.length).toBeGreaterThan(0);
        for (const serviceName of probeServiceNames) {
          const service: ComposeService | undefined =
            compose.services[serviceName];

          expect(BUNDLED_PROBE_SERVICES).toContain(serviceName);
          expect(service?.extends?.service).toBe(serviceName);
          expect(path.basename(service?.extends?.file || "")).toBe(
            COMPOSE_BASE_FILE,
          );
          expect(
            service?.environment?.[PRIVATE_NETWORK_MONITORS_ENV_VAR],
          ).toBeUndefined();
          expect(
            service?.environment?.[REGISTER_PROBE_KEY_ENV_VAR],
          ).toBeUndefined();
        }
      },
    );
  });

  describe(CONFIG_EXAMPLE_ENV_FILE, () => {
    test("defines the setting exactly once, off", () => {
      const definitions: Array<string> = configExampleEnvContent
        .split("\n")
        .filter((line: string) => {
          return line.startsWith(`${PRIVATE_NETWORK_MONITORS_ENV_VAR}=`);
        });

      expect(definitions).toEqual([
        `${PRIVATE_NETWORK_MONITORS_ENV_VAR}=false`,
      ]);
    });

    test("defines the REGISTER_PROBE_KEY the bundled probes register with", () => {
      expect(configExampleEnv[REGISTER_PROBE_KEY_ENV_VAR]).toBeTruthy();
    });

    test("explains that the setting reaches both bundled global probes and every project", () => {
      const blocks: Array<string> = commentBlocksAbove(
        configExampleEnvContent,
        `${PRIVATE_NETWORK_MONITORS_ENV_VAR}=`,
      );

      expect(blocks).toHaveLength(1);
      const block: string = blocks[0] ?? "";
      expect(block).toContain("probe-1");
      expect(block).toContain("probe-2");
      expect(block).toMatch(/global probes/i);
      expect(block).toMatch(/every project/i);
      expect(block).toContain("BILLING_ENABLED=true");
      expect(block).toMatch(/loopback, link-local or the cloud metadata/i);
    });
  });

  describe("Helm chart", () => {
    test("values.yaml ships every chart probe with the setting off", () => {
      const probes: Array<[string, HelmProbeValues]> = Object.entries(
        helmValues.probes,
      );

      expect(probes.length).toBeGreaterThan(0);
      for (const [name, probe] of probes) {
        expect({ name, value: probe.allowPrivateNetworkMonitors }).toEqual({
          name,
          value: false,
        });
      }
    });

    test("values.schema.json accepts only a boolean, so the chart can only render true or false", () => {
      expect(helmProbeSchemaProperty().type).toBe("boolean");
    });

    test("templates/probe.yaml renders the setting from allowPrivateNetworkMonitors as a quoted string", () => {
      const lines: Array<string> = helmProbeTemplate.split("\n");
      const nameIndex: number = lines.findIndex((line: string) => {
        return line.trim() === `- name: ${PRIVATE_NETWORK_MONITORS_ENV_VAR}`;
      });

      expect(nameIndex).toBeGreaterThanOrEqual(0);
      const valueLine: string = (lines[nameIndex + 1] ?? "").trim();
      expect(valueLine).toMatch(/^value: \{\{.*\}\}$/);
      expect(valueLine).toContain("$val.allowPrivateNetworkMonitors");
      expect(valueLine).toContain("default false");
      expect(valueLine).toContain("squote");
    });

    test("templates/probe.yaml registers each chart probe as a global probe and passes it billing.enabled", () => {
      expect(helmProbeTemplate).toContain(
        'include "oneuptime.env.registerProbeKey"',
      );

      const lines: Array<string> = helmProbeTemplate.split("\n");
      const billingIndex: number = lines.findIndex((line: string) => {
        return line.trim() === `- name: ${BILLING_ENABLED_ENV_VAR}`;
      });
      expect(billingIndex).toBeGreaterThanOrEqual(0);
      expect(lines[billingIndex + 1] ?? "").toContain(
        "$.Values.billing.enabled",
      );
    });

    test.each([
      { value: true, billing: false, allowed: true },
      { value: false, billing: false, allowed: false },
      { value: undefined, billing: false, allowed: false },
      { value: true, billing: true, allowed: false },
    ])(
      "a chart probe with allowPrivateNetworkMonitors=$value and billing.enabled=$billing resolves to allowed=$allowed",
      (row: {
        value: boolean | undefined;
        billing: boolean;
        allowed: boolean;
      }) => {
        const policy: ResolvedPrivateNetworkMonitorPolicy =
          PrivateNetworkMonitorPolicy.resolve({
            configuredValue: renderHelmAllowPrivateNetworkMonitors(row.value),
            isAutoRegisteredGlobalProbe: true,
            isBillingEnabled: row.billing,
          });

        expect(policy.allowed).toBe(row.allowed);
        // Never "unrecognized": the chart cannot render anything else.
        expect(policy.reason).not.toBe(
          PrivateNetworkMonitorPolicyReason.UnrecognizedValue,
        );
        if (row.value === true && row.billing) {
          expect(policy.reason).toBe(
            PrivateNetworkMonitorPolicyReason.RefusedOnHostedGlobalProbe,
          );
        }
      },
    );

    test("the Helm value a refusal names exists on every chart probe", () => {
      const [root, placeholder, key] =
        PRIVATE_NETWORK_MONITORS_HELM_VALUE.split(".");

      expect(root).toBe("probes");
      expect(placeholder).toBe("<name>");
      for (const probe of Object.values(helmValues.probes)) {
        expect(Object.keys(probe)).toContain(key);
      }
      expect(
        refusalHint({
          description: "a self-hosted global probe",
          isAutoRegisteredGlobalProbe: true,
          isBillingEnabled: false,
        }),
      ).toContain(PRIVATE_NETWORK_MONITORS_HELM_VALUE);
    });
  });

  describe("no surface still says the bundled probes ignore the setting", () => {
    test.each(STALE_CLAIMS)(
      "the stale-claim check for '$description' recognises the wording it was written for",
      (claim: StaleClaim) => {
        expect(claim.example).toMatch(claim.pattern);
      },
    );

    test.each(SURFACES)("$name", (surface: Surface) => {
      const texts: Array<string> = surface.text();
      expect(texts.length).toBeGreaterThan(0);

      const found: Array<string> = [];
      for (const text of texts) {
        for (const line of text.split("\n")) {
          for (const claim of STALE_CLAIMS) {
            if (claim.pattern.test(line)) {
              found.push(`${claim.description}: ${line.trim()}`);
            }
          }
        }
      }

      expect(found).toEqual([]);
    });
  });

  describe.each(DOCS_LOCALES)(
    "private-network-access docs (%s)",
    (locale: DocsLocale) => {
      const content: string = docsContent[locale];

      test("give the Helm values that turn the setting on for a chart probe", () => {
        const helmExamples: Array<unknown> = codeFences(content)
          .filter((fence: CodeFence) => {
            return fence.language === "yaml";
          })
          .map((fence: CodeFence) => {
            return yaml.load(fence.body);
          });

        const turnsItOn: boolean = helmExamples.some((example: unknown) => {
          const probes: Record<string, HelmProbeValues> | undefined = (
            example as { probes?: Record<string, HelmProbeValues> } | null
          )?.probes;
          return Object.values(probes || {}).some((probe: HelmProbeValues) => {
            return probe.allowPrivateNetworkMonitors === true;
          });
        });

        expect(turnsItOn).toBe(true);
      });

      test("give the environment line for a Compose or custom probe", () => {
        expect(
          codeFences(content).map((fence: CodeFence) => {
            return fence.body.trim();
          }),
        ).toContain(`${PRIVATE_NETWORK_MONITORS_ENV_VAR}=true`);
      });

      test("say the Compose line goes in config.env and name the bundled probes it reaches", () => {
        expect(content).toContain("`config.env`");
        for (const serviceName of BUNDLED_PROBE_SERVICES) {
          expect(content).toContain(`\`${serviceName}\``);
        }
      });

      test("name what makes a probe global and the one instance setting that keeps it public-only", () => {
        expect(content).toContain(`\`${REGISTER_PROBE_KEY_ENV_VAR}\``);
        expect(content).toContain(`\`${BILLING_ENABLED_ENV_VAR}=true\``);
      });

      test("name the key the probe's startup environment dump reports its policy under", () => {
        // Read, not imported: ProbeApiDiagnostics pulls in Config.ts, which exits without a probe key.
        expect(readRepoFile(PROBE_DIAGNOSTICS_FILE)).toMatch(
          /privateNetworkMonitors:\s*PrivateNetworkMonitorPolicy\.getDiagnosticsSnapshot\(/,
        );
        expect(content).toContain("`privateNetworkMonitors`");
      });

      test.each(PROBE_CONTEXTS)(
        "quote, word for word, the hint $description adds to a refusal",
        (context: ProbeContext) => {
          const hint: string = refusalHint(context);

          expect(hint.trim().length).toBeGreaterThan(0);
          expect(content).toContain(hint.trim());
        },
      );

      test.each(PROBE_CONTEXTS)(
        "explain the refusal an API, Website or External Status Page monitor on $description reports for a private IP, in exactly one entry",
        async (context: ProbeContext) => {
          const message: string = await httpMonitorRefusal(
            PRIVATE_LITERAL_TARGET,
            refusalHint(context),
          );

          expect(message).toContain(refusalHint(context).trim());
          expect(
            quotedErrors(locale).filter((quote: string) => {
              return quoteMatches(quote, message);
            }),
          ).toHaveLength(1);
        },
      );

      test.each(PROBE_CONTEXTS)(
        "explain the refusal a Custom JavaScript Code monitor on $description reports for a private IP, in exactly one entry",
        async (context: ProbeContext) => {
          const message: string = await customCodeMonitorRefusal(
            refusalHint(context),
          );

          expect(message).toContain(refusalHint(context).trim());
          expect(
            quotedErrors(locale).filter((quote: string) => {
              return quoteMatches(quote, message);
            }),
          ).toHaveLength(1);
        },
      );

      test.each(PROBE_CONTEXTS)(
        "explain that a hostname resolving to a private address on $description reports 'could not be reached' with no hint",
        async (context: ProbeContext) => {
          const message: string = await httpMonitorRefusal(
            PRIVATE_HOSTNAME_TARGET,
            refusalHint(context),
          );

          expect(message).toBe(
            "Monitor target host internal.example.test could not be reached.",
          );
          expect(message).not.toContain(refusalHint(context).trim());
          expect(
            quotedErrors(locale).filter((quote: string) => {
              return quoteMatches(quote, message);
            }),
          ).toHaveLength(1);
        },
      );
    },
  );

  describe("the fa translation of private-network-access", () => {
    test("keeps every code block byte-identical to en", () => {
      expect(codeFences(docsContent.fa)).toEqual(codeFences(docsContent.en));
    });

    test("keeps every quoted error string byte-identical to en", () => {
      expect(quotedErrors("fa")).toEqual(quotedErrors("en"));
    });

    test("keeps the en heading outline", () => {
      expect(headingLevels(docsContent.fa)).toEqual(
        headingLevels(docsContent.en),
      );
    });
  });
});
