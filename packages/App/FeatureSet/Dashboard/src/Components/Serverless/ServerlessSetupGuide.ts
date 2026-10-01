import {
  FaasCloudPlatform,
  normalizeCloudPlatform,
} from "Common/Types/Cloud/CloudPlatform";
import {
  SETUP_GUIDE_API_KEY_PLACEHOLDER,
  SetupGuideContent,
  SetupGuideOption,
  SetupGuideStep,
  SetupGuideTopic,
  codeBlock,
  resolveSetupGuideOption,
  shellQuote,
} from "../SetupGuide/SetupGuide";

/*
 * The "send telemetry from your serverless functions" guide. Where the
 * functions run decides where the exporter settings go — the Lambda layer
 * and console, the Google Cloud console, a function app's settings, or
 * plain environment variables — and then how to check the function reports.
 *
 * OneUptime lists a function under Serverless Functions when its telemetry
 * carries faas.name, or a serverless cloud.platform with service.name as the
 * name (OtelIngestBaseService.resolveServerlessFunctionIdentity), and every
 * tab of a function filters on resource.faas.name — which ingest writes from
 * service.name onto a function named that way
 * (stampServerlessFunctionNameAttribute). So the guide names the function
 * with faas.name, except:
 *
 *   - on Lambda, where the OpenTelemetry layer sets faas.name;
 *   - on Azure Functions, where it sets OTEL_SERVICE_NAME to the function
 *     app's name and leaves faas.name out. The Functions host and Azure's
 *     resource detectors describe the app by its service.name and never set
 *     faas.name, and app settings reach every function in the app, so a
 *     faas.name there would name them all — and ingest never replaces a
 *     faas.name it is given. The docs page's Azure Functions section says
 *     the same.
 *
 * The settings are NAME=value lines to type into a console rather than CLI
 * one-liners: `gcloud --set-env-vars` splits OTEL_RESOURCE_ATTRIBUTES on its
 * commas, and `aws lambda update-function-configuration --environment`
 * replaces every variable the function already has. The Azure CLI's
 * `appsettings set` does neither, so Azure also gets a CLI tab.
 */

export type ServerlessPlatform =
  | "aws-lambda"
  | "google-cloud-functions"
  | "azure-functions"
  | "other";

export const SERVERLESS_PLATFORMS: Array<SetupGuideOption<ServerlessPlatform>> =
  [
    {
      key: "aws-lambda",
      label: "AWS Lambda",
      description:
        "Add the OpenTelemetry Lambda layer and point it at OneUptime.",
    },
    {
      key: "google-cloud-functions",
      label: "Google Cloud Functions",
      description:
        "Cloud Run functions and 1st gen functions, set up in the Google Cloud console.",
    },
    {
      key: "azure-functions",
      label: "Azure Functions",
      description:
        "Function apps, configured through app settings in the portal or the Azure CLI.",
    },
    {
      key: "other",
      label: "Other runtimes",
      description:
        "Cloudflare Workers or any other runtime that can export OpenTelemetry.",
    },
  ];

export const DEFAULT_SERVERLESS_PLATFORM: ServerlessPlatform = "aws-lambda";

// Suggested when the guide is not set up for a known function.
export const SERVERLESS_EXAMPLE_FUNCTION_NAME: string = "checkout-handler";
export const SERVERLESS_EXAMPLE_FUNCTION_VERSION: string = "1.4.2";

// The wrapper script the OpenTelemetry Lambda layers install.
export const LAMBDA_EXEC_WRAPPER: string = "/opt/otel-handler";
export const LAMBDA_LAYER_DOCS_URL: string =
  "https://opentelemetry.io/docs/faas/lambda-auto/";

export const SERVERLESS_DOCS_URL: string =
  "/docs/telemetry/serverless-functions";

/*
 * The semantic-convention cloud.platform of each platform, from the shared
 * registry ingest reads (FAAS_CLOUD_PLATFORM_VALUES), so the guide can only
 * ever set a value that registers a serverless function.
 */
const PLATFORM_CLOUD_PLATFORM: Readonly<
  Record<ServerlessPlatform, string | undefined>
> = {
  "aws-lambda": FaasCloudPlatform.AwsLambda,
  "google-cloud-functions": FaasCloudPlatform.GcpCloudFunctions,
  "azure-functions": FaasCloudPlatform.AzureFunctions,
  other: undefined,
};

export function resolveServerlessPlatform(
  platform: string | null | undefined,
): ServerlessPlatform {
  return (
    resolveSetupGuideOption(SERVERLESS_PLATFORMS, platform) ||
    DEFAULT_SERVERLESS_PLATFORM
  );
}

export function getServerlessCloudPlatform(
  platform: ServerlessPlatform,
): string | undefined {
  return PLATFORM_CLOUD_PLATFORM[platform];
}

/*
 * The option a function's Documentation tab opens on, from the
 * cloud.platform its telemetry reported: that platform's option, "other"
 * for any platform the guide has no option of its own for, and undefined
 * (the default option) while none has been reported.
 */
export function getServerlessPlatformForCloudPlatform(
  cloudPlatform: string | null | undefined,
): ServerlessPlatform | undefined {
  const normalized: string | null = normalizeCloudPlatform(cloudPlatform);

  if (!normalized) {
    return undefined;
  }

  const match: SetupGuideOption<ServerlessPlatform> | undefined =
    SERVERLESS_PLATFORMS.find(
      (option: SetupGuideOption<ServerlessPlatform>): boolean => {
        return PLATFORM_CLOUD_PLATFORM[option.key] === normalized;
      },
    );

  return match ? match.key : "other";
}

/*
 * OTEL_RESOURCE_ATTRIBUTES is a comma-separated list of key=value pairs whose
 * values are percent-decoded, so a name with a comma, an equals sign, a space
 * or a percent sign only arrives as written when it is percent-encoded.
 * Ordinary function names pass through unchanged.
 */
function resourceAttributeValue(value: string): string {
  return encodeURIComponent(value);
}

export interface ServerlessEnvironmentVariable {
  name: string;
  value: string;
}

export interface ServerlessSetupGuideOptions {
  oneuptimeUrl: string;
  apiKey: string;
  platform: ServerlessPlatform;
  /*
   * The function being set up (its Documentation tab). Omitted on the
   * product pages, where the guide suggests a name instead.
   */
  functionName?: string | undefined;
}

interface ServerlessGuideData {
  oneuptimeUrl: string;
  apiKey: string;
  platform: ServerlessPlatform;
  functionName: string;
  isFunctionNameKnown: boolean;
}

/*
 * Whether the guide names the function by service.name (OTEL_SERVICE_NAME)
 * rather than faas.name: on Azure Functions, for the reasons at the top.
 */
function isNamedByServiceName(platform: ServerlessPlatform): boolean {
  return platform === "azure-functions";
}

export function getServerlessResourceAttributes(data: {
  platform: ServerlessPlatform;
  functionName: string;
}): string {
  const attributes: Array<string> = [];

  if (isNamedByServiceName(data.platform)) {
    /*
     * OTEL_SERVICE_NAME names the function instead. The provider fills in
     * the overview for a worker without an Azure resource detector — these
     * are the settings the docs' Azure Functions section gives it.
     */
    attributes.push("cloud.provider=azure");
  } else {
    attributes.push(
      `faas.name=${resourceAttributeValue(data.functionName)}`,
      `faas.version=${SERVERLESS_EXAMPLE_FUNCTION_VERSION}`,
    );
  }

  const cloudPlatform: string | undefined = getServerlessCloudPlatform(
    data.platform,
  );

  if (cloudPlatform) {
    attributes.push(`cloud.platform=${cloudPlatform}`);
  }

  return attributes.join(",");
}

/*
 * The variables a function needs, in the order the guide lists them. On
 * Lambda the layer sets the function's resource attributes itself, and
 * AWS_LAMBDA_EXEC_WRAPPER is what starts the layer. On Azure Functions
 * OTEL_SERVICE_NAME names the function app, and with it the function, for
 * every process of the app. It is a plain string, not percent-decoded like
 * OTEL_RESOURCE_ATTRIBUTES, so the name goes in as written.
 */
export function getServerlessEnvironmentVariables(data: {
  oneuptimeUrl: string;
  apiKey: string;
  platform: ServerlessPlatform;
  functionName: string;
}): Array<ServerlessEnvironmentVariable> {
  const variables: Array<ServerlessEnvironmentVariable> = [];

  if (data.platform === "aws-lambda") {
    variables.push({
      name: "AWS_LAMBDA_EXEC_WRAPPER",
      value: LAMBDA_EXEC_WRAPPER,
    });
  }

  variables.push(
    {
      name: "OTEL_EXPORTER_OTLP_ENDPOINT",
      value: `${data.oneuptimeUrl}/otlp`,
    },
    {
      name: "OTEL_EXPORTER_OTLP_HEADERS",
      value: `x-oneuptime-token=${data.apiKey}`,
    },
    {
      name: "OTEL_EXPORTER_OTLP_PROTOCOL",
      value: "http/protobuf",
    },
  );

  if (data.platform !== "aws-lambda") {
    if (isNamedByServiceName(data.platform)) {
      variables.push({
        name: "OTEL_SERVICE_NAME",
        value: data.functionName,
      });
    }

    variables.push({
      name: "OTEL_RESOURCE_ATTRIBUTES",
      value: getServerlessResourceAttributes({
        platform: data.platform,
        functionName: data.functionName,
      }),
    });
  }

  return variables;
}

function variablesBlock(data: ServerlessGuideData): string {
  return codeBlock(
    "bash",
    getServerlessEnvironmentVariables(data)
      .map((variable: ServerlessEnvironmentVariable): string => {
        return `${variable.name}=${variable.value}`;
      })
      .join("\n"),
  );
}

function azureCliCommand(data: ServerlessGuideData): string {
  return [
    "az functionapp config appsettings set",
    "  --name <function-app-name>",
    "  --resource-group <resource-group>",
    "  --settings",
    ...getServerlessEnvironmentVariables(data).map(
      (variable: ServerlessEnvironmentVariable): string => {
        return `    ${shellQuote(`${variable.name}=${variable.value}`)}`;
      },
    ),
  ].join(" \\\n");
}

function tokenCheckCommand(data: ServerlessGuideData): string {
  return `curl -i ${data.oneuptimeUrl}/otlp/v1/validate \\
  -H "x-oneuptime-token: ${data.apiKey}"`;
}

const NAME_BEFORE_EQUALS: string = "the name is the part before the first `=`";

const SECRET_NOTE: string = `> **This token is a secret.** Use a **Server** ingestion key here and set it as a function environment variable. A key that reaches a browser can be read by anyone who views the page source; for anything running in a browser, create a **Browser** ingestion key instead.`;

/*
 * Azure Functions: the function app's service.name names the function, and
 * OTEL_SERVICE_NAME sets it for every process of the app.
 */
function getServiceNameNote(data: ServerlessGuideData): string {
  const leaveOutFaasName: string =
    "Leave `faas.name` out of `OTEL_RESOURCE_ATTRIBUTES`: OneUptime writes this name onto the telemetry as `faas.name` itself, while a `faas.name` in the app settings would reach every function in the app, and one that is sent is never replaced.";

  if (data.isFunctionNameKnown) {
    return `\`OTEL_SERVICE_NAME\` is **\`${data.functionName}\`**, this function's identifier — keep it as it is, or the data registers as a new function. ${leaveOutFaasName}`;
  }

  return `Replace \`${SERVERLESS_EXAMPLE_FUNCTION_NAME}\` with your function app's name — the \`service.name\` the Functions host and Azure's resource detectors report on their own — so every process of the app reports as the one function. The name is how the function appears in OneUptime, so keep it stable: a new name registers a new function. ${leaveOutFaasName}`;
}

function getFunctionNameNote(data: ServerlessGuideData): string {
  if (isNamedByServiceName(data.platform)) {
    return getServiceNameNote(data);
  }

  if (data.isFunctionNameKnown) {
    const encoding: string =
      resourceAttributeValue(data.functionName) === data.functionName
        ? ""
        : " It is percent-encoded in `OTEL_RESOURCE_ATTRIBUTES`, and the SDK decodes it.";

    return `\`faas.name\` is **\`${data.functionName}\`**, this function's identifier — keep it as it is, or the data registers as a new function.${encoding} \`faas.version\` is optional: set it to your release, or leave it out.`;
  }

  return `Replace \`${SERVERLESS_EXAMPLE_FUNCTION_NAME}\` with your function's name, and \`${SERVERLESS_EXAMPLE_FUNCTION_VERSION}\` with its version (or leave \`faas.version\` out). The name is how the function appears in OneUptime, so keep it stable: a new name registers a new function.`;
}

function getVariableNotes(data: ServerlessGuideData): Array<string> {
  const notes: Array<string> = [];

  if (data.platform !== "aws-lambda") {
    notes.push(getFunctionNameNote(data));
  }

  notes.push(SECRET_NOTE);

  if (data.apiKey === SETUP_GUIDE_API_KEY_PLACEHOLDER) {
    notes.push(
      `Pick an ingestion key in step 1 to fill in \`${SETUP_GUIDE_API_KEY_PLACEHOLDER}\`.`,
    );
  }

  return notes;
}

function getPrerequisites(platform: ServerlessPlatform): Array<string> {
  const sdk: string =
    "The OpenTelemetry SDK (or auto-instrumentation) for your function's language, loaded by its code";

  switch (platform) {
    case "aws-lambda":
      return [
        "An AWS Lambda function you can edit in the AWS console",
        `A runtime the OpenTelemetry Lambda layer supports — see the [layer documentation](${LAMBDA_LAYER_DOCS_URL})`,
      ];
    case "google-cloud-functions":
      return [
        "A Cloud Run function or a 1st gen Cloud Function you can edit in the Google Cloud console",
        sdk,
      ];
    case "azure-functions":
      return [
        "A function app you can edit in the Azure portal — or the Azure CLI (`az`), signed in to its subscription",
        sdk,
      ];
    default:
      return [
        sdk,
        "A way to set environment variables on the function, or its SDK's exporter options in code",
      ];
  }
}

function getLambdaLayerStep(): SetupGuideStep {
  return {
    title: "Add the OpenTelemetry Lambda layer",
    description:
      "Attach the layer for your function's runtime — it instruments the function and names it for you.",
    markdown: `In the Lambda console, open the function, scroll to **Layers** on its **Code** tab and choose **Add a layer**. Pick **Specify an ARN** and paste the layer for your function's runtime and region from the [OpenTelemetry Lambda documentation](${LAMBDA_LAYER_DOCS_URL}).

The layer sets \`faas.name\` from the function's name, and its resource detector fills in \`cloud.platform=${FaasCloudPlatform.AwsLambda}\` and \`cloud.region\`, so there is nothing to name by hand.`,
  };
}

function getLambdaVariablesStep(data: ServerlessGuideData): SetupGuideStep {
  return {
    title: "Set the environment variables",
    description: "Turn the layer on and point its exporter at OneUptime.",
    markdown: `Open **Configuration → Environment variables → Edit** and add one variable per line below — ${NAME_BEFORE_EQUALS} — then **Save**:

${variablesBlock(data)}

${getVariableNotes(data).join("\n\n")}`,
  };
}

function getGoogleVariablesStep(data: ServerlessGuideData): SetupGuideStep {
  return {
    title: "Set the environment variables",
    description:
      "Add the exporter settings to the function's runtime environment variables, then deploy.",
    markdown: `In the Google Cloud console, edit the function's environment variables:

- **Cloud Run functions:** **Cloud Run** → the function → **Edit & deploy new revision** → **Variables & Secrets**.
- **1st gen functions:** open the function → **Edit** → **Runtime, build, connections and security settings** → **Runtime environment variables**.

Add one variable per line below — ${NAME_BEFORE_EQUALS} — then **Deploy**. Most language auto-instrumentations read these variables:

${variablesBlock(data)}

${getVariableNotes(data).join("\n\n")}`,
  };
}

function getAzureSettingsStep(data: ServerlessGuideData): SetupGuideStep {
  const notes: string = getVariableNotes(data).join("\n\n");

  return {
    title: "Set the application settings",
    description:
      "Add the exporter settings to the function app — in the Azure portal or with the Azure CLI.",
    variants: [
      {
        label: "Azure portal",
        markdown: `Open the function app → **Settings → Environment variables** (**Configuration → Application settings** on older portals). **+ Add** one setting per line below — ${NAME_BEFORE_EQUALS} — then **Apply → Confirm**; the function app restarts with them:

${variablesBlock(data)}

${notes}`,
      },
      {
        label: "Azure CLI",
        markdown: `\`az functionapp config appsettings set\` adds or updates only the settings you pass; the app's other settings stay as they are:

${codeBlock("bash", azureCliCommand(data))}

${notes}`,
      },
    ],
  };
}

function getOtherVariablesStep(data: ServerlessGuideData): SetupGuideStep {
  return {
    title: "Set the environment variables",
    description:
      "Give the function's OpenTelemetry SDK the exporter settings, then redeploy it.",
    markdown: `Set one environment variable per line below on the function — ${NAME_BEFORE_EQUALS} — and redeploy it. Most language auto-instrumentations read these variables:

${variablesBlock(data)}

If your runtime's SDK is configured in code rather than through environment variables, pass the same endpoint, \`x-oneuptime-token\` header and resource attributes to its OTLP exporter and resource.

${getVariableNotes(data).join("\n\n")}`,
  };
}

function getVerifyStep(data: ServerlessGuideData): SetupGuideStep {
  const invoke: string =
    data.platform === "aws-lambda"
      ? "Then invoke the function — from its **Test** tab in the Lambda console, or with real traffic."
      : "Then invoke the function.";

  return {
    title: "Invoke the function and verify",
    description:
      "Check the key, then invoke the function and look for it under Serverless Functions.",
    markdown: `${codeBlock("bash", tokenCheckCommand(data))}

\`200\` with \`"valid": true\` means OneUptime accepts the key; \`401\` means it is unknown, revoked, disabled or expired.

${invoke} Once the function emits a span, log or metric it appears under **Serverless Functions**. The overview shows invocations, error rate and p95 duration derived from your traces.`,
  };
}

function getSteps(data: ServerlessGuideData): Array<SetupGuideStep> {
  switch (data.platform) {
    case "aws-lambda":
      return [
        getLambdaLayerStep(),
        getLambdaVariablesStep(data),
        getVerifyStep(data),
      ];
    case "google-cloud-functions":
      return [getGoogleVariablesStep(data), getVerifyStep(data)];
    case "azure-functions":
      return [getAzureSettingsStep(data), getVerifyStep(data)];
    default:
      return [getOtherVariablesStep(data), getVerifyStep(data)];
  }
}

function getEnvironmentVariablesTopic(
  data: ServerlessGuideData,
): SetupGuideTopic {
  const purposes: Record<string, string> = {
    AWS_LAMBDA_EXEC_WRAPPER:
      "Starts the OpenTelemetry layer's instrumentation with the function.",
    OTEL_EXPORTER_OTLP_ENDPOINT:
      "Where the exporter sends telemetry. The SDK adds `/v1/traces`, `/v1/metrics` and `/v1/logs` to it.",
    OTEL_EXPORTER_OTLP_HEADERS: "Sends your ingestion key with every export.",
    OTEL_EXPORTER_OTLP_PROTOCOL:
      "OTLP over HTTP, which is what the `/otlp` endpoint accepts.",
    OTEL_SERVICE_NAME:
      "Names the function app, and with it the function, for every process of the app. OneUptime writes it onto the telemetry as `faas.name`.",
    OTEL_RESOURCE_ATTRIBUTES: isNamedByServiceName(data.platform)
      ? "The function's cloud provider and platform — see **Resource attributes OneUptime reads**."
      : "The function's name, version and platform — see **Resource attributes OneUptime reads**.",
  };

  const rows: Array<string> = getServerlessEnvironmentVariables(data).map(
    (variable: ServerlessEnvironmentVariable): string => {
      return `| \`${variable.name}\` | \`${variable.value}\` | ${purposes[variable.name] || ""} |`;
    },
  );

  const lambdaNote: string =
    data.platform === "aws-lambda"
      ? "\n\n`OTEL_RESOURCE_ATTRIBUTES` is optional here: the layer sets the function's own attributes. Add it for labels (see **Label functions and assign owners**)."
      : "";

  return {
    title: "Environment variable reference",
    summary: "What each variable does, and the value this guide sets.",
    markdown: `| Variable | Value | What it does |
|---|---|---|
${rows.join("\n")}${lambdaNote}`,
  };
}

function getPlatformAttributeNote(data: ServerlessGuideData): string {
  const cloudPlatform: string | undefined = getServerlessCloudPlatform(
    data.platform,
  );

  switch (data.platform) {
    case "aws-lambda":
      return `The OpenTelemetry layer sets \`faas.name\`, \`cloud.platform=${cloudPlatform}\` and \`cloud.region\` for you. Instrumenting the function in code instead of with the layer? Set \`faas.name\` and \`cloud.platform=${cloudPlatform}\` in \`OTEL_RESOURCE_ATTRIBUTES\` yourself.`;
    case "google-cloud-functions":
      return `This guide sets \`cloud.platform=${cloudPlatform}\`.`;
    case "azure-functions":
      return `This guide sets \`cloud.platform=${cloudPlatform}\`; the Node.js and .NET Azure resource detectors spell it \`azure.functions\`, which OneUptime reads as the same value. It leaves \`faas.name\` unset, as the Functions host and Azure's resource detectors do: app settings apply to the whole function app, so the app is one function, named after its \`service.name\` — see [Azure Functions](${SERVERLESS_DOCS_URL}#azure-functions).`;
    default:
      return "`cloud.platform` is optional here: set it only if your platform is one of the values above.";
  }
}

function getResourceAttributesTopic(
  data: ServerlessGuideData,
): SetupGuideTopic {
  const faasPlatforms: string = Object.values(FaasCloudPlatform)
    .map((value: string): string => {
      return `\`${value}\``;
    })
    .join(", ");

  return {
    title: "Resource attributes OneUptime reads",
    summary:
      "faas.name, or service.name on a serverless platform, names the function; the other attributes fill in its overview.",
    markdown: `OneUptime keys each function on the \`faas.name\` resource attribute. Without one, a serverless \`cloud.platform\` and the \`service.name\` name the function instead, and OneUptime writes that name onto the telemetry as \`faas.name\`:

| Attribute | Required | Purpose |
|---|---|---|
| \`faas.name\` | **yes**, unless the next two are set | Function identity (e.g. \`${SERVERLESS_EXAMPLE_FUNCTION_NAME}\`). Every tab of the function filters on it. |
| \`cloud.platform\` | with \`service.name\`, when there is no \`faas.name\` | ${faasPlatforms} |
| \`service.name\` | on a serverless \`cloud.platform\` without \`faas.name\` | Function identity, written onto the telemetry as \`faas.name\` |
| \`faas.version\` | no | Shown on the overview |
| \`faas.instance\` | no | Tracked per instance under the **Instances** tab |
| \`cloud.provider\` / \`cloud.region\` / \`cloud.account.id\` | no | Shown on the overview |
| \`process.runtime.name\` / \`process.runtime.version\` | no | Shown as the runtime on the overview |

${getPlatformAttributeNote(data)}

A \`faas.name\` that is sent is never replaced. A function that also sets \`service.name\` still appears under **Services** too. The **Serverless Functions** view is the FaaS-focused lens, scoped by \`faas.name\`.`,
  };
}

function getLabelsTopic(data: ServerlessGuideData): SetupGuideTopic {
  const labels: string =
    "oneuptime.label.team=payments,oneuptime.label.env=production";
  const attributes: string =
    data.platform === "aws-lambda"
      ? labels
      : `${getServerlessResourceAttributes(data)},${labels}`;

  return {
    title: "Label functions and assign owners",
    summary:
      "Tag functions from their telemetry, or with label and owner rules.",
    markdown: `Any resource attribute prefixed \`oneuptime.label.\` becomes a project label on the function — \`oneuptime.label.team=payments\` adds the label \`team:payments\`:

${codeBlock("bash", `OTEL_RESOURCE_ATTRIBUTES=${attributes}`)}

To label functions or assign owners by name instead, use **Serverless → Settings → Label Rules** and **Owner Rules**. Rules run when a function is created, including by auto-discovery; they do not relabel functions that already exist.`,
  };
}

function getWhatYouGetTopic(): SetupGuideTopic {
  return {
    title: "What you get",
    summary:
      "Invocations, error rate and p95 duration, live instances, and logs, traces and metrics per function.",
    markdown: `Once the function emits a span, log or metric it appears under **Serverless Functions**. Its overview shows:

- **Invocations**, **error rate** and **p95 duration** — derived from your traces, over a selectable time range, with trend charts.
- **Instances** — a live list of the \`faas.instance\` values the function reports.
- Full **Logs**, **Traces** and **Metrics** tabs scoped to this function.

A function that has sent nothing for 15 minutes shows as **Disconnected** until it runs again.`,
  };
}

function getAdvancedTopics(data: ServerlessGuideData): Array<SetupGuideTopic> {
  return [
    getEnvironmentVariablesTopic(data),
    getResourceAttributesTopic(data),
    getLabelsTopic(data),
    getWhatYouGetTopic(),
  ];
}

function getApplyChangesPhrase(platform: ServerlessPlatform): string {
  switch (platform) {
    case "aws-lambda":
      return "save the variables";
    case "google-cloud-functions":
      return "deploy the function again";
    case "azure-functions":
      return "apply the settings";
    default:
      return "redeploy the function";
  }
}

function getNotShowingUpTopic(data: ServerlessGuideData): SetupGuideTopic {
  const checks: Array<string> = [
    "The function has been invoked since you set the variables — it only sends telemetry while it runs.",
  ];

  if (data.platform === "aws-lambda") {
    checks.push(
      `The layer is attached for the function's runtime, and \`AWS_LAMBDA_EXEC_WRAPPER\` is \`${LAMBDA_EXEC_WRAPPER}\` — without the wrapper the layer's instrumentation never starts.`,
    );
  } else {
    checks.push(
      "The function's code loads the OpenTelemetry SDK or auto-instrumentation — the variables alone send nothing.",
      isNamedByServiceName(data.platform)
        ? `\`OTEL_RESOURCE_ATTRIBUTES\` carries \`cloud.platform=${getServerlessCloudPlatform(data.platform)}\`. Without a serverless \`cloud.platform\`, or a \`faas.name\`, the telemetry is filed under **Services** instead of as a function.`
        : "`OTEL_RESOURCE_ATTRIBUTES` carries `faas.name`. Without it, and without a serverless `cloud.platform`, the telemetry is filed under **Services** instead of as a function.",
    );
  }

  checks.push(
    "The function can reach your OneUptime URL — one on a private network needs an outbound route to it, such as a NAT gateway.",
  );

  return {
    title: "The function does not appear under Serverless Functions",
    markdown: `Check, in order:

${checks
  .map((check: string, index: number): string => {
    return `${index + 1}. ${check}`;
  })
  .join("\n")}`,
  };
}

function getEmptyTabsTopic(data: ServerlessGuideData): SetupGuideTopic {
  const fix: string =
    data.platform === "aws-lambda"
      ? "The layer reports the Lambda function's name, so a function created here by hand needs that name as its identifier."
      : "A function named by a serverless `cloud.platform` and its `service.name` needs no `faas.name` of its own: OneUptime writes the `service.name` onto the telemetry as `faas.name` as it arrives. Telemetry stored before OneUptime began filling in `faas.name` is not updated and stays out of the tabs — invoke the function to send new telemetry.";

  return {
    title: "The function is listed, but its tabs are empty",
    markdown: `The function's overview, **Logs**, **Traces** and **Metrics** show telemetry whose \`faas.name\` equals its **Function Identifier** exactly, including case. ${fix}

Also check the time range at the top of the page.`,
  };
}

function getTroubleshootingTopics(
  data: ServerlessGuideData,
): Array<SetupGuideTopic> {
  return [
    {
      title: "The key check returns 401",
      markdown: `The key is unknown, revoked, disabled or expired. Pick a live key — or create one — in step 1, put it in \`OTEL_EXPORTER_OTLP_HEADERS\`, and ${getApplyChangesPhrase(data.platform)}.

A \`200\` whose message says it is a **Browser** key will not work either: a Browser key is refused on every request without an \`Origin\` header, which a function does not send. Use a **Server** key.`,
    },
    getNotShowingUpTopic(data),
    getEmptyTabsTopic(data),
    {
      title: 'The function shows as "Disconnected"',
      markdown:
        "A function shows as **Disconnected** after 15 minutes without telemetry, and it only sends telemetry while it runs — an idle function is legitimately disconnected. Invoke it and it reconnects with its next batch. If it is being invoked, work through **The function does not appear under Serverless Functions** above.",
    },
  ];
}

/**
 * The serverless setup guide for one platform, filled in with the reader's
 * OneUptime URL and ingestion key.
 */
export function getServerlessSetupGuide(
  options: ServerlessSetupGuideOptions,
): SetupGuideContent {
  const knownFunctionName: string = (options.functionName || "").trim();

  const data: ServerlessGuideData = {
    oneuptimeUrl: options.oneuptimeUrl,
    apiKey: options.apiKey,
    platform: options.platform,
    functionName: knownFunctionName || SERVERLESS_EXAMPLE_FUNCTION_NAME,
    isFunctionNameKnown: Boolean(knownFunctionName),
  };

  return {
    keyStep: {
      description:
        "Your function sends its telemetry to OneUptime with this key. Pick an existing key or create a new one — the settings below update to use it.",
      endpointLabel: "OTLP Endpoint",
      endpointValue: `${options.oneuptimeUrl}/otlp`,
      endpointHint:
        "OTEL_EXPORTER_OTLP_ENDPOINT takes this address; the SDK adds /v1/traces, /v1/metrics and /v1/logs to it.",
    },
    prerequisites: getPrerequisites(data.platform),
    steps: getSteps(data),
    advanced: getAdvancedTopics(data),
    troubleshooting: getTroubleshootingTopics(data),
    links: [
      {
        title: "Serverless functions documentation",
        url: SERVERLESS_DOCS_URL,
      },
    ],
  };
}
