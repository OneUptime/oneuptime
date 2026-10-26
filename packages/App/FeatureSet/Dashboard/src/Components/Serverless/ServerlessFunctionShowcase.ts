import IconProp from "Common/Types/Icon/IconProp";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceShowcase,
  ShowcaseStatus,
} from "../ResourceShowcase/ResourceShowcase";

// What Serverless > All Functions shows while the project has no function.
const SERVERLESS_FUNCTION_SHOWCASE: ResourceShowcase = {
  icon: IconProp.Bolt,
  eyebrow: translationKey("Serverless monitoring"),
  title: translationKey("See how every function performs, call by call"),
  description: translationKey(
    "Instrument AWS Lambda, Google Cloud Functions or Azure Functions with OpenTelemetry. Each function shows up on its own, with its invocations, errors, latency, traces and logs.",
  ),
  highlights: [
    translationKey("Found on its first call"),
    translationKey("Lambda without code changes"),
    translationKey("Traces and logs included"),
  ],
  features: [
    {
      icon: IconProp.MagnifyingGlass,
      title: translationKey("Found, not configured"),
      description: translationKey(
        "Each function registers itself from its telemetry, with its platform, region, runtime and version.",
      ),
    },
    {
      icon: IconProp.ChartBar,
      title: translationKey("Invocations, errors, latency"),
      description: translationKey(
        "Invocations, error rate and p95 duration for every function, over time.",
      ),
    },
    {
      icon: IconProp.Squares,
      title: translationKey("Warm instances"),
      description: translationKey(
        "The execution environments serving a function right now, and when each one went away.",
      ),
    },
    {
      icon: IconProp.Waterfall,
      title: translationKey("Every call, traced"),
      description: translationKey(
        "Open the trace of any invocation to see where its time went.",
      ),
    },
    {
      icon: IconProp.Logs,
      title: translationKey("Logs in context"),
      description: translationKey(
        "A function's logs, already filtered to it, next to its traces.",
      ),
    },
    {
      icon: IconProp.Graph,
      title: translationKey("Every metric it sends"),
      description: translationKey(
        "Chart any metric a function reports, without building a dashboard first.",
      ),
    },
  ],
  preview: {
    name: "checkout-handler",
    subtitle: translationKey("aws_lambda · us-east-1 · nodejs 20"),
    stats: [
      { label: translationKey("Invocations"), value: "42.2k" },
      { label: translationKey("Error rate"), value: "0.4%" },
      { label: translationKey("p95 duration"), value: "208 ms" },
      { label: translationKey("Instances"), value: "6" },
    ],
    chart: {
      label: translationKey("Invocations"),
      values: [
        12, 18, 15, 26, 34, 29, 41, 37, 48, 44, 52, 47, 58, 53, 49, 61, 56, 64,
        59, 55, 62, 58,
      ],
    },
    rows: [
      {
        name: "POST /checkout",
        detail: translationKey("Invocation · 182 ms"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("OK"),
      },
      {
        name: "POST /payment-intent",
        detail: translationKey("Invocation · 3.9 s"),
        status: ShowcaseStatus.Critical,
        statusText: translationKey("Error"),
      },
      {
        name: "GET /cart",
        detail: translationKey("Invocation · 41 ms"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("OK"),
      },
      {
        name: "POST /checkout/confirm",
        detail: translationKey("Invocation · 96 ms"),
        status: ShowcaseStatus.Healthy,
        statusText: translationKey("OK"),
      },
    ],
  },
};

export default SERVERLESS_FUNCTION_SHOWCASE;
