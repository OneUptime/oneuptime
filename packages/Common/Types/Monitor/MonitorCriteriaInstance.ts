import DatabaseProperty from "../Database/DatabaseProperty";
import BadDataException from "../Exception/BadDataException";
import FilterCondition from "../Filter/FilterCondition";
import { JSONObject, ObjectType } from "../JSON";
import JSONFunctions from "../JSONFunctions";
import ObjectID from "../ObjectID";
import {
  createTranslator,
  DEFAULT_LANGUAGE,
  fillTemplate,
  TemplateValues,
  translationKey,
  Translator,
} from "../Translator";
import Typeof from "../Typeof";
import { CriteriaAlert } from "./CriteriaAlert";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
  EvaluateOverTimeType,
  CriteriaFilterUtil,
} from "./CriteriaFilter";
import { CriteriaIncident } from "./CriteriaIncident";
import CriteriaFilterValues from "./CriteriaFilterValues";
import IncidentGroupingConfig from "./IncomingMonitor/IncidentGroupingConfig";
import MonitorType, { MonitorTypeHelper } from "./MonitorType";
import { DEFAULT_NTP_MAX_CLOCK_OFFSET_IN_MS } from "./NtpMonitor/NtpMonitorUtil";
import { FindOperator } from "typeorm";

export interface MonitorCriteriaInstanceType {
  monitorStatusId: ObjectID | undefined;
  filterCondition: FilterCondition;
  filters: Array<CriteriaFilter>;
  incidents: Array<CriteriaIncident>;
  alerts: Array<CriteriaAlert>;
  name: string;
  description: string;
  changeMonitorStatus?: boolean | undefined;
  createIncidents?: boolean | undefined;
  createAlerts?: boolean | undefined;
  isEnabled?: boolean | undefined;
  /**
   * Incoming Request monitors only: opt-in config to open one incident
   * per distinct value extracted from the webhook payload (e.g. one per
   * Grafana alert name) instead of a single active incident per criteria.
   */
  incidentGrouping?: IncidentGroupingConfig | undefined;
  /**
   * Incoming Email monitors only: every email that matches this criteria
   * opens an incident (and an alert) of its own, even while earlier ones
   * are open, instead of one at a time. A reply is added as a note to what
   * its thread opened while that is open (once it is resolved, a reply opens
   * its own), the same email delivered twice opens one, and automatic
   * replies open none (IncomingEmailOpenForEveryEmail).
   */
  openForEveryEmail?: boolean | undefined;
  id: string;
}

/*
 * The criteria fromJSON gave an id because the JSON had none. A caller that
 * writes criteria without ids - the Terraform provider, or any API client -
 * gets a fresh id on every parse, so on an update that id says nothing about
 * which stored criteria this one is. MonitorStepsIdentityUtil reads this to
 * hand such a criteria the stored criteria's id instead. A WeakSet, so the
 * mark costs nothing, never reaches JSON, and a copy of the criteria (which
 * no longer came from a parse) counts as carrying a real id.
 */
const criteriaWithIdGeneratedOnParse: WeakSet<MonitorCriteriaInstance> =
  new WeakSet<MonitorCriteriaInstance>();

/*
 * The words of a new monitor's default criteria for a caller with no reader:
 * the server, the API, a monitor made from a template. Each sentence is its
 * English template filled with its values as written (fillTemplate), word
 * for word what these defaults have always read - a monitor's name is never
 * taken for a date to put back into English, as an English sentence of a
 * reader's translator does with a date written in the reader's language.
 */
const ENGLISH_WORDS: Translator = {
  ...createTranslator(undefined, DEFAULT_LANGUAGE),
  translateTemplate: (template: string, values?: TemplateValues): string => {
    return fillTemplate(template, values);
  },
};

export default class MonitorCriteriaInstance extends DatabaseProperty {
  /*
   * Whether this criteria's id was made up by fromJSON rather than sent.
   */
  public static isIdGeneratedOnParse(
    criteria: MonitorCriteriaInstance,
  ): boolean {
    return criteriaWithIdGeneratedOnParse.has(criteria);
  }

  /*
   * A criteria opens records when it is switched on to open alerts or
   * incidents and has at least one to open.
   */
  public static opensRecords(criteria: MonitorCriteriaInstanceType): boolean {
    return (
      (Boolean(criteria.createIncidents) &&
        (criteria.incidents || []).length > 0) ||
      (Boolean(criteria.createAlerts) && (criteria.alerts || []).length > 0)
    );
  }

  /*
   * Keyword the out-of-the-box criteria for the two incoming monitor types
   * (Incoming Request and Incoming Email) look for in the payload body.
   *
   * These monitors are driven by whatever the sender pushes, so the default
   * that is useful to the most people is "the sender told us something broke":
   * a body carrying this keyword takes the monitor offline and opens an
   * incident, a body without it puts the monitor back online. Users who want
   * a dead-man's-switch instead can still add an Incoming Request /
   * Email Received criteria by hand.
   */
  public static readonly DEFAULT_INCOMING_BODY_ERROR_KEYWORD: string = "error";

  /*
   * The HTTP status codes a new Website or API monitor counts as up: every
   * 2xx and 3xx, i.e. from DEFAULT_HEALTHY_STATUS_CODE_FROM up to, but not
   * including, DEFAULT_HEALTHY_STATUS_CODE_BELOW.
   *
   * The probe reports any answer at all as "online", so the status code is
   * what tells a healthy endpoint from a failing one. The defaults used to
   * demand exactly 200, which opened an incident the moment a monitor was
   * created on a health check that answers 201 or 204, or on a redirect
   * watched with "Do not follow redirects" on - none of which is an outage.
   * 4xx and 5xx are still offline.
   */
  public static readonly DEFAULT_HEALTHY_STATUS_CODE_FROM: number = 200;
  public static readonly DEFAULT_HEALTHY_STATUS_CODE_BELOW: number = 400;

  /*
   * How many days before expiry a new SSL Certificate monitor, and a new
   * Domain monitor, raise their "expires soon" alert.
   *
   * Certificates get two weeks: renewal is automated almost everywhere
   * (Let's Encrypt renews with a third of the lifetime left, and lifetimes
   * are shrinking towards 47 days), so a certificate inside its last 14 days
   * is one whose renewal has failed, and 14 days is still time to fix it by
   * hand. Domains get 30: a registration is renewed once a year through a
   * registrar, often with a payment or a contact check in the way, and a
   * lapsed domain takes the website and its email down with it.
   */
  public static readonly DEFAULT_SSL_CERTIFICATE_EXPIRY_WARNING_DAYS: number = 14;
  public static readonly DEFAULT_DOMAIN_EXPIRY_WARNING_DAYS: number = 30;

  /*
   * When a new AI / LLM monitor says the AI is answering badly: more than
   * DEFAULT_LLM_BAD_ANSWER_PERCENT of its answers in the window were bad,
   * and at least DEFAULT_LLM_MIN_BAD_ANSWERS of them. The share is what
   * matters for an AI that answers thousands of times an hour - a few
   * refusals are normal there - and the floor keeps one bad answer out of
   * two from paging anyone at 3 a.m.
   */
  public static readonly DEFAULT_LLM_BAD_ANSWER_PERCENT: number = 5;
  public static readonly DEFAULT_LLM_MIN_BAD_ANSWERS: number = 3;

  public data: MonitorCriteriaInstanceType | undefined = undefined;

  public constructor() {
    super();
    this.data = {
      id: ObjectID.generate().toString(),
      monitorStatusId: undefined,
      filterCondition: FilterCondition.All,
      filters: [
        {
          checkOn: CheckOn.IsOnline,
          /*
           * Seed the condition too, matching
           * getNewMonitorCriteriaInstanceAsJSON. A filter with no filter
           * type shows an empty "Filter Condition" dropdown in the form
           * and never matches anything at evaluation time, because every
           * comparator in CompareCriteria switches on the filter type.
           */
          filterType: FilterType.True,
          value: undefined,
        },
      ],
      createIncidents: false,
      createAlerts: false,
      changeMonitorStatus: false,
      isEnabled: true,
      incidents: [],
      alerts: [],
      name: "",
      description: "",
    };
  }

  /*
   * The words a new monitor's default criteria are written with - every
   * criteria's name and description, and the title and description of each
   * incident and alert it opens - are OneUptime's suggestion to the person
   * creating the monitor. Once saved they are the project's own text, which
   * its people edit like anything they typed. So they are written in that
   * person's language: the Dashboard hands the builders below the reader's
   * Translator, and each sentence is looked up whole, its values ({{days}},
   * {{monitorName}}) filled in after. Filter values, keywords and ids are
   * never translated. Without a translator - the server, the API, a monitor
   * made from a template - every sentence is English, word for word as
   * before (ENGLISH_WORDS).
   *
   * Dashboard/scripts/i18n/ExtractStrings.ts reads this file as a "keys"
   * root: every template passed to translateTemplate, or marked with
   * translationKey, is a key of the Dashboard's locale files.
   *
   * The server writes them in a person's language too, when it makes a
   * monitor for them (Ask AI's set_up_website_monitoring, #7247): this file
   * is one of the server locale set's DASHBOARD_SHARED_TEXT_SOURCES
   * (Common/Scripts/I18n/ServerLocales), so after changing a sentence here
   * and translating it in the Dashboard's files, run
   * `npm run i18n:server-sync` from the repository's root: it copies the
   * Dashboard's wording into Common/Server/Locales, and
   * Tests/Server/Locales/ServerLocales fails until it is run.
   */
  private static getWordsTranslator(
    translator: Translator | undefined,
  ): Translator {
    return translator || ENGLISH_WORDS;
  }

  public static getDefaultOnlineMonitorCriteriaInstance(arg: {
    monitorType: MonitorType;
    monitorStatusId: ObjectID;
    monitorName: string;
    metricOptions?: {
      metricAliases: Array<string>;
    };
    // The reader's, to write the words in their language (getWordsTranslator).
    translator?: Translator | undefined;
  }): MonitorCriteriaInstance | null {
    const translator: Translator = MonitorCriteriaInstance.getWordsTranslator(
      arg.translator,
    );
    const values: TemplateValues = { monitorName: arg.monitorName };

    if (arg.monitorType === MonitorType.IncomingRequest) {
      const monitorCriteriaInstance: MonitorCriteriaInstance =
        new MonitorCriteriaInstance();

      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.All,
        filters: [
          {
            checkOn: CheckOn.RequestBody,
            filterType: FilterType.NotContains,
            value: MonitorCriteriaInstance.DEFAULT_INCOMING_BODY_ERROR_KEYWORD,
          },
        ],
        incidents: [],
        alerts: [],
        createAlerts: false,
        changeMonitorStatus: true,
        createIncidents: false,
        name: translator.translateTemplate(
          "Check if {{monitorName}} is online",
          values,
        ),
        description: translator.translateTemplate(
          'This criteria checks if the request body of {{monitorName}} does not contain "{{keyword}}"',
          {
            ...values,
            keyword:
              MonitorCriteriaInstance.DEFAULT_INCOMING_BODY_ERROR_KEYWORD,
          },
        ),
      };

      return monitorCriteriaInstance;
    }

    if (arg.monitorType === MonitorType.IncomingEmail) {
      const monitorCriteriaInstance: MonitorCriteriaInstance =
        new MonitorCriteriaInstance();

      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.All,
        filters: [
          {
            checkOn: CheckOn.EmailBody,
            filterType: FilterType.NotContains,
            value: MonitorCriteriaInstance.DEFAULT_INCOMING_BODY_ERROR_KEYWORD,
          },
        ],
        incidents: [],
        alerts: [],
        createAlerts: false,
        changeMonitorStatus: true,
        createIncidents: false,
        name: translator.translateTemplate(
          "Check if {{monitorName}} is online",
          values,
        ),
        description: translator.translateTemplate(
          'This criteria checks if the email body of {{monitorName}} does not contain "{{keyword}}"',
          {
            ...values,
            keyword:
              MonitorCriteriaInstance.DEFAULT_INCOMING_BODY_ERROR_KEYWORD,
          },
        ),
      };

      return monitorCriteriaInstance;
    }

    if (arg.monitorType === MonitorType.Llm) {
      const monitorCriteriaInstance: MonitorCriteriaInstance =
        new MonitorCriteriaInstance();

      /*
       * The complement of the offline default below, so every check lands
       * on one of the two: a share of bad answers at or under the limit, or
       * fewer bad answers than the floor, is healthy. A window with no
       * answers at all is healthy too (0%) - quiet is not broken; "the AI
       * stopped answering" is a criteria on AI Answers of its own.
       */
      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.Any,
        filters: [
          {
            checkOn: CheckOn.LlmBadAnswerPercent,
            filterType: FilterType.LessThanOrEqualTo,
            value: MonitorCriteriaInstance.DEFAULT_LLM_BAD_ANSWER_PERCENT,
          },
          {
            checkOn: CheckOn.LlmBadAnswerCount,
            filterType: FilterType.LessThan,
            value: MonitorCriteriaInstance.DEFAULT_LLM_MIN_BAD_ANSWERS,
          },
        ],
        incidents: [],
        alerts: [],
        changeMonitorStatus: true,
        createIncidents: false,
        createAlerts: false,
        name: translator.translateTemplate("AI answers are fine"),
        description: translator.translateTemplate(
          "This criteria checks that no more than {{percent}}% of the answers {{monitorName}} counts were bad",
          {
            ...values,
            percent: MonitorCriteriaInstance.DEFAULT_LLM_BAD_ANSWER_PERCENT,
          },
        ),
      };

      return monitorCriteriaInstance;
    }

    if (arg.monitorType === MonitorType.SecurityEvents) {
      const monitorCriteriaInstance: MonitorCriteriaInstance =
        new MonitorCriteriaInstance();

      /*
       * Inverse of the Logs default on purpose: silence is the healthy
       * state for a security-events monitor. Zero matching events means
       * all clear; matches are what the offline/alerting criteria fires
       * on.
       */
      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.Any,
        filters: [
          {
            checkOn: CheckOn.SecurityEventCount,
            filterType: FilterType.EqualTo,
            value: 0, // no matching security events - all clear.
          },
        ],
        incidents: [],
        alerts: [],
        changeMonitorStatus: true,
        createIncidents: false,
        createAlerts: false,
        name: translator.translateTemplate(
          "Check if {{monitorName}} is clear",
          values,
        ),
        description: translator.translateTemplate(
          "This criteria checks that {{monitorName}} has no matching security events",
          values,
        ),
      };

      return monitorCriteriaInstance;
    }

    if (arg.monitorType === MonitorType.Logs) {
      const monitorCriteriaInstance: MonitorCriteriaInstance =
        new MonitorCriteriaInstance();

      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.Any,
        filters: [
          {
            checkOn: CheckOn.LogCount,
            filterType: FilterType.GreaterThan,
            value: 0, // if there are some logs then monitor is online.
          },
        ],
        incidents: [],
        alerts: [],
        changeMonitorStatus: true,
        createIncidents: false,
        createAlerts: false,
        name: translator.translateTemplate(
          "Check if {{monitorName}} is online",
          values,
        ),
        description: translator.translateTemplate(
          "This criteria checks if the {{monitorName}} is online",
          values,
        ),
      };

      return monitorCriteriaInstance;
    }

    if (arg.monitorType === MonitorType.Exceptions) {
      const monitorCriteriaInstance: MonitorCriteriaInstance =
        new MonitorCriteriaInstance();

      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.Any,
        filters: [
          {
            checkOn: CheckOn.ExceptionCount,
            filterType: FilterType.EqualTo,
            value: 0,
          },
        ],
        incidents: [],
        alerts: [],
        changeMonitorStatus: true,
        createIncidents: false,
        createAlerts: false,
        name: translator.translateTemplate(
          "Check if {{monitorName}} has no exceptions",
          values,
        ),
        description: translator.translateTemplate(
          "This criteria checks if the {{monitorName}} has no exceptions.",
          values,
        ),
      };

      return monitorCriteriaInstance;
    }

    /*
     * An infrastructure monitor (Host, Kubernetes, Docker, Podman, Docker
     * Swarm, Proxmox, VMware, Ceph, Storage Array, IoT Device) is online
     * while its agent sends data: Has Data on the first query, whatever the
     * values. These types used to share the Metrics monitor's pair below,
     * "any value above 0 is online, any value of 0 is offline" - and a
     * metric that is healthy at zero (container restarts, failed job pods,
     * an idle load average) declared "is offline" on a healthy resource,
     * while a resource that stopped sending never went offline at all.
     */
    if (MonitorTypeHelper.isInfrastructureMonitor(arg.monitorType)) {
      const monitorCriteriaInstance: MonitorCriteriaInstance =
        new MonitorCriteriaInstance();

      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.Any,
        filters: [
          {
            checkOn: CheckOn.MetricValue,
            filterType: FilterType.IsNotEmpty,
            metricMonitorOptions: {
              metricAggregationType: EvaluateOverTimeType.AnyValue,
              metricAlias:
                arg.metricOptions &&
                arg.metricOptions.metricAliases &&
                arg.metricOptions.metricAliases.length > 0
                  ? arg.metricOptions.metricAliases[0]
                  : undefined,
            },
            // No threshold: the condition asks whether there is data at all.
            value: undefined,
          },
        ],
        incidents: [],
        alerts: [],
        changeMonitorStatus: true,
        createIncidents: false,
        createAlerts: false,
        name: translator.translateTemplate(
          "Check if {{monitorName}} is online",
          values,
        ),
        description: translator.translateTemplate(
          "This criteria checks if the {{monitorName}} is sending data.",
          values,
        ),
      };

      return monitorCriteriaInstance;
    }

    /*
     * The other metric-backed type, Metrics: MonitorCriteriaEvaluator hands
     * its criteria to MetricMonitorCriteria, which reads exactly one thing -
     * CheckOn.MetricValue: a metric that is reporting a value means online, a
     * metric that has gone to zero means offline. A type missing from the
     * list would fall through to `new MonitorCriteriaInstance()` and ship an
     * unnamed criteria whose "Is Online" filter no evaluator on this path
     * reads - a rule that can never fire and cannot be saved, since
     * getValidationError requires a name.
     */
    if (MonitorTypeHelper.isMetricBackedMonitor(arg.monitorType)) {
      const monitorCriteriaInstance: MonitorCriteriaInstance =
        new MonitorCriteriaInstance();

      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.Any,
        filters: [
          {
            checkOn: CheckOn.MetricValue,
            filterType: FilterType.GreaterThan,

            metricMonitorOptions: {
              metricAggregationType: EvaluateOverTimeType.AnyValue,
              metricAlias:
                arg.metricOptions &&
                arg.metricOptions.metricAliases &&
                arg.metricOptions.metricAliases.length > 0
                  ? arg.metricOptions.metricAliases[0]
                  : undefined,
            },
            value: 0, // the metric is reporting above zero, so the monitor is online.
          },
        ],
        incidents: [],
        alerts: [],
        changeMonitorStatus: true,
        createIncidents: false,
        createAlerts: false,
        name: translator.translateTemplate(
          "Check if {{monitorName}} is online",
          values,
        ),
        description: translator.translateTemplate(
          "This criteria checks if the {{monitorName}} is online",
          values,
        ),
      };

      return monitorCriteriaInstance;
    }

    if (arg.monitorType === MonitorType.Profiles) {
      const monitorCriteriaInstance: MonitorCriteriaInstance =
        new MonitorCriteriaInstance();

      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.Any,
        filters: [
          {
            checkOn: CheckOn.ProfileCount,
            filterType: FilterType.GreaterThan,
            value: 0, // if profiles are arriving then the monitor is online.
          },
        ],
        incidents: [],
        alerts: [],
        changeMonitorStatus: true,
        createIncidents: false,
        createAlerts: false,
        name: translator.translateTemplate(
          "Check if {{monitorName}} is online",
          values,
        ),
        description: translator.translateTemplate(
          "This criteria checks if the {{monitorName}} is online",
          values,
        ),
      };

      return monitorCriteriaInstance;
    }

    if (arg.monitorType === MonitorType.Traces) {
      const monitorCriteriaInstance: MonitorCriteriaInstance =
        new MonitorCriteriaInstance();

      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.Any,
        filters: [
          {
            checkOn: CheckOn.SpanCount,
            filterType: FilterType.GreaterThan,
            value: 0, // if there are some logs then monitor is online.
          },
        ],
        incidents: [],
        alerts: [],
        createAlerts: false,
        changeMonitorStatus: true,
        createIncidents: false,
        name: translator.translateTemplate(
          "Check if {{monitorName}} is online",
          values,
        ),
        description: translator.translateTemplate(
          "This criteria checks if the {{monitorName}} is online",
          values,
        ),
      };

      return monitorCriteriaInstance;
    }

    if (arg.monitorType === MonitorType.SSLCertificate) {
      const monitorCriteriaInstance: MonitorCriteriaInstance =
        new MonitorCriteriaInstance();

      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.All,
        filters: [
          {
            checkOn: CheckOn.IsValidCertificate,
            filterType: FilterType.True,
            value: undefined,
          },
        ],
        incidents: [],
        alerts: [],
        createAlerts: false,
        changeMonitorStatus: true,
        createIncidents: false,
        name: translator.translateTemplate(
          "Check if {{monitorName}} certificate is valid",
          values,
        ),
        description: translator.translateTemplate(
          "This criteria checks if the {{monitorName}} SSL certificate is valid",
          values,
        ),
      };

      return monitorCriteriaInstance;
    }

    if (
      arg.monitorType === MonitorType.CustomJavaScriptCode ||
      arg.monitorType === MonitorType.SyntheticMonitor
    ) {
      const monitorCriteriaInstance: MonitorCriteriaInstance =
        new MonitorCriteriaInstance();

      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.All,
        filters: [
          {
            checkOn: CheckOn.Error,
            filterType: FilterType.IsEmpty,
            value: undefined,
          },
        ],
        incidents: [],
        alerts: [],
        createAlerts: false,
        changeMonitorStatus: true,
        createIncidents: false,
        name: translator.translateTemplate(
          "Check if {{monitorName}} is online",
          values,
        ),
        description: translator.translateTemplate(
          "This criteria checks if the {{monitorName}} is online",
          values,
        ),
      };

      return monitorCriteriaInstance;
    }

    if (arg.monitorType === MonitorType.Server) {
      const monitorCriteriaInstance: MonitorCriteriaInstance =
        new MonitorCriteriaInstance();

      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.All,
        filters: [
          {
            checkOn: CheckOn.IsOnline,
            filterType: FilterType.True,
            value: undefined,
          },
        ],
        incidents: [],
        alerts: [],
        createAlerts: false,
        changeMonitorStatus: true,
        createIncidents: false,
        name: translator.translateTemplate(
          "Check if {{monitorName}} is online",
          values,
        ),
        description: translator.translateTemplate(
          "This criteria checks if the {{monitorName}} is online",
          values,
        ),
      };

      return monitorCriteriaInstance;
    }

    if (
      arg.monitorType === MonitorType.Website ||
      arg.monitorType === MonitorType.API ||
      arg.monitorType === MonitorType.Ping ||
      arg.monitorType === MonitorType.IP ||
      arg.monitorType === MonitorType.Port
    ) {
      const monitorCriteriaInstance: MonitorCriteriaInstance =
        new MonitorCriteriaInstance();

      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.All,
        filters: [
          {
            checkOn: CheckOn.IsOnline,
            filterType: FilterType.True,
            value: undefined,
          },
        ],
        incidents: [],
        alerts: [],
        createAlerts: false,
        changeMonitorStatus: true,
        createIncidents: false,
        name: translator.translateTemplate(
          "Check if {{monitorName}} is online",
          values,
        ),
        description: translator.translateTemplate(
          "This criteria checks if the {{monitorName}} is online",
          values,
        ),
      };

      if (
        arg.monitorType === MonitorType.Website ||
        arg.monitorType === MonitorType.API
      ) {
        /*
         * Up means answering with any 2xx or 3xx status, not exactly 200:
         * see DEFAULT_HEALTHY_STATUS_CODE_FROM. The offline criteria is the
         * exact complement, so every answer lands in one of the two.
         */
        monitorCriteriaInstance.data.filters.push(
          {
            checkOn: CheckOn.ResponseStatusCode,
            filterType: FilterType.GreaterThanOrEqualTo,
            value: MonitorCriteriaInstance.DEFAULT_HEALTHY_STATUS_CODE_FROM,
          },
          {
            checkOn: CheckOn.ResponseStatusCode,
            filterType: FilterType.LessThan,
            value: MonitorCriteriaInstance.DEFAULT_HEALTHY_STATUS_CODE_BELOW,
          },
        );

        monitorCriteriaInstance.data.description = translator.translateTemplate(
          "This criteria checks if the {{monitorName}} is online and responds with a 2xx or 3xx status code",
          values,
        );
      }

      return monitorCriteriaInstance;
    }

    if (arg.monitorType === MonitorType.NetworkDevice) {
      const monitorCriteriaInstance: MonitorCriteriaInstance =
        new MonitorCriteriaInstance();

      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.All,
        filters: [
          {
            checkOn: CheckOn.SnmpIsOnline,
            filterType: FilterType.True,
            value: undefined,
          },
        ],
        incidents: [],
        alerts: [],
        createAlerts: false,
        changeMonitorStatus: true,
        createIncidents: false,
        name: translator.translateTemplate(
          "Check if {{monitorName}} is online",
          values,
        ),
        description: translator.translateTemplate(
          "This criteria checks if the {{monitorName}} SNMP device is online",
          values,
        ),
      };

      return monitorCriteriaInstance;
    }

    if (arg.monitorType === MonitorType.DNS) {
      const monitorCriteriaInstance: MonitorCriteriaInstance =
        new MonitorCriteriaInstance();

      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.All,
        filters: [
          {
            checkOn: CheckOn.DnsIsOnline,
            filterType: FilterType.True,
            value: undefined,
          },
        ],
        incidents: [],
        alerts: [],
        createAlerts: false,
        changeMonitorStatus: true,
        createIncidents: false,
        name: translator.translateTemplate(
          "Check if {{monitorName}} is online",
          values,
        ),
        description: translator.translateTemplate(
          "This criteria checks if the {{monitorName}} DNS resolution is online",
          values,
        ),
      };

      return monitorCriteriaInstance;
    }

    if (arg.monitorType === MonitorType.SQLQuery) {
      const monitorCriteriaInstance: MonitorCriteriaInstance =
        new MonitorCriteriaInstance();

      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.All,
        filters: [
          {
            checkOn: CheckOn.SqlIsOnline,
            filterType: FilterType.True,
            value: undefined,
          },
        ],
        incidents: [],
        alerts: [],
        createAlerts: false,
        changeMonitorStatus: true,
        createIncidents: false,
        name: translator.translateTemplate(
          "Check if {{monitorName}} is online",
          values,
        ),
        description: translator.translateTemplate(
          "This criteria checks if the {{monitorName}} database query ran successfully",
          values,
        ),
      };

      return monitorCriteriaInstance;
    }

    if (arg.monitorType === MonitorType.Database) {
      const monitorCriteriaInstance: MonitorCriteriaInstance =
        new MonitorCriteriaInstance();

      /*
       * Online means one thing only: the probe connected and collected. It
       * deliberately does NOT assert anything about the metrics. A database
       * with a 97% cache hit ratio is not "down", and a monitor that treats
       * every threshold as an outage teaches its operators to ignore it.
       * Metric thresholds ship as templates the user opts into instead.
       */
      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.All,
        filters: [
          {
            checkOn: CheckOn.DatabaseIsOnline,
            filterType: FilterType.True,
            value: undefined,
          },
        ],
        incidents: [],
        alerts: [],
        createAlerts: false,
        changeMonitorStatus: true,
        createIncidents: false,
        name: translator.translateTemplate(
          "Check if {{monitorName}} is online",
          values,
        ),
        description: translator.translateTemplate(
          "This criteria checks if {{monitorName}} is reachable and its health metrics were collected",
          values,
        ),
      };

      return monitorCriteriaInstance;
    }

    if (arg.monitorType === MonitorType.Domain) {
      const monitorCriteriaInstance: MonitorCriteriaInstance =
        new MonitorCriteriaInstance();

      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.All,
        filters: [
          // The registration lookup itself has to have worked.
          {
            checkOn: CheckOn.IsOnline,
            filterType: FilterType.True,
            value: undefined,
          },
          {
            checkOn: CheckOn.DomainIsExpired,
            filterType: FilterType.False,
            value: undefined,
          },
        ],
        incidents: [],
        alerts: [],
        createAlerts: false,
        changeMonitorStatus: true,
        createIncidents: false,
        name: translator.translateTemplate(
          "Check if {{monitorName}} is not expired",
          values,
        ),
        description: translator.translateTemplate(
          "This criteria checks if the {{monitorName}} domain registration was read successfully and is not expired",
          values,
        ),
      };

      return monitorCriteriaInstance;
    }

    if (arg.monitorType === MonitorType.DNSSEC) {
      const monitorCriteriaInstance: MonitorCriteriaInstance =
        new MonitorCriteriaInstance();

      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.All,
        filters: [
          {
            checkOn: CheckOn.DnssecChainValid,
            filterType: FilterType.True,
            value: undefined,
          },
        ],
        incidents: [],
        alerts: [],
        createAlerts: false,
        changeMonitorStatus: true,
        createIncidents: false,
        name: translator.translateTemplate(
          "Check if {{monitorName}} DNSSEC chain is valid",
          values,
        ),
        description: translator.translateTemplate(
          "This criteria checks if the {{monitorName}} DNSSEC chain is valid end-to-end",
          values,
        ),
      };

      return monitorCriteriaInstance;
    }

    if (arg.monitorType === MonitorType.NTP) {
      const monitorCriteriaInstance: MonitorCriteriaInstance =
        new MonitorCriteriaInstance();

      /*
       * Up means serving good time, not merely answering: the server replied,
       * at stratum 1 to 15 without the leap alarm, and its clock is within
       * DEFAULT_NTP_MAX_CLOCK_OFFSET_IN_MS of the probe's. The offline
       * criteria is the exact complement, so every check lands in one of the
       * two.
       */
      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.All,
        filters: [
          {
            checkOn: CheckOn.NtpIsOnline,
            filterType: FilterType.True,
            value: undefined,
          },
          {
            checkOn: CheckOn.NtpIsSynchronized,
            filterType: FilterType.True,
            value: undefined,
          },
          {
            checkOn: CheckOn.NtpClockOffset,
            filterType: FilterType.LessThan,
            value: DEFAULT_NTP_MAX_CLOCK_OFFSET_IN_MS,
          },
        ],
        incidents: [],
        alerts: [],
        createAlerts: false,
        changeMonitorStatus: true,
        createIncidents: false,
        name: translator.translateTemplate(
          "Check if {{monitorName}} serves good time",
          values,
        ),
        description: translator.translateTemplate(
          "This criteria checks if the {{monitorName}} time server answers, is synchronized, and its clock is within {{offset}} ms of the probe's",
          { ...values, offset: DEFAULT_NTP_MAX_CLOCK_OFFSET_IN_MS },
        ),
      };

      return monitorCriteriaInstance;
    }

    if (arg.monitorType === MonitorType.ExternalStatusPage) {
      const monitorCriteriaInstance: MonitorCriteriaInstance =
        new MonitorCriteriaInstance();

      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.All,
        filters: [
          {
            checkOn: CheckOn.ExternalStatusPageIsOnline,
            filterType: FilterType.True,
            value: undefined,
          },
          {
            checkOn: CheckOn.ExternalStatusPageActiveIncidents,
            filterType: FilterType.EqualTo,
            value: 0,
          },
        ],
        incidents: [],
        alerts: [],
        createAlerts: false,
        changeMonitorStatus: true,
        createIncidents: false,
        name: translator.translateTemplate(
          "Check if {{monitorName}} is operational",
          values,
        ),
        description: translator.translateTemplate(
          "This criteria checks if the {{monitorName}} external status page is reachable and has no active incidents",
          values,
        ),
      };

      return monitorCriteriaInstance;
    }

    /*
     * Online while every probe the monitor watches is connected: the exact
     * complement of the offline default below, so every evaluation lands on
     * one of the two.
     */
    if (arg.monitorType === MonitorType.ProbeStatus) {
      const monitorCriteriaInstance: MonitorCriteriaInstance =
        new MonitorCriteriaInstance();

      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.All,
        filters: [
          {
            checkOn: CheckOn.DisconnectedProbes,
            filterType: FilterType.EqualTo,
            value: 0,
          },
        ],
        incidents: [],
        alerts: [],
        createAlerts: false,
        changeMonitorStatus: true,
        createIncidents: false,
        name: translator.translateTemplate("Check if every probe is connected"),
        /*
         * "this monitor", not its name: "every probe Probe health watches"
         * reads as a typo, and a renamed monitor would keep the old name.
         */
        description: translator.translateTemplate(
          "This criteria checks if every probe this monitor watches is connected",
        ),
      };

      return monitorCriteriaInstance;
    }

    return null;
  }

  /*
   * The "expires soon" criteria a new SSL Certificate or Domain monitor
   * starts with, or null for every other monitor type.
   *
   * It is a heads-up, not an outage. It raises an alert, not an incident:
   * nothing shows on a status page and nobody is paged unless an on-call
   * policy is added to it. It leaves the monitor's status alone, because
   * the certificate or the registration still works, so a monitor that was
   * Operational stays Operational. The alert resolves itself once the
   * renewal is picked up, because the online criteria then matches instead.
   *
   * MonitorCriteria.getDefaultMonitorCriteria places it between the offline
   * and the online criteria. Only the first criteria that matches is acted
   * on (MonitorCriteriaEvaluator.processMonitorStep), and a certificate
   * that is valid but about to expire matches the online criteria too, so
   * the warning has to be looked at first. Each one also requires a still
   * valid certificate, or a registration that has not yet expired, so that
   * it never claims an expired one even if the criteria are reordered.
   *
   * alertSeverityId should be the project's "warning" alert severity (the
   * second one, see MonitorRecommendationSeverityMapper), not its most
   * severe one: on a new project that is "Low" rather than "High".
   */
  public static getDefaultWarningMonitorCriteriaInstance(arg: {
    monitorType: MonitorType;
    alertSeverityId: ObjectID;
    monitorName: string;
    // The reader's, to write the words in their language (getWordsTranslator).
    translator?: Translator | undefined;
  }): MonitorCriteriaInstance | null {
    const translator: Translator = MonitorCriteriaInstance.getWordsTranslator(
      arg.translator,
    );
    const values: TemplateValues = { monitorName: arg.monitorName };

    if (arg.monitorType === MonitorType.SSLCertificate) {
      const monitorCriteriaInstance: MonitorCriteriaInstance =
        new MonitorCriteriaInstance();

      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: undefined,
        filterCondition: FilterCondition.All,
        filters: [
          {
            checkOn: CheckOn.IsValidCertificate,
            filterType: FilterType.True,
            value: undefined,
          },
          {
            checkOn: CheckOn.ExpiresInDays,
            filterType: FilterType.LessThanOrEqualTo,
            value:
              MonitorCriteriaInstance.DEFAULT_SSL_CERTIFICATE_EXPIRY_WARNING_DAYS,
          },
        ],
        incidents: [],
        alerts: [
          {
            title: translator.translateTemplate(
              "{{monitorName}} certificate expires soon",
              values,
            ),
            description: translator.translateTemplate(
              "The SSL certificate of {{monitorName}} expires soon. Renew it before it expires, so visitors do not see a certificate error.",
              values,
            ),
            alertSeverityId: arg.alertSeverityId,
            autoResolveAlert: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        changeMonitorStatus: false,
        createIncidents: false,
        createAlerts: true,
        name: translator.translateTemplate(
          "Check if {{monitorName}} certificate expires soon",
          values,
        ),
        description: translator.translateTemplate(
          "This criteria checks if the {{monitorName}} SSL certificate is valid but expires in {{days}} days or less",
          {
            ...values,
            days: MonitorCriteriaInstance.DEFAULT_SSL_CERTIFICATE_EXPIRY_WARNING_DAYS,
          },
        ),
      };

      return monitorCriteriaInstance;
    }

    if (arg.monitorType === MonitorType.Domain) {
      const monitorCriteriaInstance: MonitorCriteriaInstance =
        new MonitorCriteriaInstance();

      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: undefined,
        filterCondition: FilterCondition.All,
        filters: [
          {
            checkOn: CheckOn.DomainIsExpired,
            filterType: FilterType.False,
            value: undefined,
          },
          {
            checkOn: CheckOn.DomainExpiresDaysIn,
            filterType: FilterType.LessThanOrEqualTo,
            value: MonitorCriteriaInstance.DEFAULT_DOMAIN_EXPIRY_WARNING_DAYS,
          },
        ],
        incidents: [],
        alerts: [
          {
            title: translator.translateTemplate(
              "{{monitorName}} domain expires soon",
              values,
            ),
            description: translator.translateTemplate(
              "The registration of {{monitorName}} expires soon. Renew it with your registrar before it expires, or the websites and email that use it stop working.",
              values,
            ),
            alertSeverityId: arg.alertSeverityId,
            autoResolveAlert: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        changeMonitorStatus: false,
        createIncidents: false,
        createAlerts: true,
        name: translator.translateTemplate(
          "Check if {{monitorName}} domain expires soon",
          values,
        ),
        description: translator.translateTemplate(
          "This criteria checks if the {{monitorName}} domain registration expires in {{days}} days or less",
          {
            ...values,
            days: MonitorCriteriaInstance.DEFAULT_DOMAIN_EXPIRY_WARNING_DAYS,
          },
        ),
      };

      return monitorCriteriaInstance;
    }

    return null;
  }

  public static getDefaultOfflineMonitorCriteriaInstance(arg: {
    monitorType: MonitorType;
    monitorStatusId: ObjectID;
    incidentSeverityId: ObjectID;
    alertSeverityId: ObjectID;
    monitorName: string;
    metricOptions?: {
      metricAliases: Array<string>;
    };
    // The reader's, to write the words in their language (getWordsTranslator).
    translator?: Translator | undefined;
  }): MonitorCriteriaInstance {
    const translator: Translator = MonitorCriteriaInstance.getWordsTranslator(
      arg.translator,
    );
    const values: TemplateValues = { monitorName: arg.monitorName };
    const monitorCriteriaInstance: MonitorCriteriaInstance =
      new MonitorCriteriaInstance();

    if (
      arg.monitorType === MonitorType.Ping ||
      arg.monitorType === MonitorType.IP ||
      arg.monitorType === MonitorType.Port ||
      arg.monitorType === MonitorType.Server
    ) {
      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.Any,
        filters: [
          {
            checkOn: CheckOn.IsOnline,
            filterType: FilterType.False,
            value: undefined,
          },
        ],
        incidents: [
          {
            title: translator.translateTemplate(
              "{{monitorName}} is offline",
              values,
            ),
            description: translator.translateTemplate(
              "{{monitorName}} is currently offline.",
              values,
            ),
            incidentSeverityId: arg.incidentSeverityId,
            autoResolveIncident: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        changeMonitorStatus: true,
        createIncidents: true,
        createAlerts: false,
        alerts: [
          {
            title: translator.translateTemplate(
              "{{monitorName}} is offline",
              values,
            ),
            description: translator.translateTemplate(
              "{{monitorName}} is currently offline.",
              values,
            ),
            alertSeverityId: arg.alertSeverityId,
            autoResolveAlert: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        name: translator.translateTemplate(
          "Check if {{monitorName}} is offline",
          values,
        ),
        description: translator.translateTemplate(
          "This criteria checks if the {{monitorName}} is offline",
          values,
        ),
      };
    }

    if (arg.monitorType === MonitorType.NetworkDevice) {
      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.Any,
        filters: [
          {
            checkOn: CheckOn.SnmpIsOnline,
            filterType: FilterType.False,
            value: undefined,
          },
        ],
        incidents: [
          {
            title: translator.translateTemplate(
              "{{monitorName}} is offline",
              values,
            ),
            description: translator.translateTemplate(
              "{{monitorName}} SNMP device is currently offline.",
              values,
            ),
            incidentSeverityId: arg.incidentSeverityId,
            autoResolveIncident: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        changeMonitorStatus: true,
        createIncidents: true,
        createAlerts: false,
        alerts: [
          {
            title: translator.translateTemplate(
              "{{monitorName}} is offline",
              values,
            ),
            description: translator.translateTemplate(
              "{{monitorName}} SNMP device is currently offline.",
              values,
            ),
            alertSeverityId: arg.alertSeverityId,
            autoResolveAlert: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        name: translator.translateTemplate(
          "Check if {{monitorName}} is offline",
          values,
        ),
        description: translator.translateTemplate(
          "This criteria checks if the {{monitorName}} SNMP device is offline",
          values,
        ),
      };
    }

    if (arg.monitorType === MonitorType.DNS) {
      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.Any,
        filters: [
          {
            checkOn: CheckOn.DnsIsOnline,
            filterType: FilterType.False,
            value: undefined,
          },
        ],
        incidents: [
          {
            title: translator.translateTemplate(
              "{{monitorName}} is offline",
              values,
            ),
            description: translator.translateTemplate(
              "{{monitorName}} DNS resolution is currently failing.",
              values,
            ),
            incidentSeverityId: arg.incidentSeverityId,
            autoResolveIncident: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        changeMonitorStatus: true,
        createIncidents: true,
        createAlerts: false,
        alerts: [
          {
            title: translator.translateTemplate(
              "{{monitorName}} is offline",
              values,
            ),
            description: translator.translateTemplate(
              "{{monitorName}} DNS resolution is currently failing.",
              values,
            ),
            alertSeverityId: arg.alertSeverityId,
            autoResolveAlert: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        name: translator.translateTemplate(
          "Check if {{monitorName}} is offline",
          values,
        ),
        description: translator.translateTemplate(
          "This criteria checks if the {{monitorName}} DNS resolution is failing",
          values,
        ),
      };
    }

    if (arg.monitorType === MonitorType.Database) {
      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.Any,
        filters: [
          {
            checkOn: CheckOn.DatabaseIsOnline,
            filterType: FilterType.False,
            value: undefined,
          },
        ],
        incidents: [
          {
            title: translator.translateTemplate(
              "{{monitorName}} is offline",
              values,
            ),
            description: translator.translateTemplate(
              "{{monitorName}} is not reachable, or the health check could not connect.",
              values,
            ),
            incidentSeverityId: arg.incidentSeverityId,
            autoResolveIncident: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        changeMonitorStatus: true,
        createIncidents: true,
        createAlerts: false,
        alerts: [
          {
            title: translator.translateTemplate(
              "{{monitorName}} is offline",
              values,
            ),
            description: translator.translateTemplate(
              "{{monitorName}} is not reachable, or the health check could not connect.",
              values,
            ),
            alertSeverityId: arg.alertSeverityId,
            autoResolveAlert: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        name: translator.translateTemplate(
          "Check if {{monitorName}} is offline",
          values,
        ),
        description: translator.translateTemplate(
          "This criteria checks if {{monitorName}} is offline",
          values,
        ),
      };

      return monitorCriteriaInstance;
    }

    if (arg.monitorType === MonitorType.SQLQuery) {
      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.Any,
        filters: [
          {
            checkOn: CheckOn.SqlIsOnline,
            filterType: FilterType.False,
            value: undefined,
          },
        ],
        incidents: [
          {
            title: translator.translateTemplate(
              "{{monitorName}} is offline",
              values,
            ),
            description: translator.translateTemplate(
              "{{monitorName}} database query is currently failing.",
              values,
            ),
            incidentSeverityId: arg.incidentSeverityId,
            autoResolveIncident: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        changeMonitorStatus: true,
        createIncidents: true,
        createAlerts: false,
        alerts: [
          {
            title: translator.translateTemplate(
              "{{monitorName}} is offline",
              values,
            ),
            description: translator.translateTemplate(
              "{{monitorName}} database query is currently failing.",
              values,
            ),
            alertSeverityId: arg.alertSeverityId,
            autoResolveAlert: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        name: translator.translateTemplate(
          "Check if {{monitorName}} is offline",
          values,
        ),
        description: translator.translateTemplate(
          "This criteria checks if the {{monitorName}} database query is failing",
          values,
        ),
      };
    }

    if (arg.monitorType === MonitorType.Domain) {
      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.Any,
        filters: [
          {
            checkOn: CheckOn.DomainIsExpired,
            filterType: FilterType.True,
            value: undefined,
          },
          /*
           * Without this, a lookup that returns no registration data at all
           * leaves every Domain* filter unable to decide, and the monitor
           * keeps whatever status it had - so a domain whose registration
           * data cannot be read looks exactly like a healthy one.
           */
          {
            checkOn: CheckOn.IsOnline,
            filterType: FilterType.False,
            value: undefined,
          },
        ],
        incidents: [
          {
            title: translator.translateTemplate(
              "{{monitorName}} domain check failed",
              values,
            ),
            description: translator.translateTemplate(
              "{{monitorName}} domain registration has expired, or its registration data could not be retrieved.",
              values,
            ),
            incidentSeverityId: arg.incidentSeverityId,
            autoResolveIncident: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        changeMonitorStatus: true,
        createIncidents: true,
        createAlerts: false,
        alerts: [
          {
            title: translator.translateTemplate(
              "{{monitorName}} domain check failed",
              values,
            ),
            description: translator.translateTemplate(
              "{{monitorName}} domain registration has expired, or its registration data could not be retrieved.",
              values,
            ),
            alertSeverityId: arg.alertSeverityId,
            autoResolveAlert: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        name: translator.translateTemplate(
          "Check if {{monitorName}} domain check failed",
          values,
        ),
        description: translator.translateTemplate(
          "This criteria checks if the {{monitorName}} domain registration has expired or could not be read",
          values,
        ),
      };
    }

    if (arg.monitorType === MonitorType.DNSSEC) {
      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.Any,
        filters: [
          {
            checkOn: CheckOn.DnssecChainValid,
            filterType: FilterType.False,
            value: undefined,
          },
        ],
        incidents: [
          {
            title: translator.translateTemplate(
              "{{monitorName}} DNSSEC chain is broken",
              values,
            ),
            description: translator.translateTemplate(
              "{{monitorName}} DNSSEC validation is currently failing.",
              values,
            ),
            incidentSeverityId: arg.incidentSeverityId,
            autoResolveIncident: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        changeMonitorStatus: true,
        createIncidents: true,
        createAlerts: false,
        alerts: [
          {
            title: translator.translateTemplate(
              "{{monitorName}} DNSSEC chain is broken",
              values,
            ),
            description: translator.translateTemplate(
              "{{monitorName}} DNSSEC validation is currently failing.",
              values,
            ),
            alertSeverityId: arg.alertSeverityId,
            autoResolveAlert: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        name: translator.translateTemplate(
          "Check if {{monitorName}} DNSSEC chain is broken",
          values,
        ),
        description: translator.translateTemplate(
          "This criteria checks if the {{monitorName}} DNSSEC chain is broken",
          values,
        ),
      };
    }

    if (arg.monitorType === MonitorType.NTP) {
      /*
       * Named for the outcome rather than "is offline": a server that
       * answers with stratum 16, or two seconds off, is up and still breaks
       * every clock that follows it. The incident's root cause says which of
       * the three it was.
       */
      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.Any,
        filters: [
          {
            checkOn: CheckOn.NtpIsOnline,
            filterType: FilterType.False,
            value: undefined,
          },
          {
            checkOn: CheckOn.NtpIsSynchronized,
            filterType: FilterType.False,
            value: undefined,
          },
          {
            checkOn: CheckOn.NtpClockOffset,
            filterType: FilterType.GreaterThanOrEqualTo,
            value: DEFAULT_NTP_MAX_CLOCK_OFFSET_IN_MS,
          },
        ],
        incidents: [
          {
            title: translator.translateTemplate(
              "{{monitorName}} is not serving good time",
              values,
            ),
            description: translator.translateTemplate(
              "{{monitorName}} did not answer, is not synchronized, or its clock is {{offset}} ms or more away from the probe's.",
              { ...values, offset: DEFAULT_NTP_MAX_CLOCK_OFFSET_IN_MS },
            ),
            incidentSeverityId: arg.incidentSeverityId,
            autoResolveIncident: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        changeMonitorStatus: true,
        createIncidents: true,
        createAlerts: false,
        alerts: [
          {
            title: translator.translateTemplate(
              "{{monitorName}} is not serving good time",
              values,
            ),
            description: translator.translateTemplate(
              "{{monitorName}} did not answer, is not synchronized, or its clock is {{offset}} ms or more away from the probe's.",
              { ...values, offset: DEFAULT_NTP_MAX_CLOCK_OFFSET_IN_MS },
            ),
            alertSeverityId: arg.alertSeverityId,
            autoResolveAlert: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        name: translator.translateTemplate(
          "Check if {{monitorName}} is not serving good time",
          values,
        ),
        description: translator.translateTemplate(
          "This criteria checks if the {{monitorName}} time server does not answer, is not synchronized, or its clock is {{offset}} ms or more away from the probe's",
          { ...values, offset: DEFAULT_NTP_MAX_CLOCK_OFFSET_IN_MS },
        ),
      };
    }

    if (arg.monitorType === MonitorType.ExternalStatusPage) {
      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.Any,
        filters: [
          {
            checkOn: CheckOn.ExternalStatusPageIsOnline,
            filterType: FilterType.False,
            value: undefined,
          },
          {
            checkOn: CheckOn.ExternalStatusPageActiveIncidents,
            filterType: FilterType.GreaterThan,
            value: 0,
          },
          {
            checkOn: CheckOn.ExternalStatusPageComponentStatus,
            filterType: FilterType.EqualTo,
            value: "degraded_performance",
          },
          {
            checkOn: CheckOn.ExternalStatusPageComponentStatus,
            filterType: FilterType.EqualTo,
            value: "partial_outage",
          },
          {
            checkOn: CheckOn.ExternalStatusPageComponentStatus,
            filterType: FilterType.EqualTo,
            value: "major_outage",
          },
          {
            checkOn: CheckOn.ExternalStatusPageComponentStatus,
            filterType: FilterType.EqualTo,
            value: "full_outage",
          },
        ],
        incidents: [
          {
            title: translator.translateTemplate(
              "{{monitorName}} has an active incident or outage",
              values,
            ),
            description: translator.translateTemplate(
              "{{monitorName}} external status page is reporting an active incident or a non-operational component.",
              values,
            ),
            incidentSeverityId: arg.incidentSeverityId,
            autoResolveIncident: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        changeMonitorStatus: true,
        createIncidents: true,
        createAlerts: false,
        alerts: [
          {
            title: translator.translateTemplate(
              "{{monitorName}} has an active incident or outage",
              values,
            ),
            description: translator.translateTemplate(
              "{{monitorName}} external status page is reporting an active incident or a non-operational component.",
              values,
            ),
            alertSeverityId: arg.alertSeverityId,
            autoResolveAlert: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        name: translator.translateTemplate(
          "Check if {{monitorName}} has an active incident or outage",
          values,
        ),
        description: translator.translateTemplate(
          "This criteria checks if the {{monitorName}} external status page is unreachable, has an active incident, or has a degraded, partial, or major outage",
          values,
        ),
      };
    }

    if (
      arg.monitorType === MonitorType.API ||
      arg.monitorType === MonitorType.Website
    ) {
      /*
       * Offline means unreachable, or answering with a status outside
       * 2xx-3xx: the exact complement of the online criteria, see
       * DEFAULT_HEALTHY_STATUS_CODE_FROM. It used to fire on anything but
       * 200, so a 201, 204 or 301 opened an incident.
       */
      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.Any,
        filters: [
          {
            checkOn: CheckOn.IsOnline,
            filterType: FilterType.False,
            value: undefined,
          },
          {
            checkOn: CheckOn.ResponseStatusCode,
            filterType: FilterType.GreaterThanOrEqualTo,
            value: MonitorCriteriaInstance.DEFAULT_HEALTHY_STATUS_CODE_BELOW,
          },
          {
            checkOn: CheckOn.ResponseStatusCode,
            filterType: FilterType.LessThan,
            value: MonitorCriteriaInstance.DEFAULT_HEALTHY_STATUS_CODE_FROM,
          },
        ],
        alerts: [
          {
            title: translator.translateTemplate(
              "{{monitorName}} is offline",
              values,
            ),
            description: translator.translateTemplate(
              "{{monitorName}} is not responding, or is responding with an error status code.",
              values,
            ),
            alertSeverityId: arg.alertSeverityId,
            autoResolveAlert: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        createAlerts: false,
        incidents: [
          {
            title: translator.translateTemplate(
              "{{monitorName}} is offline",
              values,
            ),
            description: translator.translateTemplate(
              "{{monitorName}} is not responding, or is responding with an error status code.",
              values,
            ),
            incidentSeverityId: arg.incidentSeverityId,
            autoResolveIncident: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        changeMonitorStatus: true,
        createIncidents: true,
        name: translator.translateTemplate(
          "Check if {{monitorName}} is offline",
          values,
        ),
        description: translator.translateTemplate(
          "This criteria checks if the {{monitorName}} is offline or responds with an error status code",
          values,
        ),
      };
    }

    if (arg.monitorType === MonitorType.Llm) {
      /*
       * An alert, not an incident: answers going wrong is a quality
       * problem worth a look, rarely an outage. Teams that want to page on
       * it switch incidents on in the criteria.
       */
      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.All,
        filters: [
          {
            checkOn: CheckOn.LlmBadAnswerPercent,
            filterType: FilterType.GreaterThan,
            value: MonitorCriteriaInstance.DEFAULT_LLM_BAD_ANSWER_PERCENT,
          },
          {
            checkOn: CheckOn.LlmBadAnswerCount,
            filterType: FilterType.GreaterThanOrEqualTo,
            value: MonitorCriteriaInstance.DEFAULT_LLM_MIN_BAD_ANSWERS,
          },
        ],
        incidents: [
          {
            title: translator.translateTemplate(
              "{{monitorName}}: too many bad AI answers",
              values,
            ),
            description: translator.translateTemplate(
              "More than {{percent}}% of the AI's answers were bad.",
              {
                percent: MonitorCriteriaInstance.DEFAULT_LLM_BAD_ANSWER_PERCENT,
              },
            ),
            incidentSeverityId: arg.incidentSeverityId,
            autoResolveIncident: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        alerts: [
          {
            title: translator.translateTemplate(
              "{{monitorName}}: too many bad AI answers",
              values,
            ),
            description: translator.translateTemplate(
              "More than {{percent}}% of the AI's answers were bad.",
              {
                percent: MonitorCriteriaInstance.DEFAULT_LLM_BAD_ANSWER_PERCENT,
              },
            ),
            alertSeverityId: arg.alertSeverityId,
            autoResolveAlert: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        createAlerts: true,
        changeMonitorStatus: true,
        createIncidents: false,
        name: translator.translateTemplate("Too many bad AI answers"),
        description: translator.translateTemplate(
          "This criteria fires when more than {{percent}}% of the answers {{monitorName}} counts, and at least {{minimum}} of them, were bad",
          {
            ...values,
            percent: MonitorCriteriaInstance.DEFAULT_LLM_BAD_ANSWER_PERCENT,
            minimum: MonitorCriteriaInstance.DEFAULT_LLM_MIN_BAD_ANSWERS,
          },
        ),
      };
    }

    if (arg.monitorType === MonitorType.SecurityEvents) {
      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.Any,
        filters: [
          {
            checkOn: CheckOn.SecurityEventCount,
            filterType: FilterType.GreaterThan,
            value: 0, // matching security events were found.
          },
        ],
        incidents: [],
        alerts: [
          {
            title: translator.translateTemplate(
              "{{monitorName}} detected security events",
              values,
            ),
            description: translator.translateTemplate(
              "{{monitorName}} found matching security events.",
              values,
            ),
            alertSeverityId: arg.alertSeverityId,
            autoResolveAlert: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        createAlerts: true,
        changeMonitorStatus: true,
        createIncidents: false,
        name: translator.translateTemplate(
          "Check if {{monitorName}} found security events",
          values,
        ),
        description: translator.translateTemplate(
          "This criteria fires when {{monitorName}} finds matching security events",
          values,
        ),
      };
    }

    if (arg.monitorType === MonitorType.Logs) {
      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.Any,
        filters: [
          {
            checkOn: CheckOn.LogCount,
            filterType: FilterType.EqualTo,
            value: 0, // if there are no logs then the monitor is offline
          },
        ],
        incidents: [
          {
            title: translator.translateTemplate(
              "{{monitorName}} is offline",
              values,
            ),
            description: translator.translateTemplate(
              "{{monitorName}} is currently offline.",
              values,
            ),
            incidentSeverityId: arg.incidentSeverityId,
            autoResolveIncident: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        alerts: [
          {
            title: translator.translateTemplate(
              "{{monitorName}} is offline",
              values,
            ),
            description: translator.translateTemplate(
              "{{monitorName}} is currently offline.",
              values,
            ),
            alertSeverityId: arg.alertSeverityId,
            autoResolveAlert: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        createAlerts: false,
        changeMonitorStatus: true,
        createIncidents: true,
        name: translator.translateTemplate(
          "Check if {{monitorName}} is offline",
          values,
        ),
        description: translator.translateTemplate(
          "This criteria checks if the {{monitorName}} is offline",
          values,
        ),
      };
    }

    if (arg.monitorType === MonitorType.Exceptions) {
      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.Any,
        filters: [
          {
            checkOn: CheckOn.ExceptionCount,
            filterType: FilterType.GreaterThan,
            value: 0,
          },
        ],
        incidents: [
          {
            title: translator.translateTemplate(
              "{{monitorName}} has exceptions",
              values,
            ),
            description: translator.translateTemplate(
              "{{monitorName}} has active exceptions.",
              values,
            ),
            incidentSeverityId: arg.incidentSeverityId,
            autoResolveIncident: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        alerts: [
          {
            title: translator.translateTemplate(
              "{{monitorName}} has exceptions",
              values,
            ),
            description: translator.translateTemplate(
              "{{monitorName}} has active exceptions.",
              values,
            ),
            alertSeverityId: arg.alertSeverityId,
            autoResolveAlert: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        createAlerts: false,
        changeMonitorStatus: true,
        createIncidents: true,
        name: translator.translateTemplate(
          "Check if {{monitorName}} has exceptions",
          values,
        ),
        description: translator.translateTemplate(
          "This criteria checks if the {{monitorName}} has exceptions.",
          values,
        ),
      };
    }

    /*
     * An infrastructure monitor is offline once its agent has sent nothing
     * for the whole window: Has No Data on the first query. A value of 0 is
     * data, so a metric that is healthy at zero no longer opens "is
     * offline" on a healthy resource, and a resource that stopped sending
     * now does. Has No Data also opts the step into absent-series detection
     * (HostAbsenceSeries.monitorStepOptsIntoNoDataDetection).
     */
    if (MonitorTypeHelper.isInfrastructureMonitor(arg.monitorType)) {
      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.Any,
        filters: [
          {
            checkOn: CheckOn.MetricValue,
            filterType: FilterType.IsEmpty,
            metricMonitorOptions: {
              metricAggregationType: EvaluateOverTimeType.AnyValue,
              metricAlias:
                arg.metricOptions &&
                arg.metricOptions.metricAliases &&
                arg.metricOptions.metricAliases.length > 0
                  ? arg.metricOptions.metricAliases[0]
                  : undefined,
            },
            // No threshold: the condition asks whether there is data at all.
            value: undefined,
          },
        ],
        incidents: [
          {
            title: translator.translateTemplate(
              "{{monitorName}} is offline",
              values,
            ),
            description: translator.translateTemplate(
              "{{monitorName}} has sent no data for the whole evaluation window.",
              values,
            ),
            incidentSeverityId: arg.incidentSeverityId,
            autoResolveIncident: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        alerts: [
          {
            title: translator.translateTemplate(
              "{{monitorName}} is offline",
              values,
            ),
            description: translator.translateTemplate(
              "{{monitorName}} has sent no data for the whole evaluation window.",
              values,
            ),
            alertSeverityId: arg.alertSeverityId,
            autoResolveAlert: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        createAlerts: false,
        changeMonitorStatus: true,
        createIncidents: true,
        name: translator.translateTemplate(
          "Check if {{monitorName}} is offline",
          values,
        ),
        description: translator.translateTemplate(
          "This criteria checks if the {{monitorName}} has stopped sending data.",
          values,
        ),
      };
    } else if (MonitorTypeHelper.isMetricBackedMonitor(arg.monitorType)) {
      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.Any,
        filters: [
          {
            checkOn: CheckOn.MetricValue,
            filterType: FilterType.EqualTo,
            metricMonitorOptions: {
              metricAggregationType: EvaluateOverTimeType.AnyValue,
              metricAlias:
                arg.metricOptions &&
                arg.metricOptions.metricAliases &&
                arg.metricOptions.metricAliases.length > 0
                  ? arg.metricOptions.metricAliases[0]
                  : undefined,
            },
            /*
             * A reported value of zero, not an absent one. When the window
             * holds no samples at all the evaluator honours
             * metricMonitorOptions.onNoDataPolicy, which defaults to
             * Ignore, so silence alone does not fire this - a user who
             * wants "stopped reporting" to page has to opt into
             * NoDataPolicy.Trigger or TreatAsZero on the filter.
             */
            value: 0,
          },
        ],
        incidents: [
          {
            title: translator.translateTemplate(
              "{{monitorName}} is offline",
              values,
            ),
            description: translator.translateTemplate(
              "{{monitorName}} is currently offline.",
              values,
            ),
            incidentSeverityId: arg.incidentSeverityId,
            autoResolveIncident: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        alerts: [
          {
            title: translator.translateTemplate(
              "{{monitorName}} is offline",
              values,
            ),
            description: translator.translateTemplate(
              "{{monitorName}} is currently offline.",
              values,
            ),
            alertSeverityId: arg.alertSeverityId,
            autoResolveAlert: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        createAlerts: false,
        changeMonitorStatus: true,
        createIncidents: true,
        name: translator.translateTemplate(
          "Check if {{monitorName}} is offline",
          values,
        ),
        description: translator.translateTemplate(
          "This criteria checks if the {{monitorName}} is offline",
          values,
        ),
      };
    }

    if (arg.monitorType === MonitorType.Profiles) {
      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.Any,
        filters: [
          {
            checkOn: CheckOn.ProfileCount,
            filterType: FilterType.EqualTo,
            value: 0, // if no profiles are arriving then the monitor is offline
          },
        ],
        incidents: [
          {
            title: translator.translateTemplate(
              "{{monitorName}} is offline",
              values,
            ),
            description: translator.translateTemplate(
              "{{monitorName}} is currently offline.",
              values,
            ),
            incidentSeverityId: arg.incidentSeverityId,
            autoResolveIncident: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        alerts: [
          {
            title: translator.translateTemplate(
              "{{monitorName}} is offline",
              values,
            ),
            description: translator.translateTemplate(
              "{{monitorName}} is currently offline.",
              values,
            ),
            alertSeverityId: arg.alertSeverityId,
            autoResolveAlert: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        createAlerts: false,
        changeMonitorStatus: true,
        createIncidents: true,
        name: translator.translateTemplate(
          "Check if {{monitorName}} is offline",
          values,
        ),
        description: translator.translateTemplate(
          "This criteria checks if the {{monitorName}} is offline",
          values,
        ),
      };
    }

    if (arg.monitorType === MonitorType.Traces) {
      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.Any,
        filters: [
          {
            checkOn: CheckOn.SpanCount,
            filterType: FilterType.EqualTo,
            value: 0, // if there are no logs then the monitor is offline
          },
        ],
        alerts: [
          {
            title: translator.translateTemplate(
              "{{monitorName}} is offline",
              values,
            ),
            description: translator.translateTemplate(
              "{{monitorName}} is currently offline.",
              values,
            ),
            alertSeverityId: arg.alertSeverityId,
            autoResolveAlert: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        createAlerts: false,
        incidents: [
          {
            title: translator.translateTemplate(
              "{{monitorName}} is offline",
              values,
            ),
            description: translator.translateTemplate(
              "{{monitorName}} is currently offline.",
              values,
            ),
            incidentSeverityId: arg.incidentSeverityId,
            autoResolveIncident: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        changeMonitorStatus: true,
        createIncidents: true,
        name: translator.translateTemplate(
          "Check if {{monitorName}} is offline",
          values,
        ),
        description: translator.translateTemplate(
          "This criteria checks if the {{monitorName}} is offline",
          values,
        ),
      };
    }

    if (arg.monitorType === MonitorType.IncomingRequest) {
      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.Any,
        filters: [
          {
            /*
             * If the sender reports an error in the request body, the monitor
             * is offline.
             */
            checkOn: CheckOn.RequestBody,
            filterType: FilterType.Contains,
            value: MonitorCriteriaInstance.DEFAULT_INCOMING_BODY_ERROR_KEYWORD,
          },
        ],
        alerts: [
          {
            title: translator.translateTemplate(
              "{{monitorName}} is offline",
              values,
            ),
            description: translator.translateTemplate(
              '{{monitorName}} is currently offline. The request body contains "{{keyword}}".',
              {
                ...values,
                keyword:
                  MonitorCriteriaInstance.DEFAULT_INCOMING_BODY_ERROR_KEYWORD,
              },
            ),
            alertSeverityId: arg.alertSeverityId,
            autoResolveAlert: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        createAlerts: false,
        incidents: [
          {
            title: translator.translateTemplate(
              "{{monitorName}} is offline",
              values,
            ),
            description: translator.translateTemplate(
              '{{monitorName}} is currently offline. The request body contains "{{keyword}}".',
              {
                ...values,
                keyword:
                  MonitorCriteriaInstance.DEFAULT_INCOMING_BODY_ERROR_KEYWORD,
              },
            ),
            incidentSeverityId: arg.incidentSeverityId,
            autoResolveIncident: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        changeMonitorStatus: true,
        createIncidents: true,
        name: translator.translateTemplate(
          "Check if {{monitorName}} is offline",
          values,
        ),
        description: translator.translateTemplate(
          'This criteria checks if the request body of {{monitorName}} contains "{{keyword}}"',
          {
            ...values,
            keyword:
              MonitorCriteriaInstance.DEFAULT_INCOMING_BODY_ERROR_KEYWORD,
          },
        ),
      };
    }

    if (arg.monitorType === MonitorType.IncomingEmail) {
      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.Any,
        filters: [
          {
            /*
             * If the received email reports an error in its body, the monitor
             * is offline.
             */
            checkOn: CheckOn.EmailBody,
            filterType: FilterType.Contains,
            value: MonitorCriteriaInstance.DEFAULT_INCOMING_BODY_ERROR_KEYWORD,
          },
        ],
        alerts: [
          {
            title: translator.translateTemplate(
              "{{monitorName}} is offline",
              values,
            ),
            description: translator.translateTemplate(
              '{{monitorName}} is currently offline. The email body contains "{{keyword}}".',
              {
                ...values,
                keyword:
                  MonitorCriteriaInstance.DEFAULT_INCOMING_BODY_ERROR_KEYWORD,
              },
            ),
            alertSeverityId: arg.alertSeverityId,
            autoResolveAlert: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        createAlerts: false,
        incidents: [
          {
            title: translator.translateTemplate(
              "{{monitorName}} is offline",
              values,
            ),
            description: translator.translateTemplate(
              '{{monitorName}} is currently offline. The email body contains "{{keyword}}".',
              {
                ...values,
                keyword:
                  MonitorCriteriaInstance.DEFAULT_INCOMING_BODY_ERROR_KEYWORD,
              },
            ),
            incidentSeverityId: arg.incidentSeverityId,
            autoResolveIncident: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        changeMonitorStatus: true,
        createIncidents: true,
        name: translator.translateTemplate(
          "Check if {{monitorName}} is offline",
          values,
        ),
        description: translator.translateTemplate(
          'This criteria checks if the email body of {{monitorName}} contains "{{keyword}}"',
          {
            ...values,
            keyword:
              MonitorCriteriaInstance.DEFAULT_INCOMING_BODY_ERROR_KEYWORD,
          },
        ),
      };
    }

    if (
      arg.monitorType === MonitorType.CustomJavaScriptCode ||
      arg.monitorType === MonitorType.SyntheticMonitor
    ) {
      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.Any,
        filters: [
          {
            checkOn: CheckOn.Error,
            filterType: FilterType.IsNotEmpty,
            value: undefined,
          },
        ],
        alerts: [
          {
            title: translator.translateTemplate(
              "{{monitorName}} is offline",
              values,
            ),
            description: translator.translateTemplate(
              "{{monitorName}} is currently offline.",
              values,
            ),
            alertSeverityId: arg.alertSeverityId,
            autoResolveAlert: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        createAlerts: false,
        incidents: [
          {
            title: translator.translateTemplate(
              "{{monitorName}} is offline",
              values,
            ),
            description: translator.translateTemplate(
              "{{monitorName}} is currently offline.",
              values,
            ),
            incidentSeverityId: arg.incidentSeverityId,
            autoResolveIncident: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        changeMonitorStatus: true,
        createIncidents: true,
        name: translator.translateTemplate(
          "Check if {{monitorName}} is offline",
          values,
        ),
        description: translator.translateTemplate(
          "This criteria checks if the {{monitorName}} is offline",
          values,
        ),
      };
    }

    if (arg.monitorType === MonitorType.SSLCertificate) {
      /*
       * Named for what went wrong. "Is Not A Valid Certificate" covers an
       * expired, self-signed or otherwise untrusted certificate, and one
       * that could not be checked because the endpoint did not answer - the
       * incident's root cause says which. "<name> is offline" described none
       * of them.
       */
      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.Any,
        alerts: [
          {
            title: translator.translateTemplate(
              "{{monitorName}} certificate is not valid",
              values,
            ),
            description: translator.translateTemplate(
              "The SSL certificate of {{monitorName}} is not valid, or could not be checked.",
              values,
            ),
            alertSeverityId: arg.alertSeverityId,
            autoResolveAlert: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        createAlerts: false,
        filters: [
          {
            checkOn: CheckOn.IsNotAValidCertificate,
            filterType: FilterType.True,
            value: undefined,
          },
        ],
        incidents: [
          {
            title: translator.translateTemplate(
              "{{monitorName}} certificate is not valid",
              values,
            ),
            description: translator.translateTemplate(
              "The SSL certificate of {{monitorName}} is not valid, or could not be checked.",
              values,
            ),
            incidentSeverityId: arg.incidentSeverityId,
            autoResolveIncident: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        changeMonitorStatus: true,
        createIncidents: true,
        name: translator.translateTemplate(
          "Check if {{monitorName}} certificate is not valid",
          values,
        ),
        description: translator.translateTemplate(
          "This criteria checks if the {{monitorName}} SSL certificate is not valid or could not be checked",
          values,
        ),
      };
    }

    /*
     * One incident for a probe outage, however many monitors the probe
     * runs, resolved by itself once every probe is back (issue #2733). The
     * title names the probes ({{disconnectedProbeNames}}, see
     * MonitorTemplateUtil): "Probe disconnected: EU Probe" is what the person
     * paged needs, where "<monitor> is offline" would only name the watcher.
     */
    if (arg.monitorType === MonitorType.ProbeStatus) {
      monitorCriteriaInstance.data = {
        id: ObjectID.generate().toString(),
        monitorStatusId: arg.monitorStatusId,
        filterCondition: FilterCondition.Any,
        filters: [
          {
            checkOn: CheckOn.DisconnectedProbes,
            filterType: FilterType.GreaterThan,
            value: 0,
          },
        ],
        incidents: [
          {
            title: translator.translateTemplate(
              MonitorCriteriaInstance.PROBE_DISCONNECTED_TITLE,
            ),
            description: translator.translateTemplate(
              MonitorCriteriaInstance.PROBE_DISCONNECTED_DESCRIPTION,
            ),
            incidentSeverityId: arg.incidentSeverityId,
            autoResolveIncident: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        changeMonitorStatus: true,
        createIncidents: true,
        createAlerts: false,
        alerts: [
          {
            title: translator.translateTemplate(
              MonitorCriteriaInstance.PROBE_DISCONNECTED_TITLE,
            ),
            description: translator.translateTemplate(
              MonitorCriteriaInstance.PROBE_DISCONNECTED_DESCRIPTION,
            ),
            alertSeverityId: arg.alertSeverityId,
            autoResolveAlert: true,
            id: ObjectID.generate().toString(),
            onCallPolicyIds: [],
          },
        ],
        name: translator.translateTemplate("Check if a probe is disconnected"),
        description: translator.translateTemplate(
          "This criteria checks if any probe this monitor watches is disconnected",
        ),
      };
    }

    return monitorCriteriaInstance;
  }

  /*
   * The title of the incident and alert a Probe Status monitor opens by
   * default. {{disconnectedProbeNames}} is not filled in here: it is a
   * template variable the incident is created with (MonitorTemplateUtil), so
   * a translation keeps it as it is.
   */
  public static readonly PROBE_DISCONNECTED_TITLE: string = translationKey(
    "Probe disconnected: {{disconnectedProbeNames}}",
  );

  /*
   * What a Probe Status monitor's default incident and alert say. The first
   * line names the probes ({{probeStatusSummary}}); the rest is what it
   * means, what it costs and what happens next, so the person paged knows
   * without reading the docs. It names no monitor: the incident is the
   * monitor's own, and a renamed monitor would keep its old name here.
   * {{probeStatusSummary}} is a template variable too, filled in when the
   * incident is created.
   */
  public static readonly PROBE_DISCONNECTED_DESCRIPTION: string =
    translationKey(
      "{{probeStatusSummary}}\n\nA probe is disconnected when nothing has been heard from it for three minutes. Monitors that run only on a disconnected probe are not checked until it is back. This resolves itself once every probe this monitor watches is connected again.",
    );

  public static getNewMonitorCriteriaInstanceAsJSON(): JSONObject {
    return {
      id: ObjectID.generate().toString(),
      monitorStatusId: undefined,
      filterCondition: FilterCondition.All,
      filters: [
        {
          checkOn: CheckOn.IsOnline,
          filterType: FilterType.True,
          value: undefined,
        },
      ],
      incidents: [],
      name: "",
      description: "",
      createIncidents: false,
      changeMonitorStatus: false,
    };
  }

  public static getValidationError(
    value: MonitorCriteriaInstance,
    monitorType: MonitorType,
  ): string | null {
    if (!value.data) {
      return `Monitor Step is required.`;
    }

    /*
     * The name is what the incidents and alerts a criteria opens say
     * triggered them, so every criteria needs one. Nobody has to make one
     * up: the criteria form names a criteria after its filters until the
     * user types their own. Checked first, so the messages below always
     * have a name to quote.
     *
     * The description is not checked. Nothing reads it but the dashboard,
     * which shows it under the name when there is one, and Terraform has
     * always treated it as optional; demanding it here stopped every new
     * criteria at a field nobody needs.
     */
    if (!value.data.name?.trim()) {
      return `Name is required for every criteria.`;
    }

    if (value.data.filters.length === 0) {
      return `Filter is required for criteria "${value.data.name}"`;
    }

    /*
     * A value no check reads - a condition "GreaterThn", an aggregation
     * "Mean value" - makes a filter that can never match, or reads its
     * window as nothing (CriteriaFilterValues).
     */
    const unreadable: Array<string> = CriteriaFilterValues.getUnreadableErrors({
      criteriaName: value.data.name,
      filterCondition: value.data.filterCondition,
      filters: value.data.filters,
    });

    if (unreadable.length > 0) {
      return unreadable[0]!;
    }

    /*
     * Each "when filters match, ..." action is validated only while its own
     * switch is on.
     *
     * The criteria form keeps the incident / alert rows it seeded when a
     * switch was turned on, so that turning the switch back on restores what
     * was typed - the same retained-but-inert config that
     * MonitorStepsReferenceExtractor documents for project references. The
     * evaluator ignores those rows entirely while the flag is off
     * (MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus,
     * MonitorAlert.criteriaMetCreateAlertsAndUpdateMonitorStatus), so
     * validating them anyway only blocked the form: the row is rendered only
     * while its switch is on, which left the user staring at "Incident title
     * is required" with no field on screen to type it into and no way past
     * Next (issues #3410, #3413).
     *
     * The predicate is the falsy one the evaluator uses, not `!== false`, so
     * a criteria saved before these flags existed - populated rows, no flag -
     * is treated as off here exactly as it already is at runtime.
     *
     * Title and severity are the two fields the form marks required; the
     * description is not one of them. It sits in a collapsed section labelled
     * "Optional incident description" / "Optional alert description", and both
     * Incident.description and Alert.description are nullable columns. So it is
     * not required here either - demanding it stuck the form on a field the UI
     * calls optional and keeps folded away, which is the second half of #3410.
     */
    if (value.data.createIncidents) {
      for (const incident of value.data.incidents) {
        if (!incident) {
          continue;
        }

        if (!incident.title) {
          return `Incident title is required for criteria "${value.data.name}"`;
        }

        if (!incident.incidentSeverityId) {
          return `Incident severity is required for criteria "${value.data.name}"`;
        }
      }
    }

    if (value.data.createAlerts) {
      for (const alert of value.data.alerts) {
        if (!alert) {
          continue;
        }

        if (!alert.title) {
          return `Alert title is required for criteria "${value.data.name}"`;
        }

        if (!alert.alertSeverityId) {
          return `Alert severity is required for criteria "${value.data.name}"`;
        }
      }
    }

    for (const filter of value.data.filters) {
      if (!filter.checkOn) {
        return `Filter Type is required for criteria "${value.data.name}"`;
      }

      /*
       * A filter with no condition is silently dead: every comparator in
       * CompareCriteria switches on the filter type and returns "no
       * match" for one it does not recognise, so the criteria never
       * fires. The empty dropdown is easy to walk past when every field
       * around it is filled in, so refuse the save instead of accepting
       * a rule that can never be true.
       */
      if (!filter.filterType) {
        return `Filter Condition is required for criteria "${value.data.name}" on filter type: ${filter.checkOn}`;
      }

      if (
        monitorType === MonitorType.Ping &&
        filter.checkOn !== CheckOn.IsOnline &&
        filter.checkOn !== CheckOn.ResponseTime &&
        filter.checkOn !== CheckOn.IsRequestTimeout
      ) {
        return "Ping Monitor cannot have filter type: " + filter.checkOn;
      }

      if (
        filter.checkOn === CheckOn.DiskUsagePercent &&
        !filter.serverMonitorOptions?.diskPath
      ) {
        return "Disk Path is required for Disk Usage Percent";
      }

      if (
        CriteriaFilterUtil.hasValueField({
          checkOn: filter.checkOn,
          filterType: filter.filterType,
        })
      ) {
        if (!filter.value && filter.value !== 0) {
          return `Value is required for criteria "${value.data.name}" on filter type: ${filter.checkOn}`;
        }
      }
    }

    return null;
  }

  public setName(name: string): MonitorCriteriaInstance {
    if (this.data) {
      this.data.name = name;
    }

    return this;
  }

  public setDescription(description: string): MonitorCriteriaInstance {
    if (this.data) {
      this.data.description = description;
    }

    return this;
  }

  public static clone(
    monitorCriteriaInstance: MonitorCriteriaInstance,
  ): MonitorCriteriaInstance {
    return MonitorCriteriaInstance.fromJSON(monitorCriteriaInstance.toJSON());
  }

  public setMonitorStatusId(
    monitorStatusId: ObjectID | undefined,
  ): MonitorCriteriaInstance {
    if (this.data) {
      this.data.monitorStatusId = monitorStatusId;
    }

    return this;
  }

  public setFilterCondition(
    filterCondition: FilterCondition,
  ): MonitorCriteriaInstance {
    if (this.data) {
      this.data.filterCondition = filterCondition;
    }

    return this;
  }

  public setFilters(filters: Array<CriteriaFilter>): MonitorCriteriaInstance {
    if (this.data) {
      this.data.filters = filters;
    }

    return this;
  }

  public setIncidents(
    incidents: Array<CriteriaIncident>,
  ): MonitorCriteriaInstance {
    if (this.data) {
      this.data.incidents = [...incidents];
    }

    return this;
  }

  public setAlerts(alerts: Array<CriteriaAlert>): MonitorCriteriaInstance {
    if (this.data) {
      this.data.alerts = [...alerts];
    }

    return this;
  }

  public setChangeMonitorStatus(
    changeMonitorStatus: boolean | undefined,
  ): MonitorCriteriaInstance {
    if (this.data) {
      this.data.changeMonitorStatus = changeMonitorStatus;
    }

    return this;
  }

  public setCreateIncidents(
    createIncidents: boolean | undefined,
  ): MonitorCriteriaInstance {
    if (this.data) {
      this.data.createIncidents = createIncidents;
    }

    return this;
  }

  public setCreateAlerts(
    createAlerts: boolean | undefined,
  ): MonitorCriteriaInstance {
    if (this.data) {
      this.data.createAlerts = createAlerts;
    }

    return this;
  }

  public setIsEnabled(isEnabled: boolean | undefined): MonitorCriteriaInstance {
    if (this.data) {
      this.data.isEnabled = isEnabled;
    }

    return this;
  }

  public setIncidentGrouping(
    incidentGrouping: IncidentGroupingConfig | undefined,
  ): MonitorCriteriaInstance {
    if (this.data) {
      this.data.incidentGrouping = incidentGrouping;
    }

    return this;
  }

  public setOpenForEveryEmail(
    openForEveryEmail: boolean | undefined,
  ): MonitorCriteriaInstance {
    if (this.data) {
      this.data.openForEveryEmail = openForEveryEmail;
    }

    return this;
  }

  /*
   * Whether this criteria opens an incident and an alert for every email
   * that matches it: on an Incoming Email monitor, with the switch on. The
   * switch means nothing on any other monitor, and a criteria copied there
   * with it on is read as off.
   */
  public static isOpenForEveryEmail(input: {
    monitorType: MonitorType | undefined;
    criteriaInstance: MonitorCriteriaInstance | null | undefined;
  }): boolean {
    return (
      input.monitorType === MonitorType.IncomingEmail &&
      input.criteriaInstance?.data?.openForEveryEmail === true
    );
  }

  public override toJSON(): JSONObject {
    if (!this.data) {
      return MonitorCriteriaInstance.getNewMonitorCriteriaInstanceAsJSON();
    }

    return JSONFunctions.serialize({
      _type: ObjectType.MonitorCriteriaInstance,
      value: {
        id: this.data.id,
        monitorStatusId: this.data.monitorStatusId?.toString(),
        filterCondition: this.data.filterCondition,
        filters: this.data.filters,
        incidents: this.data.incidents,
        alerts: this.data.alerts,
        createAlerts: this.data.createAlerts,
        changeMonitorStatus: this.data.changeMonitorStatus,
        createIncidents: this.data.createIncidents,
        isEnabled: this.data.isEnabled,
        incidentGrouping: this.data.incidentGrouping,
        /*
         * Written only when it was set, so a criteria without it - every one
         * saved before it existed - reads and writes as it did. A false the
         * API was sent is kept, so the Terraform provider reads back what it
         * wrote.
         */
        ...(typeof this.data.openForEveryEmail === "boolean"
          ? { openForEveryEmail: this.data.openForEveryEmail }
          : {}),
        name: this.data.name,
        description: this.data.description,
      } as any,
    });
  }

  public static override fromJSON(json: JSONObject): MonitorCriteriaInstance {
    if (json instanceof MonitorCriteriaInstance) {
      return json;
    }

    if (!json) {
      throw new BadDataException("json is null");
    }

    if (!json["_type"]) {
      throw new BadDataException("json._type is null");
    }

    if (json["_type"] !== ObjectType.MonitorCriteriaInstance) {
      throw new BadDataException(
        "json._type should be MonitorCriteriaInstance",
      );
    }

    if (!json["value"]) {
      throw new BadDataException("json.value is null");
    }

    json = json["value"] as JSONObject;

    if (!json["filterCondition"]) {
      throw new BadDataException("json.filterCondition is null");
    }

    if (!json["filters"]) {
      throw new BadDataException("json.filters is null");
    }

    if (!Array.isArray(json["filters"])) {
      throw new BadDataException("json.filters should be an array");
    }

    if (!json["incidents"]) {
      json["incidents"] = [];
    }

    if (!Array.isArray(json["incidents"])) {
      throw new BadDataException("json.incidents should be an array");
    }

    if (!json["alerts"]) {
      json["alerts"] = [];
    }

    if (!Array.isArray(json["alerts"])) {
      throw new BadDataException("json.alerts should be an array");
    }

    let monitorStatusId: ObjectID | undefined = undefined;

    if (
      json["monitorStatusId"] &&
      typeof json["monitorStatusId"] === Typeof.String
    ) {
      monitorStatusId = new ObjectID(json["monitorStatusId"] as string);
    } else if (
      json["monitorStatusId"] &&
      (json["monitorStatusId"] as JSONObject)["value"] !== null
    ) {
      monitorStatusId = new ObjectID(
        (json["monitorStatusId"] as JSONObject)["value"] as string,
      );
    }

    /*
     * A value written another way - "any", "GreaterThan", ">" - is read as
     * the one it means; one that means none is kept as written, for a
     * write to refuse (CriteriaFilterValues).
     */
    const filterCondition: FilterCondition =
      (CriteriaFilterValues.readFilterCondition(json["filterCondition"]) ||
        json["filterCondition"]) as FilterCondition;

    const filters: Array<CriteriaFilter> = [];

    const incidents: Array<CriteriaIncident> = [];

    for (const filter of json["filters"]) {
      filters.push(
        CriteriaFilterValues.readFilter({
          ...(filter as JSONObject),
        }) as unknown as CriteriaFilter,
      );
    }

    for (const incident of json["incidents"]) {
      incidents.push({ ...(incident as any) });
    }

    const alerts: Array<CriteriaAlert> = [];

    for (const alert of json["alerts"]) {
      alerts.push({ ...(alert as any) });
    }

    const monitorCriteriaInstance: MonitorCriteriaInstance =
      new MonitorCriteriaInstance();

    const sentId: string = (json["id"] as string) || "";

    if (!sentId) {
      criteriaWithIdGeneratedOnParse.add(monitorCriteriaInstance);
    }

    monitorCriteriaInstance.data = JSONFunctions.deserialize({
      id: sentId || ObjectID.generate().toString(),
      monitorStatusId,
      filterCondition,
      changeMonitorStatus: (json["changeMonitorStatus"] as boolean) || false,
      createIncidents: (json["createIncidents"] as boolean) || false,
      createAlerts: (json["createAlerts"] as boolean) || false,
      isEnabled:
        json["isEnabled"] === undefined ? true : (json["isEnabled"] as boolean),
      incidentGrouping: (json["incidentGrouping"] as any) || undefined,
      /*
       * A boolean, as sent; anything else is not set at all. Only `true`
       * turns it on (isOpenForEveryEmail).
       */
      ...(typeof json["openForEveryEmail"] === "boolean"
        ? { openForEveryEmail: json["openForEveryEmail"] as boolean }
        : {}),
      filters: filters as any,
      incidents: incidents as any,
      alerts: alerts as any,
      name: (json["name"] as string) || "",
      description: (json["description"] as string) || "",
    }) as any;

    return monitorCriteriaInstance;
  }

  public static isValid(_json: JSONObject): boolean {
    return true;
  }

  protected static override toDatabase(
    value: MonitorCriteriaInstance | FindOperator<MonitorCriteriaInstance>,
  ): JSONObject | null {
    if (value && value instanceof MonitorCriteriaInstance) {
      return (value as MonitorCriteriaInstance).toJSON();
    } else if (value) {
      return JSONFunctions.serialize(value as any);
    }

    return null;
  }

  protected static override fromDatabase(
    value: JSONObject,
  ): MonitorCriteriaInstance | null {
    if (value) {
      return MonitorCriteriaInstance.fromJSON(value);
    }

    return null;
  }

  public override toString(): string {
    return JSON.stringify(this.toJSON());
  }
}
