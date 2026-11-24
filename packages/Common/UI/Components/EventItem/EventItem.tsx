import Icon from "../Icon/Icon";
import Link from "../Link/Link";
import MarkdownViewer from "../Markdown.tsx/LazyMarkdownViewer";
import Pill from "../Pill/Pill";
import EventAttachmentList from "../AttachmentList/EventAttachmentList";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import { VeryLightGray } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import OneUptimeDate from "../../../Types/Date";
import IconProp from "../../../Types/Icon/IconProp";
import { isRecordNameAsWritten } from "../../../Utils/DefaultRecordNames";
import { sortByNaturalName } from "../../../Utils/NaturalOrder";
import React, { FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";
import TranslatedSentence from "../TranslatedSentence/TranslatedSentence";
import { translationKey } from "../../Utils/TranslateTemplate";
import EventItemRelatedEventsList, {
  EventItemRelatedEvents,
} from "./EventItemRelatedEvents";

/*
 * A change of an event's state, as one sentence with the event's kind and
 * the new state's pill where the reader's language puts them. It read the
 * kind, then "state changed to", then the pill, in English's order (#8290).
 */
export const EVENT_STATE_CHANGED_TO: string = translationKey(
  "{{eventType}} state changed to {{state}}",
);

/*
 * The incident an incident card belongs to, on a page that groups incidents
 * by episode (#10767): "Part of Infrastructure Outage", its name a link to
 * it. One sentence, the name where the reader's language puts it.
 */
export const EVENT_PART_OF: string = translationKey("Part of {{incident}}");

// What an event is part of: its name, and its own page.
export interface EventItemParent {
  title: string;
  route?: Route | URL | undefined;
}

export enum TimelineItemType {
  StateChange = "StateChange",
  Note = "Note",
}

export interface TimelineAttachment {
  name: string;
  downloadUrl: string;
}

export interface TimelineItem {
  date: Date;
  note?: string;
  type: TimelineItemType;
  state?: BaseModel;
  stateDisplayName?: string;
  icon: IconProp;
  iconColor: Color;
  attachments?: Array<TimelineAttachment>;
  title?: string;
  highlight?: boolean;
}

export interface EventItemLabel {
  name: string;
  color: Color;
}

/*
 * An event's labels on a status page: side by side, onto the next line
 * when the box is full, and a label longer than the box runs onto a second
 * line inside its pill (Pill's isWrapping) - a visitor on a phone has
 * nothing to point with to read one cut short. They sat on one line that
 * never wrapped, and a project's long labels ("4.Business
 * System=Customer Mobile App") ran out of the incident's box and past the
 * page's edge.
 */
export const EVENT_ITEM_LABELS_CLASS_NAME: string =
  "mt-3 flex flex-wrap gap-1.5 active-event-box-body-labels";

export const EVENT_ITEM_LABEL_CLASS_NAME: string = "min-w-0 max-w-full";

/*
 * The way into an event's own page, at the foot of its card on the
 * overview and the lists: "View Incident", "View Announcement". It was
 * gray-400, 2.5:1 on the white card, and read as switched off while it is
 * the only way there (#9016). A quiet link that reads as one: gray-600
 * (7.6:1), darker and underlined under the pointer, ringed when focused.
 * Link adds the pointer cursor itself.
 */
export const EVENT_ITEM_VIEW_LINK_CLASS_NAME: string =
  "rounded text-sm font-medium text-gray-600 underline-offset-2 hover:text-gray-900 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

/*
 * Words that frame what the card says - "Affected resources" before the
 * resources' pills, the event's mini description - quieter than the text
 * around them, and still read: gray-500 (4.8:1), where gray-400 was 2.5:1
 * (#9016).
 */
export const EVENT_ITEM_QUIET_TEXT_CLASS_NAME: string = "text-sm text-gray-500";

export interface ComponentProps {
  eventTitle: string;
  eventResourcesAffected?: Array<string> | undefined;
  eventDescription?: string | undefined;
  eventTimeline: Array<TimelineItem>;
  eventMiniDescription?: string | undefined;
  eventTypeColor: Color;
  eventType: string;
  eventViewRoute?: Route | URL | undefined;
  isDetailItem: boolean;
  currentStatus?: string;
  currentStatusColor?: Color;
  anotherStatus?: string | undefined;
  anotherStatusColor?: Color | undefined;
  eventSecondDescription: string;
  labels?: Array<EventItemLabel> | undefined;
  eventAttachments?: Array<TimelineAttachment> | undefined;
  /*
   * Handed to every EventAttachmentList this item renders: the event's own
   * attachments and each timeline note's. See EventAttachmentList.
   */
  attachmentRefreshSession?: (() => Promise<boolean>) | undefined;
  /*
   * The events this one holds - an episode's incidents, on a page that
   * groups incidents by episode - folded under its resources until opened
   * (EventItemRelatedEvents).
   */
  relatedEvents?: EventItemRelatedEvents | undefined;
  // The events this one is part of: an incident's episodes, on such a page.
  partOf?: Array<EventItemParent> | undefined;
}

const EventItem: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { t } = useTranslation();
  return (
    <div className="mt-5 mb-5 bg-white shadow rounded-xl border-gray-100 p-5">
      <div>
        <div className="flex space-x-1">
          <div>
            <Pill
              key={1}
              text={props.eventType}
              color={props.eventTypeColor}
              isMinimal={true}
            />
          </div>
          {props.currentStatus && props.currentStatusColor && (
            <div>
              <Pill
                key={2}
                text={props.currentStatus}
                color={props.currentStatusColor}
                isMinimal={true}
              />
            </div>
          )}
          {props.anotherStatus && props.anotherStatusColor && (
            <div>
              <Pill
                key={3}
                text={props.anotherStatus}
                color={props.anotherStatusColor}
                isMinimal={true}
              />
            </div>
          )}
        </div>
        <div className="mt-5">
          <h2
            className={`active-event-box-body-title event-${props.eventType.toLowerCase()}-box-body-title`}
            style={{
              fontSize: props.isDetailItem ? "20px" : "16px",
            }}
          >
            {props.eventTitle}
          </h2>
        </div>
        {props.eventDescription && (
          <div
            className={`mt-2 text-sm active-event-box-body-description event-${props.eventType.toLowerCase()}-box-body-description`}
          >
            <MarkdownViewer text={props.eventDescription || ""} />
          </div>
        )}

        {props.eventAttachments && props.eventAttachments.length > 0 && (
          <EventAttachmentList
            attachments={props.eventAttachments}
            refreshSession={props.attachmentRefreshSession}
          />
        )}

        {props.eventSecondDescription && (
          <div className="mt-3 text-gray-500 text-sm active-event-box-body-second-description">
            {props.eventSecondDescription}
          </div>
        )}

        {props.partOf && props.partOf.length > 0 ? (
          <div className="mt-2 space-y-1" data-testid="event-item-part-of">
            {props.partOf.map((parent: EventItemParent, i: number) => {
              return (
                <p key={i} className="text-sm text-gray-500">
                  <TranslatedSentence
                    template={EVENT_PART_OF}
                    slots={{
                      incident: parent.route ? (
                        <Link
                          className="font-medium text-gray-900 underline decoration-gray-300 underline-offset-2 hover:decoration-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                          to={parent.route}
                          dataTestId="event-item-part-of-link"
                        >
                          {parent.title}
                        </Link>
                      ) : (
                        <span className="font-medium text-gray-900">
                          {parent.title}
                        </span>
                      ),
                    }}
                  />
                </p>
              );
            })}
          </div>
        ) : (
          <></>
        )}

        {props.eventMiniDescription && (
          <div
            className={`mt-3 ${EVENT_ITEM_QUIET_TEXT_CLASS_NAME} active-event-box-body-mini-description`}
          >
            {props.eventMiniDescription}
          </div>
        )}

        {props.labels && props.labels.length > 0 ? (
          <div className={EVENT_ITEM_LABELS_CLASS_NAME}>
            {/*
             * In natural order, as labels are listed everywhere
             * (Utils/LabelOrder).
             */}
            {sortByNaturalName<EventItemLabel>(
              props.labels,
              (label: EventItemLabel): string => {
                return label.name;
              },
            ).map((label: EventItemLabel, i: number) => {
              return (
                <div key={i} className={EVENT_ITEM_LABEL_CLASS_NAME}>
                  <Pill
                    text={label.name}
                    // A label's name is its owner's, drawn as written.
                    isUserContent={true}
                    color={label.color}
                    isWrapping={true}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <></>
        )}
      </div>
      <div>
        {props.eventResourcesAffected &&
          props.eventResourcesAffected?.length > 0 && (
            <div
              className="w-full border-t border-gray-200 mt-5 mb-5 -ml-5 -mr-5 -pr-5"
              style={{ width: "calc(100% + 2.5em)" }}
            ></div>
          )}

        {props.eventResourcesAffected &&
        props.eventResourcesAffected?.length > 0 ? (
          <div key={0}>
            <div className="flex flex-wrap gap-y-4 space-x-1 active-event-box-body-reesources">
              <div className={`${EVENT_ITEM_QUIET_TEXT_CLASS_NAME} mr-3 mt-1`}>
                {t("eventItem.affectedResources", "Affected resources")}
              </div>
              {props.eventResourcesAffected?.map((item: string, i: number) => {
                return (
                  <Pill
                    key={i}
                    text={item}
                    /*
                     * A resource's name on the page, as its owner wrote it:
                     * never looked up, so "Website" stays "Website" (#10767).
                     */
                    isUserContent={true}
                    color={VeryLightGray}
                  />
                );
              })}
            </div>
          </div>
        ) : (
          <></>
        )}

        {props.relatedEvents && props.relatedEvents.items.length > 0 ? (
          <>
            <div
              className="w-full border-t border-gray-200 mt-5 mb-4 -ms-5"
              style={{ width: "calc(100% + 2.5em)" }}
            ></div>
            <EventItemRelatedEventsList relatedEvents={props.relatedEvents} />
          </>
        ) : (
          <></>
        )}

        {props.eventTimeline && props.eventTimeline.length > 0 && (
          <div
            className={`w-full border-t border-gray-200 mt-5 -ml-5 ${
              props.eventTimeline && props.eventTimeline.length > 0
                ? "mb-5"
                : "mb-0"
            } -mr-5 -pr-5`}
            style={{ width: "calc(100% + 2.5em)" }}
          ></div>
        )}

        <div className="flow-root">
          <ul role="list" className="-mb-8">
            {props.eventTimeline &&
              props.eventTimeline.map((item: TimelineItem, i: number) => {
                if (item.type === TimelineItemType.StateChange) {
                  return (
                    <li key={i}>
                      <div className="relative pb-8">
                        {i !== props.eventTimeline.length - 1 && (
                          <span
                            className="absolute top-5 left-5 -ml-px h-full w-0.5 bg-gray-200"
                            aria-hidden="true"
                          ></span>
                        )}
                        <div className="relative flex items-start space-x-3">
                          <div>
                            <div className="relative px-1">
                              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 ring-8 ring-white">
                                <Icon
                                  icon={item.icon}
                                  className="h-5 w-5 text-gray-500"
                                  style={{
                                    color: item.iconColor.toString(),
                                  }}
                                />
                              </div>
                            </div>
                          </div>
                          <div className="min-w-0 flex-1 py-0">
                            <div
                              className="text-sm leading-8 text-gray-500"
                              data-testid="event-item-state-change"
                            >
                              <TranslatedSentence
                                template={EVENT_STATE_CHANGED_TO}
                                slots={{
                                  eventType: (
                                    <span className="font-medium text-gray-900">
                                      {props.eventType}
                                    </span>
                                  ),
                                  state: (
                                    <Pill
                                      text={
                                        item.stateDisplayName ||
                                        (item.state?.getColumnValue(
                                          "name",
                                        ) as string)
                                      }
                                      /*
                                       * The page's own words for the state, or
                                       * its name: OneUptime's default looked
                                       * up, the project's own as written.
                                       */
                                      isUserContent={
                                        Boolean(item.stateDisplayName) ||
                                        isRecordNameAsWritten(
                                          item.state?.tableName,
                                          item.state?.getColumnValue(
                                            "name",
                                          ) as string,
                                        )
                                      }
                                      color={
                                        item.state?.getColumnValue(
                                          "color",
                                        ) as Color
                                      }
                                      isMinimal={true}
                                    />
                                  ),
                                }}
                              />
                            </div>
                            <div>
                              <span className="text-sm leading-8 text-gray-500 whitespace-nowrap">
                                {OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                                  item.date,
                                )}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                }

                if (item.type === TimelineItemType.Note) {
                  return (
                    <li key={i}>
                      <div className="relative pb-8">
                        {i !== props.eventTimeline.length - 1 && (
                          <span
                            className="absolute top-5 left-5 -ml-px h-full w-0.5 bg-gray-200"
                            aria-hidden="true"
                          ></span>
                        )}
                        <div
                          className={`relative flex items-start space-x-3 ${
                            item.highlight
                              ? "rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4 shadow-sm"
                              : ""
                          }`}
                        >
                          {!item.highlight && (
                            <div>
                              <div className="relative px-1">
                                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 ring-8 ring-white">
                                  <Icon
                                    icon={item.icon}
                                    className="h-5 w-5 text-gray-500"
                                    style={{
                                      color: item.iconColor.toString(),
                                    }}
                                  />
                                </div>
                              </div>
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div>
                              <div className="text-sm">
                                <span
                                  className={`font-medium ${
                                    item.highlight
                                      ? "text-base text-gray-900"
                                      : "text-sm text-gray-900"
                                  }`}
                                >
                                  {item.title
                                    ? item.title
                                    : t("eventItem.updateTo", {
                                        eventType: props.eventType,
                                        defaultValue:
                                          "Update to this {{eventType}}",
                                      })}
                                </span>
                              </div>
                              {/*
                               * "posted on {{date}}": one sentence, the date
                               * where the reader's language puts it. It read
                               * "posted on" and then the date (#8290).
                               */}
                              <p
                                className="mt-0.5 text-sm text-gray-500"
                                data-testid="event-item-posted-on"
                              >
                                {t("eventItem.postedOnDate", {
                                  date: OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                                    item.date,
                                  ),
                                  defaultValue: "posted on {{date}}",
                                })}
                              </p>
                            </div>
                            <div className="mt-2 text-sm text-gray-700">
                              {/*
                               * A <div>, not a <p>: the note's Markdown draws
                               * paragraphs, quotes and callouts of its own,
                               * and none of them may sit inside a <p>.
                               */}
                              <div data-testid="event-item-note">
                                <MarkdownViewer text={item.note || ""} />
                              </div>
                              {item.attachments &&
                                item.attachments.length > 0 && (
                                  <EventAttachmentList
                                    attachments={item.attachments}
                                    refreshSession={
                                      props.attachmentRefreshSession
                                    }
                                    variant="inline"
                                    showHeader={false}
                                    showCount={false}
                                    className="mt-3"
                                  />
                                )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                }

                return <></>;
              })}
          </ul>
        </div>

        {props.eventViewRoute && (
          <div
            className="w-full border-t border-gray-200 mt-5 mb-5 -ml-5 -mr-5 -pr-5"
            style={{ width: "calc(100% + 2.5em)" }}
          ></div>
        )}

        <div className="active-event-box-body-timestamp mt-5 flex justify-end">
          {props.eventViewRoute ? (
            <span>
              <Link
                className={EVENT_ITEM_VIEW_LINK_CLASS_NAME}
                to={props.eventViewRoute}
              >
                <>
                  {t("eventItem.view", {
                    eventType: props.eventType,
                    defaultValue: "View {{eventType}}",
                  })}
                </>
              </Link>
            </span>
          ) : (
            <></>
          )}
        </div>
      </div>
    </div>
  );
};

export default EventItem;
