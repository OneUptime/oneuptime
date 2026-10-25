import MetricInsightFix from "./MetricInsightFix";
import AIInsightService from "../../../Services/AIInsightService";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import ExceptionInsightFix from "./ExceptionInsightFix";
import TraceInsightFix from "./TraceInsightFix";
import LogInsightFix from "./LogInsightFix";
import AIInsight from "../../../../Models/DatabaseModels/AIInsight";
import {
  TelemetryAiLane,
  getTelemetryAiLaneOfInsightType,
} from "../../../../Types/AI/TelemetryAi";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import {
  NO_TELEMETRY_AI_FIX_SUGGESTION,
  TelemetryAiFixSuggestion,
} from "../../../../Utils/Suggestions/TelemetryAiFixSuggestion";

/*
 * "FIX WITH AI" ON A LANE'S FINDING, ASKED BY A PERSON (POST
 * /telemetry-ai/fix-suggestion and /telemetry-ai/fix, Server/API/
 * TelemetryAiAPI): the pull request OneUptime AI would open on its own, for
 * a finding whose AI rule asks before fixing - or any open finding with no
 * fix yet. Each lane plans its own fix (what to ask, the evidence, the
 * repository); this reads which lane the finding is the person's way in -
 * under their own permissions, so a finding they may not read offers
 * nothing - and hands it to that lane.
 *
 * The Profiler's findings keep the Profiler's own Fix with AI (its function
 * panel's, ProfileFixTaskTrigger): their lane has no planner here.
 */

export const TELEMETRY_AI_FIX_NOT_OFFERED_MESSAGE: string =
  "That finding is not one OneUptime AI can open a pull request for here.";

export interface TelemetryAiPersonFixPlanner {
  getSuggestion: (data: {
    projectId: ObjectID;
    insightId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }) => Promise<TelemetryAiFixSuggestion>;
  createFixTask: (data: {
    projectId: ObjectID;
    insightId: ObjectID;
    userId: ObjectID;
    props: DatabaseCommonInteractionProps;
    repositoryId?: ObjectID | undefined;
  }) => Promise<{ taskId: string }>;
}

// Each lane's planner, or null for a lane whose product has its own.
export const TELEMETRY_AI_PERSON_FIX_PLANNERS: Readonly<
  Record<TelemetryAiLane, TelemetryAiPersonFixPlanner | null>
> = {
  [TelemetryAiLane.Profile]: null,
  [TelemetryAiLane.Trace]: {
    getSuggestion: (data: {
      projectId: ObjectID;
      insightId: ObjectID;
      props: DatabaseCommonInteractionProps;
    }): Promise<TelemetryAiFixSuggestion> => {
      return TraceInsightFix.getSuggestion(data);
    },
    createFixTask: (data: {
      projectId: ObjectID;
      insightId: ObjectID;
      userId: ObjectID;
      props: DatabaseCommonInteractionProps;
      repositoryId?: ObjectID | undefined;
    }): Promise<{ taskId: string }> => {
      return TraceInsightFix.createFixTask(data);
    },
  },
  /*
   * Exceptions: a new or rising exception's own AI task - a fix, or better
   * handling of an expected error - and a request in Code for a service's
   * missing stack traces (ExceptionInsightFix).
   */
  [TelemetryAiLane.Exception]: {
    getSuggestion: (data: {
      projectId: ObjectID;
      insightId: ObjectID;
      props: DatabaseCommonInteractionProps;
    }): Promise<TelemetryAiFixSuggestion> => {
      return ExceptionInsightFix.getSuggestion(data);
    },
    createFixTask: (data: {
      projectId: ObjectID;
      insightId: ObjectID;
      userId: ObjectID;
      props: DatabaseCommonInteractionProps;
      repositoryId?: ObjectID | undefined;
    }): Promise<{ taskId: string }> => {
      return ExceptionInsightFix.createFixTask(data);
    },
  },
  [TelemetryAiLane.Log]: {
    getSuggestion: (data: {
      projectId: ObjectID;
      insightId: ObjectID;
      props: DatabaseCommonInteractionProps;
    }): Promise<TelemetryAiFixSuggestion> => {
      return LogInsightFix.getSuggestion(data);
    },
    createFixTask: (data: {
      projectId: ObjectID;
      insightId: ObjectID;
      userId: ObjectID;
      props: DatabaseCommonInteractionProps;
      repositoryId?: ObjectID | undefined;
    }): Promise<{ taskId: string }> => {
      return LogInsightFix.createFixTask(data);
    },
  },
  [TelemetryAiLane.Metric]: {
    getSuggestion: (data: {
      projectId: ObjectID;
      insightId: ObjectID;
      props: DatabaseCommonInteractionProps;
    }): Promise<TelemetryAiFixSuggestion> => {
      return MetricInsightFix.getSuggestion(data);
    },
    createFixTask: (data: {
      projectId: ObjectID;
      insightId: ObjectID;
      userId: ObjectID;
      props: DatabaseCommonInteractionProps;
      repositoryId?: ObjectID | undefined;
    }): Promise<{ taskId: string }> => {
      return MetricInsightFix.createFixTask(data);
    },
  },
};

export default class TelemetryAiPersonFix {
  // The planner of the finding's lane, when the person may read the finding.
  private static async getPlanner(data: {
    projectId: ObjectID;
    insightId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<TelemetryAiPersonFixPlanner | null> {
    const insight: AIInsight | null = await AIInsightService.findOneBy({
      query: {
        _id: data.insightId.toString(),
        projectId: data.projectId,
      },
      select: { _id: true, insightType: true },
      props: data.props,
    });

    const lane: TelemetryAiLane | null = getTelemetryAiLaneOfInsightType(
      insight?.insightType,
    );

    return lane ? TELEMETRY_AI_PERSON_FIX_PLANNERS[lane] : null;
  }

  @CaptureSpan()
  public static async getSuggestion(data: {
    projectId: ObjectID;
    insightId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<TelemetryAiFixSuggestion> {
    const planner: TelemetryAiPersonFixPlanner | null =
      await TelemetryAiPersonFix.getPlanner(data);

    return planner
      ? await planner.getSuggestion(data)
      : NO_TELEMETRY_AI_FIX_SUGGESTION;
  }

  @CaptureSpan()
  public static async createFixTask(data: {
    projectId: ObjectID;
    insightId: ObjectID;
    userId: ObjectID;
    props: DatabaseCommonInteractionProps;
    repositoryId?: ObjectID | undefined;
  }): Promise<{ taskId: string }> {
    const planner: TelemetryAiPersonFixPlanner | null =
      await TelemetryAiPersonFix.getPlanner(data);

    if (!planner) {
      throw new BadDataException(TELEMETRY_AI_FIX_NOT_OFFERED_MESSAGE);
    }

    return await planner.createFixTask(data);
  }
}
