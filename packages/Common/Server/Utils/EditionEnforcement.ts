import EnterpriseEdition from "../Enterprise/EnterpriseEdition";
import EnterpriseFeature from "../Enterprise/EnterpriseFeature";
import logger from "./Logger";

/*
 * Which enterprise SCIM controls are live in this process.
 *
 * The answer follows the RUNTIME state of SCIM
 * (EnterpriseEdition.isFeatureActive(SCIM)): it is active when the Enterprise
 * Edition is loaded and, with billing off, its license covers SCIM (valid, in
 * the grace period after it expired, or - with no license - inside the
 * trial).
 *
 * The SCIM Push Groups team locks are relaxed where they cannot work:
 *   - on the Community Edition, which has no SCIM endpoints;
 *   - on an Enterprise install whose license does not cover SCIM right now,
 *     where those endpoints refuse (ee/Server/Identity).
 * A leftover lock there would leave teams nobody can manage, because the
 * identity provider that owns them cannot reach OneUptime. The SCIM
 * configuration itself is kept untouched, so running the Enterprise Edition
 * again (with a valid license, or during its trial or grace period), or
 * renewing the license, restores the locks without a restart.
 *
 * Single sign-on is not decided here: it is part of the Community Edition,
 * and a configured "Require SSO for login" is enforced in every edition.
 *
 * Failure direction: an error while deciding answers "enforce", and an
 * unknown license state counts as active (see isFeatureActive), so a read
 * error never switches a lock off.
 */
export default class EditionEnforcement {
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
}
