import {
  FirstCheckAnswer,
  WEBSITE_DOWN_POLICY_NAME,
  WebsiteAddress,
  WebsiteDownStatusPageChoice,
  WebsiteMonitorSeeds,
  WhoIsToldFacts,
  buildWebsiteMonitor,
  isMonitorCheckingAddress,
  readFirstCheckAnswers,
} from "./WebsiteDownSetup";
import StatusPageSetupApi from "../StatusPage/StatusPageSetupApi";
import ProbeUtil from "../../../Utils/Probe";
import MonitorProbeSelectionUtil from "Common/Utils/Monitor/MonitorProbeSelectionUtil";
import Probe, {
  ProbeConnectionStatus,
} from "Common/Models/DatabaseModels/Probe";
import Project from "Common/Models/DatabaseModels/Project";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import {
  FirstOnCallPolicyCreate,
  buildFirstOnCallPolicy,
  countRulesRunningPolicyInService,
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
  /*
   * Archived since the run made it - in another tab, or by a teammate: it
   * pages no one, so the run forgets it (#8432). Unset is in service.
   */
  isArchived?: boolean | undefined;
}

/*
 * A monitor this person may read but did not make, that checks the address
 * (#7254): a teammate's, or one the API, Terraform or an import made. Only
 * ever one the server let them read.
 */
export interface WebsiteDownOtherMonitor {
  id: string;
  name: string;
  // Who made it, when the records name a person; "" when they do not.
  creatorName: string;
}

// What the project-wide look-up found (WebsiteDownApi.findOtherMonitor).
export interface WebsiteDownFoundMonitor extends WebsiteDownOtherMonitor {
  // This person made it after all: the setup goes on with it, as with theirs.
  isOwn: boolean;
  record: WebsiteDownMonitorRecord;
}

export const mayCreateMonitor: () => boolean = (): boolean => {
  return PermissionGate.check(new Monitor(), ModelAction.Create).isAllowed;
};

/*
 * Whether this person may put a monitor on a status page that exists
 * (#7053): read the pages, and add one of them a monitor - what step 4
 * does. Making a page is the status page setup's (mayCreateStatusPage).
 */
export const mayAddToStatusPage: () => boolean = (): boolean => {
  return (
    PermissionGate.check(new StatusPage(), ModelAction.Read).isAllowed &&
    PermissionGate.check(new StatusPageResource(), ModelAction.Create).isAllowed
  );
};

/*
 * Whether this person may use the on-call guided setup (#7370): the rule
 * On-Call's own "Guided setup" button follows (ProductOnboarding's
 * guidedSetup) - one who may create an on-call policy.
 */
export const mayUseOnCallSetup: () => boolean = (): boolean => {
  return PermissionGate.check(new OnCallDutyPolicy(), ModelAction.Create)
    .isAllowed;
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

/*
 * How many of the project's newest Website and API monitors are read to
 * find one a teammate made for an address (#7254). An address is in a
 * monitor's steps, which no query can ask for, so the newest are read and
 * matched here. A project with more than this misses an older one, and
 * the setup then makes a monitor of the person's own, as it did before.
 */
export const OTHER_MONITORS_READ_LIMIT: number = 200;

// How many status pages step 4 reads to offer (#7053).
export const STATUS_PAGES_READ_LIMIT: number = 100;

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

  /*
   * A monitor this person did not make that checks the address now
   * (#7254): a teammate's, or one the API, Terraform or an import made
   * (no person made those). Read through the model API as any list is, so
   * the server hands over only the monitors this person may read: one
   * they may not is never seen here, and nothing says it exists - no
   * count, no name, no sentence. The same matching rule as their own
   * (isMonitorCheckingAddress): archived or turned off is not checking it.
   * Asked only once findOwnMonitor found none of theirs; one of theirs
   * older than its read, found here, is theirs (`isOwn`), and the setup
   * goes on with it. A read that fails throws, so nothing is made on a
   * guess.
   */
  public static async findOtherMonitor(data: {
    address: WebsiteAddress;
    userId: string;
  }): Promise<WebsiteDownFoundMonitor | null> {
    const monitors: ListResult<Monitor> = await ModelAPI.getList<Monitor>({
      modelType: Monitor,
      query: {
        monitorType: new Includes([MonitorType.Website, MonitorType.API]),
      },
      limit: OTHER_MONITORS_READ_LIMIT,
      skip: 0,
      select: {
        _id: true,
        name: true,
        monitorSteps: true,
        monitoringInterval: true,
        minimumProbeAgreement: true,
        isArchived: true,
        disableActiveMonitoring: true,
        createdByUserId: true,
        createdByUser: { name: true },
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

    const record: WebsiteDownMonitorRecord = {
      id: found.id.toString(),
      name: found.name || "",
      monitorSteps: found.monitorSteps,
      monitoringInterval: found.monitoringInterval,
      minimumProbeAgreement: found.minimumProbeAgreement ?? null,
    };

    return {
      id: record.id,
      // A name the reader may not see is the address's host, never blank.
      name: record.name || data.address.host,
      creatorName: found.createdByUser?.name?.toString() || "",
      isOwn:
        Boolean(data.userId) &&
        found.createdByUserId?.toString() === data.userId,
      record: record,
    };
  }

  /*
   * How many locations a monitor made now would be checked from (#7461):
   * the probes a new monitor starts with, by Create Monitor's own rule
   * (MonitorProbeSelectionUtil, as MonitorService.addDefaultProbesToMonitor
   * applies it) - the project's probes and the global ones that opt in,
   * the global ones left out where the project says so. Null when it
   * cannot be read: step 1 then says no number.
   */
  public static async loadDefaultLocationCount(): Promise<number | null> {
    try {
      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
      const [probes, project]: [Array<Probe>, Project | null] =
        await Promise.all([
          ProbeUtil.getAllProbes(),
          projectId
            ? ModelAPI.getItem<Project>({
                modelType: Project,
                id: projectId,
                select: { doNotAddGlobalProbesByDefaultOnNewMonitors: true },
              }).catch(() => {
                // Unread, the server's default: global probes are added.
                return null;
              })
            : Promise.resolve(null),
        ]);

      return MonitorProbeSelectionUtil.getDefaultSelectedProbeIds({
        probes: probes.map((probe: Probe) => {
          return {
            id: probe._id?.toString() || "",
            isGlobalProbe: Boolean(probe.isGlobalProbe),
            shouldAutoEnableProbeOnNewMonitors: Boolean(
              probe.shouldAutoEnableProbeOnNewMonitors,
            ),
          };
        }),
        doNotAddGlobalProbesByDefaultOnNewMonitors:
          project?.doNotAddGlobalProbesByDefaultOnNewMonitors,
      }).length;
    } catch {
      return null;
    }
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

  /*
   * What decides who is told: the project's policies and rules, and
   * permissions. Only policies in service are counted: an archived one
   * pages no one, so a project whose only policies are archived is one with
   * no policy yet, and the setup makes one (#8234), as the monitor's "When
   * this goes down" and Setup Health count them. So are the on-call rules:
   * one counts only when it runs a policy in service. A rule whose only
   * policies are archived pages no one either, and counted, the setup told
   * such a project its own policies and rules decide, and made nothing
   * (#8433). The rules are read with their policies, one list each.
   */
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
      const [policyCount, incidentRules, alertRules]: [
        number,
        ListResult<IncidentOnCallRule>,
        ListResult<AlertOnCallRule>,
      ] = await Promise.all([
        ModelAPI.count<OnCallDutyPolicy>({
          modelType: OnCallDutyPolicy,
          query: { isArchived: false },
        }),
        ModelAPI.getList<IncidentOnCallRule>({
          modelType: IncidentOnCallRule,
          query: {},
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            onCallDutyPolicies: { _id: true, isArchived: true },
          },
          sort: {},
        }),
        ModelAPI.getList<AlertOnCallRule>({
          modelType: AlertOnCallRule,
          query: {},
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            onCallDutyPolicies: { _id: true, isArchived: true },
          },
          sort: {},
        }),
      ]);

      return {
        ...permissions,
        policyCount: policyCount ?? null,
        incidentRuleCount: incidentRules?.data
          ? countRulesRunningPolicyInService(incidentRules.data)
          : null,
        alertRuleCount: alertRules?.data
          ? countRulesRunningPolicyInService(alertRules.data)
          : null,
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
   * new incident and alert (OnCallDutyPolicyService.create) - named, and
   * its rules too, in the language of the person setting it up (#7995).
   */
  public static async createPolicy(data: {
    userIds: Array<string>;
    teamIds: Array<string>;
    translator: Translator;
  }): Promise<string> {
    // Built as Ask AI's set_up_paging builds it (Common).
    const create: FirstOnCallPolicyCreate = buildFirstOnCallPolicy({
      userIds: data.userIds,
      teamIds: data.teamIds,
      translator: data.translator,
      language: data.translator.language,
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

  /*
   * The run's policy, who it pages and whether it is archived - there, but
   * paging no one (#8432) - or null when it is gone.
   */
  public static async loadPolicy(
    id: string,
  ): Promise<WebsiteDownPolicyRecord | null> {
    const policy: OnCallDutyPolicy | null =
      await ModelAPI.getItem<OnCallDutyPolicy>({
        modelType: OnCallDutyPolicy,
        id: new ObjectID(id),
        select: { _id: true, name: true, isArchived: true },
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
      isArchived: Boolean(policy.isArchived),
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
   * STEP 4, SHOW IT TO CUSTOMERS? (#7053): the project's status pages, by
   * name, that the server lets this person read - none archived, as an
   * archived page is offline. Asked only of someone who may put a monitor
   * on one (mayAddToStatusPage).
   */
  public static async loadStatusPages(): Promise<
    Array<WebsiteDownStatusPageChoice>
  > {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    const pages: ListResult<StatusPage> = await ModelAPI.getList<StatusPage>({
      modelType: StatusPage,
      query: projectId ? { projectId: projectId } : {},
      limit: STATUS_PAGES_READ_LIMIT,
      skip: 0,
      select: { _id: true, name: true, isArchived: true },
      sort: { name: SortOrder.Ascending },
    });

    return pages.data
      .filter((page: StatusPage): boolean => {
        return Boolean(page._id) && !page.isArchived;
      })
      .map((page: StatusPage): WebsiteDownStatusPageChoice => {
        return { id: page._id!.toString(), name: page.name || "" };
      });
  }

  /*
   * The page of `statusPages` that shows the monitor, read from the records:
   * the one the run put it on, if it still does, else the first that does.
   * Null when none does - so a monitor already on a page makes the step
   * done, and nothing is added twice.
   */
  public static async findStatusPageShowing(data: {
    monitorId: string;
    statusPages: ReadonlyArray<WebsiteDownStatusPageChoice>;
    preferredStatusPageId?: string | undefined;
  }): Promise<WebsiteDownStatusPageChoice | null> {
    if (data.statusPages.length === 0) {
      return null;
    }

    const resources: ListResult<StatusPageResource> =
      await ModelAPI.getList<StatusPageResource>({
        modelType: StatusPageResource,
        query: { monitorId: new ObjectID(data.monitorId) },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: { _id: true, statusPageId: true },
        sort: {},
      });

    const showing: Set<string> = new Set<string>(
      resources.data
        .map((resource: StatusPageResource): string => {
          return resource.statusPageId?.toString() || "";
        })
        .filter(Boolean),
    );

    const preferred: WebsiteDownStatusPageChoice | undefined =
      data.preferredStatusPageId && showing.has(data.preferredStatusPageId)
        ? data.statusPages.find((page: WebsiteDownStatusPageChoice) => {
            return page.id === data.preferredStatusPageId;
          })
        : undefined;

    return (
      preferred ||
      data.statusPages.find((page: WebsiteDownStatusPageChoice) => {
        return showing.has(page.id);
      }) ||
      null
    );
  }

  /*
   * Puts the monitor on the page as the status page setup does (Add
   * Multiple Monitors' resource, named after the monitor, with its status
   * and uptime), and never twice: a page that lists it already is left as
   * it is. Throws when it could not be added.
   */
  public static async addToStatusPage(data: {
    statusPageId: string;
    monitorId: string;
    monitorName: string;
  }): Promise<void> {
    await StatusPageSetupApi.addMonitors({
      statusPageId: data.statusPageId,
      monitors: [{ id: data.monitorId, name: data.monitorName }],
    });
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
