import React, { FunctionComponent, ReactElement } from "react";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import { Red } from "Common/Types/BrandColors";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  FAILED_COUNT_TEMPLATE,
  HOST_COUNT_TEMPLATE,
  HostCollectorHostCount as HostCount,
} from "./HostCollectorConfigFleet";

/*
 * How many hosts run a config - "2 hosts" - with a red "1 failed" beside it
 * when the config did not start on some of them: the Collector Configs
 * list's Hosts column and a config's own page. A config no host runs says
 * "0 hosts", quietly; a count not read yet is a dash.
 */

export interface ComponentProps {
  count: HostCount | undefined;
  dataTestId: string;
}

const HostCollectorHostCount: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (!props.count) {
    return (
      <span
        className="text-sm text-gray-400"
        data-testid={`${props.dataTestId}-unknown`}
      >
        —
      </span>
    );
  }

  return (
    <span
      className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 align-middle"
      data-testid={props.dataTestId}
      data-hosts={props.count.hosts}
      data-failed={props.count.failed}
    >
      <span
        className={
          props.count.hosts > 0
            ? "text-sm text-gray-700"
            : "text-sm text-gray-500"
        }
      >
        {translator.translatePlural(HOST_COUNT_TEMPLATE, props.count.hosts)}
      </span>
      {props.count.failed > 0 ? (
        <span
          className="inline-flex"
          data-testid={`${props.dataTestId}-failed`}
        >
          <Pill
            text={translator.translatePlural(
              FAILED_COUNT_TEMPLATE,
              props.count.failed,
            )}
            color={Red}
            size={PillSize.Small}
          />
        </span>
      ) : (
        <></>
      )}
    </span>
  );
};

export default HostCollectorHostCount;
