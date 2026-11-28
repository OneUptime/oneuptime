import Monitor from "Common/Models/DatabaseModels/Monitor";
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
import React, { ReactElement, useState } from "react";
import MonitorTemplateChangeDialog, {
  MonitorTemplateChangeDialogMode,
  MonitorTemplateChangeDialogTemplate,
} from "./MonitorTemplateChangeDialog";

/*
 * THE TEMPLATE IN A LIST OF MONITORS' BULK ACTIONS (issues #11260, #11266).
 *
 *   - On a template's Linked Monitors: Move to Another Template, and Unlink
 *     from Template - "851 of 851 monitors could not be linked" was this
 *     list's move, one request per monitor from the browser.
 *   - On every other list of monitors: Link to Template, and Unlink from
 *     Template (each from the template it is linked to) - "select monitors,
 *     Apply / Change Template, without deleting anything".
 *
 * Each opens its own dialog, which says what changes and then shows the
 * change running on the server (MonitorTemplateChangeDialog). Changing a
 * monitor's template is editing it, so the actions are locked - with why -
 * for a reader who may not edit monitors, as the server refuses them.
 */

// With the list's other actions that change what monitors check.
export const TEMPLATE_MENU_GROUP: string = "template";

export interface MonitorTemplateBulkActions {
  bulkActions: Array<BulkActionButtonSchema<Monitor>>;
  modals: ReactElement;
}

export default function useMonitorTemplateBulkActions(data: {
  // The template the list is of (its Linked Monitors), when it is.
  template?: MonitorTemplateChangeDialogTemplate | undefined;
  // A change finished: the list is read again.
  onChanged: () => void;
  /*
   * The dialog closed, a change it started perhaps still running: the
   * Monitors list shows it from then on (#11454).
   */
  onDialogClosed?: (() => void) | undefined;
}): MonitorTemplateBulkActions {
  const [open, setOpen] = useState<{
    mode: MonitorTemplateChangeDialogMode;
    monitors: Array<Monitor>;
  } | null>(null);

  const gate: PermissionGateResult = PermissionGate.check(
    new Monitor(),
    ModelAction.Update,
  );

  const action: (
    title: string,
    icon: IconProp,
    mode: MonitorTemplateChangeDialogMode,
  ) => BulkActionButtonSchema<Monitor> = (
    title: string,
    icon: IconProp,
    mode: MonitorTemplateChangeDialogMode,
  ): BulkActionButtonSchema<Monitor> => {
    const schema: BulkActionButtonSchema<Monitor> = {
      title: title,
      icon: icon,
      buttonStyleType: ButtonStyleType.NORMAL,
      menuGroup: TEMPLATE_MENU_GROUP,
      opensItsOwnDialog: true,
      onClick: async (
        actionProps: BulkActionOnClickProps<Monitor>,
      ): Promise<void> => {
        setOpen({ mode: mode, monitors: [...actionProps.items] });
      },
    };

    /*
     * "Not allowed, and nothing honest to say" (the permissions are still
     * being read) leaves the action alone, as every bulk action here does.
     */
    return gate.isAllowed || !gate.disabledReason
      ? schema
      : { ...schema, disabled: true, tooltip: gate.disabledReason };
  };

  const bulkActions: Array<BulkActionButtonSchema<Monitor>> = data.template
    ? [
        action(
          "Move to Another Template",
          IconProp.Template,
          MonitorTemplateChangeDialogMode.Move,
        ),
        action(
          "Unlink from Template",
          IconProp.Close,
          MonitorTemplateChangeDialogMode.Unlink,
        ),
      ]
    : [
        action(
          "Link to Template",
          IconProp.Template,
          MonitorTemplateChangeDialogMode.LinkTo,
        ),
        action(
          "Unlink from Template",
          IconProp.Close,
          MonitorTemplateChangeDialogMode.Unlink,
        ),
      ];

  return {
    bulkActions: bulkActions,
    modals: open ? (
      <MonitorTemplateChangeDialog
        mode={open.mode}
        monitors={open.monitors}
        template={data.template}
        onChanged={data.onChanged}
        onClose={(): void => {
          setOpen(null);
          data.onDialogClosed?.();
        }}
      />
    ) : (
      <></>
    ),
  };
}
