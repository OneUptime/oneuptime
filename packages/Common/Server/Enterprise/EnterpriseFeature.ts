/*
 * The enterprise capabilities a OneUptime Enterprise license can entitle.
 *
 * The string values are part of the license format: a signed license carries
 * a `features` claim that is either ["*"] (everything) or a subset of these
 * values. Renaming a value therefore silently revokes that feature from every
 * license already issued, so values are append-only.
 */
enum EnterpriseFeature {
  SSO = "sso",
  SCIM = "scim",
  TeamCompliance = "team-compliance",
  AuditLogs = "audit-logs",
  InstanceHealth = "instance-health",
}

export const ALL_ENTERPRISE_FEATURES: ReadonlyArray<EnterpriseFeature> =
  Object.values(EnterpriseFeature);

/*
 * The license claim value that entitles every feature, including ones added
 * after the license was issued.
 */
export const ENTERPRISE_FEATURE_WILDCARD: string = "*";

/*
 * Narrows an untrusted string (a license claim, a request body) to a feature.
 * Unknown values return null rather than throwing, so a license issued by a
 * newer license server that names a feature this build has never heard of is
 * still readable: the unknown name is simply not granted.
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
