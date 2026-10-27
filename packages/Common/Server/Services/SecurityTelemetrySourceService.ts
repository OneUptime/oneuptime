import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/SecurityTelemetrySource";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate } from "../Types/Database/Hooks";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import {
  SecurityTelemetrySourceKind,
  isSecurityTelemetrySourceKind,
} from "../../Types/SecurityEvent/SecurityTelemetrySource";

/*
 * "Your OneUptime data" is one switch per kind per project: a second row of
 * a kind would read the same telemetry twice and store every event it
 * holds twice.
 *
 * A scan starts from the moment its switch is turned on - on create, and
 * again each time it is turned back on - so switching one on never has
 * OneUptime read days of telemetry the project already decided were not
 * security data. The kind is fixed once created.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  public async findForProject(
    projectId: ObjectID,
    kind: SecurityTelemetrySourceKind,
  ): Promise<Model | null> {
    return this.findOneBy({
      query: { projectId, kind },
      select: {
        _id: true,
        projectId: true,
        kind: true,
        isEnabled: true,
      },
      props: { isRoot: true },
    });
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    const projectId: ObjectID | undefined = createBy.data.projectId;
    const kind: unknown = createBy.data.kind;

    if (!projectId) {
      throw new BadDataException("A project is required.");
    }

    if (!isSecurityTelemetrySourceKind(kind)) {
      throw new BadDataException(
        "Say which telemetry to read: traces, network-flows, audit-log or rum-sessions.",
      );
    }

    const existing: Model | null = await this.findForProject(projectId, kind);

    if (existing) {
      throw new BadDataException(
        "This telemetry is already a security source in this project. Turn the existing one on or off instead.",
      );
    }

    if (createBy.data.isEnabled === undefined) {
      createBy.data.isEnabled = true;
    }

    return { createBy, carryForward: null };
  }

  /*
   * The cursor and the last error are OneUptime's to write, so they are
   * written once the caller's column permissions have let the write
   * through.
   */
  protected override async onCreatePermitted(
    onCreate: OnCreate<Model>,
  ): Promise<void> {
    onCreate.createBy.data.cursor =
      OneUptimeDate.getCurrentDate().toISOString();
  }

  // Turned (back) on: read from now, not from where it stopped.
  protected override async onUpdatePermitted(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    const incoming: JSONObject = updateBy.data as unknown as JSONObject;

    if (incoming["isEnabled"] === true) {
      incoming["cursor"] = OneUptimeDate.getCurrentDate().toISOString();
      incoming["lastError"] = null;
    }
  }
}

export default new Service();
