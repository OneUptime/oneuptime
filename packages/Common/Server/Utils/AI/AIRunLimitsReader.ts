import { DashboardClientUrl } from "../../EnvironmentConfig";
import ProjectService from "../../Services/ProjectService";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import Project from "../../../Models/DatabaseModels/Project";
import URL from "../../../Types/API/URL";
import AIAgentRunLimitsHelper, {
  AIAgentRunLimits,
  AIRunStopReason,
  AIRunTimeLimitSource,
  CHAT_APP_ANSWER_TIME_LIMIT_IN_MINUTES,
} from "../../../Types/AI/AIAgentRunLimits";
import ObjectID from "../../../Types/ObjectID";

/*
 * The limits of one OneUptime AI run, read from its project (issue #6440):
 * the caps the project set for every run (Project Settings → AI → AI
 * Features → More settings → Limits per run), and the most specific time
 * limit - the lane's for an incident or alert investigation, then the
 * project's, then the default (Types/AI/AIAgentRunLimits).
 *
 * Read once when a run starts (and again when an Ask AI answer resumes after
 * an approval), so a limit changed mid-run applies from the next run on.
 */

// An investigation's lane, whose own time limit comes first.
export type AIRunLane = "Incident" | "Alert";

/*
 * Where each limit's card is in the Dashboard, under a project's own route,
 * and the card's place on its page: a link to it opens More settings there
 * (Utils/PageAnchor). The lane pages' card is AiLaneAdvancedCard
 * .InvestigationLimits; a test holds the two to the dashboard's.
 */
export const PROJECT_AI_RUN_LIMITS_SETTINGS_PATH: string =
  "settings/ai-features";
export const PROJECT_AI_RUN_LIMITS_CARD_ANCHOR: string = "LimitsPerRun";
export const INCIDENT_AI_SETTINGS_PATH: string = "incidents/ai/settings";
export const ALERT_AI_SETTINGS_PATH: string = "alerts/ai/settings";
export const AI_LANE_INVESTIGATION_LIMITS_CARD_ANCHOR: string =
  "InvestigationLimits";

export default class AIRunLimitsReader {
  /*
   * The run's limits. A Slack or Microsoft Teams answer (isChatAppAnswer)
   * also stops at CHAT_APP_ANSWER_TIME_LIMIT_IN_MINUTES, when that comes
   * first. A project that cannot be read runs with the defaults - no cap,
   * the default time limit - rather than not at all: the caps are opt-in,
   * and the time limit still holds.
   */
  @CaptureSpan()
  public static async read(data: {
    projectId: ObjectID;
    lane?: AIRunLane | undefined;
    isChatAppAnswer?: boolean | undefined;
  }): Promise<AIAgentRunLimits> {
    let limits: AIAgentRunLimits;

    try {
      const project: Project | null = await ProjectService.findOneById({
        id: data.projectId,
        select: {
          aiRunMaxModelCalls: true,
          aiRunMaxToolCalls: true,
          aiRunMaxTokens: true,
          aiRunTimeLimitInMinutes: true,
          incidentAiInvestigationTimeLimitInMinutes: true,
          alertAiInvestigationTimeLimitInMinutes: true,
        },
        props: { isRoot: true },
      });

      limits = this.fromProject({ project, lane: data.lane });
    } catch (error) {
      logger.error(
        `AI: could not read the run limits of project ${data.projectId.toString()}; running with the defaults: ${error}`,
      );
      limits = AIAgentRunLimitsHelper.getDefault();
    }

    if (data.isChatAppAnswer) {
      limits = AIAgentRunLimitsHelper.withTimeCeiling(
        limits,
        CHAT_APP_ANSWER_TIME_LIMIT_IN_MINUTES,
        AIRunTimeLimitSource.ChatApp,
      );
    }

    return limits;
  }

  // The limits a project row sets, for a run of `lane` (or of none).
  public static fromProject(data: {
    project: Project | null;
    lane?: AIRunLane | undefined;
  }): AIAgentRunLimits {
    const project: Project | null = data.project;

    return AIAgentRunLimitsHelper.fromSettings({
      maxModelCalls: project?.aiRunMaxModelCalls,
      maxToolCalls: project?.aiRunMaxToolCalls,
      maxTokens: project?.aiRunMaxTokens,
      timeLimitInMinutes: project?.aiRunTimeLimitInMinutes,
      lane:
        data.lane === "Incident"
          ? {
              timeLimitInMinutes:
                project?.incidentAiInvestigationTimeLimitInMinutes,
              source: AIRunTimeLimitSource.IncidentInvestigation,
            }
          : data.lane === "Alert"
            ? {
                timeLimitInMinutes:
                  project?.alertAiInvestigationTimeLimitInMinutes,
                source: AIRunTimeLimitSource.AlertInvestigation,
              }
            : undefined,
    });
  }

  /*
   * The Dashboard page of the setting that stopped a run, at its card - or
   * null when the limit is not a setting (a chat app's answer window, loop
   * detection) or the server does not know the Dashboard's address.
   */
  public static getSettingsUrl(data: {
    projectId: ObjectID;
    reason: AIRunStopReason;
    limits: AIAgentRunLimits;
  }): string | null {
    if (
      !AIAgentRunLimitsHelper.getSettingLocation(data.reason, data.limits) ||
      !DashboardClientUrl ||
      !DashboardClientUrl.hostname?.toString()
    ) {
      return null;
    }

    let path: string = PROJECT_AI_RUN_LIMITS_SETTINGS_PATH;
    let anchor: string = PROJECT_AI_RUN_LIMITS_CARD_ANCHOR;

    if (data.reason === AIRunStopReason.TimeLimit) {
      if (
        data.limits.timeLimitSource ===
        AIRunTimeLimitSource.IncidentInvestigation
      ) {
        path = INCIDENT_AI_SETTINGS_PATH;
        anchor = AI_LANE_INVESTIGATION_LIMITS_CARD_ANCHOR;
      } else if (
        data.limits.timeLimitSource === AIRunTimeLimitSource.AlertInvestigation
      ) {
        path = ALERT_AI_SETTINGS_PATH;
        anchor = AI_LANE_INVESTIGATION_LIMITS_CARD_ANCHOR;
      }
    }

    return `${URL.fromString(DashboardClientUrl.toString())
      .addRoute(`/${data.projectId.toString()}/${path}`)
      .toString()}#${anchor}`;
  }

  /*
   * The sentence OneUptime writes under the answer of a run a limit
   * stopped, linked to the setting (AIAgentRunLimitsHelper.getStopNote).
   */
  public static getStopNote(data: {
    projectId: ObjectID;
    reason: AIRunStopReason;
    limits: AIAgentRunLimits;
  }): string {
    return AIAgentRunLimitsHelper.getStopNote({
      reason: data.reason,
      limits: data.limits,
      settingsUrl: this.getSettingsUrl(data),
    });
  }
}
