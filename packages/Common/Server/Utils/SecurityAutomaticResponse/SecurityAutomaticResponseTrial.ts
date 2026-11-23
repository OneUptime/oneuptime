import SecurityAutomaticResponsePolicy from "../../../Models/DatabaseModels/SecurityAutomaticResponsePolicy";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import {
  SecurityAutomaticResponseMode,
  SecurityAutomaticResponsePolicyKind,
  SecurityAutomaticResponseTrialState,
  getSecurityAutomaticResponseTrialState,
  hasSecurityAutomaticResponseTrialFinished,
  isSecurityAutomaticResponseMode,
} from "../../../Types/SecurityAutomaticResponse/SecurityAutomaticResponsePolicy";
import {
  SecurityAutomaticResponseTrialSummary,
  summarizeSecurityAutomaticResponseTrial,
} from "../../../Types/SecurityAutomaticResponse/SecurityAutomaticResponseSummary";
import { SecurityBlockAction } from "../../../Types/SecurityBlocklist/SecurityBlock";
import URL from "../../../Types/API/URL";
import { DashboardClientUrl } from "../../EnvironmentConfig";
import QueryHelper from "../../Types/Database/QueryHelper";
import SecurityAutomaticResponseActionService from "../../Services/SecurityAutomaticResponseActionService";
import SecurityAutomaticResponsePolicyService from "../../Services/SecurityAutomaticResponsePolicyService";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import SecurityAutomaticResponseOwners from "./SecurityAutomaticResponseOwners";
import ProductKey from "../../../Types/Product/ProductKey";
import ServerProducts from "../ServerProducts/ServerProducts";

/*
 * How often the trial sweep runs (AutomaticResponseSweeps: every minute),
 * and so how much later a running trial ends for each sweep that finds
 * Security Events switched off.
 */
export const SECURITY_AUTOMATIC_RESPONSE_TRIAL_SWEEP_INTERVAL_MS: number =
  60 * 1000;

// The running trials one paused sweep moves at a time, page by page.
const PAUSE_PAGE_SIZE: number = 500;

/*
 * WHERE A POLICY'S TRIAL RUN STANDS (#10350), for code beside the policies
 * that needs it: OneUptime AI working a case (#10352) lets its Edge row act
 * on its own only once the project's Scanners policy has finished a week
 * of trial run - the week that showed what automatic edge blocks would have
 * done to the project's own traffic - or once a Security Admin confirms.
 *
 * A finished trial is a whole week of recording (trialStartedAt to
 * trialEndsAt): one the policy is still in once its week is up, or one it
 * finished and was then turned on, or off, after. A trial skipped (turned
 * on before its week was up) or stopped part way never finished.
 */

export interface SecurityAutomaticResponseTrialRead {
  // The project's policy of that kind; null when it has none yet (it never opened its Automatic Response page).
  policyId: ObjectID | null;
  mode: SecurityAutomaticResponseMode;
  state: SecurityAutomaticResponseTrialState;
  // A whole week of trial run is behind it.
  hasFinishedTrial: boolean;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  trialFinishedAt: Date | null;
  trialSkippedAt: Date | null;
}

// The Automatic Response page, or null when the dashboard's address is not configured.
export function getAutomaticResponsePageLink(projectId: ObjectID): URL | null {
  if (!DashboardClientUrl || !DashboardClientUrl.hostname?.toString()) {
    return null;
  }

  return URL.fromString(DashboardClientUrl.toString()).addRoute(
    `/${projectId.toString()}/security-events/automatic-response`,
  );
}

// "1,283 addresses", "1 address".
function addresses(count: number): string {
  return count === 1
    ? "1 address"
    : `${count.toLocaleString("en-US")} addresses`;
}

/*
 * What a finished trial run would have done, as its email says it: "In 7
 * days this would have challenged 1,283 addresses. None had signed-in
 * users, and none were yours. Turn it on?"
 */
export function describeTrialFinished(data: {
  policyName: string;
  blockAction?: SecurityBlockAction | string | null | undefined;
  summary: SecurityAutomaticResponseTrialSummary;
  link: URL | null;
}): string {
  const { summary } = data;
  const verb: string =
    data.blockAction === SecurityBlockAction.Challenge
      ? "challenged"
      : "blocked";
  const lines: Array<string> = [
    `Your ${data.policyName} policy has run its week of trial run. In 7 days it would have ${verb} ${addresses(summary.wouldActOn)}.`,
  ];

  lines.push(
    summary.sparedSignedIn === 0 && summary.sparedProtected === 0
      ? "None had signed-in users, and none were yours."
      : `It left ${addresses(summary.sparedSignedIn)} alone because signed-in users had used them, and ${addresses(summary.sparedProtected)} because they are yours.`,
  );

  if (summary.wouldHaveLifted > 0) {
    lines.push(
      `A signed-in user was seen later from ${addresses(summary.wouldHaveLifted)} it would have blocked, so it would have lifted those blocks.`,
    );
  }

  if (summary.sparedCannotTell > 0) {
    lines.push(
      `It could not tell whether signed-in users had used ${addresses(summary.sparedCannotTell)}, so it left them for a person.`,
    );
  }

  if (summary.wouldHaveStopped > 0) {
    lines.push(
      `It would have reached the most automatic blocks your project makes in an hour ${summary.wouldHaveStopped === 1 ? "once" : `${summary.wouldHaveStopped} times`}, and paged your security owners.`,
    );
  }

  lines.push(
    data.link
      ? `Turn it on from the Automatic Response page: ${data.link.toString()}`
      : "Turn it on from Security Events -> Playbooks -> Automatic Response.",
  );

  return lines.join("\n\n");
}

function readDate(value: Date | string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const date: Date = new Date(value);

  return Number.isFinite(date.getTime()) ? date : null;
}

export default class SecurityAutomaticResponseTrial {
  /*
   * Where the project's policy of `kind` stands in its trial run. Throws
   * when the policy cannot be read; hasScannersPolicyFinishedTrial does not.
   */
  @CaptureSpan()
  public static async readTrial(data: {
    projectId: ObjectID;
    kind: SecurityAutomaticResponsePolicyKind;
    now?: Date | undefined;
  }): Promise<SecurityAutomaticResponseTrialRead> {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    const policy: SecurityAutomaticResponsePolicy | null =
      await SecurityAutomaticResponsePolicyService.findOneBy({
        query: { projectId: data.projectId, kind: data.kind },
        select: {
          _id: true,
          mode: true,
          trialStartedAt: true,
          trialEndsAt: true,
          trialFinishedAt: true,
          trialSkippedAt: true,
        },
        props: { isRoot: true },
      });

    if (!policy) {
      return {
        policyId: null,
        mode: SecurityAutomaticResponseMode.Off,
        state: SecurityAutomaticResponseTrialState.NotStarted,
        hasFinishedTrial: false,
        trialStartedAt: null,
        trialEndsAt: null,
        trialFinishedAt: null,
        trialSkippedAt: null,
      };
    }

    return {
      policyId: policy.id || null,
      mode: isSecurityAutomaticResponseMode(policy.mode)
        ? policy.mode
        : SecurityAutomaticResponseMode.Off,
      state: getSecurityAutomaticResponseTrialState(policy, now),
      hasFinishedTrial: hasSecurityAutomaticResponseTrialFinished(policy, now),
      trialStartedAt: readDate(policy.trialStartedAt),
      trialEndsAt: readDate(policy.trialEndsAt),
      trialFinishedAt: readDate(policy.trialFinishedAt),
      trialSkippedAt: readDate(policy.trialSkippedAt),
    };
  }

  /*
   * Every minute: each trial run whose week is up is written down as
   * finished, and the project's security owners are told what it would
   * have done and asked to turn it on - once, as trialFinishedAt is set
   * compare-and-set. How many finished.
   */
  @CaptureSpan()
  public static async finishDueTrials(now?: Date): Promise<number> {
    const at: Date = now || OneUptimeDate.getCurrentDate();

    /*
     * While Security Events is switched off, no policy decides, so a trial
     * run has nothing to count (#10816): its week stands still - each
     * sweep that finds it off ends every running trial one sweep later -
     * and none finishes, so its summary is a week of the project's traffic.
     */
    if (
      await ServerProducts.getOffReasonOfServerWork(ProductKey.SecurityEvents)
    ) {
      await this.pauseRunningTrials();
      return 0;
    }

    const due: Array<SecurityAutomaticResponsePolicy> =
      await SecurityAutomaticResponsePolicyService.findTrialsDue({
        now: at,
        limit: 100,
      });
    let finished: number = 0;

    for (const policy of due) {
      if (!policy.id || !policy.projectId || !policy.trialEndsAt) {
        continue;
      }

      try {
        const isFirst: boolean =
          await SecurityAutomaticResponsePolicyService.compareAndSetColumnsByIdWithoutHooks(
            {
              id: policy.id,
              data: { trialFinishedAt: new Date(policy.trialEndsAt) },
              expectedData: {
                trialFinishedAt: null as unknown as Date,
                mode: SecurityAutomaticResponseMode.TrialRun,
              },
            },
          );

        if (!isFirst) {
          continue;
        }

        finished++;

        const summary: SecurityAutomaticResponseTrialSummary =
          summarizeSecurityAutomaticResponseTrial(
            await SecurityAutomaticResponseActionService.findBy({
              query: {
                securityAutomaticResponsePolicyId: policy.id,
                isTrialRun: true,
                createdAt: QueryHelper.inBetween(
                  new Date(policy.trialStartedAt || policy.trialEndsAt),
                  new Date(policy.trialEndsAt),
                ),
              },
              select: {
                _id: true,
                value: true,
                outcome: true,
                doubtSeenAt: true,
              },
              skip: 0,
              limit: 20000,
              props: { isRoot: true },
            }),
          );

        await SecurityAutomaticResponseOwners.tell({
          projectId: policy.projectId,
          subject: `Your ${policy.name || "automatic response"} policy finished its trial run`,
          messageInMarkdown: describeTrialFinished({
            policyName: policy.name || "automatic response",
            blockAction: policy.blockAction,
            summary,
            link: getAutomaticResponsePageLink(policy.projectId),
          }),
        });
      } catch (error) {
        logger.error(
          `SecurityAutomaticResponseTrial: could not finish policy ${policy.id.toString()}'s trial run:`,
        );
        logger.error(error);
      }
    }

    return finished;
  }

  /*
   * Every running trial ends one sweep later, compare-and-set on its end so
   * two sweeps never move it twice for one minute. How many moved.
   */
  private static async pauseRunningTrials(): Promise<number> {
    let moved: number = 0;

    for (let skip: number = 0; ; skip += PAUSE_PAGE_SIZE) {
      const running: Array<SecurityAutomaticResponsePolicy> =
        await SecurityAutomaticResponsePolicyService.findBy({
          query: {
            mode: SecurityAutomaticResponseMode.TrialRun,
            trialFinishedAt: QueryHelper.isNull(),
          },
          select: { _id: true, trialEndsAt: true },
          sort: { createdAt: SortOrder.Ascending },
          skip,
          limit: PAUSE_PAGE_SIZE,
          props: { isRoot: true },
        });

      for (const policy of running) {
        if (!policy.id || !policy.trialEndsAt) {
          continue;
        }

        const endsAt: Date = new Date(policy.trialEndsAt);

        try {
          if (
            await SecurityAutomaticResponsePolicyService.compareAndSetColumnsByIdWithoutHooks(
              {
                id: policy.id,
                data: {
                  trialEndsAt: new Date(
                    endsAt.getTime() +
                      SECURITY_AUTOMATIC_RESPONSE_TRIAL_SWEEP_INTERVAL_MS,
                  ),
                },
                expectedData: {
                  trialEndsAt: endsAt,
                  mode: SecurityAutomaticResponseMode.TrialRun,
                },
              },
            )
          ) {
            moved++;
          }
        } catch (error) {
          logger.warn(
            `SecurityAutomaticResponseTrial: could not hold policy ${policy.id.toString()}'s trial run while Security Events is off: ${String(error)}`,
          );
        }
      }

      if (running.length < PAUSE_PAGE_SIZE) {
        return moved;
      }
    }
  }

  /*
   * Whether the project's Scanners policy has finished a whole week of trial
   * run. Never throws: a policy that cannot be read has not, so the caller
   * asks a Security Admin instead - fail toward a person.
   */
  @CaptureSpan()
  public static async hasScannersPolicyFinishedTrial(
    projectId: ObjectID,
    now?: Date,
  ): Promise<boolean> {
    try {
      const read: SecurityAutomaticResponseTrialRead = await this.readTrial({
        projectId,
        kind: SecurityAutomaticResponsePolicyKind.Scanners,
        now,
      });

      return read.hasFinishedTrial;
    } catch (error) {
      logger.warn(
        `SecurityAutomaticResponseTrial: could not read project ${projectId.toString()}'s Scanners policy, so its trial is read as not finished: ${String(error)}`,
      );
      return false;
    }
  }
}
