import React, { FunctionComponent, ReactElement, useId } from "react";
import { Placement } from "tippy.js";
import Tooltip from "../../Tooltip/Tooltip";
import Icon from "../../Icon/Icon";
import IconProp from "../../../../Types/Icon/IconProp";
import { translatableTerm, Translator } from "../../../Utils/TranslateTemplate";
import useTranslator from "../../../Utils/UseTranslator";
import { FacetHelp, FacetHelpEntry } from "../FacetHelp";

// The (i) itself, and the box it opens: what a test or a page finds them by.
export const FACET_HELP_BUTTON_TEST_ID: string = "facet-help-button";
export const FACET_HELP_TOOLTIP_TEST_ID: string = "facet-help-tooltip";

/*
 * What a sentence of the help reads as: the reader's language where the
 * Dashboard words it, English where it does not.
 */
const translated: (translator: Translator, text: string) => string = (
  translator: Translator,
  text: string,
): string => {
  return translator.translateText(text) || text;
};

export interface FacetHelpContentProps {
  help: FacetHelp;
}

/*
 * What the (i) shows: the facet's own sentence, then each described value -
 * its name as its row draws it, and under it what it is. A list of names
 * and sentences, not one paragraph: each sentence is a whole sentence each
 * language words its own way, and the name it explains stands apart from it
 * in bold, as on the row.
 */
export const FacetHelpContent: FunctionComponent<FacetHelpContentProps> = (
  props: FacetHelpContentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div
      className="w-72 max-w-full space-y-2 p-1 text-left text-xs leading-snug"
      data-testid={FACET_HELP_TOOLTIP_TEST_ID}
    >
      {props.help.description ? (
        <p className="text-gray-700">
          {translated(translator, props.help.description)}
        </p>
      ) : (
        <></>
      )}
      {props.help.entries.length > 0 ? (
        <dl className="space-y-1.5">
          {props.help.entries.map((entry: FacetHelpEntry): ReactElement => {
            return (
              <div key={entry.value} data-value={entry.value}>
                <dt className="font-semibold text-gray-900">{entry.label}</dt>
                <dd className="text-gray-600">
                  {translated(translator, entry.description)}
                </dd>
              </div>
            );
          })}
        </dl>
      ) : (
        <></>
      )}
    </div>
  );
};

export interface FacetHelpButtonProps {
  /*
   * The facet's name in English, as its config writes it ("Span Type"):
   * names the (i) "About Span Type" in the reader's language.
   */
  title: string;
  help: FacetHelp;
  className?: string | undefined;
  /*
   * Which side the help opens on: to the right of a sidebar's title (the
   * default), so the values' names stay in view beside it; below a
   * toolbar's control ("bottom"), so it covers the chart, not the control.
   */
  placement?: Placement | undefined;
}

/*
 * The (i) beside a facet's title, which says what the facet and its values
 * mean - in place of the paragraph that used to sit under the title.
 *
 *   - Hovering it shows the help, as every (i) does.
 *   - A tap (or a click) shows it and keeps it until the next one
 *     (Tooltip's isShownOnPress): on a phone nothing hovers, and a tap ends
 *     with the pointer leaving, which would hide it again at once.
 *   - Tab reaches it - a real button, named "About Span Type" - and focus
 *     shows the help.
 *   - A screen reader hears the help as the button's description, from a
 *     node that is always there (aria-describedby), whether or not the
 *     tooltip is showing; Tippy adds no description of its own, so it is
 *     read once.
 *
 * The tooltip opens to the right of the title, so the names of the values it
 * explains stay in view beside it, and is mounted on the page rather than
 * in the sidebar, whose scrolling would clip it. Its box is the
 * light-bordered one, which the dark theme re-colours (Theme.css). A press
 * does nothing else: it never folds the section it heads.
 */
const FacetHelpButton: FunctionComponent<FacetHelpButtonProps> = (
  props: FacetHelpButtonProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const descriptionId: string = useId();
  const placement: Placement = props.placement || "right";

  return (
    <>
      <Tooltip
        richContent={<FacetHelpContent help={props.help} />}
        interactive={false}
        isShownOnPress={true}
        isTriggerAlreadyDescribed={true}
        placement={placement}
        /*
         * Where the right has no room - a phone, where the sidebar is the
         * screen's width - above the title rather than over the values.
         */
        fallbackPlacements={
          placement === "right" ? ["top", "bottom"] : ["top", "right"]
        }
      >
        <button
          type="button"
          aria-label={translator.translateTemplate("About {{label}}", {
            label: translatableTerm(props.title),
          })}
          aria-describedby={descriptionId}
          data-testid={FACET_HELP_BUTTON_TEST_ID}
          /*
           * A finger-sized target around the small (i), so a tap on a phone
           * finds it; the icon is what is drawn.
           */
          className={`flex h-6 w-6 flex-none items-center justify-center rounded-full text-gray-400 transition-colors hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
            props.className || ""
          }`}
          onClick={(event: React.MouseEvent<HTMLButtonElement>): void => {
            event.preventDefault();
            event.stopPropagation();
          }}
          // A header that handles Enter / Space would hear them bubble up.
          onKeyDown={(event: React.KeyboardEvent<HTMLButtonElement>): void => {
            if (event.key === "Enter" || event.key === " ") {
              event.stopPropagation();
            }
          }}
        >
          <Icon icon={IconProp.InformationCircle} className="h-3.5 w-3.5" />
        </button>
      </Tooltip>
      {/*
       * What a screen reader hears: the same words, each value's name before
       * its sentence. Never drawn on its own.
       */}
      <span id={descriptionId} hidden={true}>
        {props.help.description ? (
          <span>{translated(translator, props.help.description)} </span>
        ) : (
          <></>
        )}
        {props.help.entries.map((entry: FacetHelpEntry): ReactElement => {
          return (
            <span key={entry.value}>
              {entry.label}: {translated(translator, entry.description)}{" "}
            </span>
          );
        })}
      </span>
    </>
  );
};

export default FacetHelpButton;
