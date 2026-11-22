import { OPEN_BUDGETS } from "./RefusedTelemetryCopy";
import {
  RefusedTelemetryLine,
  describeRefusedTelemetryList,
} from "./RefusedTelemetryModel";
import { getTelemetryIngestionBudgetsRoute } from "../../TelemetryIngestionBudget/ProjectTelemetryIngestionBudget";
import IconProp from "Common/Types/Icon/IconProp";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { RefusedTelemetry } from "Common/Utils/SecurityEvent/RefusedTelemetry";
import React, { FunctionComponent, ReactElement } from "react";

export const REFUSED_TELEMETRY_LINES_TEST_ID: string = "refused-telemetry";

export interface ComponentProps {
  refusals: ReadonlyArray<RefusedTelemetry>;
  // Name the source above each line ("Your logs", "Traces"): off where the card says it.
  showsSource: boolean;
  // A sentence above the lines: what it means here (a retrohunt, a case).
  intro?: string | undefined;
  // Open Budgets beside them: off where the page has its own way there.
  showsOpenBudgets: boolean;
  dataTestId?: string | undefined;
}

/*
 * What an ingestion budget or rate refused of the telemetry Security Events
 * reads (#10431), one line per stretch: whose budget refused what and when,
 * and under it how much was not stored - what goes on first. Drawn as an
 * exception to act on, in amber, with Open Budgets (the project's budgets,
 * under Project Settings > Telemetry & APM > Usage) beside it. Nothing at
 * all when nothing was refused.
 */
const RefusedTelemetryLines: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const testId: string = props.dataTestId || REFUSED_TELEMETRY_LINES_TEST_ID;

  if (props.refusals.length === 0) {
    return <></>;
  }

  const lines: Array<RefusedTelemetryLine> = describeRefusedTelemetryList({
    refusals: props.refusals,
    translator,
  });

  return (
    <div
      data-testid={testId}
      className="flex flex-col gap-3 rounded-lg bg-amber-50 px-4 py-3 md:flex-row md:items-start md:justify-between"
    >
      <div className="min-w-0 space-y-2.5 text-sm">
        {props.intro ? (
          <p
            className="text-pretty font-medium text-amber-900"
            data-testid={`${testId}-intro`}
          >
            {translator.translateText(props.intro) || props.intro}
          </p>
        ) : (
          <></>
        )}
        <ul className="space-y-2.5">
          {lines.map((line: RefusedTelemetryLine): ReactElement => {
            return (
              <li
                key={line.id}
                data-testid={`${testId}-line`}
                data-signal={line.signal}
                data-ongoing={line.isOngoing ? "true" : "false"}
                className="flex items-start gap-2"
              >
                <Icon
                  icon={IconProp.SignalSlash}
                  className="mt-0.5 h-4 w-4 flex-none text-amber-600"
                />
                <div className="min-w-0">
                  {props.showsSource ? (
                    <p className="font-medium text-gray-900">
                      {translator.translateText(line.sourceTitle) ||
                        line.sourceTitle}
                    </p>
                  ) : (
                    <></>
                  )}
                  <p className="text-pretty text-gray-700 [overflow-wrap:anywhere]">
                    {line.sentence}
                  </p>
                  {line.amount ? (
                    <p
                      className="mt-0.5 text-gray-600"
                      data-testid={`${testId}-amount`}
                    >
                      {line.amount}
                    </p>
                  ) : (
                    <></>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
      {props.showsOpenBudgets ? (
        <div className="flex-shrink-0 self-end md:self-auto">
          <Button
            title={OPEN_BUDGETS}
            icon={IconProp.Gauge}
            buttonStyle={ButtonStyleType.NORMAL}
            dataTestId={`${testId}-open-budgets`}
            onClick={() => {
              Navigation.navigate(getTelemetryIngestionBudgetsRoute());
            }}
          />
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default RefusedTelemetryLines;
