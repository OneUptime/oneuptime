import ObjectID from "../../Types/ObjectID";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import DatabaseService from "./DatabaseService";
import Model, {
  SlackMiscData,
} from "../../Models/DatabaseModels/WorkspaceUserAuthToken";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  public async getUserAuth(data: {
    projectId: ObjectID;
    userId: ObjectID;
    workspaceType: WorkspaceType;
  }): Promise<Model | null> {
    return await this.findOneBy({
      query: {
        userId: data.userId,
        projectId: data.projectId,
        workspaceType: data.workspaceType,
      },
      select: {
        authToken: true,
        workspaceUserId: true,
        miscData: true,
        workspaceType: true,
      },
      props: {
        isRoot: true,
      },
    });
  }

  @CaptureSpan()
  public async doesExist(data: {
    projectId: ObjectID;
    userId: ObjectID;
    workspaceType: WorkspaceType;
  }): Promise<boolean> {
    return (
      (
        await this.countBy({
          query: {
            projectId: data.projectId,
            userId: data.userId,
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
  public async refreshAuthToken(data: {
    projectId: ObjectID;
    userId: ObjectID;
    workspaceType: WorkspaceType;
    authToken: string;
    workspaceUserId: string;
    miscData: SlackMiscData;
  }): Promise<void> {
    let userAuth: Model | null = await this.findOneBy({
      query: {
        projectId: data.projectId,
        userId: data.userId,
        workspaceType: data.workspaceType,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!userAuth) {
      userAuth = new Model();

      userAuth.projectId = data.projectId;
      userAuth.userId = data.userId;
      userAuth.authToken = data.authToken;
      userAuth.workspaceType = data.workspaceType;
      userAuth.workspaceUserId = data.workspaceUserId;
      userAuth.miscData = data.miscData;

      await this.create({
        data: userAuth,
        props: {
          isRoot: true,
        },
      });
    } else {
      await this.updateOneById({
        id: userAuth.id!,
        data: {
          authToken: data.authToken,
          workspaceUserId: data.workspaceUserId,
          miscData: data.miscData,
        },
        props: {
          isRoot: true,
        },
      });
    }
  }
}
export default new Service();
