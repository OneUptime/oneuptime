import React, { FunctionComponent, ReactElement, useMemo } from "react";
import DashboardClockComponentType, {
  ClockWidgetFace,
} from "Common/Types/Dashboard/DashboardComponents/DashboardClockComponent";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import JSONFunctions from "Common/Types/JSONFunctions";
import {
  ClockHandAngles,
  ClockWidgetDisplay,
  CLOCK_SECONDARY_FONT_SCALE,
  getClockAnalogDialSizeInPx,
  getClockDigitalFontSizeInPx,
  getClockGmtOffsetText,
  getClockHandAngles,
  getClockWidgetDisplay,
  isDaytimeAtClock,
  resolveClockFace,
} from "Common/Utils/Dashboard/ClockWidgetFormat";
import useClockTick from "Common/UI/Utils/UseClockTick";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardClockComponentType;
}

/*
 * The dial is drawn in its own 100x100 coordinate space and scaled by the
 * SVG viewBox, so every number below is a percentage of the dial and the
 * face stays proportional at any tile size.
 */
const DIAL_CENTER: number = 50;
const DIAL_RADIUS: number = 47;

interface DialTick {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  isHour: boolean;
}

type GetDialTicksFunction = () => Array<DialTick>;

/*
 * 60 marks: a longer, heavier one every five minutes. Built once at module
 * load — the geometry never changes, only the hands on top of it do.
 */
const getDialTicks: GetDialTicksFunction = (): Array<DialTick> => {
  const ticks: Array<DialTick> = [];

  for (let minute: number = 0; minute < 60; minute++) {
    const isHour: boolean = minute % 5 === 0;
    const angleInRadians: number = (minute * 6 * Math.PI) / 180;
    const sin: number = Math.sin(angleInRadians);
    const cos: number = Math.cos(angleInRadians);

    const outerRadius: number = DIAL_RADIUS - 3;
    const innerRadius: number = outerRadius - (isHour ? 7 : 3);

    ticks.push({
      key: `tick-${minute}`,
      x1: DIAL_CENTER + innerRadius * sin,
      y1: DIAL_CENTER - innerRadius * cos,
      x2: DIAL_CENTER + outerRadius * sin,
      y2: DIAL_CENTER - outerRadius * cos,
      isHour: isHour,
    });
  }

  return ticks;
};

const DIAL_TICKS: Array<DialTick> = getDialTicks();

interface ClockHandProps {
  angleInDegrees: number;
  length: number;
  width: number;
  color: string;
  /** How far the hand's tail extends past the centre pin. */
  tail: number;
}

const ClockHand: FunctionComponent<ClockHandProps> = (
  props: ClockHandProps,
): ReactElement => {
  return (
    <line
      x1={DIAL_CENTER}
      y1={DIAL_CENTER + props.tail}
      x2={DIAL_CENTER}
      y2={DIAL_CENTER - props.length}
      stroke={props.color}
      strokeWidth={props.width}
      strokeLinecap="round"
      transform={`rotate(${props.angleInDegrees} ${DIAL_CENTER} ${DIAL_CENTER})`}
    />
  );
};

interface AnalogFaceProps {
  sizeInPx: number;
  angles: ClockHandAngles;
  showSeconds: boolean;
}

const AnalogFace: FunctionComponent<AnalogFaceProps> = (
  props: AnalogFaceProps,
): ReactElement => {
  return (
    <svg
      width={props.sizeInPx}
      height={props.sizeInPx}
      viewBox="0 0 100 100"
      role="presentation"
    >
      <circle
        cx={DIAL_CENTER}
        cy={DIAL_CENTER}
        r={DIAL_RADIUS}
        fill="var(--ou-surface-primary, #ffffff)"
        stroke="var(--ou-border-subtle, #e5e7eb)"
        strokeWidth={1.5}
      />

      {DIAL_TICKS.map((tick: DialTick) => {
        return (
          <line
            key={tick.key}
            x1={tick.x1}
            y1={tick.y1}
            x2={tick.x2}
            y2={tick.y2}
            stroke={
              tick.isHour
                ? "var(--ou-text-muted, #64748b)"
                : "var(--ou-border-subtle, #e5e7eb)"
            }
            strokeWidth={tick.isHour ? 2 : 1}
            strokeLinecap="round"
          />
        );
      })}

      <ClockHand
        angleInDegrees={props.angles.hourAngleInDegrees}
        length={26}
        width={5}
        tail={7}
        color="var(--ou-text-primary, #111827)"
      />
      <ClockHand
        angleInDegrees={props.angles.minuteAngleInDegrees}
        length={38}
        width={3.5}
        tail={9}
        color="var(--ou-text-primary, #111827)"
      />

      {props.showSeconds && (
        <ClockHand
          angleInDegrees={props.angles.secondAngleInDegrees}
          length={41}
          width={1.5}
          tail={11}
          color="#ef4444"
        />
      )}

      <circle
        cx={DIAL_CENTER}
        cy={DIAL_CENTER}
        r={3}
        fill="var(--ou-text-primary, #111827)"
      />
      {props.showSeconds && (
        <circle cx={DIAL_CENTER} cy={DIAL_CENTER} r={1.5} fill="#ef4444" />
      )}
    </svg>
  );
};

/*
 * A sun or a moon, sized to the caption row. The whole reason to pin another
 * team's timezone to a wall dashboard is to know at a glance whether paging
 * them right now means waking someone up, so the glyph carries real meaning
 * rather than decoration.
 */
const DayNightGlyph: FunctionComponent<{ isDaytime: boolean }> = (props: {
  isDaytime: boolean;
}): ReactElement => {
  if (props.isDaytime) {
    return (
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#f59e0b"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    );
  }

  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#6366f1"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
};

const DashboardClockComponentElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const showSeconds: boolean = Boolean(props.component.arguments.showSeconds);

  /*
   * Drift-free and resynced when the tab comes back to the foreground — see
   * useClockTick for why a plain setInterval is not good enough here.
   */
  const now: Date = useClockTick(showSeconds);

  const display: ClockWidgetDisplay = useMemo(() => {
    return getClockWidgetDisplay({
      date: now,
      timezone: props.component.arguments.timezone,
      label: props.component.arguments.label,
      hourFormat: props.component.arguments.hourFormat,
      showSeconds: showSeconds,
      showDate: props.component.arguments.showDate,
      showTimezoneAbbreviation:
        props.component.arguments.showTimezoneAbbreviation,
    });
  }, [
    now,
    showSeconds,
    props.component.arguments.timezone,
    props.component.arguments.label,
    props.component.arguments.hourFormat,
    props.component.arguments.showDate,
    props.component.arguments.showTimezoneAbbreviation,
  ]);

  const isDaytime: boolean = isDaytimeAtClock({
    date: now,
    timezone: display.timezone,
  });

  const isAnalog: boolean =
    resolveClockFace(props.component.arguments.clockFace) ===
    ClockWidgetFace.Analog;

  const captionRow: ReactElement = (
    <div className="flex items-center justify-center gap-1 max-w-full">
      <DayNightGlyph isDaytime={isDaytime} />
      <span
        className="text-[11px] font-medium text-gray-400 uppercase tracking-wider truncate"
        title={`${display.label} — ${display.timezone} (${getClockGmtOffsetText(
          {
            date: now,
            timezone: display.timezone,
          },
        )})`}
      >
        {display.label}
      </span>
    </div>
  );

  const secondaryRows: ReactElement = (
    <>
      {display.dateText ? (
        <div className="text-[11px] text-gray-400 text-center truncate max-w-full">
          {display.dateText}
        </div>
      ) : (
        <></>
      )}
      {display.zoneAbbreviation ? (
        <div className="text-[11px] text-gray-400 text-center tabular-nums truncate max-w-full">
          {display.zoneAbbreviation}
        </div>
      ) : (
        <></>
      )}
      {display.isFallbackTimezone ? (
        <div className="text-[10px] text-amber-500 text-center truncate max-w-full">
          Unknown timezone — showing yours
        </div>
      ) : (
        <></>
      )}
    </>
  );

  if (isAnalog) {
    const dialSizeInPx: number = getClockAnalogDialSizeInPx({
      widthInPx: props.dashboardComponentWidthInPx,
      heightInPx: props.dashboardComponentHeightInPx,
      display: display,
      isEditMode: props.isEditMode,
    });

    const angles: ClockHandAngles = getClockHandAngles({
      date: now,
      timezone: display.timezone,
    });

    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-1 overflow-hidden">
        {captionRow}
        <AnalogFace
          sizeInPx={dialSizeInPx}
          angles={angles}
          showSeconds={showSeconds}
        />
        {secondaryRows}
      </div>
    );
  }

  const timeFontPx: number = getClockDigitalFontSizeInPx({
    widthInPx: props.dashboardComponentWidthInPx,
    heightInPx: props.dashboardComponentHeightInPx,
    display: display,
    isEditMode: props.isEditMode,
  });

  const secondaryFontPx: number = timeFontPx * CLOCK_SECONDARY_FONT_SCALE;

  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-1 overflow-hidden">
      {captionRow}

      <div
        className="flex items-baseline justify-center font-bold text-gray-900 tabular-nums whitespace-nowrap"
        style={{
          fontSize: `${timeFontPx}px`,
          lineHeight: 1.05,
          letterSpacing: "-0.03em",
        }}
      >
        <span>{display.time}</span>
        {display.seconds ? (
          <span
            className="text-gray-400 font-medium"
            style={{ fontSize: `${secondaryFontPx}px` }}
          >
            :{display.seconds}
          </span>
        ) : (
          <></>
        )}
        {display.meridiem ? (
          <span
            className="text-gray-400 font-medium tracking-normal"
            style={{
              fontSize: `${secondaryFontPx}px`,
              marginLeft: "0.25em",
            }}
          >
            {display.meridiem}
          </span>
        ) : (
          <></>
        )}
      </div>

      {secondaryRows}
    </div>
  );
};

function arePropsEqual(prev: ComponentProps, next: ComponentProps): boolean {
  /*
   * refreshTick is deliberately NOT compared: the clock keeps its own time
   * and re-renders on its own tick, so a dashboard-wide refresh has nothing
   * to tell it.
   */
  if (
    prev.componentId.toString() !== next.componentId.toString() ||
    prev.isEditMode !== next.isEditMode ||
    prev.isSelected !== next.isSelected ||
    prev.dashboardComponentWidthInPx !== next.dashboardComponentWidthInPx ||
    prev.dashboardComponentHeightInPx !== next.dashboardComponentHeightInPx
  ) {
    return false;
  }

  return JSONFunctions.deepEqual(
    prev.component.arguments,
    next.component.arguments,
  );
}

export default React.memo(DashboardClockComponentElement, arePropsEqual);
