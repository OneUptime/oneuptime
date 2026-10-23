import { OwnerRulePreviewEvent } from "Common/Types/Rules/OwnerRulePreview";
import Field from "Common/UI/Components/Forms/Types/Field";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getOwnersPeoplePickerConfig } from "Common/UI/Components/PeoplePicker/OwnersFormField";
import { PeoplePickerFieldConfig } from "Common/UI/Components/PeoplePicker/PeoplePickerTypes";
import UserUtil from "Common/UI/Utils/User";
import React, { ReactElement } from "react";
import { getMyTeamSuggestionsFooter } from "./MyTeamSuggestions";
import { getOwnersOnCreateDescription } from "./OwnersOnCreateRules";
import OwnersOnCreateSummary from "./OwnersOnCreateSummary";

/*
 * What makes the Owners field of a create form - incidents, alerts and their
 * episodes (OwnersOnCreateRules says why) - the one it is: its line, the
 * creator's own teams one click away under the picker, and on the review
 * step a row that is always there, saying who will own the event, owner
 * rules included. Spread into the form's own getOwnersFormField call, which
 * names the step and the fold, so the form scanner of the guards places the
 * field like any other owners field:
 *
 *   getOwnersFormField<Incident>({
 *     stepId: "incident-details",
 *     collapsibleSection: advancedSection,
 *     ...getOwnersOnCreateFieldOptions<Incident>(OwnerRulePreviewEvent.Incident),
 *   }),
 *
 * The picks are the form's ownerUsers and ownerTeams, sent as misc data:
 * the server asks whether the creator may add them before the event is
 * saved, and adds them once it exists.
 */
export type OwnersOnCreateFieldOptions<TEntity> = Pick<
  Field<TEntity>,
  "description" | "getFooterElement" | "alwaysInSummary" | "getSummaryElement"
>;

export const getOwnersOnCreateFieldOptions: <TEntity>(
  event: OwnerRulePreviewEvent,
) => OwnersOnCreateFieldOptions<TEntity> = <TEntity,>(
  event: OwnerRulePreviewEvent,
): OwnersOnCreateFieldOptions<TEntity> => {
  // The keys getOwnersFormField writes the picks to, by default.
  const config: PeoplePickerFieldConfig = getOwnersPeoplePickerConfig();

  return {
    // "You become an owner..." only to someone OneUptime makes one.
    description: getOwnersOnCreateDescription(
      event,
      Boolean(UserUtil.isMasterAdmin()),
    ),
    getFooterElement: getMyTeamSuggestionsFooter<TEntity>(config),
    /*
     * Listed on the review step whatever it holds, folded or not: the owner
     * rules that will run are what the person creating it needs to read.
     */
    alwaysInSummary: true,
    getSummaryElement: (item: FormValues<TEntity>): ReactElement => {
      return (
        <OwnersOnCreateSummary event={event} values={item} config={config} />
      );
    },
  };
};

export default getOwnersOnCreateFieldOptions;
