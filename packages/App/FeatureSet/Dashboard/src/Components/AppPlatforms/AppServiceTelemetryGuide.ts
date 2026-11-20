import {
  SETUP_GUIDE_API_KEY_PLACEHOLDER,
  SetupGuideContent,
  SetupGuideOption,
  SetupGuideStep,
  SetupGuideStepVariant,
  codeBlock,
  shellQuote,
} from "../SetupGuide/SetupGuide";
import {
  DEFAULT_LANGUAGE,
  Translator,
  createTranslator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * SENDING AN APP SERVICE APP'S TRACES, METRICS AND LOGS (#10294), ON THE
 * APP'S OWN PAGE.
 *
 * Azure Monitor measures an App Service app whatever it sends, but its
 * traces - the requests, errors and latency its page leads with - and its
 * logs have to come from the app. The environment's guide says where the
 * OpenTelemetry settings go on App Service; this one is the app's: a stack
 * picked - .NET, Java, Node.js or Python, the stacks App Service runs - and
 * every command filled in with the app's own name, resource group and
 * subscription when its site is found, so it can be pasted into Azure
 * Cloud Shell as it is:
 *
 *   1. the app settings that point the SDK at OneUptime, name the app as
 *      its App Service app (OTEL_SERVICE_NAME, so Azure Monitor's numbers
 *      are tied to it) and add its subscription (cloud.account.id, which
 *      the SDK detectors leave out);
 *   2. the stack's instrumentation, with its App Service resource detector
 *      on - it names the instance (service.instance.id, from
 *      WEBSITE_INSTANCE_ID) and the site (cloud.resource_id) - and its
 *      logs sent too, each carrying its trace's id, so a log opens its
 *      trace;
 *   3. a version for each deploy (service.version), so each is marked;
 *   4. what to check: the Setup check, each signal turning Received.
 *
 * Every sentence is the reader's language (each a key of the locale
 * files, as CloudSetupGuide's are); commands and code are as typed.
 *
 * The environment's App Service guide (CloudSetupGuide) shows the same
 * stack steps as tabs (getAppServiceStackVariants, #10408), each name it
 * does not know yet a placeholder, so the two can never drift apart.
 */

export enum AppServiceStack {
  DotNet = "dotnet",
  Java = "java",
  Node = "node",
  Python = "python",
}

export const APP_SERVICE_STACK_OPTIONS: Array<
  SetupGuideOption<AppServiceStack>
> = [
  {
    key: AppServiceStack.DotNet,
    label: ".NET",
    description: translationKey(
      "ASP.NET Core, with the OpenTelemetry .NET SDK.",
    ),
  },
  {
    key: AppServiceStack.Java,
    label: "Java",
    description: translationKey(
      "Java SE or Tomcat, with the OpenTelemetry Java agent: no code to change.",
    ),
  },
  {
    key: AppServiceStack.Node,
    label: "Node.js",
    description: translationKey(
      "Any Node.js app, with OpenTelemetry's auto-instrumentation: no code to change.",
    ),
  },
  {
    key: AppServiceStack.Python,
    label: "Python",
    description: translationKey(
      "Django, Flask or FastAPI, with OpenTelemetry's auto-instrumentation: no code to change.",
    ),
  },
];

// What fills the commands; the placeholders stand where the page knows none.
export interface AppServiceGuideApp {
  siteName: string;
  resourceGroup: string;
  subscriptionId: string;
}

export const APP_SERVICE_GUIDE_PLACEHOLDERS: Readonly<AppServiceGuideApp> = {
  siteName: "<app-name>",
  resourceGroup: "<resource-group>",
  subscriptionId: "<subscription-id>",
};

// A subscription id as Azure writes one.
const SUBSCRIPTION_ID_PATTERN: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const OPENTELEMETRY_JAVA_AGENT_URL: string =
  "https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/latest/download/opentelemetry-javaagent.jar";

type GuideText = (
  text: string,
  values?: Record<string, string> | undefined,
) => string;

interface GuideContext {
  oneuptimeUrl: string;
  apiKey: string;
  app: AppServiceGuideApp;
  tx: GuideText;
}

const ENGLISH: Translator = createTranslator(undefined, DEFAULT_LANGUAGE);

function paragraphs(parts: Array<string>): string {
  return parts
    .filter((part: string): boolean => {
      return part.trim().length > 0;
    })
    .join("\n\n");
}

function otlpEndpoint(context: GuideContext): string {
  return `${context.oneuptimeUrl}/otlp`;
}

// One `az webapp config appsettings set` of the app, one setting a line.
function appSettingsCommand(
  context: GuideContext,
  settings: Array<[string, string]>,
): string {
  return codeBlock(
    "bash",
    [
      "az webapp config appsettings set \\",
      `  --resource-group ${shellQuote(context.app.resourceGroup)} \\`,
      `  --name ${shellQuote(context.app.siteName)} \\`,
      "  --settings \\",
      ...settings.map(
        ([key, value]: [string, string], index: number): string => {
          const isLast: boolean = index === settings.length - 1;

          return `    ${shellQuote(`${key}=${value}`)}${isLast ? "" : " \\"}`;
        },
      ),
    ].join("\n"),
  );
}

// Step 1 after the key: the settings every stack shares.
function exporterStep(context: GuideContext): SetupGuideStep {
  const tx: GuideText = context.tx;

  return {
    title: "Point the app at OneUptime",
    description:
      "Run this in Azure Cloud Shell: it sets the app settings every stack reads, and App Service restarts the app with them.",
    markdown: paragraphs([
      appSettingsCommand(context, [
        ["OTEL_EXPORTER_OTLP_ENDPOINT", otlpEndpoint(context)],
        ["OTEL_EXPORTER_OTLP_PROTOCOL", "http/protobuf"],
        ["OTEL_EXPORTER_OTLP_HEADERS", `x-oneuptime-token=${context.apiKey}`],
        ["OTEL_SERVICE_NAME", context.app.siteName],
        [
          "OTEL_RESOURCE_ATTRIBUTES",
          `cloud.account.id=${context.app.subscriptionId}`,
        ],
        ["OTEL_TRACES_EXPORTER", "otlp"],
        ["OTEL_METRICS_EXPORTER", "otlp"],
        ["OTEL_LOGS_EXPORTER", "otlp"],
      ]),
      tx(
        "`OTEL_SERVICE_NAME` names the app as its App Service app, and `cloud.account.id` adds its subscription, which the SDK detectors leave out: together they tie its telemetry to the Azure Monitor numbers of its site.",
      ),
      context.apiKey === SETUP_GUIDE_API_KEY_PLACEHOLDER
        ? tx("Pick an ingestion key in step 1 to fill in `{{placeholder}}`.", {
            placeholder: SETUP_GUIDE_API_KEY_PLACEHOLDER,
          })
        : "",
      tx(
        "To keep the token out of the app's configuration, store `x-oneuptime-token=...` in Key Vault and set `OTEL_EXPORTER_OTLP_HEADERS` to a Key Vault reference instead, as the environment's setup guide shows.",
      ),
    ]),
  };
}

function dotNetStep(context: GuideContext): SetupGuideStep {
  const tx: GuideText = context.tx;

  return {
    title: "Instrument the app",
    description:
      "Add the OpenTelemetry packages, then send traces, metrics and logs from Program.cs.",
    markdown: paragraphs([
      codeBlock(
        "bash",
        [
          "dotnet add package OpenTelemetry.Extensions.Hosting",
          "dotnet add package OpenTelemetry.Instrumentation.AspNetCore",
          "dotnet add package OpenTelemetry.Instrumentation.Http",
          "dotnet add package OpenTelemetry.Exporter.OpenTelemetryProtocol",
          "dotnet add package --prerelease OpenTelemetry.Resources.Azure",
        ].join("\n"),
      ),
      codeBlock(
        "csharp",
        [
          "using OpenTelemetry.Logs;",
          "using OpenTelemetry.Metrics;",
          "using OpenTelemetry.Resources;",
          "using OpenTelemetry.Trace;",
          "",
          "builder.Services.AddOpenTelemetry()",
          "    .ConfigureResource(resource => resource.AddAzureAppServiceDetector())",
          "    .WithTracing(tracing => tracing",
          "        .AddAspNetCoreInstrumentation()",
          "        .AddHttpClientInstrumentation()",
          "        .AddOtlpExporter())",
          "    .WithMetrics(metrics => metrics",
          "        .AddAspNetCoreInstrumentation()",
          "        .AddHttpClientInstrumentation()",
          "        .AddOtlpExporter())",
          "    .WithLogging(logging => logging.AddOtlpExporter());",
        ].join("\n"),
      ),
      tx(
        "`AddAzureAppServiceDetector()` names each instance (`service.instance.id`) and the site (`cloud.resource_id`). Each log written through `ILogger` inside a request carries that request's trace, so it opens its trace.",
      ),
    ]),
  };
}

function javaStep(context: GuideContext): SetupGuideStep {
  const tx: GuideText = context.tx;

  return {
    title: "Instrument the app",
    description:
      "Ship the OpenTelemetry Java agent with the app, and start the JVM with it.",
    markdown: paragraphs([
      tx(
        "Download the agent in the app's build, so it is deployed to `/home/site/wwwroot` with the app:",
      ),
      codeBlock(
        "bash",
        `curl -sSL -o opentelemetry-javaagent.jar ${OPENTELEMETRY_JAVA_AGENT_URL}`,
      ),
      appSettingsCommand(context, [
        [
          "JAVA_OPTS",
          "-javaagent:/home/site/wwwroot/opentelemetry-javaagent.jar",
        ],
        ["OTEL_RESOURCE_PROVIDERS_AZURE_ENABLED", "true"],
      ]),
      tx(
        "On Tomcat, set `CATALINA_OPTS` to the same `-javaagent` option instead of `JAVA_OPTS`. `OTEL_RESOURCE_PROVIDERS_AZURE_ENABLED` turns on the agent's Azure resource provider, which names each instance and the site. The agent sends the logs of Logback and Log4j, each with its trace.",
      ),
    ]),
  };
}

function nodeStep(context: GuideContext): SetupGuideStep {
  const tx: GuideText = context.tx;

  return {
    title: "Instrument the app",
    description:
      "Add OpenTelemetry's auto-instrumentation, and load it before the app starts.",
    markdown: paragraphs([
      codeBlock(
        "bash",
        "npm install --save @opentelemetry/api @opentelemetry/auto-instrumentations-node",
      ),
      appSettingsCommand(context, [
        [
          "NODE_OPTIONS",
          "--require @opentelemetry/auto-instrumentations-node/register",
        ],
        ["OTEL_NODE_RESOURCE_DETECTORS", "env,host,os,azure"],
      ]),
      tx(
        "The `azure` resource detector names each instance and the site. The logs of Winston, Pino and Bunyan are sent too, each with its trace.",
      ),
    ]),
  };
}

function pythonStep(context: GuideContext): SetupGuideStep {
  const tx: GuideText = context.tx;

  return {
    title: "Instrument the app",
    description:
      "Add OpenTelemetry's auto-instrumentation to the app's requirements, and start the app through it.",
    markdown: paragraphs([
      tx(
        "Add these to `requirements.txt`, with the instrumentation packages `opentelemetry-bootstrap -a requirements` prints for the app:",
      ),
      codeBlock(
        "text",
        [
          "opentelemetry-distro",
          "opentelemetry-exporter-otlp",
          "opentelemetry-resource-detector-azure",
        ].join("\n"),
      ),
      appSettingsCommand(context, [
        ["OTEL_EXPERIMENTAL_RESOURCE_DETECTORS", "otel,azure_app_service"],
        ["OTEL_PYTHON_LOGGING_AUTO_INSTRUMENTATION_ENABLED", "true"],
      ]),
      tx("Then start the app through `opentelemetry-instrument`:"),
      codeBlock(
        "bash",
        [
          "az webapp config set \\",
          `  --resource-group ${shellQuote(context.app.resourceGroup)} \\`,
          `  --name ${shellQuote(context.app.siteName)} \\`,
          `  --startup-file ${shellQuote("opentelemetry-instrument gunicorn --bind=0.0.0.0 --timeout 600 app:app")}`,
        ].join("\n"),
      ),
      tx(
        "Replace `app:app` with the app's own module, as its startup command names it. The `azure_app_service` detector names each instance and the site, and the `logging` module's records are sent too, each with its trace.",
      ),
    ]),
  };
}

const STACK_STEPS: Record<
  AppServiceStack,
  (context: GuideContext) => SetupGuideStep
> = {
  [AppServiceStack.DotNet]: dotNetStep,
  [AppServiceStack.Java]: javaStep,
  [AppServiceStack.Node]: nodeStep,
  [AppServiceStack.Python]: pythonStep,
};

// Each deploy named: service.version, set by the deploy itself.
function versionStep(context: GuideContext): SetupGuideStep {
  const tx: GuideText = context.tx;

  return {
    title: "Name each deploy",
    description:
      "Set service.version as you deploy, and each deploy is marked on the app's charts and listed under Revisions.",
    markdown: paragraphs([
      tx(
        "In the deploy job, before the app is deployed - here with the commit GitHub Actions deploys:",
      ),
      // Double quotes: the shell fills in $GITHUB_SHA.
      codeBlock(
        "bash",
        [
          "az webapp config appsettings set \\",
          `  --resource-group ${shellQuote(context.app.resourceGroup)} \\`,
          `  --name ${shellQuote(context.app.siteName)} \\`,
          `  --settings "OTEL_RESOURCE_ATTRIBUTES=cloud.account.id=${context.app.subscriptionId},service.version=$GITHUB_SHA"`,
        ].join("\n"),
      ),
      tx(
        "Any value that changes with each deploy will do: a commit, a build number, a release.",
      ),
    ]),
  };
}

function verifyStep(context: GuideContext): SetupGuideStep {
  const tx: GuideText = context.tx;

  return {
    title: "Check what arrives",
    description:
      "Send the app a request, then open its Overview: its Setup check marks each signal as it arrives.",
    markdown: paragraphs([
      tx(
        "Traces, OpenTelemetry metrics and logs turn Received within a minute of the app's first request. Its instances and its revision follow from the same telemetry.",
      ),
      tx(
        "For the App Service app's own console, HTTP and platform logs as well, stream them: in Cloud > Connect, choose Stream metrics and logs in its subscription's row. They show on the app's Logs tab, under From Azure diagnostic settings.",
      ),
    ]),
  };
}

export interface AppServiceTelemetryGuideOptions {
  oneuptimeUrl: string;
  apiKey: string;
  stack: AppServiceStack;
  // The app's own values; a placeholder for each it does not know.
  app?: Partial<AppServiceGuideApp> | undefined;
  // The reader's: every sentence is worded by it. English without one.
  translator?: Translator | undefined;
}

// The stack a picker's value names, else .NET's.
export function resolveAppServiceStack(
  value: string | null | undefined,
): AppServiceStack {
  return (Object.values(AppServiceStack) as Array<string>).includes(value || "")
    ? (value as AppServiceStack)
    : AppServiceStack.DotNet;
}

// What every step is filled in with, and worded by.
function getGuideContext(data: {
  oneuptimeUrl: string;
  apiKey: string;
  app?: Partial<AppServiceGuideApp> | undefined;
  translator: Translator;
}): GuideContext {
  const filled: (key: keyof AppServiceGuideApp) => string = (
    key: keyof AppServiceGuideApp,
  ): string => {
    const value: string = (data.app?.[key] || "").trim();

    /*
     * The subscription goes inside double quotes (the deploy step's), where
     * the shell reads $ and quotes: only a GUID, as Azure writes one, is
     * filled in. The name and group are single-quoted (shellQuote).
     */
    if (key === "subscriptionId" && !SUBSCRIPTION_ID_PATTERN.test(value)) {
      return APP_SERVICE_GUIDE_PLACEHOLDERS[key];
    }

    return value || APP_SERVICE_GUIDE_PLACEHOLDERS[key];
  };

  return {
    oneuptimeUrl: data.oneuptimeUrl,
    apiKey: data.apiKey,
    app: {
      siteName: filled("siteName"),
      resourceGroup: filled("resourceGroup"),
      subscriptionId: filled("subscriptionId"),
    },
    tx: (text: string, values?: Record<string, string> | undefined): string => {
      return values
        ? data.translator.translateTemplate(text, values)
        : data.translator.translateText(text) || text;
    },
  };
}

/*
 * Each stack's own step - its packages, its App Service resource detector
 * and its logs - as one tab each, in the stack picker's order (#10408): the
 * environment's App Service guide shows them, with a placeholder for each
 * name it does not know yet, from the very steps an app's Setup tab draws.
 */
export function getAppServiceStackVariants(options: {
  oneuptimeUrl: string;
  apiKey: string;
  app?: Partial<AppServiceGuideApp> | undefined;
  translator?: Translator | undefined;
}): Array<SetupGuideStepVariant> {
  const context: GuideContext = getGuideContext({
    oneuptimeUrl: options.oneuptimeUrl,
    apiKey: options.apiKey,
    app: options.app,
    translator: options.translator || ENGLISH,
  });

  return APP_SERVICE_STACK_OPTIONS.map(
    (option: SetupGuideOption<AppServiceStack>): SetupGuideStepVariant => {
      return {
        label: option.label,
        markdown: STACK_STEPS[option.key](context).markdown || "",
      };
    },
  );
}

export function getAppServiceTelemetryGuide(
  options: AppServiceTelemetryGuideOptions,
): SetupGuideContent {
  const translator: Translator = options.translator || ENGLISH;
  const context: GuideContext = getGuideContext({
    oneuptimeUrl: options.oneuptimeUrl,
    apiKey: options.apiKey,
    app: options.app,
    translator,
  });

  return {
    language: translator.language,
    keyStep: {
      description: context.tx(
        "Pick a Server key, or create one — the commands below update to use it.",
      ),
      endpointLabel: translationKey("OTLP Endpoint"),
      endpointValue: otlpEndpoint(context),
    },
    intro: context.tx(
      "Azure Monitor measures the app whatever it sends. Its traces - the requests, errors and latency its page leads with - and its logs come from the app itself: these steps send them, for its stack.",
    ),
    steps: [
      exporterStep(context),
      STACK_STEPS[options.stack](context),
      versionStep(context),
      verifyStep(context),
    ],
  };
}
