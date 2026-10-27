import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import ServiceCallsTable, {
  ServiceCallsTableRow,
} from "../ServiceCalls/ServiceCallsTable";
import { MessageQueueServiceRow } from "./MessageQueueTelemetryQueries";
import {
  formatMessageQueueCount,
  formatMessageQueueDurationMs,
  formatMessageQueueErrorRate,
} from "./MessageQueueOverviewPresentation";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import { CARD_GRID_CENTERED_STATE_CLASS_NAME } from "Common/UI/Components/Card/CardGridLayout";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import {
  Translator,
  translateTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * One side of a queue: the services that publish to it (their producer
 * spans, or the client spans that record their sends) or consume from it
 * (their consumer spans, less empty receives and SQS's receive polls),
 * grouped by the service that recorded them, busiest first, with their
 * error rate and p95 duration over the selected range — the Databases
 * product's "Calling services" card, once per direction
 * (MessageQueueTelemetryQueries says which spans each side reads). The table
 * holds the busiest few; when more services took part, a footer says how
 * many in all. An empty side says whether the queue has no spans at all, or
 * spans of which none is this side's, which the Traces tab then lists.
 */

export type MessageQueueServicesSide = "producers" | "consumers";

export interface ComponentProps {
  side: MessageQueueServicesSide;
  // The busiest services on this side, busiest first.
  services: Array<MessageQueueServiceRow>;
  // Service id → display name. An id without a name renders as the id.
  serviceNames: Record<string, string>;
  isLoading: boolean;
  // Every service on this side in the range (the table may show fewer).
  totalServices?: number | undefined;
  /*
   * Whether the queue has any span at all in the range: an empty side then
   * says none of them is this side's, rather than that nothing is there.
   */
  queueHasSpans?: boolean | undefined;
  // What the card's (i) says: a MESSAGE_QUEUE_METRIC_DESCRIPTIONS text.
  description: string;
}

/*
 * English translation keys: the card translates each one where it draws it,
 * and the footer is filled in the reader's language.
 */
interface SideCopy {
  title: string;
  countHeader: string;
  durationHeader: string;
  // The queue has no span at all in the range.
  empty: string;
  // The queue has spans in the range, none of them this side's.
  emptyWithSpans: string;
  // "publishing services", for the footer.
  noun: string;
  // The footer's whole sentence, with the counts as placeholders.
  footer: string;
}

const SIDE_COPY: Record<MessageQueueServicesSide, SideCopy> = {
  producers: {
    title: "Producers",
    countHeader: translationKey("Published"),
    durationHeader: translationKey("p95 publish"),
    empty: translationKey(
      "No instrumented application published to this queue in the selected range.",
    ),
    emptyWithSpans: translationKey(
      "None of this queue's spans in the selected range records a publish: no producer spans, and no client spans that record a send. The Traces tab lists the spans it has.",
    ),
    noun: "publishing services",
    footer: translationKey(
      "Showing the {{shown}} busiest of {{total}} publishing services.",
    ),
  },
  consumers: {
    title: "Consumers",
    countHeader: translationKey("Consumed"),
    durationHeader: translationKey("p95 processing"),
    empty: translationKey(
      "No instrumented application consumed from this queue in the selected range.",
    ),
    emptyWithSpans: translationKey(
      "None of this queue's spans in the selected range records a message being handled: no consumer spans, leaving out receives that returned nothing and SQS receive calls. The Traces tab lists the spans it has.",
    ),
    noun: "consuming services",
    footer: translationKey(
      "Showing the {{shown}} busiest of {{total}} consuming services.",
    ),
  },
};

/** The card's title, its column headers and its empty-state lines. */
export function getMessageQueueServicesCopy(
  side: MessageQueueServicesSide,
): SideCopy {
  return SIDE_COPY[side];
}

/**
 * What an empty side says: nothing at all in the range, or spans of which
 * none is this side's — a queue whose publishers are not traced, or whose
 * spans are all receives, settlements or client calls the side does not
 * read.
 */
export function getMessageQueueServicesEmptyText(
  side: MessageQueueServicesSide,
  queueHasSpans: boolean | null | undefined,
): string {
  return queueHasSpans ? SIDE_COPY[side].emptyWithSpans : SIDE_COPY[side].empty;
}

/**
 * The footer under a table that holds fewer services than took part, e.g.
 * "Showing the 10 busiest of 25 consuming services." Empty when the table
 * is the whole list.
 */
export function getMessageQueueServicesFooter(
  side: MessageQueueServicesSide,
  shown: number,
  total: number | null | undefined,
): string {
  if (typeof total !== "number" || !Number.isFinite(total) || total <= shown) {
    return "";
  }
  return translateTemplate(SIDE_COPY[side].footer, {
    shown: shown,
    total: formatMessageQueueCount(total),
  });
}

const MessageQueueServicesCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const copy: SideCopy = SIDE_COPY[props.side];
  const footer: string = getMessageQueueServicesFooter(
    props.side,
    props.services.length,
    props.totalServices,
  );

  return (
    <Card title={copy.title} description={props.description}>
      {props.isLoading ? (
        <ComponentLoader />
      ) : props.services.length === 0 ? (
        <div
          data-testid={`message-queue-${props.side}-empty`}
          className={`${CARD_GRID_CENTERED_STATE_CLASS_NAME} py-6 text-sm text-gray-500`}
        >
          {translator.translateText(
            getMessageQueueServicesEmptyText(props.side, props.queueHasSpans),
          )}
        </div>
      ) : (
        <ServiceCallsTable
          dataTestId={`message-queue-${props.side}`}
          rowTestId={`message-queue-${props.side}-row`}
          footerTestId={`message-queue-${props.side}-footer`}
          countHeader={copy.countHeader}
          durationHeader={copy.durationHeader}
          footer={footer}
          rows={props.services.map(
            (service: MessageQueueServiceRow): ServiceCallsTableRow => {
              return {
                serviceId: service.serviceId,
                name: props.serviceNames[service.serviceId] || null,
                route: RouteUtil.populateRouteParams(
                  RouteMap[PageMap.SERVICE_VIEW] as Route,
                  { modelId: new ObjectID(service.serviceId) },
                ),
                calls: formatMessageQueueCount(service.calls),
                errorRate: formatMessageQueueErrorRate(
                  service.errorRatePercent,
                ),
                duration: formatMessageQueueDurationMs(service.p95DurationMs),
              };
            },
          )}
        />
      )}
    </Card>
  );
};

export default MessageQueueServicesCard;
