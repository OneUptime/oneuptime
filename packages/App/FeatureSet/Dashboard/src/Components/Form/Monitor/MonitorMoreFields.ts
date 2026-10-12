import { CriteriaAlert } from "Common/Types/Monitor/CriteriaAlert";
import { CriteriaIncident } from "Common/Types/Monitor/CriteriaIncident";
import { NoDataPolicy } from "Common/Types/Monitor/CriteriaFilter";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorType from "Common/Types/Monitor/MonitorType";
import {
  FOLDED_SECTION_OFF,
  FOLDED_SECTION_ON,
  FoldedSectionItem,
  foldedSectionItem,
} from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * What the monitor form's "More fields" sections hold, as their folded
 * headers list it (FoldedSection): the fields by the titles they have inside
 * the section, and the ones that are set as chips that say what they are
 * set to. A monitor's request options, a rule's incident and alert options,
 * a metric filter's "If No Data" - each folded under More fields, like every
 * form's rarely needed fields (Forms/Utils/AdvancedFormSection), so a reader
 * knows what is inside, and whether anything there is in force, without
 * opening it.
 *
 * Kept free of React so the form and App/Tests read these exact titles.
 * They are the titles the fields have inside the sections, so a folded
 * header and the open section name a field the same way.
 */

export const MonitorMoreFieldsTitles: {
  requestHeaders: string;
  requestBody: string;
  doNotFollowRedirects: string;
  allowSelfSignedCertificates: string;
  useClientCertificate: string;
  port: string;
  requestTimeout: string;
  retries: string;
  retryCountOnError: string;
  autoResolveIncident: string;
  showIncidentOnStatusPage: string;
  privateIncident: string;
  autoResolveAlert: string;
  privateAlert: string;
  remediationNotes: string;
  ifNoData: string;
} = {
  requestHeaders: translationKey("Request Headers"),
  requestBody: translationKey("Request Body (in JSON)"),
  doNotFollowRedirects: translationKey("Do not follow redirects"),
  allowSelfSignedCertificates: translationKey("Allow self-signed certificates"),
  useClientCertificate: translationKey("Use client certificate (mTLS)"),
  port: translationKey("Port"),
  requestTimeout: translationKey("Request Timeout (seconds)"),
  retries: translationKey("Retries on Failure"),
  retryCountOnError: translationKey("Retry Count on Error"),
  autoResolveIncident: translationKey("Auto Resolve Incident"),
  showIncidentOnStatusPage: translationKey("Show Incident on Status Page"),
  privateIncident: translationKey("Private Incident"),
  autoResolveAlert: translationKey("Auto Resolve Alert"),
  privateAlert: translationKey("Private Alert"),
  remediationNotes: translationKey("Remediation Notes"),
  ifNoData: translationKey("If No Data"),
};

type SwitchItemFunction = (
  title: string,
  key: string,
  isSet: boolean,
  isOn: boolean,
) => FoldedSectionItem;

// A switch: listed by name, and "On" or "Off" once it is off its default.
const switchItem: SwitchItemFunction = (
  title: string,
  key: string,
  isSet: boolean,
  isOn: boolean,
): FoldedSectionItem => {
  return foldedSectionItem(title, {
    key: key,
    isSet: isSet,
    value: isOn ? FOLDED_SECTION_ON : FOLDED_SECTION_OFF,
    translateValue: true,
  });
};

type TimeoutAndRetryItemsFunction = (
  monitorStep: MonitorStep,
) => Array<FoldedSectionItem>;

// The request timeout and the retries, set when a value is typed.
const getTimeoutAndRetryItems: TimeoutAndRetryItemsFunction = (
  monitorStep: MonitorStep,
): Array<FoldedSectionItem> => {
  const timeoutInMs: number | undefined = monitorStep.data?.requestTimeoutInMs;
  const retryCount: number | undefined | null = monitorStep.data?.retryCount;

  return [
    foldedSectionItem(MonitorMoreFieldsTitles.requestTimeout, {
      key: "requestTimeoutInMs",
      isSet: typeof timeoutInMs === "number",
      value:
        typeof timeoutInMs === "number"
          ? String(Math.round(timeoutInMs / 1000))
          : undefined,
    }),
    foldedSectionItem(MonitorMoreFieldsTitles.retries, {
      key: "retryCount",
      isSet: typeof retryCount === "number",
      value: typeof retryCount === "number" ? String(retryCount) : undefined,
    }),
  ];
};

export type GetMonitorStepMoreFieldsItemsFunction = (data: {
  monitorType: MonitorType;
  monitorStep: MonitorStep;
  // Whether "Use client certificate (mTLS)" is ticked on the form.
  usesClientCertificate: boolean;
}) => Array<FoldedSectionItem>;

/*
 * A monitor step's More fields: what an API, Website, Ping, IP, Port, SSL
 * Certificate or Synthetic monitor folds away, in the order the section
 * shows it. Empty for a monitor type that folds nothing.
 */
export const getMonitorStepMoreFieldsItems: GetMonitorStepMoreFieldsItemsFunction =
  (data: {
    monitorType: MonitorType;
    monitorStep: MonitorStep;
    usesClientCertificate: boolean;
  }): Array<FoldedSectionItem> => {
    const step: MonitorStep = data.monitorStep;
    const headerCount: number = Object.keys(
      step.data?.requestHeaders || {},
    ).length;

    const redirectAndTlsItems: Array<FoldedSectionItem> = [
      switchItem(
        MonitorMoreFieldsTitles.doNotFollowRedirects,
        "doNotFollowRedirects",
        Boolean(step.data?.doNotFollowRedirects),
        true,
      ),
      switchItem(
        MonitorMoreFieldsTitles.allowSelfSignedCertificates,
        "allowSelfSignedCertificates",
        Boolean(step.data?.allowSelfSignedCertificates),
        true,
      ),
      switchItem(
        MonitorMoreFieldsTitles.useClientCertificate,
        "useClientCertificate",
        data.usesClientCertificate ||
          Boolean(step.data?.tlsClientCertificate || step.data?.tlsClientKey),
        true,
      ),
    ];

    switch (data.monitorType) {
      case MonitorType.API:
        return [
          foldedSectionItem(MonitorMoreFieldsTitles.requestHeaders, {
            key: "requestHeaders",
            isSet: headerCount > 0,
            value: String(headerCount),
          }),
          foldedSectionItem(MonitorMoreFieldsTitles.requestBody, {
            key: "requestBody",
            isSet: Boolean(step.data?.requestBody?.trim()),
          }),
          ...redirectAndTlsItems,
          ...getTimeoutAndRetryItems(step),
        ];
      case MonitorType.Website:
        return [...redirectAndTlsItems, ...getTimeoutAndRetryItems(step)];
      case MonitorType.Ping:
      case MonitorType.IP:
      case MonitorType.Port:
      case MonitorType.SSLCertificate:
        return getTimeoutAndRetryItems(step);
      // An NTP server's port is optional (123), so it waits here too.
      case MonitorType.NTP: {
        const port: string | undefined =
          step.data?.monitorDestinationPort?.toString();

        return [
          foldedSectionItem(MonitorMoreFieldsTitles.port, {
            key: "monitorDestinationPort",
            isSet: Boolean(port),
            value: port,
          }),
          ...getTimeoutAndRetryItems(step),
        ];
      }
      case MonitorType.SyntheticMonitor: {
        const retries: number | undefined = step.data?.retryCountOnError;

        return [
          foldedSectionItem(MonitorMoreFieldsTitles.retryCountOnError, {
            key: "retryCountOnError",
            isSet: typeof retries === "number" && retries > 0,
            value: typeof retries === "number" ? String(retries) : undefined,
          }),
        ];
      }
      default:
        return [];
    }
  };

/*
 * A monitor rule's incident More fields. Only a choice that differs from
 * what a new rule starts with is set (CriteriaAdvancedOptions): every
 * default rule turns auto-resolve on, so auto-resolve off is the choice.
 */
export const getIncidentMoreFieldsItems: (
  incident: Pick<
    CriteriaIncident,
    | "autoResolveIncident"
    | "remediationNotes"
    | "showIncidentOnStatusPage"
    | "isPrivate"
  >,
) => Array<FoldedSectionItem> = (
  incident: Pick<
    CriteriaIncident,
    | "autoResolveIncident"
    | "remediationNotes"
    | "showIncidentOnStatusPage"
    | "isPrivate"
  >,
): Array<FoldedSectionItem> => {
  return [
    switchItem(
      MonitorMoreFieldsTitles.autoResolveIncident,
      "autoResolveIncident",
      incident.autoResolveIncident === false,
      false,
    ),
    switchItem(
      MonitorMoreFieldsTitles.showIncidentOnStatusPage,
      "showIncidentOnStatusPage",
      incident.showIncidentOnStatusPage === false,
      false,
    ),
    switchItem(
      MonitorMoreFieldsTitles.privateIncident,
      "isPrivate",
      incident.isPrivate === true,
      true,
    ),
    foldedSectionItem(MonitorMoreFieldsTitles.remediationNotes, {
      key: "remediationNotes",
      isSet: Boolean(incident.remediationNotes?.trim()),
    }),
  ];
};

// A monitor rule's alert More fields, by the same rule.
export const getAlertMoreFieldsItems: (
  alert: Pick<
    CriteriaAlert,
    "autoResolveAlert" | "remediationNotes" | "isPrivate"
  >,
) => Array<FoldedSectionItem> = (
  alert: Pick<
    CriteriaAlert,
    "autoResolveAlert" | "remediationNotes" | "isPrivate"
  >,
): Array<FoldedSectionItem> => {
  return [
    switchItem(
      MonitorMoreFieldsTitles.autoResolveAlert,
      "autoResolveAlert",
      alert.autoResolveAlert === false,
      false,
    ),
    switchItem(
      MonitorMoreFieldsTitles.privateAlert,
      "isPrivate",
      alert.isPrivate === true,
      true,
    ),
    foldedSectionItem(MonitorMoreFieldsTitles.remediationNotes, {
      key: "remediationNotes",
      isSet: Boolean(alert.remediationNotes?.trim()),
    }),
  ];
};

/*
 * One option of a monitor's own form (DNS, DNSSEC, Domain, SQL, Database,
 * External Status Page) that its More fields section holds: a number with
 * the default the form falls back to, or a line of text that is set when
 * typed.
 */
export interface MonitorOptionSpec {
  // The option's key in the monitor step's data.
  key: string;
  // English, as the field is titled inside the section.
  title: string;
  // A number's default: the option is set when it holds another number.
  defaultValue?: number | undefined;
}

export type GetMonitorOptionsMoreFieldsItemsFunction = (
  values: unknown,
  specs: Array<MonitorOptionSpec>,
) => Array<FoldedSectionItem>;

/*
 * A monitor form's More fields, from its data: a number is set when it
 * holds something other than its default, a line of text when it holds
 * anything.
 */
export const getMonitorOptionsMoreFieldsItems: GetMonitorOptionsMoreFieldsItemsFunction =
  (
    values: unknown,
    specs: Array<MonitorOptionSpec>,
  ): Array<FoldedSectionItem> => {
    const record: Record<string, unknown> = (values || {}) as Record<
      string,
      unknown
    >;

    return specs.map((spec: MonitorOptionSpec): FoldedSectionItem => {
      const value: unknown = record[spec.key];

      if (spec.defaultValue !== undefined) {
        const isSet: boolean =
          typeof value === "number" &&
          Number.isFinite(value) &&
          value !== spec.defaultValue;

        return foldedSectionItem(spec.title, {
          key: spec.key,
          isSet: isSet,
          value: isSet ? String(value) : undefined,
        });
      }

      const text: string = typeof value === "string" ? value.trim() : "";

      return foldedSectionItem(spec.title, {
        key: spec.key,
        isSet: text.length > 0,
        value: text.length > 32 ? `${text.slice(0, 31)}…` : text,
      });
    });
  };

const TIMEOUT_TITLE: string = translationKey("Timeout (ms)");
const RETRIES_TITLE: string = translationKey("Retries");
const CONNECTION_TIMEOUT_TITLE: string = translationKey(
  "Connection Timeout (ms)",
);
const STATEMENT_TIMEOUT_TITLE: string = translationKey(
  "Statement Timeout (ms)",
);

// What each monitor form folds under More fields, with the form's defaults.
export const DNS_MONITOR_MORE_FIELDS: Array<MonitorOptionSpec> = [
  { key: "port", title: translationKey("Port"), defaultValue: 53 },
  { key: "timeout", title: TIMEOUT_TITLE, defaultValue: 5000 },
  { key: "retries", title: RETRIES_TITLE, defaultValue: 3 },
];

export const DNSSEC_MONITOR_MORE_FIELDS: Array<MonitorOptionSpec> = [
  {
    key: "signatureExpiryWarningDays",
    title: translationKey("Signature Expiry Warning (days)"),
    defaultValue: 7,
  },
  { key: "timeout", title: TIMEOUT_TITLE, defaultValue: 10000 },
  { key: "retries", title: RETRIES_TITLE, defaultValue: 3 },
];

export const DOMAIN_MONITOR_MORE_FIELDS: Array<MonitorOptionSpec> = [
  { key: "timeout", title: TIMEOUT_TITLE, defaultValue: 10000 },
  { key: "retries", title: RETRIES_TITLE, defaultValue: 3 },
];

export const SQL_MONITOR_MORE_FIELDS: Array<MonitorOptionSpec> = [
  {
    key: "connectionTimeoutInMs",
    title: CONNECTION_TIMEOUT_TITLE,
    defaultValue: 10000,
  },
  {
    key: "statementTimeoutInMs",
    title: STATEMENT_TIMEOUT_TITLE,
    defaultValue: 15000,
  },
  { key: "maxRows", title: translationKey("Max Rows"), defaultValue: 100 },
];

export const DATABASE_MONITOR_MORE_FIELDS: Array<MonitorOptionSpec> = [
  {
    key: "connectionTimeoutInMs",
    title: CONNECTION_TIMEOUT_TITLE,
    defaultValue: 10000,
  },
  {
    key: "statementTimeoutInMs",
    title: STATEMENT_TIMEOUT_TITLE,
    defaultValue: 10000,
  },
];

export const EXTERNAL_STATUS_PAGE_MONITOR_MORE_FIELDS: Array<MonitorOptionSpec> =
  [
    {
      key: "componentGroupName",
      title: translationKey("Component Group Filter"),
    },
    { key: "componentName", title: translationKey("Component Name Filter") },
    { key: "timeout", title: TIMEOUT_TITLE, defaultValue: 10000 },
    { key: "retries", title: RETRIES_TITLE, defaultValue: 3 },
  ];

/*
 * A metric filter's More fields: what happens when the query returns no
 * data. Ignore is what a new filter starts with.
 */
export const getNoDataPolicyMoreFieldsItems: (
  policy: NoDataPolicy | undefined,
) => Array<FoldedSectionItem> = (
  policy: NoDataPolicy | undefined,
): Array<FoldedSectionItem> => {
  return [
    foldedSectionItem(MonitorMoreFieldsTitles.ifNoData, {
      key: "onNoDataPolicy",
      isSet: Boolean(policy) && policy !== NoDataPolicy.Ignore,
      value: policy,
      translateValue: true,
    }),
  ];
};
