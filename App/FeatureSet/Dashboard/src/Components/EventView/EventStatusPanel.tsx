import { Black, Red500 } from "Common/Types/BrandColors";
import Color, { RGB } from "Common/Types/Color";
import IconProp from "Common/Types/Icon/IconProp";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import MoreMenu from "Common/UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import MoreMenuSection from "Common/UI/Components/MoreMenu/MoreMenuSection";
import Pill from "Common/UI/Components/Pill/Pill";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
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

      /*
       * State colors are stored as hex. Derive RGB so the button can build
       * real hover / pressed shades and a matching focus ring instead of a
       * flat opacity fade. Fall back to a dark gray if it can't be parsed.
       */
      let rgb: RGB = { red: 17, green: 24, blue: 39 };
      try {
        rgb = Color.colorToRgb(action.color);
      } catch {
        // A malformed color shouldn't break the button — keep the fallback.
      }

      const clamp: (n: number) => number = (n: number): number => {
        return Math.max(0, Math.min(255, Math.round(n)));
      };
      // Multiply channels toward black to build hover/pressed shades.
      const shade: (factor: number) => string = (factor: number): string => {
        return `rgb(${clamp(rgb.red * factor)}, ${clamp(
          rgb.green * factor,
        )}, ${clamp(rgb.blue * factor)})`;
      };
      const alpha: (a: number) => string = (a: number): string => {
        return `rgba(${rgb.red}, ${rgb.green}, ${rgb.blue}, ${a})`;
      };

      // shouldUseDarkText is true when the state color itself is light.
      const isLightColor: boolean = Color.shouldUseDarkText(action.color);
      // Keep the label legible on top of a solid fill.
      const solidText: string = isLightColor ? "#111827" : "#ffffff";
      /*
       * On the white outline variant a very light state color would be nearly
       * invisible, so darken it into a legible accent for the border and label.
       */
      const accent: string = isLightColor ? shade(0.55) : colorString;

      const style: React.CSSProperties & Record<`--${string}`, string> = {
        "--btn": colorString,
        "--btn-hover": shade(0.9),
        "--btn-active": shade(0.82),
        "--btn-text": solidText,
        "--btn-accent": accent,
        "--btn-soft": alpha(0.1),
        "--btn-soft-active": alpha(0.16),
        "--btn-ring": alpha(0.4),
      };

      const baseClassName: string =
        "inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border px-3.5 py-2 text-sm font-semibold shadow-sm transition-all duration-150 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[color:var(--btn-ring)] active:translate-y-px disabled:pointer-events-none disabled:opacity-50";

      const variantClassName: string = isSolid
        ? "[background-color:var(--btn)] [border-color:var(--btn)] [color:var(--btn-text)] hover:-translate-y-px hover:shadow-md hover:[background-color:var(--btn-hover)] hover:[border-color:var(--btn-hover)] active:[background-color:var(--btn-active)]"
        : "bg-white [border-color:var(--btn-accent)] [color:var(--btn-accent)] hover:[background-color:var(--btn-soft)] active:[background-color:var(--btn-soft-active)]";

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
          className={`${baseClassName} ${variantClassName}`}
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

  // The action buttons + "change state" overflow menu, shared by both layouts.
  const actionsCluster: ReactElement = (
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
  );

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

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      {props.title ? (
        /* Header layout: eyebrow number + prominent title, pills on the row below. */
        <div className="px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
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
            {actionsCluster}
          </div>
          {hasMeta && (
            <div className="mt-3 flex flex-wrap items-center gap-2.5">
              {metaItems}
            </div>
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
          {actionsCluster}
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
