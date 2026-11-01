import React, { FunctionComponent, ReactElement, ReactNode } from "react";

/*
 * A line of short facts about an app, a dot between two: "AWS ECS / Fargate
 * · us-east-1 · cluster production", "Revision 43 · Deployed 25 minutes ago
 * · Replaced 42".
 *
 * Each fact is kept whole: the line wraps between facts, never inside one -
 * a region such as us-east-1 never breaks at its hyphen, "Deployed 25
 * minutes ago" never leaves "ago" alone - unless a fact is longer than the
 * whole line, which then wraps inside it. And no dot is left hanging: the
 * line used to be the facts joined with " · ", so a header squeezed beside
 * its controls read "Revision 43 ·" over "Deployed 25 minutes ago ·" over
 * "Replaced 42" (#5511's UI review). Each fact brings its dot in the padding
 * at its start, and the row is moved back by as much inside a clip, so the
 * fact a line starts with shows none - as Data Security's store names do
 * (StoreNameCell). The sides are the reading direction's (ps, -ms, start),
 * so a Persian page's dots sit between its facts too.
 *
 * The dot is text, not a drawn ::before: copied, read aloud or read by a
 * test, the line is "AWS ECS · us-east-1 · cluster production", as it was
 * when the facts were joined, never "AWS ECSus-east-1".
 */

export const CLOUD_APP_FACTS_ROW_CLASS_NAME: string = "-ms-3 flex flex-wrap";

export const CLOUD_APP_FACT_CLASS_NAME: string =
  "relative min-w-0 max-w-full ps-3 [overflow-wrap:anywhere]";

/*
 * The dot before a fact, centred in its padding, in one quiet colour
 * whatever the fact's own: an amber "Rolled back" keeps a grey dot.
 */
export const CLOUD_APP_FACT_SEPARATOR_CLASS_NAME: string =
  "absolute start-0 top-0 w-3 text-center font-normal text-gray-400";

export interface CloudAppFact {
  // Tells the facts apart; also the fact's test id suffix.
  key: string;
  content: ReactNode;
  // Extra classes for this fact alone: a colour, a font.
  className?: string | undefined;
  // The whole value, when the fact shows less of it.
  title?: string | undefined;
}

export interface ComponentProps {
  facts: Array<CloudAppFact>;
  className?: string | undefined;
  dataTestId?: string | undefined;
}

const CloudAppFacts: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.facts.length === 0) {
    return <></>;
  }

  return (
    <div
      className={`overflow-hidden ${props.className || ""}`}
      data-testid={props.dataTestId}
    >
      <div className={CLOUD_APP_FACTS_ROW_CLASS_NAME}>
        {props.facts.map((fact: CloudAppFact, index: number): ReactElement => {
          return (
            <span
              key={fact.key}
              className={`${CLOUD_APP_FACT_CLASS_NAME} ${fact.className || ""}`}
              title={fact.title}
              data-testid={`cloud-app-fact-${fact.key}`}
            >
              {index > 0 ? (
                <span
                  className={CLOUD_APP_FACT_SEPARATOR_CLASS_NAME}
                  data-testid="cloud-app-fact-separator"
                >
                  {" · "}
                </span>
              ) : (
                <></>
              )}
              <bdi>{fact.content}</bdi>
            </span>
          );
        })}
      </div>
    </div>
  );
};

export default CloudAppFacts;
