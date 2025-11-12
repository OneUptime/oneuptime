import LabelElement from "./Label";
import TableColumnListComponent from "../TableColumnList/TableColumnListComponent";
import LabelModel from "../../../Models/DatabaseModels/Label";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  labels: Array<LabelModel>;
}

const LabelsElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <TableColumnListComponent
      items={props.labels}
      moreText={props.labels.length > 4 ? "more labels" : "more label"}
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
      noItemsMessage="No labels attached."
    />
  );
};

export default LabelsElement;
