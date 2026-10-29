import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  ReactNode,
} from "react";

/*
 * A ROW'S NAME, WITH WHAT IT IS UNDER IT - as a Security Events list reads:
 * a threat intel feed's name over its source ("TAXII collection"), a
 * security tool's over its provider and what it imports ("Google SecOps ·
 * Alerts only"), the way Send to your SIEM already names each SIEM over
 * what it is sent.
 *
 * One column where there were two. Beside the side menu at 1280 a list's
 * card is about 940px wide, and Threat Intel Feeds and Your security tools
 * ran past it with the source and the provider in columns of their own,
 * their last columns under the row's buttons (#5246). What a row is reads
 * where the eye already is.
 *
 * The column wraps (Column.wrapContent): a long name takes a second line
 * rather than an ellipsis, up to SECURITY_LIST_NAME_COLUMN_MAX_WIDTH, and
 * the column is never narrower than the table's floor for a column that
 * wraps (10rem). The line under it wraps between its parts, never inside
 * one ("Google SecOps ·" / "Alerts only").
 *
 * A row may lead with a mark (a security tool's product logo): it sits
 * before the name, and the name and the line under it keep one start
 * beside it.
 */

export const SECURITY_LIST_NAME_COLUMN_MAX_WIDTH_CLASS_NAME: string =
  "max-w-[16rem]";

// What the row is, under its name: smaller and quieter than the name.
export const SECURITY_LIST_NAME_DETAIL_CLASS_NAME: string =
  "block whitespace-normal text-xs font-normal leading-5 text-gray-500";

export interface ComponentProps {
  name: string;
  // Already in the reader's words; empty parts are left out.
  detailParts?: Array<string | undefined> | undefined;
  /*
   * The line under the name as an element of its own, in place of
   * detailParts: a link to what the line counts ("2 active exceptions",
   * opening them).
   */
  detail?: ReactNode | undefined;
  detailTestId?: string | undefined;
  // Drawn before the name, level with its first line: a product's logo.
  mark?: ReactNode | undefined;
}

const SecurityListNameCell: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const parts: Array<string> = (props.detailParts || []).filter(
    (part: string | undefined): part is string => {
      return Boolean(part && part.trim());
    },
  );

  const words: ReactElement = (
    <>
      {/*
       * A name someone gave reads the way it is written, as a table's own
       * text cells do (IsolatedText): an English one keeps its start and
       * its punctuation in place on a Persian page.
       */}
      <span className="block" data-testid="security-list-name">
        <IsolatedText text={props.name} />
      </span>
      {props.detail ? (
        <span
          className={SECURITY_LIST_NAME_DETAIL_CLASS_NAME}
          data-testid={props.detailTestId}
        >
          {props.detail}
        </span>
      ) : parts.length > 0 ? (
        <span
          className={SECURITY_LIST_NAME_DETAIL_CLASS_NAME}
          data-testid={props.detailTestId}
        >
          {parts.map((part: string, index: number): ReactElement => {
            const isLast: boolean = index === parts.length - 1;

            return (
              <Fragment key={index}>
                <span className="whitespace-nowrap">
                  {isLast ? part : `${part} ·`}
                </span>
                {isLast ? "" : " "}
              </Fragment>
            );
          })}
        </span>
      ) : (
        <></>
      )}
    </>
  );

  if (!props.mark) {
    return (
      <span className="block" data-testid="security-list-name-cell">
        {words}
      </span>
    );
  }

  return (
    <span
      className="flex items-start gap-2"
      data-testid="security-list-name-cell"
    >
      {props.mark}
      <span className="block min-w-0">{words}</span>
    </span>
  );
};

export default SecurityListNameCell;
