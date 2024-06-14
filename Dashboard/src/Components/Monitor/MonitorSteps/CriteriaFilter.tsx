import CriteriaFilterUtil from "../../../Utils/Form/Monitor/CriteriaFilter";
import {
  CriteriaFilter,
  FilterCondition,
} from "Common/Types/Monitor/CriteriaFilter";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  criteriaFilter: CriteriaFilter | undefined;
  filterCondition?: FilterCondition | undefined;
}

const CriteriaFilterElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  let text: string = "";

  if (props.criteriaFilter) {
    text = CriteriaFilterUtil.translateFilterToText(
      props.criteriaFilter,
      props.filterCondition,
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
