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
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

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
  const translator: Translator = useTranslator();
  const [definition, setDefinition] =
    React.useState<TraceRecordingRuleDefinition>(normalize(props.value));

  useEffect(() => {
    props.onChange(definition);
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
              {translator.translateText("Span Sources")}
            </h3>
            <p className="text-xs text-gray-500">
              {translator.translateTemplate(
                "Each source is a span aggregation (count, duration percentile, etc.) given an alias. Up to {{max}} sources.",
                {
                  max: translator.formatNumber(
                    TRACE_RECORDING_RULE_MAX_SOURCES,
                  ),
                },
              )}
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
          <h3 className="text-sm font-semibold text-gray-900">
            {translator.translateText("Expression")}
          </h3>
          <p className="text-xs text-gray-500">
            <TranslatedSentence
              template="Arithmetic over the aliases above. Operators {{operators}}, parentheses, and numbers are allowed."
              slots={{
                operators: <code className="font-mono">+ - * /</code>,
              }}
            />
          </p>
        </div>

        {aliasChips.length > 0 && (
          <div className="flex items-center gap-1.5 mb-2 flex-wrap">
            <span className="text-xs text-gray-500">
              {translator.translateText("Available:")}
            </span>
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
          <TranslatedSentence
            template="Example: {{expression}} with A = ErrorCount, B = Count gives an error-rate percentage."
            slots={{
              expression: <code className="font-mono">A / B * 100</code>,
            }}
          />
        </p>
      </section>

      <section>
        <div className="mb-1">
          <h3 className="text-sm font-semibold text-gray-900">
            {translator.translateText("Group By")}{" "}
            <span className="text-xs font-normal text-gray-500">
              {translator.translateText("(Optional)")}
            </span>
          </h3>
          <p className="text-xs text-gray-500">
            {translator.translateText(
              "Attribute to split the result by. One derived data point per distinct value per evaluation bucket.",
            )}
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
