import CopyTextButton from "../CopyTextButton/CopyTextButton";
import Icon from "../Icon/Icon";
import BreakableCode from "./BreakableCode";
import ComponentSettingsSection from "./ComponentSettingsSection";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import IconProp from "../../../Types/Icon/IconProp";
import {
  WEBHOOK_TRIGGER_HTTP_METHODS,
  getWebhookTriggerCurlExample,
} from "../../../Types/Workflow/WebhookTrigger";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  // Null while the workflow has no webhook secret key to build the URL from.
  webhookUrl: string | null;
}

/*
 * Someone who opens a Webhook trigger has come for its URL, to paste into the
 * app that will call it. It used to be the last thing in the dialog: inside the
 * shared documentation file, under the ID, Outputs and Returns cards, below the
 * fold. Here it is the first thing, with what goes with it - a copy button, the
 * methods the URL accepts, and a request that can be pasted into a terminal to
 * try it.
 */
const WebhookTriggerPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!props.webhookUrl) {
    return (
      <ComponentSettingsSection
        id="webhook-url"
        icon={IconProp.Webhook}
        title="Webhook URL"
        tone="primary"
      >
        <p
          className="text-sm text-gray-600"
          data-testid="webhook-trigger-url-missing"
        >
          This workflow does not have a webhook URL yet. Reset the secret key on
          the workflow&apos;s Settings page to create one.
        </p>
      </ComponentSettingsSection>
    );
  }

  const curlExample: string = getWebhookTriggerCurlExample(props.webhookUrl);

  return (
    <ComponentSettingsSection
      id="webhook-url"
      icon={IconProp.Webhook}
      title="Webhook URL"
      description="Send a request to this URL to start the workflow."
      tone="primary"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <BreakableCode
          text={props.webhookUrl}
          breakAfter="/"
          dataTestId="webhook-trigger-url"
          className="block min-w-0 flex-1 overflow-x-auto rounded-md border border-gray-200 bg-white px-3 py-2 text-xs leading-5 text-gray-900 sm:text-sm"
        />
        <CopyTextButton
          textToBeCopied={props.webhookUrl}
          label="Copy URL"
          size="md"
          variant="soft"
          title="Copy the webhook URL"
          className="shrink-0 self-start"
        />
      </div>

      <div
        className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-gray-600"
        data-testid="webhook-trigger-methods"
      >
        <span>Accepts</span>
        {WEBHOOK_TRIGGER_HTTP_METHODS.map(
          (method: HTTPMethod, index: number) => {
            return (
              <React.Fragment key={method}>
                {index > 0 ? <span>or</span> : <></>}
                <span className="rounded border border-gray-200 bg-white px-1.5 py-0.5 font-mono text-[11px] font-semibold text-gray-700">
                  {method}
                </span>
              </React.Fragment>
            );
          },
        )}
        <span>requests.</span>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-gray-700">Try it</p>
          <CopyTextButton
            textToBeCopied={curlExample}
            label="Copy"
            size="sm"
            variant="soft"
            title="Copy the example request"
          />
        </div>
        <pre
          className="mt-1.5 overflow-x-auto rounded-md border border-gray-200 bg-white px-3 py-2 font-mono text-xs leading-5 text-gray-800"
          data-testid="webhook-trigger-curl"
        >
          <code className="font-mono">{curlExample}</code>
        </pre>
      </div>

      <div className="mt-3 flex items-start gap-1.5 text-xs text-gray-500">
        <Icon
          icon={IconProp.Lock}
          className="mt-px h-3.5 w-3.5 shrink-0 text-gray-400"
        />
        <p>
          Anyone with this URL can start the workflow, so keep it private. If it
          leaks, reset the secret key on the workflow&apos;s Settings page.
        </p>
      </div>
    </ComponentSettingsSection>
  );
};

export default WebhookTriggerPanel;
