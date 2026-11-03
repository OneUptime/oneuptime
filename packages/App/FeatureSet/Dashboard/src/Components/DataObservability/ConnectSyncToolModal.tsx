import IngestionKeySelector from "../Telemetry/IngestionKeySelector";
import TelemetryIngestionKey from "Common/Models/DatabaseModels/TelemetryIngestionKey";
import Protocol from "Common/Types/API/Protocol";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import { HOST, HTTP_PROTOCOL } from "Common/UI/Config";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

export interface ComponentProps {
  onClose: () => void;
}

type SyncTool = "fivetran" | "airbyte";

/*
 * "How do my Fivetran and Airbyte syncs get here?"
 *
 * Neither tool sends a header of its own, so the guide hands over URLs,
 * written against App/FeatureSet/Telemetry/API/SyncWebhooksIngest.ts:
 *
 *  - Fivetran's names the ingestion key by its id, and the webhook's secret
 *    is the key itself: Fivetran signs every delivery with it, so the key
 *    never travels in the URL.
 *  - Airbyte signs nothing, so its URL carries the key, and the guide says
 *    to give Airbyte a key of its own.
 *
 * A key picked here fills both in; a project with no key creates one here.
 */
const ConnectSyncToolModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [tool, setTool] = useState<SyncTool>("fivetran");
  const [selectedKey, setSelectedKey] = useState<TelemetryIngestionKey | null>(
    null,
  );

  const baseUrl: string = HOST
    ? `${HTTP_PROTOCOL === Protocol.HTTPS ? "https" : "http"}://${HOST}`
    : "<YOUR_ONEUPTIME_URL>";
  const keyId: string = selectedKey?.id?.toString() || "<INGESTION_KEY_ID>";
  const keyValue: string =
    selectedKey?.secretKey?.toString() || "<INGESTION_KEY>";
  const fivetranUrl: string = `${baseUrl}/telemetry/fivetran/v1/webhook/${keyId}`;
  const airbyteUrl: string = `${baseUrl}/telemetry/airbyte/v1/webhook/${keyValue}`;

  const fivetranCommand: string = `curl -X POST https://api.fivetran.com/v1/webhooks/account \\
  -u "$FIVETRAN_API_KEY:$FIVETRAN_API_SECRET" \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "${fivetranUrl}",
    "events": ["sync_start", "sync_end"],
    "active": true,
    "secret": "${keyValue}"
  }'`;

  const tools: Array<{ key: SyncTool; label: string }> = [
    { key: "fivetran", label: "Fivetran" },
    { key: "airbyte", label: "Airbyte" },
  ];

  return (
    <Modal
      title="Connect Fivetran or Airbyte"
      description="Each Fivetran connector and Airbyte connection becomes a pipeline, and each sync a run, alerting on a failed, unusually long or late run."
      modalWidth={ModalWidth.Large}
      onClose={props.onClose}
      closeButtonText="Close"
    >
      <div className="space-y-5">
        <IngestionKeySelector
          endpointLabel="Webhook URL"
          endpointValue={tool === "fivetran" ? fivetranUrl : airbyteUrl}
          keyTypeFilter={TelemetryIngestionKeyType.Server}
          newKeyName={translationKey("Sync webhooks key")}
          onSelectedKeyChange={setSelectedKey}
          hideValues={true}
        />

        <div
          role="tablist"
          aria-label={translator.translateText("Sync tool")}
          className="flex flex-wrap gap-2"
        >
          {tools.map((item: { key: SyncTool; label: string }): ReactElement => {
            const isActive: boolean = item.key === tool;

            return (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => {
                  setTool(item.key);
                }}
                className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
                  isActive
                    ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                    : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        {tool === "fivetran" ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-700">
              {translator.translateText(
                "Create a webhook with Fivetran's REST API, for your account or for one destination group, with this URL and the ingestion key as its secret. Fivetran signs every delivery with the secret, so the key itself never travels in the URL.",
              )}
            </p>
            <CodeBlock
              code={fivetranCommand}
              language="bash"
              showCopyButton={true}
            />
            <p className="text-sm text-gray-600">
              {translator.translateText(
                "A connector loads the schema of its destination named after it. When exactly one watched database has that schema, its tables record the connector as their writer, so a table that goes stale points at the sync that should have loaded it.",
              )}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-gray-700">
              {translator.translateText(
                "In Airbyte, open your workspace's notification settings, paste this URL as the webhook, and turn on the webhook for failed syncs and for successful syncs.",
              )}
            </p>
            <CodeBlock
              code={airbyteUrl}
              language="text"
              showCopyButton={true}
              wrapLongLines={true}
            />
            <p className="text-sm text-gray-600">
              {translator.translateText(
                "Airbyte signs nothing, so this URL carries the ingestion key itself. Give Airbyte a key of its own, which you can delete to cut it off.",
              )}
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default ConnectSyncToolModal;
