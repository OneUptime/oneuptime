// Tremor BarChart [v1.0.0]
/* eslint-disable @typescript-eslint/no-explicit-any */

"use client";

import React from "react";
import { RiArrowLeftSLine, RiArrowRightSLine } from "@remixicon/react";
import {
  Bar,
  CartesianGrid,
  Label,
  BarChart as RechartsBarChart,
  Legend as RechartsLegend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AxisDomain } from "recharts/types/util/types";

import {
  AvailableChartColors,
  type AvailableChartColorsKeys,
  constructCategoryColors,
  getColorClassName,
} from "../Utils/ChartColors";
import { cx } from "../Utils/Cx";
import { getYAxisDomain } from "../Utils/GetYAxisDomain";
import { useOnWindowResize } from "../Utils/UseWindowOnResize";

//#region Shape

function deepEqual<T>(obj1: T, obj2: T): boolean {
  if (obj1 === obj2) {
    return true;
  }

  if (
    typeof obj1 !== "object" ||
    typeof obj2 !== "object" ||
    obj1 === null ||
    obj2 === null
  ) {
    return false;
  }

  const keys1: Array<keyof T> = Object.keys(obj1) as Array<keyof T>;
  const keys2: Array<keyof T> = Object.keys(obj2) as Array<keyof T>;

  if (keys1.length !== keys2.length) {
    return false;
  }

  for (const key of keys1) {
    if (!keys2.includes(key) || !deepEqual(obj1[key], obj2[key])) {
      return false;
    }
  }

  return true;
}

const renderShape: (
  props: any,
  activeBar: any | undefined,
  activeLegend: string | undefined,
  layout: string,
) => React.ReactElement = (
  props: any,
  activeBar: any | undefined,
  activeLegend: string | undefined,
  layout: string,
): React.ReactElement => {
  const { fillOpacity, name, payload, value } = props;
  let { x, width, y, height } = props;

  if (layout === "horizontal" && height < 0) {
    y += height;
    height = Math.abs(height); // height must be a positive number
  } else if (layout === "vertical" && width < 0) {
    x += width;
    width = Math.abs(width); // width must be a positive number
  }

  // Radius for rounded corners at top
  const radius: number = Math.min(4, width / 2, height / 2);

  // Create path with rounded corners at the top only (for horizontal layout)
  // For vertical layout, round the right side
  let path: string;

  if (layout === "horizontal") {
    // Rounded top corners for horizontal bars
    path = `
      M ${x},${y + height}
      L ${x},${y + radius}
      Q ${x},${y} ${x + radius},${y}
      L ${x + width - radius},${y}
      Q ${x + width},${y} ${x + width},${y + radius}
      L ${x + width},${y + height}
      Z
    `;
  } else {
    // Rounded right corners for vertical bars
    path = `
      M ${x},${y}
      L ${x + width - radius},${y}
      Q ${x + width},${y} ${x + width},${y + radius}
      L ${x + width},${y + height - radius}
      Q ${x + width},${y + height} ${x + width - radius},${y + height}
      L ${x},${y + height}
      Z
    `;
  }

  return (
    <path
      d={path}
      opacity={
        activeBar || (activeLegend && activeLegend !== name)
          ? deepEqual(activeBar, { ...payload, value })
            ? fillOpacity
            : 0.3
          : fillOpacity
      }
    />
  );
};

//#region Legend

interface LegendItemProps {
  name: string;
  color: AvailableChartColorsKeys;
  onClick?: (name: string, color: string) => void;
  activeLegend?: string;
}

const LegendItem: React.FunctionComponent<LegendItemProps> = ({
  name,
  color,
  onClick,
  activeLegend,
}: LegendItemProps): React.ReactElement => {
  const hasOnValueChange: boolean = Boolean(onClick);
  return (
    <li
      className={cx(
        // base
        "group inline-flex flex-nowrap items-center gap-1.5 rounded-sm px-2 py-1 whitespace-nowrap transition",
        hasOnValueChange
          ? "cursor-pointer hover:bg-gray-100"
          : "cursor-default",
      )}
      onClick={(e: React.MouseEvent) => {
        e.stopPropagation();
        onClick?.(name, color as string);
      }}
    >
      <span
        className={cx(
          "size-2 shrink-0 rounded-xs",
          getColorClassName(color, "bg"),
          activeLegend && activeLegend !== name ? "opacity-40" : "opacity-100",
        )}
        aria-hidden={true}
      />
      <p
        className={cx(
          // base
          "truncate text-xs whitespace-nowrap",
          // text color
          "text-gray-700",
          hasOnValueChange && "group-hover:text-gray-900",
          activeLegend && activeLegend !== name ? "opacity-40" : "opacity-100",
        )}
      >
        {name}
      </p>
    </li>
  );
};

interface ScrollButtonProps {
  icon: React.ElementType;
  onClick?: () => void;
  disabled?: boolean;
}

const ScrollButton: React.FunctionComponent<ScrollButtonProps> = ({
  icon,
  onClick,
  disabled,
}: ScrollButtonProps): React.ReactElement => {
  const Icon: React.ElementType = icon;
  const [isPressed, setIsPressed] = React.useState(false);
  const intervalRef: React.MutableRefObject<NodeJS.Timeout | null> =
    React.useRef<NodeJS.Timeout | null>(null);

  React.useEffect(() => {
    if (isPressed) {
      intervalRef.current = setInterval(() => {
        onClick?.();
      }, 300);
    } else {
      clearInterval(intervalRef.current as NodeJS.Timeout);
    }
    return () => {
      return clearInterval(intervalRef.current as NodeJS.Timeout);
    };
  }, [isPressed, onClick]);

  React.useEffect(() => {
    if (disabled) {
      clearInterval(intervalRef.current as NodeJS.Timeout);
      setIsPressed(false);
    }
  }, [disabled]);

  return (
    <button
      type="button"
      className={cx(
        // base
        "group inline-flex size-5 items-center truncate rounded-sm transition",
        disabled
          ? "cursor-not-allowed text-gray-400"
          : "cursor-pointer text-gray-700 hover:bg-gray-100 hover:text-gray-900",
      )}
      disabled={disabled}
      onClick={(e: React.MouseEvent) => {
        e.stopPropagation();
        onClick?.();
      }}
      onMouseDown={(e: React.MouseEvent) => {
        e.stopPropagation();
        setIsPressed(true);
      }}
      onMouseUp={(e: React.MouseEvent) => {
        e.stopPropagation();
        setIsPressed(false);
      }}
    >
      <Icon className="size-full" aria-hidden="true" />
    </button>
  );
};

interface LegendProps extends React.OlHTMLAttributes<HTMLOListElement> {
  categories: string[];
  colors?: AvailableChartColorsKeys[];
  onClickLegendItem?: (category: string, color: string) => void;
  activeLegend?: string;
  enableLegendSlider?: boolean;
}

type HasScrollProps = {
  left: boolean;
  right: boolean;
};

const Legend: React.ForwardRefExoticComponent<
  LegendProps & React.RefAttributes<HTMLOListElement>
> = React.forwardRef<HTMLOListElement, LegendProps>(
  (
    props: LegendProps,
    ref: React.Ref<HTMLOListElement>,
  ): React.ReactElement => {
    const {
      categories,
      colors = AvailableChartColors,
      className,
      onClickLegendItem,
      activeLegend,
      enableLegendSlider = false,
      ...other
    } = props;
    const scrollableRef: React.RefObject<HTMLInputElement> =
      React.useRef<HTMLInputElement>(null);
    const scrollButtonsRef: React.RefObject<HTMLDivElement> =
      React.useRef<HTMLDivElement>(null);
    const [hasScroll, setHasScroll] = React.useState<HasScrollProps | null>(
      null,
    );
    const [isKeyDowned, setIsKeyDowned] = React.useState<string | null>(null);
    const intervalRef: React.MutableRefObject<NodeJS.Timeout | null> =
      React.useRef<NodeJS.Timeout | null>(null);

    const checkScroll: () => void = React.useCallback(() => {
      const scrollable: HTMLInputElement | null = scrollableRef?.current;
      if (!scrollable) {
        return;
      }

      const hasLeftScroll: boolean = scrollable.scrollLeft > 0;
      const hasRightScroll: boolean =
        scrollable.scrollWidth - scrollable.clientWidth > scrollable.scrollLeft;

      setHasScroll({ left: hasLeftScroll, right: hasRightScroll });
    }, [setHasScroll]);

    const scrollToTest: (direction: "left" | "right") => void =
      React.useCallback(
        (direction: "left" | "right") => {
          const element: HTMLInputElement | null = scrollableRef?.current;
          const scrollButtons: HTMLDivElement | null =
            scrollButtonsRef?.current;
          const scrollButtonsWith: number = scrollButtons?.clientWidth ?? 0;
          const width: number = element?.clientWidth ?? 0;

          if (element && enableLegendSlider) {
            element.scrollTo({
              left:
                direction === "left"
                  ? element.scrollLeft - width + scrollButtonsWith
                  : element.scrollLeft + width - scrollButtonsWith,
              behavior: "smooth",
            });
            setTimeout(() => {
              checkScroll();
            }, 400);
          }
        },
        [enableLegendSlider, checkScroll],
      );

    React.useEffect(() => {
      const keyDownHandler: (key: string) => void = (key: string): void => {
        if (key === "ArrowLeft") {
          scrollToTest("left");
        } else if (key === "ArrowRight") {
          scrollToTest("right");
        }
      };
      if (isKeyDowned) {
        keyDownHandler(isKeyDowned);
        intervalRef.current = setInterval(() => {
          keyDownHandler(isKeyDowned);
        }, 300);
      } else {
        clearInterval(intervalRef.current as NodeJS.Timeout);
      }
      return () => {
        return clearInterval(intervalRef.current as NodeJS.Timeout);
      };
    }, [isKeyDowned, scrollToTest]);

    const keyDown: (e: KeyboardEvent) => void = (e: KeyboardEvent): void => {
      e.stopPropagation();
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        setIsKeyDowned(e.key);
      }
    };
    const keyUp: (e: KeyboardEvent) => void = (e: KeyboardEvent): void => {
      e.stopPropagation();
      setIsKeyDowned(null);
    };

    React.useEffect(() => {
      const scrollable: HTMLInputElement | null = scrollableRef?.current;
      if (enableLegendSlider) {
        checkScroll();
        scrollable?.addEventListener("keydown", keyDown);
        scrollable?.addEventListener("keyup", keyUp);
      }

      return () => {
        scrollable?.removeEventListener("keydown", keyDown);
        scrollable?.removeEventListener("keyup", keyUp);
      };
    }, [checkScroll, enableLegendSlider]);

    return (
      <ol
        ref={ref}
        className={cx("relative overflow-hidden", className)}
        {...other}
      >
        <div
          ref={scrollableRef}
          tabIndex={0}
          className={cx(
            "flex h-full",
            enableLegendSlider
              ? hasScroll?.right || hasScroll?.left
                ? "snap-mandatory items-center overflow-auto pr-12 pl-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                : ""
              : "flex-wrap",
          )}
        >
          {categories.map((category: string, index: number) => {
            return (
              <LegendItem
                key={`item-${index}`}
                name={category}
                color={colors[index] as AvailableChartColorsKeys}
                {...(onClickLegendItem ? { onClick: onClickLegendItem } : {})}
                {...(activeLegend ? { activeLegend: activeLegend } : {})}
              />
            );
          })}
        </div>
        {enableLegendSlider && (hasScroll?.right || hasScroll?.left) ? (
          <>
            <div
              className={cx(
                // base
                "absolute top-0 right-0 bottom-0 flex h-full items-center justify-center pr-1",
                // background color
                "bg-white",
              )}
            >
              <ScrollButton
                icon={RiArrowLeftSLine}
                onClick={() => {
                  setIsKeyDowned(null);
                  scrollToTest("left");
                }}
                disabled={!hasScroll?.left}
              />
              <ScrollButton
                icon={RiArrowRightSLine}
                onClick={() => {
                  setIsKeyDowned(null);
                  scrollToTest("right");
                }}
                disabled={!hasScroll?.right}
              />
            </div>
          </>
        ) : null}
      </ol>
    );
  },
);

Legend.displayName = "Legend";

const ChartLegend: (
  payload: any,
  categoryColors: Map<string, AvailableChartColorsKeys>,
  setLegendHeight: React.Dispatch<React.SetStateAction<number>>,
  activeLegend: string | undefined,
  onClick?: (category: string, color: string) => void,
  enableLegendSlider?: boolean,
  legendPosition?: "left" | "center" | "right",
  yAxisWidth?: number,
) => React.ReactElement = (
  { payload }: any,
  categoryColors: Map<string, AvailableChartColorsKeys>,
  setLegendHeight: React.Dispatch<React.SetStateAction<number>>,
  activeLegend: string | undefined,
  onClick?: (category: string, color: string) => void,
  enableLegendSlider?: boolean,
  legendPosition?: "left" | "center" | "right",
  yAxisWidth?: number,
) => {
  const legendRef: React.RefObject<HTMLDivElement> =
    React.useRef<HTMLDivElement>(null);

  useOnWindowResize(() => {
    const calculateHeight: (height: number | undefined) => number = (
      height: number | undefined,
    ): number => {
      return height ? Number(height) + 15 : 60;
    };
    setLegendHeight(calculateHeight(legendRef.current?.clientHeight));
  });

  const filteredPayload: any[] = payload.filter((item: any) => {
    return item.type !== "none";
  });

  const paddingLeft: number =
    legendPosition === "left" && yAxisWidth ? yAxisWidth - 8 : 0;

  return (
    <div
      style={{ paddingLeft: paddingLeft }}
      ref={legendRef}
      className={cx(
        "flex items-center",
        { "justify-center": legendPosition === "center" },
        {
          "justify-start": legendPosition === "left",
        },
        { "justify-end": legendPosition === "right" },
      )}
    >
      <Legend
        categories={filteredPayload.map((entry: any) => {
          return entry.value;
        })}
        colors={filteredPayload.map((entry: any) => {
          return categoryColors.get(entry.value) as AvailableChartColorsKeys;
        })}
        {...(onClick ? { onClickLegendItem: onClick } : {})}
        {...(activeLegend ? { activeLegend: activeLegend } : {})}
        {...(enableLegendSlider
          ? { enableLegendSlider: enableLegendSlider }
          : {})}
      />
    </div>
  );
};

//#region Tooltip

type TooltipProps = Pick<ChartTooltipProps, "active" | "payload" | "label">;

// eslint-disable-next-line react/no-unused-prop-types
type PayloadItem = {
  category: string; // eslint-disable-line react/no-unused-prop-types
  value: number; // eslint-disable-line react/no-unused-prop-types
  index: string; // eslint-disable-line react/no-unused-prop-types
  color: AvailableChartColorsKeys; // eslint-disable-line react/no-unused-prop-types
  type?: string; // eslint-disable-line react/no-unused-prop-types
  payload: any;
};

interface ChartTooltipProps {
  active: boolean | undefined;
  payload: PayloadItem[];
  label: string;
  valueFormatter: (value: number) => string;
}

const ChartTooltip: React.FunctionComponent<ChartTooltipProps> = ({
  active,
  payload,
  label,
  valueFormatter,
}: ChartTooltipProps): React.ReactElement | null => {
  if (active && payload && payload.length) {
    return (
      <div
        className={cx(
          // base
          "rounded-md border text-sm shadow-md",
          // border color
          "border-gray-200",
          // background color
          "bg-white",
        )}
      >
        <div className={cx("border-b border-inherit px-4 py-2")}>
          <p
            className={cx(
              // base
              "font-medium",
              // text color
              "text-gray-900",
            )}
          >
            {label}
          </p>
        </div>
        <div className={cx("space-y-1 px-4 py-2")}>
          {payload.map(
            ({ value, category, color }: PayloadItem, index: number) => {
              return (
                <div
                  key={`id-${index}`}
                  className="flex items-center justify-between space-x-8"
                >
                  <div className="flex items-center space-x-2">
                    <span
                      aria-hidden="true"
                      className={cx(
                        "size-2 shrink-0 rounded-xs",
                        getColorClassName(color, "bg"),
                      )}
                    />
                    <p
                      className={cx(
                        // base
                        "text-right whitespace-nowrap",
                        // text color
                        "text-gray-700",
                      )}
                    >
                      {category}
                    </p>
                  </div>
                  <p
                    className={cx(
                      // base
                      "text-right font-medium whitespace-nowrap tabular-nums",
                      // text color
                      "text-gray-900",
                    )}
                  >
                    {valueFormatter(value)}
                  </p>
                </div>
              );
            },
          )}
        </div>
      </div>
    );
  }
  return null;
};

//#region BarChart

type BaseEventProps = {
  eventType: "category" | "bar";
  categoryClicked: string;
  [key: string]: number | string;
};

type BarChartEventProps = BaseEventProps | null | undefined;

interface BarChartProps extends React.HTMLAttributes<HTMLDivElement> {
  data: Record<string, any>[];
  index: string;
  categories: string[];
  colors?: AvailableChartColorsKeys[];
  valueFormatter?: (value: number) => string;
  startEndOnly?: boolean;
  showXAxis?: boolean;
  showYAxis?: boolean;
  showGridLines?: boolean;
  yAxisWidth?: number;
  intervalType?: "preserveStartEnd" | "equidistantPreserveStart";
  showTooltip?: boolean;
  showLegend?: boolean;
  autoMinValue?: boolean;
  minValue?: number;
  maxValue?: number;
  allowDecimals?: boolean;
  onValueChange?: (value: BarChartEventProps) => void;
  enableLegendSlider?: boolean;
  tickGap?: number;
  barCategoryGap?: string | number;
  xAxisLabel?: string;
  yAxisLabel?: string;
  layout?: "vertical" | "horizontal";
  type?: "default" | "stacked" | "percent";
  legendPosition?: "left" | "center" | "right";
  tooltipCallback?: (tooltipCallbackContent: TooltipProps) => void;
  customTooltip?: React.ComponentType<TooltipProps>;
  syncid?: string | undefined;
}

const BarChart: React.ForwardRefExoticComponent<
  BarChartProps & React.RefAttributes<HTMLDivElement>
> = React.forwardRef<HTMLDivElement, BarChartProps>(
  (
    props: BarChartProps,
    forwardedRef: React.Ref<HTMLDivElement>,
  ): React.ReactElement => {
    const {
      data = [],
      categories = [],
      index,
      colors = AvailableChartColors,
      valueFormatter = (value: number) => {
        return value.toString();
      },
      startEndOnly = false,
      showXAxis = true,
      showYAxis = true,
      showGridLines = true,
      yAxisWidth = 56,
      intervalType = "equidistantPreserveStart",
      showTooltip = true,
      showLegend = true,
      autoMinValue = false,
      minValue,
      maxValue,
      allowDecimals = true,
      className,
      onValueChange,
      enableLegendSlider = false,
      barCategoryGap,
      tickGap = 5,
      xAxisLabel,
      yAxisLabel,
      layout = "horizontal",
      type = "default",
      legendPosition = "right",
      tooltipCallback,
      customTooltip,
      ...other
    } = props;
    const CustomTooltip: React.ComponentType<any> | undefined = customTooltip;
    const paddingValue: number =
      (!showXAxis && !showYAxis) || (startEndOnly && !showYAxis) ? 0 : 20;
    const [legendHeight, setLegendHeight] = React.useState(60);
    const [activeLegend, setActiveLegend] = React.useState<string | undefined>(
      undefined,
    );
    const categoryColors: Map<string, AvailableChartColorsKeys> =
      constructCategoryColors(categories, colors);
    const [activeBar, setActiveBar] = React.useState<any | undefined>(
      undefined,
    );
    const yAxisDomain: AxisDomain = getYAxisDomain(
      autoMinValue,
      minValue,
      maxValue,
    );
    const hasOnValueChange: boolean = Boolean(onValueChange);
    const stacked: boolean = type === "stacked" || type === "percent";

    const prevActiveRef: React.MutableRefObject<boolean | undefined> =
      React.useRef<boolean | undefined>(undefined);
    const prevLabelRef: React.MutableRefObject<string | undefined> =
      React.useRef<string | undefined>(undefined);

    function valueToPercent(value: number): string {
      return `${(value * 100).toFixed(0)}%`;
    }

    const onBarClick: (data: any, _: any, event: React.MouseEvent) => void =
      React.useCallback(
        (data: any, _: any, event: React.MouseEvent): void => {
          event.stopPropagation();
          if (!onValueChange) {
            return;
          }
          if (deepEqual(activeBar, { ...data.payload, value: data.value })) {
            setActiveLegend(undefined);
            setActiveBar(undefined);
            onValueChange?.(null);
          } else {
            setActiveLegend(data.tooltipPayload?.[0]?.dataKey);
            setActiveBar({
              ...data.payload,
              value: data.value,
            });
            onValueChange?.({
              eventType: "bar",
              categoryClicked: data.tooltipPayload?.[0]?.dataKey,
              ...data.payload,
            });
          }
        },
        [activeBar, onValueChange, setActiveLegend, setActiveBar],
      );

    function onCategoryClick(dataKey: string): void {
      if (!hasOnValueChange) {
        return;
      }
      if (dataKey === activeLegend && !activeBar) {
        setActiveLegend(undefined);
        onValueChange?.(null);
      } else {
        setActiveLegend(dataKey);
        onValueChange?.({
          eventType: "category",
          categoryClicked: dataKey,
        });
      }
      setActiveBar(undefined);
    }

    const shapeRenderer: (props: any) => React.ReactElement = (
      props: any,
    ): React.ReactElement => {
      return renderShape(props, activeBar, activeLegend, layout);
    };

    const handleChartClick: () => void = (): void => {
      setActiveBar(undefined);
      setActiveLegend(undefined);
      onValueChange?.(null);
    };

    return (
      <div
        ref={forwardedRef}
        className={cx("h-80 w-full", className)}
        data-tremor-id="tremor-raw"
        {...other}
      >
        <ResponsiveContainer>
          <RechartsBarChart
            data={data}
            syncId={props.syncid?.toString() || ""}
            {...(hasOnValueChange && (activeLegend || activeBar)
              ? {
                  onClick: handleChartClick,
                }
              : {})}
            margin={{
              bottom: xAxisLabel ? 30 : 0,
              left: yAxisLabel ? 20 : 0,
              right: yAxisLabel ? 5 : 0,
              top: 5,
            }}
            stackOffset={type === "percent" ? "expand" : "none"}
            layout={layout}
            barCategoryGap={barCategoryGap ?? "10%"}
          >
            {showGridLines ? (
              <CartesianGrid
                className={cx("stroke-gray-200 stroke-1")}
                horizontal={layout !== "vertical"}
                vertical={layout === "vertical"}
              />
            ) : null}
            <XAxis
              hide={!showXAxis}
              tick={{
                transform:
                  layout !== "vertical" ? "translate(0, 6)" : undefined,
              }}
              fill=""
              stroke=""
              className={cx(
                // base
                "text-xs",
                // text fill
                "fill-gray-500",
                { "mt-4": layout !== "vertical" },
              )}
              tickLine={false}
              axisLine={false}
              minTickGap={tickGap}
              {...(layout !== "vertical"
                ? {
                    padding: {
                      left: paddingValue,
                      right: paddingValue,
                    },
                    dataKey: index,
                    interval: startEndOnly ? "preserveStartEnd" : intervalType,
                    ...(startEndOnly && data.length > 0
                      ? {
                          ticks: [
                            data[0]?.[index],
                            data[data.length - 1]?.[index],
                          ].filter(Boolean),
                        }
                      : {}),
                  }
                : {
                    type: "number" as const,
                    domain: yAxisDomain as AxisDomain,
                    tickFormatter:
                      type === "percent" ? valueToPercent : valueFormatter,
                    allowDecimals: allowDecimals,
                  })}
            >
              {xAxisLabel && (
                <Label
                  position="insideBottom"
                  offset={-20}
                  className="fill-gray-800 text-sm font-medium"
                >
                  {xAxisLabel}
                </Label>
              )}
            </XAxis>
            <YAxis
              width={yAxisWidth}
              hide={!showYAxis}
              axisLine={false}
              tickLine={false}
              fill=""
              stroke=""
              className={cx(
                // base
                "text-xs",
                // text fill
                "fill-gray-500",
              )}
              tick={{
                transform:
                  layout !== "vertical"
                    ? "translate(-3, 0)"
                    : "translate(0, 0)",
              }}
              {...(layout !== "vertical"
                ? {
                    type: "number" as const,
                    domain: yAxisDomain as AxisDomain,
                    tickFormatter:
                      type === "percent" ? valueToPercent : valueFormatter,
                    allowDecimals: allowDecimals,
                  }
                : {
                    dataKey: index,
                    ...(startEndOnly && data.length > 0
                      ? {
                          ticks: [
                            data[0]?.[index],
                            data[data.length - 1]?.[index],
                          ].filter(Boolean),
                        }
                      : {}),
                    type: "category" as const,
                    interval: "equidistantPreserveStart" as const,
                  })}
            >
              {yAxisLabel && (
                <Label
                  position="insideLeft"
                  style={{ textAnchor: "middle" }}
                  angle={-90}
                  offset={-15}
                  className="fill-gray-800 text-sm font-medium"
                >
                  {yAxisLabel}
                </Label>
              )}
            </YAxis>
            <Tooltip
              wrapperStyle={{ outline: "none" }}
              isAnimationActive={true}
              animationDuration={100}
              cursor={{ fill: "#d1d5db", opacity: "0.15" }}
              offset={20}
              {...(layout === "horizontal"
                ? { position: { y: 0 } }
                : { position: { x: yAxisWidth + 20 } })}
              content={({ active, payload, label }: any) => {
                const cleanPayload: TooltipProps["payload"] = payload
                  ? payload.map((item: any) => {
                      return {
                        category: item.dataKey,
                        value: item.value,
                        index: item.payload[index],
                        color: categoryColors.get(
                          item.dataKey,
                        ) as AvailableChartColorsKeys,
                        type: item.type,
                        payload: item.payload,
                      };
                    })
                  : [];

                if (
                  tooltipCallback &&
                  (active !== prevActiveRef.current ||
                    label !== prevLabelRef.current)
                ) {
                  tooltipCallback({ active, payload: cleanPayload, label });
                  prevActiveRef.current = active;
                  prevLabelRef.current = label;
                }

                return showTooltip && active ? (
                  CustomTooltip ? (
                    <CustomTooltip
                      active={active}
                      payload={cleanPayload}
                      label={label}
                    />
                  ) : (
                    <ChartTooltip
                      active={active}
                      payload={cleanPayload}
                      label={label}
                      valueFormatter={valueFormatter}
                    />
                  )
                ) : null;
              }}
            />
            {showLegend ? (
              <RechartsLegend
                verticalAlign="top"
                height={legendHeight}
                content={({ payload }: any) => {
                  return ChartLegend(
                    { payload },
                    categoryColors,
                    setLegendHeight,
                    activeLegend,
                    hasOnValueChange
                      ? (clickedLegendItem: string): void => {
                          return onCategoryClick(clickedLegendItem);
                        }
                      : undefined,
                    enableLegendSlider,
                    legendPosition,
                    yAxisWidth,
                  );
                }}
              />
            ) : null}
            {categories.map((category: string) => {
              return (
                <Bar
                  className={cx(
                    getColorClassName(
                      categoryColors.get(category) as AvailableChartColorsKeys,
                      "fill",
                    ),
                    onValueChange ? "cursor-pointer" : "",
                  )}
                  key={category}
                  name={category}
                  type="linear"
                  dataKey={category}
                  {...(stacked ? { stackId: "stack" } : {})}
                  isAnimationActive={false}
                  fill=""
                  shape={shapeRenderer}
                  onClick={onBarClick}
                />
              );
            })}
          </RechartsBarChart>
        </ResponsiveContainer>
      </div>
    );
  },
);

BarChart.displayName = "BarChart";

export { BarChart, type BarChartEventProps, type TooltipProps };
