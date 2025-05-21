import ObjectID from "../../Types/ObjectID";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import DatabaseService from "./DatabaseService";
import Model, {
  SlackSettings,
} from "../../Models/DatabaseModels/WorkspaceSetting";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  public async doesExist(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
  }): Promise<boolean> {
    return (
      (
        await this.countBy({
          query: {
            projectId: data.projectId,
            workspaceType: data.workspaceType,
          },
          skip: 0,
          limit: 1,
          props: {
            isRoot: true,
          },
        })
      ).toNumber() > 0
    );
  }

  @CaptureSpan()
  public async refreshSetting(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
    settings: SlackSettings;
  }): Promise<void> {
    let workspaceSetting: Model | null = await this.findOneBy({
      query: {
        projectId: data.projectId,
        workspaceType: data.workspaceType,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!workspaceSetting) {
      workspaceSetting = new Model();

      workspaceSetting.projectId = data.projectId;
      workspaceSetting.settings = data.settings;
      workspaceSetting.workspaceType = data.workspaceType;

      await this.create({
        data: workspaceSetting,
        props: {
          isRoot: true,
        },
      });
    } else {
      await this.updateOneById({
        id: workspaceSetting.id!,
        data: {
          settings: data.settings,
        },
        props: {
          isRoot: true,
        },
      });
    }
  }
}
export default new Service();
