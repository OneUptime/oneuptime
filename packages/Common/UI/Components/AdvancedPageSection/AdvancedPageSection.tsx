import CollapsibleSection from "../CollapsibleSection/CollapsibleSection";
import { ADVANCED_FORM_SECTION_TITLE } from "../Forms/Utils/AdvancedFormSection";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * "Advanced" on a page: the cards most people never need, folded under one
 * header so the page shows what matters first. The page-level twin of a
 * form's Advanced section (Forms/Utils/AdvancedFormSection), and it behaves
 * the same way:
 *
 *   - it starts folded, every time the page opens;
 *   - its description says what is in it, folded or open, so a reader
 *     looking for block permissions finds them without opening every fold;
 *   - a page can say instead, while it is folded, what the cards in it are
 *     set to (summary) - what their defaults do, say: "Every incident is
 *     investigated, whatever its severity, and nothing limits how much AI
 *     does." The description is then the line under its title once open;
 *   - while folded it says "Configured" on its header when something in it
 *     is set (the page says when: an API key with block permissions), so
 *     folding never hides that a setting is in force;
 *   - the cards in it stay mounted while it is folded, so they load once and
 *     can report what they hold (which is how a page learns "Configured"),
 *     but nothing in a folded section can be tabbed to or read out.
 *
 * Put it after the cards people use and before Delete:
 *
 *   <AdvancedPageSection
 *     description="..."
 *     isConfigured={hasBlockPermissions}
 *   >
 *     <BlockPermissionsTable ... />
 *   </AdvancedPageSection>
 */

export interface ComponentProps {
  /*
   * What is in it, in one line under the title: shown while it is folded
   * too, so nobody has to open it to find out.
   */
  description?: string | undefined;
  /*
   * While it is folded, what its cards are set to, in place of the
   * description: one or more whole sentences, already translated or
   * English. The page works it out from what its cards hold, so a reader
   * learns what the defaults do - or what is set - without opening it.
   */
  summary?: string | ReactElement | undefined;
  // Whether anything in it is set: the folded header then says "Configured".
  isConfigured?: boolean | undefined;
  children: ReactElement | Array<ReactElement>;
  dataTestId?: string | undefined;
}

export const ADVANCED_PAGE_SECTION_TEST_ID: string = "advanced-page-section";

const AdvancedPageSection: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div
      className="mb-5"
      data-testid={props.dataTestId || ADVANCED_PAGE_SECTION_TEST_ID}
    >
      <CollapsibleSection
        title={ADVANCED_FORM_SECTION_TITLE}
        description={props.description}
        collapsedDescription={props.summary || props.description}
        variant="card"
        defaultCollapsed={true}
        badge={
          props.isConfigured
            ? translator.translateText("Configured")
            : undefined
        }
      >
        {/*
         * A card keeps a margin under it for the next card on the page.
         * In here the section's padding frames the cards, so their own
         * margins go, and the gap between two cards is set once.
         */}
        <div className="space-y-5 [&_[data-testid=card]]:mb-0">
          {props.children}
        </div>
      </CollapsibleSection>
    </div>
  );
};

export default AdvancedPageSection;
