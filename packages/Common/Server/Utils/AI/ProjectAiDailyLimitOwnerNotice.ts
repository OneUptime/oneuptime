import { DashboardClientUrl } from "../../EnvironmentConfig";
import ProjectService from "../../Services/ProjectService";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import Project from "../../../Models/DatabaseModels/Project";
import URL from "../../../Types/API/URL";
import ProjectAiDailyLimits, {
  PROJECT_AI_DAILY_LIMIT_UPDATE_PERMISSIONS,
  PROJECT_AI_DAILY_LIMITS_LOCATION,
  ProjectAiDailyLimit,
  ProjectAiDailyUsage,
} from "../../../Types/AI/ProjectAiDailyLimits";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import SafeHtml from "../../../Types/SafeHtml";

/*
 * The project's owners hear when one of its own daily AI limits (Project
 * Settings → AI Features → More settings) stops OneUptime AI.
 *
 * Before this, nobody did: a limit that was reached refused and skipped AI
 * work, and the AI Logs, the folded settings section and the investigation
 * card said so, but the people who set the limit - and who may change it -
 * were not told. Now the first time a limit stops AI on a UTC day, the
 * project's owners get one email: which limit, what the project used of it
 * today, when it resets, and a link to change it. Once a day for each limit:
 * a token limit and a spend limit reached on the same day are two emails,
 * every refusal after the first that day is none.
 *
 * It reuses the email the product already sends the owners about billing
 * and limits (ProjectService.sendEmailToProjectOwners: a balance that could
 * not be recharged, a channel that is off), so it reaches the same people
 * the same way, appears in the project's email logs like them, and adds no
 * new channel or setting.
 *
 * Who is told today is decided by the project row: a single conditional
 * UPDATE of the limit's ...ReachedAt column (ProjectService.
 * markAiDailyLimitReached) that only the first caller of the day wins, on
 * any server. The row the caller already read usually says it was written
 * today, so in the steady state - every refused call after the first -
 * telling costs nothing; this process also remembers the days it has
 * settled, for callers whose row did not carry the column.
 *
 * It never throws and never changes what the caller does: a refusal is
 * refused, a skip skipped, whether or not the email could be sent. A day
 * whose claim could not be written (the database was unreachable) is tried
 * again by the next refusal; one whose email failed after the claim is not
 * sent twice.
 */

// What a reached limit carries, as AIService's status for it does.
export interface ReachedProjectAiDailyLimit {
  reachedLimit: ProjectAiDailyLimit | null;
  tokenLimit: number | null;
  spendLimitInUSD: number | null;
  usage: ProjectAiDailyUsage;
  resetsAt: Date;
}

export enum ProjectAiDailyLimitNoticeOutcome {
  // The limit was not reached: nothing to tell.
  NotReached = "NotReached",
  // This call was the day's first for the limit: the owners were emailed.
  Told = "Told",
  // They were told earlier today (here, on another server, or by the row).
  AlreadyTold = "AlreadyTold",
  // The day's claim or the email could not be made; logged.
  Failed = "Failed",
}

/*
 * The project's owners are the people this goes to, and the limit columns'
 * update permissions name them, so the email links straight to the setting.
 * Were that ever not so, it would say who can change the limits instead -
 * the link is shown only to people who may use it.
 */
export const OWNERS_MAY_CHANGE_PROJECT_AI_DAILY_LIMITS: boolean =
  PROJECT_AI_DAILY_LIMIT_UPDATE_PERMISSIONS.includes(Permission.ProjectOwner);

// Where the limits are in the dashboard, under a project's own route.
export const PROJECT_AI_DAILY_LIMITS_SETTINGS_PATH: string =
  "settings/ai-features";

/*
 * The (project, limit) pairs this process knows were told on a day, by
 * that day's start: it saves a database round trip per refused call for
 * callers whose project row did not carry the ...ReachedAt column. Bounded:
 * past days are dropped once it grows.
 */
const MAX_REMEMBERED_DAYS: number = 10_000;

export default class ProjectAiDailyLimitOwnerNotice {
  private static toldOn: Map<string, number> = new Map<string, number>();

  /*
   * Tell the project's owners that `status.reachedLimit` stopped OneUptime
   * AI, if nobody has today. `lastReachedAt` is the limit's ...ReachedAt
   * column as the caller read it: undefined when the caller's row did not
   * carry it (then the database decides).
   */
  @CaptureSpan()
  public static async notifyIfFirstToday(data: {
    projectId: ObjectID;
    status: ReachedProjectAiDailyLimit;
    lastReachedAt?: Date | null | undefined;
  }): Promise<ProjectAiDailyLimitNoticeOutcome> {
    const limit: ProjectAiDailyLimit | null = data.status.reachedLimit;

    if (!limit) {
      return ProjectAiDailyLimitNoticeOutcome.NotReached;
    }

    try {
      const now: Date = OneUptimeDate.getCurrentDate();
      const dayStart: number = ProjectAiDailyLimits.getDayStart(now).getTime();
      const key: string = `${data.projectId.toString()}:${limit}`;

      if (
        this.toldOn.get(key) === dayStart ||
        ProjectAiDailyLimits.isToday(data.lastReachedAt, now)
      ) {
        this.remember(key, dayStart);
        return ProjectAiDailyLimitNoticeOutcome.AlreadyTold;
      }

      const isFirstToday: boolean =
        await ProjectService.markAiDailyLimitReached({
          projectId: data.projectId,
          limit,
          now,
        });

      this.remember(key, dayStart);

      if (!isFirstToday) {
        return ProjectAiDailyLimitNoticeOutcome.AlreadyTold;
      }

      const project: Project | null = await ProjectService.findOneById({
        id: data.projectId,
        select: { name: true },
        props: { isRoot: true },
      });

      await ProjectService.sendEmailToProjectOwners(
        data.projectId,
        this.getSubject({ limit, projectName: project?.name }),
        this.getHtml({ projectId: data.projectId, status: data.status }),
      );

      return ProjectAiDailyLimitNoticeOutcome.Told;
    } catch (error) {
      logger.error(
        `AI: could not tell the owners of project ${data.projectId.toString()} that its daily AI ${
          limit === ProjectAiDailyLimit.Spend ? "spend" : "token"
        } limit was reached: ${error}`,
      );
      return ProjectAiDailyLimitNoticeOutcome.Failed;
    }
  }

  // "Daily AI token limit reached for Acme Production".
  public static getSubject(data: {
    limit: ProjectAiDailyLimit;
    projectName?: string | undefined;
  }): string {
    const kind: string =
      data.limit === ProjectAiDailyLimit.Spend ? "spend" : "token";

    return `Daily AI ${kind} limit reached for ${
      data.projectName?.trim() || "your project"
    }`;
  }

  /*
   * The email's body, as the HTML the owners' email places it in
   * (SimpleMessage's info block): which limit and what was used of it, until
   * when AI is paused, what happens to the incidents and alerts it skips
   * meanwhile, and where the limit is changed - with the link, for people
   * who may change it.
   */
  public static getHtml(data: {
    projectId: ObjectID;
    status: ReachedProjectAiDailyLimit;
    mayChangeLimits?: boolean | undefined;
  }): string {
    const mayChangeLimits: boolean =
      data.mayChangeLimits ?? OWNERS_MAY_CHANGE_PROJECT_AI_DAILY_LIMITS;

    const resetsAt: string =
      OneUptimeDate.getDateAsCustomFormattedStringInTimezone({
        date: data.status.resetsAt,
        format: "HH:mm [UTC on] MMM D, YYYY",
        timezone: "UTC",
      });

    const paused: string =
      data.status.reachedLimit === ProjectAiDailyLimit.Spend
        ? `AI billed to the project's AI credits is paused until ${resetsAt}, when the day's count starts again.`
        : `OneUptime AI is paused until ${resetsAt}, when the day's count starts again.`;

    const paragraphs: Array<string> = [
      SafeHtml.escape(
        `${ProjectAiDailyLimits.getReachedSentence(data.status)} ${paused}`,
      ),
      SafeHtml.escape(
        "Incidents and alerts that are not investigated while it is paused are investigated after the reset, if they are still open.",
      ),
    ];

    const settingsLink: URL | null = mayChangeLimits
      ? this.getSettingsLink(data.projectId)
      : null;

    if (!mayChangeLimits) {
      paragraphs.push(
        SafeHtml.escape(ProjectAiDailyLimits.getWhoCanChangeSentence()),
      );
    } else if (!settingsLink) {
      paragraphs.push(
        SafeHtml.escape(
          `To raise or remove the limit, go to ${PROJECT_AI_DAILY_LIMITS_LOCATION}.`,
        ),
      );
    } else {
      const link: string = SafeHtml.escape(settingsLink.toString());

      paragraphs.push(
        `${SafeHtml.escape(
          `To raise or remove the limit, go to ${PROJECT_AI_DAILY_LIMITS_LOCATION}:`,
        )} <br/> <a href="${link}">${link}</a>`,
      );
    }

    paragraphs.push(
      SafeHtml.escape(
        "Project owners get this email once a day for each limit, the first time it is reached.",
      ),
    );

    return paragraphs.join(" <br/> <br/> ");
  }

  /*
   * The project's AI Features settings page, which holds the limits under
   * More settings, or null when the dashboard's address is not configured
   * (no HOST): a link to "http:///dashboard" would help nobody, and the
   * sentence already says where the limits are. Built from the configured
   * address, like the other owner emails' links, so it reads nothing.
   */
  public static getSettingsLink(projectId: ObjectID): URL | null {
    if (!DashboardClientUrl || !DashboardClientUrl.hostname?.toString()) {
      return null;
    }

    return URL.fromString(DashboardClientUrl.toString()).addRoute(
      `/${projectId.toString()}/${PROJECT_AI_DAILY_LIMITS_SETTINGS_PATH}`,
    );
  }

  private static remember(key: string, dayStart: number): void {
    if (this.toldOn.size >= MAX_REMEMBERED_DAYS) {
      for (const [rememberedKey, rememberedDay] of this.toldOn) {
        if (rememberedDay !== dayStart) {
          this.toldOn.delete(rememberedKey);
        }
      }

      // Every entry is today's: start again rather than grow without end.
      if (this.toldOn.size >= MAX_REMEMBERED_DAYS) {
        this.toldOn.clear();
      }
    }

    this.toldOn.set(key, dayStart);
  }
}
