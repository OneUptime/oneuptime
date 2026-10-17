import LabelElement from "./Label";
import { useIsDetailValue } from "../Detail/DetailValueContext";
import TableColumnListComponent from "../TableColumnList/TableColumnListComponent";
import LabelModel from "../../../Models/DatabaseModels/Label";
import useTranslateValue from "../../Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  labels: Array<LabelModel>;
}

/*
 * A detail card's labels: every one, side by side, wrapping onto the next
 * line when the column is full - the way a card draws any other list of
 * pills (a multi-select's choices, a list of related records). One pill per
 * line, the first three and "N more", is a table cell's way of keeping its
 * row short; under a field's name it made the row as tall as the labels
 * while the field beside it held one line, and hid labels behind a click on
 * the one page that is about the record.
 *
 * The first line is a value's 24px one (min-h-6), the pills centred on it,
 * so they sit level with the values beside them in the row.
 */
export const DETAIL_LABELS_CLASS_NAME: string =
  "flex min-h-6 flex-wrap items-center gap-1.5";

export const DETAIL_LABELS_TEST_ID: string = "detail-labels";

const LabelsElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const isDetailValue: boolean = useIsDetailValue();
  const moreText: string =
    props.labels.length > 4
      ? translateString("more labels") || "more labels"
      : translateString("more label") || "more label";
  const noItemsMessage: string =
    translateString("No labels attached.") || "No labels attached.";

  if (isDetailValue && props.labels.length > 0) {
    return (
      <div
        className={DETAIL_LABELS_CLASS_NAME}
        data-testid={DETAIL_LABELS_TEST_ID}
      >
        {props.labels.map((label: LabelModel, index: number) => {
          return (
            <LabelElement
              key={label.id?.toString() || String(index)}
              label={label}
            />
          );
        })}
      </div>
    );
  }

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
