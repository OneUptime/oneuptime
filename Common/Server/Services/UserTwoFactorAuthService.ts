import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import Model from "Common/Models/DatabaseModels/UserTwoFactorAuth";
import TwoFactorAuth from "../Utils/TwoFactorAuth";
import UserService from "./UserService";
import BadDataException from "Common/Types/Exception/BadDataException";
import User from "Common/Models/DatabaseModels/User";
import DeleteBy from "../Types/Database/DeleteBy";
import LIMIT_MAX from "Common/Types/Database/LimitMax";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!createBy.props.userId) {
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
      },
    });

    if (!user) {
      throw new BadDataException("User not found");
    }

    if (!user.email) {
      throw new BadDataException("User email is required");
    }

    createBy.data.twoFactorSecret = TwoFactorAuth.generateSecret();
    createBy.data.twoFactorOtpUrl = TwoFactorAuth.generateUri({
      secret: createBy.data.twoFactorSecret,
      userEmail: user.email,
    });
    createBy.data.isVerified = false;

    return {
      createBy: createBy,
      carryForward: {},
    };
  }

  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const itemsToBeDeleted: Array<Model> = await this.findBy({
      query: deleteBy.query,
      select: {
        userId: true,
        _id: true,
        isVerified: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: deleteBy.props,
    });

    for (const item of itemsToBeDeleted) {
      if (item.isVerified) {
        // check if  user two auth is enabled.

        const user: User | null = await UserService.findOneById({
          id: item.userId!,
          props: {
            isRoot: true,
          },
          select: {
            enableTwoFactorAuth: true,
          },
        });

        if (!user) {
          throw new BadDataException("User not found");
        }

        if (user.enableTwoFactorAuth) {
          // if enabled then check if this is the only verified item for this user.

          const verifiedItems: Array<Model> = await this.findBy({
            query: {
              userId: item.userId!,
              isVerified: true,
            },
            select: {
              _id: true,
            },
            limit: LIMIT_MAX,
            skip: 0,
            props: deleteBy.props,
          });

          if (verifiedItems.length === 1) {
            throw new BadDataException(
              "You must have atleast one verified two factor auth. Please disable two factor auth before deleting this item.",
            );
          }
        }
      }
    }

    return {
      deleteBy: deleteBy,
      carryForward: {},
    };
  }
}

export default new Service();
