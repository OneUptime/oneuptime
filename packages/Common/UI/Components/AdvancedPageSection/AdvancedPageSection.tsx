import CardSections from "../Card/CardSections";
import FoldedSection from "../FoldedSection/FoldedSection";
import { FoldedSectionItem } from "../FoldedSection/FoldedSectionItem";
import {
  MORE_SECTION_ICON,
  MORE_SETTINGS_SECTION_TITLE,
} from "../FoldedSection/FoldedSectionTitles";
import { translationKey } from "../../Utils/TranslateTemplate";
import {
  PAGE_ANCHOR_SCROLL_MARGIN_TOP,
  bringPageAnchorIntoView,
  getPageAnchor,
  markPageAnchorLanded,
} from "../../Utils/PageAnchor";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * "More settings" on a page: the cards most people never need, folded under
 * one header so the page shows what matters first. The page-level twin of a
 * form's "More fields" (Forms/Utils/AdvancedFormSection), drawn by the same
 * FoldedSection, and it behaves the same way:
 *
 *   - it starts folded, every time the page opens - unless the page is
 *     opened at a card in it (below);
 *   - folded, its header names the cards in it (items) - "Block
 *     Permissions", "Default Bar Color · Bar Color Rules · Languages" - and
 *     draws the ones that are set as chips that say what they are set to
 *     ("Block Permissions: 2"), so folding never hides a setting in force;
 *   - a page can also say, folded, what its cards' defaults do (summary):
 *     "Every incident is investigated, whatever its severity, and nothing
 *     limits how much AI does.";
 *   - its description says what the section is for, under the title once
 *     it is open (and folded too, on a page that names no items);
 *   - the cards in it stay mounted while it is folded, so they load once and
 *     can report what they hold (which is how a page learns what is set),
 *     but nothing in a folded section can be tabbed to or read out.
 *
 * It opens by itself when the page is opened at one of its cards: a link
 * whose address names an item's key after its "#" (Utils/PageAnchor) -
 * "Pick a Runner" opening a repository's ".../settings#runner". It opens
 * at once, never drawn folded first, and the card whose id is that key
 * (Card's `id`) is brought into view, its divider right under the sticky
 * header - or, for a card with no id, the section itself. The card is
 * tinted for a moment and holds the keyboard's focus
 * (markPageAnchorLanded), so the setting the link was for is the one the
 * eye and Tab find. Each time the address names one of its items again it
 * does the same; folded by hand, it stays folded.
 *
 * It was called "Advanced". It is "More settings" now, for the reason
 * FoldedSectionTitles gives: it says what is inside rather than who it is
 * for, and it is not the "More options" of the ⋯ buttons on the cards in it.
 *
 * Put it after the cards people use and before Delete:
 *
 *   <AdvancedPageSection
 *     description="..."
 *     items={[foldedSectionItem("Block Permissions", { isSet, value })]}
 *   >
 *     <BlockPermissionsTable ... />
 *   </AdvancedPageSection>
 */

export interface ComponentProps {
  /*
   * What the section holds, in one line: under its title once open, and
   * folded too when the page names no items.
   */
  description?: string | undefined;
  /*
   * Folded: the cards in it, by title, the set ones with what they are set
   * to (foldedSectionItem). An item's key is also the place on the page a
   * link can name to open the section at its card (the card's `id`).
   */
  items?: Array<FoldedSectionItem> | undefined;
  /*
   * Folded: what its cards are set to, or what their defaults do - one or
   * more whole sentences, already translated or English.
   */
  summary?: string | ReactElement | undefined;
  /*
   * Whether anything in it is set, for a page that cannot say which card:
   * folded, it then says "Configured" - unless a set item already says so.
   */
  isConfigured?: boolean | undefined;
  children: ReactElement | Array<ReactElement>;
  dataTestId?: string | undefined;
}

export const ADVANCED_PAGE_SECTION_TEST_ID: string = "advanced-page-section";

// The sections in it, under its header.
export const ADVANCED_PAGE_SECTION_SECTIONS_TEST_ID: string =
  "advanced-page-section-sections";

const CONFIGURED: string = translationKey("Configured");

/*
 * The item the page's address names, when it is one of these: its key, or
 * empty. Read on every render, so a link on the same page that names
 * another item is heard as the page draws again.
 */
export const getAnchoredItemKey: (
  items: Array<FoldedSectionItem>,
  anchor: string,
) => string = (items: Array<FoldedSectionItem>, anchor: string): string => {
  if (!anchor) {
    return "";
  }

  const anchored: FoldedSectionItem | undefined = items.find(
    (item: FoldedSectionItem): boolean => {
      return item.key === anchor;
    },
  );

  return anchored ? anchored.key : "";
};

const AdvancedPageSection: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const items: Array<FoldedSectionItem> = props.items || [];

  const hasSetItem: boolean = items.some((item: FoldedSectionItem) => {
    return item.isSet;
  });

  const anchoredKey: string = getAnchoredItemKey(items, getPageAnchor());

  // Folded, unless the page was opened at one of its cards.
  const [isCollapsed, setIsCollapsed] = useState<boolean>(!anchoredKey);

  const sectionRef: MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);

  /*
   * Opened at a card - when the page opens, when the card's item arrives
   * (a page that names a card once it has read the record), or when a link
   * on the page names another: open, and bring that card into view. Only a
   * new item does it again, so a section folded by hand stays folded as the
   * page draws.
   */
  useEffect(() => {
    if (!anchoredKey) {
      return undefined;
    }

    setIsCollapsed(false);

    const section: HTMLDivElement | null = sectionRef.current;

    if (!section) {
      return undefined;
    }

    /*
     * The card that is the item's place, in here; else the section. The key
     * is a plain name (getPageAnchor reads no other), so it is safe in the
     * selector as it is.
     */
    const card: HTMLElement | null = section.querySelector<HTMLElement>(
      `[id="${anchoredKey}"]`,
    );

    const stopBringingIntoView: () => void = bringPageAnchorIntoView(
      card || section,
    );

    /*
     * The card the link was for, marked among the ones around it. A card
     * with no place of its own lands on the whole section: nothing in it
     * is the one, so nothing is marked.
     */
    const unmark: (() => void) | null = card
      ? markPageAnchorLanded(card)
      : null;

    return (): void => {
      stopBringingIntoView();
      unmark?.();
    };
  }, [anchoredKey]);

  return (
    <div
      ref={sectionRef}
      className="mb-5"
      // Brought into view itself for a card with no place of its own.
      style={
        anchoredKey
          ? { scrollMarginTop: PAGE_ANCHOR_SCROLL_MARGIN_TOP }
          : undefined
      }
      data-testid={props.dataTestId || ADVANCED_PAGE_SECTION_TEST_ID}
    >
      <FoldedSection
        title={MORE_SETTINGS_SECTION_TITLE}
        icon={MORE_SECTION_ICON}
        description={props.description}
        items={items}
        summary={
          props.summary || (items.length === 0 ? props.description : undefined)
        }
        badge={props.isConfigured && !hasSetItem ? CONFIGURED : undefined}
        isCollapsed={isCollapsed}
        onToggle={(nextIsCollapsed: boolean): void => {
          setIsCollapsed(nextIsCollapsed);
        }}
        isElevated={true}
        isBodyFlush={true}
      >
        {/*
         * One card, not cards inside a card: each card in here is drawn as
         * a section of this one - its title, description, actions and body
         * without a frame of its own - with a divider across the whole card
         * above it (CardSections).
         */}
        <CardSections dataTestId={ADVANCED_PAGE_SECTION_SECTIONS_TEST_ID}>
          {props.children}
        </CardSections>
      </FoldedSection>
    </div>
  );
};

export default AdvancedPageSection;
