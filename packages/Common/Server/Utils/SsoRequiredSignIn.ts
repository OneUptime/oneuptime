import GlobalConfigService from "../Services/GlobalConfigService";
import BadDataException from "../../Types/Exception/BadDataException";
import {
  SSO_REQUIRED_SIGN_IN_MESSAGE,
  SSO_REQUIRED_SIGN_UP_MESSAGE,
} from "../../Types/SSO/SignInMethods";

/*
 * WHILE THE WHOLE SERVER REQUIRES SSO, SINGLE SIGN-ON IS THE WAY IN.
 *
 * Require SSO for Login for the whole server (GlobalConfig.requireSsoForLogin,
 * Admin Dashboard > Settings > Single Sign-On) makes every project require
 * SSO of everyone but master admins
 * (UserMiddleware.getUserTenantAccessPermissionWithTenantId). A sign-in that
 * is not SSO - a password and the second steps that finish it, a passkey,
 * Sign in with Microsoft - would open none of them: it signed people in to
 * an app whose every project then sent them on to SSO. So it is refused at
 * the door, and so is a sign-up, which makes an account that signs in with a
 * password. The sign-in pages offer only SSO meanwhile
 * (SignInMethods, GET /identity/sign-in-methods).
 *
 * MASTER ADMINS ARE EXEMPT, as they are from the projects' rule: they can
 * always sign in with their password - at /accounts/admin-login, which the
 * Admin Dashboard sends a signed-out visitor to and its Require SSO card
 * names - so a server whose identity provider stops working always keeps
 * someone who can turn the requirement off. Whether someone is one is read
 * from their account before the rule is: a rule that cannot be read never
 * keeps a master admin out.
 *
 * Everyone else is refused when the rule cannot be read (it throws): a read
 * that fails is never "not required" (GlobalConfigService.getRequireSsoForLogin).
 *
 * Asked only after the account is proved - a correct password, a verified
 * passkey - so the answer tells nothing to someone who does not hold it.
 */

export interface SignInAccount {
  isMasterAdmin?: boolean | undefined;
}

export default class SsoRequiredSignIn {
  /*
   * Whether this account may not sign in without SSO now. False for a master
   * admin, without reading the rule.
   */
  public static async isNonSsoSignInRefused(
    account: SignInAccount,
  ): Promise<boolean> {
    if (account.isMasterAdmin === true) {
      return false;
    }

    return await GlobalConfigService.getRequireSsoForLogin();
  }

  // Throws SSO_REQUIRED_SIGN_IN_MESSAGE when isNonSsoSignInRefused.
  public static async assertNonSsoSignInAllowed(
    account: SignInAccount,
  ): Promise<void> {
    if (await SsoRequiredSignIn.isNonSsoSignInRefused(account)) {
      throw new BadDataException(SSO_REQUIRED_SIGN_IN_MESSAGE);
    }
  }

  // Whether the server requires SSO, for a path no master admin takes.
  public static async isSsoRequired(): Promise<boolean> {
    return await GlobalConfigService.getRequireSsoForLogin();
  }

  /*
   * Throws SSO_REQUIRED_SIGN_UP_MESSAGE while the server requires SSO: an
   * account is made by signing in with SSO then, or by an invitation.
   */
  public static async assertSignUpAllowed(): Promise<void> {
    if (await SsoRequiredSignIn.isSsoRequired()) {
      throw new BadDataException(SSO_REQUIRED_SIGN_UP_MESSAGE);
    }
  }
}
