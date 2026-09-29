import EnterpriseEdition from "../Enterprise/EnterpriseEdition";
import EnterpriseFeature from "../Enterprise/EnterpriseFeature";
import {
  ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS,
  ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS,
} from "../Enterprise/EnterpriseLicenseSnapshot";
import logger from "./Logger";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PaymentRequiredException from "../../Types/Exception/PaymentRequiredException";

/*
 * Which enterprise identity controls are live in this process.
 *
 * Every answer here follows the RUNTIME state of the feature behind it
 * (EnterpriseEdition.isFeatureActive): SSO for the SSO requirements, the
 * SAML/OIDC sign-in routes and the provider listings, SCIM for the SCIM Push
 * Groups team locks. A feature is active when the Enterprise Edition is loaded
 * and, with billing off, its license covers the feature (valid, in the grace
 * period after it expired, or - with no license - inside the trial).
 *
 * The controls are relaxed where they cannot work:
 *   - on the Community Edition, which has no SAML/OIDC sign-in routes and no
 *     SCIM endpoints;
 *   - on an Enterprise install whose license has lapsed, where those routes
 *     refuse (ee/Server/Identity).
 * Enforcing a leftover "Require SSO for login" there would lock every user
 * out, and a leftover SCIM Push Groups lock would leave teams nobody can
 * manage. Users sign in with their password instead (users who only ever used
 * SSO reset it). The configuration itself is kept untouched - reads made for
 * a caller report the requirement as off, and a caller's write can neither
 * switch it off nor set it meanwhile (guardSsoRequirementWrite) - so running
 * the Enterprise Edition again (with a valid license, or during its trial or
 * grace period), or renewing the license, restores enforcement without a
 * restart.
 *
 * Failure direction: an error while deciding answers "enforce", and an
 * unknown license state counts as active (see isFeatureActive), so a read
 * error never switches a control off.
 */
export default class EditionEnforcement {
  // Why guardSsoRequirementWrite refuses a write, on the Community Edition.
  public static readonly SSO_REQUIREMENT_UNCHANGEABLE_COMMUNITY_MESSAGE: string =
    'Single sign-on is part of the OneUptime Enterprise Edition and this server runs the Community Edition, so "Require SSO for login" shows as off, is not enforced and cannot be changed here. ' +
    `A setting saved earlier is kept, and it is enforced again when this server runs the Enterprise Edition image with a valid license (or during its ${ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS}-day trial, or the ${ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS}-day grace period after a license expires).`;

  /*
   * Why guardSsoRequirementWrite refuses a write, on an Enterprise install
   * whose license does not cover SSO right now.
   */
  public static readonly SSO_REQUIREMENT_UNCHANGEABLE_LICENSE_MESSAGE: string =
    'Single sign-on has stopped because the OneUptime Enterprise license is missing, expired or does not include SSO, so "Require SSO for login" shows as off, is not enforced and cannot be changed. ' +
    "The saved setting is kept, and it is enforced again as soon as a master admin activates or renews the license from the edition label in the Admin Dashboard header.";

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
   * stored value, and a read never writes, so the configuration is intact
   * when SSO is active again. The write half is guardSsoRequirementWrite.
   */
  public static shouldMaskSsoRequirementOnRead(
    props: DatabaseCommonInteractionProps | null | undefined,
  ): boolean {
    if (!props || props.isRoot) {
      return false;
    }

    return !EditionEnforcement.isSsoEnforced();
  }

  /*
   * The write half of shouldMaskSsoRequirementOnRead, for the services'
   * onBeforeUpdate. A caller whose reads are masked has only ever seen the
   * requirement as off (no required provider), so what it writes to those
   * columns cannot be taken at face value: a settings form, or an API client
   * doing a read-modify-write, sends back the masked value it read. Saving it
   * would switch a configured requirement off without anybody deciding to,
   * and it would stay off once SSO is active again.
   *
   * So while this caller's reads are masked:
   *   - a write of the masked value (false, or no provider) is dropped from
   *     `data`, and the stored requirement is kept;
   *   - a write that would set a requirement (true, or a provider) is
   *     refused: it could neither be seen nor enforced until SSO is active;
   *   - a write that is left with nothing else to save is refused with the
   *     same explanation, rather than reporting a save that did not happen.
   *
   * Root writes, and every write while SSO is active, are left alone.
   * Mutates `data`. Throws PaymentRequiredException.
   */
  public static guardSsoRequirementWrite(input: {
    props: DatabaseCommonInteractionProps | null | undefined;
    data: Record<string, unknown>;
    // The requirement columns of the model being written.
    columns: ReadonlyArray<string>;
  }): void {
    if (!EditionEnforcement.shouldMaskSsoRequirementOnRead(input.props)) {
      return;
    }

    const writtenColumns: Array<string> = input.columns.filter(
      (column: string): boolean => {
        return input.data[column] !== undefined;
      },
    );

    if (writtenColumns.length === 0) {
      return;
    }

    const setsRequirement: boolean = writtenColumns.some(
      (column: string): boolean => {
        return !EditionEnforcement.isMaskedSsoRequirementValue(
          input.data[column],
        );
      },
    );

    if (setsRequirement) {
      throw EditionEnforcement.createSsoRequirementUnchangeableException();
    }

    for (const column of writtenColumns) {
      delete input.data[column];
    }

    /*
     * `data` is the plain update onBeforeUpdate receives (a model instance
     * has already been reduced to its set columns by
     * DatabaseService.sanitizeUpdateData); a key left undefined writes
     * nothing, so it does not count.
     */
    const hasOtherColumns: boolean = Object.keys(input.data).some(
      (key: string): boolean => {
        return input.data[key] !== undefined;
      },
    );

    if (!hasOtherColumns) {
      throw EditionEnforcement.createSsoRequirementUnchangeableException();
    }
  }

  // What a masked read reports for a requirement column: false or null.
  private static isMaskedSsoRequirementValue(value: unknown): boolean {
    return value === false || value === null;
  }

  private static createSsoRequirementUnchangeableException(): PaymentRequiredException {
    let isEnterpriseEditionLoaded: boolean = true;

    try {
      isEnterpriseEditionLoaded = EnterpriseEdition.isLoaded();
    } catch (err) {
      logger.error(err);
    }

    return new PaymentRequiredException(
      isEnterpriseEditionLoaded
        ? EditionEnforcement.SSO_REQUIREMENT_UNCHANGEABLE_LICENSE_MESSAGE
        : EditionEnforcement.SSO_REQUIREMENT_UNCHANGEABLE_COMMUNITY_MESSAGE,
    );
  }
}
