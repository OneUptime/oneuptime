import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import TelemetryIngestionKey from "Common/Models/DatabaseModels/TelemetryIngestionKey";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { APP_API_URL, HOST, HTTP_PROTOCOL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import IconProp from "Common/Types/Icon/IconProp";
import ProviderLogo from "Common/Types/ProviderLogo/ProviderLogo";
import Icon from "Common/UI/Components/Icon/Icon";
import ProviderLogoImage from "Common/UI/Components/ProviderLogo/ProviderLogoImage";
import ProviderLogoOrIcon from "Common/UI/Components/ProviderLogo/ProviderLogoOrIcon";
import Protocol from "Common/Types/API/Protocol";
import URL from "Common/Types/API/URL";
import Route from "Common/Types/API/Route";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";
import OneUptimeDate from "Common/Types/Date";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import AppLink from "../AppLink/AppLink";
import IngestionKeySelector from "./IngestionKeySelector";
import ResourceConnectionWatch from "../ResourceOnboarding/ResourceConnectionWatch";
import Service from "Common/Models/DatabaseModels/Service";
import FrameworkGuideLinks from "./FrameworkGuideLinks";
import { TelemetryGuideLanguageKey } from "Common/Types/Telemetry/OpenTelemetryGuides";
import { SetupGuideStepVariants } from "../SetupGuide/SetupGuideSteps";
import SetupGuideTopics from "../SetupGuide/SetupGuideTopics";
import { getKubernetesAgentUpgradeCommand } from "../../Pages/Kubernetes/Utils/DocumentationMarkdown";
import {
  COMPATIBLE_INGEST_CONFIGURE_TITLE,
  COMPATIBLE_INGEST_DESCRIPTION,
  COMPATIBLE_INGEST_HEADING,
  COMPATIBLE_INGEST_NOTES_DESCRIPTION,
  COMPATIBLE_INGEST_NOTES_TITLE,
  CompatibleIngestEndpoint,
  CompatibleIngestGuideCopy,
  CompatibleIngestMethod,
  CompatibleIngestSnippet,
  SENTRY_RUNTIME_CAPTION,
  SENTRY_RUNTIME_LABELS,
  SentryRuntime,
  getCompatibleIngestEndpointValue,
  getCompatibleIngestGuide,
  getCompatibleIngestGuides,
  getCompatibleIngestSnippets,
  isCompatibleIngestMethod,
} from "./CompatibleIngestGuide";
import {
  getFluentBitConfig,
  getFluentBitDockerCompose,
  getFluentdConfig,
  getFluentdDockerCompose,
} from "./LogShipperSnippets";
import {
  getEnvVarSnippet,
  getOtelConfigSnippet,
  getOtelInstallSnippet,
  replacePlaceholders,
} from "./OtelSdkSnippets";

/*
 * The Kubernetes agent's own eBPF profiler (kubernetes-agent values
 * profiling.enabled): every container on every Linux node, in any
 * language, through the agent the cluster already runs.
 */
export const KUBERNETES_AGENT_PROFILING_COMMAND: string =
  getKubernetesAgentUpgradeCommand(["--set profiling.enabled=true"]);

export type TelemetryType =
  | "logs"
  | "metrics"
  | "traces"
  | "exceptions"
  | "profiles";

/*
 * THE SETUP GUIDE TAB'S LAST STEP (issue #6806): the wait the first-run
 * dialog has (TelemetryFirstRunShowcase), so a Setup Guide tab notices the
 * first data too, and links to it on the service that sent it - or, for
 * data that names no service (FluentBit's logs), the picked key's first
 * data and the product's explorer (#7754). Profiles listen for their first
 * profile in the guide itself, so they have none.
 */
export const SETUP_GUIDE_FIRST_DATA_TITLE: string = translationKey(
  "Wait for the first data",
);

export const SETUP_GUIDE_FIRST_DATA_VIEWS: Record<
  Exclude<TelemetryType, "profiles">,
  { page: PageMap; text: string; dataPage: PageMap }
> = {
  logs: {
    page: PageMap.SERVICE_VIEW_LOGS,
    text: translationKey("View logs"),
    dataPage: PageMap.LOGS,
  },
  metrics: {
    page: PageMap.SERVICE_VIEW_METRICS,
    text: translationKey("View metrics"),
    dataPage: PageMap.METRICS,
  },
  traces: {
    page: PageMap.SERVICE_VIEW_TRACES,
    text: translationKey("View traces"),
    dataPage: PageMap.TRACES,
  },
  exceptions: {
    page: PageMap.SERVICE_VIEW_EXCEPTIONS,
    text: translationKey("View exceptions"),
    dataPage: PageMap.EXCEPTIONS,
  },
};

export interface ComponentProps {
  telemetryType?: TelemetryType | undefined;
  onClose?: (() => void) | undefined;
  /*
   * The service the snippets are for (a service Create Service just
   * saved): its service.name in place of the examples' my-service.
   */
  serviceName?: string | undefined;
  // Only the guide, in a dialog that has its own title.
  isBare?: boolean | undefined;
  /*
   * The key the snippets carry, as it is picked: a dialog that draws its
   * own last step (TelemetrySetupModal) watches it for the first data.
   */
  onSelectedKeyChange?:
    | ((key: TelemetryIngestionKey | null) => void)
    | undefined;
}

/*
 * What a key created from each guide is called until the reader renames
 * it: the product the guide belongs to.
 */
const NEW_KEY_NAME_FOR_TYPE: Record<TelemetryType, string> = {
  logs: translationKey("Logs key"),
  metrics: translationKey("Metrics key"),
  traces: translationKey("Traces key"),
  exceptions: translationKey("Exceptions key"),
  profiles: translationKey("Profiles key"),
};

/*
 * The languages a reader can pick. Common's catalog of the website's
 * OpenTelemetry guides names them too, to open each language's guides
 * (FrameworkGuideLinks), so the two lists are one type.
 */
type Language = TelemetryGuideLanguageKey;

interface LanguageOption {
  key: Language;
  label: string;
  shortLabel: string;
  // The language's or framework's official logo, beside its name on its button.
  logo: ProviderLogo;
}

export const TELEMETRY_LANGUAGES: Array<LanguageOption> = [
  {
    key: "node",
    label: "Node.js / TypeScript",
    shortLabel: "Node.js",
    logo: ProviderLogo.NodeJs,
  },
  {
    key: "python",
    label: "Python",
    shortLabel: "Python",
    logo: ProviderLogo.Python,
  },
  { key: "go", label: "Go", shortLabel: "Go", logo: ProviderLogo.Go },
  { key: "java", label: "Java", shortLabel: "Java", logo: ProviderLogo.Java },
  {
    key: "dotnet",
    label: ".NET / C#",
    shortLabel: ".NET",
    logo: ProviderLogo.DotNet,
  },
  { key: "rust", label: "Rust", shortLabel: "Rust", logo: ProviderLogo.Rust },
  { key: "php", label: "PHP", shortLabel: "PHP", logo: ProviderLogo.Php },
  { key: "ruby", label: "Ruby", shortLabel: "Ruby", logo: ProviderLogo.Ruby },
  {
    key: "elixir",
    label: "Elixir",
    shortLabel: "Elixir",
    logo: ProviderLogo.Elixir,
  },
  {
    key: "cpp",
    label: "C++",
    shortLabel: "C++",
    logo: ProviderLogo.CPlusPlus,
  },
  {
    key: "swift",
    label: "Swift",
    shortLabel: "Swift",
    logo: ProviderLogo.Swift,
  },
  {
    key: "react",
    label: "React (Browser)",
    shortLabel: "React",
    logo: ProviderLogo.React,
  },
  {
    key: "angular",
    label: "Angular (Browser)",
    shortLabel: "Angular",
    logo: ProviderLogo.Angular,
  },
];

const languages: Array<LanguageOption> = TELEMETRY_LANGUAGES;

type IntegrationMethod =
  | "opentelemetry"
  | "fluentbit"
  | "fluentd"
  | "alloy"
  | "kubernetes";

/*
 * A way the guide can show: one of its own, or the way another tool's
 * agent or SDK sends here unchanged (CompatibleIngestGuide).
 */
type SetupMethod = IntegrationMethod | CompatibleIngestMethod;

interface IntegrationOption {
  key: IntegrationMethod;
  label: string;
  description: string;
  /*
   * The official logo of the project the method uses (OpenTelemetry, Fluent
   * Bit, Grafana Alloy). None for the profiling language SDKs, which are
   * several: they show their icon in the logo's place instead, so the titles
   * of a row of methods start on one line.
   */
  logo?: ProviderLogo | undefined;
  icon?: IconProp | undefined;
}

/*
 * A service name the snippets can carry: letters, marks and digits of any
 * script, spaces, and . _ : / @ + , ( ) & -, as names like "User
 * Authentication API" or "team/orders.v2" have. Every quote in the snippets
 * takes such a name as it is. Anything else - a quote, a backslash, a $ -
 * keeps the examples, for the reader to replace.
 */
const SERVICE_NAME_IN_SNIPPETS: RegExp = /^[\p{L}\p{M}\p{N} ._:/@+,()&-]+$/u;

/*
 * Where a shell reads the name bare (-Dotel.service.name=my-service,
 * export PYROSCOPE_APPLICATION_NAME=my-service), one with anything else in
 * it - a space, a bracket, a non-ASCII letter - goes in double quotes.
 */
const BARE_SHELL_WORD: RegExp = /^[A-Za-z0-9._:/@+,-]+$/;

// The names the snippets give the service until it is known.
const EXAMPLE_SERVICE_NAMES: Array<string> = [
  "my-service",
  "my-react-app",
  "my-angular-app",
];

const EXAMPLE_SERVICE_NAME: RegExp = new RegExp(
  EXAMPLE_SERVICE_NAMES.join("|"),
  "g",
);

// Whether withServiceName writes this name into the snippets.
export function canCarryServiceName(serviceName: string | undefined): boolean {
  return SERVICE_NAME_IN_SNIPPETS.test((serviceName || "").trim());
}

/**
 * A snippet with the service's own name in place of the examples', when
 * the guide knows it and the snippets can carry it: as it is inside the
 * snippets' quotes, and in quotes where a shell reads it bare. In one pass,
 * so a name with an example in it ("my-react-app-web") is not replaced again.
 */
export function withServiceName(
  code: string,
  serviceName: string | undefined,
): string {
  const name: string = (serviceName || "").trim();

  if (!canCarryServiceName(name)) {
    return code;
  }

  return code.replace(
    EXAMPLE_SERVICE_NAME,
    (_example: string, offset: number): string => {
      const before: string = code.charAt(offset - 1);
      const isQuoted: boolean = before === '"' || before === "'";

      return isQuoted || BARE_SHELL_WORD.test(name) ? name : `"${name}"`;
    },
  );
}

function getOneuptimeServiceLabelsSnippet(): string {
  return `# Pattern: any resource attribute prefixed "oneuptime.label." is promoted to a project label
#   oneuptime.label.<dimension>=<value>  →  becomes a project label named "<dimension>:<value>"
# The label is attached to this telemetry service automatically (and to the host, if the
# same collector emits host metrics). Manual labels added via the OneUptime UI are never
# removed by ingest. Existing labels are matched case-insensitively, so "production"
# reuses an existing "Production" label rather than spawning a duplicate.

# Universal — set via the standard OpenTelemetry resource-attribute env var:
export OTEL_RESOURCE_ATTRIBUTES="oneuptime.label.team=payments,oneuptime.label.env=production,oneuptime.label.region=us-east-1"

# Or pass the same attributes inline on your SDK's Resource:
#   Node.js:  new Resource({ "oneuptime.label.team": "payments", "oneuptime.label.env": "production" })
#   Python:   Resource.create({"oneuptime.label.team": "payments", "oneuptime.label.env": "production"})
#   Go:       resource.NewWithAttributes(semconv.SchemaURL,
#                 attribute.String("oneuptime.label.team", "payments"),
#                 attribute.String("oneuptime.label.env", "production"))
#   Java:     -Dotel.resource.attributes=oneuptime.label.team=payments,oneuptime.label.env=production`;
}

// --- Profile-specific snippets ---

const profileLanguages: Array<Language> = [
  "node",
  "python",
  "go",
  "java",
  "dotnet",
  "ruby",
  "rust",
];

function getProfileInstallSnippet(lang: Language): {
  code: string;
  language: string;
} {
  switch (lang) {
    case "node":
      return {
        code: `npm install @pyroscope/nodejs`,
        language: "bash",
      };
    case "python":
      return {
        code: `pip install pyroscope-io`,
        language: "bash",
      };
    case "go":
      return {
        code: `go get github.com/grafana/pyroscope-go`,
        language: "bash",
      };
    case "java":
      return {
        code: `# The Pyroscope Java agent uploads profiles in JFR format, which
# OneUptime does not ingest yet (pprof and folded text only).
# Profile Java services with the "Grafana Alloy (eBPF)" method above
# instead — it captures JVM CPU profiles with no agent and no code changes.`,
        language: "bash",
      };
    case "dotnet":
      return {
        code: `dotnet add package Pyroscope

# Download the native profiler library:
curl -s -L https://github.com/grafana/pyroscope-dotnet/releases/download/pyroscope-1.5.1/pyroscope.1.5.1-glibc-x86_64.tar.gz | tar xvz -C .`,
        language: "bash",
      };
    case "ruby":
      return {
        code: `bundle add pyroscope`,
        language: "bash",
      };
    case "rust":
      return {
        code: `cargo add pyroscope pyroscope_pprofrs`,
        language: "bash",
      };
    default:
      return {
        code: `# Profiling SDK not available for this language.\n# Use Grafana Alloy (eBPF) for zero-code profiling instead.`,
        language: "bash",
      };
  }
}

function getProfileConfigSnippet(lang: Language): {
  code: string;
  language: string;
} {
  switch (lang) {
    case "node":
      return {
        code: `const Pyroscope = require('@pyroscope/nodejs');

Pyroscope.init({
  serverAddress: '<YOUR_ONEUPTIME_PYROSCOPE_URL>',
  appName: 'my-service',
  tags: {
    region: process.env.REGION || 'default',
  },
  authToken: '<YOUR_ONEUPTIME_TOKEN>',
});

Pyroscope.start();`,
        language: "javascript",
      };
    case "python":
      return {
        code: `import pyroscope

pyroscope.configure(
    application_name="my-service",
    server_address="<YOUR_ONEUPTIME_PYROSCOPE_URL>",
    sample_rate=100,
    tags={
        "region": "us-east-1",
    },
    auth_token="<YOUR_ONEUPTIME_TOKEN>",
)`,
        language: "python",
      };
    case "go":
      return {
        code: `package main

import (
    "os"
    "runtime"

    "github.com/grafana/pyroscope-go"
)

func main() {
    // Enable mutex and block profiling
    runtime.SetMutexProfileFraction(5)
    runtime.SetBlockProfileRate(5)

    pyroscope.Start(pyroscope.Config{
        ApplicationName: "my-service",
        ServerAddress:   "<YOUR_ONEUPTIME_PYROSCOPE_URL>",
        AuthToken:       os.Getenv("ONEUPTIME_TOKEN"),
        Tags:            map[string]string{"hostname": os.Getenv("HOSTNAME")},
        ProfileTypes: []pyroscope.ProfileType{
            pyroscope.ProfileCPU,
            pyroscope.ProfileAllocObjects,
            pyroscope.ProfileAllocSpace,
            pyroscope.ProfileInuseObjects,
            pyroscope.ProfileInuseSpace,
            pyroscope.ProfileGoroutines,
            pyroscope.ProfileMutexCount,
            pyroscope.ProfileMutexDuration,
            pyroscope.ProfileBlockCount,
            pyroscope.ProfileBlockDuration,
        },
    })

    // Your application code here
}`,
        language: "go",
      };
    case "java":
      return {
        code: `# No SDK configuration for Java — the Pyroscope Java agent's JFR
# upload format is not supported yet. Switch to the "Grafana Alloy
# (eBPF)" integration method above to profile Java services.`,
        language: "bash",
      };
    case "dotnet":
      return {
        code: `# Set environment variables before running your .NET application
# (run from the directory the profiler was extracted into):
export PYROSCOPE_APPLICATION_NAME=my-service
export PYROSCOPE_SERVER_ADDRESS=<YOUR_ONEUPTIME_PYROSCOPE_URL>
# Both must be set, or the profiler sends no credentials:
export PYROSCOPE_BASIC_AUTH_USER=oneuptime
export PYROSCOPE_BASIC_AUTH_PASSWORD=<YOUR_ONEUPTIME_TOKEN>
# pyroscope-dotnet 1.4 and earlier take the token as
# PYROSCOPE_AUTH_TOKEN=<YOUR_ONEUPTIME_TOKEN> instead.
export PYROSCOPE_PROFILING_ENABLED=1
export CORECLR_ENABLE_PROFILING=1
export CORECLR_PROFILER={BD1A650D-AC5D-4896-B64F-D6FA25D6B26A}
export CORECLR_PROFILER_PATH=$PWD/Pyroscope.Profiler.Native.so
export LD_PRELOAD=$PWD/Pyroscope.Linux.ApiWrapper.x64.so
export LD_LIBRARY_PATH=$PWD

# Then run your application:
dotnet run`,
        language: "bash",
      };
    case "ruby":
      return {
        code: `# config/initializers/pyroscope.rb
require 'pyroscope'

Pyroscope.configure do |config|
  config.application_name = "my-service"
  config.server_address   = "<YOUR_ONEUPTIME_PYROSCOPE_URL>"
  config.auth_token       = "<YOUR_ONEUPTIME_TOKEN>"
  config.tags = {
    "hostname" => ENV["HOSTNAME"],
    "region"   => ENV.fetch("REGION", "default"),
  }
end`,
        language: "ruby",
      };
    case "rust":
      return {
        code: `use pyroscope::PyroscopeAgent;
use pyroscope_pprofrs::{pprof_backend, PprofConfig};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let pprof_config = PprofConfig::new().sample_rate(100);
    let backend_impl = pprof_backend(pprof_config);

    let agent = PyroscopeAgent::builder(
            "<YOUR_ONEUPTIME_PYROSCOPE_URL>", "my-service"
        )
        .backend(backend_impl)
        .auth_token("<YOUR_ONEUPTIME_TOKEN>".to_string())
        .tags([("hostname", "localhost")].to_vec())
        .build()?;

    let agent_running = agent.start()?;

    // Your application code here

    let agent_ready = agent_running.stop()?;
    agent_ready.shutdown();

    Ok(())
}`,
        language: "rust",
      };
    default:
      return {
        code: `# Profiling SDK not available for this language.\n# Use Grafana Alloy (eBPF) for zero-code profiling instead.`,
        language: "bash",
      };
  }
}

function getAlloyEbpfSnippet(): string {
  return `# alloy-config.alloy
# Grafana Alloy eBPF-based profiling — no code changes required.
# Supports: Go, Rust, C/C++, Java, Python, Ruby, PHP, Node.js, .NET

discovery.process "all" {
  refresh_interval = "60s"
}

discovery.relabel "alloy_profiles" {
  targets = discovery.process.all.targets

  rule {
    action       = "replace"
    source_labels = ["__meta_process_exe"]
    target_label  = "service_name"
  }
}

pyroscope.ebpf "default" {
  targets    = discovery.relabel.alloy_profiles.output
  forward_to = [pyroscope.write.oneuptime.receiver]

  collect_interval = "15s"
  sample_rate      = 97
}

pyroscope.write "oneuptime" {
  endpoint {
    url = "<YOUR_ONEUPTIME_PYROSCOPE_URL>"
    headers = {
      "x-oneuptime-token" = "<YOUR_ONEUPTIME_TOKEN>",
    }
  }
}`;
}

function getAlloyDockerSnippet(): string {
  return `# docker-compose.yml
services:
  alloy:
    image: grafana/alloy:latest
    privileged: true
    pid: host
    volumes:
      - ./alloy-config.alloy:/etc/alloy/config.alloy
      - /proc:/proc:ro
      - /sys:/sys:ro
    command:
      - run
      - /etc/alloy/config.alloy`;
}

// --- Main Component ---

const TelemetryDocumentation: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  /*
   * A step's title and description, the ways to send and the guide's own
   * heading are English keys (translationKey), drawn in the reader's
   * language here.
   */
  const translate: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };
  /*
   * The captions above the language buttons and the ways to send: each
   * names its buttons as a group, so a screen reader announces "Select
   * Language" as it reaches the first one.
   */
  const languagePickerCaptionId: string = useId();
  const methodPickerCaptionId: string = useId();
  const [selectedLanguage, setSelectedLanguage] = useState<Language>("node");
  const [selectedMethod, setSelectedMethod] = useState<SetupMethod>(
    props.telemetryType === "profiles" ? "alloy" : "opentelemetry",
  );
  const compatiblePickerCaptionId: string = useId();
  const sentryRuntimeCaptionId: string = useId();
  // Where the app a Sentry SDK runs in is: a browser app gets a Browser key.
  const [sentryRuntime, setSentryRuntime] = useState<SentryRuntime>(
    SentryRuntime.Server,
  );

  /*
   * The key every snippet on this page is rendered with. Owned here
   * rather than inside IngestionKeySelector because the token is
   * interpolated into the code samples; the selector only reports which
   * key the user picked.
   */
  const [selectedKey, setSelectedKey] = useState<TelemetryIngestionKey | null>(
    null,
  );

  /*
   * Live ingest verification (profiles guide only). The guide polls the
   * service-activity endpoint so the user gets confirmation on this page
   * the moment their first profile lands, instead of having to navigate
   * away and hunt for data. `isProfileDataConfirmed` is a one-way latch:
   * once data has been seen, polling stops and the success state never
   * flickers back even if a later window happens to be empty.
   */
  const [isProfileDataConfirmed, setIsProfileDataConfirmed] =
    useState<boolean>(false);
  const [profileSourceCount, setProfileSourceCount] = useState<number>(0);
  const [hasProfileVerifyError, setHasProfileVerifyError] =
    useState<boolean>(false);

  const telemetryType: TelemetryType = props.telemetryType || "logs";

  const showLogCollectors: boolean = telemetryType === "logs";
  const isProfiles: boolean = telemetryType === "profiles";

  /*
   * The two languages whose snippet is compiled into a bundle and served to
   * end users. Everything else on this page runs on infrastructure the
   * customer controls, where a Server key is the right answer.
   *
   * The method and profiles checks are not redundant: selectedLanguage is
   * remembered across method switches, and FluentBit / Fluentd / Alloy render
   * no language selector at all, so without them a stale "react" selection
   * would tell someone configuring a log shipper to go and make a browser key.
   */
  const isBrowserSdkGuide: boolean =
    (selectedMethod === "opentelemetry" &&
      !isProfiles &&
      (selectedLanguage === "react" || selectedLanguage === "angular")) ||
    // A Sentry DSN in a browser app ships to its users, as a snippet does.
    (selectedMethod === CompatibleIngestMethod.Sentry &&
      sentryRuntime === SentryRuntime.Browser);

  /*
   * The OTLP endpoint: the step's OTLP Endpoint, and every SDK snippet's
   * <YOUR_ONEUPTIME_URL> (OtelSdkSnippets).
   */
  const httpProtocol: string =
    HTTP_PROTOCOL === Protocol.HTTPS ? "https" : "http";
  const otlpUrl: string = HOST
    ? `${httpProtocol}://${HOST}/otlp`
    : "<YOUR_ONEUPTIME_URL>";
  const pyroscopeUrl: string = HOST
    ? `${httpProtocol}://${HOST}/pyroscope`
    : "<YOUR_ONEUPTIME_PYROSCOPE_URL>";

  useEffect(() => {
    /*
     * Only the profiles guide renders the verification step, so other
     * telemetry types must not generate background traffic. Once data is
     * confirmed the dependency change re-runs this effect, which bails
     * out immediately — the previous run's cleanup clears the interval.
     */
    if (!isProfiles || isProfileDataConfirmed) {
      return;
    }

    let cancelled: boolean = false;

    const checkForProfiles: () => Promise<void> = async (): Promise<void> => {
      try {
        /*
         * Recompute the window on every poll — a window captured once
         * would drift out of "now" while the user is still wiring up
         * their agent. 15 minutes comfortably covers agent flush
         * intervals without picking up stale data from older runs.
         */
        const endTime: Date = OneUptimeDate.getCurrentDate();
        const startTime: Date = OneUptimeDate.addRemoveMinutes(endTime, -15);

        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              "/telemetry/profiles/service-activity",
            ),
            data: {
              startTime: startTime.toISOString(),
              endTime: endTime.toISOString(),
            },
            headers: {
              ...ModelAPI.getCommonHeaders(),
            },
          });

        if (cancelled) {
          return;
        }

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        const activity: Array<JSONObject> = (response.data["activity"] ||
          []) as unknown as Array<JSONObject>;

        if (activity.length > 0) {
          setProfileSourceCount(activity.length);
          setIsProfileDataConfirmed(true);
        } else {
          setHasProfileVerifyError(false);
        }
      } catch {
        /*
         * Transient failures (network blips, gateway restarts) are
         * expected mid-setup. Surface a quiet retry note instead of an
         * alarming error state — polling continues regardless.
         */
        if (!cancelled) {
          setHasProfileVerifyError(true);
        }
      }
    };

    checkForProfiles().catch(() => {});
    const pollIntervalId: ReturnType<typeof setInterval> = setInterval(() => {
      checkForProfiles().catch(() => {});
    }, 5000);

    return () => {
      cancelled = true;
      clearInterval(pollIntervalId);
    };
  }, [isProfiles, isProfileDataConfirmed]);

  // Get token string for code snippets
  const tokenValue: string =
    selectedKey?.secretKey?.toString() || "<YOUR_ONEUPTIME_TOKEN>";
  const otlpUrlValue: string = otlpUrl;

  /*
   * Where another tool's agent or SDK is pointed, with the picked key. The
   * log shippers' files (LogShipperSnippets) are built from it too.
   */
  const compatibleEndpoint: CompatibleIngestEndpoint = {
    protocol: httpProtocol,
    host: HOST ? HOST : "<YOUR_ONEUPTIME_HOST>",
    key: tokenValue,
  };

  const compatibleGuides: Array<CompatibleIngestGuideCopy> = useMemo(() => {
    return isProfiles ? [] : getCompatibleIngestGuides(telemetryType);
  }, [telemetryType, isProfiles]);

  const integrationMethods: Array<IntegrationOption> = useMemo(() => {
    if (isProfiles) {
      return [
        {
          key: "alloy" as IntegrationMethod,
          label: translationKey("Grafana Alloy (eBPF)"),
          logo: ProviderLogo.Grafana,
          description: translationKey(
            "Recommended. Zero-code profiling for all languages on Linux using eBPF.",
          ),
        },
        {
          key: "kubernetes" as IntegrationMethod,
          label: translationKey("Kubernetes agent (eBPF)"),
          logo: ProviderLogo.Kubernetes,
          description: translationKey(
            "Already run the OneUptime Kubernetes agent? Turn on its profiler: every pod, no code changes.",
          ),
        },
        {
          key: "opentelemetry" as IntegrationMethod,
          label: translationKey("Language SDK"),
          icon: IconProp.Code,
          description: translationKey(
            "In-process profiling with Pyroscope SDKs: Go, Node.js, .NET, Python, Ruby, Rust.",
          ),
        },
      ];
    }

    const methods: Array<IntegrationOption> = [
      {
        key: "opentelemetry",
        label: "OpenTelemetry",
        description: translationKey(
          "Recommended. Auto-instrumentation for most frameworks.",
        ),
        logo: ProviderLogo.OpenTelemetry,
      },
    ];

    if (showLogCollectors) {
      methods.push({
        key: "fluentbit",
        label: "FluentBit",
        description: translationKey(
          "Lightweight log processor with minimal resource usage.",
        ),
        logo: ProviderLogo.FluentBit,
      });
      methods.push({
        key: "fluentd",
        label: "Fluentd",
        description: translationKey(
          "Mature data collector with rich plugin ecosystem.",
        ),
        logo: ProviderLogo.Fluentd,
      });
    }

    return methods;
  }, [showLogCollectors, isProfiles]);

  const titleForType: Record<TelemetryType, string> = {
    logs: translationKey("Log Ingestion Setup"),
    metrics: translationKey("Metrics Ingestion Setup"),
    traces: translationKey("Trace Ingestion Setup"),
    exceptions: translationKey("Exception Ingestion Setup"),
    profiles: translationKey("Profiles Ingestion Setup"),
  };

  const descriptionForType: Record<TelemetryType, string> = {
    logs: translationKey(
      "Send logs from your application to OneUptime using OpenTelemetry, FluentBit, or Fluentd.",
    ),
    metrics: translationKey(
      "Send metrics from your application to OneUptime using OpenTelemetry SDKs.",
    ),
    traces: translationKey(
      "Send distributed traces from your application to OneUptime using OpenTelemetry SDKs.",
    ),
    exceptions: translationKey(
      "Capture and track exceptions from your application using OpenTelemetry SDKs.",
    ),
    profiles: translationKey(
      "Send continuous profiling data to OneUptime using Grafana Alloy (eBPF), the OneUptime Kubernetes agent or Pyroscope language SDKs.",
    ),
  };

  const installSnippet: { code: string; language: string } = useMemo(() => {
    if (isProfiles) {
      return getProfileInstallSnippet(selectedLanguage);
    }
    return getOtelInstallSnippet(selectedLanguage);
  }, [selectedLanguage, isProfiles]);

  const configSnippet: { code: string; language: string } = useMemo(() => {
    if (isProfiles) {
      return getProfileConfigSnippet(selectedLanguage);
    }
    return getOtelConfigSnippet(selectedLanguage);
  }, [selectedLanguage, isProfiles]);

  const handleLanguageSelect: (lang: Language) => void = useCallback(
    (lang: Language) => {
      setSelectedLanguage(lang);
    },
    [],
  );

  // Step component with vertical line connector
  const renderStep: (
    stepNumber: number,
    title: string,
    description: string,
    content: ReactElement,
    isLast?: boolean,
  ) => ReactElement = (
    stepNumber: number,
    title: string,
    description: string,
    content: ReactElement,
    isLast?: boolean,
  ): ReactElement => {
    return (
      <div className="relative flex gap-5">
        {/* Step indicator with connecting line */}
        <div className="flex flex-col items-center flex-shrink-0">
          <div className="w-9 h-9 rounded-full bg-indigo-50 border-2 border-indigo-500 text-indigo-600 flex items-center justify-center text-sm font-bold">
            {stepNumber}
          </div>
          {!isLast && <div className="w-0.5 flex-1 bg-gray-200 mt-2 mb-0" />}
        </div>
        {/* Step content */}
        <div className={`flex-1 min-w-0 ${isLast ? "pb-0" : "pb-8"}`}>
          {/*
           * One line is as tall as the step's circle (py-2 + leading-5 =
           * h-9), so a short title sits level with its number; a title that
           * wraps ("Ihre Ingestion-Zugangsdaten abrufen" in a phone's
           * column) keeps normal line spacing instead of a 36px gap.
           */}
          <h4 className="py-2 text-sm font-semibold text-gray-900 leading-5">
            {translate(title)}
          </h4>
          <p className="text-sm text-gray-500 mt-0.5 mb-3 leading-relaxed">
            {translate(description)}
          </p>
          {content}
        </div>
      </div>
    );
  };

  // Token step content (rendered inside Step 1)
  const renderTokenStepContent: () => ReactElement = (): ReactElement => {
    /*
     * Another tool's agent or SDK is pointed at its own endpoint - the
     * remote write URL, the push URL, the DSN - not at OTLP.
     */
    const compatibleGuide: CompatibleIngestGuideCopy | null =
      isCompatibleIngestMethod(selectedMethod)
        ? getCompatibleIngestGuide(selectedMethod)
        : null;

    return (
      <IngestionKeySelector
        endpointLabel={
          compatibleGuide
            ? compatibleGuide.endpointLabel
            : isProfiles
              ? translationKey("Profiling Endpoint")
              : translationKey("OTLP Endpoint")
        }
        /*
         * Profiles are ingested over the Pyroscope-compatible API, not
         * OTLP — showing the OTLP URL here would point the user's
         * profiler at an endpoint it cannot push to.
         */
        endpointValue={
          compatibleGuide
            ? getCompatibleIngestEndpointValue(
                compatibleGuide.method,
                compatibleEndpoint,
              )
            : isProfiles
              ? pyroscopeUrl
              : otlpUrlValue
        }
        endpointHint={
          isProfiles
            ? translationKey(
                "Use this as the Pyroscope server address. SDKs and Grafana Alloy append the ingest path to it automatically.",
              )
            : undefined
        }
        /*
         * On a browser guide the picker is narrowed to Browser keys so a
         * server secret is never offered for pasting into a page. Every
         * other guide runs on infrastructure the customer controls, which
         * sends no Origin header - a Browser key would be refused there -
         * so it lists and makes Server keys.
         */
        keyTypeFilter={
          isBrowserSdkGuide
            ? TelemetryIngestionKeyType.Browser
            : TelemetryIngestionKeyType.Server
        }
        newKeyName={NEW_KEY_NAME_FOR_TYPE[telemetryType]}
        onSelectedKeyChange={(key: TelemetryIngestionKey | null): void => {
          setSelectedKey(key);
          props.onSelectedKeyChange?.(key);
        }}
      />
    );
  };

  /*
   * Repeated immediately above the snippet that carries the token, not just
   * on the key-picking step. The two are separated by the install step, and
   * the moment the mistake actually happens is the copy-paste - so the
   * warning belongs where the token is on screen.
   */
  const renderBrowserKeyWarning: () => ReactElement = (): ReactElement => {
    if (!isBrowserSdkGuide) {
      return <></>;
    }

    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 mb-3">
        <div className="flex items-start gap-3">
          <Icon
            icon={IconProp.Alert}
            className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5"
          />
          <p className="text-sm text-amber-800 leading-relaxed">
            <TranslatedSentence
              template="This file is bundled and served to your users, so the token in it is public — anyone who views source can read it. Use a {{browser}} ingestion key here, with the origins your site is served from listed on it. Never paste a {{server}} ingestion key into browser code: it has full ingest access from anywhere, so whoever finds it can write forged telemetry into this project until you notice and rotate it."
              slots={{
                browser: (
                  <span className="font-semibold">
                    {translator.translateText("Browser")}
                  </span>
                ),
                server: (
                  <span className="font-semibold">
                    {translator.translateText("Server")}
                  </span>
                ),
              }}
            />
          </p>
        </div>
      </div>
    );
  };

  // Language selector
  const renderLanguageSelector: () => ReactElement = (): ReactElement => {
    const availableLanguages: Array<LanguageOption> = isProfiles
      ? languages.filter((l: LanguageOption) => {
          return profileLanguages.includes(l.key);
        })
      : languages;

    return (
      <div className="mb-6">
        <p
          id={languagePickerCaptionId}
          className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2"
        >
          {translator.translateText("Select Language")}
        </p>
        <div
          role="group"
          aria-labelledby={languagePickerCaptionId}
          className="flex flex-wrap gap-1.5"
        >
          {availableLanguages.map((lang: LanguageOption) => {
            const isSelected: boolean = selectedLanguage === lang.key;
            /*
             * Each language beside its own mark, drawn in the button's own
             * colour (text-current): grey at rest, indigo on hover and once
             * picked. The picked one is tinted, not filled, as before.
             */
            return (
              <button
                key={lang.key}
                type="button"
                aria-pressed={isSelected}
                onClick={() => {
                  handleLanguageSelect(lang.key);
                }}
                className={`inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg border transition-all ${
                  isSelected
                    ? "bg-indigo-50 text-indigo-700 border-indigo-500 ring-1 ring-inset ring-indigo-500 shadow-sm"
                    : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300 hover:text-indigo-600 hover:bg-indigo-50"
                }`}
              >
                <ProviderLogoImage
                  logo={lang.logo}
                  isBare={true}
                  isDecorative={true}
                  colorClassName="text-current"
                />
                {/*
                  A name read the way it is written on a right-to-left page
                  too: ".NET" and "C++", not "NET." and "++C".
                */}
                <IsolatedText text={lang.shortLabel} />
              </button>
            );
          })}
        </div>
        {/* The website's full guide for the language and its frameworks. */}
        {!isProfiles && <FrameworkGuideLinks language={selectedLanguage} />}
      </div>
    );
  };

  // Integration method selector
  const renderMethodSelector: () => ReactElement = (): ReactElement => {
    if (integrationMethods.length <= 1 && compatibleGuides.length === 0) {
      return <></>;
    }

    return (
      <div className="mb-6">
        <p
          id={methodPickerCaptionId}
          className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2"
        >
          {translator.translateText("Integration Method")}
        </p>
        <div
          role="group"
          aria-labelledby={methodPickerCaptionId}
          className="grid grid-cols-1 sm:grid-cols-3 gap-2"
        >
          {integrationMethods.map((method: IntegrationOption) => {
            const isSelected: boolean = selectedMethod === method.key;
            return (
              <button
                key={method.key}
                type="button"
                aria-pressed={isSelected}
                onClick={() => {
                  setSelectedMethod(method.key);
                }}
                className={`text-start px-4 py-3 rounded-lg border-2 transition-all ${
                  isSelected
                    ? "border-indigo-500 bg-indigo-50"
                    : "border-gray-200 bg-white hover:border-gray-300"
                }`}
              >
                <div
                  className={`flex items-center gap-2 text-sm font-semibold ${isSelected ? "text-indigo-700" : "text-gray-900"}`}
                >
                  {/*
                    The project's logo, or the method's icon on the same
                    footprint: every title in the row starts on one line.
                  */}
                  {method.logo || method.icon ? (
                    <ProviderLogoOrIcon
                      logo={method.logo}
                      icon={method.icon || IconProp.Code}
                      isBare={true}
                      size={20}
                      isDecorative={true}
                      colorClassName={
                        isSelected ? "text-indigo-600" : "text-gray-500"
                      }
                      iconClassName={`h-5 w-5 flex-shrink-0 ${isSelected ? "text-indigo-600" : "text-gray-500"}`}
                    />
                  ) : (
                    <></>
                  )}
                  {/* The label stays the line's own text, as before the logo. */}
                  {translate(method.label)}
                </div>
                <div className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                  {translate(method.description)}
                </div>
              </button>
            );
          })}
        </div>
        {renderCompatibleMethodPicker()}
      </div>
    );
  };

  /*
   * "Already using another tool?": the agents and SDKs that send here
   * unchanged, under a heading of their own after the guide's own ways, so
   * someone starting fresh is not asked to choose between tools they do
   * not run. Smaller than the ways above them, logo first.
   */
  const renderCompatibleMethodPicker: () => ReactElement = (): ReactElement => {
    if (compatibleGuides.length === 0) {
      return <></>;
    }

    return (
      <div className="mt-5" data-testid="compatible-ingest-methods">
        <p
          id={compatiblePickerCaptionId}
          className="text-sm font-medium text-gray-900"
        >
          {translate(COMPATIBLE_INGEST_HEADING)}
        </p>
        <p className="text-sm text-gray-500 mt-0.5 mb-2 leading-relaxed">
          {translate(COMPATIBLE_INGEST_DESCRIPTION)}
        </p>
        <div
          role="group"
          aria-labelledby={compatiblePickerCaptionId}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2"
        >
          {compatibleGuides.map((guide: CompatibleIngestGuideCopy) => {
            const isSelected: boolean = selectedMethod === guide.method;

            return (
              <button
                key={guide.method}
                type="button"
                aria-pressed={isSelected}
                data-testid={guide.dataTestId}
                onClick={() => {
                  setSelectedMethod(guide.method);
                }}
                className={`text-start px-3 py-2.5 rounded-lg border transition-all ${
                  isSelected
                    ? "border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500"
                    : "border-gray-200 bg-white hover:border-gray-300"
                }`}
              >
                <div
                  className={`flex items-center gap-2 text-sm font-semibold ${isSelected ? "text-indigo-700" : "text-gray-900"}`}
                >
                  <ProviderLogoOrIcon
                    logo={guide.logo}
                    icon={IconProp.Code}
                    isBare={true}
                    size={16}
                    isDecorative={true}
                    colorClassName={
                      isSelected ? "text-indigo-600" : "text-gray-500"
                    }
                    iconClassName={`h-4 w-4 flex-shrink-0 ${isSelected ? "text-indigo-600" : "text-gray-500"}`}
                  />
                  {guide.label}
                </div>
                <div className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                  {translate(guide.description)}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  // Where a Sentry SDK runs: the browser gets a Browser key, as its DSN is public.
  const renderSentryRuntimePicker: () => ReactElement = (): ReactElement => {
    return (
      <div className="mb-6" data-testid="compatible-ingest-sentry-runtime">
        <p
          id={sentryRuntimeCaptionId}
          className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2"
        >
          {translate(SENTRY_RUNTIME_CAPTION)}
        </p>
        <div
          role="group"
          aria-labelledby={sentryRuntimeCaptionId}
          className="flex flex-wrap gap-1.5"
        >
          {[SentryRuntime.Server, SentryRuntime.Browser].map(
            (runtime: SentryRuntime) => {
              const isSelected: boolean = sentryRuntime === runtime;

              return (
                <button
                  key={runtime}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => {
                    setSentryRuntime(runtime);
                  }}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border transition-all ${
                    isSelected
                      ? "bg-indigo-50 border-indigo-300 text-indigo-700"
                      : "bg-white border-gray-200 text-gray-600 hover:border-gray-300 hover:text-gray-900"
                  }`}
                >
                  <Icon
                    icon={
                      runtime === SentryRuntime.Browser
                        ? IconProp.Window
                        : IconProp.Server
                    }
                    className="h-4 w-4"
                  />
                  {translate(SENTRY_RUNTIME_LABELS[runtime])}
                </button>
              );
            },
          )}
        </div>
      </div>
    );
  };

  /*
   * Another tool's agent or SDK, pointed here: the key and the URL, the
   * tool's own configuration with both filled in, and what the data
   * becomes in OneUptime.
   */
  const renderCompatibleContent: (
    method: CompatibleIngestMethod,
  ) => ReactElement = (method: CompatibleIngestMethod): ReactElement => {
    const guide: CompatibleIngestGuideCopy = getCompatibleIngestGuide(method);
    const snippets: Array<CompatibleIngestSnippet> =
      getCompatibleIngestSnippets(method, compatibleEndpoint, {
        sentryRuntime: sentryRuntime,
      });

    const renderSnippet: (snippet: CompatibleIngestSnippet) => ReactElement = (
      snippet: CompatibleIngestSnippet,
    ): ReactElement => {
      return (
        <CodeBlock
          code={withServiceName(snippet.code, props.serviceName)}
          language={snippet.language}
        />
      );
    };

    return (
      <div data-testid={`${guide.dataTestId}-guide`}>
        {method === CompatibleIngestMethod.Sentry ? (
          renderSentryRuntimePicker()
        ) : (
          <></>
        )}
        <div className="mt-2">
          {renderStep(
            1,
            translationKey("Get Your Ingestion Credentials"),
            translationKey(
              "Select an existing ingestion key or create a new one. These credentials authenticate your telemetry data.",
            ),
            renderTokenStepContent(),
          )}

          {renderStep(
            2,
            COMPATIBLE_INGEST_CONFIGURE_TITLE,
            guide.configureDescription,
            <div>
              {renderBrowserKeyWarning()}
              {snippets.length === 1 ? (
                renderSnippet(snippets[0]!)
              ) : (
                <SetupGuideStepVariants
                  variants={snippets.map((snippet: CompatibleIngestSnippet) => {
                    return {
                      label: translate(snippet.label),
                      content: renderSnippet(snippet),
                    };
                  })}
                />
              )}
            </div>,
          )}

          {renderStep(
            3,
            COMPATIBLE_INGEST_NOTES_TITLE,
            COMPATIBLE_INGEST_NOTES_DESCRIPTION,
            <ul className="space-y-2">
              {guide.notes.map((note: string) => {
                return (
                  <li
                    key={note}
                    className="flex items-start gap-2 text-sm text-gray-600 leading-relaxed"
                  >
                    <Icon
                      icon={IconProp.CheckCircle}
                      className="h-4 w-4 text-indigo-500 flex-shrink-0 mt-0.5"
                    />
                    <span>{translate(note)}</span>
                  </li>
                );
              })}
            </ul>,
            true,
          )}
        </div>
      </div>
    );
  };

  /*
   * Live verification card (profiles guide only). Rendered as the final
   * step of every profiles integration method so the user never has to
   * leave the guide to find out whether their agent is actually sending.
   */
  const renderProfileVerifyContent: () => ReactElement = (): ReactElement => {
    if (isProfileDataConfirmed) {
      return (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
              <Icon icon={IconProp.Check} className="w-4 h-4 text-green-600" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-green-800">
                {translator.translatePlural(
                  {
                    one: "Profiles are flowing! {{count}} source reporting.",
                    other: "Profiles are flowing! {{count}} sources reporting.",
                  },
                  profileSourceCount,
                )}
              </p>
              <AppLink
                className="mt-3 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors shadow-sm"
                to={RouteUtil.populateRouteParams(
                  RouteMap[PageMap.PROFILES] as Route,
                )}
              >
                {translate("Open Profiles")}
              </AppLink>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
        <div className="flex items-center gap-3">
          <svg
            className="animate-spin h-4 w-4 text-indigo-500 flex-shrink-0"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            ></circle>
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
            ></path>
          </svg>
          <p className="text-sm text-gray-500">
            {translator.translateText(
              "Listening for your first profile… data usually appears within a minute of the agent starting.",
            )}
          </p>
        </div>
        {hasProfileVerifyError && (
          <p className="text-xs text-gray-400 mt-2">
            {translator.translateText(
              "Couldn't reach the server on the last check — retrying automatically.",
            )}
          </p>
        )}
      </div>
    );
  };

  // OpenTelemetry content
  const renderOpenTelemetryContent: () => ReactElement = (): ReactElement => {
    return (
      <div>
        {renderLanguageSelector()}

        <div className="mt-2">
          {renderStep(
            1,
            translationKey("Get Your Ingestion Credentials"),
            isBrowserSdkGuide
              ? translationKey(
                  "Pick a browser ingestion key, or create one. Only browser keys are listed here — they are the ones safe to publish in a page, because the server accepts them only from the origins you list on them.",
                )
              : translationKey(
                  "Select an existing ingestion key or create a new one. These credentials authenticate your telemetry data.",
                ),
            renderTokenStepContent(),
          )}

          {renderStep(
            2,
            translationKey("Install Dependencies"),
            translator.translateTemplate(
              isProfiles
                ? "Install the Pyroscope profiling SDK for {{language}}."
                : "Install the OpenTelemetry SDK and exporters for {{language}}.",
              {
                language:
                  languages.find((l: LanguageOption) => {
                    return l.key === selectedLanguage;
                  })?.label || selectedLanguage,
              },
            ),
            <CodeBlock
              code={installSnippet.code}
              language={installSnippet.language}
            />,
          )}

          {renderStep(
            3,
            // The Pyroscope SDK for profiles, OpenTelemetry's for the rest.
            translationKey("Configure the SDK"),
            isProfiles
              ? translationKey(
                  "Initialize the Pyroscope profiling SDK and point it to your OneUptime instance. Profiles will be continuously captured and sent.",
                )
              : translationKey(
                  "Initialize OpenTelemetry with the OTLP exporter pointing to your OneUptime instance.",
                ),
            <div>
              {renderBrowserKeyWarning()}
              <CodeBlock
                code={withServiceName(
                  replacePlaceholders(
                    configSnippet.code,
                    otlpUrlValue,
                    tokenValue,
                    pyroscopeUrl,
                  ),
                  props.serviceName,
                )}
                language={configSnippet.language}
              />
            </div>,
            !isProfiles,
          )}

          {isProfiles &&
            renderStep(
              4,
              translationKey("Verify It Is Working"),
              translationKey(
                "Leave this page open while your service starts — incoming profiles are detected automatically.",
              ),
              renderProfileVerifyContent(),
              true,
            )}
        </div>

        {!isProfiles && (
          <div className="mt-8">
            <SetupGuideTopics
              title={translate("Advanced")}
              description={translate(
                "Configure with environment variables · Tag this service with project labels",
              )}
              icon={IconProp.AdjustmentHorizontal}
              testId="telemetry-guide-advanced"
              topics={[
                {
                  title: translate(
                    "Configure with environment variables instead",
                  ),
                  summary: translate(
                    "Point any OpenTelemetry SDK at OneUptime without changing code.",
                  ),
                  content: (
                    <div>
                      <p className="mb-3 text-sm leading-relaxed text-gray-500">
                        {translator.translateText(
                          "Every OpenTelemetry SDK reads these variables, so you can configure the exporter without touching code.",
                        )}
                      </p>
                      <CodeBlock
                        code={withServiceName(
                          replacePlaceholders(
                            getEnvVarSnippet(),
                            otlpUrlValue,
                            tokenValue,
                            pyroscopeUrl,
                          ),
                          props.serviceName,
                        )}
                        language="bash"
                      />
                    </div>
                  ),
                },
                {
                  title: translate("Tag this service with project labels"),
                  summary: translate(
                    "Attach labels such as team, environment or region to this service automatically.",
                  ),
                  content: (
                    <div>
                      <p className="mb-3 text-sm leading-relaxed text-gray-500">
                        <TranslatedSentence
                          template="Any resource attribute prefixed {{prefix}} becomes a project label on this service. Use it to tag services with team, environment, region, or any other dimension you organize by."
                          slots={{
                            prefix: (
                              <code className="rounded border border-gray-200 bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-800">
                                oneuptime.label.
                              </code>
                            ),
                          }}
                        />
                      </p>
                      <CodeBlock
                        code={withServiceName(
                          replacePlaceholders(
                            getOneuptimeServiceLabelsSnippet(),
                            otlpUrlValue,
                            tokenValue,
                            pyroscopeUrl,
                          ),
                          props.serviceName,
                        )}
                        language="bash"
                      />
                    </div>
                  ),
                },
              ]}
            />
          </div>
        )}
      </div>
    );
  };

  // FluentBit content
  const renderFluentBitContent: () => ReactElement = (): ReactElement => {
    return (
      <div>
        <div className="mt-2">
          {renderStep(
            1,
            translationKey("Get Your Ingestion Credentials"),
            translationKey(
              "Select an existing ingestion key or create a new one. These credentials authenticate your telemetry data.",
            ),
            renderTokenStepContent(),
          )}

          {renderStep(
            2,
            translationKey("Create FluentBit Configuration"),
            translationKey(
              "Create a fluent-bit.conf file that reads logs and forwards them to OneUptime via the OpenTelemetry output plugin.",
            ),
            <CodeBlock
              code={withServiceName(
                getFluentBitConfig(compatibleEndpoint),
                props.serviceName,
              )}
              language="yaml"
            />,
          )}

          {renderStep(
            3,
            translationKey("Run FluentBit"),
            translationKey(
              "Start FluentBit with your configuration file, on the host or as a Docker container alongside your application.",
            ),
            <SetupGuideStepVariants
              variants={[
                {
                  label: translate("On the host"),
                  content: (
                    <CodeBlock
                      code="fluent-bit -c fluent-bit.conf"
                      language="bash"
                    />
                  ),
                },
                {
                  label: translate("Docker Compose"),
                  content: (
                    <CodeBlock
                      code={withServiceName(
                        getFluentBitDockerCompose(),
                        props.serviceName,
                      )}
                      language="yaml"
                    />
                  ),
                },
              ]}
            />,
            true,
          )}
        </div>
      </div>
    );
  };

  // Fluentd content
  const renderFluentdContent: () => ReactElement = (): ReactElement => {
    return (
      <div>
        <div className="mt-2">
          {renderStep(
            1,
            translationKey("Get Your Ingestion Credentials"),
            translationKey(
              "Select an existing ingestion key or create a new one. These credentials authenticate your telemetry data.",
            ),
            renderTokenStepContent(),
          )}

          {renderStep(
            2,
            translationKey("Create Fluentd Configuration"),
            translationKey(
              "Create a fluentd.conf file that collects logs and sends them to OneUptime over HTTP.",
            ),
            <CodeBlock
              code={withServiceName(
                getFluentdConfig(compatibleEndpoint),
                props.serviceName,
              )}
              language="yaml"
            />,
          )}

          {renderStep(
            3,
            translationKey("Run Fluentd"),
            translationKey(
              "Start Fluentd with your configuration, on the host or as a Docker container.",
            ),
            <SetupGuideStepVariants
              variants={[
                {
                  label: translate("On the host"),
                  content: (
                    <CodeBlock code="fluentd -c fluentd.conf" language="bash" />
                  ),
                },
                {
                  label: translate("Docker Compose"),
                  content: (
                    <CodeBlock
                      code={withServiceName(
                        getFluentdDockerCompose(),
                        props.serviceName,
                      )}
                      language="yaml"
                    />
                  ),
                },
              ]}
            />,
            true,
          )}
        </div>
      </div>
    );
  };

  // Grafana Alloy eBPF content (for profiles)
  const renderAlloyContent: () => ReactElement = (): ReactElement => {
    return (
      <div>
        <div className="mt-2">
          {renderStep(
            1,
            translationKey("Get Your Ingestion Credentials"),
            translationKey(
              "Select an existing ingestion key or create a new one. These credentials authenticate your profiling data.",
            ),
            renderTokenStepContent(),
          )}

          {renderStep(
            2,
            translationKey("Create Alloy Configuration"),
            translationKey(
              "Create an Alloy configuration file that uses eBPF to collect CPU profiles from all processes on your Linux host — no code changes required. Supports Go, Rust, C/C++, Java, Python, Ruby, PHP, Node.js, and .NET.",
            ),
            <CodeBlock
              code={withServiceName(
                replacePlaceholders(
                  getAlloyEbpfSnippet(),
                  otlpUrlValue,
                  tokenValue,
                  pyroscopeUrl,
                ),
                props.serviceName,
              )}
              language="nginx"
            />,
          )}

          {renderStep(
            3,
            translationKey("Run Alloy"),
            translationKey(
              "Run Grafana Alloy as a privileged Docker container with access to the host PID namespace, or directly on the host.",
            ),
            <SetupGuideStepVariants
              variants={[
                {
                  label: translate("Docker Compose"),
                  content: (
                    <CodeBlock
                      code={withServiceName(
                        replacePlaceholders(
                          getAlloyDockerSnippet(),
                          otlpUrlValue,
                          tokenValue,
                          pyroscopeUrl,
                        ),
                        props.serviceName,
                      )}
                      language="yaml"
                    />
                  ),
                },
                {
                  label: translate("On the host"),
                  content: (
                    <CodeBlock
                      code="alloy run alloy-config.alloy"
                      language="bash"
                    />
                  ),
                },
              ]}
            />,
          )}

          {renderStep(
            4,
            translationKey("Verify It Is Working"),
            translationKey(
              "Leave this page open while Alloy starts — incoming profiles are detected automatically.",
            ),
            renderProfileVerifyContent(),
            true,
          )}
        </div>
      </div>
    );
  };

  /*
   * The Kubernetes agent's eBPF profiler (for profiles): two steps - turn it
   * on, see it work. A cluster without the agent is pointed at the agent's
   * own guide under the command, not given a numbered step of its own.
   */
  const renderKubernetesAgentProfilesContent: () => ReactElement =
    (): ReactElement => {
      return (
        <div data-testid="profiles-setup-kubernetes-agent">
          <div className="mt-2">
            {renderStep(
              1,
              translationKey("Turn On Profiling in the Agent"),
              translationKey(
                "It profiles every container on every Linux node, in any language, with no code changes. It needs privileged pods, so it is not available on GKE Autopilot or EKS Fargate.",
              ),
              <div>
                <CodeBlock
                  code={KUBERNETES_AGENT_PROFILING_COMMAND}
                  language="bash"
                />
                <p
                  className="mt-3 text-sm text-gray-500"
                  data-testid="profiles-setup-kubernetes-agent-install"
                >
                  {translator.translateText("No agent in the cluster yet?")}{" "}
                  <AppLink
                    className="font-medium text-indigo-600 hover:text-indigo-500"
                    to={RouteUtil.populateRouteParams(
                      RouteMap[PageMap.KUBERNETES_DOCUMENTATION] as Route,
                    )}
                  >
                    {translate("Install it with the Kubernetes setup guide")}
                  </AppLink>
                </p>
              </div>,
            )}

            {renderStep(
              2,
              translationKey("Verify It Is Working"),
              translationKey(
                "Leave this page open while the profiler pods start — incoming profiles are detected automatically.",
              ),
              renderProfileVerifyContent(),
              true,
            )}
          </div>
        </div>
      );
    };

  const renderActiveContent: () => ReactElement = (): ReactElement => {
    if (isCompatibleIngestMethod(selectedMethod)) {
      return renderCompatibleContent(selectedMethod);
    }

    switch (selectedMethod) {
      case "fluentbit":
        return renderFluentBitContent();
      case "fluentd":
        return renderFluentdContent();
      case "alloy":
        return renderAlloyContent();
      case "kubernetes":
        return renderKubernetesAgentProfilesContent();
      default:
        return renderOpenTelemetryContent();
    }
  };

  if (props.isBare) {
    return (
      <div data-testid="telemetry-documentation">
        {renderMethodSelector()}
        {renderActiveContent()}
      </div>
    );
  }

  return (
    <div className="mb-5">
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-visible">
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-100">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center flex-shrink-0">
              <svg
                className="w-5 h-5 text-indigo-600"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
                />
              </svg>
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-semibold text-gray-900">
                {translate(titleForType[telemetryType])}
              </h2>
              <p className="text-sm text-gray-500 mt-0.5 leading-relaxed">
                {translate(descriptionForType[telemetryType])}
              </p>
            </div>
            {props.onClose && (
              <button
                type="button"
                onClick={props.onClose}
                className="flex-shrink-0 rounded-lg p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                title={translator.translateText("Close documentation")}
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-6">
          {renderMethodSelector()}
          {renderActiveContent()}
          {telemetryType === "profiles" ? (
            <></>
          ) : (
            <div
              className="mt-6"
              data-testid="telemetry-documentation-first-data"
            >
              <h3 className="mb-2 text-sm font-semibold text-gray-900">
                {translate(SETUP_GUIDE_FIRST_DATA_TITLE)}
              </h3>
              <ResourceConnectionWatch
                modelType={Service}
                viewPage={SETUP_GUIDE_FIRST_DATA_VIEWS[telemetryType].page}
                viewText={SETUP_GUIDE_FIRST_DATA_VIEWS[telemetryType].text}
                ingestionKey={selectedKey}
                dataPage={SETUP_GUIDE_FIRST_DATA_VIEWS[telemetryType].dataPage}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TelemetryDocumentation;
