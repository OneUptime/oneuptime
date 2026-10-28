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
  /*
   * Retention overrides: retention by telemetry type (Project, and every
   * service and resource), and per-service and per-resource retention.
   * The project-wide default retention is not part of it.
   */
  TelemetryRetention = "telemetry-retention",
  /*
   * Custom roles: creating and changing a project's custom roles and the
   * permissions in them, and giving them to teams. The built-in roles and
   * a team's own permissions are not part of it.
   */
  CustomRoles = "custom-roles",
  /*
   * IP allow-lists on private status pages, public dashboards and forms:
   * setting or changing one. A list already set is enforced in every edition.
   */
  IpAllowlists = "ip-allowlists",
  /*
   * Removing "Powered by OneUptime" from status pages. Its runtime: while it
   * is not active, every status page shows the line.
   */
  StatusPageBranding = "status-page-branding",
  /*
   * A status page's access controls: how long private users stay signed in,
   * only private users can subscribe, and the email domains subscribers may
   * use. Setting or changing them; what is set is enforced in every edition.
   */
  StatusPageAccessControls = "status-page-access-controls",
  /*
   * Backups of the instance's PostgreSQL and ClickHouse to storage of its
   * own, on a schedule with a retention, and restoring them (Admin
   * Dashboard > Settings > Backups). Setting backups up and making new ones
   * needs it; restoring and deleting backups already made never does.
   */
  Backups = "backups",
  /*
   * Custom notification channels: ways to reach people that the server's
   * admin adds (Admin Dashboard > Settings > Custom Channels), each a URL
   * on-call pages and notifications are posted to. Adding or changing a
   * channel, and pointing a rule or a notification setting at one, needs
   * it. Its runtime: while it is not active, nothing is sent to a channel.
   */
  CustomNotificationChannels = "custom-notification-channels",
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
