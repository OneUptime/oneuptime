import Model from "../../Models/DatabaseModels/CloudTagSetting";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ProjectReferencesService from "./ProjectReferencesService";

/*
 * How a project is told about a new cloud resource without a required tag
 * (CloudTagSetting, #11012): one row a project, made with its defaults the
 * first time anything asks for it - the Tags page when it opens, the
 * watcher when it runs. Two callers racing to make it both read the one
 * the unique index kept.
 */
export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  public static allColumns(): {
    _id: true;
    projectId: true;
    notifyPeople: true;
    emailEachResource: true;
    raiseAlert: true;
    alertSeverityId: true;
    watchState: true;
  } {
    return {
      _id: true,
      projectId: true,
      notifyPeople: true,
      emailEachResource: true,
      raiseAlert: true,
      alertSeverityId: true,
      watchState: true,
    };
  }

  @CaptureSpan()
  public async getOrCreateForProject(projectId: ObjectID): Promise<Model> {
    const existing: Model | null = await this.findOneBy({
      query: { projectId },
      select: Service.allColumns(),
      props: { isRoot: true },
    });

    if (existing) {
      return existing;
    }

    const setting: Model = new Model();
    setting.projectId = projectId;

    try {
      await this.create({ data: setting, props: { isRoot: true } });
    } catch {
      // Another caller made it first; read theirs below.
    }

    const created: Model | null = await this.findOneBy({
      query: { projectId },
      select: Service.allColumns(),
      props: { isRoot: true },
    });

    if (!created) {
      throw new BadDataException(
        "The settings for required tags could not be made for this project. Try again.",
      );
    }

    return created;
  }
}

export default new Service();
