import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/AIRunRecording";
import ObjectID from "../../Types/ObjectID";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import {
  INVESTIGATION_RECORDING_RETENTION_IN_DAYS,
  INVESTIGATION_RECORDING_VERSION,
  InvestigationRecording,
} from "../../Types/AI/InvestigationRecording";
import { toStorableJson } from "../Utils/Database/PostgresStorableValue";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

/*
 * What AI investigations saw, kept for a replay (Models/DatabaseModels/
 * AIRunRecording). Server-only: written by the investigation engine once an
 * attempt completes its run, read by the replay (npm run ai-eval).
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);

    /*
     * On every install, billed or not: the text is telemetry the tools read,
     * and it should not outlive the window a replay is useful in.
     */
    this.hardDeleteItemsOlderThanInDays(
      "createdAt",
      INVESTIGATION_RECORDING_RETENTION_IN_DAYS,
    );
  }

  @CaptureSpan()
  public async saveForRun(data: {
    projectId: ObjectID;
    aiRunId: ObjectID;
    recording: InvestigationRecording;
  }): Promise<void> {
    const row: Model = new Model();
    row.projectId = data.projectId;
    row.aiRunId = data.aiRunId;
    /*
     * A character Postgres will not keep in JSON - a NUL a log line carried,
     * half of an emoji a result was cut through - would refuse the whole
     * row; each becomes U+FFFD, one character for one.
     */
    row.recording = toStorableJson(data.recording);

    await this.create({
      data: row,
      props: { isRoot: true },
    });
  }

  /*
   * A run's recording - the latest, should a run ever have two - or null
   * when it kept none, it was deleted, or it is of a version this server
   * cannot read.
   */
  @CaptureSpan()
  public async getForRun(data: {
    projectId: ObjectID;
    aiRunId: ObjectID;
  }): Promise<InvestigationRecording | null> {
    const row: Model | null = await this.findOneBy({
      query: {
        projectId: data.projectId,
        aiRunId: data.aiRunId,
      },
      select: {
        recording: true,
      },
      sort: {
        createdAt: SortOrder.Descending,
      },
      props: { isRoot: true },
    });

    const recording: InvestigationRecording | undefined = row?.recording;

    if (
      !recording ||
      typeof recording !== "object" ||
      recording.version !== INVESTIGATION_RECORDING_VERSION ||
      !Array.isArray(recording.toolCalls) ||
      !recording.inputs ||
      typeof recording.inputs.contextText !== "string"
    ) {
      return null;
    }

    return recording;
  }
}

export default new Service();
