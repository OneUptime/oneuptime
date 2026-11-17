/*
 * The services whose verification handshake an Incoming Request monitor's
 * URL and a workflow's Webhook trigger answer (Server/Utils/WebhookVerification,
 * issue #8429). Kept on a monitor's latest request when OneUptime answered it
 * as one (IncomingMonitorRequest.answeredVerification), which the Dashboard
 * reads too. Stored values: never rename one.
 */
enum WebhookVerificationProvider {
  AzureEventGrid = "Azure Event Grid",
  CloudEvents = "CloudEvents",
  Slack = "Slack",
  MicrosoftGraph = "Microsoft Graph",
  Okta = "Okta",
}

export class WebhookVerificationProviderUtil {
  // The provider a stored value names, or undefined for anything else.
  public static fromValue(
    value: unknown,
  ): WebhookVerificationProvider | undefined {
    return Object.values(WebhookVerificationProvider).find(
      (provider: WebhookVerificationProvider): boolean => {
        return provider === value;
      },
    );
  }
}

export default WebhookVerificationProvider;
