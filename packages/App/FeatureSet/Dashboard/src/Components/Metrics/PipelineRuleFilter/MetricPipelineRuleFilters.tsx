import IconProp from "Common/Types/Icon/IconProp";
import MetricPipelineRuleFilterCondition, {
  MetricPipelineRuleFilterCheckOn,
  MetricPipelineRuleFilterConditionType,
  MetricPipelineRuleFilterConditionUtil,
} from "Common/Types/Metrics/MetricPipelineRuleFilterCondition";
import Button, { ButtonSize } from "Common/UI/Components/Button/Button";
import HorizontalRule from "Common/UI/Components/HorizontalRule/HorizontalRule";
import RuleAppliesToChoice from "Common/UI/Components/RuleCriteria/RuleAppliesToChoice";
import { RuleCriteriaCopy } from "Common/UI/Components/RuleCriteria/RuleCriteriaFields";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
} from "react";
import MetricPipelineRuleFilterFormElement from "./MetricPipelineRuleFilter";

export interface ComponentProps {
  value: Array<MetricPipelineRuleFilterCondition> | undefined;
  onChange?:
    | ((value: Array<MetricPipelineRuleFilterCondition>) => void)
    | undefined;
}

/*
 * What a pipeline rule fires on, asked as every rule's conditions are
 * (RuleAppliesToChoice): every data point - where a new rule starts - or
 * only those its filters match. It said "If no filters are added, then this
 * rule will apply to every metric data point." over an Add Filter button.
 */
export const METRIC_PIPELINE_RULE_APPLIES_TO: {
  readonly all: string;
  readonly matching: string;
} = {
  all: translationKey("All data points"),
  matching: translationKey("Only data points that match filters"),
};

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
   * The filters "All data points" took out of the rule, until "Only ..."
   * is picked again: a slip of the mouse loses nothing.
   */
  const [rowsSetAside, setRowsSetAside] = React.useState<Array<FilterRow>>([]);

  /*
   * The filters the form holds already. Only a change is reported, never
   * the filters the editor was handed - on mount, or as each row draws
   * itself: a report is an edit to the form (BasicForm), and drawing the
   * editor is not one. Reported on mount, they were once taken for the
   * user's own edit before the form had filled in its defaults, and a new
   * rule was saved switched off, though its switch showed on.
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

  const addFilter: () => void = (): void => {
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
  };

  /*
   * "Only ..." is picked exactly while there are filters: a saved rule opens
   * on whichever it is, and deleting the last filter is going back to "All".
   */
  return (
    <div>
      <RuleAppliesToChoice
        allLabel={METRIC_PIPELINE_RULE_APPLIES_TO.all}
        matchingLabel={METRIC_PIPELINE_RULE_APPLIES_TO.matching}
        isMatching={rows.length > 0}
        onChooseAll={(): void => {
          setRowsSetAside(rows);
          setRows([]);
        }}
        onChooseMatching={(): void => {
          if (rowsSetAside.length > 0) {
            setRows(rowsSetAside);
            setRowsSetAside([]);
            return;
          }

          // One filter to fill in: what was asked for.
          addFilter();
        }}
        label={RuleCriteriaCopy.appliesToTitle}
        dataTestId="metric-pipeline-rule-applies-to"
      >
        <div data-testid="metric-pipeline-rule-filters">
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
              onClick={addFilter}
            />
          </div>
        </div>
      </RuleAppliesToChoice>
      <HorizontalRule />
    </div>
  );
};

export default MetricPipelineRuleFilters;
