import CloudCostGroup from "Common/Models/DatabaseModels/CloudCostGroup";
import { CloudCostSharedPercentages } from "Common/Types/Cloud/CloudCostAllocation";
import { formatReaderFigure } from "Common/Types/DateLanguage";
import FieldError from "Common/UI/Components/Forms/Fields/FieldError";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A shared group split by fixed percentages: each other group of the view
 * and its percent, which together come to 100. A group left at nothing
 * takes nothing.
 */

export const PERCENTAGES_TOTAL: string = translationKey("{{total}} of 100%");
export const PERCENTAGES_NOT_100: string = translationKey(
  "The percentages must add up to 100.",
);
export const PERCENTAGES_NO_GROUPS: string = translationKey(
  "Add another group to the view to split this one onto.",
);
export const PERCENT_OF: string = translationKey("Percent for {{group}}");

export interface ComponentProps {
  // The view's other groups, the ones a shared group can split onto.
  groups: Array<CloudCostGroup>;
  value: CloudCostSharedPercentages;
  onChange: (value: CloudCostSharedPercentages) => void;
}

// Whether percentages come to 100, as the server checks them.
export function percentagesAddUp(value: CloudCostSharedPercentages): boolean {
  const total: number = Object.values(value).reduce(
    (sum: number, percent: number): number => {
      return sum + (Number(percent) || 0);
    },
    0,
  );

  return Object.keys(value).length === 0 || Math.abs(total - 100) <= 0.01;
}

const CloudCostPercentagesEditor: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const total: number = Object.values(props.value).reduce(
    (sum: number, percent: number): number => {
      return sum + (Number(percent) || 0);
    },
    0,
  );

  if (props.groups.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        {translator.translateText(PERCENTAGES_NO_GROUPS)}
      </p>
    );
  }

  return (
    <div className="space-y-2" data-testid="cloud-cost-percentages">
      {props.groups.map((group: CloudCostGroup): ReactElement => {
        const id: string = (group._id || "").toString().toLowerCase();
        const label: string = translator.translateTemplate(PERCENT_OF, {
          group: group.name || "",
        });

        return (
          <div key={id} className="flex items-center gap-3">
            <span className="min-w-0 flex-1 truncate text-sm text-gray-700">
              <bdi>{group.name}</bdi>
            </span>
            <div className="w-28">
              <Input
                type={InputType.NUMBER}
                value={
                  props.value[id] === undefined ? "" : String(props.value[id])
                }
                ariaLabel={label}
                dataTestId="cloud-cost-percentage"
                onChange={(text: string) => {
                  const next: CloudCostSharedPercentages = { ...props.value };
                  const percent: number = Number(text);

                  if (
                    !text.trim() ||
                    !Number.isFinite(percent) ||
                    percent <= 0
                  ) {
                    delete next[id];
                  } else {
                    next[id] = percent;
                  }

                  props.onChange(next);
                }}
              />
            </div>
          </div>
        );
      })}
      <div className="text-xs text-gray-500">
        {translator.translateTemplate(PERCENTAGES_TOTAL, {
          total: formatReaderFigure(total, {
            decimals: 2,
            dropTrailingZeros: true,
            isPercent: true,
            language: translator.language,
          }),
        })}
      </div>
      {!percentagesAddUp(props.value) ? (
        <FieldError
          message={
            translator.translateText(PERCENTAGES_NOT_100) || PERCENTAGES_NOT_100
          }
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default CloudCostPercentagesEditor;
