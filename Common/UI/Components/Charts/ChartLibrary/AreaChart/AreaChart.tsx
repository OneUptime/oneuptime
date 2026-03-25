// AreaChart - Based on Tremor Raw LineChart pattern with gradient area fills

"use client";

import React from "react";
import { RiArrowLeftSLine, RiArrowRightSLine } from "@remixicon/react";
import {
  Area,
  AreaChart as RechartsAreaChart,
  CartesianGrid,
  Dot,
  Label,
  Legend as RechartsLegend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AxisDomain } from "recharts/types/util/types";

import { useOnWindowResize } from "../Utils/UseWindowOnResize";
import {
  AvailableChartColors,
  AvailableChartColorsKeys,
  constructCategoryColors,
  getColorClassName,
  getColorHex,
} from "../Utils/ChartColors";
import { cx } from "../Utils/Cx";
import { getYAxisDomain } from "../Utils/GetYAxisDomain";
import { hasOnlyOneValueForKey } from "../Utils/HasOnlyOneValueForKey";
import ChartCurve from "../../Types/ChartCurve";

//#region Legend

interface LegendItemProps {
  name: string;
  color: AvailableChartColorsKeys;
  onClick?: (name: string, color: AvailableChartColorsKeys) => void;
  activeLegend?: string;
}

const LegendItem: ({
  name,
  color,
  onClick,
  activeLegend,
}: LegendItemProps) => React.JSX.Element = ({
  name,
  color,
  onClick,
  activeLegend,
}: LegendItemProps) => {
  const hasOnValueChange: boolean = Boolean(onClick);
  return (
    <li
      className={cx(
        "group inline-flex flex-nowrap items-center gap-1.5 whitespace-nowrap rounded px-2 py-1 transition",
        hasOnValueChange
          ? "cursor-pointer hover:bg-gray-100"
          : "cursor-default",
      )}
      onClick={(e: React.MouseEvent<HTMLLIElement, MouseEvent>) => {
        e.stopPropagation();
        onClick?.(name, color);
      }}
    >
      <span
        className={cx(
          "h-[3px] w-3.5 shrink-0 rounded-full",
          getColorClassName(color, "bg"),
          activeLegend && activeLegend !== name ? "opacity-40" : "opacity-100",
        )}
        aria-hidden={true}
      />
      <p
        className={cx(
          "truncate whitespace-nowrap text-xs",
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

const ScrollButton: ({
  icon,
  onClick,
  disabled,
}: ScrollButtonProps) => React.JSX.Element = ({
  icon,
  onClick,
  disabled,
}: ScrollButtonProps) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Icon: React.ElementType<any, keyof React.JSX.IntrinsicElements> = icon;
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
        "group inline-flex size-5 items-center truncate rounded transition",
        disabled
          ? "cursor-not-allowed text-gray-400"
          : "cursor-pointer text-gray-700 hover:bg-gray-100 hover:text-gray-900",
      )}
      disabled={disabled}
      onClick={(e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
        e.stopPropagation();
        onClick?.();
      }}
      onMouseDown={(e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
        e.stopPropagation();
        setIsPressed(true);
      }}
      onMouseUp={(e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
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
  (props: LegendProps, ref: React.ForwardedRef<HTMLOListElement>) => {
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
      const keyDownHandler: (key: string) => void = (key: string) => {
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
        clearInterval(intervalRef.current!);
      }
      return () => {
        return clearInterval(intervalRef.current as NodeJS.Timeout);
      };
    }, [isKeyDowned, scrollToTest]);

    const keyDown: (e: KeyboardEvent) => void = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        setIsKeyDowned(e.key);
      }
    };
    const keyUp: (e: KeyboardEvent) => void = (e: KeyboardEvent) => {
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
                ? "snap-mandatory items-center overflow-auto pl-4 pr-12 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                onClick={onClickLegendItem as any}
                activeLegend={activeLegend!}
              />
            );
          })}
        </div>
        {enableLegendSlider && (hasScroll?.right || hasScroll?.left) ? (
          <>
            <div
              ref={scrollButtonsRef}
              className={cx(
                "absolute bottom-0 right-0 top-0 flex h-full items-center justify-center pr-1",
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

/* eslint-disable react/no-unused-prop-types */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PayloadItem = {
  category: string;
  value: number;
  index: string;
  color: AvailableChartColorsKeys;
  type?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any;
};
/* eslint-enable react/no-unused-prop-types */

const ChartLegend: (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  { payload }: any,
  categoryColors: Map<string, AvailableChartColorsKeys>,
  setLegendHeight: React.Dispatch<React.SetStateAction<number>>,
  activeLegend: string | undefined,
  onClick?: (category: string, color: string) => void,
  enableLegendSlider?: boolean,
  legendPosition?: "left" | "center" | "right",
  yAxisWidth?: number,
) => React.JSX.Element = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  { payload }: any,
  categoryColors: Map<string, AvailableChartColorsKeys>,
  setLegendHeight: React.Dispatch<React.SetStateAction<number>>,
  activeLegend: string | undefined,
  onClick?: (category: string, color: string) => void,
  enableLegendSlider?: boolean,
  legendPosition?: "left" | "center" | "right",
  yAxisWidth?: number,
): React.JSX.Element => {
  const legendRef: React.RefObject<HTMLDivElement> =
    React.useRef<HTMLDivElement>(null);

  useOnWindowResize(() => {
    const calculateHeight: (height: number | undefined) => number = (
      height: number | undefined,
    ) => {
      return height ? Number(height) + 15 : 60;
    };
    setLegendHeight(calculateHeight(legendRef.current?.clientHeight));
  });

  const legendPayload: Array<PayloadItem> = payload.filter(
    (item: PayloadItem) => {
      return item.type !== "none";
    },
  );

  const paddingLeft: number =
    legendPosition === "left" && yAxisWidth ? yAxisWidth - 8 : 0;

  return (
    <div
      ref={legendRef}
      style={{ paddingLeft: paddingLeft }}
      className={cx(
        "flex items-center",
        { "justify-center": legendPosition === "center" },
        { "justify-start": legendPosition === "left" },
        { "justify-end": legendPosition === "right" },
      )}
    >
      <Legend
        categories={legendPayload.map((entry: PayloadItem) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return entry.value as any;
        })}
        colors={legendPayload.map((entry: PayloadItem) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return categoryColors.get(entry.value! as any)!;
        })}
        onClickLegendItem={onClick!}
        activeLegend={activeLegend!}
        enableLegendSlider={enableLegendSlider!}
      />
    </div>
  );
};

//#region Tooltip

type TooltipProps = Pick<ChartTooltipProps, "active" | "payload" | "label">;

interface ChartTooltipProps {
  active: boolean | undefined;
  payload: PayloadItem[];
  label: string;
  valueFormatter: (value: number) => string;
}

const ChartTooltip: ({
  active,
  payload,
  label,
  valueFormatter,
}: ChartTooltipProps) => React.JSX.Element | null = ({
  active,
  payload,
  label,
  valueFormatter,
}: ChartTooltipProps): React.JSX.Element | null => {
  if (active && payload && payload.length) {
    const legendPayload: PayloadItem[] = payload.filter((item: PayloadItem) => {
      return item.type !== "none";
    });
    return (
      <div
        className={cx(
          "rounded-md border text-sm shadow-md",
          "border-gray-200",
          "bg-white",
        )}
      >
        <div className={cx("border-b border-inherit px-4 py-2")}>
          <p className={cx("font-medium", "text-gray-900")}>{label}</p>
        </div>
        <div className={cx("space-y-1 px-4 py-2")}>
          {legendPayload.map(
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
                        "h-[3px] w-3.5 shrink-0 rounded-full",
                        getColorClassName(color, "bg"),
                      )}
                    />
                    <p
                      className={cx(
                        "whitespace-nowrap text-right",
                        "text-gray-700",
                      )}
                    >
                      {category}
                    </p>
                  </div>
                  <p
                    className={cx(
                      "whitespace-nowrap text-right font-medium tabular-nums",
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

//#region AreaChart

interface ActiveDot {
  index?: number;
  dataKey?: string;
}

type BaseEventProps = {
  eventType: "dot" | "category";
  categoryClicked: string;
  [key: string]: number | string;
};

type AreaChartEventProps = BaseEventProps | null | undefined;

interface AreaChartProps extends React.HTMLAttributes<HTMLDivElement> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  onValueChange?: (value: AreaChartEventProps) => void;
  enableLegendSlider?: boolean;
  tickGap?: number;
  connectNulls?: boolean;
  xAxisLabel?: string;
  yAxisLabel?: string;
  curve?: ChartCurve;
  legendPosition?: "left" | "center" | "right";
  tooltipCallback?: (tooltipCallbackContent: TooltipProps) => void;
  customTooltip?: React.ComponentType<TooltipProps>;
  syncid?: string | undefined;
}

const AreaChart: React.ForwardRefExoticComponent<
  AreaChartProps & React.RefAttributes<HTMLDivElement>
> = React.forwardRef<HTMLDivElement, AreaChartProps>(
  (props: AreaChartProps, ref: React.ForwardedRef<HTMLDivElement>) => {
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
      connectNulls = false,
      className,
      onValueChange,
      enableLegendSlider = false,
      tickGap = 5,
      xAxisLabel,
      yAxisLabel,
      legendPosition = "right",
      tooltipCallback,
      customTooltip,
      ...other
    } = props;
    const CustomTooltip: React.ComponentType<TooltipProps> | undefined =
      customTooltip;
    const paddingValue: 0 | 20 =
      (!showXAxis && !showYAxis) || (startEndOnly && !showYAxis) ? 0 : 20;
    const [legendHeight, setLegendHeight] = React.useState(60);
    const [activeDot, setActiveDot] = React.useState<ActiveDot | undefined>(
      undefined,
    );
    const [activeLegend, setActiveLegend] = React.useState<string | undefined>(
      undefined,
    );
    const categoryColors: Map<string, string | number> =
      constructCategoryColors(categories, colors);

    const yAxisDomain: (number | "auto")[] = getYAxisDomain(
      autoMinValue,
      minValue,
      maxValue,
    );
    const hasOnValueChange: boolean = Boolean(onValueChange);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prevActiveRef: React.MutableRefObject<boolean | undefined> =
      React.useRef<boolean | undefined>(undefined);
    const prevLabelRef: React.MutableRefObject<string | undefined> =
      React.useRef<string | undefined>(undefined);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function onDotClick(itemData: any, event: React.MouseEvent): void {
      event.stopPropagation();

      if (!hasOnValueChange) {
        return;
      }
      if (
        (itemData.index === activeDot?.index &&
          itemData.dataKey === activeDot?.dataKey) ||
        (hasOnlyOneValueForKey(data, itemData.dataKey) &&
          activeLegend &&
          activeLegend === itemData.dataKey)
      ) {
        setActiveLegend(undefined);
        setActiveDot(undefined);
        onValueChange?.(null);
      } else {
        setActiveLegend(itemData.dataKey);
        setActiveDot({
          index: itemData.index,
          dataKey: itemData.dataKey,
        });
        onValueChange?.({
          eventType: "dot",
          categoryClicked: itemData.dataKey,
          ...itemData.payload,
        });
      }
    }

    function onCategoryClick(dataKey: string): void {
      if (!hasOnValueChange) {
        return;
      }
      if (
        (dataKey === activeLegend && !activeDot) ||
        (hasOnlyOneValueForKey(data, dataKey) &&
          activeDot &&
          activeDot.dataKey === dataKey)
      ) {
        setActiveLegend(undefined);
        onValueChange?.(null);
      } else {
        setActiveLegend(dataKey);
        onValueChange?.({
          eventType: "category",
          categoryClicked: dataKey,
        });
      }
      setActiveDot(undefined);
    }

    return (
      <div ref={ref} className={cx("h-80 w-full", className)} {...other}>
        <ResponsiveContainer>
          <RechartsAreaChart
            data={data}
            syncId={props.syncid?.toString() || ""}
            onClick={
              hasOnValueChange && (activeLegend || activeDot)
                ? () => {
                    setActiveDot(undefined);
                    setActiveLegend(undefined);
                    onValueChange?.(null);
                  }
                : () => {}
            }
            margin={{
              bottom: (xAxisLabel ? 30 : undefined) as unknown as number,
              left: (yAxisLabel ? 20 : undefined) as unknown as number,
              right: (yAxisLabel ? 5 : undefined) as unknown as number,
              top: 5,
            }}
          >
            <defs>
              {categories.map((category: string, i: number) => {
                const colorKey: AvailableChartColorsKeys =
                  (colors[i % colors.length] as AvailableChartColorsKeys) ||
                  "blue";
                const hex: string = getColorHex(colorKey);
                return (
                  <linearGradient
                    key={category}
                    id={`gradient-${category.replace(/[^a-zA-Z0-9]/g, "_")}`}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="0%" stopColor={hex} stopOpacity={0.2} />
                    <stop offset="100%" stopColor={hex} stopOpacity={0.01} />
                  </linearGradient>
                );
              })}
            </defs>
            {showGridLines ? (
              <CartesianGrid
                className={cx("stroke-gray-200 stroke-1")}
                horizontal={true}
                vertical={false}
              />
            ) : null}
            <XAxis
              padding={{ left: paddingValue, right: paddingValue }}
              hide={!showXAxis}
              dataKey={index}
              interval={startEndOnly ? "preserveStartEnd" : intervalType}
              tick={{ transform: "translate(0, 6)" }}
              ticks={
                startEndOnly
                  ? ([
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      (data[0] as any)[index],
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      (data[data.length - 1] as any)[index],
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    ] as any)
                  : undefined
              }
              fill=""
              stroke=""
              className={cx("text-xs", "fill-gray-500")}
              tickLine={false}
              axisLine={false}
              minTickGap={tickGap}
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
              type="number"
              domain={yAxisDomain as AxisDomain}
              tick={{ transform: "translate(-3, 0)" }}
              fill=""
              stroke=""
              className={cx("text-xs", "fill-gray-500")}
              tickFormatter={valueFormatter}
              allowDecimals={allowDecimals}
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
              cursor={{ stroke: "#d1d5db", strokeWidth: 1 }}
              offset={20}
              position={{ y: 0 }}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              content={({ active, payload, label }: any) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const cleanPayload: TooltipProps["payload"] = payload
                  ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    payload.map((item: any) => {
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
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                content={({ payload }: any) => {
                  return ChartLegend(
                    { payload },
                    categoryColors,
                    setLegendHeight,
                    activeLegend,
                    hasOnValueChange
                      ? (clickedLegendItem: string) => {
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
              const gradientId: string = `gradient-${category.replace(/[^a-zA-Z0-9]/g, "_")}`;
              const colorKey: AvailableChartColorsKeys = categoryColors.get(
                category,
              ) as AvailableChartColorsKeys;
              const hex: string = getColorHex(colorKey);

              return (
                <Area
                  key={category}
                  name={category}
                  type={props.curve || ChartCurve.MONOTONE}
                  dataKey={category}
                  stroke={hex}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  fill={`url(#${gradientId})`}
                  fillOpacity={1}
                  strokeOpacity={
                    activeDot || (activeLegend && activeLegend !== category)
                      ? 0.3
                      : 1
                  }
                  isAnimationActive={false}
                  connectNulls={connectNulls}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  activeDot={(dotProps: any) => {
                    const {
                      cx: cxCoord,
                      cy: cyCoord,
                      stroke,
                      strokeLinecap: slc,
                      strokeLinejoin: slj,
                      strokeWidth,
                      dataKey,
                    } = dotProps;
                    return (
                      <Dot
                        className={cx(
                          "stroke-white",
                          onValueChange ? "cursor-pointer" : "",
                          getColorClassName(
                            categoryColors.get(
                              dataKey,
                            ) as AvailableChartColorsKeys,
                            "fill",
                          ),
                        )}
                        cx={cxCoord}
                        cy={cyCoord}
                        r={5}
                        fill=""
                        stroke={stroke}
                        strokeLinecap={slc}
                        strokeLinejoin={slj}
                        strokeWidth={strokeWidth}
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        onClick={(_: any, event: any) => {
                          return onDotClick(dotProps, event);
                        }}
                      />
                    );
                  }}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  dot={(dotProps: any) => {
                    const {
                      stroke,
                      strokeLinecap: slc,
                      strokeLinejoin: slj,
                      strokeWidth,
                      cx: cxCoord,
                      cy: cyCoord,
                      dataKey,
                      index: dotIndex,
                    } = dotProps;

                    if (
                      (hasOnlyOneValueForKey(data, category) &&
                        !(
                          activeDot ||
                          (activeLegend && activeLegend !== category)
                        )) ||
                      (activeDot?.index === dotIndex &&
                        activeDot?.dataKey === category)
                    ) {
                      return (
                        <Dot
                          key={dotIndex}
                          cx={cxCoord}
                          cy={cyCoord}
                          r={5}
                          stroke={stroke}
                          fill=""
                          strokeLinecap={slc}
                          strokeLinejoin={slj}
                          strokeWidth={strokeWidth}
                          className={cx(
                            "stroke-white",
                            onValueChange ? "cursor-pointer" : "",
                            getColorClassName(
                              categoryColors.get(
                                dataKey,
                              ) as AvailableChartColorsKeys,
                              "fill",
                            ),
                          )}
                        />
                      );
                    }
                    return <React.Fragment key={dotIndex}></React.Fragment>;
                  }}
                />
              );
            })}
          </RechartsAreaChart>
        </ResponsiveContainer>
      </div>
    );
  },
);

AreaChart.displayName = "AreaChart";

export { AreaChart, type AreaChartEventProps, type TooltipProps };
