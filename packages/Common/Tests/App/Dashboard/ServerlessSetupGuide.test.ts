import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  DEFAULT_SERVERLESS_PLATFORM,
  LAMBDA_EXEC_WRAPPER,
  LAMBDA_LAYER_DOCS_URL,
  SERVERLESS_DOCS_URL,
  SERVERLESS_EXAMPLE_FUNCTION_NAME,
  SERVERLESS_EXAMPLE_FUNCTION_VERSION,
  SERVERLESS_PLATFORMS,
  ServerlessEnvironmentVariable,
  ServerlessPlatform,
  getServerlessCloudPlatform,
  getServerlessEnvironmentVariables,
  getServerlessPlatformForCloudPlatform,
  getServerlessResourceAttributes,
  getServerlessSetupGuide,
  resolveServerlessPlatform,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Serverless/ServerlessSetupGuide";
import {
  SETUP_GUIDE_API_KEY_PLACEHOLDER,
  SetupGuideContent,
  SetupGuideOption,
  SetupGuideStep,
  SetupGuideStepVariant,
  SetupGuideTopic,
  getSetupGuideCodeBlocks,
  getSetupGuideMarkdown,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";
import {
  FAAS_CLOUD_PLATFORM_VALUES,
  FaasCloudPlatform,
} from "../../../Types/Cloud/CloudPlatform";

/*
 * The serverless guide asks where the functions run, then shows only that
 * platform's way of setting the exporter's environment variables. These
 * tests pin, for every platform:
 *
 *   - the variables themselves, with the reader's URL and key in them, as
 *     NAME=value lines a console takes (no shell quoting to paste along);
 *   - the cloud.platform each platform sets, which must be one ingest reads
 *     as a serverless function;
 *   - faas.name, which every tab of a function filters on — suggested on the
 *     product pages, the function's own identifier on its Documentation tab;
 *   - that no platform is told to use a CLI form that splits
 *     OTEL_RESOURCE_ATTRIBUTES on its commas or replaces every variable the
 *     function already has;
 *   - that one platform's instructions never leak into another's.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");
const DASHBOARD_SRC: string = path.join(
  REPO_ROOT,
  "packages/App/FeatureSet/Dashboard/src",
);
const DOCS_CONTENT: string = path.join(
  REPO_ROOT,
  "packages/App/FeatureSet/Docs/Content/en",
);

const URL: string = "https://oneuptime.example.com";
const KEY: string = "tik_secret_123";

const PLATFORM_KEYS: Array<ServerlessPlatform> = SERVERLESS_PLATFORMS.map(
  (option: SetupGuideOption<ServerlessPlatform>): ServerlessPlatform => {
    return option.key;
  },
);

const guideFor: (
  platform: ServerlessPlatform,
  overrides?: { functionName?: string; apiKey?: string },
) => SetupGuideContent = (
  platform: ServerlessPlatform,
  overrides?: { functionName?: string; apiKey?: string },
): SetupGuideContent => {
  return getServerlessSetupGuide({
    oneuptimeUrl: URL,
    apiKey: overrides?.apiKey ?? KEY,
    platform: platform,
    functionName: overrides?.functionName,
  });
};

const topicTitles: (
  topics: Array<SetupGuideTopic> | undefined,
) => Array<string> = (
  topics: Array<SetupGuideTopic> | undefined,
): Array<string> => {
  return (topics || []).map((topic: SetupGuideTopic): string => {
    return topic.title;
  });
};

// The steps' own text — what a first setup reads, without Advanced.
const stepsText: (guide: SetupGuideContent) => string = (
  guide: SetupGuideContent,
): string => {
  return guide.steps
    .map((step: SetupGuideStep): string => {
      return [
        step.title,
        step.description || "",
        step.markdown || "",
        ...(step.variants || []).map(
          (variant: SetupGuideStepVariant): string => {
            return variant.markdown;
          },
        ),
      ].join("\n");
    })
    .join("\n");
};

// The step that sets the variables: the one before "Invoke the function".
const settingsStep: (guide: SetupGuideContent) => SetupGuideStep = (
  guide: SetupGuideContent,
): SetupGuideStep => {
  return guide.steps[guide.steps.length - 2]!;
};

/*
 * Regex literals are named so the callsites read `RE.test(line)`: eslint's
 * wrap-regex rule rejects `/.../.test(line)`.
 */
const VARIABLE_LINE: RegExp = /^[A-Z][A-Z0-9_]*=/;
const REFERENCE_ROW: RegExp = /^\| `[A-Z_]+` \|/;

// The NAME=value lines of the code blocks in a piece of markdown.
const variableLinesIn: (markdown: string) => Array<string> = (
  markdown: string,
): Array<string> => {
  const lines: Array<string> = [];
  for (const match of markdown.matchAll(/```bash\n([\s\S]*?)```/g)) {
    for (const line of match[1]!.split("\n")) {
      if (VARIABLE_LINE.test(line)) {
        lines.push(line);
      }
    }
  }
  return lines;
};

const docsPageExists: (url: string) => boolean = (url: string): boolean => {
  return fs.existsSync(
    path.join(DOCS_CONTENT, `${url.replace(/^\/docs\//, "")}.md`),
  );
};

describe("the platform picker", () => {
  test("offers Lambda, Google Cloud Functions, Azure Functions and other runtimes, Lambda first", () => {
    expect(PLATFORM_KEYS).toEqual([
      "aws-lambda",
      "google-cloud-functions",
      "azure-functions",
      "other",
    ]);
    expect(
      SERVERLESS_PLATFORMS.map(
        (option: SetupGuideOption<ServerlessPlatform>): string => {
          return option.label;
        },
      ),
    ).toEqual([
      "AWS Lambda",
      "Google Cloud Functions",
      "Azure Functions",
      "Other runtimes",
    ]);
    expect(DEFAULT_SERVERLESS_PLATFORM).toBe("aws-lambda");
  });

  test("every platform has a one-line description and no badge", () => {
    for (const option of SERVERLESS_PLATFORMS) {
      expect((option.description || "").length).toBeGreaterThan(0);
      expect(option.description).not.toContain("\n");
      expect(option.badge).toBeUndefined();
    }
    const other: SetupGuideOption<ServerlessPlatform> | undefined =
      SERVERLESS_PLATFORMS.find(
        (option: SetupGuideOption<ServerlessPlatform>): boolean => {
          return option.key === "other";
        },
      );
    expect(other?.description).toContain("Cloudflare Workers");
  });

  test("an unknown or missing platform resolves to AWS Lambda", () => {
    for (const value of [undefined, null, "", "lambda", "AWS-LAMBDA"]) {
      expect(resolveServerlessPlatform(value)).toBe("aws-lambda");
    }
    for (const platform of PLATFORM_KEYS) {
      expect(resolveServerlessPlatform(platform)).toBe(platform);
    }
  });

  test("each cloud platform option sets a cloud.platform ingest reads as serverless", () => {
    expect(getServerlessCloudPlatform("aws-lambda")).toBe("aws_lambda");
    expect(getServerlessCloudPlatform("google-cloud-functions")).toBe(
      "gcp_cloud_functions",
    );
    expect(getServerlessCloudPlatform("azure-functions")).toBe(
      "azure_functions",
    );
    expect(getServerlessCloudPlatform("other")).toBeUndefined();

    for (const platform of PLATFORM_KEYS) {
      const value: string | undefined = getServerlessCloudPlatform(platform);
      if (value) {
        expect(FAAS_CLOUD_PLATFORM_VALUES.has(value)).toBe(true);
      }
    }
  });

  test("a function's reported cloud.platform picks its option", () => {
    expect(getServerlessPlatformForCloudPlatform("aws_lambda")).toBe(
      "aws-lambda",
    );
    expect(getServerlessPlatformForCloudPlatform("gcp_cloud_functions")).toBe(
      "google-cloud-functions",
    );
    expect(getServerlessPlatformForCloudPlatform("azure_functions")).toBe(
      "azure-functions",
    );
    // The Node.js and .NET Azure detectors spell it with a dot.
    expect(getServerlessPlatformForCloudPlatform("azure.functions")).toBe(
      "azure-functions",
    );
    // Platforms without an option of their own get the generic guide.
    for (const value of [
      "tencent_cloud_scf",
      "alibaba_cloud_fc",
      "gcp_cloud_run",
    ]) {
      expect(getServerlessPlatformForCloudPlatform(value)).toBe("other");
    }
    // Nothing reported yet: the card opens on its default.
    for (const value of [undefined, null, "", "   "]) {
      expect(getServerlessPlatformForCloudPlatform(value)).toBeUndefined();
    }
  });
});

describe.each(PLATFORM_KEYS)("the %s guide", (platform: ServerlessPlatform) => {
  const guide: SetupGuideContent = guideFor(platform);
  const markdown: string = getSetupGuideMarkdown(guide);
  const steps: string = stepsText(guide);
  const isLambda: boolean = platform === "aws-lambda";
  const cloudPlatform: string | undefined =
    getServerlessCloudPlatform(platform);

  test("ends by invoking the function and checking it arrived", () => {
    expect(guide.steps.length).toBeGreaterThanOrEqual(2);
    expect(guide.steps.length).toBeLessThanOrEqual(3);
    expect(guide.steps[guide.steps.length - 1]!.title).toBe(
      "Invoke the function and verify",
    );
    for (const step of guide.steps) {
      expect((step.description || "").length).toBeGreaterThan(0);
      expect(step.description).not.toContain("\n");
    }
  });

  test("step 1 shows the OTLP endpoint the variables point at", () => {
    expect(guide.keyStep?.endpointLabel).toBe("OTLP Endpoint");
    expect(guide.keyStep?.endpointValue).toBe(`${URL}/otlp`);
    expect((guide.keyStep?.description || "").length).toBeGreaterThan(0);
  });

  test("sets the exporter variables with the reader's URL and key", () => {
    const lines: Array<string> = variableLinesIn(steps);
    expect(lines).toContain(`OTEL_EXPORTER_OTLP_ENDPOINT=${URL}/otlp`);
    expect(lines).toContain(
      `OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=${KEY}`,
    );
    expect(lines).toContain("OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf");
  });

  test("the variables are console-ready NAME=value lines, never shell-quoted", () => {
    const lines: Array<string> = variableLinesIn(
      [
        settingsStep(guide).markdown || "",
        ...(settingsStep(guide).variants || [])
          .filter((variant: SetupGuideStepVariant): boolean => {
            return variant.label !== "Azure CLI";
          })
          .map((variant: SetupGuideStepVariant): string => {
            return variant.markdown;
          }),
      ].join("\n"),
    );
    expect(lines.length).toBeGreaterThanOrEqual(4);
    for (const line of lines) {
      expect(line).not.toMatch(/["']/);
      expect(line).not.toMatch(/^export /);
    }
  });

  test("names the function and its platform the way this platform needs", () => {
    const lines: Array<string> = variableLinesIn(steps);
    const resourceLine: string | undefined = lines.find(
      (line: string): boolean => {
        return line.startsWith("OTEL_RESOURCE_ATTRIBUTES=");
      },
    );

    if (isLambda) {
      // The layer names the function; the guide sets no attributes of its own.
      expect(resourceLine).toBeUndefined();
      expect(lines).toContain(`AWS_LAMBDA_EXEC_WRAPPER=${LAMBDA_EXEC_WRAPPER}`);
      expect(steps).toContain("sets `faas.name` from the function's name");
      return;
    }

    expect(resourceLine).toBe(
      `OTEL_RESOURCE_ATTRIBUTES=${getServerlessResourceAttributes({
        platform: platform,
        functionName: SERVERLESS_EXAMPLE_FUNCTION_NAME,
      })}`,
    );
    expect(resourceLine).toContain(
      `faas.name=${SERVERLESS_EXAMPLE_FUNCTION_NAME},faas.version=${SERVERLESS_EXAMPLE_FUNCTION_VERSION}`,
    );
    if (cloudPlatform) {
      expect(resourceLine).toContain(`,cloud.platform=${cloudPlatform}`);
    } else {
      expect(resourceLine).not.toContain("cloud.platform");
    }
  });

  test("assigns only its own cloud.platform", () => {
    for (const other of PLATFORM_KEYS) {
      const value: string | undefined = getServerlessCloudPlatform(other);
      if (!value) {
        continue;
      }
      expect(markdown.includes(`cloud.platform=${value}`)).toBe(
        other === platform,
      );
    }
  });

  test("every command carries the reader's URL and key", () => {
    const blocks: Array<string> = getSetupGuideCodeBlocks(guide);
    const withToken: Array<string> = blocks.filter((block: string): boolean => {
      return block.includes("x-oneuptime-token");
    });
    expect(withToken.length).toBeGreaterThanOrEqual(2);
    for (const block of withToken) {
      expect(block).toContain(KEY);
      expect(block).toContain(URL);
    }
    expect(markdown).not.toContain(SETUP_GUIDE_API_KEY_PLACEHOLDER);
  });

  test("verifies the key against the validate endpoint", () => {
    const verify: string = guide.steps[guide.steps.length - 1]!.markdown || "";
    expect(verify).toContain(
      `curl -i ${URL}/otlp/v1/validate \\\n  -H "x-oneuptime-token: ${KEY}"`,
    );
    expect(verify).toContain('`200` with `"valid": true`');
    expect(verify).toContain("`401`");
    expect(verify).toContain(
      "Once the function emits a span, log or metric it appears under **Serverless Functions**.",
    );
    expect(verify).toContain("invocations, error rate and p95 duration");
  });

  test("keeps the note that the token is a secret for a Server key", () => {
    expect(steps).toContain(
      "> **This token is a secret.** Use a **Server** ingestion key here and set it as a function environment variable.",
    );
    expect(steps).toContain("create a **Browser** ingestion key instead");
  });

  test("never uses a CLI form that splits values on commas or replaces every variable", () => {
    for (const forbidden of [
      "--set-env-vars",
      "--update-env-vars",
      "--env-vars-file",
      "update-function-configuration",
      "--environment",
      "Variables={",
      "gcloud functions deploy",
      "gcloud run services update",
    ]) {
      expect(markdown).not.toContain(forbidden);
    }
  });

  test("shows only its own platform's instructions", () => {
    const own: Record<ServerlessPlatform, Array<string>> = {
      "aws-lambda": [
        "AWS_LAMBDA_EXEC_WRAPPER",
        "Specify an ARN",
        "Lambda console",
        LAMBDA_LAYER_DOCS_URL,
      ],
      "google-cloud-functions": [
        "Edit & deploy new revision",
        "Runtime environment variables",
        "Google Cloud console",
      ],
      "azure-functions": [
        "az functionapp config appsettings set",
        "Apply → Confirm",
        "azure.functions",
        "Azure portal",
      ],
      other: ["configured in code rather than through environment variables"],
    };

    for (const other of PLATFORM_KEYS) {
      for (const text of own[other]) {
        expect({ text, present: markdown.includes(text) }).toEqual({
          text,
          present: other === platform,
        });
      }
    }
  });

  test("lists two to four prerequisites, one line each", () => {
    const prerequisites: Array<string> = guide.prerequisites || [];
    expect(prerequisites.length).toBeGreaterThanOrEqual(2);
    expect(prerequisites.length).toBeLessThanOrEqual(4);
    for (const line of prerequisites) {
      expect(line).not.toContain("\n");
    }
  });

  test("keeps reference material out of the first-run steps", () => {
    for (const advanced of [
      "oneuptime.label.",
      "Label Rules",
      "process.runtime",
      "faas.instance",
      "tencent_cloud_scf",
    ]) {
      expect(steps).not.toContain(advanced);
    }
  });

  test("has Advanced topics for the variables, the attributes, labels and what you get", () => {
    expect(topicTitles(guide.advanced)).toEqual([
      "Environment variable reference",
      "Resource attributes OneUptime reads",
      "Label functions and assign owners",
      "What you get",
    ]);
  });

  test("every Advanced topic has a plain one-line summary", () => {
    for (const topic of guide.advanced || []) {
      expect(topic.summary).toBeTruthy();
      // Summaries render as plain text, so no markdown.
      expect(topic.summary).not.toMatch(/[`*_[\]#<>|]/);
      expect(topic.summary).not.toContain("\n");
    }
  });

  test("the variable reference lists exactly the variables the guide sets", () => {
    const reference: string =
      guide.advanced?.find((topic: SetupGuideTopic): boolean => {
        return topic.title === "Environment variable reference";
      })?.markdown || "";
    const variables: Array<ServerlessEnvironmentVariable> =
      getServerlessEnvironmentVariables({
        oneuptimeUrl: URL,
        apiKey: KEY,
        platform: platform,
        functionName: SERVERLESS_EXAMPLE_FUNCTION_NAME,
      });
    const rows: Array<string> = reference
      .split("\n")
      .filter((line: string): boolean => {
        return REFERENCE_ROW.test(line);
      });
    expect(rows).toHaveLength(variables.length);
    for (const variable of variables) {
      expect(reference).toContain(
        `| \`${variable.name}\` | \`${variable.value}\` |`,
      );
    }
  });

  test("the attribute table names every serverless cloud.platform ingest reads", () => {
    const attributes: string =
      guide.advanced?.find((topic: SetupGuideTopic): boolean => {
        return topic.title === "Resource attributes OneUptime reads";
      })?.markdown || "";
    expect(attributes).toContain("| `faas.name` | **yes** |");
    for (const value of Object.values(FaasCloudPlatform)) {
      expect(attributes).toContain(`\`${value}\``);
    }
    expect(attributes).toContain(
      "A function that also sets `service.name` still appears under **Services** too.",
    );
  });

  test("labels come from oneuptime.label.* and the label and owner rules", () => {
    const labels: string =
      guide.advanced?.find((topic: SetupGuideTopic): boolean => {
        return topic.title === "Label functions and assign owners";
      })?.markdown || "";
    expect(labels).toContain("`team:payments`");
    expect(labels).toContain("oneuptime.label.team=payments");
    expect(labels).toContain("**Serverless → Settings → Label Rules**");
    const labelLine: string =
      variableLinesIn(labels).find((line: string): boolean => {
        return line.startsWith("OTEL_RESOURCE_ATTRIBUTES=");
      }) || "";
    // Off Lambda, the label line still names the function.
    expect(
      labelLine.includes(`faas.name=${SERVERLESS_EXAMPLE_FUNCTION_NAME}`),
    ).toBe(!isLambda);
  });

  test("troubleshooting covers the key, a missing function, empty tabs and disconnects", () => {
    expect(topicTitles(guide.troubleshooting)).toEqual([
      "The key check returns 401",
      "The function does not appear under Serverless Functions",
      "The function is listed, but its tabs are empty",
      'The function shows as "Disconnected"',
    ]);
  });

  test("a missing function is traced back to what this platform needs", () => {
    const missing: string =
      guide.troubleshooting?.find((topic: SetupGuideTopic): boolean => {
        return (
          topic.title ===
          "The function does not appear under Serverless Functions"
        );
      })?.markdown || "";
    expect(missing.includes("AWS_LAMBDA_EXEC_WRAPPER")).toBe(isLambda);
    expect(
      missing.includes("`OTEL_RESOURCE_ATTRIBUTES` carries `faas.name`"),
    ).toBe(!isLambda);
    expect(missing).toContain("only sends telemetry while it runs");
  });

  test("links to the serverless functions docs page, which exists", () => {
    expect(guide.links).toEqual([
      {
        title: "Serverless functions documentation",
        url: SERVERLESS_DOCS_URL,
      },
    ]);
    expect(docsPageExists(SERVERLESS_DOCS_URL)).toBe(true);
  });

  test("every docs link in the guide points at a page that exists", () => {
    const links: Array<string> = Array.from(
      markdown.matchAll(/\]\((\/docs\/[^)#\s]+)/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect({ link, exists: docsPageExists(link) }).toEqual({
        link,
        exists: true,
      });
    }
  });
});

describe("the function name", () => {
  test("a product page suggests a name and says to replace it", () => {
    for (const platform of [
      "google-cloud-functions",
      "azure-functions",
      "other",
    ] as Array<ServerlessPlatform>) {
      const steps: string = stepsText(guideFor(platform));
      expect(steps).toContain(
        `Replace \`${SERVERLESS_EXAMPLE_FUNCTION_NAME}\` with your function's name`,
      );
      expect(steps).toContain("a new name registers a new function");
    }
  });

  test("a function's own tab sets faas.name to its identifier and says to keep it", () => {
    const guide: SetupGuideContent = guideFor("google-cloud-functions", {
      functionName: "invoice-mailer",
    });
    const steps: string = stepsText(guide);
    expect(variableLinesIn(steps)).toContain(
      "OTEL_RESOURCE_ATTRIBUTES=faas.name=invoice-mailer,faas.version=1.4.2,cloud.platform=gcp_cloud_functions",
    );
    expect(steps).toContain("`faas.name` is **`invoice-mailer`**");
    expect(steps).toContain("keep it as it is");
    expect(steps).not.toContain(
      `Replace \`${SERVERLESS_EXAMPLE_FUNCTION_NAME}\``,
    );
    expect(getSetupGuideMarkdown(guide)).not.toContain(
      `faas.name=${SERVERLESS_EXAMPLE_FUNCTION_NAME}`,
    );
  });

  test("Lambda leaves naming to the layer, even for a known function", () => {
    const steps: string = stepsText(
      guideFor("aws-lambda", { functionName: "invoice-mailer" }),
    );
    expect(steps).not.toContain("faas.name=");
    expect(steps).not.toContain("Replace `");
  });

  test("a name OTEL_RESOURCE_ATTRIBUTES cannot carry as written is percent-encoded", () => {
    const name: string = "billing jobs,v2=%";
    const guide: SetupGuideContent = guideFor("other", { functionName: name });
    const line: string =
      variableLinesIn(stepsText(guide)).find((candidate: string): boolean => {
        return candidate.startsWith("OTEL_RESOURCE_ATTRIBUTES=");
      }) || "";
    const pairs: Array<string> = line
      .replace("OTEL_RESOURCE_ATTRIBUTES=", "")
      .split(",");
    // Still two pairs: the comma in the name did not split it.
    expect(pairs).toHaveLength(2);
    expect(pairs[0]).toBe("faas.name=billing%20jobs%2Cv2%3D%25");
    expect(decodeURIComponent(pairs[0]!.replace("faas.name=", ""))).toBe(name);
    expect(stepsText(guide)).toContain("percent-encoded");
  });

  test("an ordinary name is not encoded and needs no note", () => {
    const steps: string = stepsText(
      guideFor("other", { functionName: "checkout_v2.handler" }),
    );
    expect(steps).toContain("faas.name=checkout_v2.handler,");
    expect(steps).not.toContain("percent-encoded");
  });

  test("a blank name counts as unknown", () => {
    const steps: string = stepsText(
      guideFor("azure-functions", { functionName: "   " }),
    );
    expect(steps).toContain(`faas.name=${SERVERLESS_EXAMPLE_FUNCTION_NAME},`);
    expect(steps).toContain(`Replace \`${SERVERLESS_EXAMPLE_FUNCTION_NAME}\``);
  });
});

describe("before a key is picked", () => {
  test.each(PLATFORM_KEYS)(
    "%s shows the placeholder and says where to pick a key",
    (platform: ServerlessPlatform) => {
      const guide: SetupGuideContent = guideFor(platform, {
        apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
      });
      const steps: string = stepsText(guide);
      expect(variableLinesIn(steps)).toContain(
        `OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=${SETUP_GUIDE_API_KEY_PLACEHOLDER}`,
      );
      expect(steps).toContain(
        `Pick an ingestion key in step 1 to fill in \`${SETUP_GUIDE_API_KEY_PLACEHOLDER}\`.`,
      );
    },
  );

  test("the note goes away once a key is picked", () => {
    for (const platform of PLATFORM_KEYS) {
      expect(getSetupGuideMarkdown(guideFor(platform))).not.toContain(
        "Pick an ingestion key in step 1",
      );
    }
  });
});

describe("the Azure CLI tab", () => {
  const cliMarkdown: (apiKey: string) => string = (apiKey: string): string => {
    const step: SetupGuideStep = settingsStep(
      guideFor("azure-functions", { apiKey: apiKey }),
    );
    return (
      step.variants?.find((variant: SetupGuideStepVariant): boolean => {
        return variant.label === "Azure CLI";
      })?.markdown || ""
    );
  };

  const command: (apiKey: string) => string = (apiKey: string): string => {
    const match: RegExpMatchArray | null = cliMarkdown(apiKey).match(
      /```bash\n([\s\S]*?)\n```/,
    );
    return match ? match[1]! : "";
  };

  test("the portal comes first, the CLI second", () => {
    const step: SetupGuideStep = settingsStep(guideFor("azure-functions"));
    expect(
      (step.variants || []).map((variant: SetupGuideStepVariant): string => {
        return variant.label;
      }),
    ).toEqual(["Azure portal", "Azure CLI"]);
  });

  test("sets every variable in one appsettings call, without touching the others", () => {
    const cli: string = command(KEY);
    expect(cli).toMatch(
      /^az functionapp config appsettings set \\\n {2}--name <function-app-name> \\\n {2}--resource-group <resource-group> \\\n {2}--settings \\\n/,
    );
    for (const variable of getServerlessEnvironmentVariables({
      oneuptimeUrl: URL,
      apiKey: KEY,
      platform: "azure-functions",
      functionName: SERVERLESS_EXAMPLE_FUNCTION_NAME,
    })) {
      expect(cli).toContain(`    ${variable.name}=${variable.value}`);
    }
    // The comma-separated attributes stay one argument.
    expect(cli).toContain(
      "    OTEL_RESOURCE_ATTRIBUTES=faas.name=checkout-handler,faas.version=1.4.2,cloud.platform=azure_functions",
    );
    expect(cliMarkdown(KEY)).toContain(
      "adds or updates only the settings you pass",
    );
  });

  test("quotes a setting the shell would otherwise mangle", () => {
    expect(command(SETUP_GUIDE_API_KEY_PLACEHOLDER)).toContain(
      `'OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=${SETUP_GUIDE_API_KEY_PLACEHOLDER}'`,
    );
    expect(command("abc$def")).toContain(
      "'OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=abc$def'",
    );
  });
});

describe("the variables", () => {
  test("Lambda turns the layer on and sets no attributes of its own", () => {
    expect(
      getServerlessEnvironmentVariables({
        oneuptimeUrl: URL,
        apiKey: KEY,
        platform: "aws-lambda",
        functionName: SERVERLESS_EXAMPLE_FUNCTION_NAME,
      }),
    ).toEqual([
      { name: "AWS_LAMBDA_EXEC_WRAPPER", value: "/opt/otel-handler" },
      { name: "OTEL_EXPORTER_OTLP_ENDPOINT", value: `${URL}/otlp` },
      { name: "OTEL_EXPORTER_OTLP_HEADERS", value: `x-oneuptime-token=${KEY}` },
      { name: "OTEL_EXPORTER_OTLP_PROTOCOL", value: "http/protobuf" },
    ]);
  });

  test("everywhere else they name the function", () => {
    expect(
      getServerlessEnvironmentVariables({
        oneuptimeUrl: URL,
        apiKey: KEY,
        platform: "other",
        functionName: SERVERLESS_EXAMPLE_FUNCTION_NAME,
      }),
    ).toEqual([
      { name: "OTEL_EXPORTER_OTLP_ENDPOINT", value: `${URL}/otlp` },
      { name: "OTEL_EXPORTER_OTLP_HEADERS", value: `x-oneuptime-token=${KEY}` },
      { name: "OTEL_EXPORTER_OTLP_PROTOCOL", value: "http/protobuf" },
      {
        name: "OTEL_RESOURCE_ATTRIBUTES",
        value: "faas.name=checkout-handler,faas.version=1.4.2",
      },
    ]);
  });
});

/*
 * The guide explains how OneUptime finds and shows a function. Each of
 * these reads the code that does it, so the explanation cannot outlive a
 * change to it.
 */
describe("what the guide says matches the product", () => {
  const read: (relativePath: string) => string = (
    relativePath: string,
  ): string => {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
  };

  test("ingest registers a function from faas.name and reads the attributes the table lists", () => {
    const ingest: string = read(
      "packages/App/FeatureSet/Telemetry/Services/OtelIngestBaseService.ts",
    );
    const start: number = ingest.indexOf(
      "protected static async autoDiscoverServerless(",
    );
    const end: number = ingest.indexOf(
      "protected static async promoteOneuptimeLabelsToServerlessFunction(",
    );
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const discovery: string = ingest.slice(start, end);
    for (const attribute of [
      "faas.name",
      "faas.version",
      "faas.instance",
      "cloud.platform",
      "cloud.provider",
      "cloud.region",
      "cloud.account.id",
      "process.runtime.name",
      "process.runtime.version",
    ]) {
      expect(discovery).toContain(`"${attribute}"`);
    }
    expect(discovery).toContain("FAAS_CLOUD_PLATFORM_VALUES");
    expect(discovery).toContain("promoteOneuptimeLabelsToServerlessFunction");
  });

  test("every tab of a function filters on resource.faas.name", () => {
    for (const page of ["Overview", "Logs", "Traces", "Metrics"]) {
      expect(
        read(
          `packages/App/FeatureSet/Dashboard/src/Pages/Serverless/View/${page}.tsx`,
        ),
      ).toContain('"resource.faas.name"');
    }
  });

  test("a function is marked disconnected after 15 minutes without telemetry", () => {
    const service: string = read(
      "packages/Common/Server/Services/ServerlessFunctionService.ts",
    );
    expect(service).toMatch(
      /markDisconnectedFunctions[\s\S]*?addRemoveMinutes\(\s*OneUptimeDate\.getCurrentDate\(\),\s*-15,/,
    );
  });

  test("label and owner rules exist and run when a function is created", () => {
    for (const page of ["LabelRules", "OwnerRules"]) {
      expect(
        fs.existsSync(
          path.join(DASHBOARD_SRC, `Pages/Serverless/Settings/${page}.tsx`),
        ),
      ).toBe(true);
    }
    const service: string = read(
      "packages/Common/Server/Services/ServerlessFunctionService.ts",
    );
    expect(service).toMatch(
      /onCreateSuccess[\s\S]*?ServerlessFunctionLabelRuleEngineService[\s\S]*?ServerlessFunctionOwnerRuleEngineService/,
    );
  });

  test("the Lambda wrapper path and layer docs match the docs page", () => {
    const docs: string = fs.readFileSync(
      path.join(DOCS_CONTENT, "telemetry/serverless-functions.md"),
      "utf8",
    );
    expect(docs).toContain(`AWS_LAMBDA_EXEC_WRAPPER=${LAMBDA_EXEC_WRAPPER}`);
    expect(docs).toContain(LAMBDA_LAYER_DOCS_URL);
  });

  test("the validate endpoint the guide checks the key with exists", () => {
    expect(
      read("packages/App/FeatureSet/Telemetry/API/OTelIngest.ts"),
    ).toContain('"/otlp/v1/validate"');
  });

  test("a Browser key is refused without an Origin header, as the troubleshooting says", () => {
    expect(
      read("packages/Common/Server/Middleware/TelemetryIngest.ts"),
    ).toContain("This request did not send an Origin header");
  });
});
