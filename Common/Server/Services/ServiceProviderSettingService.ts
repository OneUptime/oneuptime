import ObjectID from "../../Types/ObjectID";
import ServiceProviderType from "../../Types/ServiceProvider/ServiceProviderType";
import DatabaseService from "./DatabaseService";
import Model, {
  SlackSettings,
} from "Common/Models/DatabaseModels/ServiceProviderSetting";

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

  public async refreshSetting(data: {
    projectId: ObjectID;
    serviceProviderType: ServiceProviderType;
    settings: SlackSettings;
  }): Promise<void> {
    let serviceProviderSetting: Model | null = await this.findOneBy({
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

    if (!serviceProviderSetting) {
      serviceProviderSetting = new Model();

      serviceProviderSetting.projectId = data.projectId;
      serviceProviderSetting.settings = data.settings;
      serviceProviderSetting.serviceProviderType = data.serviceProviderType;

      await this.create({
        data: serviceProviderSetting,
        props: {
          isRoot: true,
        },
      });
    } else {
      await this.updateOneById({
        id: serviceProviderSetting.id!,
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
