import {
  CloudCostAllocationShare,
  CloudCostAllocationTagShare,
  CloudCostAllocationUnallocated,
} from "Common/Types/Cloud/CloudCostAllocation";
import { CloudCostRuleField } from "Common/Types/Cloud/CloudCostRules";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import { getCloudCostShareLabel } from "../CloudCostBreakdown";
import { formatCloudMoney } from "../CloudCostWords";
import { CloudCostUnallocatedPick } from "./CloudCostAddToGroupModal";
import {
  ADD_TO_GROUP,
  UNALLOCATED_ACCOUNTS,
  UNALLOCATED_DESCRIPTION,
  UNALLOCATED_NONE,
  UNALLOCATED_OWNER_TEAMS,
  UNALLOCATED_SERVICES,
  UNALLOCATED_TAG_VALUES,
  UNALLOCATED_TITLE,
  VALUE_GONE,
} from "./CloudCostGroupWords";
import { CloudCostRuleNames } from "./CloudCostRuleSummary";

/*
 * WHAT NO RULE MATCHES YET, IN PLAIN SIGHT: the services, accounts, tag
 * values and owner teams that make up a view's unallocated spend, the
 * costliest first - each with Add to Group, which starts a rule from it.
 */

interface UnallocatedRow {
  id: string;
  label: string;
  isAsWritten: boolean;
  amount: number;
  pick: CloudCostUnallocatedPick;
}

export interface ComponentProps {
  unallocated: CloudCostAllocationUnallocated;
  currency: string;
  names: CloudCostRuleNames;
  canEdit: boolean;
  onPick: (pick: CloudCostUnallocatedPick) => void;
}

const CloudCostUnallocatedCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const money: (amount: number) => string = (amount: number): string => {
    return formatCloudMoney({
      amount,
      currency: props.currency,
      translator,
    });
  };

  const sections: Array<{ title: string; rows: Array<UnallocatedRow> }> = [
    {
      title: UNALLOCATED_SERVICES,
      rows: props.unallocated.topServices.map(
        (share: CloudCostAllocationShare): UnallocatedRow => {
          const label: { label: string; isAsWritten: boolean } =
            getCloudCostShareLabel({
              dimension: "service",
              key: share.key,
              accountNames: new Map(),
            });

          return {
            id: `service-${share.key}`,
            label: label.label,
            isAsWritten: label.isAsWritten,
            amount: share.amount,
            pick: { field: CloudCostRuleField.Service, value: share.key },
          };
        },
      ),
    },
    {
      title: UNALLOCATED_ACCOUNTS,
      rows: props.unallocated.topAccounts.map(
        (share: CloudCostAllocationShare): UnallocatedRow => {
          const name: string | undefined = props.names.accounts.get(share.key);

          return {
            id: `account-${share.key}`,
            label: name || VALUE_GONE,
            isAsWritten: Boolean(name),
            amount: share.amount,
            pick: { field: CloudCostRuleField.Account, value: share.key },
          };
        },
      ),
    },
    {
      title: UNALLOCATED_TAG_VALUES,
      rows: props.unallocated.topTagValues.map(
        (share: CloudCostAllocationTagShare): UnallocatedRow => {
          return {
            id: `tag-${share.key}-${share.value}`,
            label: `${share.key}: ${share.value}`,
            isAsWritten: true,
            amount: share.amount,
            pick: {
              field: CloudCostRuleField.Tag,
              key: share.key,
              value: share.value,
            },
          };
        },
      ),
    },
    {
      title: UNALLOCATED_OWNER_TEAMS,
      rows: props.unallocated.topOwnerTeams.map(
        (share: CloudCostAllocationShare): UnallocatedRow => {
          const name: string | undefined = props.names.teams.get(share.key);

          return {
            id: `team-${share.key}`,
            label: name || VALUE_GONE,
            isAsWritten: Boolean(name),
            amount: share.amount,
            pick: { field: CloudCostRuleField.OwnerTeam, value: share.key },
          };
        },
      ),
    },
  ].filter((section: { rows: Array<UnallocatedRow> }): boolean => {
    return section.rows.length > 0;
  });

  return (
    <Card title={UNALLOCATED_TITLE} description={UNALLOCATED_DESCRIPTION}>
      <div data-testid="cloud-cost-unallocated">
        {Math.abs(props.unallocated.total) < 0.005 || sections.length === 0 ? (
          <p
            className="text-sm text-gray-600"
            data-testid="cloud-cost-unallocated-none"
          >
            {translator.translateText(UNALLOCATED_NONE)}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {sections.map(
              (section: { title: string; rows: Array<UnallocatedRow> }) => {
                return (
                  <div key={section.title} className="min-w-0">
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                      {translator.translateText(section.title)}
                    </h3>
                    <ul className="divide-y divide-gray-100">
                      {section.rows.map((row: UnallocatedRow): ReactElement => {
                        return (
                          <li
                            key={row.id}
                            className="flex items-center justify-between gap-3 py-2"
                            data-testid="cloud-cost-unallocated-row"
                          >
                            <div className="min-w-0">
                              <div
                                className="truncate text-sm text-gray-900"
                                title={row.label}
                              >
                                {row.isAsWritten ? (
                                  <bdi>{row.label}</bdi>
                                ) : (
                                  translator.translateText(row.label)
                                )}
                              </div>
                              <div className="text-xs text-gray-500">
                                {money(row.amount)}
                              </div>
                            </div>
                            {props.canEdit ? (
                              <Button
                                buttonStyle={ButtonStyleType.OUTLINE}
                                buttonSize={ButtonSize.Small}
                                title={ADD_TO_GROUP}
                                dataTestId="cloud-cost-unallocated-add"
                                onClick={() => {
                                  props.onPick(row.pick);
                                }}
                              />
                            ) : (
                              <></>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              },
            )}
          </div>
        )}
      </div>
    </Card>
  );
};

export default CloudCostUnallocatedCard;
