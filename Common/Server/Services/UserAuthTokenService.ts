import ObjectID from "../../Types/ObjectID";
import DatabaseService from "./DatabaseService";
import Model, { SlackMiscData, UserAuthTokenServiceProviderType } from "Common/Models/DatabaseModels/UserAuthToken";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  public async doesExist(data: {
    projectId: ObjectID,
    userId: ObjectID, 
    serviceProviderType: UserAuthTokenServiceProviderType,
  }){
    return (await this.countBy({
      query: {
        projectId: data.projectId,
        userId: data.userId,
        serviceProviderType: data.serviceProviderType,
      },
      skip: 0,
      limit: 1,
      props: {
        isRoot: true
      }
    })).toNumber() > 0;
  }

  public async refreshAuthToken(data: {
    projectId: ObjectID,
    userId: ObjectID,
    serviceProviderType: UserAuthTokenServiceProviderType,
    authToken: string,
    serviceProviderUserId: string,
    miscData: SlackMiscData
  }){

    let userAuth: Model | null = await this.findOneBy({
      query: {
        projectId: data.projectId,
        userId: data.userId,
        serviceProviderType: data.serviceProviderType,
      },
      props: {
        isRoot: true
      }
    });

    if(!userAuth){
        userAuth = new Model();
    }

    userAuth.projectId = data.projectId;
    userAuth.userId = data.userId;
    userAuth.authToken = data.authToken;
    userAuth.serviceProviderType = data.serviceProviderType;
    userAuth.serviceProviderUserId = data.serviceProviderUserId;
    userAuth.miscData = data.miscData;

    return await this.create({
      data: userAuth,
      props: {
        isRoot: true
      }
    });
  }
}
export default new Service();
