import React, { FunctionComponent, ReactElement } from "react";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import ExternalStatusPageComponentsCopy from "./ExternalStatusPageComponentsCopy";

/*
 * The chosen components a page does not list, said where they are missing
 * from: "Not on this page, so not watched: Payments", or with a component
 * group set, "Not in Core, so not watched: Payments" - a name the page
 * lists in another group is on the page, and the monitor still watches
 * nothing for it. Drawn under the Components field and in the Summary.
 *
 * The group's and the components' names are the page's own words, each
 * drawn in its own direction (a bdi), so a Persian sentence keeps "Europe
 * (Frankfurt)" whole and in its order.
 */

export interface ComponentProps {
  names: Array<string>;
  componentGroupName?: string | undefined;
}

const ExternalStatusPageUnmatchedSentence: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const group: string = (props.componentGroupName || "").trim();
  const names: ReactElement = <bdi>{props.names.join(", ")}</bdi>;

  if (group) {
    return (
      <TranslatedSentence
        template={ExternalStatusPageComponentsCopy.UNMATCHED_IN_GROUP}
        slots={{ group: <bdi>{group}</bdi>, names: names }}
      />
    );
  }

  return (
    <TranslatedSentence
      template={ExternalStatusPageComponentsCopy.UNMATCHED}
      slots={{ names: names }}
    />
  );
};

export default ExternalStatusPageUnmatchedSentence;
