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
import GlossaryTerm from "Common/Types/Docs/GlossaryTerm";
import DefinedTerm from "Common/UI/Components/Glossary/DefinedTerm";
import LearnMoreLink from "Common/UI/Components/Link/LearnMoreLink";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The line over the tabs, and the word it defines. These are the person's
 * own rules, the grid behind How to Reach Me; "On-Call Rules" are the
 * project's, under Incidents and Alerts (#6817), so the line defines the
 * notification method instead of calling these by that name.
 */
export const ON_CALL_RULES_INTRO: string = translationKey(
  "These rules decide which {{notificationMethod}} a page tries, and after how long, for each severity.",
);
export const ON_CALL_RULES_INTRO_TERM: string = translationKey(
  "notification method",
);
export const ON_CALL_RULES_INTRO_TEST_ID: string = "on-call-rules-intro";

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
 *
 * The address is read and written the way the rest of the dashboard keeps
 * page state in it (Navigation.getQueryStringByName / setQueryString, as the
 * topology tabs and the tables' filters do): in place, without a router
 * navigation or a history entry, and read back from the same place, so the
 * tab drawn and the address shown never disagree.
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
  /*
   * The cards that differ from the person's ladder (How to Reach Me, by
   * getPagingLadderCellKey), marked on their title, and what to call when a
   * rule is added, changed or removed, so the ladder above reads them again.
   */
  differingCellKeys?: ReadonlySet<string> | undefined;
  onRulesChanged?: (() => void) | undefined;
}

const OnCallRulesTabs: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const requestedKind: OnCallRuleKind =
    readOnCallRuleKind(
      Navigation.getQueryStringByName(ON_CALL_RULE_KIND_QUERY_PARAM),
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

  // The same for the card of an archived severity.
  const getArchivedCardDescription: (
    definition: OnCallRuleKindDefinition,
  ) => string = (definition: OnCallRuleKindDefinition): string => {
    if (props.person) {
      return translator.translateTemplate(
        definition.memberArchivedCardDescription,
        {
          name: props.person.firstName,
        },
      );
    }

    return translator.translateTemplate(definition.ownArchivedCardDescription);
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
            cardDescription={getCardDescription(definition)}
            archivedCardDescription={getArchivedCardDescription(definition)}
            differingCellKeys={props.differingCellKeys}
            onRulesChanged={props.onRulesChanged}
          />
        ),
      };
    },
  );

  return (
    <div data-testid="on-call-rules-tabs">
      {/*
       * What these rules are, in a line, with the word they turn on
       * defined, and the docs page.
       */}
      <div
        className="mb-4 text-sm text-gray-500"
        data-testid={ON_CALL_RULES_INTRO_TEST_ID}
      >
        <TranslatedSentence
          template={ON_CALL_RULES_INTRO}
          slots={{
            notificationMethod: (
              <DefinedTerm term={GlossaryTerm.NotificationMethod}>
                {translator.translateText(ON_CALL_RULES_INTRO_TERM)}
              </DefinedTerm>
            ),
          }}
        />{" "}
        <LearnMoreLink
          docsPath="/docs/notifications/on-call-rules"
          dataTestId="on-call-rules-learn-more"
        />
      </div>
      <Tabs
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
