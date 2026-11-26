import DropFilterImpactPreview from "./DropFilterImpactPreview";
import { TelemetryFieldSignal } from "Common/Types/Telemetry/TelemetryFieldReaders";
import { translatableTerm } from "Common/Types/Translator";
import { RowActionConfirmation } from "Common/UI/Components/ActionButton/ActionButtonSchema";
import {
  BulkSwitchAction,
  DISABLE_SWITCH_ACTION,
  ENABLE_SWITCH_ACTION,
} from "Common/UI/Components/BulkUpdate/BulkSwitchActions";
import { getBulkSwitchConsequence } from "Common/UI/Components/BulkUpdate/BulkSwitchConsequences";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import NamedSentence from "Common/UI/Components/DeleteConfirmation/NamedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import React from "react";

/*
 * A DROP FILTER'S ENABLE SAYS WHAT IT WOULD TAKE (#10436).
 *
 * Turning a filter on starts taking what it matches, within a minute. So a
 * row's Enable asks, as the form does before a filter is saved: the
 * question names the filter, and under it the filter's impact - what its
 * query matched in the last day, what Security Events and the monitors,
 * SLOs and dashboards that read those records lose (DropFilterImpactPreview,
 * which asks the server as the dialog opens). Disable asks what it always
 * asked: a disabled filter keeps what it would drop
 * (BulkSwitchConsequences).
 */
export function getDropFilterRowConfirmation(data: {
  signal: TelemetryFieldSignal;
  value: boolean;
  item: {
    filterQuery?: unknown;
    action?: unknown;
    samplePercentage?: unknown;
    name?: unknown;
  };
  name: string;
  // The model's: "Log Drop Filter".
  singularName: string;
  tableName: string;
  translator: Translator;
}): RowActionConfirmation | undefined {
  const action: BulkSwitchAction = data.value
    ? ENABLE_SWITCH_ACTION
    : DISABLE_SWITCH_ACTION;
  const consequence: string = data.value
    ? ""
    : getBulkSwitchConsequence({
        tableName: data.tableName,
        column: "isEnabled",
        value: false,
      });

  if (!data.value && !consequence) {
    return undefined;
  }

  return {
    title: data.translator.translateTemplate(action.rowConfirmTitle, {
      itemName: translatableTerm(data.singularName),
    }),
    description: (
      <NamedSentence
        template={action.rowQuestion}
        name={data.name}
        dataTestId="row-switch-name"
      />
    ),
    details: data.value ? (
      <DropFilterImpactPreview
        signal={data.signal}
        rule={data.item}
        dataTestId="drop-filter-enable-impact"
      />
    ) : (
      <p
        data-testid="row-switch-consequence"
        className="text-sm leading-6 text-gray-600"
      >
        {data.translator.translateText(consequence) || consequence}
      </p>
    ),
    submitButtonText: action.title,
    submitButtonType: ButtonStyleType.PRIMARY,
  };
}
