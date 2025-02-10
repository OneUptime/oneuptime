import ObjectID from "../../Types/ObjectID";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import DatabaseService from "./DatabaseService";
import Model, {
  SlackMiscData,
} from "Common/Models/DatabaseModels/WorkspaceUserAuthToken";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

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
