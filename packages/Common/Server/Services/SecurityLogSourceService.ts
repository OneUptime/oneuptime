import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/SecurityLogSource";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate } from "../Types/Database/Hooks";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";

/*
 * "Your logs" is one switch per project: a second row would read the same
 * logs twice and store every event they hold twice.
 *
 * The scan starts from the moment it is turned on - on create, and again
 * each time it is turned back on - so switching it on never has OneUptime
 * read days of logs the project already decided were not security data.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  public async findForProject(projectId: ObjectID): Promise<Model | null> {
    return this.findOneBy({
      query: { projectId },
      select: {
        _id: true,
        projectId: true,
        isEnabled: true,
      },
      props: { isRoot: true },
    });
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    const projectId: ObjectID | undefined = createBy.data.projectId;

    if (!projectId) {
      throw new BadDataException("A project is required.");
    }

    const existing: Model | null = await this.findForProject(projectId);

    if (existing) {
      throw new BadDataException(
        "Your logs are already a security source in this project. Turn the existing one on or off instead.",
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
