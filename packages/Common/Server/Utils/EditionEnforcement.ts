import EnterpriseEdition from "../Enterprise/EnterpriseEdition";
import EnterpriseFeature from "../Enterprise/EnterpriseFeature";
import logger from "./Logger";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";

/*
 * Which enterprise identity controls are live in this process.
 *
 * Every answer here follows the RUNTIME state of the feature behind it
 * (EnterpriseEdition.isFeatureActive): SSO for the SSO requirements, the
 * SAML/OIDC sign-in routes and the provider listings, SCIM for the SCIM Push
 * Groups team locks. A feature is active when the Enterprise Edition is loaded
 * and, with billing off, its license covers the feature (valid, in grace, or
 * inside the 14-day trial).
 *
 * The controls are relaxed where they cannot work:
 *   - on the Community Edition, which has no SAML/OIDC sign-in routes and no
 *     SCIM endpoints;
 *   - on an Enterprise install whose license has lapsed, where those routes
 *     refuse (ee/Server/Identity).
 * Enforcing a leftover "Require SSO for login" there would lock every user
 * out, and a leftover SCIM Push Groups lock would leave teams nobody can
 * manage. Users sign in with their password instead (users who only ever used
 * SSO reset it). The configuration itself is kept untouched, so running the
 * Enterprise Edition again, or renewing the license, restores enforcement
 * without a restart.
 *
 * Failure direction: an error while deciding answers "enforce", and an
 * unknown license state counts as active (see isFeatureActive), so a read
 * error never switches a control off.
 */
export default class EditionEnforcement {
  /*
   * Whether configured SSO requirements - a project's requireSsoForLogin (and
   * its required provider), the instance-wide requireSsoForLogin and a status
   * page's requireSsoForLogin - are enforced.
   */
  public static isSsoEnforced(): boolean {
    try {
      return EnterpriseEdition.isFeatureActive(EnterpriseFeature.SSO);
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
   * changed by the identity provider. Relaxed on the Community Edition, and
   * while the license does not cover SCIM, because then no SCIM endpoint
   * answers the identity provider and nobody else could manage those teams.
   */
  public static areScimTeamLocksEnforced(): boolean {
    try {
      return EnterpriseEdition.isFeatureActive(EnterpriseFeature.SCIM);
    } catch (err) {
      logger.error(
        "EditionEnforcement: could not tell whether SCIM team locks apply; applying them.",
      );
      logger.error(err);
      return true;
    }
  }

  /*
   * Whether the SAML/OIDC sign-in routes answer right now. Provider listings
   * (the lists a sign-in page offers) are empty when they do not, so no client
   * sends a user into a route that answers 404 (Community Edition) or refuses
   * because the license lapsed (Enterprise Edition).
   */
  public static areSsoRoutesServed(): boolean {
    try {
      return EnterpriseEdition.isFeatureActive(EnterpriseFeature.SSO);
    } catch (err) {
      logger.error(
        "EditionEnforcement: could not tell whether the SSO routes are served; serving them.",
      );
      logger.error(err);
      return true;
    }
  }

  /*
   * Whether a read should report the EFFECTIVE SSO requirement (false)
   * instead of the stored one. Clients - the mobile app in particular, whose
   * store builds cannot be patched - decide from these columns whether to
   * start an SSO flow, and while SSO is not active that flow does not exist
   * (Community Edition) or refuses (lapsed license).
   *
   * Only reads made for a caller are masked. Internal (root) reads see the
   * stored value, and nothing is ever written, so the configuration is intact
   * when SSO is active again.
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
