import IconProp from "Common/Types/Icon/IconProp";
import MetricPipelineRuleFilterCondition, {
  MetricPipelineRuleFilterCheckOn,
  MetricPipelineRuleFilterConditionType,
  MetricPipelineRuleFilterConditionUtil,
} from "Common/Types/Metrics/MetricPipelineRuleFilterCondition";
import Button, { ButtonSize } from "Common/UI/Components/Button/Button";
import HorizontalRule from "Common/UI/Components/HorizontalRule/HorizontalRule";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
} from "react";
import MetricPipelineRuleFilterFormElement from "./MetricPipelineRuleFilter";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

export interface ComponentProps {
  value: Array<MetricPipelineRuleFilterCondition> | undefined;
  onChange?:
    | ((value: Array<MetricPipelineRuleFilterCondition>) => void)
    | undefined;
}

/*
 * One filter on screen. Each row keeps the filter it was drawn with
 * (MetricPipelineRuleFilter holds its own state), so a row is keyed by an id
 * of its own, never by its place in the list: keyed by place, removing the
 * first of two filters left the first row on screen showing the removed
 * filter while the form held the other one, and the next edit to that row
 * overwrote the filter that was kept.
 */
interface FilterRow {
  id: number;
  filter: MetricPipelineRuleFilterCondition;
}

type SerializeFunction = (
  filters: Array<MetricPipelineRuleFilterCondition>,
) => string;

const serialize: SerializeFunction = (
  filters: Array<MetricPipelineRuleFilterCondition>,
): string => {
  return JSON.stringify(filters);
};

const MetricPipelineRuleFilters: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const lastRowId: MutableRefObject<number> = useRef<number>(0);

  const toRow: (filter: MetricPipelineRuleFilterCondition) => FilterRow = (
    filter: MetricPipelineRuleFilterCondition,
  ): FilterRow => {
    lastRowId.current = lastRowId.current + 1;
    return { id: lastRowId.current, filter };
  };

  const [rows, setRows] = React.useState<Array<FilterRow>>(
    (): Array<FilterRow> => {
      return (props.value || []).map(toRow);
    },
  );

  /*
   * The filters the form holds already. Only a change is reported: the
   * form takes a value reported before it has filled in its defaults as the
   * user's own and fills in no defaults after it (BasicForm), so reporting
   * the filters it was handed - on mount, or as each row draws itself -
   * left a new rule with no Filter Condition and switched off, though its
   * switch showed on.
   */
  const reportedFilters: MutableRefObject<string> = useRef<string>(
    serialize(props.value || []),
  );

  useEffect(() => {
    const filters: Array<MetricPipelineRuleFilterCondition> = rows.map(
      (row: FilterRow): MetricPipelineRuleFilterCondition => {
        return row.filter;
      },
    );
    const serialized: string = serialize(filters);

    if (serialized === reportedFilters.current) {
      return;
    }

    reportedFilters.current = serialized;

    if (props.onChange) {
      props.onChange(filters);
    }
  }, [rows]);

  return (
    <div>
      {rows.length === 0 && (
        <p className="text-sm text-gray-700 text-semibold">
          {translator.translateText(
            "If no filters are added, then this rule will apply to every metric data point.",
          )}
        </p>
      )}

      {rows.map((row: FilterRow) => {
        return (
          <MetricPipelineRuleFilterFormElement
            key={row.id}
            initialValue={row.filter}
            onDelete={() => {
              setRows((current: Array<FilterRow>): Array<FilterRow> => {
                return current.filter((candidate: FilterRow): boolean => {
                  return candidate.id !== row.id;
                });
              });
            }}
            onChange={(value: MetricPipelineRuleFilterCondition) => {
              setRows((current: Array<FilterRow>): Array<FilterRow> => {
                return current.map((candidate: FilterRow): FilterRow => {
                  return candidate.id === row.id
                    ? { id: candidate.id, filter: value }
                    : candidate;
                });
              });
            }}
          />
        );
      })}

      <div className="mt-3 -ml-3">
        <Button
          title="Add Filter"
          buttonSize={ButtonSize.Small}
          icon={IconProp.Add}
          onClick={() => {
            const defaultCheckOn: MetricPipelineRuleFilterCheckOn =
              MetricPipelineRuleFilterCheckOn.MetricName;
            const defaultConditionType: MetricPipelineRuleFilterConditionType =
              MetricPipelineRuleFilterConditionUtil.getConditionTypesByCheckOn(
                defaultCheckOn,
              )[0]!;

            const added: FilterRow = toRow({
              checkOn: defaultCheckOn,
              conditionType: defaultConditionType,
              attributeKey: undefined,
              value: "",
            });

            setRows((current: Array<FilterRow>): Array<FilterRow> => {
              return [...current, added];
            });
          }}
        />
      </div>
      <HorizontalRule />
    </div>
  );
};

export default MetricPipelineRuleFilters;
