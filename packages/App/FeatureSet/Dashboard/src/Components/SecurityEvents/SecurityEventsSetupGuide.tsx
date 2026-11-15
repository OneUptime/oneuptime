import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import TelemetryIngestionKey from "Common/Models/DatabaseModels/TelemetryIngestionKey";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import ProjectUtil from "Common/UI/Utils/Project";
import Query from "Common/Types/BaseDatabase/Query";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import OneUptimeDate from "Common/Types/Date";
import { DOCS_URL, HOST, HTTP_PROTOCOL } from "Common/UI/Config";
import Protocol from "Common/Types/API/Protocol";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import Link from "Common/UI/Components/Link/Link";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import AppLink from "../AppLink/AppLink";
import IngestionKeySelector from "../Telemetry/IngestionKeySelector";
import { getFluentBitHostAndPort } from "../Telemetry/CompatibleIngestGuide";

/*
 * "How do I get my SIEM signals in here?"
 *
 * Security events do not arrive over OTLP and have no SDK, so this guide
 * is separate from Components/Telemetry/Documentation.tsx rather than
 * another telemetryType inside it: there is no language to pick and no
 * instrumentation to install — the whole integration is one authenticated
 * POST of JSON, and what actually varies is the dialect the source speaks.
 * The two guides share the part that is genuinely the same, the ingestion
 * key step (Components/Telemetry/IngestionKeySelector.tsx).
 *
 * Every snippet here is written against the real ingest contract in
 * App/FeatureSet/Telemetry/API/SecurityEventsIngest.ts and the
 * normalizers in Common/Utils/SecurityEvent — the field names in the
 * examples are the ones those normalizers actually read, so a sample
 * pasted into a terminal produces a fully populated event rather than a
 * row of blanks.
 */

type Source = "http" | "fluentbit" | "secops";

/*
 * Wire dialects, mirroring Common/Types/SecurityEvent/SecurityEventFormat.
 * The `format` values are what the ingest endpoint accepts on
 * ?format= / x-oneuptime-security-event-format; omitting them entirely is
 * also valid, which is why the guide says so on every sample.
 */
type Dialect = "ocsf" | "udm" | "secops-alert" | "generic";

interface SourceOption {
  key: Source;
  label: string;
  description: string;
}

interface DialectOption {
  key: Dialect;
  label: string;
  description: string;
}

const sources: Array<SourceOption> = [
  {
    key: "http",
    label: "HTTP (any source)",
    description:
      "Recommended. POST JSON from any SIEM, webhook, forwarder or script.",
  },
  {
    key: "fluentbit",
    label: "Fluent Bit",
    description:
      "Forward security logs you already collect — auditd, syslog, Falco.",
  },
  {
    key: "secops",
    label: "Google SecOps",
    description: "Chronicle SOAR playbook alerts or UDM event forwarding.",
  },
];

const dialects: Array<DialectOption> = [
  {
    key: "ocsf",
    label: "OCSF",
    description: "Native OCSF event JSON.",
  },
  {
    key: "udm",
    label: "Google UDM",
    description: "Chronicle / SecOps UDM events.",
  },
  {
    key: "secops-alert",
    label: "SecOps alert",
    description: "Detection payloads with matched events.",
  },
  {
    key: "generic",
    label: "Generic JSON",
    description: "Any vendor JSON, mapped best-effort.",
  },
];

/*
 * The generic dialect's alias table, kept in step with the field lists in
 * Common/Utils/SecurityEvent/GenericNormalizer.ts. Anything not listed is
 * still stored — it lands in `attributes` flattened to dot-notation keys —
 * so this is a table of what gets promoted to a typed column, not a table
 * of what is accepted.
 */
const genericFieldMappings: Array<{ column: string; accepts: string }> = [
  { column: "message", accepts: "message, msg, summary, description, title" },
  { column: "severityName", accepts: "severity, level, priority, risk_level" },
  { column: "time", accepts: "timestamp, time, @timestamp, event_time, date" },
  { column: "principalUser", accepts: "user, username, account, actor" },
  { column: "principalHost", accepts: "host, hostname, device, computer" },
  { column: "principalIp", accepts: "source_ip, src_ip, client_ip, ip" },
  { column: "targetIp", accepts: "destination_ip, dest_ip, target_ip" },
  { column: "className", accepts: "event_type, category, type, action" },
  { column: "ruleName", accepts: "rule, rule_name, signature, detection" },
  { column: "productName", accepts: "product, source, log_source" },
];

const SecurityEventsSetupGuide: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [selectedSource, setSelectedSource] = useState<Source>("http");
  const [selectedDialect, setSelectedDialect] = useState<Dialect>("ocsf");
  const [selectedKey, setSelectedKey] = useState<TelemetryIngestionKey | null>(
    null,
  );

  /*
   * Live ingest verification, same idea as the profiles guide: the user
   * finds out on this page whether their source is actually sending,
   * instead of navigating to the Events page and guessing whether an empty
   * table means "not wired up" or "nothing has happened yet".
   * `isDataConfirmed` is a one-way latch so the success state cannot
   * flicker back if a later window happens to be empty.
   */
  const [isDataConfirmed, setIsDataConfirmed] = useState<boolean>(false);
  const [eventCount, setEventCount] = useState<number>(0);
  const [hasVerifyError, setHasVerifyError] = useState<boolean>(false);

  /*
   * The verification window opens when the GUIDE does, not an hour ago:
   * a project with an existing source — or an enabled detection rule
   * writing findings every cycle — always has recent events, and a
   * trailing window would flash "flowing!" before the user's new source
   * sent a byte. Counting only events that arrive after this moment
   * cannot distinguish the new source from another active one, but it
   * can no longer confirm on history alone. The trade-off: a source that
   * stamps events with old timestamps confirms late or not at all — the
   * Events page still shows them.
   */
  const [verifyStartTime] = useState<Date>(() => {
    return OneUptimeDate.getCurrentDate();
  });

  const httpProtocol: string =
    HTTP_PROTOCOL === Protocol.HTTPS ? "https" : "http";
  const ingestUrl: string = HOST
    ? `${httpProtocol}://${HOST}/security-events/v1/ingest`
    : "<YOUR_ONEUPTIME_URL>/security-events/v1/ingest";

  const tokenValue: string =
    selectedKey?.secretKey?.toString() || "<YOUR_ONEUPTIME_TOKEN>";

  /*
   * Fluent Bit's http output takes host and port as separate settings, so
   * the port has to come off the configured HOST (which carries one in
   * local and self-hosted setups), and an IPv6 address goes without its
   * brackets, which Fluent Bit cannot resolve: as in every Fluent Bit file
   * the guides hand out. Cut at its first ":", "[::1]:8080" gave Host "["
   * and the protocol's default port instead of 8080 (#7889).
   */
  const fluentBit: { host: string; port: string } = getFluentBitHostAndPort({
    protocol: httpProtocol,
    host: HOST || "<YOUR_ONEUPTIME_HOST>",
    key: tokenValue,
  });

  useEffect(() => {
    if (isDataConfirmed) {
      return;
    }

    let cancelled: boolean = false;

    const checkForEvents: () => Promise<void> = async (): Promise<void> => {
      try {
        const endTime: Date = OneUptimeDate.getCurrentDate();

        const count: number = await AnalyticsModelAPI.count<SecurityEvent>(
          SecurityEvent,
          {
            projectId: ProjectUtil.getCurrentProjectId()!,
            time: new InBetween<Date>(verifyStartTime, endTime),
          } as Query<SecurityEvent>,
        );

        if (cancelled) {
          return;
        }

        if (count > 0) {
          setEventCount(count);
          setIsDataConfirmed(true);
        } else {
          setHasVerifyError(false);
        }
      } catch {
        /*
         * Transient failures (network blips, gateway restarts) are
         * expected mid-setup. Surface a quiet retry note rather than an
         * alarming error state — polling continues regardless.
         */
        if (!cancelled) {
          setHasVerifyError(true);
        }
      }
    };

    checkForEvents().catch(() => {});
    const pollIntervalId: ReturnType<typeof setInterval> = setInterval(() => {
      checkForEvents().catch(() => {});
    }, 5000);

    return () => {
      cancelled = true;
      clearInterval(pollIntervalId);
    };
  }, [isDataConfirmed, verifyStartTime]);

  const curlSnippet: (data: {
    format: string;
    body: string;
  }) => string = (data: { format: string; body: string }): string => {
    return `curl -X POST "${ingestUrl}${data.format}" \\
  -H "Content-Type: application/json" \\
  -H "x-oneuptime-token: ${tokenValue}" \\
  -H "x-oneuptime-service-name: my-security-source" \\
  -d '${data.body}'`;
  };

  const dialectSnippet: () => string = (): string => {
    if (selectedDialect === "ocsf") {
      return curlSnippet({
        format: "?format=ocsf",
        body: `{
  "events": [
    {
      "class_uid": 3002,
      "severity_id": 4,
      "time": 1755770400000,
      "status": "Failure",
      "activity_name": "Logon",
      "message": "Failed logon for alice",
      "metadata": {
        "product": { "name": "Okta", "vendor_name": "Okta" },
        "rule": { "uid": "R-1042", "name": "Failed logon burst" }
      },
      "actor": { "user": { "name": "alice" } },
      "src_endpoint": { "ip": "203.0.113.7", "hostname": "laptop-alice" },
      "dst_endpoint": { "hostname": "vpn-gw-01", "port": 443 }
    }
  ]
}`,
      });
    }

    if (selectedDialect === "udm") {
      return curlSnippet({
        format: "?format=udm",
        body: `{
  "events": [
    {
      "metadata": {
        "event_type": "USER_LOGIN",
        "event_timestamp": "2026-08-21T10:00:00Z",
        "vendor_name": "Google",
        "product_name": "Google SecOps"
      },
      "principal": { "user": { "userid": "alice" }, "ip": ["203.0.113.7"] },
      "target": { "hostname": "vpn-gw-01" },
      "security_result": [{ "severity": "HIGH", "action": ["BLOCK"] }]
    }
  ]
}`,
      });
    }

    if (selectedDialect === "secops-alert") {
      return curlSnippet({
        format: "?format=google-secops-alert",
        body: `{
  "type": "RULE_DETECTION",
  "detectionTime": "2026-08-21T10:00:00Z",
  "detection": [
    {
      "ruleId": "ru_1a2b3c",
      "ruleName": "Suspicious PowerShell",
      "severity": "HIGH",
      "alertState": "ALERTING",
      "urlBackToProduct": "https://secops.example.com/detections/ru_1a2b3c"
    }
  ],
  "collectionElements": [
    {
      "references": [
        {
          "event": {
            "metadata": { "event_type": "PROCESS_LAUNCH" },
            "principal": {
              "hostname": "web-01",
              "user": { "userid": "svc-deploy" },
              "process": { "command_line": "powershell -enc SQBFAFgA" }
            }
          }
        }
      ]
    }
  ]
}`,
      });
    }

    return curlSnippet({
      format: "",
      body: `{
  "events": [
    {
      "timestamp": "2026-08-21T10:00:00Z",
      "severity": "high",
      "event_type": "ssh_brute_force",
      "message": "12 failed SSH logins in 60s",
      "rule_name": "SSH brute force",
      "product": "my-edr",
      "username": "root",
      "hostname": "web-01",
      "src_ip": "203.0.113.7",
      "attempts": 12
    }
  ]
}`,
    });
  };

  const fluentBitSnippet: () => string = (): string => {
    return `# fluent-bit.conf — forward security logs you already collect.
# The http output posts a JSON array; the ingest endpoint accepts a bare
# array, { "events": [...] }, or a single object.

[OUTPUT]
    Name             http
    Match            security.*
    Host             ${fluentBit.host}
    Port             ${fluentBit.port}
    tls              ${httpProtocol === "https" ? "On" : "Off"}
    URI              /security-events/v1/ingest
    Format           json
    Json_date_key    timestamp
    Json_date_format iso8601
    Header           x-oneuptime-token ${tokenValue}
    Header           x-oneuptime-service-name my-security-source
    Retry_Limit      5`;
  };

  const secOpsSnippet: () => string = (): string => {
    return `# Google SecOps SOAR playbook -> HTTP request action
Method:  POST
URL:     ${ingestUrl}
Headers:
  Content-Type: application/json
  x-oneuptime-token: ${tokenValue}
Body:    the alert JSON, unmodified

# Or forward UDM events from your own pipeline:
curl -X POST "${ingestUrl}?format=udm" \\
  -H "Content-Type: application/json" \\
  -H "x-oneuptime-token: ${tokenValue}" \\
  -d '{ "events": [ { "metadata": { "event_type": "USER_LOGIN" } } ] }'`;
  };

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
        <div className="flex flex-col items-center flex-shrink-0">
          <div className="w-9 h-9 rounded-full bg-indigo-50 border-2 border-indigo-500 text-indigo-600 flex items-center justify-center text-sm font-bold">
            {stepNumber}
          </div>
          {!isLast && <div className="w-0.5 flex-1 bg-gray-200 mt-2 mb-0" />}
        </div>
        <div className={`flex-1 min-w-0 ${isLast ? "pb-0" : "pb-8"}`}>
          {/*
           * As tall as the step's 36px number for one line (6px above and
           * below a 24px line), its first line level with the number; a
           * title that wraps (German at phone width) goes on at its own line
           * height, as the shared setup guide steps do (SetupGuideSteps).
           */}
          <h4 className="py-1.5 text-sm font-semibold leading-6 text-gray-900">
            {translator.translateText(title)}
          </h4>
          <p className="text-sm text-gray-500 mt-0.5 mb-3 leading-relaxed">
            {translator.translateText(description)}
          </p>
          {content}
        </div>
      </div>
    );
  };

  const renderSourceSelector: () => ReactElement = (): ReactElement => {
    return (
      <div className="mb-6">
        <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
          {translator.translateText("Where are your events coming from?")}
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {sources.map((source: SourceOption) => {
            const isSelected: boolean = selectedSource === source.key;
            return (
              <button
                key={source.key}
                type="button"
                onClick={() => {
                  setSelectedSource(source.key);
                }}
                className={`text-start px-4 py-3 rounded-lg border-2 transition-all ${
                  isSelected
                    ? "border-indigo-500 bg-indigo-50"
                    : "border-gray-200 bg-white hover:border-gray-300"
                }`}
              >
                <div
                  className={`text-sm font-semibold ${isSelected ? "text-indigo-700" : "text-gray-900"}`}
                >
                  {translator.translateText(source.label)}
                </div>
                <div className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                  {translator.translateText(source.description)}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const renderDialectSelector: () => ReactElement = (): ReactElement => {
    return (
      <div className="mb-4">
        <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
          {translator.translateText("Payload dialect")}
        </label>
        <div className="flex flex-wrap gap-1.5">
          {dialects.map((dialect: DialectOption) => {
            const isSelected: boolean = selectedDialect === dialect.key;
            return (
              <button
                key={dialect.key}
                type="button"
                title={translator.translateText(dialect.description)}
                onClick={() => {
                  setSelectedDialect(dialect.key);
                }}
                className={`px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors ${
                  isSelected
                    ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                    : "border-gray-200 bg-white text-gray-700 hover:border-gray-300"
                }`}
              >
                {translator.translateText(dialect.label)}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-gray-500 mt-2 leading-relaxed">
          {translator.translateText(
            dialects.find((dialect: DialectOption) => {
              return dialect.key === selectedDialect;
            })?.description,
          )}{" "}
          <TranslatedSentence
            template="The dialect is detected per event when you leave {{format}} off, so one webhook can mix detection alerts with raw events."
            slots={{
              format: <code className="font-mono text-gray-700">format</code>,
            }}
          />
        </p>
      </div>
    );
  };

  const renderGenericFieldTable: () => ReactElement = (): ReactElement => {
    return (
      <div className="rounded-lg border border-gray-200 overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-start text-xs font-medium text-gray-500 uppercase tracking-wider">
                {translator.translateText("Column")}
              </th>
              <th className="px-4 py-2 text-start text-xs font-medium text-gray-500 uppercase tracking-wider">
                {translator.translateText("Recognized source fields")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {genericFieldMappings.map(
              (mapping: { column: string; accepts: string }) => {
                return (
                  <tr key={mapping.column}>
                    <td className="px-4 py-2 font-mono text-xs text-gray-900 whitespace-nowrap">
                      {mapping.column}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-gray-500">
                      {mapping.accepts}
                    </td>
                  </tr>
                );
              },
            )}
          </tbody>
        </table>
      </div>
    );
  };

  const renderVerifyContent: () => ReactElement = (): ReactElement => {
    if (isDataConfirmed) {
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
                    one: "Security events are flowing! {{count}} new event since you opened this guide.",
                    other:
                      "Security events are flowing! {{count}} new events since you opened this guide.",
                  },
                  eventCount,
                )}
              </p>
              <AppLink
                className="mt-3 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors shadow-sm"
                to={RouteUtil.populateRouteParams(
                  RouteMap[PageMap.SECURITY_EVENTS] as Route,
                )}
              >
                {translator.translateText("View Security Events") || ""}
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
              "Listening for your first security event… events usually appear within a few seconds of being sent.",
            )}
          </p>
        </div>
        {hasVerifyError && (
          <p className="text-xs text-gray-400 mt-2">
            {translator.translateText(
              "Couldn't reach the server on the last check — retrying automatically.",
            )}
          </p>
        )}
      </div>
    );
  };

  const renderNextStepsContent: () => ReactElement = (): ReactElement => {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <p className="text-sm text-gray-600 leading-relaxed">
          {translator.translateText(
            "Ingested events are searchable on their own, but they earn their keep once something is watching them:",
          )}
        </p>
        <ul className="mt-3 space-y-2 text-sm text-gray-600">
          <li className="flex items-start gap-2">
            <Icon
              icon={IconProp.ShieldCheck}
              className="w-4 h-4 text-indigo-500 flex-shrink-0 mt-0.5"
            />
            <span>
              <TranslatedSentence
                template="{{link}} run Sigma rules over incoming events on a schedule and open alerts when they match."
                slots={{
                  link: (
                    <AppLink
                      className="font-medium text-indigo-600 hover:text-indigo-700"
                      to={RouteUtil.populateRouteParams(
                        RouteMap[
                          PageMap.SECURITY_EVENTS_DETECTION_RULES
                        ] as Route,
                      )}
                    >
                      {translator.translateText("Detection Rules") || ""}
                    </AppLink>
                  ),
                }}
              />
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Icon
              icon={IconProp.Share}
              className="w-4 h-4 text-indigo-500 flex-shrink-0 mt-0.5"
            />
            <span>
              <TranslatedSentence
                template="{{link}} pivots from any observable — a user, host or IP — to everything else that mentions it."
                slots={{
                  link: (
                    <AppLink
                      className="font-medium text-indigo-600 hover:text-indigo-700"
                      to={RouteUtil.populateRouteParams(
                        RouteMap[PageMap.SECURITY_EVENTS_CORRELATE] as Route,
                      )}
                    >
                      {translator.translateText("Correlate") || ""}
                    </AppLink>
                  ),
                }}
              />
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Icon
              icon={IconProp.Alert}
              className="w-4 h-4 text-indigo-500 flex-shrink-0 mt-0.5"
            />
            <span>
              <TranslatedSentence
                template="A {{link}} counts matching events over a sliding window and drives the usual criteria — change status, open incidents, page on-call."
                slots={{
                  link: (
                    <AppLink
                      className="font-medium text-indigo-600 hover:text-indigo-700"
                      to={RouteUtil.populateRouteParams(
                        RouteMap[PageMap.MONITORS] as Route,
                      )}
                    >
                      {translator.translateText("Security Events monitor") ||
                        ""}
                    </AppLink>
                  ),
                }}
              />
            </span>
          </li>
        </ul>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            className="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
            openInNewTab={true}
            to={URL.fromString(
              `${DOCS_URL.toString()}/telemetry/security-events`,
            )}
          >
            <>
              <Icon icon={IconProp.Book} className="h-4 w-4" />
              {translator.translateText("Full documentation")}
            </>
          </Link>
          <Link
            className="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
            openInNewTab={true}
            to={URL.fromString(
              `${DOCS_URL.toString()}/integrations/google-secops`,
            )}
          >
            <>
              <Icon icon={IconProp.Book} className="h-4 w-4" />
              {translator.translateText("Google SecOps guide")}
            </>
          </Link>
        </div>
      </div>
    );
  };

  const renderSendStep: () => ReactElement = (): ReactElement => {
    if (selectedSource === "fluentbit") {
      return (
        <div>
          <CodeBlock code={fluentBitSnippet()} language="yaml" />
          <p className="text-xs text-gray-500 mt-2 leading-relaxed">
            <TranslatedSentence
              template="Records are mapped best-effort by field name — see the table below for which keys become typed columns. Everything else is preserved in {{attributes}}."
              slots={{
                attributes: <code className="font-mono">attributes</code>,
              }}
            />
          </p>
          <div className="mt-3">{renderGenericFieldTable()}</div>
        </div>
      );
    }

    if (selectedSource === "secops") {
      return (
        <div>
          <CodeBlock code={secOpsSnippet()} language="bash" />
          <p className="text-xs text-gray-500 mt-2 leading-relaxed">
            {translator.translateText(
              "Detection payloads are recognized automatically and stored as Detection Finding events, with observables mined from the matched events.",
            )}
          </p>
        </div>
      );
    }

    return (
      <div>
        {renderDialectSelector()}
        <CodeBlock code={dialectSnippet()} language="bash" />
        {selectedDialect === "generic" && (
          <div className="mt-3">{renderGenericFieldTable()}</div>
        )}
      </div>
    );
  };

  return (
    <div className="mb-5">
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-visible">
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-100">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center flex-shrink-0">
              <Icon
                icon={IconProp.ShieldCheck}
                className="w-5 h-5 text-indigo-600"
              />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-semibold text-gray-900">
                {translator.translateText("Send Security Events to OneUptime")}
              </h2>
              <p className="text-sm text-gray-500 mt-0.5 leading-relaxed">
                {translator.translateText(
                  "Any source that can POST JSON over HTTPS can feed Security Events — no SDK and no agent. Events are normalized to OCSF whatever dialect they arrive in, and land in the same data lake as your logs, traces and metrics.",
                )}
              </p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-6">
          {renderSourceSelector()}

          <div className="mt-2">
            {renderStep(
              1,
              translationKey("Get Your Ingestion Credentials"),
              translationKey(
                "Security events authenticate with the same telemetry ingestion key as the rest of your telemetry. Select an existing key or create a new one.",
              ),
              <IngestionKeySelector
                endpointLabel={translationKey(
                  "Security Events Ingest Endpoint",
                )}
                endpointValue={ingestUrl}
                endpointHint={translator.translateText(
                  "Send the token in the x-oneuptime-token header. Name the source with x-oneuptime-service-name, or let it be inferred from the payload's product or vendor.",
                )}
                /*
                 * Security events come from a SIEM, a log shipper or a
                 * script, never a page: only a Server key may write them.
                 */
                keyTypeFilter={TelemetryIngestionKeyType.Server}
                newKeyName={translationKey("Security events key")}
                onSelectedKeyChange={setSelectedKey}
              />,
            )}

            {renderStep(
              2,
              translationKey("Send Your Events"),
              translationKey(
                'The body can be a single object, a bare array, or { "events": [...] }. Everything in the payload is kept: recognized fields become typed columns, the rest is flattened into attributes.',
              ),
              renderSendStep(),
            )}

            {renderStep(
              3,
              translationKey("Verify It Is Working"),
              translationKey(
                "Leave this page open while your source sends — incoming events are detected automatically.",
              ),
              renderVerifyContent(),
            )}

            {renderStep(
              4,
              translationKey("Put The Events To Work"),
              translationKey(
                "Detect, correlate and alert on what you are now collecting.",
              ),
              renderNextStepsContent(),
              true,
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SecurityEventsSetupGuide;
