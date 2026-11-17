import {
  ChannelReach,
  NotificationChannelDefinition,
  NotificationChannelKey,
  canChannelReach,
  getChannelSetUpRoute,
  getChannelWord,
  isChannelColumnShown,
} from "./NotificationChannelReadiness";
import {
  NotificationSettingsWords,
  OfferedChannel,
} from "./NotificationSettingsWords";
import {
  RowsByEvent,
  SetChannelRequest,
  isChannelOn,
} from "./useNotificationSettingRows";
import UserNotificationSetting from "Common/Models/DatabaseModels/UserNotificationSetting";
import Route from "Common/Types/API/Route";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon, { SizeProp } from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import SaveStatus, {
  SaveState,
} from "Common/UI/Components/SaveStatus/SaveStatus";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import useTableBoxWidth, {
  TableBoxWidth,
} from "Common/UI/Components/Table/useTableBoxWidth";
import {
  translatableTerm,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import API from "Common/UI/Utils/API/API";
import React, {
  Fragment,
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useRef,
  useState,
} from "react";

/*
 * ONE CARD OF USER SETTINGS > NOTIFICATION SETTINGS.
 *
 * Its events are rows and the channels are columns, each cell the shared
 * switch (Common/UI/Components/Toggle): on is a filled indigo track with the
 * knob at the end, off a grey one with the knob at the start - the switch
 * every other setting in OneUptime is. The cells were faint circles, a
 * green tick for on and a grey dot for off, that read as a grid of
 * decorations rather than of things to press (#8887).
 *
 *   - A card of several events opens on "All events": a switch per channel
 *     that is on while every event of the card is on for it, and turns that
 *     channel on - or, when every event already is, off - for all of them
 *     at once. Turning Slack on for seven incident events was seven clicks.
 *   - A channel that cannot reach the person yet (NotificationChannelReadiness)
 *     is no column, unless one of the card's switches is on for it: then its
 *     column says why under its name - "Set up", a link to the tab of
 *     Notification Methods that sets it up, or "Turned off" - and only its
 *     switches that are on can be pressed, to turn them off.
 *   - What a press saves shows at once; "Saving…" and then "Saved" beside
 *     the card's title (SaveStatus) say it reached the server, and a write
 *     the server refuses goes back, with the reason over the matrix.
 *
 * Narrower than the table needs - the event's column at least 13rem, and
 * each channel 60px - each event is drawn on its own: its name and
 * description across the card, and its channels under them as switches
 * that say their names.
 */

export const NOTIFICATION_MATRIX_EVENT_COLUMN_MIN_WIDTH_PX: number = 208;
export const NOTIFICATION_MATRIX_CHANNEL_COLUMN_WIDTH_PX: number = 60;

export const doesNotificationMatrixTableFit: (data: {
  // The matrix's box, in pixels.
  width: number;
  // How many channels it shows.
  channelCount: number;
}) => boolean = (data: { width: number; channelCount: number }): boolean => {
  return (
    data.width >=
    NOTIFICATION_MATRIX_EVENT_COLUMN_MIN_WIDTH_PX +
      data.channelCount * NOTIFICATION_MATRIX_CHANNEL_COLUMN_WIDTH_PX
  );
};

export interface NotificationMatrixEvent {
  type: NotificationSettingEventType;
  label: string;
  description: string;
}

export interface NotificationMatrixSection {
  title: string;
  description: string;
  events: Array<NotificationMatrixEvent>;
}

export const NOTIFICATION_MATRIX_TEST_ID: string = "notification-matrix";
export const NOTIFICATION_MATRIX_LIST_TEST_ID: string =
  "notification-matrix-list";
export const NOTIFICATION_MATRIX_EVENT_TEST_ID: string =
  "notification-matrix-event";
export const NOTIFICATION_MATRIX_ALL_EVENTS_TEST_ID: string =
  "notification-matrix-all-events";
export const NOTIFICATION_CHANNEL_SWITCH_TEST_ID: string =
  "notification-channel-switch";
export const NOTIFICATION_MATRIX_SAVE_STATUS_TEST_ID: string =
  "notification-matrix-save-status";
export const NOTIFICATION_CHANNEL_SET_UP_TEST_ID: string =
  "notification-channel-set-up";

/*
 * The columns a card shows: every channel that can reach the person, and a
 * channel that cannot only while one of the card's switches is on for it.
 * A column once shown stays while the card is open, so turning off its last
 * switch does not take the switch away from under the pointer.
 */
export const getShownMatrixChannels: (data: {
  channels: ReadonlyArray<OfferedChannel>;
  eventTypes: ReadonlyArray<NotificationSettingEventType>;
  rowsByEvent: RowsByEvent;
  alreadyShown?: ReadonlySet<NotificationChannelKey> | undefined;
}) => Array<OfferedChannel> = (data: {
  channels: ReadonlyArray<OfferedChannel>;
  eventTypes: ReadonlyArray<NotificationSettingEventType>;
  rowsByEvent: RowsByEvent;
  alreadyShown?: ReadonlySet<NotificationChannelKey> | undefined;
}): Array<OfferedChannel> => {
  return data.channels.filter((channel: OfferedChannel): boolean => {
    if (data.alreadyShown?.has(channel.definition.key)) {
      return true;
    }

    return isChannelColumnShown({
      reach: channel.reach,
      isOnForAnEvent: data.eventTypes.some(
        (eventType: NotificationSettingEventType): boolean => {
          return isChannelOn(
            data.rowsByEvent.get(eventType),
            channel.definition.key,
          );
        },
      ),
    });
  });
};

// Whether every event given is on for the channel: what "All events" shows.
export const isOnForEveryEvent: (data: {
  eventTypes: ReadonlyArray<NotificationSettingEventType>;
  rowsByEvent: RowsByEvent;
  channel: NotificationChannelKey;
}) => boolean = (data: {
  eventTypes: ReadonlyArray<NotificationSettingEventType>;
  rowsByEvent: RowsByEvent;
  channel: NotificationChannelKey;
}): boolean => {
  return (
    data.eventTypes.length > 0 &&
    data.eventTypes.every(
      (eventType: NotificationSettingEventType): boolean => {
        return isChannelOn(data.rowsByEvent.get(eventType), data.channel);
      },
    )
  );
};

export interface NotificationMatrixProps {
  section: NotificationMatrixSection;
  // The channels the page offers, in its order, each with whether it can reach the person.
  channels: ReadonlyArray<OfferedChannel>;
  rowsByEvent: RowsByEvent;
  setChannel: (request: SetChannelRequest) => Promise<void>;
  // More of an event's own, under its description (New security case's priority).
  renderEventDetail?:
    | ((
        event: NotificationMatrixEvent,
        row: UserNotificationSetting | undefined,
        onSaving: <T>(save: Promise<T>) => Promise<T>,
      ) => ReactElement | null)
    | undefined;
}

interface ColumnNoteProps {
  channel: OfferedChannel;
  isCompact: boolean;
}

/*
 * Why a column's channel sends nothing, under its name: a link that sets it
 * up, or "Turned off" for one the project or the server has off.
 */
const ColumnNote: FunctionComponent<ColumnNoteProps> = (
  props: ColumnNoteProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (canChannelReach(props.channel.reach)) {
    return <></>;
  }

  const route: Route | null =
    props.channel.reach === ChannelReach.NotSetUp
      ? getChannelSetUpRoute(props.channel.definition.key)
      : null;

  if (route) {
    return (
      <Link
        to={route}
        dataTestId={NOTIFICATION_CHANNEL_SET_UP_TEST_ID}
        title={translator.translateTemplate(
          NotificationSettingsWords.setUpChannel,
          {
            channel: translatableTerm(getChannelWord(props.channel.definition)),
          },
        )}
        isTitleTranslated={true}
        className={`${
          props.isCompact ? "text-xs" : "text-xs"
        } font-medium text-indigo-600 hover:text-indigo-800 hover:underline`}
      >
        {translator.translateText(NotificationSettingsWords.setUp)}
      </Link>
    );
  }

  return (
    <span
      className={`${props.isCompact ? "text-xs" : "text-xs"} text-gray-500`}
    >
      {translator.translateText(NotificationSettingsWords.turnedOff)}
    </span>
  );
};

const NotificationMatrix: FunctionComponent<NotificationMatrixProps> = (
  props: NotificationMatrixProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [error, setError] = useState<string>("");
  const [saveState, setSaveState] = useState<SaveState>(SaveState.Idle);
  // Writes of this card still on their way.
  const savingRef: MutableRefObject<number> = useRef<number>(0);
  const shownRef: MutableRefObject<Set<NotificationChannelKey>> = useRef<
    Set<NotificationChannelKey>
  >(new Set());

  const eventTypes: Array<NotificationSettingEventType> =
    props.section.events.map(
      (event: NotificationMatrixEvent): NotificationSettingEventType => {
        return event.type;
      },
    );

  const shownChannels: Array<OfferedChannel> = getShownMatrixChannels({
    channels: props.channels,
    eventTypes: eventTypes,
    rowsByEvent: props.rowsByEvent,
    alreadyShown: shownRef.current,
  });

  for (const channel of shownChannels) {
    shownRef.current.add(channel.definition.key);
  }

  /*
   * The matrix's box, always drawn so its width is read from the first
   * paint - the window's where nothing is laid out (a test).
   */
  const matrixBoxRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const matrixBoxWidth: TableBoxWidth = useTableBoxWidth(matrixBoxRef);
  const isTableShown: boolean = doesNotificationMatrixTableFit({
    width: matrixBoxWidth.boxWidth ?? matrixBoxWidth.windowWidth,
    channelCount: shownChannels.length,
  });

  /*
   * Every write of the card goes through here, so the card says "Saving…"
   * while any is on its way, "Saved" once the last has landed, and why one
   * was refused.
   */
  const trackSave: <T>(save: Promise<T>) => Promise<T> = async <T,>(
    save: Promise<T>,
  ): Promise<T> => {
    savingRef.current++;
    setSaveState(SaveState.Saving);
    setError("");

    try {
      const result: T = await save;
      savingRef.current--;

      if (savingRef.current === 0) {
        setSaveState(SaveState.Saved);
      }

      return result;
    } catch (err) {
      savingRef.current--;
      setSaveState(SaveState.Idle);
      // Already in the reader's words (useNotificationSettingRows).
      setError(
        err instanceof Error && err.message
          ? err.message
          : API.getFriendlyMessage(err),
      );
      throw err;
    }
  };

  const switchChannel: (
    events: ReadonlyArray<NotificationSettingEventType>,
    channel: NotificationChannelKey,
    value: boolean,
  ) => void = (
    events: ReadonlyArray<NotificationSettingEventType>,
    channel: NotificationChannelKey,
    value: boolean,
  ): void => {
    trackSave(
      props.setChannel({
        eventTypes: events,
        channel: channel,
        value: value,
      }),
    ).catch((): void => {
      // Said over the matrix (trackSave).
    });
  };

  const hasAllEventsRow: boolean = props.section.events.length > 1;

  const sectionName: ReturnType<typeof translatableTerm> = translatableTerm(
    props.section.title,
  );

  /*
   * A cell's switch. One whose channel cannot reach the person can only be
   * turned off: it is there because it is on, and turning it on again would
   * send nothing.
   */
  const renderCellSwitch: (data: {
    event: NotificationMatrixEvent;
    channel: OfferedChannel;
    isNamedBeside: boolean;
  }) => ReactElement = (data: {
    event: NotificationMatrixEvent;
    channel: OfferedChannel;
    isNamedBeside: boolean;
  }): ReactElement => {
    const isOn: boolean = isChannelOn(
      props.rowsByEvent.get(data.event.type),
      data.channel.definition.key,
    );
    const isLocked: boolean = !isOn && !canChannelReach(data.channel.reach);

    if (data.isNamedBeside) {
      return (
        <Toggle
          value={isOn}
          title={getChannelWord(data.channel.definition)}
          description={
            canChannelReach(data.channel.reach)
              ? undefined
              : data.channel.reach === ChannelReach.TurnedOff
                ? NotificationSettingsWords.turnedOff
                : NotificationSettingsWords.notSetUp
          }
          disabled={isLocked}
          dataTestId={NOTIFICATION_CHANNEL_SWITCH_TEST_ID}
          onChange={(value: boolean): void => {
            switchChannel(
              [data.event.type],
              data.channel.definition.key,
              value,
            );
          }}
        />
      );
    }

    return (
      <Toggle
        value={isOn}
        ariaLabel={translator.translateTemplate(
          NotificationSettingsWords.channelForEvent,
          {
            channel: translatableTerm(getChannelWord(data.channel.definition)),
            event: translatableTerm(data.event.label),
          },
        )}
        isAriaLabelTranslated={true}
        disabled={isLocked}
        onChange={(value: boolean): void => {
          switchChannel([data.event.type], data.channel.definition.key, value);
        }}
      />
    );
  };

  // "All events": a channel's switch for every event of the card.
  const renderAllEventsSwitch: (data: {
    channel: OfferedChannel;
    isNamedBeside: boolean;
  }) => ReactElement = (data: {
    channel: OfferedChannel;
    isNamedBeside: boolean;
  }): ReactElement => {
    // A channel that cannot reach the person takes no new switches.
    if (!canChannelReach(data.channel.reach)) {
      return <></>;
    }

    const isOn: boolean = isOnForEveryEvent({
      eventTypes: eventTypes,
      rowsByEvent: props.rowsByEvent,
      channel: data.channel.definition.key,
    });
    const name: string = translator.translateTemplate(
      NotificationSettingsWords.channelForEveryEvent,
      {
        channel: translatableTerm(getChannelWord(data.channel.definition)),
        section: sectionName,
      },
    );

    const onChange: (value: boolean) => void = (value: boolean): void => {
      switchChannel(eventTypes, data.channel.definition.key, value);
    };

    if (data.isNamedBeside) {
      return (
        <Toggle
          value={isOn}
          title={getChannelWord(data.channel.definition)}
          dataTestId={NOTIFICATION_CHANNEL_SWITCH_TEST_ID}
          onChange={onChange}
        />
      );
    }

    return (
      <Toggle
        value={isOn}
        ariaLabel={name}
        isAriaLabelTranslated={true}
        onChange={onChange}
      />
    );
  };

  const renderEventText: (event: NotificationMatrixEvent) => ReactElement = (
    event: NotificationMatrixEvent,
  ): ReactElement => {
    const row: UserNotificationSetting | undefined = props.rowsByEvent.get(
      event.type,
    );

    return (
      <Fragment>
        <div className="text-sm font-medium text-gray-900">
          {translator.translateText(event.label) || event.label}
        </div>
        <div className="mt-0.5 max-w-md text-xs text-gray-500">
          {translator.translateText(event.description) || event.description}
        </div>
        {props.renderEventDetail ? (
          props.renderEventDetail(event, row, trackSave)
        ) : (
          <></>
        )}
      </Fragment>
    );
  };

  const table: ReactElement = (
    <div className="overflow-x-auto">
      <table className="min-w-full">
        <thead>
          <tr className="border-b border-gray-200">
            <th
              scope="col"
              className="sticky left-0 z-0 bg-white py-3 pr-4 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500"
            >
              {translator.translateText("Event")}
            </th>
            {shownChannels.map((channel: OfferedChannel) => {
              /*
               * Top-aligned, so the icons stay in one row when a label takes
               * two lines ("Microsoft Teams" in a narrow column, or a long
               * translation such as "Correo electronico"), or a column says
               * why it sends nothing under its name.
               */
              return (
                <th
                  key={channel.definition.key}
                  scope="col"
                  className="px-2 py-3 text-center align-top"
                  data-reach={channel.reach}
                >
                  <div className="flex flex-col items-center gap-1">
                    <Icon
                      icon={channel.definition.icon}
                      className={`h-4 w-4 ${
                        canChannelReach(channel.reach)
                          ? "text-gray-500"
                          : "text-gray-300"
                      }`}
                      size={SizeProp.Regular}
                    />
                    <span className="text-xs font-medium text-gray-600">
                      {translator.translateText(
                        getChannelWord(channel.definition),
                      )}
                    </span>
                    <ColumnNote channel={channel} isCompact={true} />
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {hasAllEventsRow ? (
            <tr
              className="bg-gray-50"
              data-testid={NOTIFICATION_MATRIX_ALL_EVENTS_TEST_ID}
            >
              <th
                scope="row"
                className="sticky left-0 z-0 bg-gray-50 py-3 pr-4 text-left align-middle text-sm font-medium text-gray-700"
              >
                {translator.translateText(NotificationSettingsWords.allEvents)}
              </th>
              {shownChannels.map((channel: OfferedChannel) => {
                return (
                  <td
                    key={channel.definition.key}
                    className="px-2 py-3 text-center align-middle"
                  >
                    <div className="flex justify-center">
                      {renderAllEventsSwitch({
                        channel: channel,
                        isNamedBeside: false,
                      })}
                    </div>
                  </td>
                );
              })}
            </tr>
          ) : (
            <></>
          )}
          {props.section.events.map((event: NotificationMatrixEvent) => {
            return (
              <tr
                key={event.type}
                className="group transition-colors hover:bg-gray-50/60"
              >
                <th
                  scope="row"
                  className="sticky left-0 z-0 bg-white py-4 pr-4 text-left align-top font-normal transition-colors group-hover:bg-gray-50/60"
                >
                  {renderEventText(event)}
                </th>
                {shownChannels.map((channel: OfferedChannel) => {
                  return (
                    <td
                      key={channel.definition.key}
                      className="px-2 py-4 text-center align-middle"
                    >
                      <div className="flex justify-center">
                        {renderCellSwitch({
                          event: event,
                          channel: channel,
                          isNamedBeside: false,
                        })}
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  /*
   * The narrow layout: each event across the card, its channels under it as
   * switches that say their names, two to a line (three from sm), so they
   * line up from one event to the next.
   */
  const channelGridClassName: string =
    "mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3";

  const list: ReactElement = (
    <ul
      className="divide-y divide-gray-100"
      data-testid={NOTIFICATION_MATRIX_LIST_TEST_ID}
    >
      {hasAllEventsRow ? (
        <li
          className="-mx-2 rounded-md bg-gray-50 px-2 py-3"
          data-testid={NOTIFICATION_MATRIX_ALL_EVENTS_TEST_ID}
        >
          <div className="text-sm font-medium text-gray-700">
            {translator.translateText(NotificationSettingsWords.allEvents)}
          </div>
          <div
            role="group"
            aria-label={translator.translateText(
              NotificationSettingsWords.allEvents,
            )}
            className={channelGridClassName}
          >
            {shownChannels
              .filter((channel: OfferedChannel): boolean => {
                return canChannelReach(channel.reach);
              })
              .map((channel: OfferedChannel) => {
                return (
                  <div key={channel.definition.key} className="min-w-0">
                    {renderAllEventsSwitch({
                      channel: channel,
                      isNamedBeside: true,
                    })}
                  </div>
                );
              })}
          </div>
        </li>
      ) : (
        <></>
      )}
      {props.section.events.map((event: NotificationMatrixEvent) => {
        const eventName: string =
          translator.translateText(event.label) || event.label;

        return (
          <li
            key={event.type}
            className="py-4 last:pb-0"
            data-testid={NOTIFICATION_MATRIX_EVENT_TEST_ID}
          >
            {renderEventText(event)}
            <div
              role="group"
              aria-label={eventName}
              className={channelGridClassName}
            >
              {shownChannels.map((channel: OfferedChannel) => {
                return (
                  <div key={channel.definition.key} className="min-w-0">
                    {renderCellSwitch({
                      event: event,
                      channel: channel,
                      isNamedBeside: true,
                    })}
                  </div>
                );
              })}
            </div>
          </li>
        );
      })}
    </ul>
  );

  return (
    <Card
      title={props.section.title}
      description={props.section.description}
      headerLayout="stacked"
      rightElement={
        <SaveStatus
          state={saveState}
          dataTestId={NOTIFICATION_MATRIX_SAVE_STATUS_TEST_ID}
        />
      }
      bodyClassName="mt-5"
    >
      <div ref={matrixBoxRef} data-testid={NOTIFICATION_MATRIX_TEST_ID}>
        {error ? (
          <div className="mb-4">
            <ErrorMessage message={error} />
          </div>
        ) : (
          <></>
        )}
        {isTableShown ? table : list}
      </div>
    </Card>
  );
};

export default NotificationMatrix;

// What a channel of the matrix is drawn from, for a page that lists them.
export type { NotificationChannelDefinition };
