import Route from "Common/Types/API/Route";
import { ReadingDirection } from "Common/Types/ReadingDirection";
import IsolatedLine, {
  getIsolatedLine,
} from "Common/UI/Components/IsolatedText/IsolatedLine";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import AppLink from "../AppLink/AppLink";
import { VisibleItems, splitVisibleItems } from "../../Utils/EventOverview";

/*
 * The things a header fact names - an incident's monitors, an alert's
 * monitor and episode, a maintenance event's status pages - as links to
 * their pages, one under another, so a long name wraps on its own lines
 * instead of running into the next one. After the first few, "+N more"
 * (to the record's own list of them, when it has one).
 *
 * Each name is a line of its own that reads the way it is written
 * (IsolatedLine): on an Arabic or Persian page an English monitor's name
 * wraps from its own start, as wide as its words at the page's start, and
 * keeps its brackets where they were typed - a line of the page's put
 * "checkout-api (eu)" as "(checkout-api (eu".
 */

// A name's line: wrapped where it has to be, never past its column.
export const EVENT_FACT_NAME_CLASS_NAME: string = "max-w-full break-words";

export const EVENT_FACT_LINK_CLASS_NAME: string =
  "rounded-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

export interface EventFactLinkItem {
  key: string;
  name: string;
  // The thing's page; without one the name is plain text.
  route?: Route | undefined;
}

export interface ComponentProps {
  items: Array<EventFactLinkItem>;
  // How many to name before "+N more"; all of them when left out.
  maxVisible?: number | undefined;
  // Where "+N more" leads, when the record lists them all somewhere.
  moreRoute?: Route | undefined;
  dataTestId?: string | undefined;
}

const EventFactLinks: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const shown: VisibleItems<EventFactLinkItem> = splitVisibleItems(
    props.items,
    props.maxVisible || props.items.length || 1,
  );
  const moreText: string = translator.translatePlural(
    { one: "+{{count}} more", other: "+{{count}} more" },
    shown.hiddenCount,
  );

  return (
    <span
      data-testid={props.dataTestId}
      className="flex min-w-0 flex-col items-start gap-1"
    >
      {shown.visible.map((item: EventFactLinkItem): ReactElement => {
        if (!item.route) {
          return (
            <IsolatedLine
              key={item.key}
              as="span"
              text={item.name}
              className={EVENT_FACT_NAME_CLASS_NAME}
            />
          );
        }

        // The link is the name's line: its dir, and where it sits.
        const line: { dir: ReadingDirection | undefined; className: string } =
          getIsolatedLine({
            text: item.name,
            pageLanguage: translator.language,
            className: `${EVENT_FACT_NAME_CLASS_NAME} ${EVENT_FACT_LINK_CLASS_NAME}`,
          });

        return (
          <AppLink
            key={item.key}
            to={item.route}
            className={line.className}
            dir={line.dir}
          >
            {item.name}
          </AppLink>
        );
      })}
      {shown.hiddenCount > 0 ? (
        props.moreRoute ? (
          <AppLink to={props.moreRoute} className={EVENT_FACT_LINK_CLASS_NAME}>
            {moreText}
          </AppLink>
        ) : (
          <span className="font-normal text-gray-500">{moreText}</span>
        )
      ) : (
        <></>
      )}
    </span>
  );
};

export default EventFactLinks;
