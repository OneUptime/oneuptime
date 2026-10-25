import PageComponentProps from "../PageComponentProps";
import MitreAttackChips from "../../Components/SecurityCase/MitreAttackChips";
import SecurityEventsHowItWorksCard from "../../Components/SecurityEvents/HowItWorks/SecurityEventsHowItWorksCard";
import { getEntityRiskGuide } from "../../Components/SecurityEvents/HowItWorks/EntityRiskGuide";
import { guideToMarkdown } from "../../Components/SecurityEvents/HowItWorks/SecurityEventsGuide";
import {
  CRITICALITY_COLUMN_TITLE,
  CRITICALITY_WEIGHT_LABELS,
  ENTITY_COLUMN_TITLE,
  ENTITY_RISK_EMPTY_ACTION,
  ENTITY_RISK_EMPTY_DESCRIPTION,
  ENTITY_RISK_EMPTY_TITLE,
  ENTITY_RISK_TABLE_DESCRIPTION,
  ENTITY_RISK_TABLE_TITLE,
  LAST_RISK_COLUMN_TITLE,
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
import {
  SecurityEntityType,
  getSecurityEntityIcon,
} from "Common/Types/SecurityCase/SecurityEntity";
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
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

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

// Who the row is about: the value, with its kind under it.
const EntityCell: FunctionComponent<{ item: SecurityEntityRisk }> = (props: {
  item: SecurityEntityRisk;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const type: string = props.item.entityType || SecurityEntityType.Other;

  return (
    <div className="flex min-w-0 items-start gap-2">
      <Icon
        icon={getSecurityEntityIcon(type)}
        className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
      />
      <div className="min-w-0">
        <div className="font-mono text-sm text-gray-900 [overflow-wrap:anywhere]">
          {props.item.entityValue || ""}
        </div>
        <div className="text-xs text-gray-500">
          {translator.translateText(type) || type}
        </div>
      </div>
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

  return (
    <div className="min-w-0 text-sm">
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
 * from risk - a line that says so, with the way to Risk Scoring.
 */
const SecurityEntityRiskPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const settings: EntityRiskSettings = useEntityRiskSettings();

  return (
    <div className="space-y-6">
      {settings.isLoaded ? (
        <SecurityEventsHowItWorksCard
          guide={getEntityRiskGuide(settings.threshold)}
        />
      ) : (
        <></>
      )}

      {settings.isRiskCaseEnabled === false ? (
        <div
          className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
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
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        isViewable={true}
        onViewPage={async (item: SecurityEntityRisk): Promise<Route> => {
          return getEntityRiskRoute(item.entityValue || "");
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
          title: getEntityRiskGuide(settings.threshold).guideTitle,
          description: getEntityRiskGuide(settings.threshold).guideDescription,
          markdown: guideToMarkdown(getEntityRiskGuide(settings.threshold)),
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
            title: LAST_RISK_COLUMN_TITLE,
            type: FieldType.Date,
          },
        ]}
        selectMoreFields={{
          entityType: true,
          contributions: true,
        }}
        columns={[
          {
            field: { entityValue: true },
            title: ENTITY_COLUMN_TITLE,
            type: FieldType.Element,
            getElement: (item: SecurityEntityRisk): ReactElement => {
              return <EntityCell item={item} />;
            },
          },
          {
            field: { riskScore: true },
            title: RISK_COLUMN_TITLE,
            type: FieldType.Element,
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
            field: { criticality: true },
            title: CRITICALITY_COLUMN_TITLE,
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: SecurityEntityRisk): ReactElement => {
              const criticality: SecurityEntityCriticality | null =
                readEntityCriticality(item.criticality);

              return criticality ? (
                <EntityCriticalityPill criticality={criticality} />
              ) : (
                <span className="text-sm text-gray-400">-</span>
              );
            },
          },
          {
            field: { contributorCount: true },
            title: SOURCES_COLUMN_TITLE,
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: SecurityEntityRisk): ReactElement => {
              return <SourcesCell item={item} />;
            },
          },
          {
            field: { mitreTactics: true },
            title: TACTICS_COLUMN_TITLE,
            type: FieldType.Element,
            hideOnMobile: true,
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
                        { one: "+{{count}} more", other: "+{{count}} more" },
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
            title: LAST_RISK_COLUMN_TITLE,
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
    </div>
  );
};

export default SecurityEntityRiskPage;
