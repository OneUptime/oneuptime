import PositiveNumber from "../../Types/PositiveNumber";
import ObjectID from "../../Types/ObjectID";
import { JSONObject } from "../../Types/JSON";
import AIRunEventType from "../../Types/AI/AIRunEventType";
import {
  AIRunEventContentPayload,
  AIRunEventResultSummary,
} from "../../Types/AI/AIChatTypes";
import CountBy from "../Types/Database/CountBy";
import FindBy from "../Types/Database/FindBy";
import { OnFind } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/AIRunEvent";
import { pinQueryToRequestingUser } from "../Utils/AI/AIChatPrivacyFilter";
import AIRunTranscript from "../Utils/AI/AIRunTranscript";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger from "../Utils/Logger";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Append one event to a run's glass-box trail, allocating the next
   * sequence number from the run's current event count — the same idiom
   * AIInvestigationEngine uses, factored out for callers that emit
   * events one at a time (the code-fix agent's HTTP protocol) rather than
   * holding a sequence counter across a whole in-process run.
   *
   * Best-effort: events are telemetry, so failures are logged and swallowed
   * rather than failing the operation that produced them.
   */
  @CaptureSpan()
  public async appendEventToRun(data: {
    projectId: ObjectID;
    aiRunId: ObjectID;
    eventType: AIRunEventType;
    toolName?: string | undefined;
    toolArguments?: JSONObject | undefined;
    resultSummary?: AIRunEventResultSummary | undefined;
    citationId?: string | undefined;
    contentPayload?: AIRunEventContentPayload | undefined;
  }): Promise<void> {
    try {
      const sequence: number = (
        await this.countBy({
          query: { aiRunId: data.aiRunId },
          props: { isRoot: true },
        })
      ).toNumber();

      const event: Model = new Model();
      event.projectId = data.projectId;
      event.aiRunId = data.aiRunId;
      event.sequence = sequence;
      event.eventType = data.eventType;

      if (data.toolName) {
        event.toolName = data.toolName;
      }
      if (data.toolArguments) {
        event.toolArguments = data.toolArguments;
      }
      if (data.resultSummary) {
        event.resultSummary = data.resultSummary;
      }
      if (data.citationId) {
        event.citationId = data.citationId;
      }
      /*
       * Capped here rather than at the call sites, so no caller can write an
       * unbounded transcript row by forgetting to clamp.
       */
      if (data.contentPayload) {
        event.contentPayload = AIRunTranscript.clampPayload(
          data.contentPayload,
        );
      }

      await this.create({
        data: event,
        props: { isRoot: true },
      });
    } catch (error) {
      logger.error(
        `Failed to append AIRunEvent (${data.eventType}) to run ${data.aiRunId.toString()}: ${error}`,
      );
    }
  }

  protected override async onBeforeFind(
    findBy: FindBy<Model>,
  ): Promise<OnFind<Model>> {
    findBy.query = pinQueryToRequestingUser(
      findBy.query,
      findBy.props,
      "userId",
    );
    return { findBy, carryForward: null };
  }

  @CaptureSpan()
  public override async countBy(
    countBy: CountBy<Model>,
  ): Promise<PositiveNumber> {
    countBy.query = pinQueryToRequestingUser(
      countBy.query,
      countBy.props,
      "userId",
    );
    return super.countBy(countBy);
  }
}

export default new Service();
