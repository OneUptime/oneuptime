import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The pieces every site form shares: the Add Site form on the Sites list,
 * the Site Settings card's edit form and the Child Sites tab's form.
 *
 * A site is a place: what kind it is, what it is called, where it sits in
 * the hierarchy, and - once - what the devices added to it start with. The
 * description, the street address and the map coordinates are worth having,
 * but no one has to answer them to add a site, so they fold under More
 * fields at the end of the first step. Location used to be a step of its own
 * that every new site walked through.
 */

/*
 * More fields on a site form: description and location. Built once and
 * written the same way on every field, so BasicForm and FormStepsScan both
 * join them into one fold.
 */
export const SITE_MORE_FIELDS: FormFieldCollapsibleSection<NetworkSite> =
  getAdvancedFormSection<NetworkSite>();

export const SITE_TYPE_FIELD_DESCRIPTION: string = translationKey(
  "What kind of place this is - a region, a store, a data center. The next step lists the sites it can sit under.",
);
