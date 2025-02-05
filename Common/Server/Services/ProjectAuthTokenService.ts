import ObjectID from "../../Types/ObjectID";
import DatabaseService from "./DatabaseService";
import Model, { ProjectAuthtokenServiceProviderType, SlackMiscData } from "Common/Models/DatabaseModels/ProjectAuthToken";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }


  public async doesExist(data: {
    projectId: ObjectID, 
    serviceProviderType: ProjectAuthtokenServiceProviderType,
  }){
    return (await this.countBy({
      query: {
        projectId: data.projectId,
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
    serviceProviderType: ProjectAuthtokenServiceProviderType,
    authToken: string,
    serviceProviderProjectId: string,
    miscData: SlackMiscData
  }){

    let projectAuth: Model | null = await this.findOneBy({
      query: {
        projectId: data.projectId,
        serviceProviderType: data.serviceProviderType,
      },
      props: {
        isRoot: true
      }
    });

    if(!projectAuth){
        projectAuth = new Model();
    }

    projectAuth.projectId = data.projectId;
    projectAuth.authToken = data.authToken;
    projectAuth.serviceProviderType = data.serviceProviderType;
    projectAuth.serviceProviderProjectId = data.serviceProviderProjectId;
    projectAuth.miscData = data.miscData;

    return await this.create({
      data: projectAuth,
      props: {
        isRoot: true
      }
    });
  }

}
export default new Service();
