import AppLink from "../AppLink/AppLink";
import {
  DATA_OBSERVABILITY_SETUP_COPY,
  SetupStepCopy,
  getSetupDismissedKey,
  getSetupStepRoute,
} from "./OverviewAttention";
import {
  DataObservabilitySetup,
  DataObservabilitySetupStepState,
  getDataObservabilitySetupSteps,
} from "Common/Types/DataObservability/DataObservabilityAttention";
import IconProp from "Common/Types/Icon/IconProp";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import LocalStorage from "Common/UI/Utils/LocalStorage";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * THE FIRST STEPS, ONCE A DATABASE IS CONNECTED.
 *
 * Connecting a database watches its tables; it tells nobody anything. So
 * the Overview lists what makes Data Observability useful, each step done
 * or to do and with the page it is done on: turn on the database's alerts
 * (monitors a person reviews and turns on, never made behind their back),
 * say who owns which tables, add a check, send the pipelines' runs. It goes
 * once every step is done, or when someone hides it - remembered in this
 * browser, per project.
 */

export const SETUP_STEPS_TEST_ID: string = "data-observability-setup-steps";

export interface ComponentProps {
  projectId: string;
  setup: DataObservabilitySetup;
}

function readIsHidden(projectId: string): boolean {
  try {
    return Boolean(LocalStorage.getItem(getSetupDismissedKey(projectId)));
  } catch {
    // A browser that keeps nothing still shows the steps.
    return false;
  }
}

const OverviewSetupSteps: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isHidden, setIsHidden] = useState<boolean>(
    readIsHidden(props.projectId),
  );
  const steps: Array<DataObservabilitySetupStepState> =
    getDataObservabilitySetupSteps(props.setup);
  const doneCount: number = steps.filter(
    (step: DataObservabilitySetupStepState): boolean => {
      return step.isDone;
    },
  ).length;

  if (isHidden || doneCount === steps.length) {
    return <></>;
  }

  const hide: () => void = (): void => {
    try {
      LocalStorage.setItem(getSetupDismissedKey(props.projectId), true);
    } catch {
      // Hidden for this visit, at least.
    }

    setIsHidden(true);
  };

  return (
    <section
      className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6"
      data-testid={SETUP_STEPS_TEST_ID}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-cyan-50 text-cyan-700">
            <Icon icon={IconProp.TableCells} className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-gray-900">
              {translator.translateText("Finish setting up Data Observability")}
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-gray-600">
              {translator.translateTemplate(
                "{{done}} of {{count}} done. Your tables are watched; these steps make sure the right people hear when one breaks.",
                {
                  done: translator.formatNumber(doneCount),
                  count: translator.formatNumber(steps.length),
                },
              )}
            </p>
          </div>
        </div>
        <div className="flex-shrink-0 self-end sm:self-auto">
          <Button
            title="Hide"
            buttonStyle={ButtonStyleType.OUTLINE}
            buttonSize={ButtonSize.Small}
            icon={IconProp.Close}
            onClick={hide}
            dataTestId="data-observability-setup-hide"
          />
        </div>
      </div>

      <ol className="mt-5 divide-y divide-gray-100">
        {steps.map(
          (
            state: DataObservabilitySetupStepState,
            index: number,
          ): ReactElement => {
            const copy: SetupStepCopy =
              DATA_OBSERVABILITY_SETUP_COPY[state.step];

            return (
              <li
                key={state.step}
                data-testid={`data-observability-setup-step-${state.step}`}
                data-done={state.isDone ? "true" : "false"}
                className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-4"
              >
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <div
                    className={
                      state.isDone
                        ? "mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-emerald-500 text-xs font-semibold text-white"
                        : "mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border border-gray-300 text-xs font-semibold text-gray-500"
                    }
                    aria-hidden="true"
                  >
                    {state.isDone ? (
                      <Icon icon={IconProp.Check} className="h-3.5 w-3.5" />
                    ) : (
                      <>{translator.formatNumber(index + 1)}</>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p
                      className={
                        state.isDone
                          ? "text-sm font-medium text-gray-500"
                          : "text-sm font-medium text-gray-900"
                      }
                    >
                      {translator.translateText(copy.title)}
                      <span className="sr-only">
                        {" "}
                        {state.isDone
                          ? translator.translateText("(done)")
                          : translator.translateText("(to do)")}
                      </span>
                    </p>
                    {state.isDone ? (
                      <></>
                    ) : (
                      <p className="mt-0.5 text-sm text-gray-600">
                        {translator.translateText(copy.description)}
                      </p>
                    )}
                  </div>
                </div>
                {state.isDone ? (
                  <></>
                ) : (
                  <AppLink
                    to={getSetupStepRoute(state.step, props.setup)}
                    className="ms-9 inline-flex flex-shrink-0 items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700 sm:ms-0"
                  >
                    <>
                      <span>{translator.translateText(copy.linkText)}</span>
                      <Icon
                        icon={IconProp.ChevronRight}
                        className="h-3.5 w-3.5"
                      />
                    </>
                  </AppLink>
                )}
              </li>
            );
          },
        )}
      </ol>
    </section>
  );
};

export default OverviewSetupSteps;
