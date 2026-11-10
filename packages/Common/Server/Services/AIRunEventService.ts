import PositiveNumber from "../../Types/PositiveNumber";
import ObjectID from "../../Types/ObjectID";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
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
import CodeTaskLive from "../Utils/AI/CodeTask/CodeTaskLive";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger from "../Utils/Logger";
import { truncateShortText } from "../Utils/Database/TruncateColumnValue";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * 0 is a sequence: a run's first event. Every writer counts from 0 - the
   * chat turn, the investigation engine, and appendEventToRun, which takes
   * the run's event count - and the required-column check reads 0 as
   * missing, so a run's first event was refused as "sequence is required".
   * For a code-fix run that was every event: appendEventToRun counts the
   * run's events, the count stayed 0, and each of the Runner's progress
   * lines was refused the same way (issue #6144). Any whole number from 0
   * up is a value of it; anything else is still read as the check reads it.
   */
  protected override isRequiredColumnValueGiven(
    column: string,
    value: unknown,
  ): boolean {
    if (
      column === "sequence" &&
      typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0
    ) {
      return true;
    }

    return super.isRequiredColumnValueGiven(column, value);
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
  // The sequence number after the run's last event's: 0 for a run with none.
  @CaptureSpan()
  public async getSequenceAfterLastEvent(aiRunId: ObjectID): Promise<number> {
    const lastEvents: Array<Model> = await this.findBy({
      query: { aiRunId },
      select: { sequence: true },
      sort: { sequence: SortOrder.Descending },
      limit: 1,
      skip: 0,
      props: { isRoot: true },
    });

    const lastSequence: number | undefined = lastEvents[0]?.sequence;

    return typeof lastSequence === "number" ? lastSequence + 1 : 0;
  }

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
    /*
     * Number the event after the run's last one rather than by the count
     * of its events: an investigation's attempts number their events in
     * blocks of their own (AIInvestigationEngine), so only this puts an
     * event written for an attempt - how it ended - after its steps.
     */
    afterLastEvent?: boolean | undefined;
  }): Promise<void> {
    try {
      const sequence: number = data.afterLastEvent
        ? await this.getSequenceAfterLastEvent(data.aiRunId)
        : (
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

      /*
       * A Runner's tool name, held to its column (varchar(100)): a longer
       * one refused the whole event, and the step it said was lost.
       */
      if (data.toolName) {
        event.toolName = truncateShortText(data.toolName);
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

      /*
       * The run's open pages - its task's conversation, its Log - read the
       * new step now, not on their next look (CodeTaskLive).
       */
      await CodeTaskLive.announce({
        projectId: data.projectId,
        runId: data.aiRunId,
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
