import Alert from "../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import CloudAccount from "../../../Models/DatabaseModels/CloudAccount";
import CloudCommitment from "../../../Models/DatabaseModels/CloudCommitment";
import CloudCostSetting from "../../../Models/DatabaseModels/CloudCostSetting";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import Team from "../../../Models/DatabaseModels/Team";
import User from "../../../Models/DatabaseModels/User";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import {
  CLOUD_COMMITMENT_DEFAULT_COVERAGE_THRESHOLD,
  CLOUD_COMMITMENT_DEFAULT_UTILIZATION_THRESHOLD,
  CloudCommitmentAlertDecision,
  CloudCommitmentAlertSettings,
  CloudCommitmentAlertState,
  CloudCommitmentResolution,
  CloudCoverageAlertDecision,
  CloudCoverageAlertState,
  CloudCoverageReading,
  decideCloudCommitmentAlerts,
  decideCloudCoverageAlerts,
  getCloudCoverageAlertKey,
  readCloudCommitmentAlertState,
  readCloudCommitmentExpiryDays,
  readCloudCommitmentPercentThreshold,
  readCloudCoverageAlertState,
} from "../../../Types/Cloud/CloudCommitmentAlerts";
import {
  CloudCommitmentFigures,
  CloudCommitmentState,
  isCloudCommitmentState,
  readCloudCommitmentFigures,
} from "../../../Types/Cloud/CloudCommitmentInventory";
import {
  CloudCommitmentKind,
  CloudCommitmentKindFigures,
  CloudCommitmentSummary,
  getCloudCommitmentCoveragePercent,
  getCloudCommitmentKindLabel,
} from "../../../Types/Cloud/CloudCommitments";
import {
  CloudAccountSavingsSummary,
  CloudCostState,
  readCloudAccountSavingsSummary,
} from "../../../Types/Cloud/CloudCost";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import { CLOUD_PLAN_DAYS_PER_MONTH } from "../../../Types/Cloud/CloudCommitmentPlans";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import AlertService from "../../Services/AlertService";
import AlertSeverityService from "../../Services/AlertSeverityService";
import AlertStateService from "../../Services/AlertStateService";
import AlertStateTimelineService from "../../Services/AlertStateTimelineService";
import CloudAccountService from "../../Services/CloudAccountService";
import CloudCommitmentService from "../../Services/CloudCommitmentService";
import CloudCostSettingService from "../../Services/CloudCostSettingService";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import CloudBudgetEvaluator, {
  formatCloudBudgetAlertDay,
  formatCloudBudgetAmount,
} from "./CloudBudgetEvaluator";

/*
 * WATCHES A PROJECT'S COMMITMENTS (#11011): raises an alert before each
 * commitment ends, while one is under-used, and when an account's coverage
 * falls - and resolves each once it no longer holds (CloudCommitmentAlerts
 * decides; this raises, resolves and keeps the state).
 *
 * The alerts are OneUptime alerts, like a budget's: their severity, the
 * on-call policies they page and the people and teams who own them - and
 * so are told - come from the project's cloud cost settings
 * (CloudCostSetting); alert owner rules add to them as to any alert. Each
 * carries a fingerprint of its commitment (or account) and what it is
 * about, so two workers never raise one twice.
 *
 * Runs after a connection reads its commitments (the project's), and every
 * hour (every project's): a commitment's days run out without a read.
 */

// What a commitment's alerts say it is, by its cloud and kind.
export function getCloudCommitmentNoun(data: {
  provider: string;
  kind: string;
}): string {
  if (data.provider === CloudProvider.AWS) {
    return data.kind === CloudCommitmentKind.SavingsPlans
      ? "Savings Plan"
      : "Reserved Instance";
  }

  if (data.provider === CloudProvider.Azure) {
    return data.kind === CloudCommitmentKind.SavingsPlans
      ? "Azure savings plan"
      : "Azure reservation";
  }

  return "Committed use discount";
}

// Why an alert was resolved, as its timeline says it.
export const CLOUD_COMMITMENT_RESOLUTION_WORDS: Readonly<
  Record<CloudCommitmentResolution, string>
> = {
  [CloudCommitmentResolution.Superseded]:
    "Resolved by OneUptime: a nearer alert for this commitment's end took over.",
  [CloudCommitmentResolution.Ended]:
    "Resolved by OneUptime: the commitment has ended, or there is nothing left for it to cover.",
  [CloudCommitmentResolution.Renewed]:
    "Resolved by OneUptime: the commitment renews itself, or a renewal starts when it ends.",
  [CloudCommitmentResolution.Gone]:
    "Resolved by OneUptime: the cloud no longer lists the commitment.",
  [CloudCommitmentResolution.Recovered]:
    "Resolved by OneUptime: it is back at or above the threshold.",
  [CloudCommitmentResolution.TurnedOff]:
    "Resolved by OneUptime: commitment alerts were turned off.",
};

// The project's commitment alert settings, read from its row.
export interface CloudCommitmentAlertConfiguration
  extends CloudCommitmentAlertSettings {
  coverageThreshold: number | null;
  severityId: ObjectID | null;
  onCallDutyPolicyIds: Array<ObjectID>;
  ownerUserIds: Array<ObjectID>;
  ownerTeamIds: Array<ObjectID>;
}

export function readCloudCommitmentAlertConfiguration(
  setting: CloudCostSetting,
): CloudCommitmentAlertConfiguration {
  const ids: (
    rows: Array<{ id?: ObjectID | null }> | undefined,
  ) => Array<ObjectID> = (
    rows: Array<{ id?: ObjectID | null }> | undefined,
  ): Array<ObjectID> => {
    return (rows || [])
      .map((row: { id?: ObjectID | null }): ObjectID | null => {
        return row.id || null;
      })
      .filter((id: ObjectID | null): id is ObjectID => {
        return id !== null;
      });
  };

  return {
    isEnabled: setting.isCommitmentAlertsEnabled !== false,
    expiryDays: readCloudCommitmentExpiryDays(
      setting.commitmentExpiryAlertDays,
    ),
    utilizationThreshold: readCloudCommitmentPercentThreshold(
      setting.commitmentUtilizationThreshold,
      CLOUD_COMMITMENT_DEFAULT_UTILIZATION_THRESHOLD,
    ),
    coverageThreshold:
      setting.commitmentCoverageThreshold === undefined
        ? CLOUD_COMMITMENT_DEFAULT_COVERAGE_THRESHOLD
        : readCloudCommitmentPercentThreshold(
            setting.commitmentCoverageThreshold,
            null,
          ),
    severityId: setting.commitmentAlertSeverityId || null,
    onCallDutyPolicyIds: ids(
      setting.commitmentOnCallDutyPolicies as Array<OnCallDutyPolicy>,
    ),
    ownerUserIds: ids(setting.commitmentAlertOwnerUsers as Array<User>),
    ownerTeamIds: ids(setting.commitmentAlertOwnerTeams as Array<Team>),
  };
}

/*
 * Whether a renewal of a commitment is queued: another of its cloud, kind,
 * account and type - and Region, for one that has one - queued to start
 * by the day after it ends.
 */
export function hasQueuedCloudCommitmentRenewal(data: {
  commitment: CloudCommitment;
  all: Array<CloudCommitment>;
}): boolean {
  const commitment: CloudCommitment = data.commitment;

  if (!commitment.endsAt) {
    return false;
  }

  const until: number =
    new Date(commitment.endsAt).getTime() + 24 * 60 * 60 * 1000;

  return data.all.some((other: CloudCommitment): boolean => {
    return (
      other.id?.toString() !== commitment.id?.toString() &&
      other.state === CloudCommitmentState.Queued &&
      other.provider === commitment.provider &&
      other.kind === commitment.kind &&
      other.cloudAccountId?.toString() ===
        commitment.cloudAccountId?.toString() &&
      (other.commitmentType || "") === (commitment.commitmentType || "") &&
      (!commitment.region || other.region === commitment.region) &&
      Boolean(other.startsAt) &&
      new Date(other.startsAt!).getTime() <= until
    );
  });
}

export default class CloudCommitmentAlertEvaluator {
  /*
   * What an expiry alert says: when the commitment ends, what it covers,
   * and what the usage it covered costs on demand once it does.
   */
  public static describeExpiry(data: {
    commitment: CloudCommitment;
    accountScope: string;
    daysLeft: number;
  }): { title: string; description: string } {
    const commitment: CloudCommitment = data.commitment;
    const noun: string = getCloudCommitmentNoun({
      provider: commitment.provider || "",
      kind: commitment.kind || "",
    });
    const name: string = commitment.name || commitment.commitmentId || "";
    const currency: string = commitment.currency || "USD";
    const when: string =
      data.daysLeft <= 0
        ? "today"
        : `in ${data.daysLeft} day${data.daysLeft === 1 ? "" : "s"}`;
    const endDay: string = commitment.endsAt
      ? formatCloudBudgetAlertDay(
          new Date(commitment.endsAt).toISOString().slice(0, 10),
          "long",
        )
      : "";
    const covers: string = [commitment.commitmentType, commitment.covers]
      .filter((part: string | undefined): boolean => {
        return Boolean(part);
      })
      .join(", ");
    const figures: CloudCommitmentFigures | null = readCloudCommitmentFigures(
      commitment.figures,
    );
    const sentences: Array<string> = [
      `${noun} ${name} in ${data.accountScope} ends ${when}${endDay ? `, on ${endDay}` : ""}.`,
    ];

    if (covers) {
      sentences.push(`It covers ${covers}.`);
    }

    if (
      figures &&
      figures.coveredOnDemandCost !== null &&
      figures.commitmentCost !== null
    ) {
      const toMonth: number = CLOUD_PLAN_DAYS_PER_MONTH / figures.days;
      const onDemand: number = figures.coveredOnDemandCost * toMonth;
      const more: number = onDemand - figures.commitmentCost * toMonth;

      sentences.push(
        `Over the last ${figures.days} days it paid for usage that costs ${formatCloudBudgetAmount(
          figures.coveredOnDemandCost,
          currency,
        )} at on-demand rates, for ${formatCloudBudgetAmount(
          figures.commitmentCost,
          currency,
        )}. Once it ends, that usage costs about ${formatCloudBudgetAmount(
          onDemand,
          currency,
        )} a month on demand${more > 0 ? `: ${formatCloudBudgetAmount(more, currency)} a month more` : ""}.`,
      );
    } else if (commitment.utilizationPercent !== undefined) {
      sentences.push(
        `Its cloud does not say what it covers in money; over the last 30 days it was ${Math.round(
          Number(commitment.utilizationPercent) || 0,
        )}% used.`,
      );
    }

    sentences.push(
      "Its renewal plan, with what to buy and what it saves, is on Cloud > Spend > Commitments.",
    );

    return {
      title: `${noun} ${name} ends ${when}`,
      description: sentences.join(" "),
    };
  }

  // What an under-use alert says: how much was used, and what the rest cost.
  public static describeUnderUse(data: {
    commitment: CloudCommitment;
    accountScope: string;
    utilizationPercent: number;
    threshold: number;
  }): { title: string; description: string } {
    const commitment: CloudCommitment = data.commitment;
    const noun: string = getCloudCommitmentNoun({
      provider: commitment.provider || "",
      kind: commitment.kind || "",
    });
    const name: string = commitment.name || commitment.commitmentId || "";
    const percent: number = Math.round(data.utilizationPercent);
    const currency: string = commitment.currency || "USD";
    const figures: CloudCommitmentFigures | null = readCloudCommitmentFigures(
      commitment.figures,
    );
    const sentences: Array<string> = [
      `${noun} ${name} in ${data.accountScope} was ${percent}% used over the last 7 days, under the ${data.threshold}% commitments alert at.`,
    ];

    if (
      figures?.weekUnusedCost !== null &&
      figures?.weekUnusedCost !== undefined
    ) {
      sentences.push(
        `Its unused part cost ${formatCloudBudgetAmount(
          figures.weekUnusedCost,
          currency,
        )} this week, about ${formatCloudBudgetAmount(
          (figures.weekUnusedCost * CLOUD_PLAN_DAYS_PER_MONTH) / 7,
          currency,
        )} a month.`,
      );
    }

    sentences.push(
      "Move eligible usage onto it, or renew it smaller when it ends: its renewal plan is on Cloud > Spend > Commitments.",
    );

    return {
      title: `${noun} ${name} was ${percent}% used over the last 7 days`,
      description: sentences.join(" "),
    };
  }

  // What a coverage alert says: how far coverage fell, and what ran on demand.
  public static describeCoverage(data: {
    provider: string;
    kind: CloudCommitmentKind;
    accountScope: string;
    percent: number;
    previousPercent: number;
    threshold: number;
    onDemandSpend: number;
    currency: string;
  }): { title: string; description: string } {
    const label: string = getCloudCommitmentKindLabel({
      provider: data.provider,
      kind: data.kind,
    });

    return {
      title: `${label} cover ${Math.round(data.percent)}% of ${data.accountScope}'s eligible spend`,
      description: `Over the last 30 days, ${label} covered ${Math.round(
        data.percent,
      )}% of the spend in ${data.accountScope} they could cover, down from ${Math.round(
        data.previousPercent,
      )}%, under the ${data.threshold}% commitments alert at. ${formatCloudBudgetAmount(
        data.onDemandSpend,
        data.currency,
      )} ran at on-demand rates. A commitment may have ended: Cloud > Spend > Commitments says what to renew or buy.`,
    };
  }

  // Every project with commitments or cloud cost settings: the hourly worker.
  @CaptureSpan()
  public static async evaluateAll(): Promise<number> {
    const projectIds: Set<string> = new Set<string>();

    for (const row of await CloudCommitmentService.findBy({
      query: {},
      select: { projectId: true },
      skip: 0,
      limit: LIMIT_MAX,
      props: { isRoot: true },
    })) {
      if (row.projectId) {
        projectIds.add(row.projectId.toString());
      }
    }

    for (const row of await CloudCostSettingService.findBy({
      query: {},
      select: { projectId: true },
      skip: 0,
      limit: LIMIT_MAX,
      props: { isRoot: true },
    })) {
      if (row.projectId) {
        projectIds.add(row.projectId.toString());
      }
    }

    for (const projectId of projectIds) {
      await CloudCommitmentAlertEvaluator.evaluateProject(
        new ObjectID(projectId),
      );
    }

    return projectIds.size;
  }

  /*
   * One project's commitments and coverage. Never throws: one project's
   * trouble is logged and never stops the others.
   */
  @CaptureSpan()
  public static async evaluateProject(projectId: ObjectID): Promise<void> {
    try {
      const now: Date = OneUptimeDate.getCurrentDate();
      const setting: CloudCostSetting =
        await CloudCostSettingService.getOrCreateForProject(projectId);
      const configuration: CloudCommitmentAlertConfiguration =
        readCloudCommitmentAlertConfiguration(setting);
      const accounts: Array<CloudAccount> = await CloudAccountService.findBy({
        query: { projectId },
        select: {
          _id: true,
          name: true,
          provider: true,
          accountId: true,
          savingsSummary: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: { isRoot: true },
      });
      const accountsById: Map<string, CloudAccount> = new Map();

      for (const account of accounts) {
        if (account.id) {
          accountsById.set(account.id.toString(), account);
        }
      }

      const commitments: Array<CloudCommitment> =
        await CloudCommitmentService.findBy({
          query: { projectId },
          select: {
            _id: true,
            cloudAccountId: true,
            provider: true,
            kind: true,
            commitmentId: true,
            name: true,
            commitmentType: true,
            covers: true,
            region: true,
            state: true,
            startsAt: true,
            endsAt: true,
            isAutoRenew: true,
            currency: true,
            utilizationPercent: true,
            weekUtilizationPercent: true,
            figures: true,
            alertState: true,
          },
          sort: { endsAt: SortOrder.Ascending },
          skip: 0,
          limit: LIMIT_MAX,
          props: { isRoot: true },
        });

      for (const commitment of commitments) {
        await CloudCommitmentAlertEvaluator.evaluateCommitment({
          projectId,
          commitment,
          all: commitments,
          configuration,
          account: accountsById.get(
            commitment.cloudAccountId?.toString() || "",
          ),
          now,
        });
      }

      await CloudCommitmentAlertEvaluator.evaluateCoverage({
        projectId,
        setting,
        configuration,
        accounts,
      });
    } catch (error) {
      logger.error(
        `Cloud commitments of project ${projectId.toString()} could not be checked: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // One commitment: its alerts raised and resolved, and its state kept.
  private static async evaluateCommitment(data: {
    projectId: ObjectID;
    commitment: CloudCommitment;
    all: Array<CloudCommitment>;
    configuration: CloudCommitmentAlertConfiguration;
    account: CloudAccount | undefined;
    now: Date;
  }): Promise<void> {
    const commitment: CloudCommitment = data.commitment;

    if (!commitment.id) {
      return;
    }

    const previous: CloudCommitmentAlertState = readCloudCommitmentAlertState(
      commitment.alertState,
    );
    const decision: CloudCommitmentAlertDecision = decideCloudCommitmentAlerts({
      facts: {
        state: isCloudCommitmentState(commitment.state)
          ? commitment.state
          : CloudCommitmentState.Active,
        startsAt: commitment.startsAt
          ? new Date(commitment.startsAt)
          : undefined,
        endsAt: commitment.endsAt ? new Date(commitment.endsAt) : undefined,
        isAutoRenew: commitment.isAutoRenew === true,
        hasQueuedRenewal: hasQueuedCloudCommitmentRenewal({
          commitment,
          all: data.all,
        }),
        weekUtilizationPercent:
          commitment.weekUtilizationPercent === undefined ||
          commitment.weekUtilizationPercent === null
            ? null
            : Number(commitment.weekUtilizationPercent),
        isListed: true,
      },
      state: previous,
      settings: data.configuration,
      now: data.now,
    });

    for (const entry of decision.resolve) {
      await CloudCommitmentAlertEvaluator.resolveAlert({
        projectId: data.projectId,
        alertId: new ObjectID(entry.alertId),
        reason: entry.reason,
      });
    }

    const accountScope: string = data.account
      ? CloudBudgetEvaluator.getAccountScope(data.account)
      : "its cloud";

    if (decision.raiseExpiry) {
      const words: { title: string; description: string } =
        CloudCommitmentAlertEvaluator.describeExpiry({
          commitment,
          accountScope,
          daysLeft: decision.raiseExpiry.daysLeft,
        });
      const alertId: ObjectID | null =
        await CloudCommitmentAlertEvaluator.raise({
          projectId: data.projectId,
          fingerprint: `cloud-commitment:${commitment.id.toString()}:expiry-${decision.raiseExpiry.threshold}`,
          words,
          configuration: data.configuration,
        });

      if (alertId) {
        decision.state.expiryAlertId = alertId.toString();
      }
    }

    if (
      decision.raiseUnderUse &&
      data.configuration.utilizationThreshold !== null
    ) {
      const words: { title: string; description: string } =
        CloudCommitmentAlertEvaluator.describeUnderUse({
          commitment,
          accountScope,
          utilizationPercent: decision.raiseUnderUse.utilizationPercent,
          threshold: data.configuration.utilizationThreshold,
        });
      const alertId: ObjectID | null =
        await CloudCommitmentAlertEvaluator.raise({
          projectId: data.projectId,
          fingerprint: `cloud-commitment:${commitment.id.toString()}:under-use`,
          words,
          configuration: data.configuration,
        });

      if (alertId) {
        decision.state.underUseAlertId = alertId.toString();
      }
    }

    if (JSON.stringify(decision.state) !== JSON.stringify(previous)) {
      await CloudCommitmentService.updateOneById({
        id: commitment.id,
        data: {
          alertState: decision.state as unknown as JSONObject,
        } as never,
        props: { isRoot: true, ignoreHooks: true },
      });
    }
  }

  /*
   * Each account's coverage by each kind of commitment, from its savings
   * summary (read once a day): a fall under the threshold alerts, a return
   * resolves. Kept on the project's settings.
   */
  private static async evaluateCoverage(data: {
    projectId: ObjectID;
    setting: CloudCostSetting;
    configuration: CloudCommitmentAlertConfiguration;
    accounts: Array<CloudAccount>;
  }): Promise<void> {
    const readings: Array<CloudCoverageReading> = [];
    const facts: Map<
      string,
      {
        account: CloudAccount;
        figures: CloudCommitmentKindFigures;
        currency: string;
      }
    > = new Map();

    for (const account of data.accounts) {
      const savings: CloudAccountSavingsSummary | null =
        readCloudAccountSavingsSummary(account.savingsSummary);
      const summary: CloudCommitmentSummary | undefined = savings?.commitments;

      if (!account.id || !summary || summary.state !== CloudCostState.Reading) {
        continue;
      }

      for (const figures of summary.kinds) {
        const key: string = getCloudCoverageAlertKey({
          accountRowId: account.id.toString(),
          kind: figures.kind,
        });

        readings.push({
          key,
          percent: getCloudCommitmentCoveragePercent(figures),
        });
        facts.set(key, { account, figures, currency: summary.currency });
      }
    }

    const previous: CloudCoverageAlertState = readCloudCoverageAlertState(
      data.setting.commitmentAlertState,
    );
    const decision: CloudCoverageAlertDecision = decideCloudCoverageAlerts({
      readings,
      state: previous,
      threshold: data.configuration.coverageThreshold,
      isEnabled: data.configuration.isEnabled,
    });

    for (const entry of decision.resolve) {
      await CloudCommitmentAlertEvaluator.resolveAlert({
        projectId: data.projectId,
        alertId: new ObjectID(entry.alertId),
        reason: entry.reason,
      });
    }

    for (const entry of decision.raise) {
      const fact:
        | {
            account: CloudAccount;
            figures: CloudCommitmentKindFigures;
            currency: string;
          }
        | undefined = facts.get(entry.key);

      if (!fact || data.configuration.coverageThreshold === null) {
        continue;
      }

      const alertId: ObjectID | null =
        await CloudCommitmentAlertEvaluator.raise({
          projectId: data.projectId,
          fingerprint: `cloud-commitment-coverage:${entry.key}`,
          words: CloudCommitmentAlertEvaluator.describeCoverage({
            provider: (fact.account.provider as string) || "",
            kind: fact.figures.kind,
            accountScope: CloudBudgetEvaluator.getAccountScope(fact.account),
            percent: entry.percent,
            previousPercent: entry.previousPercent,
            threshold: data.configuration.coverageThreshold,
            onDemandSpend: fact.figures.onDemandSpend,
            currency: fact.currency,
          }),
          configuration: data.configuration,
        });

      if (alertId && decision.state[entry.key]) {
        decision.state[entry.key]!.alertId = alertId.toString();
      }
    }

    if (JSON.stringify(decision.state) !== JSON.stringify(previous)) {
      await CloudCostSettingService.updateOneById({
        id: data.setting.id!,
        data: {
          commitmentAlertState: {
            coverage: decision.state,
          } as unknown as JSONObject,
        } as never,
        props: { isRoot: true, ignoreHooks: true },
      });
    }
  }

  // Resolves the open alerts of commitments the cloud no longer lists.
  public static async resolveGone(data: {
    projectId: ObjectID;
    alertIds: Array<string>;
  }): Promise<void> {
    for (const alertId of data.alertIds) {
      if (ObjectID.isValidUUID(alertId)) {
        await CloudCommitmentAlertEvaluator.resolveAlert({
          projectId: data.projectId,
          alertId: new ObjectID(alertId),
          reason: CloudCommitmentResolution.Gone,
        });
      }
    }
  }

  // The severity of the alerts: the settings', else the project's least severe.
  private static async getSeverityId(data: {
    projectId: ObjectID;
    configuration: CloudCommitmentAlertConfiguration;
  }): Promise<ObjectID | null> {
    if (data.configuration.severityId) {
      return data.configuration.severityId;
    }

    const severity: AlertSeverity | null = await AlertSeverityService.findOneBy(
      {
        query: { projectId: data.projectId },
        select: { _id: true },
        sort: { order: SortOrder.Descending },
        props: { isRoot: true },
      },
    );

    return severity?.id || null;
  }

  /*
   * One alert, unless one of its fingerprint is open already (two workers
   * at once). Returns the alert's id, or null when none was raised.
   */
  private static async raise(data: {
    projectId: ObjectID;
    fingerprint: string;
    words: { title: string; description: string };
    configuration: CloudCommitmentAlertConfiguration;
  }): Promise<ObjectID | null> {
    const open: Array<Alert> = await AlertService.findBy({
      query: {
        projectId: data.projectId,
        seriesFingerprint: data.fingerprint,
        currentAlertStateId: new Includes(
          await AlertStateService.getUnresolvedAlertStateIds(data.projectId),
        ),
      },
      select: { _id: true },
      skip: 0,
      limit: 1,
      props: { isRoot: true },
    });

    if (open.length > 0) {
      return open[0]!.id || null;
    }

    const severityId: ObjectID | null =
      await CloudCommitmentAlertEvaluator.getSeverityId(data);

    if (!severityId) {
      logger.error(
        `Cloud commitments of project ${data.projectId.toString()}: the project has no alert severity, so an alert could not be raised.`,
      );
      return null;
    }

    const alert: Alert = new Alert();
    alert.projectId = data.projectId;
    alert.title = data.words.title;
    alert.description = data.words.description;
    alert.alertSeverityId = severityId;
    alert.seriesFingerprint = data.fingerprint;
    alert.isCreatedAutomatically = true;

    if (data.configuration.onCallDutyPolicyIds.length > 0) {
      alert.onCallDutyPolicies = data.configuration.onCallDutyPolicyIds.map(
        (id: ObjectID): OnCallDutyPolicy => {
          const stub: OnCallDutyPolicy = new OnCallDutyPolicy();
          stub.id = id;
          return stub;
        },
      );
    }

    const hasOwners: boolean =
      data.configuration.ownerUserIds.length > 0 ||
      data.configuration.ownerTeamIds.length > 0;
    const created: Alert = await AlertService.create({
      data: alert,
      props: { isRoot: true },
      ...(hasOwners
        ? {
            miscDataProps: {
              ownerUsers: data.configuration.ownerUserIds,
              ownerTeams: data.configuration.ownerTeamIds,
            } as unknown as JSONObject,
          }
        : {}),
    });

    return created?.id || null;
  }

  // Resolves an alert; one resolved already is left as it is.
  private static async resolveAlert(data: {
    projectId: ObjectID;
    alertId: ObjectID;
    reason: CloudCommitmentResolution;
  }): Promise<void> {
    try {
      const timeline: AlertStateTimeline = new AlertStateTimeline();
      timeline.alertId = data.alertId;
      timeline.projectId = data.projectId;
      timeline.alertStateId =
        await AlertStateTimelineService.getResolvedStateIdForProject(
          data.projectId,
        );
      timeline.rootCause = CLOUD_COMMITMENT_RESOLUTION_WORDS[data.reason];

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
        `A cloud commitment alert ${data.alertId.toString()} could not be resolved: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
