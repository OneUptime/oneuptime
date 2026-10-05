import IconProp from "../../../Types/Icon/IconProp";
import { translationKey } from "../../Utils/TranslateTemplate";

/*
 * What the folds of rarely needed things are called, everywhere. One name
 * per kind, so people learn it once:
 *
 *   - "More fields": a form's fold (Forms/Utils/AdvancedFormSection) -
 *     more of the same form's fields, at the end of the form or its step.
 *   - "More settings": a page's fold (AdvancedPageSection) - settings cards
 *     most people never need, after the ones they do.
 *
 * They used to be called "Advanced", which said who the options were for
 * (experts) rather than what they were, and told nobody what was inside.
 * The maintainer: "The advanced section in the form should be called
 * something better - like 'more' or something as such." Not "More options":
 * that is the name of the ⋯ button on every card and table row
 * (MoreMenu), and an API key's folded Block Permissions table has one of
 * its own - a fold of the same name around it would make two different
 * controls one name.
 *
 * Side menus keep their "Advanced" section: it is a group of pages, not a
 * fold of fields, and SideMenuSectionState folds it by that title.
 */

export const MORE_FIELDS_SECTION_TITLE: string = translationKey("More fields");

export const MORE_SETTINGS_SECTION_TITLE: string =
  translationKey("More settings");

// The icon in the header's tile of both: things to adjust.
export const MORE_SECTION_ICON: IconProp = IconProp.AdjustmentHorizontal;

/*
 * What a fold of rarely needed things must not be called any more - a form
 * section, a page section or a wizard step (FoldedSectionsGuard,
 * AdvancedStepsGuard).
 */
export const RETIRED_FOLD_TITLE: RegExp = /^advanced\b/i;
