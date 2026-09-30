import React, { FunctionComponent, ReactElement, useState } from "react";
import TelemetryIngestionKey from "Common/Models/DatabaseModels/TelemetryIngestionKey";
import Card from "Common/UI/Components/Card/Card";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import { HOST, HTTP_PROTOCOL } from "Common/UI/Config";
import Protocol from "Common/Types/API/Protocol";
import IngestionKeySelector from "../../../Components/Telemetry/IngestionKeySelector";
import {
  MessageQueueGuideVariables,
  getMessageQueueGuideVariables,
} from "./DocumentationMarkdown";

/*
 * The card every Queues setup guide renders in — the product Documentation
 * page and the empty list (through MessageQueueDocumentationCard, with its
 * system picker) and a queue's own Documentation tab:
 *
 *   1. the ingestion key: the shared picker every telemetry guide uses
 *      (Components/Telemetry/IngestionKeySelector: list, select or create a
 *      key, with the OneUptime URL beside it);
 *   2. the guide itself, markdown built by the page from the URL and the
 *      selected key's secret (placeholders until one is picked).
 *
 * The Queues product owns this card rather than borrowing another product's
 * guide card or its guide types, so a change to how other products lay out
 * their guides never reaches the Queues pages.
 */
export interface ComponentProps {
  title: string;
  description: string;
  buildMarkdown: (vars: MessageQueueGuideVariables) => string;
}

const MessageQueueGuideCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [selectedKey, setSelectedKey] = useState<TelemetryIngestionKey | null>(
    null,
  );

  const vars: MessageQueueGuideVariables = getMessageQueueGuideVariables({
    host: HOST,
    isHttps: HTTP_PROTOCOL === Protocol.HTTPS,
    secretKey: selectedKey?.secretKey?.toString(),
  });

  return (
    <Card title={props.title} description={props.description}>
      <div className="px-4 pb-6">
        <div className="mb-6">
          <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
            Select Ingestion Key
          </label>
          <IngestionKeySelector
            endpointLabel="OneUptime URL"
            endpointValue={vars.oneuptimeUrl}
            onSelectedKeyChange={setSelectedKey}
          />
        </div>

        <MarkdownViewer text={props.buildMarkdown(vars)} />
      </div>
    </Card>
  );
};

export default MessageQueueGuideCard;
