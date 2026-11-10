import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceNamingRule from "Common/Models/DatabaseModels/NetworkDeviceNamingRule";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import {
  BulkActionButtonSchema,
  BulkActionOnClickProps,
} from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, { ReactElement, useState } from "react";
import ApplyNamingRulesModal from "./ApplyNamingRulesModal";

/*
 * "Apply Naming Rules" in the Devices list's Bulk Actions (issue #6619): the
 * selected devices checked against the project's naming rules, in the same
 * dialog as the rules page's "Apply to existing devices" - a preview of
 * every rename, then one confirm. For the devices of one site, one vendor,
 * or one search, rather than the whole project.
 *
 * Applying the rules is using them, so the action is locked - with why -
 * for a reader who may not edit the naming rules, as the server refuses
 * them (NetworkDeviceNamingAPI).
 */

export const APPLY_NAMING_RULES_ACTION_TITLE: string =
  translationKey("Apply Naming Rules");

export interface BulkApplyNamingRulesResult {
  bulkActions: Array<BulkActionButtonSchema<NetworkDevice>>;
  modals: ReactElement;
}

export function getSelectedDeviceIds(
  items: ReadonlyArray<NetworkDevice>,
): Array<string> {
  return items
    .map((item: NetworkDevice): string => {
      return item._id?.toString() || "";
    })
    .filter((id: string): boolean => {
      return id.length > 0;
    });
}

export default function useBulkApplyNamingRules(options: {
  onRenamed: () => void;
}): BulkApplyNamingRulesResult {
  const [deviceIds, setDeviceIds] = useState<Array<string> | null>(null);

  const gate: PermissionGateResult = PermissionGate.check(
    new NetworkDeviceNamingRule(),
    ModelAction.Update,
  );

  const action: BulkActionButtonSchema<NetworkDevice> = {
    title: APPLY_NAMING_RULES_ACTION_TITLE,
    buttonStyleType: ButtonStyleType.NORMAL,
    icon: IconProp.Pencil,
    opensItsOwnDialog: true,
    onClick: async (
      actionProps: BulkActionOnClickProps<NetworkDevice>,
    ): Promise<void> => {
      setDeviceIds(getSelectedDeviceIds(actionProps.items));
    },
  };

  const bulkActions: Array<BulkActionButtonSchema<NetworkDevice>> =
    gate.isAllowed || !gate.disabledReason
      ? [action]
      : [{ ...action, disabled: true, tooltip: gate.disabledReason }];

  return {
    bulkActions: bulkActions,
    modals: deviceIds ? (
      <ApplyNamingRulesModal
        deviceIds={deviceIds}
        onClose={(): void => {
          setDeviceIds(null);
        }}
        onRenamed={options.onRenamed}
      />
    ) : (
      <></>
    ),
  };
}
