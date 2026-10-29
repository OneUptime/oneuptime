import IconProp from "Common/Types/Icon/IconProp";
import MonitorType from "Common/Types/Monitor/MonitorType";
import Card from "Common/UI/Components/Card/Card";
import CardSelect, {
  CardSelectOption,
} from "Common/UI/Components/CardSelect/CardSelect";
import React, { FunctionComponent, ReactElement } from "react";
import {
  CUSTOM_RECIPE_COPY,
  getRecipes,
  RECIPE_PICKER_COPY,
  TelemetryRuleRecipe,
  TelemetryRuleRecipeKey,
} from "../../../../Utils/Form/Monitor/TelemetryRule/TelemetryRuleRecipes";

/*
 * "What should this monitor tell you about?" - the first thing a new Logs,
 * Traces or Exceptions monitor asks, in the person's own words: "Too many
 * errors", "A message appears", "Logs stop". Each choice fills in the
 * logs to watch and the rule below it; "Something else" leaves them to the
 * person. The cards are the monitor type picker's, so the two read as one
 * kind of choice.
 */

export interface ComponentProps {
  monitorType: MonitorType;
  value: TelemetryRuleRecipeKey;
  onChange: (key: TelemetryRuleRecipeKey) => void;
}

export const getRecipeCardOptions: (
  monitorType: MonitorType,
) => Array<CardSelectOption> = (
  monitorType: MonitorType,
): Array<CardSelectOption> => {
  return [
    ...getRecipes(monitorType).map(
      (recipe: TelemetryRuleRecipe): CardSelectOption => {
        return {
          value: recipe.key,
          title: recipe.title,
          description: recipe.description,
          icon: recipe.icon,
        };
      },
    ),
    {
      value: TelemetryRuleRecipeKey.Custom,
      title: CUSTOM_RECIPE_COPY.title,
      description: CUSTOM_RECIPE_COPY.description,
      icon: IconProp.Settings,
    },
  ];
};

const TelemetryRuleRecipePicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Card
      title={RECIPE_PICKER_COPY.title}
      description={RECIPE_PICKER_COPY.description}
    >
      <div className="mt-2" data-testid="telemetry-rule-recipes">
        <CardSelect
          options={getRecipeCardOptions(props.monitorType)}
          value={props.value}
          maxColumns={2}
          dataTestId="telemetry-rule-recipe"
          onChange={(value: string) => {
            props.onChange(value as TelemetryRuleRecipeKey);
          }}
        />
      </div>
    </Card>
  );
};

export default TelemetryRuleRecipePicker;
