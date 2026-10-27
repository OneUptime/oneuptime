import LabelElement from "./Label";
import { useIsDetailValue } from "../Detail/DetailValueContext";
import { useIsTableCard, useIsTableCell } from "../Table/TableCellContext";
import TableEmptyValue from "../Table/TableEmptyValue";
import TableColumnListComponent from "../TableColumnList/TableColumnListComponent";
import LabelModel from "../../../Models/DatabaseModels/Label";
import { sortLabels } from "../../../Utils/LabelOrder";
import useTranslateValue from "../../Utils/Translation";
import { PluralTemplate } from "../../Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement, useMemo } from "react";

export interface ComponentProps {
  labels: Array<LabelModel>;
}

/*
 * A record's labels, wherever they are drawn - a table's row, a detail
 * card's field, a rule's details - in natural order by name
 * (Utils/LabelOrder): numbered labels first, by their numbers ("1.
 * Category", "2. SubCategory", ... "10. Owner"), then the others
 * alphabetically, case and accents aside. They used to come in the order
 * the database joined them, a different one on every row (OneUptime issue
 * #5183).
 */

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
 *
 * On the one page about the record a label is read whole: one longer than
 * the column runs onto a second line inside its pill (Pill's isWrapping)
 * rather than end in "..." - on a phone nothing points to show the rest.
 */
export const DETAIL_LABELS_CLASS_NAME: string =
  "flex min-h-6 flex-wrap items-center gap-1.5";

export const DETAIL_LABELS_TEST_ID: string = "detail-labels";

/*
 * A table row's labels: one under another, as the row's Affected Resources
 * are listed - the first three, and "N more labels" for the rest (never for
 * one: a fourth label is shown, TableColumnListComponent), "Show less" to
 * fold them again.
 *
 * "Can you please show labels in a vertical view instead of a horizontal
 * view, just like we do for affected resources on an incident table?" - the
 * maintainer, on OneUptime issue #5187: side by side on the row's one line,
 * "2.SubCategory=Website", "3.Item=Connectivity" and
 * "4.Business System=Customer Mobile App" ran into each other and past the
 * column's edge, the second one cut off mid-word and the rest out of sight.
 * One to a line, each label has the column's whole width: as wide as the
 * longest label up to the 20rem a value may take, and only a label longer
 * than that ends in "...", its whole name under the pointer.
 *
 * A block, the lines four pixels apart (space-y-1), not a flex column: an
 * item of a column laid out to its start is as wide as its whole label,
 * wider than the column, and a long label was clipped at the column's edge
 * with no "..." at all. As blocks, each line is the column's width and a
 * pill as wide as that at most (Pill's max-w-full), its words cut short.
 */
export const TABLE_LABELS_CLASS_NAME: string = "space-y-1";

/*
 * Each label on a 24px line of its own, the pill centred on it: the first
 * sits level with the values in the cells beside it, and the four pixels
 * between two lines keep two pills from touching.
 */
export const TABLE_LABEL_LINE_CLASS_NAME: string = "flex min-h-6 items-center";

export const TABLE_LABELS_TEST_ID: string = "table-labels";

/*
 * What the fold says: "2 more labels", a sentence of its own in the
 * reader's language and plural forms ("Ещё меток: 5", "ほか 2 件のラベル",
 * "2 weitere Beschriftungen"). The count and "more labels" looked up on
 * their own read "2 ещё меток" and "2 他のラベル".
 */
export const TABLE_LABELS_MORE_TEMPLATE: PluralTemplate = {
  one: "{{count}} more label",
  other: "{{count}} more labels",
};

const LabelsElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const isDetailValue: boolean = useIsDetailValue();
  const isTableCell: boolean = useIsTableCell();
  const isTableCard: boolean = useIsTableCard();

  /*
   * Every hook runs before the returns below: a table reuses a row's cell
   * for whatever row lands in its place, so the same element goes from some
   * labels to none and back.
   */
  const labels: Array<LabelModel> = useMemo((): Array<LabelModel> => {
    return sortLabels<LabelModel>(props.labels);
  }, [props.labels]);

  const noItemsMessage: string =
    translateString("No labels attached.") || "No labels attached.";

  if (isDetailValue && labels.length > 0) {
    return (
      <div
        className={DETAIL_LABELS_CLASS_NAME}
        data-testid={DETAIL_LABELS_TEST_ID}
      >
        {labels.map((label: LabelModel, index: number) => {
          return (
            <LabelElement
              key={label.id?.toString() || String(index)}
              label={label}
              isWrapping={true}
            />
          );
        })}
      </div>
    );
  }

  if (isTableCell && !isDetailValue) {
    /*
     * None: a quiet dash, the column's words kept for a screen reader -
     * "No labels attached." on every row of a list was the loudest thing in
     * rows with nothing to say.
     */
    if (labels.length === 0) {
      return <TableEmptyValue screenReaderText={noItemsMessage} />;
    }

    return (
      <TableColumnListComponent<LabelModel>
        items={labels}
        moreTemplate={TABLE_LABELS_MORE_TEMPLATE}
        noItemsMessage={noItemsMessage}
        className={TABLE_LABELS_CLASS_NAME}
        dataTestId={TABLE_LABELS_TEST_ID}
        getEachElement={(label: LabelModel): ReactElement => {
          /*
           * On a phone a row is a card, and nothing points to show a
           * label's whole name: a long one runs onto a next line inside its
           * pill (Pill's isWrapping) rather than end in "...".
           */
          return (
            <div className={TABLE_LABEL_LINE_CLASS_NAME}>
              <LabelElement label={label} isWrapping={isTableCard} />
            </div>
          );
        }}
      />
    );
  }

  return (
    <TableColumnListComponent<LabelModel>
      items={labels}
      moreTemplate={TABLE_LABELS_MORE_TEMPLATE}
      className={labels.length > 0 ? "-mb-1 -mt-1" : ""}
      getEachElement={(label: LabelModel) => {
        return (
          <div className={labels.length > 0 ? "my-2" : ""}>
            <LabelElement
              label={label}
              style={{
                marginInlineEnd: "5px",
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
