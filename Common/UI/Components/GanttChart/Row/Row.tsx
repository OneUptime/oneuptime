import Icon from "../../Icon/Icon";
import Bar, { GanttChartBar } from "../Bar/Index";
import RowLabel from "./RowLabel";
import IconProp from "../../../../Types/Icon/IconProp";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";

export interface GanttChartRow {
  rowInfo: {
    id: string;
    title: string | ReactElement;
    description: string | ReactElement;
  };
  childRows: GanttChartRow[];
  bars: Array<GanttChartBar>; // usually will have only one bar, this is for future proofing
}

export interface ComponentProps {
  row: GanttChartRow;
  chartTimelineStart: number;
  chartTimelineEnd: number;
  timelineWidth: number;
  selectedBarIds: string[];
  onBarSelectChange: (barIds: string[]) => void;
  level: number;
  multiSelect?: boolean | undefined;
  highlightBarIds?: string[];
}

const doesRowContainHighlight: (
  row: GanttChartRow,
  highlightSet: Set<string>,
) => boolean = (row: GanttChartRow, highlightSet: Set<string>): boolean => {
  if (
    row.bars.some((bar: GanttChartBar) => {
      return highlightSet.has(bar.id);
    })
  ) {
    return true;
  }

  return row.childRows.some((childRow: GanttChartRow) => {
    return doesRowContainHighlight(childRow, highlightSet);
  });
};

const Row: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { row } = props;

  let { level } = props;

  if (!level) {
    level = 0;
  }

  const hasChildRows: boolean = row.childRows.length > 0;

  const highlightSet: Set<string> | null = useMemo(() => {
    if (!props.highlightBarIds || props.highlightBarIds.length === 0) {
      return null;
    }

    return new Set(props.highlightBarIds);
  }, [props.highlightBarIds]);

  const hasHighlightedDescendant: boolean = useMemo(() => {
    if (!highlightSet) {
      return false;
    }

    return row.childRows.some((childRow: GanttChartRow) => {
      return doesRowContainHighlight(childRow, highlightSet);
    });
  }, [highlightSet, row]);

  const shouldShowChildRows: boolean = level < 2 || hasHighlightedDescendant;

  const [showChildRows, setShowChildRows] = useState(shouldShowChildRows);

  useEffect(() => {
    if (hasHighlightedDescendant && !showChildRows) {
      setShowChildRows(true);
    }
  }, [hasHighlightedDescendant, showChildRows]);

  const rowIsHighlighted: boolean = useMemo(() => {
    if (!highlightSet) {
      return false;
    }

    return doesRowContainHighlight(row, highlightSet);
  }, [highlightSet, row]);

  const paddingCount: number = level * 4;

  return (
    // rectangle div with curved corners and text inside in tailwindcss
    <div>
      <div
        className={`flex w-full border-b-2 border-gray-200  border-l-2 border-l-gray-400 border-r-2 border-r-gray-400 ${rowIsHighlighted ? "bg-indigo-50/40" : ""}`}
        data-span-highlighted={rowIsHighlighted ? "true" : undefined}
      >
        <div className="flex w-1/4 border-r-2 border-gray-300 overflow-hidden">
          <div
            className={`pl-${paddingCount} pt-2 pb-2 pr-2 flex overflow-hidden`}
            style={{
              backgroundColor: rowIsHighlighted
                ? "rgba(99, 102, 241, 0.08)"
                : undefined,
              borderRadius: rowIsHighlighted ? "0.5rem" : undefined,
            }}
          >
            <div className="w-5 h-5 ml-3 mt-1">
              {hasChildRows && (
                <Icon
                  icon={
                    showChildRows ? IconProp.ChevronDown : IconProp.ChevronRight
                  }
                  className="cursor-pointer h-4 w-4 text-gray-500 hover:text-gray-800 font-semibold"
                  onClick={() => {
                    return setShowChildRows(!showChildRows);
                  }}
                />
              )}
            </div>
            <RowLabel
              title={row.rowInfo.title}
              description={row.rowInfo.description}
            />
          </div>
        </div>
        <div className="flex w-3/4">
          {row.bars.map((bar: GanttChartBar, i: number) => {
            return (
              <Bar
                key={i}
                bar={bar}
                chartTimelineEnd={props.chartTimelineEnd}
                chartTimelineStart={props.chartTimelineStart}
                timelineWidth={props.timelineWidth}
                areOtherBarsSelected={props.selectedBarIds.length > 0}
                isSelected={props.selectedBarIds.includes(bar.id)}
                isHighlighted={highlightSet?.has(bar.id)}
                onSelect={(barId: string) => {
                  // check if the bar is already selected
                  if (props.selectedBarIds.includes(barId)) {
                    return;
                  }

                  if (!props.multiSelect) {
                    props.onBarSelectChange([barId]);
                    return;
                  }

                  props.onBarSelectChange([...props.selectedBarIds, barId]);
                }}
                onDeselect={(barId: string) => {
                  // check if the bar is already selected
                  if (!props.selectedBarIds.includes(barId)) {
                    return;
                  }

                  props.onBarSelectChange(
                    props.selectedBarIds.filter((id: string) => {
                      return id !== barId;
                    }),
                  );
                }}
              />
            );
          })}
        </div>
      </div>
      {showChildRows && (
        <div>
          {row.childRows.map((childRow: GanttChartRow, i: number) => {
            return (
              <div key={i}>
                <Row
                  level={level + 1}
                  row={childRow}
                  chartTimelineEnd={props.chartTimelineEnd}
                  chartTimelineStart={props.chartTimelineStart}
                  timelineWidth={props.timelineWidth}
                  selectedBarIds={props.selectedBarIds}
                  onBarSelectChange={props.onBarSelectChange}
                  highlightBarIds={props.highlightBarIds}
                  multiSelect={props.multiSelect}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Row;
