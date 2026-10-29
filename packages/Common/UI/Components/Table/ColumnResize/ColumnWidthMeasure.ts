import {
  COLUMN_WIDTHS_SCOPE_ATTRIBUTE,
  ColumnContentWidths,
  ColumnWidthKind,
  HeaderCellWidthStyle,
  getHeaderCellWidthStyle,
  getSizedColumnsCss,
} from "./ColumnWidths";

/*
 * What a column's header and values take on the page, read once as a
 * person starts to size it (ColumnResizeHandle) - never while they drag.
 * Its floor and its fit-to-content width come from these
 * (ColumnWidths' getColumnWidthFloor / getColumnFitWidth).
 *
 * Every value is read as wide as it is whole, on one line - not as wide as
 * its column is now: a value cut short by its column, or set free to use a
 * table's room (useTableScrollState), would otherwise read as wide as the
 * column, and a column could never fit what it holds. So each is given
 * `width: max-content` for the reading (as useTableScrollState's
 * getNamesWiderThanFloor reads a row's name), all of them first and then
 * read, so the page is laid out once, and given back its own style after.
 *
 * React-free on purpose, like ColumnWidths.
 */

/*
 * What the edge a person drags carries, so the reading leaves it out of
 * its header's content: it is drawn over the header's end, in no line.
 */
export const COLUMN_RESIZE_HANDLE_ATTRIBUTE: string =
  "data-column-resize-handle";

/*
 * Rows a reading leaves out: the placeholders a table draws while its
 * first page loads (TableSkeletonRows) say nothing of its values.
 */
export const COLUMN_MEASURE_SKIP_ATTRIBUTE: string = "data-column-measure-skip";

/*
 * The most rows a reading looks at: a page of 100, as many as a table's
 * pages hold, and a list of hundreds drawn at once (a log's lines) is read
 * at its top - a press on an edge answers at once whatever the list's
 * length.
 */
export const COLUMN_MEASURE_MAX_ROWS: number = 100;

// The inline styles a reading sets, and gives back after.
const MEASURED_PROPERTIES: Array<string> = [
  "width",
  "min-width",
  "max-width",
  "white-space",
  "display",
  "contain",
];

interface SavedStyle {
  element: HTMLElement;
  values: Array<{ property: string; value: string; priority: string }>;
}

const saveStyle: (element: HTMLElement) => SavedStyle = (
  element: HTMLElement,
): SavedStyle => {
  return {
    element: element,
    values: MEASURED_PROPERTIES.map(
      (
        property: string,
      ): { property: string; value: string; priority: string } => {
        return {
          property: property,
          value: element.style.getPropertyValue(property),
          priority: element.style.getPropertyPriority(property),
        };
      },
    ),
  };
};

const restoreStyle: (saved: SavedStyle) => void = (saved: SavedStyle): void => {
  for (const entry of saved.values) {
    if (entry.value) {
      saved.element.style.setProperty(
        entry.property,
        entry.value,
        entry.priority,
      );
    } else {
      saved.element.style.removeProperty(entry.property);
    }
  }
};

const getComputedStyleOf: (element: Element) => CSSStyleDeclaration | null = (
  element: Element,
): CSSStyleDeclaration | null => {
  if (typeof window === "undefined" || !window.getComputedStyle) {
    return null;
  }

  return window.getComputedStyle(element);
};

const readPixels: (value: string | undefined) => number = (
  value: string | undefined,
): number => {
  const pixels: number = parseFloat(value || "");

  return Number.isFinite(pixels) ? pixels : 0;
};

// A cell's padding and border at its start and its end.
export const getHorizontalPadding: (element: Element) => number = (
  element: Element,
): number => {
  const style: CSSStyleDeclaration | null = getComputedStyleOf(element);

  if (!style) {
    return 0;
  }

  return (
    readPixels(style.paddingLeft) +
    readPixels(style.paddingRight) +
    readPixels(style.borderLeftWidth) +
    readPixels(style.borderRightWidth)
  );
};

/*
 * The element a cell draws its value or its name in: its one element, when
 * it has one and no words beside it (a table's cells, a header's sort
 * button). A cell of loose words, or of several parts, is read as a whole
 * (null).
 */
const getContentElement: (cell: Element) => HTMLElement | null = (
  cell: Element,
): HTMLElement | null => {
  const parts: Array<Element> = Array.from(cell.children).filter(
    (part: Element): boolean => {
      return !part.hasAttribute(COLUMN_RESIZE_HANDLE_ATTRIBUTE);
    },
  );

  const hasLooseWords: boolean = Array.from(cell.childNodes).some(
    (node: ChildNode): boolean => {
      return (
        node.nodeType === 3 /* Node.TEXT_NODE */ &&
        Boolean((node.textContent || "").trim())
      );
    },
  );

  if (parts.length === 1 && !hasLooseWords) {
    return parts[0] as HTMLElement;
  }

  return null;
};

// Whether a part is laid out in the line (a span), which takes no width.
const isInline: (element: HTMLElement) => boolean = (
  element: HTMLElement,
): boolean => {
  const style: CSSStyleDeclaration | null = getComputedStyleOf(element);

  return Boolean(style && style.display === "inline");
};

/*
 * Ready to be read as wide as it is whole: max-content, or min-content for
 * a header's least width, its words broken where they may be. A part laid
 * out in the line (a span) cannot take a width, so it is read as an
 * inline-block - which is read of every part before any is changed, so the
 * page's style is worked out once, not once a part.
 */
const prepareForReading: (
  element: HTMLElement,
  extent: "min-content" | "max-content",
  isInlinePart: boolean,
) => SavedStyle = (
  element: HTMLElement,
  extent: "min-content" | "max-content",
  isInlinePart: boolean,
): SavedStyle => {
  const saved: SavedStyle = saveStyle(element);

  if (isInlinePart) {
    element.style.setProperty("display", "inline-block");
  }

  element.style.setProperty("width", extent, "important");
  element.style.setProperty("min-width", "0", "important");
  element.style.setProperty("max-width", "none", "important");
  // A sized column's value box asks for no width (getSizedColumnsCss): read past it.
  element.style.setProperty("contain", "none", "important");
  element.style.setProperty(
    "white-space",
    extent === "min-content" ? "normal" : "nowrap",
    "important",
  );

  return saved;
};

/*
 * The words of a cell that has no one element to read (a hand-built table's
 * plain cell): their extent on one line. A range covers them even where
 * the cell cuts them off.
 */
const readLooseWordsWidth: (cell: HTMLElement) => number = (
  cell: HTMLElement,
): number => {
  if (typeof document === "undefined" || !document.createRange) {
    return 0;
  }

  const range: Range = document.createRange();

  range.selectNodeContents(cell);

  const rect: DOMRect | null =
    typeof range.getBoundingClientRect === "function"
      ? range.getBoundingClientRect()
      : null;

  return rect ? rect.width : 0;
};

export interface ColumnMeasurement extends ColumnContentWidths {
  // How wide the column is drawn now.
  currentWidth: number;
}

/*
 * The least the page draws a column at once it is sized: the rules of a
 * sized column written for it (getSizedColumnsCss, as its table will draw
 * it), its header cell given no width, and the table as wide as its
 * columns - so no room the table has to spare is read as the column's.
 * A third reading, after the two of what the column holds - and only where
 * it can say more than they do (needsLeastReading): it lays the whole
 * table out again, 60ms on a list of 200 rows.
 */
const readLeastDrawnWidth: (data: {
  headerCell: HTMLTableCellElement;
  table: HTMLTableElement;
  kind: ColumnWidthKind | undefined;
}) => number = (data: {
  headerCell: HTMLTableCellElement;
  table: HTMLTableElement;
  kind: ColumnWidthKind | undefined;
}): number => {
  const scope: string | null = data.table.getAttribute(
    COLUMN_WIDTHS_SCOPE_ATTRIBUTE,
  );

  if (!scope || typeof document === "undefined" || !document.head) {
    return 0;
  }

  const cellNumber: number = data.headerCell.cellIndex + 1;
  const rules: HTMLStyleElement = document.createElement("style");

  rules.textContent = getSizedColumnsCss({
    scope: scope,
    cellNumbers: [cellNumber],
    wholeCellNumbers: data.kind === ColumnWidthKind.Whole ? [cellNumber] : [],
  });
  document.head.appendChild(rules);

  const savedTable: SavedStyle = saveStyle(data.table);
  const savedHeader: SavedStyle = saveStyle(data.headerCell);

  data.table.style.setProperty("width", "max-content", "important");
  data.table.style.setProperty("min-width", "0", "important");
  data.table.style.setProperty("max-width", "none", "important");
  data.headerCell.style.setProperty("width", "0px", "important");
  data.headerCell.style.setProperty("min-width", "0px", "important");
  data.headerCell.style.setProperty("max-width", "0px", "important");

  const width: number = data.headerCell.getBoundingClientRect().width;

  restoreStyle(savedHeader);
  restoreStyle(savedTable);
  rules.remove();

  return width;
};

/*
 * Reads a column off the page: its header cell, and the cell at its place
 * in every row of its table's bodies (a row that spans the table - an
 * opened log line's details - is no row of its columns and is left out).
 */
/*
 * Whether a column's least drawn width can be more than its header's and
 * its kind's floors (getColumnWidthFloor): a value drawn in a box of its
 * own - the shared Table's every cell, most of a page's own - asks for no
 * width once its column is sized (getSizedColumnsCss), and a column kept
 * whole is never narrower than its widest value. What is left - words
 * loose in a cell, a link or a picture beside them - is read.
 */
const needsLeastReading: (data: {
  cells: ReadonlyArray<HTMLTableCellElement>;
  contents: ReadonlyArray<HTMLElement | null>;
  kind: ColumnWidthKind | undefined;
}) => boolean = (data: {
  cells: ReadonlyArray<HTMLTableCellElement>;
  contents: ReadonlyArray<HTMLElement | null>;
  kind: ColumnWidthKind | undefined;
}): boolean => {
  if (data.kind === ColumnWidthKind.Whole) {
    return false;
  }

  return data.cells.some(
    (cell: HTMLTableCellElement, index: number): boolean => {
      const content: HTMLElement | null = data.contents[index] || null;
      const isEmpty: boolean =
        cell.children.length === 0 && !(cell.textContent || "").trim();

      return !isEmpty && (!content || content.tagName !== "DIV");
    },
  );
};

export const measureTableColumn: (data: {
  headerCell: HTMLTableCellElement;
  maxRows?: number | undefined;
  // How its values may be cut short, for the least it is drawn at.
  kind?: ColumnWidthKind | undefined;
}) => ColumnMeasurement = (data: {
  headerCell: HTMLTableCellElement;
  maxRows?: number | undefined;
  kind?: ColumnWidthKind | undefined;
}): ColumnMeasurement => {
  const headerCell: HTMLTableCellElement = data.headerCell;
  const table: HTMLTableElement | null = headerCell.closest("table");
  const headerRow: HTMLTableRowElement | null =
    headerCell.parentElement as HTMLTableRowElement | null;
  const cellIndex: number = headerCell.cellIndex;
  const rowCellCount: number = headerRow?.cells?.length || 0;
  const maxRows: number = data.maxRows ?? COLUMN_MEASURE_MAX_ROWS;
  /*
   * Everything read off the page as it is before anything is changed, then
   * the reading in two passes - the header's least width, then the
   * header's and every value's whole width - so a press on an edge lays the
   * table out twice, however many rows it has.
   */
  const currentWidth: number = headerCell.getBoundingClientRect().width;

  // The header's own padding (a hand-built table pads its cells).
  const headerPadding: number = getHorizontalPadding(headerCell);
  const headerContent: HTMLElement | null = getContentElement(headerCell);

  // The values' cells, and what each draws its value in.
  const cells: Array<HTMLTableCellElement> = [];

  if (table && cellIndex >= 0) {
    for (const body of Array.from(table.tBodies)) {
      if (body.hasAttribute(COLUMN_MEASURE_SKIP_ATTRIBUTE)) {
        continue;
      }

      for (const row of Array.from(body.rows)) {
        if (cells.length >= maxRows) {
          break;
        }

        if (rowCellCount && row.cells.length !== rowCellCount) {
          continue;
        }

        const cell: HTMLTableCellElement | undefined = row.cells[cellIndex];

        if (cell) {
          cells.push(cell);
        }
      }
    }
  }

  const contents: Array<HTMLElement | null> = cells.map(getContentElement);
  const firstCell: HTMLTableCellElement | undefined = cells[0];
  const cellPaddingWidth: number = firstCell
    ? getHorizontalPadding(firstCell)
    : 0;
  const isHeaderContentInline: boolean = headerContent
    ? isInline(headerContent)
    : false;
  const isContentInline: Array<boolean> = contents.map(
    (content: HTMLElement | null): boolean => {
      return content ? isInline(content) : false;
    },
  );

  // The header at its least width, its words broken where they may be.
  let headerMinContentWidth: number = headerPadding;
  let headerMaxContentWidth: number = headerPadding;

  if (headerContent) {
    const saved: SavedStyle = prepareForReading(
      headerContent,
      "min-content",
      isHeaderContentInline,
    );

    headerMinContentWidth =
      headerContent.getBoundingClientRect().width + headerPadding;

    restoreStyle(saved);
  }

  // The header on one line and every value whole at once, then read.
  const savedStyles: Array<SavedStyle> = [];

  if (headerContent) {
    savedStyles.push(
      prepareForReading(headerContent, "max-content", isHeaderContentInline),
    );
  }

  contents.forEach((content: HTMLElement | null, index: number) => {
    if (content) {
      savedStyles.push(
        prepareForReading(
          content,
          "max-content",
          Boolean(isContentInline[index]),
        ),
      );
      return;
    }

    const cell: HTMLTableCellElement = cells[index] as HTMLTableCellElement;
    const saved: SavedStyle = saveStyle(cell);

    cell.style.setProperty("white-space", "nowrap", "important");
    savedStyles.push(saved);
  });

  if (headerContent) {
    headerMaxContentWidth =
      headerContent.getBoundingClientRect().width + headerPadding;
  } else {
    const looseWidth: number = readLooseWordsWidth(headerCell);

    headerMinContentWidth = looseWidth + headerPadding;
    headerMaxContentWidth = looseWidth + headerPadding;
  }

  let widestValueWidth: number = 0;

  contents.forEach((content: HTMLElement | null, index: number) => {
    const width: number = content
      ? content.getBoundingClientRect().width
      : readLooseWordsWidth(cells[index] as HTMLTableCellElement);

    widestValueWidth = Math.max(widestValueWidth, width);
  });

  savedStyles.forEach(restoreStyle);

  const leastDrawnWidth: number =
    table &&
    needsLeastReading({ cells: cells, contents: contents, kind: data.kind })
      ? readLeastDrawnWidth({
          headerCell: headerCell,
          table: table,
          kind: data.kind,
        })
      : 0;

  return {
    currentWidth: currentWidth,
    headerMinContentWidth: headerMinContentWidth,
    headerMaxContentWidth: headerMaxContentWidth,
    widestValueWidth: widestValueWidth,
    cellPaddingWidth: cellPaddingWidth,
    leastDrawnWidth: leastDrawnWidth,
  };
};

// The inline width a header cell carries now, kept to put back after a drag.
export interface SavedHeaderCellWidth {
  width: string;
  minWidth: string;
  maxWidth: string;
}

export const readHeaderCellWidth: (
  headerCell: HTMLElement,
) => SavedHeaderCellWidth = (headerCell: HTMLElement): SavedHeaderCellWidth => {
  return {
    width: headerCell.style.width,
    minWidth: headerCell.style.minWidth,
    maxWidth: headerCell.style.maxWidth,
  };
};

export const restoreHeaderCellWidth: (
  headerCell: HTMLElement,
  saved: SavedHeaderCellWidth,
) => void = (headerCell: HTMLElement, saved: SavedHeaderCellWidth): void => {
  headerCell.style.width = saved.width;
  headerCell.style.minWidth = saved.minWidth;
  headerCell.style.maxWidth = saved.maxWidth;
};

/*
 * A width written straight onto a header cell while its edge is dragged:
 * one element per frame, whatever the table's rows hold
 * (getHeaderCellWidthStyle). React draws the same width from the
 * remembered ones once the drag ends.
 */
export const writeHeaderCellWidth: (
  headerCell: HTMLElement,
  width: number,
  kind: ColumnWidthKind,
) => void = (
  headerCell: HTMLElement,
  width: number,
  kind: ColumnWidthKind,
): void => {
  const style: HeaderCellWidthStyle = getHeaderCellWidthStyle(width, kind);

  headerCell.style.width = style.width;
  headerCell.style.minWidth = style.minWidth;
  headerCell.style.maxWidth = style.maxWidth || "";
};
