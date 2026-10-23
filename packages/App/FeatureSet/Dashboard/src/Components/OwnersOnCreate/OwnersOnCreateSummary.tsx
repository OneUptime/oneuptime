import {
  OwnerRulePreviewDraft,
  OwnerRulePreviewEvent,
  OwnerRulePreviewRule,
} from "Common/Types/Rules/OwnerRulePreview";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { PeopleListFromIds } from "Common/UI/Components/PeoplePicker/PeopleList";
import {
  countPeoplePickerValue,
  PeoplePickerFieldConfig,
  PeoplePickerKind,
  PeoplePickerValue,
  readPeoplePickerFormValue,
} from "Common/UI/Components/PeoplePicker/PeoplePickerTypes";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import UserUtil from "Common/UI/Utils/User";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import {
  getNobodyPickedText,
  getOwnerRulePreviewDraft,
  getOwnerRulesToShow,
  getOwnersNewFromRule,
  isCreatorMadeOwner,
  OWNER_RULE_ADDS_NOBODY_NEW,
  OWNER_RULES_ADD_HEADING,
  OWNER_RULES_CHECKING,
  OWNER_RULES_COULD_NOT_CHECK,
  OwnerRuleNewOwners,
  UNNAMED_OWNER_RULE,
} from "./OwnersOnCreateRules";
import useOwnerRulePreview, {
  OwnerRulePreviewState,
} from "./useOwnerRulePreview";

/*
 * The Owners row of a create form's review step: who will own the event
 * once it is created, before it is. The people and teams picked under More
 * fields, then each owner rule that matches what was filled in, by name,
 * with whom it adds - worked out by the server, by the code the create
 * runs (useOwnerRulePreview). The row's own line, above it, says that the
 * person creating an incident or an alert becomes an owner too, so a
 * rule's line leaves them out, and everyone picked: it names whom the rule
 * adds that is not an owner already (getOwnersNewFromRule), or says that
 * everyone it adds is.
 *
 * The rules are advisory: while they are worked out the row says so, a
 * failure says so in a line and never blocks the create, and someone who
 * may not read the owner rules is told nothing about them.
 */

export interface OwnersOnCreateSummaryProps {
  event: OwnerRulePreviewEvent;
  // The form's values: what the rules match on, and the owners picked.
  values: unknown;
  // The Owners picker: where its picks are kept.
  config: PeoplePickerFieldConfig;
}

const OWNER_KINDS: Array<PeoplePickerKind> = [
  PeoplePickerKind.User,
  PeoplePickerKind.Team,
];

const OwnersOnCreateSummary: FunctionComponent<OwnersOnCreateSummaryProps> = (
  props: OwnersOnCreateSummaryProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const isMasterAdmin: boolean = Boolean(UserUtil.isMasterAdmin());

  const picked: PeoplePickerValue = readPeoplePickerFormValue(
    props.config,
    props.values,
  );

  // The person creating it, when OneUptime makes them an owner.
  const creatorUserId: string | null = isCreatorMadeOwner(
    props.event,
    isMasterAdmin,
  )
    ? UserUtil.getUserId()?.toString() || null
    : null;

  const draft: OwnerRulePreviewDraft = getOwnerRulePreviewDraft(
    props.event,
    props.values,
  );

  const { result, isLoading, error }: OwnerRulePreviewState =
    useOwnerRulePreview({ event: props.event, draft: draft });

  const rules: Array<OwnerRulePreviewRule> = result
    ? getOwnerRulesToShow(result.rules)
    : [];

  return (
    <div className="space-y-3" data-testid="owners-on-create-summary">
      {countPeoplePickerValue(picked) > 0 ? (
        <PeopleListFromIds
          kinds={OWNER_KINDS}
          value={picked}
          dataTestId="owners-on-create-picked"
        />
      ) : (
        <p
          className="text-sm text-gray-500"
          data-testid="owners-on-create-nobody-picked"
        >
          {translator.translateText(
            getNobodyPickedText(props.event, isMasterAdmin),
          )}
        </p>
      )}

      {isLoading ? (
        <div
          role="status"
          aria-busy="true"
          className="flex items-center gap-2 text-sm text-gray-500"
          data-testid="owner-rule-preview-loading"
        >
          <Icon
            icon={IconProp.Spinner}
            className="h-4 w-4 shrink-0 animate-spin"
          />
          <span>{translator.translateText(OWNER_RULES_CHECKING)}</span>
        </div>
      ) : (
        <></>
      )}

      {!isLoading && error ? (
        <p
          role="status"
          className="text-sm text-gray-500"
          data-testid="owner-rule-preview-error"
        >
          {translator.translateText(OWNER_RULES_COULD_NOT_CHECK)}
        </p>
      ) : (
        <></>
      )}

      {rules.length > 0 ? (
        <div data-testid="owner-rule-preview">
          <p className="text-sm font-medium text-gray-700">
            {translator.translateText(OWNER_RULES_ADD_HEADING)}
          </p>
          <ul className="mt-1.5 space-y-2">
            {rules.map((rule: OwnerRulePreviewRule): ReactElement => {
              const newOwners: OwnerRuleNewOwners = getOwnersNewFromRule({
                rule: rule,
                pickedUserIds: picked[PeoplePickerKind.User],
                pickedTeamIds: picked[PeoplePickerKind.Team],
                creatorUserId: creatorUserId,
              });

              return (
                <li
                  key={rule.ruleId}
                  className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3"
                  data-testid="owner-rule-preview-rule"
                  data-rule-id={rule.ruleId}
                >
                  <span
                    className="min-w-0 break-words text-sm text-gray-600 sm:w-64 sm:shrink-0"
                    data-testid="owner-rule-preview-rule-name"
                  >
                    {rule.ruleName ||
                      translator.translateText(UNNAMED_OWNER_RULE)}
                  </span>
                  {newOwners.userIds.length > 0 ||
                  newOwners.teamIds.length > 0 ? (
                    <PeopleListFromIds
                      kinds={OWNER_KINDS}
                      value={{
                        [PeoplePickerKind.User]: newOwners.userIds,
                        [PeoplePickerKind.Team]: newOwners.teamIds,
                      }}
                      dataTestId="owner-rule-preview-owners"
                    />
                  ) : (
                    <span
                      className="text-sm text-gray-500"
                      data-testid="owner-rule-preview-nobody-new"
                    >
                      {translator.translateText(OWNER_RULE_ADDS_NOBODY_NEW)}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default OwnersOnCreateSummary;
