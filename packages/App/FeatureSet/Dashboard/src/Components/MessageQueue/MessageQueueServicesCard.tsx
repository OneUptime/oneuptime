import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AppLink from "../AppLink/AppLink";
import { MessageQueueServiceRow } from "./MessageQueueTelemetryQueries";
import {
  formatMessageQueueCount,
  formatMessageQueueDurationMs,
  formatMessageQueueErrorRate,
} from "./MessageQueueOverviewPresentation";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
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
          className="text-sm text-gray-500"
        >
          {translator.translateText(
            getMessageQueueServicesEmptyText(props.side, props.queueHasSpans),
          )}
        </div>
      ) : (
        <div
          data-testid={`message-queue-${props.side}`}
          className="-m-6 -mt-2 border-t border-gray-200"
        >
          <div className="grid grid-cols-12 gap-4 bg-gray-50 px-4 py-2 text-xs font-medium uppercase tracking-wider text-gray-500">
            <div className="col-span-5">
              {translator.translateText("Service")}
            </div>
            <div className="col-span-3 text-right">
              {translator.translateText(copy.countHeader)}
            </div>
            <div className="col-span-2 text-right">
              {translator.translateText("Errors")}
            </div>
            <div className="col-span-2 text-right">
              {translator.translateText(copy.durationHeader)}
            </div>
          </div>
          <div className="divide-y divide-gray-100">
            {props.services.map(
              (service: MessageQueueServiceRow): ReactElement => {
                const name: string =
                  props.serviceNames[service.serviceId] || service.serviceId;
                const route: Route = RouteUtil.populateRouteParams(
                  RouteMap[PageMap.SERVICE_VIEW] as Route,
                  { modelId: new ObjectID(service.serviceId) },
                );
                return (
                  <div
                    key={service.serviceId}
                    data-testid={`message-queue-${props.side}-row`}
                    data-service-id={service.serviceId}
                    className="grid grid-cols-12 gap-4 px-4 py-3 text-sm"
                  >
                    <div className="col-span-5 min-w-0 truncate">
                      {props.serviceNames[service.serviceId] ? (
                        <AppLink
                          to={route}
                          className="font-medium text-gray-900 hover:underline"
                        >
                          {name}
                        </AppLink>
                      ) : (
                        <span className="font-mono text-gray-500">{name}</span>
                      )}
                    </div>
                    <div className="col-span-3 text-right text-gray-700">
                      {formatMessageQueueCount(service.calls)}
                    </div>
                    <div className="col-span-2 text-right text-gray-700">
                      {formatMessageQueueErrorRate(service.errorRatePercent)}
                    </div>
                    <div className="col-span-2 text-right text-gray-700">
                      {formatMessageQueueDurationMs(service.p95DurationMs)}
                    </div>
                  </div>
                );
              },
            )}
          </div>
          {footer ? (
            <div
              data-testid={`message-queue-${props.side}-footer`}
              className="border-t border-gray-100 px-4 py-2 text-xs text-gray-500"
            >
              {footer}
            </div>
          ) : (
            <></>
          )}
        </div>
      )}
    </Card>
  );
};

export default MessageQueueServicesCard;
