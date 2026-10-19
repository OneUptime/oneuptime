import UserProjectSsoIdentityService from "Common/Server/Services/UserProjectSsoIdentityService";
import ObjectID from "Common/Types/ObjectID";

/*
 * ---------------------------------------------------------------------------
 * A SIGN-IN THROUGH A PROJECT'S SAML PROVIDER IS BOUND TO THE PERSON, NOT ONLY
 * TO THE ADDRESS.
 *
 * The provider names the account by email address. In Microsoft Entra ID an
 * address can pass to another user: a renamed one, or a mail attribute an
 * admin - or, for some attributes, the user - edited. So when the response
 * carries Entra ID's object ID (SAML_OBJECT_ID_CLAIM, sent by default), the
 * first sign-in that signs the account in binds it to that object ID, and a
 * later one that asserts its address with another object ID is refused
 * before anything is emailed, provisioned or signed in
 * (UserProjectSsoIdentity). That is the user matching Entra ID's application
 * gallery asks for: the address, paired with the immutable object ID.
 *
 * A response without an object ID - any other identity provider - is matched
 * by address alone, as before, and binds nothing. The binding goes when the
 * person leaves the project and with the provider, so coming back, or a new
 * provider, binds afresh.
 * ---------------------------------------------------------------------------
 */

// What a person is told when the provider signs them in as someone else.
export const PROJECT_SSO_IDENTITY_MISMATCH_TITLE: string =
  "This account is linked to someone else.";

export const PROJECT_SSO_IDENTITY_MISMATCH_MESSAGE: string =
  "Your identity provider signed you in as a different user from the one this OneUptime account is linked to through this project's single sign-on, so you were not signed in. If your account in the identity provider was created again, ask an admin of this project to remove you from the project and add you back.";

// The same, as the reason code on the mobile app's deep link.
export const PROJECT_SSO_IDENTITY_MISMATCH_ERROR: string =
  "sso_identity_mismatch";

export default class ProjectSsoIdentityBinding {
  /*
   * Whether, through this provider, the account is bound to another person
   * than the one the response names. False when the response names nobody
   * (no object ID), or the account is bound to no one yet.
   */
  public static async isBoundToAnotherPerson(data: {
    projectSsoId: ObjectID;
    userId: ObjectID;
    objectId: string | null;
  }): Promise<boolean> {
    if (!data.objectId) {
      return false;
    }

    const boundObjectId: string | null =
      await UserProjectSsoIdentityService.getBoundObjectId({
        projectSsoId: data.projectSsoId,
        userId: data.userId,
      });

    return Boolean(boundObjectId) && boundObjectId !== data.objectId;
  }

  /*
   * At a sign-in that is about to succeed: binds the account to the person
   * the response names, unless it is bound already. False when it is bound
   * to another person - a concurrent first sign-in bound someone else first
   * - and the sign-in must be refused. True when the response names nobody.
   */
  public static async bindOrRefuse(data: {
    projectId: ObjectID;
    projectSsoId: ObjectID;
    userId: ObjectID;
    objectId: string | null;
  }): Promise<boolean> {
    if (!data.objectId) {
      return true;
    }

    const boundObjectId: string = await UserProjectSsoIdentityService.bind({
      projectId: data.projectId,
      projectSsoId: data.projectSsoId,
      userId: data.userId,
      objectId: data.objectId,
    });

    return boundObjectId === data.objectId;
  }
}
