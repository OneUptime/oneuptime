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
  // One short line under the title while the section is open.
  description?: string | undefined;
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
        variant="card"
        defaultCollapsed={true}
        badge={
          props.isConfigured
            ? translator.translateText("Configured")
            : undefined
        }
      >
        <div>{props.children}</div>
      </CollapsibleSection>
    </div>
  );
};

export default AdvancedPageSection;
