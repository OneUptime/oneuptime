import React, { FunctionComponent, ReactElement } from "react";
import Icon, { ThickProp } from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  HOST_COLLECTOR_CONFIG_ORDER_STEPS,
  HOST_COLLECTOR_CONFIG_ORDER_TITLE,
  HostCollectorConfigOrderStep,
} from "./HostCollectorConfigFleet";

/*
 * How a host gets its config, in three steps across the top of the
 * Collector Configs list: a config picked for the host, else the first
 * config of the list that applies to it, else OneUptime's default for its
 * system - the order the server tries them in. Read left to right on a
 * laptop, top to bottom on a phone.
 *
 * It sits in the list's card, above its rows: the list it explains. An
 * empty list leaves it out, as it does every other part of its top: with
 * no config, every host runs OneUptime's default, as the empty list says.
 */

const HostCollectorConfigOrder: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <section
      /*
       * A panel of its own between the card's description and the rows,
       * set in like the description: the rows below run edge to edge.
       */
      className="mb-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-4 sm:px-5"
      aria-labelledby="host-collector-config-order-title"
      data-testid="host-collector-config-order"
    >
      <h3
        id="host-collector-config-order-title"
        className="text-xs font-semibold uppercase tracking-wide text-gray-500"
      >
        {translator.translateText(HOST_COLLECTOR_CONFIG_ORDER_TITLE)}
      </h3>
      <ol className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3 md:gap-4">
        {HOST_COLLECTOR_CONFIG_ORDER_STEPS.map(
          (step: HostCollectorConfigOrderStep, index: number): ReactElement => {
            const isLast: boolean =
              index === HOST_COLLECTOR_CONFIG_ORDER_STEPS.length - 1;

            return (
              <li
                key={step.reason}
                className="relative flex min-w-0 items-start gap-3"
                data-testid={`host-collector-config-order-step-${index + 1}`}
                data-reason={step.reason}
              >
                <span
                  aria-hidden="true"
                  className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700"
                >
                  {translator.formatNumber(index + 1)}
                </span>
                <div className="min-w-0 flex-1 md:pr-5">
                  <p className="text-sm font-medium text-gray-900">
                    {translator.translateText(step.title)}
                  </p>
                  <p className="mt-0.5 text-sm text-gray-500">
                    {translator.translateText(step.description)}
                  </p>
                </div>
                {!isLast ? (
                  /*
                   * "Else": the next step is tried only when this one
                   * gives the host no config. On a phone the numbers say
                   * the order on their own. Right to left, the chevron
                   * and its side turn round by themselves (Icon,
                   * TailwindReadingDirection).
                   */
                  <span
                    aria-hidden="true"
                    className="absolute right-0 top-1 max-md:hidden text-gray-300 md:block"
                    data-testid="host-collector-config-order-then"
                  >
                    <Icon
                      icon={IconProp.ChevronRight}
                      thick={ThickProp.Thick}
                      className="h-4 w-4"
                    />
                  </span>
                ) : (
                  <></>
                )}
              </li>
            );
          },
        )}
      </ol>
    </section>
  );
};

export default HostCollectorConfigOrder;
