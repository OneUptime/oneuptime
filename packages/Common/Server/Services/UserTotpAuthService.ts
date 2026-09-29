import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/UserTotpAuth";
import TotpAuth from "../Utils/TotpAuth";
import UserService from "./UserService";
import BadDataException from "../../Types/Exception/BadDataException";
import User from "../../Models/DatabaseModels/User";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
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

    createBy.data.twoFactorSecret = TotpAuth.generateSecret();
    createBy.data.twoFactorOtpUrl = TotpAuth.generateUri({
      secret: createBy.data.twoFactorSecret,
      userEmail: user.email,
    });
    createBy.data.isVerified = false;

    return {
      createBy: createBy,
      carryForward: {},
    };
  }

  /*
   * There is no `onBeforeDelete` here any more.
   *
   * It used to refuse the deletion of a user's LAST verified factor while
   * `enableTwoFactorAuth` was on, telling them to "disable two factor auth
   * before deleting this item". Both halves of that stopped being true:
   *
   *  - the advice is impossible to follow for a user whose two factor auth was
   *    mandated by an admin. They cannot turn the requirement off, so the
   *    guard did not protect them, it stranded them on an authenticator they
   *    may have been trying to replace -- and it would have made
   *    UserService.resetTwoFactorAuth, the fix for a lost device, throw on the
   *    one account that needs it most;
   *  - the lockout it protected against no longer exists. An account that is
   *    required to use two factor auth and has nothing set up is now sent
   *    through enrolment at its next sign-in rather than refused, so deleting
   *    the last factor costs a QR code, not an account.
   *
   * It was also wrong on its own terms: it counted the verified factors that
   * existed BEFORE the delete, once per item, inside a loop over the whole
   * `deleteBy` set -- so removing two verified factors in a single call passed
   * the check twice and landed in exactly the state it existed to prevent.
   *
   * The same guard has been removed from UserWebAuthnService for the same
   * reasons; the two were mirror images and had to move together.
   */
}

export default new Service();
