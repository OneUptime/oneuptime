import IconProp from "Common/Types/Icon/IconProp";
import TraceAggregationType from "Common/Types/Trace/TraceAggregationType";
import TraceRecordingRuleDefinition, {
  TRACE_RECORDING_RULE_MAX_SOURCES,
  TraceRecordingRuleDefinitionUtil,
  TraceRecordingRuleSource,
} from "Common/Types/Trace/TraceRecordingRuleDefinition";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import FieldLabelElement from "Common/UI/Components/Detail/FieldLabel";
import Input from "Common/UI/Components/Input/Input";
import TextArea from "Common/UI/Components/TextArea/TextArea";
import React, { FunctionComponent, ReactElement, useEffect } from "react";
import TraceRecordingRuleSourceEditor from "./TraceRecordingRuleSourceEditor";

export interface ComponentProps {
  value: TraceRecordingRuleDefinition | undefined;
  onChange: (value: TraceRecordingRuleDefinition) => void;
}

const normalize: (
  value: TraceRecordingRuleDefinition | undefined,
) => TraceRecordingRuleDefinition = (
  value: TraceRecordingRuleDefinition | undefined,
): TraceRecordingRuleDefinition => {
  if (!value || !value.sources || value.sources.length === 0) {
    return TraceRecordingRuleDefinitionUtil.getEmptyDefinition();
  }
  return {
    sources: value.sources,
    expression: value.expression ?? "",
    groupByAttribute: value.groupByAttribute ?? "",
  };
};

const TraceRecordingRuleDefinitionEditor: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [definition, setDefinition] =
    React.useState<TraceRecordingRuleDefinition>(normalize(props.value));

  useEffect(() => {
    props.onChange(definition);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [definition]);

  const updateSource: (
    index: number,
    next: TraceRecordingRuleSource,
  ) => void = (index: number, next: TraceRecordingRuleSource): void => {
    const nextSources: Array<TraceRecordingRuleSource> = [
      ...definition.sources,
    ];
    nextSources[index] = next;
    setDefinition({ ...definition, sources: nextSources });
  };

  const deleteSource: (index: number) => void = (index: number): void => {
    const nextSources: Array<TraceRecordingRuleSource> = [
      ...definition.sources,
    ];
    nextSources.splice(index, 1);
    setDefinition({ ...definition, sources: nextSources });
  };

  const addSource: () => void = (): void => {
    if (definition.sources.length >= TRACE_RECORDING_RULE_MAX_SOURCES) {
      return;
    }
    const nextAlias: string = TraceRecordingRuleDefinitionUtil.getNextAlias(
      definition.sources,
    );
    setDefinition({
      ...definition,
      sources: [
        ...definition.sources,
        {
          alias: nextAlias,
          aggregationType: TraceAggregationType.Count,
        },
      ],
    });
  };

  const aliasChips: Array<string> = definition.sources.map(
    (s: TraceRecordingRuleSource) => {
      return s.alias;
    },
  );

  const canAddSource: boolean =
    definition.sources.length < TRACE_RECORDING_RULE_MAX_SOURCES;

  return (
    <div className="space-y-6">
      <section>
        <div className="flex items-center justify-between mb-1">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">
              Span Sources
            </h3>
            <p className="text-xs text-gray-500">
              Each source is a span aggregation (count, duration percentile,
              etc.) given an alias. Up to {TRACE_RECORDING_RULE_MAX_SOURCES}{" "}
              sources.
            </p>
          </div>
          <span className="text-xs font-medium text-gray-500">
            {definition.sources.length} / {TRACE_RECORDING_RULE_MAX_SOURCES}
          </span>
        </div>

        <div className="space-y-3 mt-3">
          {definition.sources.map(
            (src: TraceRecordingRuleSource, idx: number) => {
              return (
                <TraceRecordingRuleSourceEditor
                  key={`${src.alias}-${idx}`}
                  source={src}
                  index={idx}
                  canDelete={definition.sources.length > 1}
                  onChange={(next: TraceRecordingRuleSource) => {
                    updateSource(idx, next);
                  }}
                  onDelete={() => {
                    deleteSource(idx);
                  }}
                />
              );
            },
          )}
        </div>

        {canAddSource && (
          <div className="mt-3">
            <Button
              title="Add Span Source"
              icon={IconProp.Add}
              buttonSize={ButtonSize.Small}
              buttonStyle={ButtonStyleType.OUTLINE}
              onClick={() => {
                addSource();
              }}
            />
          </div>
        )}
      </section>

      <section>
        <div className="mb-1">
          <h3 className="text-sm font-semibold text-gray-900">Expression</h3>
          <p className="text-xs text-gray-500">
            Arithmetic over the aliases above. Operators{" "}
            <code className="font-mono">+ - * /</code>, parentheses, and numbers
            are allowed.
          </p>
        </div>

        {aliasChips.length > 0 && (
          <div className="flex items-center gap-1.5 mb-2 flex-wrap">
            <span className="text-xs text-gray-500">Available:</span>
            {aliasChips.map((a: string) => {
              return (
                <code
                  key={a}
                  className="px-1.5 py-0.5 rounded bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-mono"
                >
                  {a}
                </code>
              );
            })}
          </div>
        )}

        <TextArea
          placeholder="e.g. A / B * 100"
          value={definition.expression}
          onChange={(v: string) => {
            setDefinition({ ...definition, expression: v });
          }}
        />
        <p className="text-xs text-gray-500 mt-1">
          Example: <code className="font-mono">A / B * 100</code> with A =
          ErrorCount, B = Count gives an error-rate percentage.
        </p>
      </section>

      <section>
        <div className="mb-1">
          <h3 className="text-sm font-semibold text-gray-900">
            Group By{" "}
            <span className="text-xs font-normal text-gray-500">
              (Optional)
            </span>
          </h3>
          <p className="text-xs text-gray-500">
            Attribute to split the result by. One derived data point per
            distinct value per evaluation bucket.
          </p>
        </div>
        <FieldLabelElement title="Attribute Key" />
        <Input
          placeholder="e.g. service.name"
          value={definition.groupByAttribute || ""}
          onChange={(v: string) => {
            setDefinition({ ...definition, groupByAttribute: v });
          }}
        />
      </section>
    </div>
  );
};

export default TraceRecordingRuleDefinitionEditor;
