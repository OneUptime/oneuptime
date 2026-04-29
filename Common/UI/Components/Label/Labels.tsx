import LabelElement from "./Label";
import TableColumnListComponent from "../TableColumnList/TableColumnListComponent";
import LabelModel from "../../../Models/DatabaseModels/Label";
import useTranslateValue from "../../Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  labels: Array<LabelModel>;
}

const LabelsElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const moreText: string =
    props.labels.length > 4
      ? translateString("more labels") || "more labels"
      : translateString("more label") || "more label";
  const noItemsMessage: string =
    translateString("No labels attached.") || "No labels attached.";
  return (
    <TableColumnListComponent
      items={props.labels}
      moreText={moreText}
      className={props.labels.length > 0 ? "-mb-1 -mt-1" : ""}
      getEachElement={(label: LabelModel) => {
        return (
          <div className={props.labels.length > 0 ? "my-2" : ""}>
            <LabelElement
              label={label}
              style={{
                marginRight: "5px",
              }}
            />
          </div>
        );
      }}
      noItemsMessage={noItemsMessage}
    />
  );
};

export default LabelsElement;
