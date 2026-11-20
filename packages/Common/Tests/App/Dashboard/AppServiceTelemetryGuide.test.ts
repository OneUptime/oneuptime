import { describe, expect, test } from "@jest/globals";
import {
  APP_SERVICE_GUIDE_PLACEHOLDERS,
  APP_SERVICE_STACK_OPTIONS,
  AppServiceStack,
  OPENTELEMETRY_JAVA_AGENT_URL,
  getAppServiceStackVariants,
  getAppServiceTelemetryGuide,
  resolveAppServiceStack,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AppPlatforms/AppServiceTelemetryGuide";
import { getCloudSetupGuide } from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudSetupGuide";
import { getAppServiceGuideApp } from "../../../../App/FeatureSet/Dashboard/src/Components/AppPlatforms/AppServiceSetupTab";
import {
  SETUP_GUIDE_API_KEY_PLACEHOLDER,
  SetupGuideContent,
  SetupGuideStep,
  SetupGuideStepVariant,
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
  isWordedInDashboardLocale,
  readDashboardLocale,
  readDashboardSameAsEnglish,
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
  /*
   * The Setup tab draws each stack's name and what it is through the
   * reader's language (SetupGuideCard translates an option's label and
   * description). The names are App Service's own, products every locale
   * keeps as written (i18n/SameAsEnglish.json): so ".NET" is a Dashboard
   * label, and the Profiles docs name it as their Dashboard draws it
   * (TelemetryDocsTranslations). What each one is reads in the reader's
   * words.
   */
  test("names each stack as App Service does, and says what it is in the reader's words", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    expect(
      APP_SERVICE_STACK_OPTIONS.map((option: { label: string }): string => {
        return option.label;
      }),
    ).toEqual([".NET", "Java", "Node.js", "Python"]);

    for (const option of APP_SERVICE_STACK_OPTIONS) {
      const description: string = option.description || "";

      expect(description.length).toBeGreaterThan(0);
      expect({ label: option.label, key: english[option.label] }).toEqual({
        label: option.label,
        key: option.label,
      });
      expect({ description, key: english[description] }).toEqual({
        description,
        key: description,
      });

      for (const language of DASHBOARD_LANGUAGES) {
        const translator: Translator = dashboardTranslator(language);

        expect({
          language,
          label: translator.translateText(option.label),
          keptAsWritten: readDashboardSameAsEnglish(language).includes(
            option.label,
          ),
        }).toEqual({ language, label: option.label, keptAsWritten: true });
        expect({
          language,
          description,
          worded: isWordedInDashboardLocale(description, language),
          read: translator.translateText(description) !== description,
        }).toEqual({ language, description, worded: true, read: true });
      }
    }
  });

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

/*
 * #10408: the environment's App Service guide gave one set of settings,
 * and left "other languages" to add cloud.platform and cloud.region by hand
 * and set service.instance.id in code - never cloud.resource_id, which ties
 * the app to its site. It now gives each stack's own step as a tab, from
 * the very steps this tab draws, so the two can never drift apart.
 */
describe("the environment's App Service guide gives each stack's own step", () => {
  const STACK_LABELS: Array<string> = [".NET", "Java", "Node.js", "Python"];

  function environmentGuide(translator?: Translator): SetupGuideContent {
    return getCloudSetupGuide({
      oneuptimeUrl: URL_BASE,
      apiKey: KEY,
      platform: ManagedCloudPlatform.AzureAppService,
      translator,
    });
  }

  function stackStep(content: SetupGuideContent): SetupGuideStep {
    const step: SetupGuideStep | undefined = content.steps.find(
      (candidate: SetupGuideStep): boolean => {
        return (candidate.variants || []).length > 0;
      },
    );

    expect(step).toBeDefined();

    return step as SetupGuideStep;
  }

  test("one tab per stack, in the Setup tab's order, after the settings and before the check", () => {
    const content: SetupGuideContent = environmentGuide();

    expect(
      content.steps.map((step: SetupGuideStep): string => {
        return step.title;
      }),
    ).toEqual([
      "Store the token in Key Vault",
      "Set the application settings",
      "Instrument the app",
      "Verify the connection",
    ]);
    expect(
      (stackStep(content).variants || []).map(
        (variant: SetupGuideStepVariant): string => {
          return variant.label;
        },
      ),
    ).toEqual(STACK_LABELS);
    expect(
      APP_SERVICE_STACK_OPTIONS.map((option: { label: string }): string => {
        return option.label;
      }),
    ).toEqual(STACK_LABELS);
  });

  test("each tab is the Setup tab's own step for its stack, word for word, with placeholders for the names", () => {
    const tabs: Array<SetupGuideStepVariant> =
      stackStep(environmentGuide()).variants || [];

    for (const option of APP_SERVICE_STACK_OPTIONS) {
      const setupTab: SetupGuideContent = getAppServiceTelemetryGuide({
        oneuptimeUrl: URL_BASE,
        apiKey: KEY,
        stack: option.key,
      });
      const ownStep: SetupGuideStep = setupTab.steps[1]!;
      const tab: SetupGuideStepVariant | undefined = tabs.find(
        (candidate: SetupGuideStepVariant): boolean => {
          return candidate.label === option.label;
        },
      );

      expect({ stack: option.key, markdown: tab?.markdown }).toEqual({
        stack: option.key,
        markdown: ownStep.markdown,
      });
    }
  });

  test("each stack turns on its App Service resource detector, which names the site, and the hand-set attributes are gone", () => {
    const content: SetupGuideContent = environmentGuide();
    const tabs: Array<SetupGuideStepVariant> =
      stackStep(content).variants || [];
    const tabOf: (label: string) => string = (label: string): string => {
      return (
        tabs.find((candidate: SetupGuideStepVariant): boolean => {
          return candidate.label === label;
        })?.markdown || ""
      );
    };

    expect(tabOf(".NET")).toContain("AddAzureAppServiceDetector()");
    expect(tabOf("Java")).toContain("OTEL_RESOURCE_PROVIDERS_AZURE_ENABLED");
    expect(tabOf("Node.js")).toContain(
      "OTEL_NODE_RESOURCE_DETECTORS=env,host,os,azure",
    );
    expect(tabOf("Python")).toContain(
      "OTEL_EXPERIMENTAL_RESOURCE_DETECTORS=otel,azure_app_service",
    );

    // The detector that names the site: cloud.resource_id, said once, on .NET's.
    expect(tabOf(".NET")).toContain("`cloud.resource_id`");

    const markdown: string = getSetupGuideMarkdown(content);

    expect(markdown).not.toContain("Other languages add");
    expect(markdown).not.toContain(
      "cloud.provider=azure,cloud.platform=azure_app_service,cloud.region=<region>",
    );
  });

  test("the names the guide does not know are placeholders, single-quoted for the shell", () => {
    const commands: string = (stackStep(environmentGuide()).variants || [])
      .map((variant: SetupGuideStepVariant): string => {
        return variant.markdown;
      })
      .join("\n");

    expect(commands).toContain(
      `--resource-group '${APP_SERVICE_GUIDE_PLACEHOLDERS.resourceGroup}'`,
    );
    expect(commands).toContain(
      `--name '${APP_SERVICE_GUIDE_PLACEHOLDERS.siteName}'`,
    );
    expect(stackStep(environmentGuide()).markdown).toContain(
      "`<app-name>` and `<resource-group>`",
    );
  });

  test("the tabs are worded in the reader's language, from the same steps", () => {
    for (const language of ["de", "fa"]) {
      const translator: Translator = dashboardTranslator(language);
      const tabs: Array<SetupGuideStepVariant> =
        stackStep(environmentGuide(translator)).variants || [];

      expect(tabs).toEqual(
        getAppServiceStackVariants({
          oneuptimeUrl: URL_BASE,
          apiKey: KEY,
          translator,
        }),
      );
      // Not the English: the sentence under the .NET commands is worded.
      expect(tabs[0]!.markdown).not.toContain(
        "names each instance (`service.instance.id`) and the site",
      );
    }
  });
});
