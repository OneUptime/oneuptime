import React, { FunctionComponent, ReactElement } from "react";
import IconProp from "Common/Types/Icon/IconProp";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import SetupGuideCard, {
  SetupGuideRenderContext,
} from "../../../Components/SetupGuide/SetupGuideCard";
import { SetupGuideContent } from "../../../Components/SetupGuide/SetupGuide";
import {
  DEFAULT_MESSAGE_QUEUE_GUIDE_SYSTEM,
  MESSAGE_QUEUE_SETUP_GUIDE_OPTIONS,
  MessageQueueDocumentationTarget,
  getMessageQueueSetupGuide,
  resolveMessageQueueGuideSystem,
} from "./DocumentationMarkdown";

/*
 * The Queues setup guide with the viewer's ingestion key filled in, on the
 * shared SetupGuideCard every product's guide uses. Two uses:
 *
 *   - the product Documentation page and the empty list: no `queue`, a
 *     messaging-system picker over the catalog (pills, alphabetical, as the
 *     docs page's table lists them) that opens on Apache Kafka;
 *   - a queue's Documentation tab: `queue` prefills the guide for that
 *     queue — its identity, and what its telemetry already reported about
 *     the broker — for the queue's own SPECIFIC system, so there is no
 *     picker.
 *
 * The guide itself is DocumentationMarkdown's getMessageQueueSetupGuide.
 */
export interface ComponentProps {
  title: string;
  description: string;
  queue?: MessageQueueDocumentationTarget | undefined;
}

const MessageQueueDocumentationCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const getContent: (context: SetupGuideRenderContext) => SetupGuideContent = (
    context: SetupGuideRenderContext,
  ): SetupGuideContent => {
    /*
     * A queue's own tab always uses the queue's system — even one the
     * catalog does not know, which gets the generic guide under its own
     * name; the picker is only for the product page.
     */
    return getMessageQueueSetupGuide({
      oneuptimeUrl: context.oneuptimeUrl,
      apiKey: context.apiKey,
      system: props.queue
        ? props.queue.system
        : resolveMessageQueueGuideSystem(context.option),
      queue: props.queue,
    });
  };

  return (
    <SetupGuideCard
      title={props.title}
      description={props.description}
      icon={IconProp.QueueList}
      optionsLabel="Which messaging system?"
      options={props.queue ? undefined : MESSAGE_QUEUE_SETUP_GUIDE_OPTIONS}
      optionsLayout="pills"
      initialOption={
        props.queue ? undefined : DEFAULT_MESSAGE_QUEUE_GUIDE_SYSTEM
      }
      /*
       * Applications' exporters and collectors send no Origin header, so a
       * Browser key is refused on every export; only Server keys are
       * offered, and created.
       */
      getKeyTypeFilter={(): TelemetryIngestionKeyType => {
        return TelemetryIngestionKeyType.Server;
      }}
      getContent={getContent}
    />
  );
};

export default MessageQueueDocumentationCard;
