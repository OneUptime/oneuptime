import LabelElement from "./Label";
import { useIsDetailValue } from "../Detail/DetailValueContext";
import { useIsTableCell } from "../Table/TableCellContext";
import TableEmptyValue from "../Table/TableEmptyValue";
import TableColumnListComponent from "../TableColumnList/TableColumnListComponent";
import LabelModel from "../../../Models/DatabaseModels/Label";
import useTranslateValue from "../../Utils/Translation";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

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

/*
 * A table row's labels: the first two side by side on the row's 24px line,
 * and a "+N" for the rest that shows them all when it is pressed - the way
 * GitHub and Linear show a row's labels. They used to stack one per line
 * (the first three and "N more labels"), which made every labelled row of a
 * list three lines tall; and a row with none said "No labels attached." -
 * now a quiet dash (TableEmptyValue), the words kept for a screen reader.
 */
export const TABLE_LABELS_VISIBLE_COUNT: number = 2;

/*
 * On one line: a cell is as narrow as its widest piece when the table is
 * wider than the card, and two pills that wrapped there made the row two
 * lines tall. "Show all" lets them wrap (TABLE_LABELS_EXPANDED_CLASS_NAME).
 */
export const TABLE_LABELS_CLASS_NAME: string =
  "flex min-h-6 flex-nowrap items-center gap-1.5";

export const TABLE_LABELS_EXPANDED_CLASS_NAME: string =
  "flex min-h-6 flex-wrap items-center gap-1.5";

export const TABLE_LABELS_TEST_ID: string = "table-labels";

/*
 * The "+N" and "Show less" chips: as tall as a label's pill, quiet until
 * pointed at, and a real button the keyboard reaches.
 */
export const TABLE_LABELS_MORE_CLASS_NAME: string =
  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium leading-4 text-gray-600 ring-1 ring-inset ring-gray-200 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

const LabelsElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const translator: Translator = useTranslator();
  const isDetailValue: boolean = useIsDetailValue();
  const isTableCell: boolean = useIsTableCell();
  /*
   * Every hook runs before the returns below: a table reuses a row's cell
   * for whatever row lands in its place, so the same element goes from some
   * labels to none and back.
   */
  const [isShowingAll, setIsShowingAll] = useState<boolean>(false);
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

  if (isTableCell && !isDetailValue) {
    if (props.labels.length === 0) {
      return <TableEmptyValue screenReaderText={noItemsMessage} />;
    }

    const visibleLabels: Array<LabelModel> = isShowingAll
      ? props.labels
      : props.labels.slice(0, TABLE_LABELS_VISIBLE_COUNT);

    const hiddenLabels: Array<LabelModel> = props.labels.slice(
      visibleLabels.length,
    );

    return (
      <div
        className={
          isShowingAll
            ? TABLE_LABELS_EXPANDED_CLASS_NAME
            : TABLE_LABELS_CLASS_NAME
        }
        data-testid={TABLE_LABELS_TEST_ID}
      >
        {visibleLabels.map((label: LabelModel, index: number) => {
          return (
            <LabelElement
              key={label.id?.toString() || String(index)}
              label={label}
            />
          );
        })}
        {hiddenLabels.length > 0 ? (
          <button
            type="button"
            data-testid="table-labels-more"
            className={TABLE_LABELS_MORE_CLASS_NAME}
            title={hiddenLabels
              .map((label: LabelModel) => {
                return label.name || label.slug || "";
              })
              .filter(Boolean)
              .join(", ")}
            aria-label={translator.translatePlural(
              {
                one: "Show {{count}} more label",
                other: "Show {{count}} more labels",
              },
              hiddenLabels.length,
            )}
            onClick={() => {
              setIsShowingAll(true);
            }}
          >
            +{translator.formatNumber(hiddenLabels.length)}
          </button>
        ) : (
          <></>
        )}
        {isShowingAll && props.labels.length > TABLE_LABELS_VISIBLE_COUNT ? (
          <button
            type="button"
            data-testid="table-labels-less"
            className={TABLE_LABELS_MORE_CLASS_NAME}
            onClick={() => {
              setIsShowingAll(false);
            }}
          >
            {translateString("Show less") || "Show less"}
          </button>
        ) : (
          <></>
        )}
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
