import {
  BY_SERVICE,
  BY_SERVICE_DESCRIPTION,
  BY_SERVICE_TITLE,
  COUNT_HEADING,
  LAST_CHANGED_HEADING,
  NO_SERVICE,
  NO_VALUES_CHANGED,
  NO_VERSION,
  SERVICE_HEADING,
  SERVICE_NOT_NAMED,
  VALUES_NOT_COUNTED,
  VERSION_HEADING,
} from "./ScrubRuleCountWords";
import OneUptimeDate from "Common/Types/Date";
import {
  ScrubRuleValueCountOfRule,
  ScrubRuleValueCountOfService,
} from "Common/Types/Telemetry/ScrubRuleValueCounts";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

export interface ComponentProps {
  ruleName: string;
  // Undefined until the counts were read; false when they could not be.
  isChecked: boolean | undefined;
  count: ScrubRuleValueCountOfRule | undefined;
  dataTestId?: string | undefined;
}

function whenOf(value: string): string {
  if (!value) {
    return "";
  }

  const date: Date = new Date(value);

  return Number.isNaN(date.getTime())
    ? ""
    : OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(date);
}

/*
 * HOW MANY VALUES A SCRUB RULE CHANGED IN THE LAST WEEK, IN ITS ROW
 * (#10366) - and, opened, which services and versions they came from. A
 * version that no longer sends what the rule hides changes nothing more,
 * which is how a leak fixed at its source shows here.
 */
const ScrubRuleValueCountCell: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isOpen, setIsOpen] = useState<boolean>(false);

  if (props.isChecked === undefined) {
    return <span className="text-sm text-gray-400">-</span>;
  }

  if (props.isChecked === false) {
    return (
      <span className="text-sm text-gray-500">
        {translator.translateText(VALUES_NOT_COUNTED)}
      </span>
    );
  }

  if (!props.count || props.count.valueCount === 0) {
    return (
      <span className="text-sm text-gray-500" data-testid={props.dataTestId}>
        {translator.translateText(NO_VALUES_CHANGED)}
      </span>
    );
  }

  const count: ScrubRuleValueCountOfRule = props.count;

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-testid={props.dataTestId}
    >
      <span className="text-sm font-medium text-gray-900 tabular-nums">
        {count.valueCount.toLocaleString()}
      </span>
      <Button
        title={BY_SERVICE}
        buttonStyle={ButtonStyleType.NORMAL}
        buttonSize={ButtonSize.Small}
        onClick={() => {
          setIsOpen(true);
        }}
      />
      {isOpen ? (
        <Modal
          title={translator.translateTemplate(BY_SERVICE_TITLE, {
            rule: props.ruleName,
          })}
          isTitleTranslated={true}
          description={BY_SERVICE_DESCRIPTION}
          modalWidth={ModalWidth.Large}
          onClose={() => {
            setIsOpen(false);
          }}
        >
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-start text-gray-500">
                  <th className="py-2 pe-4 text-start font-medium">
                    {translator.translateText(SERVICE_HEADING)}
                  </th>
                  <th className="py-2 pe-4 text-start font-medium">
                    {translator.translateText(VERSION_HEADING)}
                  </th>
                  <th className="py-2 pe-4 text-end font-medium">
                    {translator.translateText(COUNT_HEADING)}
                  </th>
                  <th className="py-2 text-start font-medium">
                    {translator.translateText(LAST_CHANGED_HEADING)}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {count.services.map(
                  (
                    service: ScrubRuleValueCountOfService,
                    index: number,
                  ): ReactElement => {
                    return (
                      <tr key={`${service.serviceId}-${service.serviceVersion}-${index}`}>
                        <td className="py-2 pe-4 text-gray-900 break-all">
                          {service.serviceName ||
                            translator.translateText(
                              service.serviceId
                                ? SERVICE_NOT_NAMED
                                : NO_SERVICE,
                            )}
                        </td>
                        <td className="py-2 pe-4 text-gray-700 break-all">
                          {service.serviceVersion ||
                            translator.translateText(NO_VERSION)}
                        </td>
                        <td className="py-2 pe-4 text-end tabular-nums text-gray-900">
                          {service.valueCount.toLocaleString()}
                        </td>
                        <td className="py-2 text-gray-700">
                          {whenOf(service.lastChangedAt)}
                        </td>
                      </tr>
                    );
                  },
                )}
              </tbody>
            </table>
          </div>
        </Modal>
      ) : (
        <></>
      )}
    </div>
  );
};

export default ScrubRuleValueCountCell;
