import LabelElement from "./Label";
import TableColumnListComponent from "CommonUI/src/Components/TableColumnList/TableColumnListComponent";
import Label from "Model/Models/Label";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  labels: Array<Label>;
}

const LabelsElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    // {/** >4 because 3 labels are shown by default and then the more text is shown */}
    <TableColumnListComponent
      items={props.labels}
      moreText={props.labels.length > 4 ? "more labels" : "more label"}
      className={props.labels.length > 0 ? "-mb-1 -mt-1" : ""}
      getEachElement={(label: Label) => {
        return (
          <div className={props.labels.length > 0 ? "my-2" : ""}>
            <LabelElement label={label} />
          </div>
        );
      }}
      noItemsMessage="No labels attached."
    />
  );
};

export default LabelsElement;
