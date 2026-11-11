import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedLine from "Common/UI/Components/IsolatedText/IsolatedLine";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A RECORD'S NAME IN ITS LINK, WITH ITS KIND'S ICON BESIDE IT.
 *
 * A record's link - a monitor, a host, a cluster, an SLO: MonitorElement
 * and its siblings - draws its name, and in a list of a row's resources
 * (AffectedResourcesCell) its kind's icon too. That icon and name used to
 * be one flex row with the name as bare text in it, which a table's cell
 * laid out as a line of text (TableLayout's
 * TABLE_CELL_INLINE_RECORD_LINK_CLASS_NAMES): a line of the page's, so on
 * an Arabic or Persian page an English name too long for its column was
 * cut at its start, the "..." on its left ("...lNodesInEuWest1" for "High
 * Node Memory Utilization on AllNodesInEuWest1"), and on a phone's card
 * its wrapped lines lined up on the right.
 *
 * With its icon, the name is a line of its own beside it (IsolatedLine):
 * read the way it is written, so an English name ends in "..." at its own
 * end where its box does, and its wrapped lines start at its own start.
 * The icon and the name are a flex row of the page's way (the icon at the
 * line's start, on the right of an Arabic page), set apart by a gap - a
 * margin on one side of the icon (mr-1) was on the far side of it there.
 *
 * A record with a mark of its own instead of a kind's icon - a service's
 * colour (ServiceElement's alignWithIcons) - draws it in an icon's room,
 * so the names of a row's resources start in one place.
 */

/*
 * The row: the icon, then the name's line, 8px apart - where a table's
 * cell drew the name after the icon's 4px margin and a space. A box set on
 * its holder's line (inline-flex), as the name's text was, at the line's
 * start - on the right of an Arabic page. It is as wide as the icon and
 * the name, and never wider than the line (max-w-full), where the name
 * cuts itself short. So the link around it is just as wide: its focus ring
 * hugs the icon and the name, and a click past a short name's end is still
 * the table row's, as it was. A flex row as a block would make the link,
 * an inline, run the line's whole width. min-w-0, so the row may be
 * narrower than the name in a flex box of its own too.
 */
export const RECORD_LINK_NAME_ROW_CLASS_NAME: string =
  "inline-flex max-w-full min-w-0 items-start gap-2";

/*
 * The icon, set on a line of its own as it was set on the name's line:
 * centred on the text (an inline box, align-middle), the line as tall as
 * the name's. So it stays beside the name's first line when the name
 * wraps, not halfway down a name of three lines.
 */
export const RECORD_LINK_ICON_CLASS_NAME: string =
  "inline-block h-5 w-5 align-middle";

/*
 * The room a record's own mark takes where a kind's icon would stand (a
 * service's colour): the icon's 20px square, set on its line as the icon
 * is (an inline box centred on the text), the mark in its middle. A
 * service's 12px colour drawn as it is elsewhere, its 8px gap after it,
 * put its name 8px before every other name in the list, and its link ran
 * the item's whole width: its focus ring was cut off at the column's edges
 * and a click past a short name's end opened the service, not the row.
 */
export const RECORD_LINK_MARK_CLASS_NAME: string =
  "inline-flex h-5 w-5 items-center justify-center align-middle";

/*
 * The name's line. Where the row's holder keeps it to one line (a table's
 * cell: TABLE_LIST_ITEM_CLASS_NAME's whitespace-nowrap), it shrinks with
 * the row, no wider than the line (min-w-0), and draws its own "..." at
 * its own end; where its holder lets it wrap (a phone's card:
 * TABLE_CARD_LIST_ITEM_CLASS_NAME), it wraps, breaking a name with no
 * place to break anywhere rather than run past the card. Not truncate:
 * that would cut a phone card's names to one line.
 * Said to wrap, a line that reads the other way from the page is as wide
 * as its words beside the icon (IsolatedLine's
 * CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME), never aligned to its
 * end, which would line up every wrapped line of an English name on the
 * right of an Arabic page.
 */
export const RECORD_LINK_NAME_LINE_CLASS_NAME: string =
  "min-w-0 overflow-hidden text-ellipsis [overflow-wrap:anywhere]";

// The name's line, for a page's tests (and the browser's) to find it by.
export const RECORD_LINK_NAME_TEST_ID: string = "record-link-name";

export interface ComponentProps {
  name: string | undefined;
  /*
   * The record kind's icon, drawn before the name. Left out (with no
   * mark), the name is drawn alone, exactly as it always was: a table's
   * cell lays that out as a line of text
   * (TABLE_CELL_INLINE_RECORD_LINK_CLASS_NAMES), and a list on a record's
   * own name reads its line from the record (ColumnLineText).
   */
  icon?: IconProp | undefined;
  /*
   * A mark of the record's own, drawn in the icon's room when there is no
   * icon (RECORD_LINK_MARK_CLASS_NAME): a service's colour.
   */
  mark?: ReactElement | undefined;
}

const RecordLinkName: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.icon === undefined && props.mark === undefined) {
    return <span className="flex"> {props.name}</span>;
  }

  return (
    <span className={RECORD_LINK_NAME_ROW_CLASS_NAME}>
      {props.icon !== undefined ? (
        <Icon icon={props.icon} className={RECORD_LINK_ICON_CLASS_NAME} />
      ) : (
        /*
         * A box of the row whose one line holds the mark's room, as the
         * icon's box holds its svg: the two sit at one height.
         */
        <span>
          <span className={RECORD_LINK_MARK_CLASS_NAME}>{props.mark}</span>
        </span>
      )}
      <IsolatedLine
        as="span"
        text={props.name || ""}
        className={RECORD_LINK_NAME_LINE_CLASS_NAME}
        dataTestId={RECORD_LINK_NAME_TEST_ID}
      />
    </span>
  );
};

export default RecordLinkName;
