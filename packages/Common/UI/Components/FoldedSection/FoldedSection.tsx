import IconProp from "../../../Types/Icon/IconProp";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import Icon from "../Icon/Icon";
import {
  FoldedSectionItem,
  FoldedSectionItemsShown,
  getFoldedSectionItemsShown,
} from "./FoldedSectionItem";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  ReactNode,
  useEffect,
  useId,
  useState,
} from "react";

/*
 * A fold: options most people never need, out of the way until someone
 * opens them - a form's "More fields" (Forms/Utils/AdvancedFormSection), a
 * page's "More settings" (AdvancedPageSection), and every other folded
 * section a form draws (CollapsibleFormSection).
 *
 * Folded, its header says what is inside without being opened:
 *   - the fields or cards it holds, by name, a few of them and how many
 *     more ("Declared At · Initial State · Labels · Private Incident");
 *   - the ones that are set, as chips with what they are set to ("Labels:
 *     2", "Private Incident: On"), so nothing in force is hidden;
 *   - what its defaults do, in a sentence, where the section says so ("The
 *     key expires a year from today.").
 * Open, it shows its description under the title instead, and the fields.
 *
 * The header is a real button: Tab reaches it, Enter and Space open it,
 * aria-expanded says which way it is, and the line of what is inside is its
 * description for a screen reader. Folded, the body stays mounted (fields
 * keep what was typed) but is invisible, so nothing in it can be tabbed to
 * or read out. It works the same in the dark theme (Theme.css remaps every
 * colour class used here) and at phone width (the lines wrap; the chevron
 * keeps its place).
 */

export const FOLDED_SECTION_TEST_ID: string = "folded-section";

export interface ComponentProps {
  // English; looked up when drawn.
  title: string;
  // Drawn in a tile before the title: what kind of section it is.
  icon?: IconProp | undefined;
  // Under the title while open.
  description?: string | ReactElement | undefined;
  // Folded: what is inside, set ones as chips.
  items?: Array<FoldedSectionItem> | undefined;
  /*
   * Folded: what the section is set to or what its defaults do, as whole
   * sentences - English (looked up here) or already translated.
   */
  summary?: string | ReactElement | undefined;
  /*
   * Folded: one short word beside what is inside ("Configured") - for a
   * section that knows something in it is set but not what.
   */
  badge?: string | undefined;
  // Controlled: follows the prop. Left out, starts as defaultCollapsed.
  isCollapsed?: boolean | undefined;
  // True when left out: a fold starts folded.
  defaultCollapsed?: boolean | undefined;
  onToggle?: ((isCollapsed: boolean) => void) | undefined;
  // A block of its own on a page, among cards: a card's shadow.
  isElevated?: boolean | undefined;
  className?: string | undefined;
  dataTestId?: string | undefined;
  children: ReactNode;
}

const FoldedSection: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const [isCollapsed, setIsCollapsed] = useState<boolean>(
    props.isCollapsed ?? props.defaultCollapsed ?? true,
  );

  useEffect(() => {
    if (props.isCollapsed !== undefined) {
      setIsCollapsed(props.isCollapsed);
    }
  }, [props.isCollapsed]);

  const toggle: () => void = (): void => {
    const next: boolean = !isCollapsed;
    setIsCollapsed(next);
    props.onToggle?.(next);
  };

  const id: string = useId();
  const titleId: string = `folded-section-title-${id}`;
  const bodyId: string = `folded-section-body-${id}`;
  const contentsId: string = `folded-section-contents-${id}`;
  const summaryId: string = `folded-section-summary-${id}`;
  const descriptionId: string = `folded-section-description-${id}`;

  const translate: (text: string) => string = (text: string): string => {
    return translator.translateText(text) ?? text;
  };

  const { shown, hiddenCount }: FoldedSectionItemsShown =
    getFoldedSectionItemsShown(props.items || []);

  const hasSetItem: boolean = shown.some((item: FoldedSectionItem) => {
    return item.isSet;
  });

  const showContents: boolean = isCollapsed && shown.length > 0;
  const showSummary: boolean = Boolean(isCollapsed && props.summary);
  const showBadge: boolean = Boolean(isCollapsed && props.badge);
  const showDescription: boolean = Boolean(!isCollapsed && props.description);

  const describedBy: Array<string> = [];

  if (showContents || showBadge) {
    describedBy.push(contentsId);
  }

  if (showSummary) {
    describedBy.push(summaryId);
  }

  if (showDescription) {
    describedBy.push(descriptionId);
  }

  /*
   * Between two things listed: the pills are apart on screen already; a
   * screen reader hears a comma, so the names are not read as one.
   */
  const renderSeparator: () => ReactElement = (): ReactElement => {
    return <span className="sr-only">, </span>;
  };

  const renderItem: (item: FoldedSectionItem) => ReactElement = (
    item: FoldedSectionItem,
  ): ReactElement => {
    const title: string = translate(item.title);

    if (!item.isSet) {
      return (
        <span
          data-testid="folded-section-item"
          data-item-key={item.key}
          data-item-set="false"
          className="inline-flex min-w-0 max-w-full items-center rounded-full px-2 py-0.5 text-xs font-medium text-gray-600 ring-1 ring-inset ring-gray-200"
        >
          <span className="truncate">{title}</span>
        </span>
      );
    }

    const value: string | undefined = item.value
      ? item.translateValue
        ? translate(item.value)
        : item.value
      : undefined;

    return (
      <span
        data-testid="folded-section-item"
        data-item-key={item.key}
        data-item-set="true"
        className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-200"
      >
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 flex-none rounded-full bg-indigo-500"
        />
        <span className="truncate">
          {title}
          {value ? (
            <>
              {": "}
              <span className="font-normal">{value}</span>
            </>
          ) : (
            <></>
          )}
        </span>
      </span>
    );
  };

  return (
    <div
      className={`border border-gray-200 bg-white transition-colors duration-150 ${
        props.isElevated ? "rounded-xl shadow-sm" : "rounded-lg"
      } ${props.className || ""}`}
      data-testid={props.dataTestId || FOLDED_SECTION_TEST_ID}
      data-collapsed={isCollapsed ? "true" : "false"}
    >
      <button
        type="button"
        className={`flex w-full items-start gap-3 text-left transition-colors duration-150 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${
          props.isElevated ? "px-5 py-4 md:px-6" : "px-4 py-3"
        } ${
          props.isElevated
            ? isCollapsed
              ? "rounded-xl"
              : "rounded-t-xl"
            : isCollapsed
              ? "rounded-lg"
              : "rounded-t-lg"
        }`}
        onClick={toggle}
        aria-expanded={!isCollapsed}
        aria-controls={bodyId}
        aria-labelledby={titleId}
        aria-describedby={
          describedBy.length > 0 ? describedBy.join(" ") : undefined
        }
        data-testid="folded-section-header"
      >
        {props.icon ? (
          <span
            aria-hidden="true"
            className={`mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-md transition-colors duration-150 ${
              hasSetItem
                ? "bg-indigo-50 text-indigo-600"
                : "bg-gray-100 text-gray-500"
            }`}
            data-testid="folded-section-icon"
          >
            <Icon icon={props.icon} className="h-4 w-4" />
          </span>
        ) : (
          <></>
        )}

        <span className="min-w-0 flex-1">
          <span
            id={titleId}
            className="block text-sm font-medium leading-6 text-gray-900"
            data-testid="folded-section-title"
          >
            {translate(props.title)}
          </span>

          {showDescription ? (
            <span
              id={descriptionId}
              className="mt-0.5 block text-sm text-gray-500"
              data-testid="folded-section-description"
            >
              {typeof props.description === "string"
                ? translate(props.description)
                : props.description}
            </span>
          ) : (
            <></>
          )}

          {showContents || showBadge ? (
            <span
              id={contentsId}
              className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs leading-5 text-gray-500"
              data-testid="folded-section-contents"
            >
              {shown.map(
                (item: FoldedSectionItem, index: number): ReactElement => {
                  return (
                    <Fragment key={item.key}>
                      {index > 0 ? renderSeparator() : <></>}
                      {renderItem(item)}
                    </Fragment>
                  );
                },
              )}
              {showContents && hiddenCount > 0 ? (
                <>
                  {renderSeparator()}
                  <span
                    className="px-1 font-medium"
                    data-testid="folded-section-more"
                  >
                    {translator.translatePlural(
                      { one: "{{count}} more", other: "{{count}} more" },
                      hiddenCount,
                    )}
                  </span>
                </>
              ) : (
                <></>
              )}
              {showBadge ? (
                <>
                  {showContents ? renderSeparator() : <></>}
                  <span
                    className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700"
                    data-testid="folded-section-badge"
                  >
                    {translate(props.badge || "")}
                  </span>
                </>
              ) : (
                <></>
              )}
            </span>
          ) : (
            <></>
          )}

          {showSummary ? (
            <span
              id={summaryId}
              className="mt-1 block break-words text-sm leading-5 text-gray-600"
              data-testid="collapsible-section-summary"
            >
              {typeof props.summary === "string"
                ? translate(props.summary)
                : props.summary}
            </span>
          ) : (
            <></>
          )}
        </span>

        <span
          aria-hidden="true"
          className="mt-1 flex-none text-gray-400"
          data-testid="folded-section-chevron"
        >
          <Icon
            icon={IconProp.ChevronDown}
            className={`h-5 w-5 transition-transform duration-200 motion-reduce:transition-none ${
              isCollapsed ? "" : "-rotate-180"
            }`}
          />
        </span>
      </button>

      {/*
       * Folded, the body is out of sight (max-h-0, opacity-0) and out of
       * reach (invisible: no tab stops, nothing read out), but mounted. A
       * transition follows the property list of the state it goes to:
       * folding transitions visibility with the rest, so it turns invisible
       * once the fold has finished; opening leaves it out, so the fields can
       * be tabbed to at once (CollapsibleSection does the same).
       */}
      <div
        id={bodyId}
        className={`overflow-hidden duration-200 ease-in-out motion-reduce:transition-none ${
          isCollapsed
            ? "max-h-0 opacity-0 invisible transition-all"
            : "max-h-[5000px] opacity-100 transition-[max-height,opacity]"
        }`}
        data-testid="folded-section-body"
      >
        <div
          className={`border-t border-gray-200 ${
            props.isElevated ? "px-5 py-5 md:px-6" : "px-4 py-4"
          }`}
        >
          {props.children}
        </div>
      </div>
    </div>
  );
};

export default FoldedSection;
