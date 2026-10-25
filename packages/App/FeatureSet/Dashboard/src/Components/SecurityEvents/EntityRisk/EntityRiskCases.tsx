import {
  SecurityCasePriorityPill,
  SecurityCaseStatusPill,
  getSecurityDetectionSourceIcon,
} from "../../SecurityCase/SecurityCasePills";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import {
  CASES_CARD_DESCRIPTION,
  CASES_CARD_TITLE,
  CASES_EMPTY,
  ENTITY_RISK_TEST_IDS,
} from "./EntityRiskCopy";
import SecurityCase from "Common/Models/DatabaseModels/SecurityCase";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { getEntityCaseGroupingKey } from "Common/Utils/SecurityCase/SecurityEntityRiskScore";
import Icon from "Common/UI/Components/Icon/Icon";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  entityValue: string;
}

/*
 * The security cases opened about an entity - the ones grouped on it, which
 * every detection about it joins while one is open - the latest first, each
 * opening on its page. A case another entity opened, that only mentions this
 * one, is that entity's.
 */
const EntityRiskCases: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div data-testid={ENTITY_RISK_TEST_IDS.cases}>
      <ModelTable<SecurityCase>
        modelType={SecurityCase}
        id="entity-risk-cases-table"
        name="Security Events > Entity Risk > Cases"
        userPreferencesKey="entity-risk-cases-table"
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          groupingKey: getEntityCaseGroupingKey(props.entityValue),
        }}
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        isViewable={true}
        viewButtonText="View"
        viewPageRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.SECURITY_CASES] as Route,
        )}
        sortBy="lastDetectedAt"
        sortOrder={SortOrder.Descending}
        cardProps={{
          title: CASES_CARD_TITLE,
          description: CASES_CARD_DESCRIPTION,
        }}
        emptyState={{
          title: CASES_EMPTY,
          icon: IconProp.ShieldExclamation,
          hideCreateButton: true,
        }}
        showRefreshButton={false}
        filters={[]}
        selectMoreFields={{
          caseNumberWithPrefix: true,
          source: true,
        }}
        columns={[
          {
            field: { title: true },
            title: "Case",
            type: FieldType.Element,
            getElement: (item: SecurityCase): ReactElement => {
              return (
                <div className="flex min-w-0 items-start gap-2">
                  <Icon
                    icon={getSecurityDetectionSourceIcon(item.source)}
                    className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
                  />
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-gray-500">
                      {item.caseNumberWithPrefix || ""}
                    </div>
                    <div className="text-sm font-medium text-gray-900 [overflow-wrap:anywhere]">
                      {item.title || ""}
                    </div>
                  </div>
                </div>
              );
            },
          },
          {
            field: { securityCasePriority: { name: true, color: true } },
            title: "Priority",
            type: FieldType.Element,
            getElement: (item: SecurityCase): ReactElement => {
              return (
                <SecurityCasePriorityPill value={item.securityCasePriority} />
              );
            },
          },
          {
            field: { securityCaseStatus: { name: true, color: true } },
            title: "Status",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: SecurityCase): ReactElement => {
              return <SecurityCaseStatusPill value={item.securityCaseStatus} />;
            },
          },
          {
            field: { lastDetectedAt: true },
            title: "Last Detection",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: SecurityCase): ReactElement => {
              if (!item.lastDetectedAt) {
                return <span className="text-sm text-gray-400">-</span>;
              }

              return (
                <span
                  className="whitespace-nowrap text-sm text-gray-700"
                  title={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                    item.lastDetectedAt,
                  )}
                >
                  {OneUptimeDate.fromNow(item.lastDetectedAt)}
                </span>
              );
            },
          },
        ]}
      />
    </div>
  );
};

export default EntityRiskCases;
