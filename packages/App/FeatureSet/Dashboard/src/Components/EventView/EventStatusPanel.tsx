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
import useTranslateValue from "Common/UI/Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";
import LiveDuration from "./LiveDuration";

export interface EventStateItem {
  id: string;
  name: string;
  color: Color;
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
}

/*
 * A short "label value" pair shown under the header pills, e.g.
 * { label: "Declared", value: "Sep 14, 18:01" } or
 * { label: "Monitor", value: <Link ...>checkout-api</Link> }.
 */
export interface EventStatusFact {
  label: string;
  value: string | ReactElement;
  icon?: IconProp | undefined;
}

export interface ComponentProps {
  states: Array<EventStateItem>; // ordered by state order.
  identifier?: string | undefined; // e.g. "INC-42", "#42" — shown at the start of the panel.
  /*
   * When set, the panel renders as a proper header: the identifier becomes a
   * small eyebrow badge and this title is shown as the prominent heading, with
   * the state/severity/duration pills on the row below. When omitted, the panel
   * keeps its compact single-row layout (identifier inline with the pills).
   */
  title?: string | undefined;
  currentStateId?: string | undefined;
  severity?: { name: string; color: Color } | undefined;
  isPrivate?: boolean | undefined;
  privateTooltip?: string | undefined;
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
  /* Optional full-width context shown inside the titled header card. */
  headerNotice?: ReactElement | undefined;
  /*
   * Optional context facts for the titled header layout, rendered as one
   * wrapping row below the pills. Facts with an empty value are skipped, so
   * callers can pass optional ones without filtering first.
   */
  facts?: Array<EventStatusFact> | undefined;
}

const EventStatusPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

  const currentState: EventStateItem | undefined = props.states.find(
    (state: EventStateItem) => {
      return state.id === props.currentStateId;
    },
  );

  const currentStateIndex: number = props.states.findIndex(
    (state: EventStateItem) => {
      return state.id === props.currentStateId;
    },
  );

  const getStepRail: () => ReactElement = (): ReactElement => {
    return (
      <div className="flex flex-wrap items-center gap-y-1.5">
        {props.states.map((state: EventStateItem, index: number) => {
          const isReached: boolean =
            currentStateIndex >= 0 && index <= currentStateIndex;
          const isCurrent: boolean = index === currentStateIndex;

          return (
            <div key={`${state.id}-${index}`} className="flex items-center">
              {index > 0 && (
                <div
                  className={`mx-2.5 h-px w-5 ${
                    isReached ? "bg-gray-300" : "bg-gray-200"
                  }`}
                />
              )}
              <div className="flex items-center gap-1.5">
                <span
                  className={`h-2 w-2 rounded-full ${
                    isReached && !isCurrent ? "opacity-40" : ""
                  }`}
                  style={{
                    backgroundColor: isReached
                      ? (state.color || Black).toString()
                      : "#e5e7eb",
                  }}
                />
                <span
                  className={`text-xs ${
                    isCurrent
                      ? "font-semibold text-gray-900"
                      : isReached
                        ? "font-medium text-gray-500"
                        : "font-medium text-gray-400"
                  }`}
                >
                  {state.name}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  /*
   * The overflow menu is for alternative transitions. Primary actions already
   * have a prominent button, so repeating them under "More actions" adds noise
   * and makes the menu look useful when it contains no additional choice.
   */
  const visibleActionStateIds: Set<string> = new Set(
    props.actions.map((action: EventStateAction) => {
      return action.stateId;
    }),
  );
  const includedMenuStateIds: Set<string> = new Set();

  const statesForMenu: Array<EventStateItem> = props.states.filter(
    (state: EventStateItem, stateIndex: number) => {
      /*
       * State timeline APIs only accept forward transitions. Hiding earlier
       * states prevents the menu from offering a change the server will reject.
       * If the current state is not in the supplied list, keep alternatives
       * available rather than making the recovery menu disappear entirely.
       */
      const isForwardState: boolean =
        currentStateIndex < 0 || stateIndex > currentStateIndex;
      const shouldIncludeState: boolean =
        isForwardState &&
        state.id !== props.currentStateId &&
        !visibleActionStateIds.has(state.id) &&
        !includedMenuStateIds.has(state.id);

      if (shouldIncludeState) {
        includedMenuStateIds.add(state.id);
      }

      return shouldIncludeState;
    },
  );

  /*
   * On a phone the buttons grow from their own width (flex-auto), so two
   * that do not both fit wrap onto rows of their own instead of being cut
   * to an even share of the row and truncating their labels.
   */
  const actionBaseClassName: string =
    "inline-flex h-9 min-w-[7rem] max-w-full flex-auto select-none items-center justify-center gap-2 whitespace-nowrap rounded-md border px-3.5 text-sm font-semibold shadow-sm transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:max-w-64 sm:flex-none";
  const primaryActionClassName: string =
    "border-indigo-600 bg-indigo-600 text-white hover:border-indigo-700 hover:bg-indigo-700";
  const neutralActionClassName: string =
    "border-gray-300 bg-white text-gray-700 hover:border-gray-400 hover:bg-gray-50 hover:text-gray-900";

  const getActionButton: (action: EventStateAction) => ReactElement = (
    action: EventStateAction,
  ): ReactElement => {
    const isPrimary: boolean = action.buttonStyle === ButtonStyleType.PRIMARY;
    const translatedActionLabel: string =
      translateString(action.label) || action.label;
    const variantClassName: string = isPrimary
      ? primaryActionClassName
      : neutralActionClassName;

    return (
      <button
        key={action.stateId}
        id={action.id}
        type="button"
        title={translatedActionLabel}
        disabled={props.isDisabled}
        onClick={() => {
          props.onActionClick(action.stateId);
        }}
        className={`${actionBaseClassName} ${variantClassName}`}
      >
        {action.icon && (
          <Icon icon={action.icon} className="h-4 w-4 shrink-0" />
        )}
        <span className="truncate">{translatedActionLabel}</span>
      </button>
    );
  };

  const getSecondaryActionButton: (action: EventPanelAction) => ReactElement = (
    action: EventPanelAction,
  ): ReactElement => {
    const translatedActionLabel: string =
      translateString(action.label) || action.label;
    const translatedTooltip: string | undefined = action.tooltip
      ? translateString(action.tooltip) || action.tooltip
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
        className={`${actionBaseClassName} ${neutralActionClassName}${
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
          className="inline-flex min-w-[7rem] max-w-full flex-auto rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 sm:max-w-64 sm:flex-none"
          tabIndex={0}
          data-testid={`${action.id}-disabled-wrapper`}
        >
          {button}
        </span>
      </Tooltip>
    );
  };

  /*
   * The action buttons + "change state" overflow menu, shared by both
   * layouts. `widthClassName` is where the cluster stops taking a full row
   * of its own - the breakpoint at which its layout puts it beside the
   * title or the pills.
   */
  const getActionsCluster: (widthClassName: string) => ReactElement = (
    widthClassName: string,
  ): ReactElement => {
    return (
      <div
        className={`flex w-full flex-wrap items-center justify-end gap-2 ${widthClassName}`}
        role="group"
        aria-label="Event actions"
      >
        {props.actions.map((action: EventStateAction) => {
          return getActionButton(action);
        })}
        {(props.secondaryActions || []).map((action: EventPanelAction) => {
          return getSecondaryActionButton(action);
        })}
        {props.onStateSelect && statesForMenu.length > 0 && (
          <MoreMenu
            text="More actions"
            elementToBeShownInsteadOfButton={
              <Icon icon={IconProp.EllipsisHorizontal} className="h-4 w-4" />
            }
            triggerClassName="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border border-gray-300 bg-white text-gray-500 shadow-sm transition-colors duration-150 hover:border-gray-400 hover:bg-gray-50 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            isDisabled={props.isDisabled}
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
                      onClick={() => {
                        props.onStateSelect!(state.id);
                      }}
                    />
                  );
                })}
              </MoreMenuSection>,
            ]}
          </MoreMenu>
        )}
      </div>
    );
  };

  // The state / severity / private / duration pills, shared by both layouts.
  const metaItems: ReactElement = (
    <React.Fragment>
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
      {props.durationStartsAt && (
        <span className="inline-flex items-center gap-1.5 text-sm text-gray-500">
          <Icon icon={IconProp.Clock} className="h-4 w-4 text-gray-400" />
          <span>{props.durationPrefix || "Ongoing for"}</span>
          <span className="font-medium text-gray-700">
            <LiveDuration
              startDate={props.durationStartsAt}
              endDate={props.durationEndsAt}
            />
          </span>
        </span>
      )}
    </React.Fragment>
  );

  const hasMeta: boolean = Boolean(
    currentState || props.severity || props.isPrivate || props.durationStartsAt,
  );

  const visibleFacts: Array<EventStatusFact> = (props.facts || []).filter(
    (fact: EventStatusFact) => {
      if (!fact || !fact.label) {
        return false;
      }

      if (typeof fact.value === "string") {
        return fact.value.trim().length > 0;
      }

      return Boolean(fact.value);
    },
  );

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      {props.title ? (
        /*
         * Header layout: eyebrow number + prominent title, pills on the row
         * below. The actions sit beside the title only from xl: next to a
         * side menu, a narrower header squeezed the title down to a few
         * characters and stacked the actions one per row. Beside it, the
         * actions keep their width and a long title truncates instead.
         */
        <div className="px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              {props.identifier && (
                <span
                  className="inline-flex items-center rounded-md bg-gray-100 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-gray-600"
                  title="Number"
                >
                  {props.identifier}
                </span>
              )}
              <Tooltip text={props.title}>
                <h2 className="mt-1.5 truncate text-lg font-semibold leading-tight text-gray-900 sm:text-xl">
                  {props.title}
                </h2>
              </Tooltip>
            </div>
            {getActionsCluster("xl:w-auto xl:shrink-0")}
          </div>
          {hasMeta && (
            <div className="mt-3 flex flex-wrap items-center gap-2.5">
              {metaItems}
            </div>
          )}
          {visibleFacts.length > 0 && (
            <dl
              data-testid="event-status-facts"
              className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm"
            >
              {visibleFacts.map((fact: EventStatusFact, index: number) => {
                return (
                  <div
                    key={`${fact.label}-${index}`}
                    className="inline-flex min-w-0 max-w-full items-start gap-1.5"
                  >
                    <dt className="inline-flex flex-shrink-0 items-center gap-1.5 text-gray-500">
                      {fact.icon && (
                        <Icon
                          icon={fact.icon}
                          className="h-4 w-4 text-gray-400"
                        />
                      )}
                      <span>{translateString(fact.label) || fact.label}</span>
                    </dt>
                    <dd className="min-w-0 break-words font-medium text-gray-900">
                      {fact.value}
                    </dd>
                  </div>
                );
              })}
            </dl>
          )}
          {props.headerNotice && (
            <div className="mt-3">{props.headerNotice}</div>
          )}
        </div>
      ) : (
        /* Compact layout: identifier inline with the pills (unchanged). */
        <div className="flex flex-col gap-3 px-4 py-4 sm:px-5 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            {props.identifier && (
              <span
                className="text-sm font-semibold text-gray-900"
                title="Number"
              >
                {props.identifier}
              </span>
            )}
            {metaItems}
          </div>
          {getActionsCluster("md:w-auto")}
        </div>
      )}
      {props.states.length > 1 && (
        <div className="border-t border-gray-100 px-4 py-2.5 sm:px-5">
          {getStepRail()}
        </div>
      )}
    </div>
  );
};

export default EventStatusPanel;
