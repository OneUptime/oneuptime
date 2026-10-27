import PageComponentProps from "../PageComponentProps";
import MitreAttackChips from "../../Components/SecurityCase/MitreAttackChips";
import { SecurityEntityChip } from "../../Components/SecurityCase/SecurityEntityChips";
import SecurityEventsHowItWorksCard from "../../Components/SecurityEvents/HowItWorks/SecurityEventsHowItWorksCard";
import { getEntityRiskGuide } from "../../Components/SecurityEvents/HowItWorks/EntityRiskGuide";
import {
  SecurityEventsGuide,
  guideToMarkdown,
} from "../../Components/SecurityEvents/HowItWorks/SecurityEventsGuide";
import {
  CRITICALITY_COLUMN_TITLE,
  CRITICALITY_WEIGHT_LABELS,
  ENTITY_COLUMN_TITLE,
  ENTITY_PLURAL,
  ENTITY_RISK_EMPTY_ACTION,
  ENTITY_RISK_EMPTY_DESCRIPTION,
  ENTITY_RISK_EMPTY_TITLE,
  ENTITY_RISK_TABLE_DESCRIPTION,
  ENTITY_RISK_TABLE_TITLE,
  ENTITY_SINGULAR,
  LAST_FINDING_COLUMN_TITLE,
  MORE_TACTICS,
  RISK_CASES_OFF_ACTION,
  RISK_CASES_OFF_DESCRIPTION,
  RISK_CASES_OFF_TEST_ID,
  RISK_CASES_OFF_TITLE,
  RISK_COLUMN_TITLE,
  SOURCES_AND_MORE,
  SOURCES_COLUMN_TITLE,
  SOURCE_COUNT,
  TACTICS_COLUMN_TITLE,
} from "../../Components/SecurityEvents/EntityRisk/EntityRiskCopy";
import EntityRiskScore from "../../Components/SecurityEvents/EntityRisk/EntityRiskScore";
import EntityLookupCard from "../../Components/SecurityEvents/EntityRisk/EntityLookupCard";
import {
  getEntityRiskRoute,
  readEntityCriticality,
} from "../../Components/SecurityEvents/EntityRisk/EntityRiskModel";
import useEntityRiskSettings, {
  EntityRiskSettings,
} from "../../Components/SecurityEvents/EntityRisk/useEntityRiskSettings";
import EntityCriticalityPill from "../../Components/SecurityEvents/EntityRisk/EntityCriticalityPill";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import SecurityEntityRisk from "Common/Models/DatabaseModels/SecurityEntityRisk";
import Route from "Common/Types/API/Route";
import GreaterThan from "Common/Types/BaseDatabase/GreaterThan";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { SecurityEntityType } from "Common/Types/SecurityCase/SecurityEntity";
import {
  RISK_ENTITY_TYPES,
  SECURITY_ENTITY_CRITICALITIES,
  SecurityEntityCriticality,
  SecurityEntityRiskContribution,
} from "Common/Types/SecurityCase/SecurityEntityRisk";
import { readRiskContributions } from "Common/Utils/SecurityCase/SecurityEntityRiskScore";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import Icon from "Common/UI/Components/Icon/Icon";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { useIsTableCard } from "Common/UI/Components/Table/TableCellContext";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

export const ENTITY_RISK_TABLE_ID: string = "security-entity-risk-table";

// The most ATT&CK tactics a row shows; the entity's page has them all.
export const ENTITY_RISK_ROW_TACTICS: number = 3;

function entityTypeOptions(): Array<DropdownOption> {
  return RISK_ENTITY_TYPES.map((type: SecurityEntityType): DropdownOption => {
    return { label: type, value: type };
  });
}

function criticalityOptions(): Array<DropdownOption> {
  return SECURITY_ENTITY_CRITICALITIES.map(
    (criticality: SecurityEntityCriticality): DropdownOption => {
      return {
        label: CRITICALITY_WEIGHT_LABELS[criticality],
        value: criticality,
      };
    },
  );
}

function routeTo(page: PageMap): Route {
  return RouteUtil.populateRouteParams(RouteMap[page] as Route);
}

/*
 * Who the row is about: the entity as every Security Events list draws one
 * (the chip of Entities and of a case's Entities), with its kind under it
 * and, when the project said how much it matters, its criticality beside
 * that. A long value is cut short to the column, whole on hover and on its
 * page: the column keeps a floor and gives up the rest, so the list does not
 * run past its card. On a phone's card its risk is here too, under it - the
 * card has no Risk field of its own to label - so a row reads in one look.
 */
const EntityCell: FunctionComponent<{
  item: SecurityEntityRisk;
  threshold: number;
}> = (props: { item: SecurityEntityRisk; threshold: number }): ReactElement => {
  const translator: Translator = useTranslator();
  const isCard: boolean = useIsTableCard();
  const type: SecurityEntityType =
    (props.item.entityType as SecurityEntityType | undefined) ||
    SecurityEntityType.Other;
  const criticality: SecurityEntityCriticality | null = readEntityCriticality(
    props.item.criticality,
  );

  return (
    <div className="grid min-w-[15rem] grid-cols-1 gap-1">
      <div className="min-w-0">
        <SecurityEntityChip
          entity={{ type: type, value: props.item.entityValue || "" }}
          // The row opens the entity's page; Correlate is a click away there.
          isLink={false}
          isValueWrapped={isCard}
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
        <span>{translator.translateText(type) || type}</span>
        {criticality ? (
          <EntityCriticalityPill criticality={criticality} />
        ) : (
          <></>
        )}
      </div>
      {isCard ? (
        <div className="mt-1">
          <EntityRiskScore
            score={props.item.riskScore || 0}
            threshold={props.threshold}
          />
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

// What found it: how many sources, and the one that adds most.
const SourcesCell: FunctionComponent<{ item: SecurityEntityRisk }> = (props: {
  item: SecurityEntityRisk;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const sources: Array<SecurityEntityRiskContribution> = readRiskContributions(
    props.item.contributions,
  ).sort(
    (
      a: SecurityEntityRiskContribution,
      b: SecurityEntityRiskContribution,
    ): number => {
      return b.points - a.points;
    },
  );

  if (sources.length === 0) {
    return <span className="text-sm text-gray-400">-</span>;
  }

  const first: SecurityEntityRiskContribution = sources[0]!;

  // Cut short to the column rather than widening it (a grid track gives up its width).
  return (
    <div className="grid min-w-[8rem] grid-cols-1 text-sm">
      <div className="font-medium text-gray-900">
        {translator.translatePlural(SOURCE_COUNT, sources.length)}
      </div>
      <div
        className="truncate text-xs text-gray-500"
        title={sources
          .map((source: SecurityEntityRiskContribution): string => {
            return source.sourceName;
          })
          .join("\n")}
      >
        {sources.length > 1
          ? translator.translatePlural(SOURCES_AND_MORE, sources.length - 1, {
              name: first.sourceName,
            })
          : first.sourceName}
      </div>
    </div>
  );
};

/*
 * Security Events > Entity Risk: who to look at first. Every user, host and
 * address the project's findings named in the last week, scored by what they
 * found (Types/SecurityCase/SecurityEntityRisk), the riskiest first; each
 * opens on a page of its own. Above it, how the score is counted, worked out
 * for the project's own threshold, and - while the project opens no case
 * from risk - a line that says so, with the way to Risk Scoring. Under it,
 * Look Up an Entity, for any value, of any kind.
 *
 * The product's one ranking of who is riskiest: the Overview's Riskiest
 * Entities is the top of this list, and the Entities page - which ranked
 * values by how many findings named them - folded into it (its address
 * opens this page).
 */
const SecurityEntityRiskPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const settings: EntityRiskSettings = useEntityRiskSettings();
  // Worked out for the project's threshold: the card and the table's help say the same.
  const guide: SecurityEventsGuide = getEntityRiskGuide(settings.threshold);
  /*
   * How many entities have risk, as the list first reads them: the guide
   * opens by itself only over an empty list, as on Detection Rules and
   * Threat Intel - an analyst looking for the riskiest met 600 pixels of
   * how it works above them on every visit.
   */
  const [entityCount, setEntityCount] = useState<number | null>(null);

  return (
    <div className="space-y-6">
      {settings.isLoaded ? (
        <SecurityEventsHowItWorksCard
          guide={guide}
          listItemCount={entityCount}
        />
      ) : (
        <></>
      )}

      {/*
       * Drawn in the quiet panel the product's other notices are (the AI
       * settings' when Enable AI is off): a card's corners and padding.
       */}
      {settings.isRiskCaseEnabled === false ? (
        <div
          className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-gray-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
          data-testid={RISK_CASES_OFF_TEST_ID}
        >
          <div className="flex min-w-0 items-start gap-3">
            <Icon
              icon={IconProp.PauseCircle}
              className="mt-0.5 h-5 w-5 flex-shrink-0 text-gray-400"
            />
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900">
                {translator.translateText(RISK_CASES_OFF_TITLE)}
              </p>
              <p className="mt-0.5 text-sm text-gray-600">
                {translator.translateText(RISK_CASES_OFF_DESCRIPTION)}
              </p>
            </div>
          </div>
          <div className="flex-shrink-0 self-end sm:self-auto">
            <Button
              title={RISK_CASES_OFF_ACTION}
              buttonStyle={ButtonStyleType.NORMAL}
              className="!ml-0"
              onClick={() => {
                Navigation.navigate(
                  routeTo(PageMap.SECURITY_EVENTS_SETTINGS_RISK_SCORING),
                );
              }}
            />
          </div>
        </div>
      ) : (
        <></>
      )}

      <ModelTable<SecurityEntityRisk>
        modelType={SecurityEntityRisk}
        id={ENTITY_RISK_TABLE_ID}
        name="Security Events > Entity Risk"
        userPreferencesKey={ENTITY_RISK_TABLE_ID}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          // An entity whose sources all went quiet is kept for its history, not listed.
          riskScore: new GreaterThan(0),
        }}
        // "Showing 1-9 of 9 entities": a row is an entity, not "an entity risk".
        singularName={ENTITY_SINGULAR}
        pluralName={ENTITY_PLURAL}
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        isViewable={true}
        viewButtonText="View"
        onViewPage={async (item: SecurityEntityRisk): Promise<Route> => {
          return getEntityRiskRoute(item.entityValue || "", item.entityType);
        }}
        onFetchSuccess={(_items: Array<SecurityEntityRisk>, total: number) => {
          // The first read decides the guide; a search or filter after it does not.
          setEntityCount((count: number | null): number => {
            return count === null ? total : count;
          });
        }}
        sortBy="riskScore"
        sortOrder={SortOrder.Descending}
        cardProps={{
          title: ENTITY_RISK_TABLE_TITLE,
          description: ENTITY_RISK_TABLE_DESCRIPTION,
        }}
        emptyState={{
          title: ENTITY_RISK_EMPTY_TITLE,
          description: ENTITY_RISK_EMPTY_DESCRIPTION,
          icon: IconProp.Fire,
          actions: [
            {
              title: ENTITY_RISK_EMPTY_ACTION,
              icon: IconProp.SquareStack3D,
              onClick: () => {
                Navigation.navigate(
                  routeTo(PageMap.SECURITY_EVENTS_RULE_LIBRARY),
                );
              },
            },
          ],
        }}
        helpContent={{
          title: guide.guideTitle,
          description: guide.guideDescription,
          markdown: guideToMarkdown(guide),
        }}
        showRefreshButton={true}
        searchableFields={["entityValue"]}
        filters={[
          {
            field: { entityValue: true },
            title: ENTITY_COLUMN_TITLE,
            type: FieldType.Text,
          },
          {
            field: { entityType: true },
            title: "Type",
            type: FieldType.Dropdown,
            filterDropdownOptions: entityTypeOptions(),
          },
          {
            field: { criticality: true },
            title: CRITICALITY_COLUMN_TITLE,
            type: FieldType.Dropdown,
            filterDropdownOptions: criticalityOptions(),
          },
          {
            field: { lastRiskAt: true },
            title: LAST_FINDING_COLUMN_TITLE,
            type: FieldType.Date,
          },
        ]}
        selectMoreFields={{
          entityType: true,
          criticality: true,
          contributions: true,
        }}
        columns={[
          {
            field: { entityValue: true },
            title: ENTITY_COLUMN_TITLE,
            type: FieldType.Element,
            wrapContent: true,
            wrapMaxWidthClassName: "max-w-[20rem]",
            // A phone's card is the entity itself: its value says what it is.
            hideTitleOnMobile: true,
            getElement: (item: SecurityEntityRisk): ReactElement => {
              return <EntityCell item={item} threshold={settings.threshold} />;
            },
          },
          {
            field: { riskScore: true },
            title: RISK_COLUMN_TITLE,
            type: FieldType.Element,
            // On a phone's card, under the entity (EntityCell).
            hideOnMobile: true,
            getElement: (item: SecurityEntityRisk): ReactElement => {
              return (
                <EntityRiskScore
                  score={item.riskScore || 0}
                  threshold={settings.threshold}
                />
              );
            },
          },
          {
            field: { contributorCount: true },
            title: SOURCES_COLUMN_TITLE,
            type: FieldType.Element,
            hideOnMobile: true,
            wrapContent: true,
            wrapMaxWidthClassName: "max-w-[14rem]",
            getElement: (item: SecurityEntityRisk): ReactElement => {
              return <SourcesCell item={item} />;
            },
          },
          {
            field: { mitreTactics: true },
            title: TACTICS_COLUMN_TITLE,
            type: FieldType.Element,
            hideOnMobile: true,
            // On the entity's page in full; here one click away (Customize Columns).
            isHiddenByDefault: true,
            wrapContent: true,
            wrapMaxWidthClassName: "max-w-xs",
            getElement: (item: SecurityEntityRisk): ReactElement => {
              const tactics: Array<string> = item.mitreTactics || [];

              return (
                <div className="flex flex-wrap items-center gap-1.5">
                  <MitreAttackChips
                    tactics={tactics.slice(0, ENTITY_RISK_ROW_TACTICS)}
                    techniques={[]}
                    emptyText="-"
                  />
                  {tactics.length > ENTITY_RISK_ROW_TACTICS ? (
                    <span className="text-xs font-medium text-gray-500">
                      {translator.translatePlural(
                        MORE_TACTICS,
                        tactics.length - ENTITY_RISK_ROW_TACTICS,
                      )}
                    </span>
                  ) : (
                    <></>
                  )}
                </div>
              );
            },
          },
          {
            field: { lastRiskAt: true },
            title: LAST_FINDING_COLUMN_TITLE,
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: SecurityEntityRisk): ReactElement => {
              if (!item.lastRiskAt) {
                return <span className="text-sm text-gray-400">-</span>;
              }

              return (
                <span
                  className="whitespace-nowrap text-sm text-gray-700"
                  title={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                    item.lastRiskAt,
                  )}
                >
                  {OneUptimeDate.fromNow(item.lastRiskAt)}
                </span>
              );
            },
          },
        ]}
      />

      <EntityLookupCard />
    </div>
  );
};

export default SecurityEntityRiskPage;
