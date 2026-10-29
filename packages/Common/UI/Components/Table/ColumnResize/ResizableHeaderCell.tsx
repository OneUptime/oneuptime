import ColumnResizeHandle from "./ColumnResizeHandle";
import ResetColumnWidthsButton from "./ResetColumnWidthsButton";
import {
  RESIZABLE_HEADER_RESET_CONTENT_CLASS_NAME,
  RESIZABLE_HEADER_RESET_END_CONTENT_CLASS_NAME,
  RESIZABLE_HEADER_RESET_END_ROW_CLASS_NAME,
  RESIZABLE_HEADER_RESET_ROW_CLASS_NAME,
  isEndAlignedHeaderCell,
} from "../TableLayout";
import {
  ColumnWidths,
  HeaderCellWidthStyle,
  getHeaderCellWidthStyle,
} from "./ColumnWidths";
import { useColumnWidthsValue } from "./ColumnWidthsStore";
import { ResizableHeaderCellResize } from "./useResizableColumns";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";

/*
 * A header cell of a table a page draws itself, with the edge a person
 * drags to size its column (ColumnResizeHandle) and the width they kept -
 * read for this column alone, so keeping a width draws this one cell
 * again. The row's last also draws Reset column widths beside its name -
 * after it, or before a name drawn at the column's end - while a column is
 * sized and the table's card has no ⋯ to keep it in (ResizableColumns'
 * resetColumnId). Without `resize` it is the <th> it always was.
 */

/*
 * Which column, named as the header shows it (its edge is named after it),
 * and how its values may be cut short - what ResizableColumns' getResize
 * hands over.
 */
export type ColumnResize = ResizableHeaderCellResize;

export interface ComponentProps
  extends React.ThHTMLAttributes<HTMLTableCellElement> {
  resize?: ColumnResize | undefined;
  children?: ReactNode;
}

// No width kept: -1, a number, so the cell reads a primitive.
const NO_WIDTH: number = -1;

const ResizableHeaderCellWithEdge: FunctionComponent<
  ComponentProps & { resize: ColumnResize }
> = (props: ComponentProps & { resize: ColumnResize }): ReactElement => {
  const { resize, children, className, style, ...rest } = props;
  const columnId: string = resize.columnId;

  const keptWidth: number = useColumnWidthsValue(
    resize.columns.columnWidths.store,
    (widths: ColumnWidths): number => {
      return widths[columnId] ?? NO_WIDTH;
    },
  );

  const widthStyle: HeaderCellWidthStyle | undefined =
    keptWidth === NO_WIDTH
      ? undefined
      : getHeaderCellWidthStyle(keptWidth, resize.kind);

  const isResetHere: boolean = resize.columns.resetColumnId === columnId;

  const reset: ReactElement = (
    <ResetColumnWidthsButton
      onClick={() => {
        resize.columns.columnWidths.resetColumnWidths();
      }}
    />
  );

  /*
   * The reset beside the row's last name: after it, or - a name drawn at
   * its column's end, over numbers - before it, so the name stays over
   * its values (TableLayout's RESIZABLE_HEADER_RESET_END_ROW_CLASS_NAME).
   */
  const content: ReactNode = !isResetHere ? (
    children
  ) : isEndAlignedHeaderCell(className) ? (
    <div className={RESIZABLE_HEADER_RESET_END_ROW_CLASS_NAME}>
      {reset}
      <div className={RESIZABLE_HEADER_RESET_END_CONTENT_CLASS_NAME}>
        {children}
      </div>
    </div>
  ) : (
    <div className={RESIZABLE_HEADER_RESET_ROW_CLASS_NAME}>
      <div className={RESIZABLE_HEADER_RESET_CONTENT_CLASS_NAME}>
        {children}
      </div>
      {reset}
    </div>
  );

  return (
    <th
      {...rest}
      /*
       * Named by its title alone: the edge inside it has a name of its own
       * ("Resize the Time column"), which the column's would take on.
       */
      aria-label={rest["aria-label"] || resize.columnTitle}
      data-column-id={columnId}
      className={[className, "relative"].filter(Boolean).join(" ")}
      style={{ ...(style || {}), ...(widthStyle || {}) }}
    >
      {content}
      <ColumnResizeHandle
        columnId={columnId}
        columnTitle={resize.columnTitle}
        kind={resize.kind}
        width={keptWidth === NO_WIDTH ? undefined : keptWidth}
        onWidthChange={(id: string, width: number | null) => {
          resize.columns.columnWidths.setColumnWidth(id, width);
        }}
        onResizeStart={resize.columns.onResizeStart}
        onResizeEnd={resize.columns.onResizeEnd}
      />
    </th>
  );
};

const ResizableHeaderCell: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.resize) {
    return (
      <ResizableHeaderCellWithEdge
        {...props}
        resize={props.resize as ColumnResize}
      />
    );
  }

  const cellProps: ComponentProps = { ...props };

  delete cellProps.resize;

  return <th {...cellProps} />;
};

export default ResizableHeaderCell;
