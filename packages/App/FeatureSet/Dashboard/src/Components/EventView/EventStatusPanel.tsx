import { Black, Red500 } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import MoreMenu from "Common/UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import MoreMenuSection from "Common/UI/Components/MoreMenu/MoreMenuSection";
import Pill from "Common/UI/Components/Pill/Pill";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import { PermissionGateResult } from "Common/UI/Utils/PermissionGate";
import useTranslateValue from "Common/UI/Utils/Translation";
import { StateMoveList } from "Common/Utils/StateMove";
import React, { FunctionComponent, ReactElement } from "react";
import LiveDuration from "./LiveDuration";
import { getEventStateMenuStates } from "./EventStateMenu";
import EventStateTrack from "./EventStateTrack";
import {
  EVENT_HEADER_BUTTONS_CLASS_NAME,
  EVENT_HEADER_BUTTON_CLASS_NAME,
  EVENT_HEADER_CLASS_NAME,
  EVENT_HEADER_FACT_CLASS_NAME,
  EVENT_HEADER_FACT_LABEL_CLASS_NAME,
  EVENT_HEADER_FACT_VALUE_CLASS_NAME,
  EVENT_HEADER_LOCKED_WRAPPER_CLASS_NAME,
  EVENT_HEADER_MENU_WRAPPER_CLASS_NAME,
  EVENT_HEADER_MORE_TRIGGER_CLASS_NAME,
  EVENT_HEADER_NEUTRAL_BUTTON_CLASS_NAME,
  EVENT_HEADER_NOTICE_CLASS_NAMES,
  EVENT_HEADER_NUMBER_CLASS_NAME,
  EVENT_HEADER_PRIMARY_BUTTON_CLASS_NAME,
  EVENT_HEADER_TEST_IDS,
  EVENT_HEADER_TOP_SECTION_CLASS_NAME,
  EventHeaderActionWidthInput,
  EventHeaderNoticeTone,
  EventHeaderTopRowClassNames,
  getEventHeaderActionsBesideWidth,
  getEventHeaderFactsClassName,
  getEventHeaderTopRowClassNames,
} from "./EventHeaderLayout";

export interface EventStateItem {
  id: string;
  name: string;
  color: Color;
  /*
   * Its place in the project's list of states (1 is the top): what the
   * server compares a move by, so the menu offers only the states the
   * record may move into next.
   */
  order?: number | undefined;
  /*
   * An archived state (Common/Utils/ArchivableValues): shown only while the
   * record is in it, and never offered as a state to move to.
   */
  isArchived?: boolean | undefined;
}

export interface EventStateAction {
  stateId: string;
  label: string;
  icon?: IconProp | undefined;
  buttonStyle: ButtonStyleType;
  id?: string | undefined;
}

/*
 * A header action that is not a state change - "Declare Incident" on an
 * alert, say. It sits in the same row as the state actions, with the same
 * size and the neutral look, so the state action stays the one primary
 * button. A disabled one can carry a tooltip saying why.
 */
export interface EventPanelAction {
  id: string;
  label: string;
  icon?: IconProp | undefined;
  onClick: () => void;
  isDisabled?: boolean | undefined;
  tooltip?: string | undefined;
  /*
   * An action that goes somewhere else - Open in Slack - is a link: it opens
   * in a new tab, and can be copied or opened with the browser's own
   * gestures. Its tooltip, when it has one, says where it goes.
   */
  href?: string | undefined;
  /*
   * Choices under the button instead of one action: Open in Slack for a
   * record with two Slack channels lists both.
   */
  menuItems?: Array<EventPanelMenuItem> | undefined;
}

export interface EventPanelMenuItem {
  id: string;
  label: string;
  // The Open channel menu marks each channel with its product's logo.
  icon?: IconProp | undefined;
  onClick: () => void;
}

/*
 * A labelled fact of the header, e.g.
 * { label: "Owners", value: <OwnersFactValue ... /> } or
 * { label: "Monitor", value: <Link ...>checkout-api</Link> }.
 */
export interface EventStatusFact {
  label: string;
  value: string | ReactElement;
  icon?: IconProp | undefined;
}

export interface ComponentProps {
  states: Array<EventStateItem>; // ordered by state order.
  /*
   * The list of states the record walks down - incident states for an
   * incident or an incident episode, alert states for an alert or an alert
   * episode, scheduled maintenance states for an event - by which the menu
   * offers its moves (getEventStateMenuStates).
   */
  stateList: StateMoveList;
  identifier?: string | undefined; // e.g. "INC-42", "#42" — the number chip.
  // The record's title, on a line of its own under the number and the pills.
  title?: string | undefined;
  currentStateId?: string | undefined;
  severity?: { name: string; color: Color } | undefined;
  isPrivate?: boolean | undefined;
  privateTooltip?: string | undefined;
  /*
   * How long, as the first of the facts: its label ("Ongoing for", "Lasted",
   * "Starts in") over the duration from durationStartsAt to durationEndsAt,
   * or to now, ticking.
   */
  durationPrefix?: string | undefined;
  durationStartsAt?: Date | undefined;
  durationEndsAt?: Date | undefined;
  actions: Array<EventStateAction>;
  onActionClick: (stateId: string) => void;
  /*
   * Non-state actions, shown after the state actions and before the "More
   * actions" menu. They never change what that menu offers, and they are
   * shown whatever the current state is - even when there is no state
   * action left.
   */
  secondaryActions?: Array<EventPanelAction> | undefined;
  onStateSelect?: ((stateId: string) => void) | undefined;
  moreMenuTitle?: string | undefined;
  isDisabled?: boolean | undefined;
  /*
   * Whether the reader may change the record's state (PermissionGate.check
   * on the record's state timeline): left out, they may. One who may not
   * sees the state buttons locked, each saying why, and no menu of other
   * states; while the permissions are not known yet, neither is shown.
   */
  stateChangeGate?: PermissionGateResult | undefined;
  /*
   * The band at the foot of the header: OneUptime AI's root cause analysis,
   * a maintenance event that missed its start, an episode that could not be
   * refreshed. Its tone colours the band.
   */
  headerNotice?: ReactElement | undefined;
  headerNoticeTone?: EventHeaderNoticeTone | undefined;
  /*
   * The labelled facts after how long: who is on it, what it is about.
   * Facts with an empty value are skipped, so callers can pass optional ones
   * without filtering first.
   */
  facts?: Array<EventStatusFact> | undefined;
}

/*
 * The top of an incident, an alert, an episode or a scheduled maintenance
 * event: its number, state, severity and title, the moves it takes next,
 * where it stands on its way through its states, what a reader needs at a
 * glance, and - in a band of its own - what OneUptime AI made of it. Laid
 * out by its own width, beside the side menu at every window width
 * (EventHeaderLayout.ts).
 */
const EventStatusPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

  /*
   * The states the panel draws and offers: an archived state only while
   * the record is in it - its header still says where it is - and never as
   * one to move to, which the server would refuse.
   */
  const states: Array<EventStateItem> = props.states.filter(
    (state: EventStateItem): boolean => {
      return !state.isArchived || state.id === props.currentStateId;
    },
  );

  const currentState: EventStateItem | undefined = states.find(
    (state: EventStateItem) => {
      return state.id === props.currentStateId;
    },
  );

  /*
   * Who may change the state. Unknown (the permissions not read yet) hides
   * the state buttons and the menu rather than accuse the reader of lacking
   * a permission they may hold; known and missing locks the buttons, each
   * saying which permission.
   */
  const stateChangeGate: PermissionGateResult = props.stateChangeGate || {
    isAllowed: true,
  };
  const isStateChangeHidden: boolean =
    !stateChangeGate.isAllowed && !stateChangeGate.disabledReason;
  const stateChangeLockReason: string | undefined = stateChangeGate.isAllowed
    ? undefined
    : stateChangeGate.disabledReason;

  const stateActions: Array<EventStateAction> = isStateChangeHidden
    ? []
    : props.actions;

  /*
   * The overflow menu is for alternative transitions. Primary actions already
   * have a prominent button, so repeating them under "More actions" adds noise
   * and makes the menu look useful when it contains no additional choice.
   */
  /*
   * Every state timeline refuses a move back up the list, for an episode as
   * for an incident, an alert or a maintenance event (Common/Utils/StateMove):
   * the menu offers only the states the record may move into next, so it
   * never offers a change the server would refuse. A record in a state that
   * is not in the list keeps every other state on offer, rather than losing
   * the menu it would recover with.
   */
  const statesForMenu: Array<EventStateItem> = getEventStateMenuStates({
    list: props.stateList,
    states: states,
    currentStateId: props.currentStateId,
    buttonStateIds: props.actions.map((action: EventStateAction): string => {
      return action.stateId;
    }),
  });

  // A reader who may not change the state gets no menu of states to change it to.
  const hasMore: boolean = Boolean(
    props.onStateSelect &&
      statesForMenu.length > 0 &&
      stateChangeGate.isAllowed,
  );

  const secondaryActions: Array<EventPanelAction> =
    props.secondaryActions || [];

  const translateLabel: (label: string) => string = (
    label: string,
  ): string => {
    return translateString(label) || label;
  };

  const getActionButton: (action: EventStateAction) => ReactElement = (
    action: EventStateAction,
  ): ReactElement => {
    const isPrimary: boolean = action.buttonStyle === ButtonStyleType.PRIMARY;
    const translatedActionLabel: string = translateLabel(action.label);
    const isDisabled: boolean = Boolean(
      props.isDisabled || stateChangeLockReason,
    );
    const lockReason: string | undefined = stateChangeLockReason
      ? translateLabel(stateChangeLockReason)
      : undefined;

    const button: ReactElement = (
      <button
        key={action.stateId}
        id={action.id}
        type="button"
        title={lockReason ? undefined : translatedActionLabel}
        disabled={isDisabled}
        aria-disabled={isDisabled}
        onClick={() => {
          if (isDisabled) {
            return;
          }

          props.onActionClick(action.stateId);
        }}
        className={`${EVENT_HEADER_BUTTON_CLASS_NAME} ${
          isPrimary
            ? EVENT_HEADER_PRIMARY_BUTTON_CLASS_NAME
            : EVENT_HEADER_NEUTRAL_BUTTON_CLASS_NAME
        }${lockReason ? " pointer-events-none w-full" : ""}`}
      >
        {action.icon && (
          <Icon icon={action.icon} className="h-4 w-4 shrink-0" />
        )}
        <span className="truncate">{translatedActionLabel}</span>
      </button>
    );

    if (!lockReason) {
      return button;
    }

    /*
     * A disabled <button> swallows the pointer, and tippy will not show a
     * tooltip on a disabled trigger, so a locked action hands the pointer
     * (and keyboard focus) to a wrapper that carries why.
     */
    return (
      <Tooltip key={action.stateId} text={lockReason}>
        <span
          className={EVENT_HEADER_LOCKED_WRAPPER_CLASS_NAME}
          tabIndex={0}
          data-testid={`${action.id || action.stateId}-disabled-wrapper`}
        >
          {button}
        </span>
      </Tooltip>
    );
  };

  const getSecondaryActionButton: (action: EventPanelAction) => ReactElement = (
    action: EventPanelAction,
  ): ReactElement => {
    const translatedActionLabel: string = translateLabel(action.label);

    if (action.menuItems && action.menuItems.length > 0 && !props.isDisabled) {
      /*
       * The menu's own wrapper is what the row lays out, so it grows on a
       * phone the way the other buttons do, and the button fills it. The
       * menu is drawn over the page: the header is a size container, and a
       * menu inside it would sit under the cards after it.
       */
      return (
        <div key={action.id} className={EVENT_HEADER_MENU_WRAPPER_CLASS_NAME}>
          <MoreMenu
            text={translatedActionLabel}
            dataTestId={action.id}
            isMenuPortaled={true}
            elementToBeShownInsteadOfButton={
              <span className="inline-flex items-center gap-2">
                {action.icon && (
                  <Icon icon={action.icon} className="h-4 w-4 shrink-0" />
                )}
                <span className="truncate">{translatedActionLabel}</span>
                <Icon
                  icon={IconProp.ChevronDown}
                  className="h-3.5 w-3.5 shrink-0 text-gray-400"
                />
              </span>
            }
            triggerClassName={`${EVENT_HEADER_BUTTON_CLASS_NAME} ${EVENT_HEADER_NEUTRAL_BUTTON_CLASS_NAME} w-full cursor-pointer`}
          >
            {action.menuItems.map((item: EventPanelMenuItem) => {
              return (
                <MoreMenuItem
                  key={item.id}
                  text={item.label}
                  icon={item.icon}
                  onClick={item.onClick}
                />
              );
            })}
          </MoreMenu>
        </div>
      );
    }

    if (action.href && !props.isDisabled && !action.isDisabled) {
      // Where the link goes - "#incident-42" - is a name, not text to translate.
      const linkTooltip: string | undefined = action.tooltip || undefined;

      const link: ReactElement = (
        <a
          key={action.id}
          id={action.id}
          href={action.href}
          target="_blank"
          rel="noopener noreferrer"
          className={`${EVENT_HEADER_BUTTON_CLASS_NAME} ${EVENT_HEADER_NEUTRAL_BUTTON_CLASS_NAME}`}
        >
          {action.icon && (
            <Icon icon={action.icon} className="h-4 w-4 shrink-0" />
          )}
          <span className="truncate">{translatedActionLabel}</span>
        </a>
      );

      if (!linkTooltip) {
        return link;
      }

      return (
        <Tooltip key={action.id} text={linkTooltip}>
          {link}
        </Tooltip>
      );
    }

    const translatedTooltip: string | undefined = action.tooltip
      ? translateLabel(action.tooltip)
      : undefined;
    const isDisabled: boolean = Boolean(props.isDisabled || action.isDisabled);
    /*
     * A disabled <button> swallows the pointer, and tippy will not show a
     * tooltip on a disabled trigger, so a disabled action with a reason hands
     * the pointer (and keyboard focus) to a wrapper that carries the tooltip -
     * the same arrangement as the shared Button.
     */
    const hasReachableTooltip: boolean =
      isDisabled && Boolean(translatedTooltip);

    const button: ReactElement = (
      <button
        key={action.id}
        id={action.id}
        type="button"
        title={hasReachableTooltip ? undefined : translatedActionLabel}
        disabled={isDisabled}
        aria-disabled={isDisabled}
        onClick={() => {
          if (isDisabled) {
            return;
          }

          action.onClick();
        }}
        className={`${EVENT_HEADER_BUTTON_CLASS_NAME} ${EVENT_HEADER_NEUTRAL_BUTTON_CLASS_NAME}${
          hasReachableTooltip ? " pointer-events-none w-full" : ""
        }`}
      >
        {action.icon && (
          <Icon icon={action.icon} className="h-4 w-4 shrink-0" />
        )}
        <span className="truncate">{translatedActionLabel}</span>
      </button>
    );

    if (!hasReachableTooltip) {
      return button;
    }

    return (
      <Tooltip key={action.id} text={translatedTooltip}>
        <span
          className={EVENT_HEADER_LOCKED_WRAPPER_CLASS_NAME}
          tabIndex={0}
          data-testid={`${action.id}-disabled-wrapper`}
        >
          {button}
        </span>
      </Tooltip>
    );
  };

  const moreMenu: ReactElement | null = hasMore ? (
    <MoreMenu
      text="More actions"
      elementToBeShownInsteadOfButton={
        <Icon icon={IconProp.EllipsisHorizontal} className="h-4 w-4" />
      }
      triggerClassName={EVENT_HEADER_MORE_TRIGGER_CLASS_NAME}
      isDisabled={props.isDisabled}
      /*
       * Drawn over the page, not inside the header: the header is a size
       * container, and a menu inside it would sit under the cards after it.
       */
      isMenuPortaled={true}
    >
      {[
        <MoreMenuSection
          key="states"
          title={props.moreMenuTitle || "Change state to"}
        >
          {statesForMenu.map((state: EventStateItem) => {
            return (
              <MoreMenuItem
                key={state.id}
                text={state.name}
                color={state.color}
                onClick={() => {
                  props.onStateSelect!(state.id);
                }}
              />
            );
          })}
        </MoreMenuSection>,
      ]}
    </MoreMenu>
  ) : null;

  /*
   * Where the actions go is worked out from the pills and the buttons as the
   * reader's language spells them: beside the pills from the width that
   * holds both, under the title below it.
   */
  const pillTexts: Array<string> = [];

  if (currentState) {
    pillTexts.push(translateLabel(currentState.name));
  }

  if (props.severity) {
    pillTexts.push(translateLabel(props.severity.name));
  }

  if (props.isPrivate) {
    pillTexts.push(translateLabel("Private"));
  }

  const actionWidths: Array<EventHeaderActionWidthInput> = [
    ...stateActions.map(
      (action: EventStateAction): EventHeaderActionWidthInput => {
        return {
          label: translateLabel(action.label),
          hasIcon: Boolean(action.icon),
        };
      },
    ),
    ...secondaryActions.map(
      (action: EventPanelAction): EventHeaderActionWidthInput => {
        return {
          label: translateLabel(action.label),
          hasIcon: Boolean(action.icon),
          hasMenu: Boolean(action.menuItems && action.menuItems.length > 0),
        };
      },
    ),
  ];

  const besideWidthRem: number | null = getEventHeaderActionsBesideWidth({
    identifier: props.identifier,
    pills: pillTexts,
    hasPillIcon: Boolean(props.isPrivate),
    actions: actionWidths,
    hasMore: hasMore,
  });

  const topRow: EventHeaderTopRowClassNames = getEventHeaderTopRowClassNames({
    besideWidthRem: besideWidthRem,
    hasMore: hasMore,
  });

  const hasActions: boolean =
    stateActions.length > 0 || secondaryActions.length > 0 || hasMore;

  /*
   * How long comes first among the facts, labelled the way the record reads
   * it: "Ongoing for", "Lasted", "Starts in", "Overrunning by".
   */
  const durationFact: EventStatusFact | null = props.durationStartsAt
    ? {
        label: props.durationPrefix || "Ongoing for",
        icon: IconProp.Clock,
        value: (
          <span data-testid="event-header-duration">
            <LiveDuration
              startDate={props.durationStartsAt}
              endDate={props.durationEndsAt}
            />
          </span>
        ),
      }
    : null;

  const visibleFacts: Array<EventStatusFact> = [
    ...(durationFact ? [durationFact] : []),
    ...(props.facts || []),
  ].filter((fact: EventStatusFact) => {
    if (!fact || !fact.label) {
      return false;
    }

    if (typeof fact.value === "string") {
      return fact.value.trim().length > 0;
    }

    return Boolean(fact.value);
  });

  const noticeTone: EventHeaderNoticeTone = props.headerNoticeTone || "neutral";

  return (
    <section
      className={EVENT_HEADER_CLASS_NAME}
      data-testid={EVENT_HEADER_TEST_IDS.header}
      data-actions-beside-from={
        besideWidthRem === null ? "never" : `${besideWidthRem}rem`
      }
    >
      <div className={EVENT_HEADER_TOP_SECTION_CLASS_NAME}>
        <div className={topRow.row} data-testid={EVENT_HEADER_TEST_IDS.top}>
          <div
            className={topRow.chips}
            data-testid={EVENT_HEADER_TEST_IDS.chips}
          >
            {props.identifier && (
              <span
                className={EVENT_HEADER_NUMBER_CLASS_NAME}
                title={translateLabel("Number")}
                data-testid={EVENT_HEADER_TEST_IDS.number}
              >
                {props.identifier}
              </span>
            )}
            {currentState && (
              <Pill
                color={currentState.color || Black}
                text={currentState.name}
                tooltip="Current state"
              />
            )}
            {props.severity && (
              <Pill
                color={props.severity.color || Black}
                text={props.severity.name}
                tooltip="Severity"
              />
            )}
            {props.isPrivate && (
              <Pill
                color={Red500}
                text="Private"
                icon={IconProp.Lock}
                tooltip={
                  props.privateTooltip ||
                  "Visible only to owners, owner teams, and project admins."
                }
              />
            )}
          </div>

          {/*
           * Before the actions in the page, as it is read and as a screen
           * reader reads it; on a wide header drawn under the pills and the
           * actions both.
           */}
          {props.title && (
            <h2
              className={topRow.title}
              data-testid={EVENT_HEADER_TEST_IDS.title}
            >
              {props.title}
            </h2>
          )}

          {hasActions && (
            <div
              className={topRow.actions}
              role="group"
              aria-label={translateLabel("Event actions")}
              data-testid={EVENT_HEADER_TEST_IDS.actions}
            >
              {stateActions.length > 0 || secondaryActions.length > 0 ? (
                <div
                  className={EVENT_HEADER_BUTTONS_CLASS_NAME}
                  data-testid={EVENT_HEADER_TEST_IDS.buttons}
                >
                  {stateActions.map((action: EventStateAction) => {
                    return getActionButton(action);
                  })}
                  {secondaryActions.map((action: EventPanelAction) => {
                    return getSecondaryActionButton(action);
                  })}
                </div>
              ) : (
                <></>
              )}
              {moreMenu ? (
                <div
                  className={topRow.morePlace}
                  data-testid={EVENT_HEADER_TEST_IDS.morePlace}
                >
                  {moreMenu}
                </div>
              ) : (
                <></>
              )}
            </div>
          )}
        </div>

        {states.length > 1 && (
          <div className="mt-4">
            <EventStateTrack
              states={states}
              currentStateId={props.currentStateId}
            />
          </div>
        )}
      </div>

      {visibleFacts.length > 0 && (
        <dl
          data-testid={EVENT_HEADER_TEST_IDS.facts}
          className={getEventHeaderFactsClassName(visibleFacts.length)}
        >
          {visibleFacts.map((fact: EventStatusFact, index: number) => {
            return (
              <div
                key={`${fact.label}-${index}`}
                className={EVENT_HEADER_FACT_CLASS_NAME}
              >
                <dt className={EVENT_HEADER_FACT_LABEL_CLASS_NAME}>
                  {fact.icon && (
                    <Icon
                      icon={fact.icon}
                      className="h-3.5 w-3.5 flex-shrink-0 text-gray-400"
                    />
                  )}
                  <span className="min-w-0 break-words">
                    {translateLabel(fact.label)}
                  </span>
                </dt>
                <dd className={EVENT_HEADER_FACT_VALUE_CLASS_NAME}>
                  {fact.value}
                </dd>
              </div>
            );
          })}
        </dl>
      )}

      {props.headerNotice && (
        <div
          className={EVENT_HEADER_NOTICE_CLASS_NAMES[noticeTone]}
          data-testid={EVENT_HEADER_TEST_IDS.notice}
          data-tone={noticeTone}
        >
          {props.headerNotice}
        </div>
      )}
    </section>
  );
};

export default EventStatusPanel;
