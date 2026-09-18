import EnterpriseEdition from "../Enterprise/EnterpriseEdition";
import logger from "./Logger";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";

/*
 * Which enterprise identity controls are live in this process.
 *
 * Every answer here depends on ONE thing: whether the Enterprise Edition code
 * is loaded (EnterpriseEdition.isLoaded()). Never on the license. A lapsed,
 * missing or invalid license makes enterprise configuration read-only, but it
 * must never silently weaken a security control that is already configured:
 * no password login where SSO is required, no stopped SCIM ownership of
 * teams.
 *
 * The controls are relaxed only on the Community Edition, where they cannot
 * work: the SAML/OIDC login routes and the SCIM endpoints are part of the
 * Enterprise Edition, so enforcing a leftover "require SSO" would lock every
 * user out, and a leftover SCIM Push Groups lock would leave teams nobody can
 * manage. The configuration itself is kept untouched, so switching back to
 * the Enterprise Edition restores enforcement.
 *
 * Failure direction: an error while deciding answers "enforce" (fail
 * secure). A lock-out can be recovered from; a silent bypass cannot.
 */
export default class EditionEnforcement {
  /*
   * Whether configured SSO requirements - a project's requireSsoForLogin (and
   * its required provider), the instance-wide requireSsoForLogin and a status
   * page's requireSsoForLogin - are enforced.
   */
  public static isSsoEnforced(): boolean {
    try {
      return EnterpriseEdition.shouldEnforceSso();
    } catch (err) {
      logger.error(
        "EditionEnforcement: could not tell whether SSO is enforced; enforcing it.",
      );
      logger.error(err);
      return true;
    }
  }

  // A configured SSO requirement that is also enforced in this process.
  public static isSsoRequired(
    configuredRequirement: boolean | null | undefined,
  ): boolean {
    if (!configuredRequirement) {
      return false;
    }

    return EditionEnforcement.isSsoEnforced();
  }

  /*
   * Whether SCIM Push Groups owns team membership: while a project's SCIM
   * configuration has Push Groups on, teams and team members can only be
   * changed by the identity provider. Relaxed on the Community Edition, which
   * has no SCIM endpoint that could make those changes.
   */
  public static areScimTeamLocksEnforced(): boolean {
    try {
      return EnterpriseEdition.isLoaded();
    } catch (err) {
      logger.error(
        "EditionEnforcement: could not tell whether SCIM team locks apply; applying them.",
      );
      logger.error(err);
      return true;
    }
  }

  /*
   * Whether this process serves the SAML/OIDC login routes. Provider listings
   * (the lists a sign-in page offers) are empty when it does not, so no client
   * sends a user into a route that answers 404.
   */
  public static areSsoLoginRoutesServed(): boolean {
    return EnterpriseEdition.isLoaded();
  }

  /*
   * Whether a read should report the EFFECTIVE SSO requirement (false)
   * instead of the stored one. Clients - the mobile app in particular, whose
   * store builds cannot be patched - decide from these columns whether to
   * start an SSO flow, and on the Community Edition that flow does not exist.
   *
   * Only reads made for a caller are masked. Internal (root) reads see the
   * stored value, and nothing is ever written, so the configuration is intact
   * when the install moves back to the Enterprise Edition.
   */
  public static shouldMaskSsoRequirementOnRead(
    props: DatabaseCommonInteractionProps | null | undefined,
  ): boolean {
    if (!props || props.isRoot) {
      return false;
    }

    return !EditionEnforcement.isSsoEnforced();
  }
}
