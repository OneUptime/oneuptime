import HTTPMethod from "../API/HTTPMethod";

/*
 * What a caller needs in order to start a workflow through its Webhook
 * trigger: where to send the request and which methods it accepts.
 *
 * The builder shows these at the top of the Webhook step's settings, because
 * the URL is what someone opening that step has come for. The server registers
 * the routes on its own (Server/Types/Workflow/Components/Webhook.ts), and
 * Tests/Types/Workflow/WebhookTrigger.test.ts holds the two together, so the
 * dialog can never advertise a method or a path the server does not answer.
 */

// Relative to the workflow service, which the dashboard knows as WORKFLOW_URL.
export const WEBHOOK_TRIGGER_PATH: string = "/trigger";

export const WEBHOOK_TRIGGER_HTTP_METHODS: ReadonlyArray<HTTPMethod> = [
  HTTPMethod.GET,
  HTTPMethod.POST,
];

/*
 * The body the example request sends. A flat object with one field, so the
 * request reads at a glance and the field shows up as
 * returnValues.request-body.message in the next step.
 */
export const WEBHOOK_TRIGGER_EXAMPLE_BODY: string = '{"message": "Hello"}';

/*
 * Shown in place of the secret key until the reader asks to see it: the URL is
 * the credential, and a dialog is often open on a shared screen. A fixed
 * length, so the mask says nothing about the key behind it.
 */
export const WEBHOOK_TRIGGER_SECRET_MASK: string = "•".repeat(16);

export type GetWebhookTriggerUrlPrefixFunction = (data: {
  workflowServiceUrl: string;
}) => string;

// Everything before the secret key, ending in a slash.
export const getWebhookTriggerUrlPrefix: GetWebhookTriggerUrlPrefixFunction =
  (data: { workflowServiceUrl: string }): string => {
    // With or without a trailing slash, the base gives the same URL.
    const base: string = data.workflowServiceUrl.replace(/\/+$/, "");

    return `${base}${WEBHOOK_TRIGGER_PATH}/`;
  };

export type GetWebhookTriggerUrlFunction = (data: {
  workflowServiceUrl: string;
  secretKey: string;
}) => string;

export const getWebhookTriggerUrl: GetWebhookTriggerUrlFunction = (data: {
  workflowServiceUrl: string;
  secretKey: string;
}): string => {
  return `${getWebhookTriggerUrlPrefix(data)}${encodeURIComponent(data.secretKey)}`;
};

export type GetMaskedWebhookTriggerUrlFunction = (data: {
  workflowServiceUrl: string;
}) => string;

// The same URL with the secret key masked. Never built from the key.
export const getMaskedWebhookTriggerUrl: GetMaskedWebhookTriggerUrlFunction =
  (data: { workflowServiceUrl: string }): string => {
    return `${getWebhookTriggerUrlPrefix(data)}${WEBHOOK_TRIGGER_SECRET_MASK}`;
  };

export type GetWebhookTriggerCurlExampleFunction = (
  webhookUrl: string,
) => string;

/*
 * A request that can be pasted into a terminal as it is. One option per line,
 * so the URL stays readable in a narrow dialog and nothing has to be scrolled
 * sideways to check what is being sent.
 */
export const getWebhookTriggerCurlExample: GetWebhookTriggerCurlExampleFunction =
  (webhookUrl: string): string => {
    return [
      `curl -X ${HTTPMethod.POST} "${webhookUrl}" \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -d '${WEBHOOK_TRIGGER_EXAMPLE_BODY}'`,
    ].join("\n");
  };
