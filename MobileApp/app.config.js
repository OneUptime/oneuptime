/*
 * Everything static lives in app.json; this file exists for the one setting
 * that cannot be committed unconditionally.
 *
 * Critical alerts on iOS need Apple's
 * com.apple.developer.usernotifications.critical-alerts entitlement, and Apple
 * grants it per team, by application, for apps that page people about urgent
 * events. Until a team has been granted it, a provisioning profile cannot
 * carry the entitlement and any build that declares it FAILS TO SIGN - so
 * putting it straight in app.json would break the iOS build for every fork,
 * every self-hoster, and this repo's own release pipeline on the day it
 * merged, long before Apple answered.
 *
 * So it is opt-in, off by default:
 *
 *   EXPO_IOS_CRITICAL_ALERTS_ENTITLEMENT=true npx expo prebuild
 *
 * or, for EAS, add it to the build profile's `env` in eas.json once the
 * entitlement has been granted to your Apple team.
 *
 * Nothing else in the feature is gated. Without the entitlement the app still
 * asks for the permission, iOS still declines to grant allowsCriticalAlerts,
 * and the settings screen tells the responder the OS has not granted it -
 * which is the honest state of affairs, rather than a switch that turns on and
 * does nothing.
 *
 * Android needs none of this: Do Not Disturb access is granted by the user in
 * system settings on the device, not by the platform vendor at build time.
 */

const IOS_CRITICAL_ALERTS_ENTITLEMENT =
  "com.apple.developer.usernotifications.critical-alerts";

function isCriticalAlertsEntitlementEnabled(env) {
  return (env || {}).EXPO_IOS_CRITICAL_ALERTS_ENTITLEMENT === "true";
}

/*
 * Returns a new config rather than mutating the one Expo handed over, and
 * preserves any entitlements already present so this stays composable with
 * whatever else a fork adds.
 */
function withCriticalAlertsEntitlement(config, env) {
  if (!isCriticalAlertsEntitlementEnabled(env)) {
    return config;
  }

  return {
    ...config,
    ios: {
      ...(config.ios || {}),
      entitlements: {
        ...((config.ios || {}).entitlements || {}),
        [IOS_CRITICAL_ALERTS_ENTITLEMENT]: true,
      },
    },
  };
}

module.exports = ({ config }) => {
  return withCriticalAlertsEntitlement(config, process.env);
};

module.exports.IOS_CRITICAL_ALERTS_ENTITLEMENT = IOS_CRITICAL_ALERTS_ENTITLEMENT;
module.exports.isCriticalAlertsEntitlementEnabled =
  isCriticalAlertsEntitlementEnabled;
module.exports.withCriticalAlertsEntitlement = withCriticalAlertsEntitlement;
