import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  // Each fact, keyed: "#12", "Asked by Ada Lovelace", "2 hours ago".
  items: Array<ReactElement>;
  /*
   * Drawn before the first fact, with no dot: a phone's state badge. It
   * keeps the list's gap itself (ml-3, see below), so one shown only on a
   * phone leaves no space where it is hidden.
   */
  leading?: ReactElement | undefined;
  className?: string | undefined;
  dataTestId?: string | undefined;
}

/*
 * A line of small facts about a task or a repository - "#12 · Asked by Ada
 * Lovelace · 2 hours ago · PR #418" - with a dot between them, so the facts
 * read apart rather than as one run-on sentence. Screen readers skip the
 * dots. Each fact stays whole: a narrow screen wraps the line between facts.
 *
 * The dot sits in the gap before each fact but the first. The list is pulled
 * left by one gap inside a box that clips, so a fact that starts a line -
 * the first, or one a narrow screen wrapped - has its dot clipped away, and
 * no line starts or ends with a dot.
 */
const CodeMetaList: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div
      data-testid={props.dataTestId}
      className={`min-w-0 overflow-hidden ${props.className || ""}`}
    >
      <div className="-ml-3 flex flex-wrap items-center gap-y-1">
        {props.leading || <></>}
        {props.items.map((item: ReactElement, index: number) => {
          return (
            <span
              key={item.key || index}
              className="relative ml-3 inline-flex items-center whitespace-nowrap"
            >
              {index > 0 ? (
                <span
                  aria-hidden="true"
                  data-testid="code-meta-dot"
                  className="absolute -left-2 text-gray-300"
                >
                  ·
                </span>
              ) : (
                <></>
              )}
              {item}
            </span>
          );
        })}
      </div>
    </div>
  );
};

export default CodeMetaList;
