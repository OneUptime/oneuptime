import ObjectID from "../../Types/ObjectID";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import DatabaseService from "./DatabaseService";
import Model, {
  WorkspaceMiscData,
} from "../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  public async getProjectAuth(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
    workspaceProjectAuthTokenId?: ObjectID;
    workspaceProjectId?: string;
  }): Promise<Model | null> {
    if (!data.projectId) {
      throw new BadDataException("projectId is required");
    }

    if (!data.workspaceType) {
      throw new BadDataException("workspaceType is required");
    }

    const query: {
      projectId: ObjectID;
      workspaceType: WorkspaceType;
      _id?: ObjectID;
      workspaceProjectId?: string;
    } = {
      projectId: data.projectId,
      workspaceType: data.workspaceType,
    };

    if (data.workspaceProjectAuthTokenId) {
      query._id = data.workspaceProjectAuthTokenId;
    }

    if (data.workspaceProjectId) {
      query.workspaceProjectId = data.workspaceProjectId;
    }

    return await this.findOneBy({
      query: {
        ...query,
      },
      select: {
        _id: true,
        authToken: true,
        workspaceProjectId: true,
        miscData: true,
        workspaceType: true,
      },
      props: {
        isRoot: true,
      },
    });
  }

  @CaptureSpan()
  public async getProjectAuths(data: {
    projectId: ObjectID;
    workspaceType?: WorkspaceType;
  }): Promise<Array<Model>> {
    if (!data.projectId) {
      throw new BadDataException("projectId is required");
    }

    const query: {
      projectId: ObjectID;
      workspaceType?: WorkspaceType;
    } = {
      projectId: data.projectId,
    };

    if (data.workspaceType) {
      query.workspaceType = data.workspaceType;
    }

    return await this.findBy({
      query: {
        ...query,
      },
      select: {
        _id: true,
        authToken: true,
        workspaceProjectId: true,
        miscData: true,
        workspaceType: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: {
        isRoot: true,
      },
    });
  }

  @CaptureSpan()
  public async doesExist(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
  }): Promise<boolean> {
    return Boolean(await this.getProjectAuth(data));
  }

  @CaptureSpan()
  public async refreshAuthToken(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
    authToken: string;
    workspaceProjectId: string;
    miscData: WorkspaceMiscData;
    workspaceProjectAuthTokenId?: ObjectID;
  }): Promise<void> {
    if (!data.projectId) {
      throw new BadDataException("projectId is required");
    }

    if (!data.workspaceType) {
      throw new BadDataException("workspaceType is required");
    }

    if (!data.authToken) {
      throw new BadDataException("authToken is required");
    }

    if (!data.workspaceProjectId) {
      throw new BadDataException("workspaceProjectId is required");
    }

    if (!data.miscData) {
      throw new BadDataException("miscData is required");
    }

    const query: {
      projectId: ObjectID;
      workspaceType: WorkspaceType;
      workspaceProjectId?: string;
      _id?: ObjectID;
    } = {
      projectId: data.projectId,
      workspaceType: data.workspaceType,
    };

    if (data.workspaceProjectId) {
      query.workspaceProjectId = data.workspaceProjectId;
    }

    if (data.workspaceProjectAuthTokenId) {
      query._id = data.workspaceProjectAuthTokenId;
    }

    let projectAuth: Model | null = await this.findOneBy({
      query: query,
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
