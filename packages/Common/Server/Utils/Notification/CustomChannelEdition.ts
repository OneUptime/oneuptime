import EnterpriseEdition from "../../Enterprise/EnterpriseEdition";
import EnterpriseFeature from "../../Enterprise/EnterpriseFeature";

/*
 * CUSTOM CHANNELS ARE AN ENTERPRISE FEATURE.
 *
 * Custom notification channels (CustomNotificationChannel) are part of the
 * OneUptime Enterprise Edition: EnterpriseFeature.CustomNotificationChannels.
 * Core keeps the table, its CRUD service and every place a channel is read,
 * as it does for every enterprise feature, and asks this before anything
 * reaches a channel:
 *
 *   isActive()          the RUNTIME question (EnterpriseEdition
 *                       isFeatureActive): may a page or notification go to a
 *                       channel, may readiness and the fallback count one,
 *                       may a screen offer one. Never on the Community
 *                       Edition; during the trial and grace period, yes.
 *   assertAvailable()   the configuration question (isFeatureAvailable),
 *                       failing closed: a test send from a screen.
 *
 * Adding or changing a channel, and pointing a rule or a notification setting
 * at one, is refused by EditionPermissions from the model and column maps in
 * EnterpriseEdition. Deleting one never is.
 *
 * The Enterprise Edition itself sends the requests (ee/Server/
 * CustomNotificationChannels) and adds channels to everyone's rules.
 */

// What an on-call log, a test or a log line says of a send while it is not active.
export const CUSTOM_CHANNEL_NOT_ACTIVE_MESSAGE: string =
  "Not sent: custom channels are a OneUptime Enterprise feature, and this server has no Enterprise license that includes them.";

export default class CustomChannelEdition {
  public static isActive(): boolean {
    return EnterpriseEdition.isFeatureActive(
      EnterpriseFeature.CustomNotificationChannels,
    );
  }

  /*
   * Throws what EnterpriseEdition throws for an enterprise feature that is
   * not available: on the Community Edition, that it is an Enterprise
   * Edition feature; on the Enterprise Edition, that it needs a license.
   */
  public static async assertAvailable(): Promise<void> {
    await EnterpriseEdition.assertFeatureAvailable(
      EnterpriseFeature.CustomNotificationChannels,
    );
  }
}
