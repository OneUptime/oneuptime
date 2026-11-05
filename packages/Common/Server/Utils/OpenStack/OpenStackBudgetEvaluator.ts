import Alert from "../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OpenStackBudget from "../../../Models/DatabaseModels/OpenStackBudget";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import {
  daysInUtcMonth,
  readCloudBudgetThresholds,
} from "../../../Types/Cloud/CloudCost";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  OpenStackSpendProject,
  OpenStackSpendSnapshot,
} from "../../../Types/OpenStack/OpenStackSpendSnapshot";
import AlertService from "../../Services/AlertService";
import AlertSeverityService from "../../Services/AlertSeverityService";
import AlertStateService from "../../Services/AlertStateService";
import AlertStateTimelineService from "../../Services/AlertStateTimelineService";
import OpenStackBudgetService from "../../Services/OpenStackBudgetService";
import CloudBudgetEvaluator, {
  CloudBudgetAlertKind,
  CloudBudgetDecision,
  CloudBudgetSpend,
  formatCloudBudgetAmount,
  readCloudBudgetAlertState,
} from "../CloudConnection/CloudBudgetEvaluator";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * WATCHES A CLOUD'S OPENSTACK BUDGETS.
 *
 * The same pattern as a connected cloud's budgets, and the same decision: CloudBudgetEvaluator.decide
 * says what a budget raises from what it has spent, where that's heading and what it said already
 * this month. What differs is where the figures come from, a project's estimate as this reading
 * worked it out, and the words, which say estimate, because nobody's being asked to pay anything.
 *
 * While nothing has a price or a rate, there's nothing to compare, so a budget stays quiet and its
 * row says it hasn't been checked. That's a budget with no figures. It isn't a budget in good shape.
 */

export interface OpenStackBudgetSpend {
  spent: number | null;
  projected: number | null;
}

// What a budget reads: one project's figures, or the whole cloud's with no project named.
export function getOpenStackBudgetSpend(data: {
  openStackProjectId: string | null | undefined;
  snapshot: OpenStackSpendSnapshot;
  projects: ReadonlyArray<OpenStackSpendProject>;
}): OpenStackBudgetSpend {
  if (!data.openStackProjectId) {
    return {
      spent: data.snapshot.thisMonth,
      projected: data.snapshot.onCourseFor,
    };
  }

  const project: OpenStackSpendProject | undefined = data.projects.find(
    (entry: OpenStackSpendProject): boolean => {
      return entry.openStackProjectId === data.openStackProjectId;
    },
  );

  return {
    spent: project?.thisMonth ?? null,
    projected: project?.onCourseFor ?? null,
  };
}

export function getOpenStackBudgetFingerprint(data: {
  budgetId: string;
  month: string;
  alert: CloudBudgetAlertKind;
}): string {
  return `openstack-budget:${data.budgetId}:${data.month}:${
    data.alert.kind === "threshold"
      ? `threshold-${data.alert.threshold}`
      : "projection"
  }`;
}

export function describeOpenStackBudgetAlert(data: {
  budgetName: string;
  scope: string;
  amount: number;
  currency: string;
  spent: number;
  projected: number;
  alert: CloudBudgetAlertKind;
  now: Date;
}): { title: string; description: string } {
  const amount: string = formatCloudBudgetAmount(data.amount, data.currency);
  const spent: string = formatCloudBudgetAmount(data.spent, data.currency);
  const projected: string = formatCloudBudgetAmount(
    data.projected,
    data.currency,
  );
  const percent: number =
    data.amount > 0 ? Math.round((data.spent / data.amount) * 100) : 0;
  const daysLeft: number = Math.max(
    0,
    daysInUtcMonth(data.now) - data.now.getUTCDate(),
  );
  const daysWord: string = daysLeft === 1 ? "day" : "days";

  if (data.alert.kind === "threshold") {
    return {
      title: `OpenStack budget "${data.budgetName}" passed ${data.alert.threshold}%`,
      description: `This month's estimated usage of ${data.scope} is ${spent} of the ${amount} budget (${percent}%), with ${daysLeft} ${daysWord} of the month to go. Holding what it holds now, the month is on course for ${projected}. This is an estimate from your own prices or CloudKitty's rates, not a bill.`,
    };
  }

  return {
    title: `OpenStack budget "${data.budgetName}" is on course to be passed`,
    description: `Holding what it holds now, this month's estimated usage of ${data.scope} is on course for ${projected}, over the ${amount} budget. ${spent} (${percent}%) has been used so far, with ${daysLeft} ${daysWord} to go. This is an estimate from your own prices or CloudKitty's rates, not a bill.`,
  };
}

export default class OpenStackBudgetEvaluator {
  private static readonly BUDGET_SELECT: {
    _id: true;
    projectId: true;
    name: true;
    isEnabled: true;
    openStackProjectId: true;
    monthlyAmount: true;
    alertThresholds: true;
    alertOnProjection: true;
    alertSeverityId: true;
    alertState: true;
    onCallDutyPolicies: { _id: true };
  } = {
    _id: true,
    projectId: true,
    name: true,
    isEnabled: true,
    openStackProjectId: true,
    monthlyAmount: true,
    alertThresholds: true,
    alertOnProjection: true,
    alertSeverityId: true,
    alertState: true,
    onCallDutyPolicies: { _id: true },
  };

  // A cloud's budgets, on what a reading just worked out. One budget's trouble stops none of the others.
  @CaptureSpan()
  public static async evaluateCloud(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    cloudName: string;
    snapshot: OpenStackSpendSnapshot;
    projects: ReadonlyArray<OpenStackSpendProject>;
    now: Date;
  }): Promise<number> {
    const budgets: Array<OpenStackBudget> = await OpenStackBudgetService.findBy(
      {
        query: {
          projectId: data.projectId,
          openStackCloudId: data.openStackCloudId,
          isEnabled: true,
        },
        select: OpenStackBudgetEvaluator.BUDGET_SELECT,
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: { isRoot: true },
      },
    );

    for (const budget of budgets) {
      await OpenStackBudgetEvaluator.evaluate({ ...data, budget });
    }

    return budgets.length;
  }

  private static async evaluate(data: {
    budget: OpenStackBudget;
    cloudName: string;
    snapshot: OpenStackSpendSnapshot;
    projects: ReadonlyArray<OpenStackSpendProject>;
    now: Date;
  }): Promise<void> {
    const { budget, snapshot, now } = data;

    if (!budget.id || !budget.projectId) {
      return;
    }

    try {
      const spend: OpenStackBudgetSpend = getOpenStackBudgetSpend({
        openStackProjectId: budget.openStackProjectId,
        snapshot,
        projects: data.projects,
      });
      const isKnown: boolean = spend.spent !== null;
      const amount: number = Number(budget.monthlyAmount) || 0;

      // A month's alerts and thresholds, by the same decision every cloud budget takes.
      const asSpend: CloudBudgetSpend = {
        spent: spend.spent ?? 0,
        projected: spend.projected ?? spend.spent ?? 0,
        accountsCounted: isKnown ? 1 : 0,
        accountsInOtherCurrencies: 0,
        topServices: [],
      };
      const decision: CloudBudgetDecision = CloudBudgetEvaluator.decide({
        amount,
        thresholds: readCloudBudgetThresholds(budget.alertThresholds),
        alertOnProjection: budget.alertOnProjection !== false,
        spend: asSpend,
        state: readCloudBudgetAlertState(budget.alertState),
        now,
      });

      for (const alertId of decision.resolveAlertIds) {
        await OpenStackBudgetEvaluator.resolveAlert({
          projectId: budget.projectId,
          alertId: new ObjectID(alertId),
        });
      }

      for (const kind of decision.raise) {
        const alertId: ObjectID | null = await OpenStackBudgetEvaluator.raise({
          budget,
          scope: OpenStackBudgetEvaluator.getScope(data),
          amount,
          currency: snapshot.currency || "USD",
          spent: asSpend.spent,
          projected: asSpend.projected,
          alert: kind,
          month: decision.state.month,
          now,
        });

        if (alertId) {
          decision.state.alertIds.push(alertId.toString());
        }
      }

      await OpenStackBudgetService.updateOneById({
        id: budget.id,
        data: {
          spentThisMonth: isKnown ? asSpend.spent : null,
          projectedThisMonth: isKnown ? asSpend.projected : null,
          lastCheckedAt: isKnown ? now : null,
          alertState: decision.state as unknown as JSONObject,
        } as never,
        props: { isRoot: true, ignoreHooks: true },
      });
    } catch (error) {
      logger.error(
        `OpenStack budget ${budget.id.toString()} could not be checked: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private static getScope(data: {
    budget: OpenStackBudget;
    cloudName: string;
    projects: ReadonlyArray<OpenStackSpendProject>;
  }): string {
    const id: string | undefined = data.budget.openStackProjectId;

    if (!id) {
      return `the whole of OpenStack cloud ${data.cloudName}`;
    }

    const project: OpenStackSpendProject | undefined = data.projects.find(
      (entry: OpenStackSpendProject): boolean => {
        return entry.openStackProjectId === id;
      },
    );

    return `project ${project?.name || id} of OpenStack cloud ${data.cloudName}`;
  }

  // The severity of a budget's alerts: its own, else the project's least severe.
  private static async getSeverityId(
    budget: OpenStackBudget,
  ): Promise<ObjectID | null> {
    if (budget.alertSeverityId) {
      return budget.alertSeverityId;
    }

    const severity: AlertSeverity | null = await AlertSeverityService.findOneBy(
      {
        query: { projectId: budget.projectId! },
        select: { _id: true },
        sort: { order: SortOrder.Descending },
        props: { isRoot: true },
      },
    );

    return severity?.id || null;
  }

  private static async raise(data: {
    budget: OpenStackBudget;
    scope: string;
    amount: number;
    currency: string;
    spent: number;
    projected: number;
    alert: CloudBudgetAlertKind;
    month: string;
    now: Date;
  }): Promise<ObjectID | null> {
    const projectId: ObjectID = data.budget.projectId!;
    const fingerprint: string = getOpenStackBudgetFingerprint({
      budgetId: data.budget.id!.toString(),
      month: data.month,
      alert: data.alert,
    });

    const open: Array<Alert> = await AlertService.findBy({
      query: {
        projectId,
        seriesFingerprint: fingerprint,
        currentAlertStateId: new Includes(
          await AlertStateService.getUnresolvedAlertStateIds(projectId),
        ),
      },
      select: { _id: true },
      skip: 0,
      limit: 1,
      props: { isRoot: true },
    });

    if (open.length > 0) {
      return null;
    }

    const severityId: ObjectID | null =
      await OpenStackBudgetEvaluator.getSeverityId(data.budget);

    if (!severityId) {
      logger.error(
        `OpenStack budget ${data.budget.id!.toString()}: the project has no alert severity, so its alert could not be raised.`,
      );
      return null;
    }

    const words: { title: string; description: string } =
      describeOpenStackBudgetAlert({
        budgetName: data.budget.name || "OpenStack budget",
        scope: data.scope,
        amount: data.amount,
        currency: data.currency,
        spent: data.spent,
        projected: data.projected,
        alert: data.alert,
        now: data.now,
      });

    const alert: Alert = new Alert();
    alert.projectId = projectId;
    alert.title = words.title;
    alert.description = words.description;
    alert.alertSeverityId = severityId;
    alert.seriesFingerprint = fingerprint;
    alert.isCreatedAutomatically = true;

    const policies: Array<OnCallDutyPolicy> = (
      data.budget.onCallDutyPolicies || []
    ).filter((policy: OnCallDutyPolicy): boolean => {
      return Boolean(policy.id);
    });

    if (policies.length > 0) {
      alert.onCallDutyPolicies = policies.map(
        (policy: OnCallDutyPolicy): OnCallDutyPolicy => {
          const stub: OnCallDutyPolicy = new OnCallDutyPolicy();
          stub.id = policy.id!;
          return stub;
        },
      );
    }

    const created: Alert = await AlertService.create({
      data: alert,
      props: { isRoot: true },
    });

    return created?.id || null;
  }

  private static async resolveAlert(data: {
    projectId: ObjectID;
    alertId: ObjectID;
  }): Promise<void> {
    try {
      const timeline: AlertStateTimeline = new AlertStateTimeline();
      timeline.alertId = data.alertId;
      timeline.projectId = data.projectId;
      timeline.alertStateId =
        await AlertStateTimelineService.getResolvedStateIdForProject(
          data.projectId,
        );
      timeline.rootCause =
        "Resolved by OneUptime: the month this OpenStack budget alert was raised in is over.";

      await AlertStateTimelineService.create({
        data: timeline,
        props: { isRoot: true },
      });
    } catch (error) {
      if (
        error instanceof BadDataException &&
        error.message === "Alert state cannot be same as previous state."
      ) {
        return;
      }

      logger.error(
        `An OpenStack budget alert ${data.alertId.toString()} could not be resolved: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
