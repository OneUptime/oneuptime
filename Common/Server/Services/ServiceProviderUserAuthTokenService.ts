import ObjectID from "../../Types/ObjectID";
import DatabaseService from "./DatabaseService";
import Model, {
  SlackMiscData,
  ServiceProviderUserAuthTokenServiceProviderType,
} from "Common/Models/DatabaseModels/ServiceProviderUserAuthToken";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  public async doesExist(data: {
    projectId: ObjectID;
    userId: ObjectID;
    serviceProviderType: ServiceProviderUserAuthTokenServiceProviderType;
  }): Promise<boolean> {
    return (
      (
        await this.countBy({
          query: {
            projectId: data.projectId,
            userId: data.userId,
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
    userId: ObjectID;
    serviceProviderType: ServiceProviderUserAuthTokenServiceProviderType;
    authToken: string;
    serviceProviderUserId: string;
    miscData: SlackMiscData;
  }): Promise<void> {
    let userAuth: Model | null = await this.findOneBy({
      query: {
        projectId: data.projectId,
        userId: data.userId,
        serviceProviderType: data.serviceProviderType,
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
      userAuth.serviceProviderType = data.serviceProviderType;
      userAuth.serviceProviderUserId = data.serviceProviderUserId;
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
          serviceProviderUserId: data.serviceProviderUserId,
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
