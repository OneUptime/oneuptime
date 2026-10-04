import OnCallRulesTable, { NotificationMethodChoice } from "./OnCallRulesTable";
import {
  ON_CALL_RULE_KIND_DEFINITIONS,
  OnCallRuleKindDefinition,
  getOnCallRuleKindDefinition,
  getOnCallRuleKindDefinitionByTabName,
} from "./OnCallRuleKinds";
import OnCallRuleKind, {
  DEFAULT_ON_CALL_RULE_KIND,
  ON_CALL_RULE_KIND_QUERY_PARAM,
  readOnCallRuleKind,
} from "Common/Types/NotificationRule/OnCallRuleKind";
import ObjectID from "Common/Types/ObjectID";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import { Location, useLocation } from "react-router-dom";

/*
 * Somebody's on-call notification rules, on one page with a tab per kind:
 * Incidents, Incident Episodes, Alerts, Alert Episodes. Each tab has a card
 * per severity, listing which notification method is tried and after how
 * long.
 *
 * These were four pages, in two side-menu sections of their own, and four
 * more pages for an admin looking at a member's. Most people open them to
 * change one delay - the rules a verified method starts with already page on
 * every severity - and had to work out first which of four menu entries held
 * it. The admin's four were split out of a single page because that page
 * drew all four kinds at once, a card per severity each; only the open tab
 * is drawn here, so the page is never that again.
 *
 * Both places draw THIS, so they cannot drift: your own page in User
 * Settings, and a member's under Users > (a member) > On-Call.
 *
 * The open tab is in the address (`?type=alerts`, from Common's
 * OnCallRuleKind), so every link that says "fix your alert rules" - the setup
 * checklist, a policy's readiness card, the team compliance page, the setup
 * reminder email - opens on the alerts tab, and a reload stays there. A bare
 * address opens Incidents.
 */

export interface OnCallRulesPerson {
  // Name, or login email; "" when neither is known.
  displayName: string;
  // First name, or a stand-in such as "this user", for sentences.
  firstName: string;
}

export interface ComponentProps {
  // Whose rules: the signed-in user when left out.
  userId?: ObjectID | undefined;
  /*
   * The person the rules belong to, given ONLY when that is not the viewer,
   * so the copy names them instead of speaking in the first person.
   */
  person?: OnCallRulesPerson | undefined;
  // For somebody else's rules: their methods, masked. See OnCallRulesTable.
  notificationMethods?: Array<NotificationMethodChoice> | undefined;
  isEditable?: boolean | undefined;
  /*
   * Namespaces the tables' stored preferences, so your own page and an
   * admin's view of somebody else's never share them.
   */
  userPreferencesKeyPrefix: string;
  noItemsMessage?: string | undefined;
}

const OnCallRulesTabs: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const location: Location = useLocation();

  const requestedKind: OnCallRuleKind =
    readOnCallRuleKind(
      new URLSearchParams(location.search).get(ON_CALL_RULE_KIND_QUERY_PARAM),
    ) || DEFAULT_ON_CALL_RULE_KIND;

  const getCardDescription: (definition: OnCallRuleKindDefinition) => string = (
    definition: OnCallRuleKindDefinition,
  ): string => {
    if (props.person) {
      return translator.translateTemplate(definition.memberCardDescription, {
        name: props.person.firstName,
      });
    }

    return translator.translateTemplate(definition.ownCardDescription);
  };

  const tabs: Array<Tab> = ON_CALL_RULE_KIND_DEFINITIONS.map(
    (definition: OnCallRuleKindDefinition): Tab => {
      return {
        name: definition.tabName,
        /*
         * Keyed by kind: the tab panel draws one child at a time in the same
         * place, and without a key React would hand the previous tab's tables
         * (and their loaded severities) to the next one.
         */
        children: (
          <OnCallRulesTable
            key={definition.kind}
            severityModelType={definition.severityModelType}
            severityForeignKeyColumn={definition.severityForeignKeyColumn}
            ruleType={definition.ruleType}
            userId={props.userId}
            notificationMethods={props.notificationMethods}
            isEditable={props.isEditable}
            onBehalfOfName={props.person?.displayName || undefined}
            userPreferencesKeyPrefix={props.userPreferencesKeyPrefix}
            noItemsMessage={props.noItemsMessage}
            getDescription={(): string => {
              return getCardDescription(definition);
            }}
          />
        ),
      };
    },
  );

  return (
    <div data-testid="on-call-rules-tabs">
      <Tabs
        /*
         * A link to this page from this page (the side menu entry, while a
         * tab is open) is a navigation the router announces with a new key:
         * the tabs start over from the address it names.
         */
        key={location.key}
        tabs={tabs}
        initialTabName={getOnCallRuleKindDefinition(requestedKind).tabName}
        onTabChange={(tab: Tab): void => {
          const definition: OnCallRuleKindDefinition | undefined =
            getOnCallRuleKindDefinitionByTabName(tab.name);

          if (!definition) {
            return;
          }

          /*
           * The open tab goes into the address in place (no history entry),
           * so a reload or a copied link opens it again. The first tab is
           * the bare address.
           */
          Navigation.setQueryString({
            [ON_CALL_RULE_KIND_QUERY_PARAM]:
              definition.kind === DEFAULT_ON_CALL_RULE_KIND
                ? null
                : definition.kind,
          });
        }}
      />
    </div>
  );
};

export default OnCallRulesTabs;
