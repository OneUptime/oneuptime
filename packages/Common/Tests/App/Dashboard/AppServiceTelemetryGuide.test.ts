import { describe, expect, test } from "@jest/globals";
import {
  APP_SERVICE_GUIDE_PLACEHOLDERS,
  APP_SERVICE_STACK_OPTIONS,
  AppServiceStack,
  OPENTELEMETRY_JAVA_AGENT_URL,
  getAppServiceTelemetryGuide,
  resolveAppServiceStack,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AppPlatforms/AppServiceTelemetryGuide";
import { getAppServiceGuideApp } from "../../../../App/FeatureSet/Dashboard/src/Components/AppPlatforms/AppServiceSetupTab";
import {
  SETUP_GUIDE_API_KEY_PLACEHOLDER,
  SetupGuideContent,
  getSetupGuideCodeBlocks,
  getSetupGuideMarkdown,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";
import { CloudAppAzureLink } from "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/Utils/CloudAppAzureLink";
import { CloudAppSubscriptionSource } from "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/Utils/CloudAppPlatformResource";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import { ManagedCloudPlatform } from "../../../Types/Cloud/CloudPlatform";
import { Translator } from "../../../Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
} from "../../Helpers/DashboardLocales";

/*
 * THE STEPS THAT SEND AN APP SERVICE APP'S TRACES AND LOGS (#10294).
 *
 * The app's Setup tab gives, for the stack it runs - .NET, Java, Node.js,
 * Python - commands to paste into Azure Cloud Shell as they are: its own
 * name, resource group and subscription filled in when its site is found,
 * a placeholder for what is not known, and nothing a pasted command could
 * read as shell syntax that was not meant.
 */

const URL_BASE: string = "https://oneuptime.example.com";
const KEY: string = "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0";
const SUBSCRIPTION: string = "d6252cc9-f01c-428b-924d-9896199f9a13";
const SITE: string = "azure-monitor-collector-northcentralus";
const GROUP: string = "rg-monitoring";

// A command block of the guide's Markdown, and a code span of a sentence.
const FENCED_BLOCK: RegExp = /```[\s\S]*?```/g;
const INLINE_CODE: RegExp = /`[^`\n]+`/g;

function guide(
  stack: AppServiceStack,
  app: Record<string, string> = {
    siteName: SITE,
    resourceGroup: GROUP,
    subscriptionId: SUBSCRIPTION,
  },
  apiKey: string = KEY,
): SetupGuideContent {
  return getAppServiceTelemetryGuide({
    oneuptimeUrl: URL_BASE,
    apiKey,
    stack,
    app,
  });
}

function code(content: SetupGuideContent): string {
  return getSetupGuideCodeBlocks(content).join("\n");
}

describe("every stack's steps", () => {
  test("the four stacks App Service runs, .NET first and for anything else", () => {
    expect(
      APP_SERVICE_STACK_OPTIONS.map((option: { key: string }): string => {
        return option.key;
      }),
    ).toEqual([
      AppServiceStack.DotNet,
      AppServiceStack.Java,
      AppServiceStack.Node,
      AppServiceStack.Python,
    ]);
    expect(resolveAppServiceStack("python")).toBe(AppServiceStack.Python);
    expect(resolveAppServiceStack("ruby")).toBe(AppServiceStack.DotNet);
    expect(resolveAppServiceStack(undefined)).toBe(AppServiceStack.DotNet);
  });

  test("each points the app at OneUptime with the key, names it as its site and adds its subscription", () => {
    for (const stack of Object.values(AppServiceStack)) {
      const commands: string = code(guide(stack));

      expect({
        stack,
        ok: commands.includes("az webapp config appsettings set"),
      }).toEqual({
        stack,
        ok: true,
      });
      expect(commands).toContain(`--resource-group ${GROUP}`);
      expect(commands).toContain(`--name ${SITE}`);
      expect(commands).toContain(
        `OTEL_EXPORTER_OTLP_ENDPOINT=${URL_BASE}/otlp`,
      );
      // A word the shell leaves alone is written bare.
      expect(commands).toContain(
        `OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=${KEY} \\`,
      );
      expect(commands).toContain(`OTEL_SERVICE_NAME=${SITE}`);
      expect(commands).toContain(
        `OTEL_RESOURCE_ATTRIBUTES=cloud.account.id=${SUBSCRIPTION}`,
      );
      for (const exporter of [
        "OTEL_TRACES_EXPORTER=otlp",
        "OTEL_METRICS_EXPORTER=otlp",
        "OTEL_LOGS_EXPORTER=otlp",
      ]) {
        expect(commands).toContain(exporter);
      }
      // Each deploy named, with the shell filling in the commit.
      expect(commands).toContain(
        `"OTEL_RESOURCE_ATTRIBUTES=cloud.account.id=${SUBSCRIPTION},service.version=$GITHUB_SHA"`,
      );
    }
  });

  test(".NET: the SDK's packages, the App Service detector and logs through ILogger", () => {
    const commands: string = code(guide(AppServiceStack.DotNet));

    expect(commands).toContain(
      "dotnet add package --prerelease OpenTelemetry.Resources.Azure",
    );
    expect(commands).toContain(
      "dotnet add package OpenTelemetry.Exporter.OpenTelemetryProtocol",
    );
    expect(commands).toContain(
      ".ConfigureResource(resource => resource.AddAzureAppServiceDetector())",
    );
    expect(commands).toContain(
      ".WithLogging(logging => logging.AddOtlpExporter())",
    );
  });

  test("Java: the agent shipped with the app, started by JAVA_OPTS, its Azure provider on", () => {
    const commands: string = code(guide(AppServiceStack.Java));

    expect(commands).toContain(OPENTELEMETRY_JAVA_AGENT_URL);
    expect(commands).toContain(
      "JAVA_OPTS=-javaagent:/home/site/wwwroot/opentelemetry-javaagent.jar",
    );
    expect(commands).toContain("OTEL_RESOURCE_PROVIDERS_AZURE_ENABLED=true");
  });

  test("Node.js: auto-instrumentation loaded before the app, with the azure detector", () => {
    const commands: string = code(guide(AppServiceStack.Node));

    expect(commands).toContain(
      "npm install --save @opentelemetry/api @opentelemetry/auto-instrumentations-node",
    );
    expect(commands).toContain(
      "'NODE_OPTIONS=--require @opentelemetry/auto-instrumentations-node/register'",
    );
    expect(commands).toContain(
      "OTEL_NODE_RESOURCE_DETECTORS=env,host,os,azure",
    );
  });

  test("Python: the distro and the Azure detector, its logging, and the app started through opentelemetry-instrument", () => {
    const commands: string = code(guide(AppServiceStack.Python));

    expect(commands).toContain("opentelemetry-resource-detector-azure");
    expect(commands).toContain(
      "OTEL_EXPERIMENTAL_RESOURCE_DETECTORS=otel,azure_app_service",
    );
    expect(commands).toContain(
      "OTEL_PYTHON_LOGGING_AUTO_INSTRUMENTATION_ENABLED=true",
    );
    expect(commands).toContain(
      "--startup-file 'opentelemetry-instrument gunicorn --bind=0.0.0.0 --timeout 600 app:app'",
    );
  });

  test("the steps, in order: the key, the settings, the stack, each deploy, what to check", () => {
    expect(
      guide(AppServiceStack.Node).steps.map((step: { title: string }) => {
        return step.title;
      }),
    ).toEqual([
      "Point the app at OneUptime",
      "Instrument the app",
      "Name each deploy",
      "Check what arrives",
    ]);
    expect(guide(AppServiceStack.Node).keyStep?.endpointValue).toBe(
      `${URL_BASE}/otlp`,
    );
  });
});

describe("what is filled in, and what is not", () => {
  test("with nothing known, each command holds a placeholder to replace", () => {
    const commands: string = code(guide(AppServiceStack.DotNet, {}));

    expect(commands).toContain(
      `--resource-group '${APP_SERVICE_GUIDE_PLACEHOLDERS.resourceGroup}'`,
    );
    expect(commands).toContain(
      `--name '${APP_SERVICE_GUIDE_PLACEHOLDERS.siteName}'`,
    );
    expect(commands).toContain(
      `cloud.account.id=${APP_SERVICE_GUIDE_PLACEHOLDERS.subscriptionId}`,
    );
  });

  test("before a key is picked, the guide says how to fill it in", () => {
    const content: SetupGuideContent = guide(
      AppServiceStack.Node,
      undefined,
      SETUP_GUIDE_API_KEY_PLACEHOLDER,
    );

    expect(getSetupGuideMarkdown(content)).toContain(
      `Pick an ingestion key in step 1 to fill in \`${SETUP_GUIDE_API_KEY_PLACEHOLDER}\`.`,
    );
    expect(getSetupGuideMarkdown(guide(AppServiceStack.Node))).not.toContain(
      "Pick an ingestion key in step 1",
    );
  });

  test("a value with shell syntax in it is never read as such: names are single-quoted, a subscription must be a GUID", () => {
    const commands: string = code(
      guide(AppServiceStack.Python, {
        siteName: "app'; rm -rf / #",
        resourceGroup: "rg $(whoami)",
        subscriptionId: `${SUBSCRIPTION}"; curl evil #`,
      }),
    );

    expect(commands).toContain(`--name 'app'\\''; rm -rf / #'`);
    expect(commands).toContain(`--resource-group 'rg $(whoami)'`);
    expect(commands).not.toContain("curl evil");
    expect(commands).toContain(
      `cloud.account.id=${APP_SERVICE_GUIDE_PLACEHOLDERS.subscriptionId}`,
    );
  });

  test("the app's values: its site's, else what its telemetry says", () => {
    const site: CloudResource = Object.assign(new CloudResource(), {
      providerResourceId: `/subscriptions/${SUBSCRIPTION}/resourceGroups/${GROUP}/providers/Microsoft.Web/sites/${SITE}`,
      cloudResourceGroup: GROUP,
    });
    const link: CloudAppAzureLink = {
      siteName: SITE,
      slot: null,
      subscription: {
        id: SUBSCRIPTION,
        source: CloudAppSubscriptionSource.Environment,
      },
      site,
      matchedBy: null,
      elsewhere: [],
      account: null,
      connection: null,
      azureConnections: null,
      connectionsChecked: false,
      sitesInSubscription: null,
    };

    expect(
      getAppServiceGuideApp({
        app: {
          name: "Collector",
          cloudPlatform: ManagedCloudPlatform.AzureAppService,
        },
        link,
      }),
    ).toEqual({
      siteName: SITE,
      resourceGroup: GROUP,
      subscriptionId: SUBSCRIPTION,
    });

    // No site found: the app's own cloud.resource_id, else its name and environment.
    expect(
      getAppServiceGuideApp({
        app: {
          name: SITE,
          cloudPlatform: ManagedCloudPlatform.AzureAppService,
          providerResourceId: `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-from-id/providers/Microsoft.Web/sites/from-id`,
        },
        link: null,
      }),
    ).toEqual({
      siteName: "from-id",
      resourceGroup: "rg-from-id",
      subscriptionId: SUBSCRIPTION,
    });
    expect(
      getAppServiceGuideApp({
        app: {
          name: SITE,
          cloudPlatform: ManagedCloudPlatform.AzureAppService,
        },
        link: { ...link, site: null },
      }),
    ).toEqual({
      siteName: SITE,
      resourceGroup: "",
      subscriptionId: SUBSCRIPTION,
    });
  });
});

describe("in every language", () => {
  test("every sentence is the reader's, and every command and code span is as typed", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const translator: Translator = dashboardTranslator(language);

      for (const stack of Object.values(AppServiceStack)) {
        const english: SetupGuideContent = guide(stack);
        const worded: SetupGuideContent = getAppServiceTelemetryGuide({
          oneuptimeUrl: URL_BASE,
          apiKey: KEY,
          stack,
          app: {
            siteName: SITE,
            resourceGroup: GROUP,
            subscriptionId: SUBSCRIPTION,
          },
          translator,
        });

        expect({ language, stack, code: code(worded) }).toEqual({
          language,
          stack,
          code: code(english),
        });
        expect({
          language,
          stack,
          intro: worded.intro === english.intro,
        }).toEqual({ language, stack, intro: false });
        expect(worded.language).toBe(language);

        /*
         * Every code span of a sentence is kept as written. The spans are
         * read once the fenced commands are gone: a fence's backticks would
         * pair a span's with the words around it.
         */
        const spans: (text: string) => Array<string> = (
          text: string,
        ): Array<string> => {
          return (
            text.replace(FENCED_BLOCK, "").match(INLINE_CODE) || []
          ).sort();
        };

        expect({
          language,
          stack,
          spans: spans(getSetupGuideMarkdown(worded)),
        }).toEqual({
          language,
          stack,
          spans: spans(getSetupGuideMarkdown(english)),
        });
        // The sentences do name code: the check above has spans to compare.
        expect(
          spans(getSetupGuideMarkdown(english)).length,
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
