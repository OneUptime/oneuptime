import {
  FirstCheckAnswer,
  WEBSITE_DOWN_POLICY_NAME,
  WebsiteAddress,
  WebsiteMonitorSeeds,
  WhoIsToldFacts,
  buildWebsiteMonitor,
  isMonitorCheckingAddress,
  readFirstCheckAnswers,
} from "./WebsiteDownSetup";
import {
  FirstOnCallPolicyCreate,
  buildFirstOnCallPolicy,
} from "Common/Utils/GuidedSetup/OnCallPolicyRecords";
import {
  WEBSITE_MONITOR_SEEDS_MISSING,
  pickWebsiteMonitorSeeds,
} from "Common/Utils/GuidedSetup/WebsiteMonitorRecords";
import { mayAddEveryNewEventRules } from "../../OnCallPolicy/UseEveryNewEventRulesOffer";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import AlertOnCallRule from "Common/Models/DatabaseModels/AlertOnCallRule";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import IncidentOnCallRule from "Common/Models/DatabaseModels/IncidentOnCallRule";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorOwnerUser from "Common/Models/DatabaseModels/MonitorOwnerUser";
import MonitorProbe from "Common/Models/DatabaseModels/MonitorProbe";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleTeam from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleUser from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import { isProjectOnFreePlan } from "../../../Utils/PayAsYouGo";
import BillingPaymentMethod from "Common/Models/DatabaseModels/BillingPaymentMethod";
import { ProbeConnectionStatus } from "Common/Models/DatabaseModels/Probe";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import ExceptionCode from "Common/Types/Exception/ExceptionCode";
import { JSONObject } from "Common/Types/JSON";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ProjectUtil from "Common/UI/Utils/Project";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * THE RECORDS THE WEBSITE-DOWN GUIDED SETUP READS AND WRITES (issue #6804),
 * through the same model API the normal forms use, so every permission,
 * plan limit and default the server applies to Create Monitor and Create
 * On-Call Policy applies here too.
 */

export interface WebsiteDownMonitorRecord {
  id: string;
  name: string;
  monitorSteps: Monitor["monitorSteps"];
  monitoringInterval: string | undefined;
  // How many of its probes must agree; null or undefined is all of them.
  minimumProbeAgreement?: number | null | undefined;
}

export interface FirstCheckState {
  // The enabled probes: the locations the monitor is checked from.
  locationCount: number;
  /*
   * Of those, the connected ones: the probes whose answers the probe
   * agreement counts (MonitorResourceUtil.checkProbeAgreement). A probe
   * whose connection is not known counts as connected, as on the
   * monitor's probes card.
   */
  activeLocationCount: number;
  // What the connected ones answered.
  answers: Array<FirstCheckAnswer>;
}

export interface WebsiteDownPolicyRecord {
  id: string;
  name: string;
  // Who its escalation rules page: people's and teams' names.
  responders: Array<string>;
}

export const mayCreateMonitor: () => boolean = (): boolean => {
  return PermissionGate.check(new Monitor(), ModelAction.Create).isAllowed;
};

// Whether this person may add an owner to a monitor: themselves, here.
export const mayAddMonitorOwner: () => boolean = (): boolean => {
  return PermissionGate.check(new MonitorOwnerUser(), ModelAction.Create)
    .isAllowed;
};

// Whether this person may add a payment method (the billing page's button).
export const mayAddPaymentMethod: () => boolean = (): boolean => {
  return PermissionGate.check(new BillingPaymentMethod(), ModelAction.Create)
    .isAllowed;
};

/*
 * A create the server refused for want of a payment method: 402, Payment
 * Required (PaymentRequiredException).
 */
export const isPaymentRequired: (error: unknown) => boolean = (
  error: unknown,
): boolean => {
  return (
    error instanceof HTTPErrorResponse &&
    error.statusCode === ExceptionCode.PaymentRequiredException
  );
};

/*
 * How many of this person's newest Website and API monitors are read to find
 * one for an address: the one a lost run made is the newest, and a person
 * the guided setup is for has a handful.
 */
export const OWN_MONITORS_READ_LIMIT: number = 100;

export default class WebsiteDownApi {
  /*
   * The statuses and severities a new monitor's default criteria name: the
   * operational and offline statuses, and the most severe live incident and
   * alert severities - what Create Monitor seeds them with.
   */
  public static async loadMonitorSeeds(): Promise<WebsiteMonitorSeeds> {
    const [statuses, incidentSeverities, alertSeverities]: [
      ListResult<MonitorStatus>,
      ListResult<IncidentSeverity>,
      ListResult<AlertSeverity>,
    ] = await Promise.all([
      ModelAPI.getList<MonitorStatus>({
        modelType: MonitorStatus,
        query: {},
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: { _id: true, isOperationalState: true, isOfflineState: true },
        sort: { priority: SortOrder.Ascending },
      }),
      ModelAPI.getList<IncidentSeverity>({
        modelType: IncidentSeverity,
        query: {},
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: { _id: true, isArchived: true },
        sort: { order: SortOrder.Ascending },
      }),
      ModelAPI.getList<AlertSeverity>({
        modelType: AlertSeverity,
        query: {},
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: { _id: true, isArchived: true },
        sort: { order: SortOrder.Ascending },
      }),
    ]);

    // Picked as Ask AI's set_up_website_monitoring picks them (Common).
    const seeds: WebsiteMonitorSeeds | null = pickWebsiteMonitorSeeds({
      statuses: statuses.data,
      incidentSeverities: incidentSeverities.data,
      alertSeverities: alertSeverities.data,
    });

    if (!seeds) {
      throw new Error(WEBSITE_MONITOR_SEEDS_MISSING);
    }

    return seeds;
  }

  // Makes the monitor. Returns its id.
  public static async createMonitor(data: {
    address: WebsiteAddress;
    isApi: boolean;
    translator: Translator;
  }): Promise<string> {
    const seeds: WebsiteMonitorSeeds = await WebsiteDownApi.loadMonitorSeeds();

    const response: HTTPResponse<Monitor> = (await ModelAPI.create<Monitor>({
      model: buildWebsiteMonitor({
        address: data.address,
        isApi: data.isApi,
        seeds: seeds,
        translator: data.translator,
      }),
      modelType: Monitor,
    })) as HTTPResponse<Monitor>;

    const id: string | undefined = response.data?.id?.toString();

    if (!id) {
      throw new Error("The monitor was made, but it can't be shown.");
    }

    return id;
  }

  /*
   * The monitor this person already has for an address (#7059): a Website
   * or API monitor they made that checks it now, the newest first. A run the
   * browser lost - a private window, another device, storage cleared - finds
   * the monitor it made here instead of making a second, and so does a
   * person who starts over with the same address or made one from Create
   * Monitor. Null when they have none. A read that fails throws, so nothing
   * is made on a guess.
   */
  public static async findOwnMonitor(data: {
    address: WebsiteAddress;
    userId: string;
  }): Promise<WebsiteDownMonitorRecord | null> {
    if (!data.userId) {
      return null;
    }

    const monitors: ListResult<Monitor> = await ModelAPI.getList<Monitor>({
      modelType: Monitor,
      query: {
        createdByUserId: new ObjectID(data.userId),
        monitorType: new Includes([MonitorType.Website, MonitorType.API]),
      },
      limit: OWN_MONITORS_READ_LIMIT,
      skip: 0,
      select: {
        _id: true,
        name: true,
        monitorSteps: true,
        monitoringInterval: true,
        minimumProbeAgreement: true,
        isArchived: true,
        disableActiveMonitoring: true,
      },
      sort: { createdAt: SortOrder.Descending },
    });

    const found: Monitor | undefined = monitors.data.find(
      (monitor: Monitor): boolean => {
        return (
          Boolean(monitor.id) &&
          isMonitorCheckingAddress({ monitor: monitor, address: data.address })
        );
      },
    );

    if (!found?.id) {
      return null;
    }

    return {
      id: found.id.toString(),
      name: found.name || "",
      monitorSteps: found.monitorSteps,
      monitoringInterval: found.monitoringInterval,
      minimumProbeAgreement: found.minimumProbeAgreement ?? null,
    };
  }

  // The run's monitor, or null when it is gone.
  public static async loadMonitor(
    id: string,
  ): Promise<WebsiteDownMonitorRecord | null> {
    const monitor: Monitor | null = await ModelAPI.getItem<Monitor>({
      modelType: Monitor,
      id: new ObjectID(id),
      select: {
        _id: true,
        name: true,
        monitorSteps: true,
        monitoringInterval: true,
        minimumProbeAgreement: true,
      },
    });

    if (!monitor?.id) {
      return null;
    }

    return {
      id: monitor.id.toString(),
      name: monitor.name || "",
      monitorSteps: monitor.monitorSteps,
      monitoringInterval: monitor.monitoringInterval,
      minimumProbeAgreement: monitor.minimumProbeAgreement ?? null,
    };
  }

  // What the monitor's probes have found so far.
  public static async loadFirstCheck(
    monitorId: string,
  ): Promise<FirstCheckState> {
    const probes: ListResult<MonitorProbe> =
      await ModelAPI.getList<MonitorProbe>({
        modelType: MonitorProbe,
        query: { monitorId: new ObjectID(monitorId), isEnabled: true },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          _id: true,
          lastMonitoringLog: true,
          probe: { connectionStatus: true },
        },
        sort: {},
      });

    /*
     * A disconnected probe checks nothing, and the probe agreement leaves
     * it out: so does what is said about the answers.
     */
    const active: Array<MonitorProbe> = probes.data.filter(
      (probe: MonitorProbe): boolean => {
        return (
          probe.probe?.connectionStatus !== ProbeConnectionStatus.Disconnected
        );
      },
    );

    return {
      locationCount: probes.data.length,
      activeLocationCount: active.length,
      answers: readFirstCheckAnswers(
        active.map((probe: MonitorProbe) => {
          return probe.lastMonitoringLog;
        }),
      ),
    };
  }

  // What decides who is told: the project's policies and rules, and permissions.
  public static async loadWhoIsToldFacts(): Promise<WhoIsToldFacts> {
    const permissions: Omit<
      WhoIsToldFacts,
      "policyCount" | "incidentRuleCount" | "alertRuleCount"
    > = {
      mayCreatePolicy: PermissionGate.check(
        new OnCallDutyPolicy(),
        ModelAction.Create,
      ).isAllowed,
      mayAddEscalationRules: PermissionGate.check(
        new OnCallDutyPolicyEscalationRule(),
        ModelAction.Create,
      ).isAllowed,
      mayAddRules: mayAddEveryNewEventRules(),
    };

    try {
      const [policyCount, incidentRuleCount, alertRuleCount]: Array<number> =
        await Promise.all([
          ModelAPI.count<OnCallDutyPolicy>({
            modelType: OnCallDutyPolicy,
            query: {},
          }),
          ModelAPI.count<IncidentOnCallRule>({
            modelType: IncidentOnCallRule,
            query: {},
          }),
          ModelAPI.count<AlertOnCallRule>({
            modelType: AlertOnCallRule,
            query: {},
          }),
        ]);

      return {
        ...permissions,
        policyCount: policyCount ?? null,
        incidentRuleCount: incidentRuleCount ?? null,
        alertRuleCount: alertRuleCount ?? null,
      };
    } catch {
      // Unknown counts make nothing: the person is told as the monitor's owner.
      return {
        ...permissions,
        policyCount: null,
        incidentRuleCount: null,
        alertRuleCount: null,
      };
    }
  }

  /*
   * The project's first on-call policy, paging the people and teams picked
   * first, with an incident and an alert on-call rule that run it for every
   * new incident and alert (OnCallDutyPolicyService.create).
   */
  public static async createPolicy(data: {
    userIds: Array<string>;
    teamIds: Array<string>;
  }): Promise<string> {
    // Built as Ask AI's set_up_paging builds it (Common).
    const create: FirstOnCallPolicyCreate = buildFirstOnCallPolicy({
      userIds: data.userIds,
      teamIds: data.teamIds,
    });

    const response: HTTPResponse<OnCallDutyPolicy> =
      (await ModelAPI.create<OnCallDutyPolicy>({
        model: create.policy,
        modelType: OnCallDutyPolicy,
        miscDataProps: create.miscDataProps,
      })) as HTTPResponse<OnCallDutyPolicy>;

    const id: string | undefined = response.data?.id?.toString();

    if (!id) {
      throw new Error("The on-call policy was made, but it can't be shown.");
    }

    return id;
  }

  // The run's policy and who it pages, or null when it is gone.
  public static async loadPolicy(
    id: string,
  ): Promise<WebsiteDownPolicyRecord | null> {
    const policy: OnCallDutyPolicy | null =
      await ModelAPI.getItem<OnCallDutyPolicy>({
        modelType: OnCallDutyPolicy,
        id: new ObjectID(id),
        select: { _id: true, name: true },
      });

    if (!policy?.id) {
      return null;
    }

    const responders: Array<string> = [];

    try {
      const [users, teams]: [
        ListResult<OnCallDutyPolicyEscalationRuleUser>,
        ListResult<OnCallDutyPolicyEscalationRuleTeam>,
      ] = await Promise.all([
        ModelAPI.getList<OnCallDutyPolicyEscalationRuleUser>({
          modelType: OnCallDutyPolicyEscalationRuleUser,
          query: { onCallDutyPolicyId: new ObjectID(id) },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: { _id: true, user: { name: true, email: true } },
          sort: {},
        }),
        ModelAPI.getList<OnCallDutyPolicyEscalationRuleTeam>({
          modelType: OnCallDutyPolicyEscalationRuleTeam,
          query: { onCallDutyPolicyId: new ObjectID(id) },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: { _id: true, team: { name: true } },
          sort: {},
        }),
      ]);

      for (const row of users.data) {
        const name: string =
          row.user?.name?.toString() || row.user?.email?.toString() || "";

        if (name && !responders.includes(name)) {
          responders.push(name);
        }
      }

      for (const row of teams.data) {
        const name: string = row.team?.name || "";

        if (name && !responders.includes(name)) {
          responders.push(name);
        }
      }
    } catch {
      // The summary then names the policy alone.
    }

    return {
      id: policy.id.toString(),
      name: policy.name || WEBSITE_DOWN_POLICY_NAME,
      responders: responders,
    };
  }

  public static async loadIncidentSeverityName(
    id: string | null,
  ): Promise<string | null> {
    if (!id) {
      return null;
    }

    try {
      const severity: IncidentSeverity | null =
        await ModelAPI.getItem<IncidentSeverity>({
          modelType: IncidentSeverity,
          id: new ObjectID(id),
          select: { _id: true, name: true },
        });

      return severity?.name || null;
    } catch {
      return null;
    }
  }

  /*
   * Makes this person an owner of the monitor the setup goes on with, when
   * they are not one, so the step's "You own this monitor, so you are
   * emailed when it goes down" is true (#7409). The creator of an
   * operational resource is made its owner
   * (DatabaseService.autoOwnerOnCreate) - but never a master admin, and the
   * first person to sign up to a self-hosted server is one. The row is
   * added quietly: it is their own, so nobody is told they were made an
   * owner. Resolves whether they own it now, read back from the records.
   */
  public static async ensureMonitorOwner(data: {
    monitorId: string;
    userId: string;
  }): Promise<boolean> {
    if (!data.userId) {
      return false;
    }

    if (await WebsiteDownApi.isMonitorOwner(data)) {
      return true;
    }

    if (!mayAddMonitorOwner()) {
      return false;
    }

    const owner: MonitorOwnerUser = new MonitorOwnerUser();
    owner.monitorId = new ObjectID(data.monitorId);
    owner.userId = new ObjectID(data.userId);
    owner.isOwnerNotified = true;

    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (projectId) {
      owner.projectId = projectId;
    }

    try {
      await ModelAPI.create<MonitorOwnerUser>({
        model: owner,
        modelType: MonitorOwnerUser,
      });
    } catch {
      // Another tab may have made them one: what the records say decides.
    }

    return await WebsiteDownApi.isMonitorOwner(data);
  }

  /*
   * Whether a monitor this project makes now would be refused for want of
   * a payment method (#7367): on Cloud's Free plan only, as the server asks
   * (PayAsYouGoBillingService.canUsePayAsYouGo, read live by
   * /billing/pay-as-you-go-status). Anywhere else, and when the answer
   * cannot be read, false: the step says nothing it is not sure of, and
   * Start checking's refusal says it then (isPaymentRequired).
   */
  public static async needsPaymentMethod(): Promise<boolean> {
    if (!isProjectOnFreePlan()) {
      return false;
    }

    try {
      const response: HTTPResponse<JSONObject> = await API.get<JSONObject>({
        url: URL.fromString(APP_API_URL.toString()).addRoute(
          "/billing/pay-as-you-go-status",
        ),
        headers: ModelAPI.getCommonHeaders(),
      });

      return response.data?.["isAllowed"] === false;
    } catch {
      return false;
    }
  }

  // Whether this person owns the monitor (its creator does).
  public static async isMonitorOwner(data: {
    monitorId: string;
    userId: string;
  }): Promise<boolean> {
    try {
      const count: number = await ModelAPI.count<MonitorOwnerUser>({
        modelType: MonitorOwnerUser,
        query: {
          monitorId: new ObjectID(data.monitorId),
          userId: new ObjectID(data.userId),
        },
      });

      return count > 0;
    } catch {
      return false;
    }
  }
}
