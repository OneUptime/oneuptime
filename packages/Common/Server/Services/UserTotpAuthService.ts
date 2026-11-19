import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/UserTotpAuth";
import TotpAuth from "../Utils/TotpAuth";
import UserService from "./UserService";
import BadDataException from "../../Types/Exception/BadDataException";
import User from "../../Models/DatabaseModels/User";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import SsoManagedSignIn from "../Utils/SsoManagedSignIn";

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

    /*
     * An authenticator app a person adds from their profile: refused while
     * their sign-in is managed by single sign-on (SsoManagedSignIn, #9688),
     * where it would guard a password sign-in the server refuses them. The
     * enrolment a sign-in with a password walks somebody through is a root
     * write, and that sign-in has already been refused such a person.
     */
    if (!createBy.props.isRoot) {
      await SsoManagedSignIn.assertMayChangeLocalSignIn(createBy.props.userId);
    }

    // The session user's own, and no other name of it to be stored instead.
    RelationIdUtil.stamp(
      createBy.data as unknown as Record<string, unknown>,
      ["userId", "user"],
      createBy.props.userId,
    );

    const user: User | null = await UserService.findOneById({
      id: createBy.props.userId,
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
   * Removing the last second step while two factor authentication is on is
   * refused (UserService.assertTwoFactorAuthKeepsASecondStep, #9666).
   *
   * An earlier guard of this kind was taken out, and each of its reasons has
   * been answered since:
   *
   *  - its advice, "turn off two factor authentication first", could not be
   *    followed by somebody whose admin required it. Its owner turns it off
   *    from their profile now, whoever turned it on (UserService
   *    .onBeforeUpdate);
   *  - it would have made a master admin's Reset two factor authentication -
   *    the fix for a lost device - throw. A root delete is not asked;
   *  - it counted the factors that existed BEFORE the delete, once per row,
   *    so a delete of two rows passed twice and left none. The count is taken
   *    over every row the delete removes (findRowsAndHoldDeleteToThem), and
   *    only verified rows count, so an unfinished setup can always go;
   *  - "the lockout it protected against no longer exists": still true - an
   *    account required to use it with nothing set up is walked through
   *    enrolment at its next sign-in. What does exist is the profile saying
   *    "Enabled" over nothing, and anybody holding the password enrolling an
   *    app of their choosing at that sign-in. That is the state #9666
   *    reported, and removing the last app is how a person walks into it.
   *
   * UserWebAuthnService asks the same, for security keys and passkeys.
   */
  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    if (!deleteBy.props.isRoot) {
      const rows: Array<Model> = await this.findRowsAndHoldDeleteToThem(
        deleteBy,
        {
          _id: true,
          userId: true,
          isVerified: true,
        },
      );

      await UserService.assertTwoFactorAuthKeepsASecondStep(rows);
    }

    return { deleteBy, carryForward: null };
  }
}

export default new Service();
