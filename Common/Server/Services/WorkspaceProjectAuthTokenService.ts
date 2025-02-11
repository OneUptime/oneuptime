import _ from "lodash";
import ObjectID from "../../Types/ObjectID";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import DatabaseService from "./DatabaseService";
import Model, {
  SlackMiscData,
} from "Common/Models/DatabaseModels/WorkspaceProjectAuthToken";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }


  public async getProjectAuth(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
  }): Promise<Model | null> {
    return await this.findOneBy({
      query: {
        projectId: data.projectId,
        workspaceType: data.workspaceType,
      },
      select: {
        authToken: true,
        workspaceProjectId: true,
        miscData: true,
      },
      props: {
        isRoot: true,
      },
    });
  }


  public async getProjectAuths(data: {
    projectId: ObjectID;
  }): Promise<Array<Model>> {
    return await this.findBy({
      query: {
        projectId: data.projectId,
      },
      select: {
        authToken: true,
        workspaceProjectId: true,
        miscData: true,
        workspaceType: true
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: {
        isRoot: true,
      },
    });
  }

  public async doesExist(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
  }): Promise<boolean> {
    return Boolean(await this.getProjectAuth(data));
  }

  public async refreshAuthToken(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
    authToken: string;
    workspaceProjectId: string;
    miscData: SlackMiscData;
  }): Promise<void> {
    let projectAuth: Model | null = await this.findOneBy({
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

    if (!projectAuth) {
      projectAuth = new Model();

      projectAuth.projectId = data.projectId;
      projectAuth.authToken = data.authToken;
      projectAuth.workspaceType = data.workspaceType;
      projectAuth.workspaceProjectId = data.workspaceProjectId;
      projectAuth.miscData = data.miscData;

      await this.create({
        data: projectAuth,
        props: {
          isRoot: true,
        },
      });
    } else {
      await this.updateOneById({
        id: projectAuth.id!,
        data: {
          authToken: data.authToken,
          workspaceProjectId: data.workspaceProjectId,
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
