import CriteriaFilterUtil from "../../../Utils/Form/Monitor/CriteriaFilter";
import { CriteriaFilter } from "Common/Types/Monitor/CriteriaFilter";
import MonitorType from "Common/Types/Monitor/MonitorType";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  criteriaFilter: CriteriaFilter | undefined;
  // Whether a window is judged check by check depends on it.
  monitorType?: MonitorType | undefined;
}

/*
 * One filter of a criteria, summed up as one sentence in the reader's
 * language (CriteriaFilterUtil.translateFilterToText, #8350). Whether all
 * the filters must match or any one is said once, above the list (#8533).
 */
const CriteriaFilterElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  let text: string = "";

  if (props.criteriaFilter) {
    text = CriteriaFilterUtil.translateFilterToText(
      props.criteriaFilter,
      props.monitorType,
      translator,
    );
  }

  return (
    <div className="flex w-full -ml-3">
      <div className="flex">
        <div className="ml-1 flex-auto py-0.5 text-sm leading-5 text-gray-500">
          <span className="font-medium text-gray-900">{text}</span>{" "}
        </div>
      </div>
    </div>
  );
};

export default CriteriaFilterElement;
