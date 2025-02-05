import ObjectID from "../../Types/ObjectID";
import ServiceProviderType from "../../Types/ServiceProvider/ServiceProviderType";
import DatabaseService from "./DatabaseService";
import Model, {
  SlackMiscData,
} from "Common/Models/DatabaseModels/ServiceProviderProjectAuthToken";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  public async doesExist(data: {
    projectId: ObjectID;
    serviceProviderType: ServiceProviderType;
  }): Promise<boolean> {
    return (
      (
        await this.countBy({
          query: {
            projectId: data.projectId,
            serviceProviderType: data.serviceProviderType,
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
    serviceProviderType: ServiceProviderType;
    authToken: string;
    serviceProviderProjectId: string;
    miscData: SlackMiscData;
  }): Promise<void> {
    let projectAuth: Model | null = await this.findOneBy({
      query: {
        projectId: data.projectId,
        serviceProviderType: data.serviceProviderType,
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
      projectAuth.serviceProviderType = data.serviceProviderType;
      projectAuth.serviceProviderProjectId = data.serviceProviderProjectId;
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
          serviceProviderProjectId: data.serviceProviderProjectId,
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
