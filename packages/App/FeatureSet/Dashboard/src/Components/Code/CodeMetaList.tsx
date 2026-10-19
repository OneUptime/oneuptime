import React, { Fragment, FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  // Each fact, keyed: "#12", "Asked by Ada Lovelace", "2 hours ago".
  items: Array<ReactElement>;
  // Drawn before the first fact, with no dot: a phone's state badge.
  leading?: ReactElement | undefined;
  className?: string | undefined;
  dataTestId?: string | undefined;
}

/*
 * A line of small facts about a task or a repository - "#12 · Asked by Ada
 * Lovelace · 2 hours ago · PR #418" - with a dot between them, so the facts
 * read apart rather than as one run-on sentence. Screen readers skip the
 * dots. Each fact stays whole: a narrow screen wraps the line between facts,
 * and a wrapped line starts with its dot.
 */
const CodeMetaList: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div
      data-testid={props.dataTestId}
      className={`flex flex-wrap items-center gap-x-1.5 gap-y-1 ${props.className || ""}`}
    >
      {props.leading || <></>}
      {props.items.map((item: ReactElement, index: number) => {
        return (
          <Fragment key={item.key || index}>
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              {index > 0 ? (
                <span
                  aria-hidden="true"
                  data-testid="code-meta-dot"
                  className="text-gray-300"
                >
                  ·
                </span>
              ) : (
                <></>
              )}
              {item}
            </span>
          </Fragment>
        );
      })}
    </div>
  );
};

export default CodeMetaList;
