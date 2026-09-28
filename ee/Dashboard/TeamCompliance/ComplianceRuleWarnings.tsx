import {
  RuleWarningGroup,
  getRuleWarningGroups,
  isFixedInProjectNotificationSettings,
} from "./ComplianceView";
import PageMap from "@oneuptime/dashboard/Utils/PageMap";
import RouteMap, { RouteUtil } from "@oneuptime/dashboard/Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import type { TeamComplianceRuleJSON } from "Common/Types/Team/TeamComplianceStatus";
import AlertBanner, {
  AlertBannerType,
} from "Common/UI/Components/AlertBanner/AlertBanner";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Problems with a rule itself rather than with any member - above all, a rule
 * on a channel the project has switched off (Call is off by default), which no
 * member can ever pass however carefully they set themselves up. Said once, at
 * the top, with the rule it is about and a way to the setting that fixes it,
 * so nobody spends an afternoon chasing members over a project switch.
 */
export interface ComponentProps {
  rules: Array<TeamComplianceRuleJSON>;
}

const ComplianceRuleWarnings: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const groups: Array<RuleWarningGroup> = getRuleWarningGroups(props.rules);

  if (groups.length === 0) {
    return <></>;
  }

  const showSettingsLink: boolean = groups.some(
    (group: RuleWarningGroup): boolean => {
      return isFixedInProjectNotificationSettings(group);
    },
  );

  const title: string =
    groups.length === 1
      ? "1 rule has a problem members cannot fix"
      : `${groups.length} rules have problems members cannot fix`;

  return (
    <AlertBanner
      title={title}
      type={AlertBannerType.Warning}
      className="mb-5"
      dataTestId="compliance-rule-warnings"
      rightElement={
        showSettingsLink ? (
          <Link
            to={RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_NOTIFICATION_SETTINGS] as Route,
            )}
            className="inline-flex items-center gap-1 rounded text-sm font-medium text-amber-800 underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <span data-testid="compliance-rule-warnings-settings-link">
              Open notification settings
            </span>
            <Icon icon={IconProp.ChevronRight} className="h-4 w-4" />
          </Link>
        ) : undefined
      }
    >
      <ul className="space-y-1.5">
        {groups.map((group: RuleWarningGroup): ReactElement => {
          return (
            <li
              key={group.rule.settingId}
              data-testid={`compliance-rule-warning-${group.rule.settingId}`}
              className="text-sm leading-relaxed text-gray-700"
            >
              <span className="font-semibold text-gray-900">
                {group.title}:
              </span>{" "}
              {group.warnings.join(" ")}
            </li>
          );
        })}
      </ul>
    </AlertBanner>
  );
};

export default ComplianceRuleWarnings;
