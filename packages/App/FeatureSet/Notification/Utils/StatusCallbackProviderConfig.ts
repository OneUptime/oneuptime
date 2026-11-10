import { NotificationProviderConfig } from "Common/Server/Utils/Telemetry/NotificationDeliveryMetrics";

/*
 * WHOSE TWILIO ACCOUNT AN SMS OR A CALL WENT OUT ON, AS ITS STATUS CALLBACK
 * TELLS IT.
 *
 * The platform's delivery metrics say of a message's final status
 * (notification.delivery.count) whose account it went out on, as they said
 * of its send (notification.send.count): the installation's own, or one a
 * project set up for itself, whose undelivered messages are the project's
 * to look into. Neither log keeps it, so the address Twilio calls back on
 * says it: "?providerConfig=project" for a project's account, nothing for
 * the installation's. A message sent before this carried nothing, and is
 * read as the installation's.
 *
 * The value only ever names one of two attributes' values - anything else
 * is read as the installation's - and the callback is authenticated by the
 * token in its path, as before.
 */

export const PROVIDER_CONFIG_QUERY_PARAMETER: string = "providerConfig";

// The status callback's address, saying whose account the message went out on.
export function withProviderConfig(
  url: string,
  providerConfig: NotificationProviderConfig,
): string {
  if (providerConfig !== NotificationProviderConfig.Project) {
    return url;
  }

  return `${url}?${PROVIDER_CONFIG_QUERY_PARAMETER}=${NotificationProviderConfig.Project}`;
}

// Whose account a status callback's message went out on, from its query.
export function getProviderConfigOfCallback(
  query: unknown,
): NotificationProviderConfig {
  const value: unknown =
    query && typeof query === "object"
      ? (query as Record<string, unknown>)[PROVIDER_CONFIG_QUERY_PARAMETER]
      : undefined;

  return value === NotificationProviderConfig.Project
    ? NotificationProviderConfig.Project
    : NotificationProviderConfig.Global;
}
