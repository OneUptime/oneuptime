import PageComponentProps from "../PageComponentProps";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import MessageQueueDocumentationCard from "./Utils/MessageQueueDocumentationCard";

/*
 * The product-level install guide: pick the messaging system, pick an
 * ingestion key, copy the instrumentation and collector setup. Queues need
 * nothing OneUptime-specific to appear — instrumented applications' spans
 * create them — so the guide is about what traces a system's clients and
 * where its broker's health metrics come from.
 */
const MessageQueueDocumentation: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <MessageQueueDocumentationCard
        title="Queues Installation Guide"
        description="Queues appear on their own from the messaging spans of your instrumented applications. Send your broker's metrics too, to add its backlog, consumer lag, dead letters and throttling to each queue."
      />
    </Fragment>
  );
};

export default MessageQueueDocumentation;
