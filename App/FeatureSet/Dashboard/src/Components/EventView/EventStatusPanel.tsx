import { Black, Red500 } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import IconProp from "Common/Types/Icon/IconProp";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import MoreMenu from "Common/UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import MoreMenuSection from "Common/UI/Components/MoreMenu/MoreMenuSection";
import Pill from "Common/UI/Components/Pill/Pill";
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
  /*
   * The color of the state this action moves the event to. When set, the button
   * is rendered in that color so it visually matches the state it belongs to.
   */
  color?: Color | undefined;
}

export interface ComponentProps {
  states: Array<EventStateItem>; // ordered by state order.
  identifier?: string | undefined; // e.g. "INC-42", "#42" — shown at the start of the panel.
  currentStateId?: string | undefined;
  severity?: { name: string; color: Color } | undefined;
  isPrivate?: boolean | undefined;
  privateTooltip?: string | undefined;
  durationPrefix?: string | undefined;
  durationStartsAt?: Date | undefined;
  durationEndsAt?: Date | undefined;
  actions: Array<EventStateAction>;
  onActionClick: (stateId: string) => void;
  onStateSelect?: ((stateId: string) => void) | undefined;
  moreMenuTitle?: string | undefined;
  isDisabled?: boolean | undefined;
}

const EventStatusPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
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
            <div key={state.id} className="flex items-center">
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

  const statesForMenu: Array<EventStateItem> = props.states.filter(
    (state: EventStateItem) => {
      return state.id !== props.currentStateId;
    },
  );

  const getActionButton: (action: EventStateAction) => ReactElement = (
    action: EventStateAction,
  ): ReactElement => {
    /*
     * When the action carries the color of the state it moves the event to,
     * render the button in that color instead of the generic button palette.
     */
    if (action.color) {
      const isSolid: boolean = action.buttonStyle === ButtonStyleType.PRIMARY;
      const colorString: string = action.color.toString();
      const useDarkText: boolean = Color.shouldUseDarkText(action.color);

      const style: React.CSSProperties = isSolid
        ? {
            backgroundColor: colorString,
            borderColor: colorString,
            color: useDarkText ? "#000000" : "#ffffff",
          }
        : {
            borderColor: colorString,
            color: colorString,
          };

      return (
        <button
          key={action.stateId}
          id={action.id}
          type="button"
          disabled={props.isDisabled}
          onClick={() => {
            props.onActionClick(action.stateId);
          }}
          style={style}
          className={`inline-flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium shadow-sm transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
            isSolid ? "" : "bg-white"
          }`}
        >
          {action.icon && <Icon icon={action.icon} className="h-4 w-4" />}
          {action.label}
        </button>
      );
    }

    return (
      <Button
        key={action.stateId}
        id={action.id}
        title={action.label}
        icon={action.icon}
        buttonStyle={action.buttonStyle}
        disabled={props.isDisabled}
        onClick={() => {
          props.onActionClick(action.stateId);
        }}
      />
    );
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
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
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {props.actions.map((action: EventStateAction) => {
            return getActionButton(action);
          })}
          {props.onStateSelect && statesForMenu.length > 0 && (
            <MoreMenu>
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
      </div>
      {props.states.length > 1 && (
        <div className="border-t border-gray-100 px-4 py-2.5 sm:px-5">
          {getStepRail()}
        </div>
      )}
    </div>
  );
};

export default EventStatusPanel;
