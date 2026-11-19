import UserService from "../Services/UserService";
import logger from "./Logger";
import SsoRequiredSignIn, { SignInAccount } from "./SsoRequiredSignIn";
import SsoSignInMethods from "./SsoSignInMethods";
import User from "../../Models/DatabaseModels/User";
import BadDataException from "../../Types/Exception/BadDataException";
import NotFoundException from "../../Types/Exception/NotFoundException";
import ObjectID from "../../Types/ObjectID";
import SignInManagementUtil, {
  SignInManagement,
  SSO_MANAGED_SIGN_IN_MESSAGE,
} from "../../Types/SSO/SsoManagedSignIn";
import { SsoSignInProvider } from "../../Types/SSO/SignInMethods";

/*
 * WHETHER SOMEONE'S SIGN-IN IS MANAGED BY SINGLE SIGN-ON, AND THE LOCAL
 * SIGN-IN SETTINGS THAT ARE REFUSED THEM (issue #9688).
 *
 * The rule and why are in Common/Types/SSO/SsoManagedSignIn.ts. In short:
 * while the whole server requires SSO, everyone but a master admin - the
 * people SsoRequiredSignIn refuses every other sign-in for - sets no
 * password, passkey, security key, authenticator app, backup codes or
 * two-factor authentication in OneUptime.
 *
 * Whether someone is a master admin is read from their account, never from
 * the session asking: a session keeps what it was signed with for as long as
 * its token lives. It is read before the rule, as at sign-in, so a rule that
 * cannot be read never refuses a master admin anything; for everyone else a
 * rule that cannot be read refuses (it throws), as it does at sign-in - a
 * failed read is never "not required" (GlobalConfigService).
 *
 * Every write the rule covers asks assertMayChangeLocalSignIn first:
 *
 *   - a new password from the profile (UserService.onBeforeUpdate);
 *   - turning two-factor authentication on (UserService
 *     .assertTwoFactorAuthMayBeTurnedOn);
 *   - adding an authenticator app (UserTotpAuthService.onBeforeCreate) and
 *     finishing it with its first code (POST /user-totp-auth/validate);
 *   - adding a passkey or a security key (UserWebAuthnService
 *     .generateRegistrationOptions and .verifyRegistration);
 *   - new backup codes (POST /user-two-factor-backup-code/generate).
 *
 * Forgot password asks isManagedBySso and mails such an account no link.
 * GET /user/sign-in-management answers getSignInManagement, for the profile.
 */
export default class SsoManagedSignIn {
  /*
   * Whether an account whose master-admin standing is known is covered:
   * false for a master admin without reading the rule.
   */
  public static async isManagedBySsoFor(
    account: SignInAccount,
  ): Promise<boolean> {
    return await SsoRequiredSignIn.isNonSsoSignInRefused(account);
  }

  /*
   * Whether this person's sign-in is managed by SSO now. Throws
   * NotFoundException for an account that does not exist, and the rule's
   * own error when it cannot be read for someone who is not a master admin.
   */
  public static async isManagedBySso(userId: ObjectID): Promise<boolean> {
    const user: User | null = await UserService.findOneById({
      id: userId,
      select: {
        _id: true,
        isMasterAdmin: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!user) {
      throw new NotFoundException("User not found.");
    }

    return await SsoManagedSignIn.isManagedBySsoFor({
      isMasterAdmin: user.isMasterAdmin === true,
    });
  }

  // Throws SSO_MANAGED_SIGN_IN_MESSAGE when isManagedBySso.
  public static async assertMayChangeLocalSignIn(
    userId: ObjectID,
  ): Promise<void> {
    if (await SsoManagedSignIn.isManagedBySso(userId)) {
      throw new BadDataException(SSO_MANAGED_SIGN_IN_MESSAGE);
    }
  }

  /*
   * What User Profile is told about the signed-in person: whether their
   * organization manages their sign-in, and the names of the server's SSO
   * providers that are on, to name. The names are a courtesy: a list that
   * cannot be read is logged and left empty, and the profile then says
   * "single sign-on" - it is the rule that decides what it shows.
   */
  public static async getSignInManagement(
    userId: ObjectID,
  ): Promise<SignInManagement> {
    const isManagedBySso: boolean =
      await SsoManagedSignIn.isManagedBySso(userId);

    if (!isManagedBySso) {
      return { isManagedBySso: false, ssoProviderNames: [] };
    }

    let providerNames: Array<string> = [];

    try {
      const providers: Array<SsoSignInProvider> =
        await SsoSignInMethods.getInstanceWideProviders();

      providerNames = providers.map((provider: SsoSignInProvider): string => {
        return provider.name;
      });
    } catch (err) {
      logger.error(
        "Could not read the server's SSO providers for a person's profile; it names none.",
      );
      logger.error(err);
    }

    return {
      isManagedBySso: true,
      ssoProviderNames: SignInManagementUtil.readProviderNames(providerNames),
    };
  }
}
