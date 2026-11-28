import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorTemplate from "../../../Models/DatabaseModels/MonitorTemplate";
import MonitorTemplateChange from "../../../Models/DatabaseModels/MonitorTemplateChange";
import NetworkAlertPolicy from "../../../Models/DatabaseModels/NetworkAlertPolicy";
import NetworkDeviceAutoImportRule from "../../../Models/DatabaseModels/NetworkDeviceAutoImportRule";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import GreaterThan from "../../../Types/BaseDatabase/GreaterThan";
import Includes from "../../../Types/BaseDatabase/Includes";
import LessThan from "../../../Types/BaseDatabase/LessThan";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import { JSONObject } from "../../../Types/JSON";
import {
  ACTIVE_MONITOR_TEMPLATE_CHANGE_STATUSES,
  MAX_MONITORS_PER_TEMPLATE_CHANGE,
  MONITOR_NO_LONGER_THE_POLICYS,
  MONITOR_NOT_REACHED_FAILED,
  MONITOR_NOT_REACHED_STOPPED,
  MONITOR_TEMPLATE_CHANGE_VIEW_LINE_LIMIT,
  MonitorTemplateChangeKind,
  MonitorTemplateChangeLine,
  MonitorTemplateChangeOutcome,
  MonitorTemplateChangeProgress,
  MonitorTemplateChangeResults,
  MonitorTemplateChangeSettings,
  MonitorTemplateChangeStatus,
  MonitorTemplateChangeView,
  MonitorTemplateLinkResult,
  assertMonitorTemplateChangeSettings,
  emptyMonitorTemplateChangeProgress,
  getRetryableMonitorIds,
  isMonitorTemplateChangeActive,
  readMonitorTemplateChangeMonitorIds,
  readMonitorTemplateChangeProgress,
  readMonitorTemplateChangeResults,
  readMonitorTemplateChangeSettings,
} from "../../../Types/Monitor/MonitorTemplateChange";
import ObjectID from "../../../Types/ObjectID";
import MonitorTemplateChangeProvenance from "../../../Utils/Monitor/MonitorTemplateChangeProvenance";
import Queue, { QueueName } from "../../Infrastructure/Queue";
import Semaphore, { SemaphoreMutex } from "../../Infrastructure/Semaphore";
import MonitorService from "../../Services/MonitorService";
import MonitorTemplateChangeService from "../../Services/MonitorTemplateChangeService";
import MonitorTemplateService from "../../Services/MonitorTemplateService";
import NetworkAlertPolicyEngineService from "../../Services/NetworkAlertPolicyEngineService";
import NetworkAlertPolicyService from "../../Services/NetworkAlertPolicyService";
import NetworkDeviceAutoImportRuleEngineService from "../../Services/NetworkDeviceAutoImportRuleEngineService";
import NetworkDeviceAutoImportRuleService from "../../Services/NetworkDeviceAutoImportRuleService";
import QueryHelper from "../../Types/Database/QueryHelper";
import DatabaseRequestType from "../../Types/BaseDatabase/DatabaseRequestType";
import TablePermission from "../../Types/Database/Permissions/TablePermission";
import CallerPlan from "../Billing/CallerPlan";
import logger, { LogAttributes } from "../Logger";
import WorkspaceActionAuthorization from "../Workspace/WorkspaceActionAuthorization";

/*
 * CHANGING MANY MONITORS' TEMPLATE, ON THE SERVER (OneUptime issues #11260,
 * #11266).
 *
 *   start    the dialog asks for a change: the monitors, and what to do -
 *            link them to a template (with its settings or not), or unlink
 *            them (keeping their settings or clearing the template's
 *            criteria), and, for a template's Delete, delete it once its
 *            monitors are unlinked. What can be refused is refused here, at
 *            once and in one sentence - no right to change monitors, a
 *            template the person cannot read, a delete a rule or a policy
 *            would refuse - and the change is recorded and queued.
 *   (worker) changes each monitor, acting as the person, through the same
 *            link and unlink a single monitor goes through
 *            (MonitorTemplateService), and writes how far it got and every
 *            monitor it left out, with why, as it goes - so the dialog shows
 *            progress anyone can trust, and a person who closed it sees
 *            where the change stands when they come back.
 *   stop     stops it before its next monitor; what it changed stays.
 *   retry    a new change of the monitors that failed or were not reached,
 *            and only those. Nothing is done twice: a monitor linked to the
 *            template already, or linked to none, is as asked.
 *
 * ONE CHANGE OF A PROJECT RUNS AT A TIME, as a project's imports do
 * (DiscoveryImportRunner): the worker's job is "run this project's
 * changes", queued once per project, run under the project's lock, oldest
 * change first. Every monitor's write goes through MonitorService as the
 * person, so a change of 10,000 monitors is 10,000 ordinary writes - the
 * permission, the label scope and every check of each - at the pace one
 * worker makes them, with the project's database seeing one change at a
 * time.
 *
 * AS THE PERSON. Each monitor is changed with the person's own permissions,
 * read from the database at the time and again every half a minute, so
 * someone who lost the right to change monitors half-way stops changing
 * them half-way. A monitor they may not change is left out, with why.
 *
 * OR AS ONEUPTIME, FOR A NETWORK ALERT POLICY (issue #11452). Pointing a
 * policy at another template moves its monitors there: the policy's save
 * starts a change of them (startForAlertPolicy) that links each to the
 * template with its criteria, interval and probe agreement, as OneUptime -
 * the policy's monitors are OneUptime's to keep in step with its template,
 * whoever saved it, an API key and Terraform included - so every one keeps
 * its history, labels, owners and incidents, and stays the policy's. One a
 * person moved or unlinked meanwhile is the person's, and is left out. Once
 * every one is moved, the policy's Template Synced says so.
 *
 * FOR AN AUTO IMPORT RULE (issue #11451). Pointing a rule at another template
 * can move its devices' monitors there first: a person's change of the
 * monitors the rule's devices have from the template it uses
 * (readAutoImportRuleMonitorIds), and once every one of them is on the new
 * template, the rule is pointed at it, as the person - so the rule finds
 * every device covered, and makes nothing new beside its old monitor. A
 * monitor the rule made meanwhile is picked up before the rule is pointed.
 */

export const MONITOR_TEMPLATE_CHANGE_JOB: string =
  "MonitorTemplate:RunTemplateChanges";

// The worker's limit for one job; a job hands over to a fresh one before it.
export const MONITOR_TEMPLATE_CHANGE_JOB_TIMEOUT_MS: number = 60 * 60 * 1000;

/*
 * How long one job works before it queues a fresh job to carry on and ends,
 * well inside the worker's limit, so a long change is never killed mid-way.
 */
export const MONITOR_TEMPLATE_CHANGE_JOB_BUDGET_MS: number = 45 * 60 * 1000;

/*
 * A Running change that has written nothing for this long has lost its
 * worker (a deploy, a crash): the sweep picks it up again where it stopped.
 * A healthy one writes every couple of seconds.
 */
export const MONITOR_TEMPLATE_CHANGE_STALE_RUNNING_MS: number = 5 * 60 * 1000;

// A Queued change whose job never ran is queued again after this long.
export const MONITOR_TEMPLATE_CHANGE_STALE_QUEUED_MS: number = 2 * 60 * 1000;

/*
 * How many times one change is picked up again before it is failed instead:
 * a change that kills its worker every time it runs must not do it for ever.
 */
export const MAX_MONITOR_TEMPLATE_CHANGE_RESUMES: number = 3;

// A change still waiting to start after this long is failed.
export const MONITOR_TEMPLATE_CHANGE_MAX_QUEUED_MS: number = 6 * 60 * 60 * 1000;

// Progress is written at most this often while monitors are changed.
export const MONITOR_TEMPLATE_CHANGE_FLUSH_INTERVAL_MS: number = 1500;

// Whether someone asked the change to stop is read at most this often.
export const MONITOR_TEMPLATE_CHANGE_STOP_CHECK_INTERVAL_MS: number = 1500;

/*
 * How long the person's permissions are trusted before they are read again,
 * so a permission taken away during a change is held to within this long.
 */
export const MONITOR_TEMPLATE_CHANGE_PERMISSION_REFRESH_MS: number = 30 * 1000;

/*
 * Monitors that may fail with the same reason, one after another and with
 * none changed, before the change stops trying: a template whose criteria
 * name a status that no longer exists fails every monitor the same way. The
 * rest are left not reached, so retrying them after the cause is fixed is
 * one press.
 */
export const MAX_CONSECUTIVE_IDENTICAL_CHANGE_FAILURES: number = 10;

// The longest reason a line keeps.
export const MAX_MONITOR_TEMPLATE_CHANGE_REASON_LENGTH: number = 500;

// Why a monitor was not reached: the shared reasons, worded in every language.
export { MONITOR_NOT_REACHED_FAILED, MONITOR_NOT_REACHED_STOPPED };

const LOCK_NAMESPACE: string = "MonitorTemplateChange";

// Long enough for one monitor's write; a dead holder lets go after this.
const PROJECT_LOCK_TIMEOUT_MS: number = 2 * 60 * 1000;

// How many of the template's monitors one read lists, for a change of them all.
const LINKED_MONITORS_READ_PAGE: number = LIMIT_MAX;

/*
 * How many times an auto import rule's change adds the monitors the rule made
 * while it ran, before it points the rule: a sweep that keeps importing
 * devices must not keep the change going for ever.
 */
export const MAX_AUTO_IMPORT_RULE_APPEND_ROUNDS: number = 3;

// How many of a rule's devices one read of their monitors names.
const RULE_DEVICES_PER_READ: number = 500;

// What a rule is read with, to tell its devices (AutoImportRuleMatcher).
const AUTO_IMPORT_RULE_SELECT: { [key: string]: boolean } = {
  _id: true,
  projectId: true,
  name: true,
  isEnabled: true,
  isExclusion: true,
  monitorTemplateId: true,
  criteria: true,
  ipMatchTarget: true,
  sysNamePattern: true,
  sysDescrPattern: true,
  sysObjectIdPattern: true,
  includePingOnlyHosts: true,
};

/*
 * How far back a finished change still shows on the Monitors list (#11454),
 * when monitors were left out, failed or not reached.
 */
export const MONITOR_TEMPLATE_CHANGE_SHOWN_FOR_MS: number = 60 * 60 * 1000;

// The most changes the Monitors list shows at once.
export const MONITOR_TEMPLATE_CHANGES_SHOWN_LIMIT: number = 10;

export type MonitorTemplateChangeFinish = "done" | "stopped" | "handover";

const WHITESPACE_RUNS: RegExp = /\s+/g;

function toText(error: unknown): string {
  const message: string =
    error instanceof Error ? error.message || "" : String(error ?? "");

  const text: string = message.replace(WHITESPACE_RUNS, " ").trim();

  return (
    text ||
    "The monitor could not be changed. Try again, or ask a Project Admin to check the server's logs."
  ).substring(0, MAX_MONITOR_TEMPLATE_CHANGE_REASON_LENGTH);
}

/*
 * A refusal says what to do and would say it again on a retry: the monitor
 * is left out (Skipped). Anything else might not happen again (Failed).
 */
function isRefusal(error: unknown): boolean {
  return (
    error instanceof BadDataException ||
    error instanceof NotAuthorizedException ||
    error instanceof PaymentRequiredException
  );
}

function isRefusalOfThePerson(error: unknown): boolean {
  return (
    error instanceof NotAuthorizedException ||
    error instanceof PaymentRequiredException
  );
}

// What a worker holds while it changes one change's monitors.
interface ChangeRunState {
  row: MonitorTemplateChange;
  projectId: ObjectID;
  // The person it acts as; none for a network alert policy's change.
  userId: ObjectID | null;
  // A network alert policy's change: as OneUptime, the monitors its own.
  alertPolicyId: ObjectID | null;
  // An auto import rule's change: the rule pointed at the template at the end.
  autoImportRuleId: ObjectID | null;
  // How many times monitors the rule made meanwhile were added to the change.
  appendRounds: number;
  props: DatabaseCommonInteractionProps;
  propsReadAt: number;
  settings: MonitorTemplateChangeSettings;
  template: MonitorTemplate | null;
  monitorIds: Array<string>;
  results: MonitorTemplateChangeResults;
  progress: MonitorTemplateChangeProgress;
  lastFlushAt: number;
  lastStopCheckAt: number;
  lastFailureReason: string;
  consecutiveFailures: number;
}

const CHANGE_SELECT: { [key: string]: boolean } = {
  _id: true,
  projectId: true,
  monitorTemplateId: true,
  monitorTemplateName: true,
  networkAlertPolicyId: true,
  networkAlertPolicyName: true,
  networkDeviceAutoImportRuleId: true,
  networkDeviceAutoImportRuleName: true,
  status: true,
  settings: true,
  monitorIds: true,
  results: true,
  progress: true,
  error: true,
  stopRequestedAt: true,
  resumeCount: true,
  createdByUserId: true,
  createdAt: true,
  updatedAt: true,
  startedAt: true,
  completedAt: true,
};

export default class MonitorTemplateChangeRunner {
  /*
   * The clock the runner reads for its write cadence, its permission
   * refreshes and its time budget. A seam for tests.
   */
  public static now: () => number = (): number => {
    return Date.now();
  };

  // ---- Asking for a change.

  /*
   * Record a change and queue it. `monitorIds` are the monitors picked; or,
   * with `allLinkedToTemplate`, every monitor linked to the template that
   * the person may read - a template's Delete, which clears its criteria
   * from every one of them before it deletes it.
   */
  public static async start(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    monitorTemplateId: unknown;
    settings: unknown;
    monitorIds: unknown;
    allLinkedToTemplate?: unknown;
    /*
     * An auto import rule whose devices' monitors move to the template,
     * after which the rule is pointed at it (#11451): the monitors are the
     * rule's, not picked.
     */
    autoImportRuleId?: unknown;
  }): Promise<MonitorTemplateChange> {
    const userId: ObjectID | undefined = data.props.userId;

    if (!userId) {
      throw new NotAuthorizedException(
        "Changing monitors' template acts as the person who asks for it, so it needs a person signed in to the project.",
      );
    }

    const settings: MonitorTemplateChangeSettings =
      readMonitorTemplateChangeSettings(data.settings);

    const templateId: ObjectID | null = this.readOptionalId(
      data.monitorTemplateId,
      "The template was not found. Reload the page, then try again.",
    );

    assertMonitorTemplateChangeSettings({
      settings: settings,
      hasTemplate: Boolean(templateId),
    });

    this.assertCanChangeMonitors(data.props);

    if (settings.deleteTemplateWhenDone) {
      this.assertCanDeleteTemplates(data.props);
    }

    const template: MonitorTemplate | null = templateId
      ? await MonitorTemplateService.readTemplateToLinkOrUnlink({
          monitorTemplateId: templateId,
          props: data.props,
        })
      : null;

    if (
      template?.projectId &&
      template.projectId.toString() !== data.projectId.toString()
    ) {
      throw new BadDataException(
        "The template was not found. Reload the page, then try again.",
      );
    }

    if (template && settings.deleteTemplateWhenDone) {
      // A delete the template's rules or policies would refuse: said now.
      await MonitorTemplateService.assertNothingProvisionsFrom(template);
    }

    const autoImportRuleId: ObjectID | null = this.readOptionalId(
      data.autoImportRuleId,
      "The auto import rule was not found. Reload the page, then try again.",
    );

    if (autoImportRuleId) {
      if (
        settings.kind !== MonitorTemplateChangeKind.Link ||
        settings.deleteTemplateWhenDone ||
        !template
      ) {
        throw new BadDataException(
          "Only a change that links monitors to a template can move an auto import rule's monitors.",
        );
      }

      const rule: NetworkDeviceAutoImportRule = await this.readRuleToMove({
        projectId: data.projectId,
        ruleId: autoImportRuleId,
        template: template,
        props: data.props,
      });

      return await this.record({
        projectId: data.projectId,
        userId: userId,
        settings: settings,
        template: template,
        monitorIds: await this.readAutoImportRuleMonitorIds({
          projectId: data.projectId,
          rule: rule,
          props: data.props,
          limit: MAX_MONITORS_PER_TEMPLATE_CHANGE,
        }),
        retryOfChangeId: null,
        autoImportRule: { id: rule.id!, name: rule.name || "" },
      });
    }

    const monitorIds: Array<string> =
      data.allLinkedToTemplate === true && template
        ? await this.readLinkedMonitorIds({
            projectId: data.projectId,
            monitorTemplateId: template.id!,
            props: data.props,
          })
        : this.readMonitorIds(data.monitorIds);

    if (monitorIds.length === 0 && !settings.deleteTemplateWhenDone) {
      throw new BadDataException(
        "Select the monitors to change, then try again.",
      );
    }

    return await this.record({
      projectId: data.projectId,
      userId: userId,
      settings: settings,
      template: template,
      monitorIds: monitorIds,
      retryOfChangeId: null,
    });
  }

  /*
   * The rule a person asks to move the monitors of (#11451): one of the
   * project's import rules that gives its devices a monitor from another
   * template of the same kind, with no move of its monitors running. Who
   * asks may edit rules: the change points the rule at the template.
   */
  private static async readRuleToMove(data: {
    projectId: ObjectID;
    ruleId: ObjectID;
    template: MonitorTemplate;
    props: DatabaseCommonInteractionProps;
  }): Promise<NetworkDeviceAutoImportRule> {
    this.assertCanEditAutoImportRules(data.props);

    const rule: NetworkDeviceAutoImportRule | null =
      await NetworkDeviceAutoImportRuleService.findOneBy({
        query: {
          _id: data.ruleId,
          projectId: data.projectId,
        },
        select: AUTO_IMPORT_RULE_SELECT as never,
        props: data.props,
      });

    if (!rule?.id) {
      throw new BadDataException(
        "The auto import rule was not found. Reload the page, then try again.",
      );
    }

    if (rule.isExclusion || !rule.monitorTemplateId) {
      throw new BadDataException(
        "This rule gives its devices no monitor, so none of its monitors can move.",
      );
    }

    if (
      MonitorTemplateChangeProvenance.isSameTemplate(
        rule.monitorTemplateId,
        data.template.id,
      )
    ) {
      throw new BadDataException(
        "The rule uses this template already, so its monitors are on it.",
      );
    }

    const ruleTemplate: MonitorTemplate | null =
      await MonitorTemplateService.findOneById({
        id: rule.monitorTemplateId,
        select: { _id: true, monitorType: true },
        props: { isRoot: true },
      });

    if (
      ruleTemplate?.monitorType &&
      ruleTemplate.monitorType !== data.template.monitorType
    ) {
      throw new BadDataException(
        "The rule's monitors are of another type than this template, so they cannot move to it. Save the rule without moving them.",
      );
    }

    if (
      (
        await this.findActiveChangesOfAutoImportRule({
          projectId: data.projectId,
          ruleId: rule.id,
        })
      ).length > 0
    ) {
      throw new BadDataException(
        "A move of this rule's monitors is running already. Wait for it to finish, or stop it, then try again.",
      );
    }

    return rule;
  }

  /*
   * The monitors an auto import rule's devices have from the template the
   * rule uses (#11451), that `props` may read: made for a device - by the
   * rule, an import or another rule - from the template (created from it,
   * or before that was recorded) and still linked to it, no alert policy's,
   * on a device a run of the rule reaches (NetworkDeviceAutoImportRule
   * EngineService.findDeviceIdsTheRuleReaches: the hosts it imports in the
   * project's scans, an exclusion rule vetoing them, found as a run finds
   * them). Exactly the monitors the rule would give a second monitor beside,
   * pointed at another template without moving them.
   */
  public static async readAutoImportRuleMonitorIds(data: {
    projectId: ObjectID;
    rule: NetworkDeviceAutoImportRule;
    props: DatabaseCommonInteractionProps;
    limit: number;
  }): Promise<Array<string>> {
    const templateId: ObjectID | undefined = data.rule.monitorTemplateId;

    if (!templateId) {
      return [];
    }

    const deviceIds: Array<string> = Array.from(
      await NetworkDeviceAutoImportRuleEngineService.findDeviceIdsTheRuleReaches(
        {
          projectId: data.projectId,
          rule: data.rule,
        },
      ),
    );

    const monitorIds: Array<string> = [];

    for (
      let offset: number = 0;
      offset < deviceIds.length;
      offset += RULE_DEVICES_PER_READ
    ) {
      const devicesOfRead: Array<ObjectID> = deviceIds
        .slice(offset, offset + RULE_DEVICES_PER_READ)
        .map((id: string): ObjectID => {
          return new ObjectID(id);
        });
      let cursor: ObjectID | null = null;

      for (;;) {
        const monitors: Array<Monitor> = await MonitorService.findBy({
          query: {
            projectId: data.projectId,
            monitorTemplateId: templateId,
            autoProvisionedNetworkDeviceId: QueryHelper.any(devicesOfRead),
            networkAlertPolicyId: QueryHelper.isNull(),
            ...(cursor ? { _id: QueryHelper.greaterThan(cursor) } : {}),
          },
          select: {
            _id: true,
            createdFromMonitorTemplateId: true,
          },
          sort: { _id: SortOrder.Ascending },
          limit: LINKED_MONITORS_READ_PAGE,
          skip: 0,
          props: data.props,
        });

        for (const monitor of monitors) {
          // Made from the template: one a person moved onto it is not the rule's.
          if (
            monitor.id &&
            (!monitor.createdFromMonitorTemplateId ||
              MonitorTemplateChangeProvenance.isSameTemplate(
                monitor.createdFromMonitorTemplateId,
                templateId,
              ))
          ) {
            monitorIds.push(monitor.id.toString());

            if (monitorIds.length >= data.limit) {
              return monitorIds;
            }
          }
        }

        if (monitors.length < LINKED_MONITORS_READ_PAGE) {
          break;
        }

        cursor = monitors[monitors.length - 1]!.id;
      }
    }

    return monitorIds;
  }

  /*
   * What a move of an auto import rule's monitors would move, before anyone
   * asks for it (#11451): how many of its devices' monitors are on the
   * template it uses, which template that is, and whether a move of them is
   * running already. The rule's form asks it as the person saves the rule.
   */
  public static async getAutoImportRuleMonitorsToMove(data: {
    projectId: ObjectID;
    ruleId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<{
    count: number;
    monitorTemplateId?: string | undefined;
    monitorTemplateName?: string | undefined;
    monitorType?: string | undefined;
    isMoveRunning: boolean;
  }> {
    this.assertCanSeeChanges(data.props);

    const rule: NetworkDeviceAutoImportRule | null =
      await NetworkDeviceAutoImportRuleService.findOneBy({
        query: {
          _id: data.ruleId,
          projectId: data.projectId,
        },
        select: AUTO_IMPORT_RULE_SELECT as never,
        props: data.props,
      });

    if (!rule?.id) {
      throw new BadDataException(
        "The auto import rule was not found. Reload the page, then try again.",
      );
    }

    const isMoveRunning: boolean =
      (
        await this.findActiveChangesOfAutoImportRule({
          projectId: data.projectId,
          ruleId: rule.id,
        })
      ).length > 0;

    if (rule.isExclusion || !rule.monitorTemplateId) {
      return { count: 0, isMoveRunning: isMoveRunning };
    }

    const template: MonitorTemplate | null =
      await MonitorTemplateService.findOneById({
        id: rule.monitorTemplateId,
        select: { _id: true, templateName: true, monitorType: true },
        props: { isRoot: true },
      });

    return {
      count: (
        await this.readAutoImportRuleMonitorIds({
          projectId: data.projectId,
          rule: rule,
          props: data.props,
          limit: MAX_MONITORS_PER_TEMPLATE_CHANGE,
        })
      ).length,
      monitorTemplateId: rule.monitorTemplateId.toString(),
      ...(template?.templateName
        ? { monitorTemplateName: template.templateName }
        : {}),
      ...(template?.monitorType ? { monitorType: template.monitorType } : {}),
      isMoveRunning: isMoveRunning,
    };
  }

  // An auto import rule's changes that have not finished, oldest first.
  public static async findActiveChangesOfAutoImportRule(data: {
    projectId: ObjectID;
    ruleId: ObjectID;
  }): Promise<Array<MonitorTemplateChange>> {
    return await MonitorTemplateChangeService.findBy({
      query: {
        projectId: data.projectId,
        networkDeviceAutoImportRuleId: data.ruleId,
        status: new Includes([...ACTIVE_MONITOR_TEMPLATE_CHANGE_STATUSES]),
      },
      select: CHANGE_SELECT as never,
      sort: { createdAt: SortOrder.Ascending },
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });
  }

  /*
   * A network alert policy pointed at another template moves its monitors
   * there (issue #11452): a change of every monitor of the policy that is on
   * another template, on a device the policy covers, linked to the template
   * it names with its settings, as OneUptime. Started by the policy's save
   * (NetworkAlertPolicyService.onUpdateSuccess), whoever made it: `userId` is
   * who to show as having asked, when a person did.
   *
   * A change of the policy to the same template still running covers it:
   * none is started. One to another template - the policy pointed somewhere
   * else before it finished - is stopped, and its monitors are this one's.
   * Null when nothing is to move.
   */
  public static async startForAlertPolicy(data: {
    projectId: ObjectID;
    policyId: ObjectID;
    userId?: ObjectID | null | undefined;
  }): Promise<MonitorTemplateChange | null> {
    const policy: NetworkAlertPolicy | null =
      await NetworkAlertPolicyService.findOneBy({
        query: {
          _id: data.policyId,
          projectId: data.projectId,
        },
        select: {
          _id: true,
          projectId: true,
          name: true,
          monitorTemplateId: true,
          scope: true,
        },
        props: { isRoot: true },
      });

    if (!policy?.id || !policy.projectId || !policy.monitorTemplateId) {
      return null;
    }

    const active: Array<MonitorTemplateChange> =
      await this.findActiveChangesOfAlertPolicy({
        projectId: data.projectId,
        policyId: policy.id,
      });

    if (
      active.some((row: MonitorTemplateChange): boolean => {
        return (
          row.monitorTemplateId?.toString() ===
          policy.monitorTemplateId!.toString()
        );
      })
    ) {
      return null;
    }

    for (const row of active) {
      await this.requestStop(row);
    }

    const monitorIds: Array<string> =
      await NetworkAlertPolicyEngineService.findMonitorsToMoveToPolicyTemplate({
        policy: policy,
        limit: MAX_MONITORS_PER_TEMPLATE_CHANGE,
      });

    if (monitorIds.length === 0) {
      return null;
    }

    const template: MonitorTemplate =
      await MonitorTemplateService.readTemplateToLinkOrUnlink({
        monitorTemplateId: policy.monitorTemplateId,
        props: { isRoot: true },
      });

    return await this.record({
      projectId: data.projectId,
      userId: data.userId || null,
      settings: {
        kind: MonitorTemplateChangeKind.Link,
        applyTemplateSettings: true,
        clearTemplateSettings: false,
        deleteTemplateWhenDone: false,
      },
      template: template,
      monitorIds: monitorIds,
      retryOfChangeId: null,
      alertPolicy: { id: policy.id, name: policy.name || "" },
    });
  }

  // A network alert policy's changes that have not finished, oldest first.
  public static async findActiveChangesOfAlertPolicy(data: {
    projectId: ObjectID;
    policyId: ObjectID;
  }): Promise<Array<MonitorTemplateChange>> {
    return await MonitorTemplateChangeService.findBy({
      query: {
        projectId: data.projectId,
        networkAlertPolicyId: data.policyId,
        status: new Includes([...ACTIVE_MONITOR_TEMPLATE_CHANGE_STATUSES]),
      },
      select: CHANGE_SELECT as never,
      sort: { createdAt: SortOrder.Ascending },
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });
  }

  /*
   * Try again what a change did not do: a new change of its failed and
   * unreached monitors, with its settings. Anyone who may change monitors
   * may retry one, as anyone may stop one.
   */
  public static async retry(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    changeId: ObjectID;
  }): Promise<MonitorTemplateChange> {
    const userId: ObjectID | undefined = data.props.userId;

    if (!userId) {
      throw new NotAuthorizedException(
        "Changing monitors' template acts as the person who asks for it, so it needs a person signed in to the project.",
      );
    }

    this.assertCanChangeMonitors(data.props);

    const row: MonitorTemplateChange = await this.findChange({
      changeId: data.changeId,
      projectId: data.projectId,
    });

    if (isMonitorTemplateChangeActive(row.status)) {
      throw new BadDataException(
        "This change is still running. Wait for it to finish, or stop it, then retry what it left.",
      );
    }

    const settings: MonitorTemplateChangeSettings =
      readMonitorTemplateChangeSettings(row.settings);

    if (settings.deleteTemplateWhenDone) {
      this.assertCanDeleteTemplates(data.props);
    }

    const monitorIds: Array<string> = getRetryableMonitorIds(
      readMonitorTemplateChangeResults(row.results),
    );

    const template: MonitorTemplate | null = row.monitorTemplateId
      ? await MonitorTemplateService.readTemplateToLinkOrUnlink({
          monitorTemplateId: row.monitorTemplateId,
          // A policy's change is OneUptime's, whoever retries it.
          props: row.networkAlertPolicyId ? { isRoot: true } : data.props,
        })
      : null;

    if (
      monitorIds.length === 0 &&
      !settings.deleteTemplateWhenDone &&
      !row.networkDeviceAutoImportRuleId
    ) {
      throw new BadDataException(
        "Nothing in this change failed or was left out, so there is nothing to retry.",
      );
    }

    if (template && settings.deleteTemplateWhenDone) {
      await MonitorTemplateService.assertNothingProvisionsFrom(template);
    }

    return await this.record({
      projectId: data.projectId,
      userId: userId,
      settings: settings,
      template: template,
      monitorIds: monitorIds,
      retryOfChangeId: row.id!,
      ...(row.networkAlertPolicyId
        ? {
            alertPolicy: {
              id: row.networkAlertPolicyId,
              name: row.networkAlertPolicyName || "",
            },
          }
        : {}),
      ...(row.networkDeviceAutoImportRuleId
        ? {
            autoImportRule: {
              id: row.networkDeviceAutoImportRuleId,
              name: row.networkDeviceAutoImportRuleName || "",
            },
          }
        : {}),
    });
  }

  /*
   * Stop a change. A queued one stops at once; a running one stops before
   * its next monitor, within a couple of seconds. What it changed stays.
   */
  public static async stop(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    changeId: ObjectID;
  }): Promise<MonitorTemplateChange> {
    this.assertCanChangeMonitors(data.props);

    const row: MonitorTemplateChange = await this.findChange({
      changeId: data.changeId,
      projectId: data.projectId,
    });

    if (!isMonitorTemplateChangeActive(row.status)) {
      return row;
    }

    await this.requestStop(row);

    return await this.findChange({
      changeId: data.changeId,
      projectId: data.projectId,
    });
  }

  /*
   * A queued change stops at once, every monitor not reached; a running one
   * is asked to stop before its next monitor.
   */
  private static async requestStop(row: MonitorTemplateChange): Promise<void> {
    if (row.status === MonitorTemplateChangeStatus.Queued) {
      const monitorIds: Array<string> = readMonitorTemplateChangeMonitorIds(
        row.monitorIds,
      );
      const results: MonitorTemplateChangeResults =
        readMonitorTemplateChangeResults(row.results);
      const progress: MonitorTemplateChangeProgress =
        readMonitorTemplateChangeProgress(row.progress);

      this.markNotReached({
        monitorIds: monitorIds,
        results: results,
        progress: progress,
        reason: MONITOR_NOT_REACHED_STOPPED,
      });

      await MonitorTemplateChangeService.updateOneById({
        id: row.id!,
        data: {
          status: MonitorTemplateChangeStatus.Stopped,
          stopRequestedAt: new Date(),
          completedAt: new Date(),
          results: results as never,
          progress: progress as never,
        },
        props: { isRoot: true },
      });
    } else {
      await MonitorTemplateChangeService.updateOneById({
        id: row.id!,
        data: {
          stopRequestedAt: new Date(),
        },
        props: { isRoot: true },
      });
    }
  }

  private static async record(data: {
    projectId: ObjectID;
    // Who asked; none for a policy's change no person saved.
    userId: ObjectID | null;
    settings: MonitorTemplateChangeSettings;
    template: MonitorTemplate | null;
    monitorIds: Array<string>;
    retryOfChangeId: ObjectID | null;
    // A network alert policy's change (#11452).
    alertPolicy?: { id: ObjectID; name: string } | undefined;
    // An auto import rule's change (#11451).
    autoImportRule?: { id: ObjectID; name: string } | undefined;
  }): Promise<MonitorTemplateChange> {
    const row: MonitorTemplateChange = new MonitorTemplateChange();
    row.projectId = data.projectId;
    row.status = MonitorTemplateChangeStatus.Queued;
    row.settings = data.settings as unknown as JSONObject;
    row.monitorIds = data.monitorIds;
    row.results = {
      processedCount: 0,
      lines: [],
    } as unknown as JSONObject;
    row.progress = emptyMonitorTemplateChangeProgress(
      data.monitorIds.length,
    ) as unknown as JSONObject;

    if (data.userId) {
      row.createdByUserId = data.userId;
    }

    row.resumeCount = 0;

    if (data.alertPolicy) {
      row.networkAlertPolicyId = data.alertPolicy.id;
      row.networkAlertPolicyName = data.alertPolicy.name.substring(0, 100);
    }

    if (data.autoImportRule) {
      row.networkDeviceAutoImportRuleId = data.autoImportRule.id;
      row.networkDeviceAutoImportRuleName = data.autoImportRule.name.substring(
        0,
        100,
      );
    }

    if (data.template?.id) {
      row.monitorTemplateId = data.template.id;
    }

    if (data.template?.templateName) {
      row.monitorTemplateName = data.template.templateName.substring(0, 100);
    }

    if (data.retryOfChangeId) {
      row.retryOfChangeId = data.retryOfChangeId;
    }

    const created: MonitorTemplateChange =
      await MonitorTemplateChangeService.create({
        data: row,
        props: { isRoot: true },
      });

    await this.enqueue(data.projectId);

    return created;
  }

  /*
   * The monitors linked to the template that the person may read, oldest
   * first: what a template's Delete clears. One the person may not read
   * stays linked, and keeps the template from being deleted (complete).
   */
  private static async readLinkedMonitorIds(data: {
    projectId: ObjectID;
    monitorTemplateId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<string>> {
    const ids: Array<string> = [];

    for (let skip: number = 0; ; skip += LINKED_MONITORS_READ_PAGE) {
      const monitors: Array<Monitor> = await MonitorService.findBy({
        query: {
          projectId: data.projectId,
          monitorTemplateId: data.monitorTemplateId,
        },
        select: { _id: true },
        sort: { createdAt: SortOrder.Ascending, _id: SortOrder.Ascending },
        limit: LINKED_MONITORS_READ_PAGE,
        skip: skip,
        props: data.props,
      });

      for (const monitor of monitors) {
        if (monitor.id) {
          ids.push(monitor.id.toString());
        }
      }

      if (monitors.length < LINKED_MONITORS_READ_PAGE) {
        return ids;
      }
    }
  }

  /*
   * The monitors picked: ids, each once, in the order sent. Refused when
   * there are more than one change takes.
   */
  public static readMonitorIds(value: unknown): Array<string> {
    if (!Array.isArray(value)) {
      throw new BadDataException(
        "Select the monitors to change, then try again.",
      );
    }

    const ids: Array<string> = [];
    const seen: Set<string> = new Set<string>();

    for (const item of value) {
      if (typeof item !== "string" || !ObjectID.isValidUUID(item.trim())) {
        throw new BadDataException(
          "One of the selected monitors was not recognised. Reload the page, select the monitors again, then try again.",
        );
      }

      const id: string = item.trim();
      const key: string = id.toLowerCase();

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      ids.push(id);
    }

    if (ids.length > MAX_MONITORS_PER_TEMPLATE_CHANGE) {
      throw new BadDataException(
        `One change takes at most ${MAX_MONITORS_PER_TEMPLATE_CHANGE} monitors, and ${ids.length} were selected. Narrow the list with a filter, change those, then change the rest.`,
      );
    }

    return ids;
  }

  private static readOptionalId(
    value: unknown,
    message: string,
  ): ObjectID | null {
    if (value === undefined || value === null || value === "") {
      return null;
    }

    if (typeof value !== "string" || !ObjectID.isValidUUID(value.trim())) {
      throw new BadDataException(message);
    }

    return new ObjectID(value.trim());
  }

  // ---- Permissions.

  public static assertCanChangeMonitors(
    props: DatabaseCommonInteractionProps,
  ): void {
    try {
      TablePermission.checkTableLevelPermissions(
        Monitor,
        props,
        DatabaseRequestType.Update,
      );
    } catch (error) {
      if (isRefusalOfThePerson(error)) {
        throw new NotAuthorizedException(
          "You may not edit monitors in this project, so you cannot change their template. Ask a Project Owner or Project Admin.",
        );
      }

      throw error;
    }
  }

  public static assertCanSeeChanges(
    props: DatabaseCommonInteractionProps,
  ): void {
    try {
      TablePermission.checkTableLevelPermissions(
        Monitor,
        props,
        DatabaseRequestType.Read,
      );
    } catch (error) {
      if (isRefusalOfThePerson(error)) {
        throw new NotAuthorizedException(
          "You may not see this project's monitors, so you cannot see changes of their template.",
        );
      }

      throw error;
    }
  }

  private static assertCanEditAutoImportRules(
    props: DatabaseCommonInteractionProps,
  ): void {
    try {
      TablePermission.checkTableLevelPermissions(
        NetworkDeviceAutoImportRule,
        props,
        DatabaseRequestType.Update,
      );
    } catch (error) {
      if (isRefusalOfThePerson(error)) {
        throw new NotAuthorizedException(
          "You may not edit auto import rules in this project, so you cannot move a rule's monitors to another template. Ask a Project Owner or Project Admin.",
        );
      }

      throw error;
    }
  }

  private static assertCanDeleteTemplates(
    props: DatabaseCommonInteractionProps,
  ): void {
    try {
      TablePermission.checkTableLevelPermissions(
        MonitorTemplate,
        props,
        DatabaseRequestType.Delete,
      );
    } catch (error) {
      if (isRefusalOfThePerson(error)) {
        throw new NotAuthorizedException(
          "You may not delete monitor templates in this project. Ask a Project Owner or Project Admin.",
        );
      }

      throw error;
    }
  }

  // ---- The worker's side.

  /*
   * Run the project's changes, oldest first, until none is waiting. Called
   * by the queue job; returns when there is nothing left to do, or when the
   * job's time is up (having queued a fresh job to carry on).
   */
  public static async runProjectChanges(projectId: ObjectID): Promise<void> {
    let lock: SemaphoreMutex;

    try {
      lock = await Semaphore.lock({
        namespace: LOCK_NAMESPACE,
        key: projectId.toString(),
        lockTimeout: PROJECT_LOCK_TIMEOUT_MS,
        acquireTimeout: 1000,
        acquireAttemptsLimit: 1,
      });
    } catch (error) {
      /*
       * Another job holds the project: it runs every change that is
       * waiting, this one's included, and the sweep re-queues anything left
       * behind.
       */
      logger.debug(
        `Monitor template change: project ${projectId.toString()} is already being changed: ${error}`,
      );
      return;
    }

    const jobStartedAt: number = this.now();

    try {
      for (;;) {
        const next: MonitorTemplateChange | null =
          await this.findNextChange(projectId);

        if (!next) {
          return;
        }

        const finish: MonitorTemplateChangeFinish = await this.processChange({
          changeId: next.id!,
          deadline: jobStartedAt + MONITOR_TEMPLATE_CHANGE_JOB_BUDGET_MS,
        });

        if (finish === "handover") {
          await this.enqueue(projectId);
          return;
        }
      }
    } finally {
      try {
        await Semaphore.release(lock);
      } catch {
        logger.error(
          "Monitor template change: a project lock could not be released and will expire on its own.",
        );
      }
    }
  }

  /*
   * Change one change's monitors that are not done yet. Picks up where an
   * earlier worker stopped: a monitor dealt with is not touched again.
   */
  public static async processChange(data: {
    changeId: ObjectID;
    deadline: number;
  }): Promise<MonitorTemplateChangeFinish> {
    const row: MonitorTemplateChange | null =
      await MonitorTemplateChangeService.findOneById({
        id: data.changeId,
        select: CHANGE_SELECT as never,
        props: { isRoot: true },
      });

    if (!row || !row.projectId || !isMonitorTemplateChangeActive(row.status)) {
      return "done";
    }

    let state: ChangeRunState;

    try {
      state = await this.prepare(row);
    } catch (error) {
      await this.failChange(row, this.describeStartFailure(error));
      return "done";
    }

    if (row.status === MonitorTemplateChangeStatus.Queued) {
      await MonitorTemplateChangeService.updateOneById({
        id: row.id!,
        data: {
          status: MonitorTemplateChangeStatus.Running,
          startedAt: new Date(),
        },
        props: { isRoot: true },
      });
    }

    const logAttributes: LogAttributes = {
      projectId: state.projectId.toString(),
    } as LogAttributes;

    for (;;) {
      while (state.results.processedCount < state.monitorIds.length) {
        if (this.now() >= data.deadline) {
          await this.flush(state, true);
          return "handover";
        }

        if (await this.isStopRequested(state)) {
          this.markNotReached({
            monitorIds: state.monitorIds,
            results: state.results,
            progress: state.progress,
            reason: MONITOR_NOT_REACHED_STOPPED,
          });
          await this.complete(state, MonitorTemplateChangeStatus.Stopped);
          return "stopped";
        }

        try {
          await this.refreshPropsIfDue(state);
        } catch (error) {
          this.markNotReached({
            monitorIds: state.monitorIds,
            results: state.results,
            progress: state.progress,
            reason: MONITOR_NOT_REACHED_FAILED,
          });
          await this.failChange(state.row, this.describeStartFailure(error), {
            results: state.results,
            progress: state.progress,
          });
          return "done";
        }

        const monitorId: string =
          state.monitorIds[state.results.processedCount]!;

        try {
          await this.changeMonitor(state, monitorId);
        } catch (error) {
          // changeMonitor settles its own failures; this one is unexpected.
          logger.error(
            `Monitor template change ${state.row.id?.toString()}: unexpected failure changing monitor ${monitorId}: ${error}`,
            logAttributes,
          );

          this.recordLine(state, {
            monitorId: monitorId,
            outcome: MonitorTemplateChangeOutcome.Failed,
            reason: toText(error),
          });
        }

        state.results.processedCount++;
        state.progress.processed = state.results.processedCount;

        if (this.isSystemicallyFailing(state)) {
          this.markNotReached({
            monitorIds: state.monitorIds,
            results: state.results,
            progress: state.progress,
            reason: MONITOR_NOT_REACHED_FAILED,
          });
          await this.failChange(
            state.row,
            `${MAX_CONSECUTIVE_IDENTICAL_CHANGE_FAILURES} monitors in a row could not be changed, each for the same reason, so the change stopped. Fix it, then retry: ${state.lastFailureReason}`,
            { results: state.results, progress: state.progress },
          );
          return "done";
        }

        await this.flush(state, false);
      }

      // An auto import rule's change: monitors the rule made meanwhile go too.
      if (
        state.autoImportRuleId &&
        (await this.addMonitorsTheRuleMadeMeanwhile(state))
      ) {
        continue;
      }

      break;
    }

    if (state.settings.deleteTemplateWhenDone) {
      await this.deleteTemplateIfUnlinked(state);
    }

    if (state.autoImportRuleId) {
      await this.pointAutoImportRule(state);
    }

    if (state.alertPolicyId) {
      await this.finishAlertPolicyMove(state);
    }

    await this.complete(state, MonitorTemplateChangeStatus.Completed);

    return "done";
  }

  /*
   * An auto import rule's change, its monitors dealt with (#11451): the
   * monitors the rule's devices have from its template that the change has
   * not dealt with - made by the rule while the change ran - are added to it,
   * up to MAX_AUTO_IMPORT_RULE_APPEND_ROUNDS times, so none is left behind
   * when the rule is pointed. True when some were added.
   */
  private static async addMonitorsTheRuleMadeMeanwhile(
    state: ChangeRunState,
  ): Promise<boolean> {
    if (state.appendRounds >= MAX_AUTO_IMPORT_RULE_APPEND_ROUNDS) {
      return false;
    }

    const rule: NetworkDeviceAutoImportRule | null =
      await this.readRuleOfChange(state);

    if (
      !rule?.monitorTemplateId ||
      MonitorTemplateChangeProvenance.isSameTemplate(
        rule.monitorTemplateId,
        state.row.monitorTemplateId,
      )
    ) {
      return false;
    }

    const known: Set<string> = new Set<string>(
      state.monitorIds.map((id: string): string => {
        return id.toLowerCase();
      }),
    );

    const fresh: Array<string> = (
      await this.readAutoImportRuleMonitorIds({
        projectId: state.projectId,
        rule: rule,
        props: state.props,
        limit: MAX_MONITORS_PER_TEMPLATE_CHANGE,
      })
    ).filter((id: string): boolean => {
      return !known.has(id.toLowerCase());
    });

    state.appendRounds++;

    if (
      fresh.length === 0 ||
      state.monitorIds.length + fresh.length > MAX_MONITORS_PER_TEMPLATE_CHANGE
    ) {
      return false;
    }

    state.monitorIds.push(...fresh);
    state.progress.total = state.monitorIds.length;

    await MonitorTemplateChangeService.updateOneById({
      id: state.row.id!,
      data: {
        monitorIds: state.monitorIds as never,
        results: state.results as never,
        progress: state.progress as never,
      },
      props: { isRoot: true },
    });

    return true;
  }

  // The rule a change moves the monitors of, as OneUptime reads it.
  private static async readRuleOfChange(
    state: ChangeRunState,
  ): Promise<NetworkDeviceAutoImportRule | null> {
    if (!state.autoImportRuleId) {
      return null;
    }

    return await NetworkDeviceAutoImportRuleService.findOneBy({
      query: {
        _id: state.autoImportRuleId,
        projectId: state.projectId,
      },
      select: AUTO_IMPORT_RULE_SELECT as never,
      props: { isRoot: true },
    });
  }

  /*
   * An auto import rule's change, done (#11451): the rule is pointed at the
   * template, as the person, once every monitor its devices have from its
   * template is on the new one - as OneUptime sees them, so one the person
   * may not see keeps the rule where it is, as it keeps a template a Delete
   * would delete. Otherwise the summary says how many are left, or why the
   * rule could not be pointed. A rule pointed at it meanwhile is as asked.
   */
  private static async pointAutoImportRule(
    state: ChangeRunState,
  ): Promise<void> {
    const templateId: ObjectID | undefined = state.row.monitorTemplateId;
    const rule: NetworkDeviceAutoImportRule | null =
      await this.readRuleOfChange(state);

    if (!rule || !templateId) {
      state.results.autoImportRuleError =
        "The rule was deleted while its monitors moved, so no rule was pointed at the template.";
      return;
    }

    if (
      MonitorTemplateChangeProvenance.isSameTemplate(
        rule.monitorTemplateId,
        templateId,
      )
    ) {
      state.results.isAutoImportRulePointed = true;
      return;
    }

    if (!rule.monitorTemplateId) {
      state.results.autoImportRuleError =
        "The rule's monitor template was cleared while its monitors moved, so it was left as it is.";
      return;
    }

    const left: number = (
      await this.readAutoImportRuleMonitorIds({
        projectId: state.projectId,
        rule: rule,
        props: { isRoot: true },
        limit: MAX_MONITORS_PER_TEMPLATE_CHANGE,
      })
    ).length;

    if (left > 0) {
      state.results.autoImportRuleMonitorsLeftCount = left;
      return;
    }

    try {
      await NetworkDeviceAutoImportRuleService.updateOneById({
        id: rule.id!,
        data: { monitorTemplateId: templateId },
        props: state.props,
      });

      state.results.isAutoImportRulePointed = true;
    } catch (error) {
      state.results.autoImportRuleError = toText(error);
    }
  }

  /*
   * A network alert policy's change, done: with every monitor moved - none
   * left out or failed - the policy's fleet runs the template it names, and
   * its Template Synced says so (onPolicyMonitorsMoved, which looks again).
   */
  private static async finishAlertPolicyMove(
    state: ChangeRunState,
  ): Promise<void> {
    const progress: MonitorTemplateChangeProgress = state.progress;

    if (
      !state.alertPolicyId ||
      !state.row.monitorTemplateId ||
      progress.changed + progress.unchanged < progress.total
    ) {
      return;
    }

    await NetworkAlertPolicyEngineService.onPolicyMonitorsMoved({
      projectId: state.projectId,
      policyId: state.alertPolicyId,
      monitorTemplateId: state.row.monitorTemplateId,
    });
  }

  /*
   * One monitor, through the link or the unlink a single monitor goes
   * through, as the person. What happened is counted, or lined with why.
   */
  private static async changeMonitor(
    state: ChangeRunState,
    monitorId: string,
  ): Promise<void> {
    if (!ObjectID.isValidUUID(monitorId)) {
      this.recordLine(state, {
        monitorId: monitorId,
        outcome: MonitorTemplateChangeOutcome.Skipped,
        reason:
          "This monitor was not recognised. Reload the page, select the monitors again, then try again.",
      });
      return;
    }

    if (
      state.alertPolicyId &&
      !(await this.isStillThePolicys(state, monitorId))
    ) {
      this.recordLine(state, {
        monitorId: monitorId,
        monitorName: await this.readMonitorNameAsPerson(state, monitorId),
        outcome: MonitorTemplateChangeOutcome.Skipped,
        reason: MONITOR_NO_LONGER_THE_POLICYS,
      });
      return;
    }

    let result: MonitorTemplateLinkResult;

    try {
      result =
        state.settings.kind === MonitorTemplateChangeKind.Link
          ? await MonitorTemplateService.linkMonitor({
              monitorTemplateId: state.template!.id!,
              monitorId: new ObjectID(monitorId),
              props: state.props,
              applyTemplateSettings: state.settings.applyTemplateSettings,
              template: state.template!,
            })
          : await MonitorTemplateService.unlinkMonitor({
              ...(state.template?.id
                ? { monitorTemplateId: state.template.id }
                : {}),
              monitorId: new ObjectID(monitorId),
              props: state.props,
              clearTemplateSettings: state.settings.clearTemplateSettings,
              ...(state.template
                ? { templateName: state.template.templateName || "" }
                : {}),
            });
    } catch (error) {
      const reason: string = toText(error);

      this.recordLine(state, {
        monitorId: monitorId,
        monitorName: await this.readMonitorNameAsPerson(state, monitorId),
        outcome: isRefusal(error)
          ? MonitorTemplateChangeOutcome.Skipped
          : MonitorTemplateChangeOutcome.Failed,
        reason: reason,
      });

      return;
    }

    state.consecutiveFailures = 0;
    state.lastFailureReason = "";

    if (result.outcome === MonitorTemplateChangeOutcome.Changed) {
      state.progress.changed++;
    } else {
      state.progress.unchanged++;
    }

    state.progress.resolvedIncidents += result.resolvedIncidentCount;
    state.progress.resolvedAlerts += result.resolvedAlertCount;
  }

  /*
   * A network alert policy's change: whether the monitor is still the
   * policy's. One a person moved to another template, or unlinked, since is
   * the person's (MonitorTemplateChangeProvenance): it is left as they
   * chose. One that is gone is left to the link, which says so.
   */
  private static async isStillThePolicys(
    state: ChangeRunState,
    monitorId: string,
  ): Promise<boolean> {
    const monitor: Monitor | null = await MonitorService.findOneById({
      id: new ObjectID(monitorId),
      select: { _id: true, networkAlertPolicyId: true },
      props: { isRoot: true },
    });

    if (!monitor) {
      return true;
    }

    return (
      monitor.networkAlertPolicyId?.toString() ===
      state.alertPolicyId?.toString()
    );
  }

  // A monitor's name for its line, when the person may read it.
  private static async readMonitorNameAsPerson(
    state: ChangeRunState,
    monitorId: string,
  ): Promise<string | undefined> {
    try {
      const monitor: Monitor | null = await MonitorService.findOneById({
        id: new ObjectID(monitorId),
        select: { _id: true, name: true },
        props: state.props,
      });

      return monitor?.name || undefined;
    } catch {
      return undefined;
    }
  }

  private static recordLine(
    state: ChangeRunState,
    line: MonitorTemplateChangeLine,
  ): void {
    state.results.lines.push({
      ...line,
      reason: line.reason.substring(
        0,
        MAX_MONITOR_TEMPLATE_CHANGE_REASON_LENGTH,
      ),
    });

    if (line.outcome === MonitorTemplateChangeOutcome.Skipped) {
      state.progress.skipped++;
      return;
    }

    if (line.outcome === MonitorTemplateChangeOutcome.NotReached) {
      state.progress.notReached++;
      return;
    }

    state.progress.failed++;

    if (line.reason === state.lastFailureReason) {
      state.consecutiveFailures++;
    } else {
      state.lastFailureReason = line.reason;
      state.consecutiveFailures = 1;
    }
  }

  /*
   * The same failure, monitor after monitor, before anything changed: the
   * change itself is what fails (MAX_CONSECUTIVE_IDENTICAL_CHANGE_FAILURES).
   */
  private static isSystemicallyFailing(state: ChangeRunState): boolean {
    return (
      state.progress.changed === 0 &&
      state.consecutiveFailures >= MAX_CONSECUTIVE_IDENTICAL_CHANGE_FAILURES
    );
  }

  /*
   * deleteTemplateWhenDone: the template goes once nothing is linked to it,
   * deleted as the person. A monitor still linked - one the person may not
   * read or change, or one linked meanwhile - keeps it, and the summary
   * says so: the template's Delete would otherwise unlink it with its
   * criteria still on it, which is not what the person chose.
   */
  private static async deleteTemplateIfUnlinked(
    state: ChangeRunState,
  ): Promise<void> {
    const templateId: ObjectID | undefined = state.row.monitorTemplateId;

    if (!templateId) {
      return;
    }

    const stillLinked: number = (
      await MonitorService.countBy({
        query: {
          projectId: state.projectId,
          monitorTemplateId: templateId,
        },
        props: { isRoot: true },
      })
    ).toNumber();

    if (stillLinked > 0) {
      state.results.templateStillLinkedCount = stillLinked;
      return;
    }

    try {
      await MonitorTemplateService.deleteOneById({
        id: templateId,
        props: state.props,
      });

      state.results.isTemplateDeleted = true;
    } catch (error) {
      state.results.templateDeleteError = toText(error);
    }
  }

  // Every monitor not dealt with yet is listed as not reached, with why.
  public static markNotReached(data: {
    monitorIds: Array<string>;
    results: MonitorTemplateChangeResults;
    progress: MonitorTemplateChangeProgress;
    reason: string;
  }): void {
    for (
      let index: number = data.results.processedCount;
      index < data.monitorIds.length;
      index++
    ) {
      data.results.lines.push({
        monitorId: data.monitorIds[index]!,
        outcome: MonitorTemplateChangeOutcome.NotReached,
        reason: data.reason,
      });
      data.progress.notReached++;
    }

    data.results.processedCount = data.monitorIds.length;
    data.progress.processed = data.monitorIds.length;
  }

  /*
   * Picks up changes a dead worker left behind, re-queues ones whose job
   * never ran, and fails ones that cannot go on. Called on a schedule.
   */
  public static async sweep(now: Date = new Date()): Promise<void> {
    const stale: Array<MonitorTemplateChange> =
      await MonitorTemplateChangeService.findBy({
        query: {
          status: new Includes([...ACTIVE_MONITOR_TEMPLATE_CHANGE_STATUSES]),
          updatedAt: new LessThan(
            new Date(now.getTime() - MONITOR_TEMPLATE_CHANGE_STALE_QUEUED_MS),
          ),
        },
        select: {
          _id: true,
          projectId: true,
          status: true,
          resumeCount: true,
          createdAt: true,
          updatedAt: true,
          monitorIds: true,
          results: true,
          progress: true,
        },
        sort: { createdAt: SortOrder.Ascending },
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      });

    const projectsToRun: Map<string, ObjectID> = new Map<string, ObjectID>();

    for (const row of stale) {
      if (!row.id || !row.projectId) {
        continue;
      }

      const updatedAt: number = row.updatedAt
        ? new Date(row.updatedAt).getTime()
        : 0;
      const createdAt: number = row.createdAt
        ? new Date(row.createdAt).getTime()
        : 0;

      if (row.status === MonitorTemplateChangeStatus.Running) {
        if (
          now.getTime() - updatedAt <
          MONITOR_TEMPLATE_CHANGE_STALE_RUNNING_MS
        ) {
          continue;
        }

        if ((row.resumeCount || 0) >= MAX_MONITOR_TEMPLATE_CHANGE_RESUMES) {
          await this.failChange(
            row,
            "The change stopped before it finished, more often than it is picked up again. What it changed is kept: retry the monitors it did not reach.",
          );
          continue;
        }

        await MonitorTemplateChangeService.updateOneById({
          id: row.id,
          data: { resumeCount: (row.resumeCount || 0) + 1 },
          props: { isRoot: true },
        });

        projectsToRun.set(row.projectId.toString(), row.projectId);
        continue;
      }

      // Queued.
      if (now.getTime() - createdAt > MONITOR_TEMPLATE_CHANGE_MAX_QUEUED_MS) {
        await this.failChange(
          row,
          "The change waited too long to start. Nothing was changed: start it again.",
        );
        continue;
      }

      projectsToRun.set(row.projectId.toString(), row.projectId);
    }

    for (const projectId of projectsToRun.values()) {
      try {
        await this.enqueue(projectId);
      } catch (error) {
        logger.error(
          `Monitor template change: could not queue project ${projectId.toString()} again: ${error}`,
        );
      }
    }
  }

  // ---- Reading changes, for the API.

  public static async findChange(data: {
    changeId: ObjectID;
    projectId: ObjectID;
  }): Promise<MonitorTemplateChange> {
    const row: MonitorTemplateChange | null =
      await MonitorTemplateChangeService.findOneBy({
        query: {
          _id: data.changeId.toString(),
          projectId: data.projectId,
        },
        select: CHANGE_SELECT as never,
        props: { isRoot: true },
      });

    if (!row) {
      throw new BadDataException(
        "This change was not found. Reload the page, then try again.",
      );
    }

    return row;
  }

  /*
   * The project's changes the Monitors list shows (#11454): those still
   * running, then those that finished in the last hour with monitors left
   * out, failed or not reached - or failed as a whole - newest first. A
   * change that went well is done with once it is.
   */
  public static async findChangesToShowOfProject(data: {
    projectId: ObjectID;
    now?: Date | undefined;
  }): Promise<Array<MonitorTemplateChange>> {
    const now: Date = data.now || new Date();

    const active: Array<MonitorTemplateChange> =
      await MonitorTemplateChangeService.findBy({
        query: {
          projectId: data.projectId,
          status: new Includes([...ACTIVE_MONITOR_TEMPLATE_CHANGE_STATUSES]),
        },
        select: CHANGE_SELECT as never,
        sort: { createdAt: SortOrder.Descending },
        limit: MONITOR_TEMPLATE_CHANGES_SHOWN_LIMIT,
        skip: 0,
        props: { isRoot: true },
      });

    const finished: Array<MonitorTemplateChange> =
      await MonitorTemplateChangeService.findBy({
        query: {
          projectId: data.projectId,
          status: new Includes([
            MonitorTemplateChangeStatus.Completed,
            MonitorTemplateChangeStatus.Stopped,
            MonitorTemplateChangeStatus.Failed,
          ]),
          completedAt: new GreaterThan(
            new Date(now.getTime() - MONITOR_TEMPLATE_CHANGE_SHOWN_FOR_MS),
          ),
        },
        select: CHANGE_SELECT as never,
        sort: { completedAt: SortOrder.Descending },
        limit: MONITOR_TEMPLATE_CHANGES_SHOWN_LIMIT * 2,
        skip: 0,
        props: { isRoot: true },
      });

    const worthShowing: Array<MonitorTemplateChange> = finished.filter(
      (row: MonitorTemplateChange): boolean => {
        const progress: MonitorTemplateChangeProgress =
          readMonitorTemplateChangeProgress(row.progress);

        return (
          row.status === MonitorTemplateChangeStatus.Failed ||
          progress.skipped + progress.failed + progress.notReached > 0
        );
      },
    );

    return [...active, ...worthShowing].slice(
      0,
      MONITOR_TEMPLATE_CHANGES_SHOWN_LIMIT,
    );
  }

  // The template's changes that have not finished, newest first.
  public static async findActiveChangesOfTemplate(data: {
    projectId: ObjectID;
    monitorTemplateId: ObjectID;
  }): Promise<Array<MonitorTemplateChange>> {
    return await MonitorTemplateChangeService.findBy({
      query: {
        projectId: data.projectId,
        monitorTemplateId: data.monitorTemplateId,
        status: new Includes([...ACTIVE_MONITOR_TEMPLATE_CHANGE_STATUSES]),
      },
      select: CHANGE_SELECT as never,
      sort: { createdAt: SortOrder.Descending },
      limit: 5,
      skip: 0,
      props: { isRoot: true },
    });
  }

  /*
   * A change as the Dashboard draws it: its counts, and the monitors worth
   * a line - left out, failed, not reached - up to
   * MONITOR_TEMPLATE_CHANGE_VIEW_LINE_LIMIT, or every one with `allLines`.
   */
  public static toView(data: {
    row: MonitorTemplateChange;
    allLines?: boolean | undefined;
  }): MonitorTemplateChangeView {
    const results: MonitorTemplateChangeResults =
      readMonitorTemplateChangeResults(data.row.results);
    const lines: Array<MonitorTemplateChangeLine> = data.allLines
      ? results.lines
      : results.lines.slice(0, MONITOR_TEMPLATE_CHANGE_VIEW_LINE_LIMIT);

    return {
      id: data.row.id!.toString(),
      status: data.row.status || MonitorTemplateChangeStatus.Queued,
      settings: readMonitorTemplateChangeSettings(data.row.settings),
      ...(data.row.monitorTemplateId
        ? { monitorTemplateId: data.row.monitorTemplateId.toString() }
        : {}),
      ...(data.row.monitorTemplateName
        ? { monitorTemplateName: data.row.monitorTemplateName }
        : {}),
      progress: readMonitorTemplateChangeProgress(data.row.progress),
      lines: lines,
      isLinesTruncated: lines.length < results.lines.length,
      ...(data.row.error ? { error: data.row.error } : {}),
      isStopRequested: Boolean(data.row.stopRequestedAt),
      retryableCount: getRetryableMonitorIds(results).length,
      isTemplateDeleted: results.isTemplateDeleted === true,
      ...(results.templateStillLinkedCount
        ? { templateStillLinkedCount: results.templateStillLinkedCount }
        : {}),
      ...(results.templateDeleteError
        ? { templateDeleteError: results.templateDeleteError }
        : {}),
      ...(data.row.networkAlertPolicyId
        ? { networkAlertPolicyId: data.row.networkAlertPolicyId.toString() }
        : {}),
      ...(data.row.networkAlertPolicyName
        ? { networkAlertPolicyName: data.row.networkAlertPolicyName }
        : {}),
      ...(data.row.networkDeviceAutoImportRuleId
        ? {
            autoImportRuleId: data.row.networkDeviceAutoImportRuleId.toString(),
          }
        : {}),
      ...(data.row.networkDeviceAutoImportRuleName
        ? { autoImportRuleName: data.row.networkDeviceAutoImportRuleName }
        : {}),
      isAutoImportRulePointed: results.isAutoImportRulePointed === true,
      ...(results.autoImportRuleMonitorsLeftCount
        ? {
            autoImportRuleMonitorsLeftCount:
              results.autoImportRuleMonitorsLeftCount,
          }
        : {}),
      ...(results.autoImportRuleError
        ? { autoImportRuleError: results.autoImportRuleError }
        : {}),
      ...(data.row.createdAt
        ? { createdAt: new Date(data.row.createdAt).toISOString() }
        : {}),
      ...(data.row.startedAt
        ? { startedAt: new Date(data.row.startedAt).toISOString() }
        : {}),
      ...(data.row.completedAt
        ? { completedAt: new Date(data.row.completedAt).toISOString() }
        : {}),
    };
  }

  // ---- Internals.

  private static async enqueue(projectId: ObjectID): Promise<void> {
    await Queue.addJob(
      QueueName.Worker,
      `monitor-template-change-${projectId.toString()}-${ObjectID.generate().toString()}`,
      MONITOR_TEMPLATE_CHANGE_JOB,
      { projectId: projectId.toString() },
      {
        attempts: 1,
        skipExistenceCheck: true,
        deduplication: {
          id: `monitor-template-change-${projectId.toString()}`,
          keepLastIfActive: true,
        },
      },
    );
  }

  private static async findNextChange(
    projectId: ObjectID,
  ): Promise<MonitorTemplateChange | null> {
    const running: MonitorTemplateChange | null =
      await MonitorTemplateChangeService.findOneBy({
        query: {
          projectId: projectId,
          status: MonitorTemplateChangeStatus.Running,
        },
        select: { _id: true },
        sort: { createdAt: SortOrder.Ascending },
        props: { isRoot: true },
      });

    if (running) {
      return running;
    }

    return await MonitorTemplateChangeService.findOneBy({
      query: {
        projectId: projectId,
        status: MonitorTemplateChangeStatus.Queued,
      },
      select: { _id: true },
      sort: { createdAt: SortOrder.Ascending },
      props: { isRoot: true },
    });
  }

  /*
   * What a worker needs to change the monitors: the person's permissions,
   * read now, and the template, read as them.
   */
  private static async prepare(
    row: MonitorTemplateChange,
  ): Promise<ChangeRunState> {
    const alertPolicyId: ObjectID | null = row.networkAlertPolicyId || null;

    if (!alertPolicyId && !row.createdByUserId) {
      throw new BadDataException(
        "The person who asked for this change is no longer in OneUptime, so it was stopped. What it changed is kept.",
      );
    }

    const projectId: ObjectID = row.projectId!;

    /*
     * A network alert policy's change acts as OneUptime: the policy's
     * monitors are OneUptime's to keep in step with its template, and so
     * they stay the policy's (MonitorTemplateChangeProvenance).
     */
    const props: DatabaseCommonInteractionProps = alertPolicyId
      ? { isRoot: true, tenantId: projectId }
      : await this.readPersonProps(row.createdByUserId!, projectId);

    if (!alertPolicyId) {
      this.assertCanChangeMonitors(props);
    }

    const settings: MonitorTemplateChangeSettings =
      readMonitorTemplateChangeSettings(row.settings);

    let template: MonitorTemplate | null = null;

    if (row.monitorTemplateId) {
      try {
        template = await MonitorTemplateService.readTemplateToLinkOrUnlink({
          monitorTemplateId: row.monitorTemplateId,
          props: props,
        });
      } catch (error) {
        /*
         * An unlink of a template deleted since finds each monitor unlinked
         * already: it goes on. A link has nowhere to go.
         */
        if (settings.kind === MonitorTemplateChangeKind.Link) {
          throw new BadDataException(
            `The template ${row.monitorTemplateName ? `"${row.monitorTemplateName}" ` : ""}was deleted, or you may no longer read it, so no monitor was linked to it. What was changed is kept.`,
          );
        }

        logger.debug(
          `Monitor template change ${row.id?.toString()}: its template is gone (${error}); unlinking what is left.`,
        );
      }
    }

    const monitorIds: Array<string> = readMonitorTemplateChangeMonitorIds(
      row.monitorIds,
    );
    const results: MonitorTemplateChangeResults =
      readMonitorTemplateChangeResults(row.results);
    const progress: MonitorTemplateChangeProgress =
      readMonitorTemplateChangeProgress(row.progress);

    progress.total = monitorIds.length;

    return {
      row: row,
      projectId: projectId,
      userId: row.createdByUserId || null,
      alertPolicyId: alertPolicyId,
      autoImportRuleId: row.networkDeviceAutoImportRuleId || null,
      appendRounds: 0,
      props: props,
      propsReadAt: this.now(),
      settings: settings,
      template: template,
      monitorIds: monitorIds,
      results: results,
      progress: progress,
      lastFlushAt: this.now(),
      lastStopCheckAt: 0,
      lastFailureReason: "",
      consecutiveFailures: 0,
    };
  }

  private static async readPersonProps(
    userId: ObjectID,
    projectId: ObjectID,
  ): Promise<DatabaseCommonInteractionProps> {
    return await CallerPlan.withPlan(
      await WorkspaceActionAuthorization.getProjectMemberProps({
        userId: userId,
        projectId: projectId,
      }),
    );
  }

  private static async refreshPropsIfDue(state: ChangeRunState): Promise<void> {
    // A policy's change is OneUptime's: there is no person to read again.
    if (
      !state.userId ||
      state.alertPolicyId ||
      this.now() - state.propsReadAt <
        MONITOR_TEMPLATE_CHANGE_PERMISSION_REFRESH_MS
    ) {
      return;
    }

    state.props = await this.readPersonProps(state.userId, state.projectId);
    state.propsReadAt = this.now();

    this.assertCanChangeMonitors(state.props);
  }

  private static async isStopRequested(
    state: ChangeRunState,
  ): Promise<boolean> {
    if (
      this.now() - state.lastStopCheckAt <
      MONITOR_TEMPLATE_CHANGE_STOP_CHECK_INTERVAL_MS
    ) {
      return false;
    }

    state.lastStopCheckAt = this.now();

    const row: MonitorTemplateChange | null =
      await MonitorTemplateChangeService.findOneById({
        id: state.row.id!,
        select: {
          _id: true,
          stopRequestedAt: true,
          status: true,
        },
        props: { isRoot: true },
      });

    return Boolean(
      !row || row.stopRequestedAt || !isMonitorTemplateChangeActive(row.status),
    );
  }

  private static async flush(
    state: ChangeRunState,
    force: boolean,
  ): Promise<void> {
    if (
      !force &&
      this.now() - state.lastFlushAt < MONITOR_TEMPLATE_CHANGE_FLUSH_INTERVAL_MS
    ) {
      return;
    }

    state.lastFlushAt = this.now();

    await MonitorTemplateChangeService.updateOneById({
      id: state.row.id!,
      data: {
        results: state.results as never,
        progress: state.progress as never,
      },
      props: { isRoot: true },
    });
  }

  private static async complete(
    state: ChangeRunState,
    status: MonitorTemplateChangeStatus,
  ): Promise<void> {
    await MonitorTemplateChangeService.updateOneById({
      id: state.row.id!,
      data: {
        status: status,
        results: state.results as never,
        progress: state.progress as never,
        completedAt: new Date(),
      },
      props: { isRoot: true },
    });
  }

  private static async failChange(
    row: MonitorTemplateChange,
    message: string,
    options?:
      | {
          results?: MonitorTemplateChangeResults | undefined;
          progress?: MonitorTemplateChangeProgress | undefined;
        }
      | undefined,
  ): Promise<void> {
    const monitorIds: Array<string> = readMonitorTemplateChangeMonitorIds(
      row.monitorIds,
    );
    const results: MonitorTemplateChangeResults =
      options?.results || readMonitorTemplateChangeResults(row.results);
    const progress: MonitorTemplateChangeProgress =
      options?.progress || readMonitorTemplateChangeProgress(row.progress);

    if (!options?.results) {
      progress.total = monitorIds.length;
      this.markNotReached({
        monitorIds: monitorIds,
        results: results,
        progress: progress,
        reason: MONITOR_NOT_REACHED_FAILED,
      });
    }

    try {
      await MonitorTemplateChangeService.updateOneById({
        id: row.id!,
        data: {
          status: MonitorTemplateChangeStatus.Failed,
          error: message,
          results: results as never,
          progress: progress as never,
          completedAt: new Date(),
        },
        props: { isRoot: true },
      });
    } catch (error) {
      logger.error(
        `Monitor template change ${row.id?.toString()}: could not record that it failed: ${error}`,
      );
    }
  }

  private static describeStartFailure(error: unknown): string {
    if (
      error instanceof NotAuthorizedException &&
      error.message ===
        WorkspaceActionAuthorization.NOT_A_PROJECT_MEMBER_MESSAGE
    ) {
      return "The person who asked for this change is no longer a member of the project, so it was stopped. What it changed is kept.";
    }

    return toText(error);
  }
}
