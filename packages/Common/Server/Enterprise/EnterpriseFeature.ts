/*
 * The enterprise capabilities a OneUptime Enterprise license can entitle.
 *
 * The string values are part of the license format: a signed license carries
 * a `features` claim that is either ["*"] (everything) or a subset of these
 * values. Renaming a value therefore silently revokes that feature from every
 * license already issued, so values are append-only. A value that stops
 * naming a feature is retired for good (RETIRED_ENTERPRISE_FEATURE_VALUES)
 * and never names another one.
 */
enum EnterpriseFeature {
  SCIM = "scim",
  TeamCompliance = "team-compliance",
  AuditLogs = "audit-logs",
  InstanceHealth = "instance-health",
}

export const ALL_ENTERPRISE_FEATURES: ReadonlyArray<EnterpriseFeature> =
  Object.values(EnterpriseFeature);

/*
 * License claim values that once named a feature and must never name one
 * again. Licenses already issued can still carry them: they parse like any
 * unknown name (parseEnterpriseFeature returns null) and grant nothing.
 * Giving one of them to a new feature would silently grant that feature to
 * every such license.
 *
 *   "sso"  single sign-on (SAML, OIDC, global SSO and "Require SSO for
 *          login"), which is part of the Community Edition and needs no
 *          license. Releases up to 14.0.10 still gate single sign-on on this
 *          claim or on "*".
 */
export const RETIRED_ENTERPRISE_FEATURE_VALUES: ReadonlyArray<string> = ["sso"];

/*
 * The license claim value that entitles every feature, including ones added
 * after the license was issued.
 */
export const ENTERPRISE_FEATURE_WILDCARD: string = "*";

/*
 * Narrows an untrusted string (a license claim, a request body) to a feature.
 * Unknown values return null rather than throwing, so a license issued by a
 * newer license server that names a feature this build has never heard of is
 * still readable: the unknown name is simply not granted. A retired value
 * (RETIRED_ENTERPRISE_FEATURE_VALUES) is read the same way.
 */
export const parseEnterpriseFeature: (
  value: unknown,
) => EnterpriseFeature | null = (value: unknown): EnterpriseFeature | null => {
  if (typeof value !== "string") {
    return null;
  }

  const match: EnterpriseFeature | undefined = ALL_ENTERPRISE_FEATURES.find(
    (feature: EnterpriseFeature): boolean => {
      return feature === value;
    },
  );

  return match || null;
};

export default EnterpriseFeature;
