import CardSections from "../Card/CardSections";
import FoldedSection from "../FoldedSection/FoldedSection";
import { FoldedSectionItem } from "../FoldedSection/FoldedSectionItem";
import {
  MORE_SECTION_ICON,
  MORE_SETTINGS_SECTION_TITLE,
} from "../FoldedSection/FoldedSectionTitles";
import { translationKey } from "../../Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * "More settings" on a page: the cards most people never need, folded under
 * one header so the page shows what matters first. The page-level twin of a
 * form's "More fields" (Forms/Utils/AdvancedFormSection), drawn by the same
 * FoldedSection, and it behaves the same way:
 *
 *   - it starts folded, every time the page opens;
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
   * to (foldedSectionItem).
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

const AdvancedPageSection: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const items: Array<FoldedSectionItem> = props.items || [];

  const hasSetItem: boolean = items.some((item: FoldedSectionItem) => {
    return item.isSet;
  });

  return (
    <div
      className="mb-5"
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
        defaultCollapsed={true}
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
