import PostgresDatabase from "../Infrastructure/PostgresDatabase";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import Model from "Model/Models/UserTwoFactorAuth";
import TwoFactorAuth from '../Utils/TwoFactorAuth';
import UserService from "./UserService";
import BadDataException from "Common/Types/Exception/BadDataException";
import User from "Model/Models/User";

export class Service extends DatabaseService<Model> {
  public constructor(postgresDatabase?: PostgresDatabase) {
    super(Model, postgresDatabase);
  }

  protected override async onBeforeCreate(createBy: CreateBy<Model>): Promise<OnCreate<Model>> {

    if(!createBy.props.userId) {
      throw new BadDataException("User id is required");
    }

    createBy.data.userId = createBy.props.userId;

    const user: User | null = await UserService.findOneById({
      id: createBy.data.userId,
      props: {
        isRoot: true,
      },
      select: {
        email: true,
      }
    });


    if(!user) {
      throw new BadDataException("User not found");
    }

    if(!user.email) {
      throw new BadDataException("User email is required");
    }

    createBy.data.twoFactorSecret = TwoFactorAuth.generateSecret();
    createBy.data.twoFactorOtpUrl = TwoFactorAuth.generateUri({
      secret: createBy.data.twoFactorSecret, 
      userEmail: user.email
    });
    createBy.data.isVerified = false;

    return {
      createBy: createBy,
      carryForward: {}
    };

  }
}

export default new Service();
