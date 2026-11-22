import {
  ACCESS_RULES_MECHANISMS,
  ADDRESSES_HELD,
  ADDRESSES_HELD_NO_LIMIT,
  ADDRESSES_PROTECTED_TOAST,
  CLOUDFLARE_BLOCKING_TEST_IDS,
  FREE_PLAN_RULES,
  LAST_ERROR_TITLE,
  LIST_MECHANISM,
  PROTECT_ADDRESSES_BUTTON,
  PUTTING_BACK_TOAST,
  PUT_IT_BACK_BUTTON,
  RULE_PROBLEMS,
  SETTING_UP_NOTICE,
  SKIP_ADDRESSES_NOTICE,
  SKIP_ADDRESS_DESCRIPTION,
} from "./CloudflareBlockingCopy";
import SecurityProtectedEntity from "Common/Models/DatabaseModels/SecurityProtectedEntity";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import { SecurityEntityType } from "Common/Types/SecurityCase/SecurityEntity";
import {
  CLOUDFLARE_BLOCK_LIST_NAMES,
  CloudflareAccessRulesReason,
  CloudflareActionStatus,
  CloudflareBlockingMechanism,
  CloudflareBlockingStatus,
  CloudflarePlan,
  CloudflareRuleState,
  CloudflareZoneRuleStatus,
  CloudflareZoneStatus,
} from "Common/Types/SecurityBlocklist/CloudflareBlocking";
import { SecurityBlockAction } from "Common/Types/SecurityBlocklist/SecurityBlock";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Toast from "Common/UI/Utils/Toast";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * HOW BLOCKING AT CLOUDFLARE STANDS (#10343), on a connection that has it
 * on: what OneUptime last found there (the connection's blockingStatus).
 *
 *   - each action's mechanism - a list with a rule in each zone, or IP
 *     Access Rules, and why;
 *   - how many addresses Cloudflare holds of how many the plan allows;
 *   - a zone whose rule was turned off, deleted or changed at Cloudflare,
 *     or is not set up yet, in the connection's own words ("Your rule in
 *     example.com was turned off: blocks there are not enforced"), with Put
 *     It Back;
 *   - on a Free zone, how many of its five custom rules OneUptime's take;
 *   - the addresses the zones' own skip rules let through, with one click
 *     to protect them - OneUptime's rules run first, so a skip rule no
 *     longer keeps a block off them;
 *   - what failed the last time OneUptime changed or checked Cloudflare, in
 *     the server's words, and when it last checked.
 */

export interface ComponentProps {
  projectId: ObjectID | null;
  status: CloudflareBlockingStatus | null;
  failure: { error: string; errorAt: string } | null;
  isSettingUp: boolean;
  isWorking: boolean;
  onPutBack: (zoneId: string) => void;
}

const ACTION_LABELS: Record<SecurityBlockAction, string> = {
  [SecurityBlockAction.Block]: translationKey("Block"),
  [SecurityBlockAction.Challenge]: translationKey("Challenge"),
};

// The zones' skip-rule addresses, each once.
export function readSkipAddresses(
  status: CloudflareBlockingStatus | null,
): Array<string> {
  const addresses: Array<string> = [];

  for (const zone of status?.zones || []) {
    for (const value of zone.skipAddresses || []) {
      if (!addresses.includes(value)) {
        addresses.push(value);
      }
    }
  }

  return addresses;
}

// How an action is enforced, in the reader's words.
export function describeMechanism(
  translator: Translator,
  action: CloudflareActionStatus,
): string {
  if (action.choice.mechanism === CloudflareBlockingMechanism.List) {
    return translator.translateTemplate(LIST_MECHANISM, {
      list: CLOUDFLARE_BLOCK_LIST_NAMES[action.action],
    });
  }

  return translator.translateTemplate(
    ACCESS_RULES_MECHANISMS[
      action.choice.reason || CloudflareAccessRulesReason.NoListLeft
    ],
    {
      zone: action.choice.zoneName || "",
      used: translator.formatNumber(action.choice.rulesUsed || 0),
      limit: translator.formatNumber(action.choice.rulesLimit || 0),
    },
  );
}

const CloudflareBlockingStatusView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [protectedNow, setProtectedNow] = useState<Array<string>>([]);
  const [isProtecting, setIsProtecting] = useState<boolean>(false);
  const status: CloudflareBlockingStatus | null = props.status;

  const skipAddresses: Array<string> = readSkipAddresses(status).filter(
    (value: string): boolean => {
      return !protectedNow.includes(value);
    },
  );

  const protect: () => Promise<void> = async (): Promise<void> => {
    if (!props.projectId) {
      return;
    }

    setIsProtecting(true);

    try {
      for (const value of skipAddresses) {
        const entity: SecurityProtectedEntity = new SecurityProtectedEntity();
        entity.projectId = props.projectId;
        entity.entityType = SecurityEntityType.IpAddress;
        entity.value = value;
        entity.description =
          translator.translateText(SKIP_ADDRESS_DESCRIPTION) ||
          SKIP_ADDRESS_DESCRIPTION;

        await ModelAPI.create<SecurityProtectedEntity>({
          model: entity,
          modelType: SecurityProtectedEntity,
        });
      }

      Toast.success(
        translator.translatePlural(
          ADDRESSES_PROTECTED_TOAST,
          skipAddresses.length,
        ),
      );
      setProtectedNow([...protectedNow, ...skipAddresses]);
    } catch (error) {
      Toast.error(API.getFriendlyMessage(error));
    } finally {
      setIsProtecting(false);
    }
  };

  const problemZones: Array<{
    zone: CloudflareZoneStatus;
    rule: CloudflareZoneRuleStatus;
  }> = [];

  for (const zone of status?.zones || []) {
    const rule: CloudflareZoneRuleStatus | undefined = zone.rules.find(
      (candidate: CloudflareZoneRuleStatus): boolean => {
        return candidate.state !== CloudflareRuleState.Enforcing;
      },
    );

    if (rule) {
      problemZones.push({ zone, rule });
    }
  }

  return (
    <div
      className="space-y-4"
      data-testid={CLOUDFLARE_BLOCKING_TEST_IDS.status}
    >
      {props.isSettingUp ? (
        <Alert type={AlertType.INFO} title={SETTING_UP_NOTICE} />
      ) : (
        <></>
      )}

      {props.failure ? (
        <Alert
          type={AlertType.WARNING}
          strongTitle={LAST_ERROR_TITLE}
          title={props.failure.error}
        />
      ) : (
        <></>
      )}

      {status && status.actions.length > 0 ? (
        <dl className="space-y-2 text-sm">
          {status.actions.map(
            (action: CloudflareActionStatus): ReactElement => {
              return (
                <div key={action.action} className="flex flex-wrap gap-x-2">
                  <dt className="font-medium text-gray-900">
                    {translator.translateText(ACTION_LABELS[action.action])}
                  </dt>
                  <dd className="text-gray-700">
                    {describeMechanism(translator, action)}
                  </dd>
                </div>
              );
            },
          )}
          <div className="text-gray-700">
            {status.usage.limit === null
              ? translator.translateTemplate(ADDRESSES_HELD_NO_LIMIT, {
                  used: translator.formatNumber(status.usage.items),
                })
              : translator.translateTemplate(ADDRESSES_HELD, {
                  used: translator.formatNumber(status.usage.items),
                  limit: translator.formatNumber(status.usage.limit),
                })}
          </div>
        </dl>
      ) : (
        <></>
      )}

      {problemZones.map(
        (problem: {
          zone: CloudflareZoneStatus;
          rule: CloudflareZoneRuleStatus;
        }): ReactElement => {
          return (
            <div
              key={problem.zone.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 p-3"
              data-testid={CLOUDFLARE_BLOCKING_TEST_IDS.zoneProblem}
            >
              <p className="text-sm text-amber-900">
                {translator.translateTemplate(
                  RULE_PROBLEMS[
                    problem.rule.state as Exclude<
                      CloudflareRuleState,
                      CloudflareRuleState.Enforcing
                    >
                  ],
                  { zone: problem.zone.name },
                )}
              </p>
              <Button
                title={PUT_IT_BACK_BUTTON}
                buttonStyle={ButtonStyleType.OUTLINE}
                disabled={props.isWorking || props.isSettingUp}
                onClick={(): void => {
                  Toast.info(
                    translator.translateText(PUTTING_BACK_TOAST) ||
                      PUTTING_BACK_TOAST,
                  );
                  props.onPutBack(problem.zone.id);
                }}
              />
            </div>
          );
        },
      )}

      {(status?.zones || [])
        .filter((zone: CloudflareZoneStatus): boolean => {
          return zone.plan === CloudflarePlan.Free && zone.rules.length > 0;
        })
        .map((zone: CloudflareZoneStatus): ReactElement => {
          return (
            <p key={zone.id} className="text-sm text-gray-600">
              {translator.translatePlural(FREE_PLAN_RULES, zone.rules.length, {
                limit: translator.formatNumber(zone.rulesLimit),
                zone: zone.name,
              })}
            </p>
          );
        })}

      {skipAddresses.length > 0 ? (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-gray-200 p-3"
          data-testid={CLOUDFLARE_BLOCKING_TEST_IDS.skipAddresses}
        >
          <p className="text-sm text-gray-700">
            {translator.translateTemplate(SKIP_ADDRESSES_NOTICE, {
              addresses: skipAddresses.join(", "),
            })}
          </p>
          <Button
            title={PROTECT_ADDRESSES_BUTTON}
            buttonStyle={ButtonStyleType.OUTLINE}
            isLoading={isProtecting}
            disabled={!props.projectId}
            onClick={(): void => {
              void protect();
            }}
          />
        </div>
      ) : (
        <></>
      )}

      {status?.checkedAt ? (
        <p className="text-xs text-gray-500">
          {translator.translateTemplate("Checked {{time}}", {
            time: OneUptimeDate.fromNow(new Date(status.checkedAt)),
          })}
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

export default CloudflareBlockingStatusView;
