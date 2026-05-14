import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import ObjectID from "../../Types/ObjectID";
import Version from "../../Types/Version";
import BadDataException from "../../Types/Exception/BadDataException";
import Model, {
  RunbookAgentConnectionStatus,
} from "../../Models/DatabaseModels/RunbookAgent";
import OneUptimeDate from "../../Types/Date";
import { JSONArray, JSONObject } from "../../Types/JSON";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

/*
 * Tags arrive from the dashboard form as a comma-separated string for ease
 * of entry, but the column stores a JSON array. Accept both shapes and
 * canonicalize to a deduped array of trimmed non-empty strings.
 */
function normalizeTagsInPlace(data: Record<string, unknown>): void {
  const raw: unknown = data["tags"];
  if (raw === undefined || raw === null) {
    return;
  }
  let arr: Array<string> = [];
  if (typeof raw === "string") {
    arr = raw.split(",");
  } else if (Array.isArray(raw)) {
    arr = raw.map((v: unknown) => {
      return String(v);
    });
  }
  const deduped: Array<string> = Array.from(
    new Set(
      arr
        .map((t: string) => {
          return t.trim();
        })
        .filter((t: string) => {
          return t.length > 0;
        }),
    ),
  );
  data["tags"] = deduped as unknown as JSONArray;
}

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

    normalizeTagsInPlace(createBy.data as unknown as Record<string, unknown>);

    return { createBy, carryForward: [] };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    normalizeTagsInPlace(updateBy.data as unknown as Record<string, unknown>);
    return { updateBy, carryForward: [] };
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
        tags: true,
        name: true,
      },
      props: { isRoot: true },
    });
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
