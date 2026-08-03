import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import ObjectID from "../../Types/ObjectID";
import Version from "../../Types/Version";
import BadDataException from "../../Types/Exception/BadDataException";
import Model, {
  RunbookAgentConnectionStatus,
} from "../../Models/DatabaseModels/RunbookAgent";
import OneUptimeDate from "../../Types/Date";
import { JSONObject } from "../../Types/JSON";
import QueryHelper from "../Types/Database/QueryHelper";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

/*
 * How recently a Runner must have heartbeated to count as online. Matches the
 * window AIAgentService.isAgentAlive uses, and comfortably clears the Runner's
 * 60s heartbeat interval.
 */
const RUNNER_ALIVE_WINDOW_IN_MINUTES: number = 5;

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!createBy.data.key) {
      createBy.data.key = ObjectID.generate().toString();
    }

    if (!createBy.data.agentVersion) {
      createBy.data.agentVersion = new Version("1.0.0");
    }

    if (!createBy.data.connectionStatus) {
      createBy.data.connectionStatus =
        RunbookAgentConnectionStatus.Disconnected;
    }

    return { createBy, carryForward: [] };
  }

  @CaptureSpan()
  public async findByIdAndKey(data: {
    agentId: ObjectID;
    agentKey: string;
  }): Promise<Model | null> {
    if (!data.agentId || !data.agentKey) {
      return null;
    }

    return this.findOneBy({
      query: {
        _id: data.agentId.toString(),
        key: data.agentKey,
      },
      select: {
        _id: true,
        projectId: true,
        name: true,
        canRunRunbooks: true,
        canRunCodeFixTasks: true,
      },
      props: { isRoot: true },
    });
  }

  /*
   * A Runner in this project that is allowed to take code-fix work and has
   * heartbeated recently. Liveness is judged on lastAlive alone: unlike
   * AIAgent, nothing ever flips a Runner's connectionStatus back to
   * Disconnected, so a row that once connected would look Connected forever.
   */
  @CaptureSpan()
  public async getOnlineCodeFixRunnerForProject(
    projectId: ObjectID,
  ): Promise<Model | null> {
    /*
     * The recency window is a QUERY predicate, not a post-filter on a sorted
     * row: `ORDER BY "lastAlive" DESC` in Postgres puts NULLs FIRST, so a
     * Runner row that was created but never started would be picked ahead of
     * one that is heartbeating right now, and the project would read as
     * having no agent.
     */
    const runners: Array<Model> = await this.findBy({
      query: {
        projectId: projectId,
        canRunCodeFixTasks: true,
        lastAlive: QueryHelper.greaterThan(
          OneUptimeDate.getSomeMinutesAgo(RUNNER_ALIVE_WINDOW_IN_MINUTES),
        ),
      },
      select: {
        _id: true,
        name: true,
        lastAlive: true,
      },
      limit: 1,
      skip: 0,
      props: { isRoot: true },
    });

    return runners[0] || null;
  }

  @CaptureSpan()
  public async heartbeat(data: {
    agentId: ObjectID;
    agentVersion?: Version | undefined;
    hostInfo?: JSONObject | undefined;
  }): Promise<void> {
    if (!data.agentId) {
      throw new BadDataException("agentId is required");
    }

    const update: JSONObject = {
      lastAlive: OneUptimeDate.getCurrentDate(),
      connectionStatus: RunbookAgentConnectionStatus.Connected,
    };

    if (data.agentVersion) {
      update["agentVersion"] = data.agentVersion;
    }

    if (data.hostInfo) {
      update["hostInfo"] = data.hostInfo;
    }

    await this.updateOneById({
      id: data.agentId,
      data: update as never,
      props: { isRoot: true },
    });
  }
}

export default new Service();
