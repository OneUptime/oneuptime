import React, { ReactElement, useEffect, useState } from "react";

import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceOidTemplate from "Common/Models/DatabaseModels/NetworkDeviceOidTemplate";
import { NetworkDeviceMonitoringMethodUtil } from "Common/Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import BadDataException from "Common/Types/Exception/BadDataException";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import {
  BulkActionButtonSchema,
  BulkActionFailed,
  BulkActionOnClickProps,
} from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Modal from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AppLink from "../AppLink/AppLink";

/*
 * The bulk half of issue #3507.
 *
 * A template is only worth having if an EXISTING fleet can be moved onto it:
 * the reporter's routers were imported months ago, and a feature that only
 * reaches devices created after it ships would leave every one of them on
 * the hand-typed list it already has. These two actions are how an operator
 * links (and unlinks) a selection from the device list.
 *
 * Modelled on Common/UI/Components/BulkUpdate/BulkLabelActions - same hook
 * shape, same { bulkActions, modals } return, same per-item progress loop -
 * but with no per-item option computation: every selected device is offered
 * the same project-wide list of templates.
 */

export interface BulkOidTemplateActionsResult {
  bulkActions: Array<BulkActionButtonSchema<NetworkDevice>>;
  modals: ReactElement;
}

/*
 * The two columns the "Set" modal writes. Kept as a type alias rather than
 * an interface so it satisfies BasicFormModal's GenericObject constraint.
 */
type SetOidTemplateFormData = {
  oidTemplateId: string;
  shouldClearDeviceOids: boolean;
};

interface ApplyOidTemplateData {
  // null unlinks the device from whatever template it was on.
  oidTemplateId: ObjectID | null;
  shouldClearDeviceOids: boolean;
  shouldDisableVendorAutoApply: boolean;
}

function useBulkOidTemplateActions(): BulkOidTemplateActionsResult {
  const [templates, setTemplates] = useState<Array<NetworkDeviceOidTemplate>>(
    [],
  );
  const [isLoadingTemplates, setIsLoadingTemplates] = useState<boolean>(true);
  const [showSetModal, setShowSetModal] = useState<boolean>(false);
  const [bulkActionProps, setBulkActionProps] =
    useState<BulkActionOnClickProps<NetworkDevice> | null>(null);

  useEffect(() => {
    /*
     * Same guard as BulkLabelActions: `projectId: null` is not "every
     * project", it is a filter nothing matches, so the modal would silently
     * offer an empty dropdown and blame it on the project having no
     * templates.
     */
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      setIsLoadingTemplates(false);
      return;
    }

    const fetchTemplates: () => Promise<void> = async (): Promise<void> => {
      try {
        const result: ListResult<NetworkDeviceOidTemplate> =
          await ModelAPI.getList<NetworkDeviceOidTemplate>({
            modelType: NetworkDeviceOidTemplate,
            query: {
              projectId: projectId,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: {
              _id: true,
              name: true,
            },
            sort: {
              name: SortOrder.Ascending,
            },
          });
        setTemplates(result.data);
      } catch {
        /*
         * Leave the list empty. The modal then says the project has no
         * templates and points at the settings page, which is a better
         * dead end than a dropdown with nothing in it.
         */
      }

      setIsLoadingTemplates(false);
    };

    fetchTemplates();
  }, []);

  /*
   * The per-item loop. Takes the action props explicitly rather than reading
   * them off state: the "Clear" action runs straight out of its confirm
   * dialog, in the same tick as its own onClick, so a state write made there
   * would not be visible yet.
   */
  const applyOidTemplate: (
    actionProps: BulkActionOnClickProps<NetworkDevice>,
    data: ApplyOidTemplateData,
  ) => Promise<void> = async (
    actionProps: BulkActionOnClickProps<NetworkDevice>,
    data: ApplyOidTemplateData,
  ): Promise<void> => {
    const { items, onProgressInfo, onBulkActionStart, onBulkActionEnd } =
      actionProps;

    // Close the form modal first so the progress modal is visible.
    setShowSetModal(false);

    onBulkActionStart();

    const totalItems: Array<NetworkDevice> = [...items];
    const inProgressItems: Array<NetworkDevice> = [...items];
    const successItems: Array<NetworkDevice> = [];
    const failedItems: Array<BulkActionFailed<NetworkDevice>> = [];

    for (const item of totalItems) {
      inProgressItems.splice(inProgressItems.indexOf(item), 1);

      try {
        if (!item.id) {
          throw new BadDataException("Item ID not found");
        }

        /*
         * Nothing is read first, and nothing needs to be: unlike labels,
         * which are a set this action has to merge into, the link is one
         * column the operator is replacing outright. `snmpOids` is only
         * ever written when they explicitly asked for it below.
         */
        const updateData: JSONObject = {
          oidTemplateId: data.oidTemplateId,
          ...(data.shouldClearDeviceOids ? { snmpOids: [] } : {}),
          ...(data.shouldDisableVendorAutoApply
            ? { autoApplyVendorHealthTemplate: false }
            : {}),
        };

        await ModelAPI.updateById<NetworkDevice>({
          id: item.id,
          modelType: NetworkDevice,
          data: updateData,
        });

        successItems.push(item);
      } catch (err) {
        failedItems.push({
          item: item,
          failedMessage: API.getFriendlyMessage(err),
        });
      }

      onProgressInfo({
        totalItems: totalItems,
        failed: failedItems,
        successItems: successItems,
        inProgressItems: inProgressItems,
      });
    }

    onBulkActionEnd();
    setBulkActionProps(null);
  };

  const oidTemplateDropdownOptions: Array<DropdownOption> = templates.map(
    (template: NetworkDeviceOidTemplate): DropdownOption => {
      return {
        label: template.name || "",
        value: template._id?.toString() || "",
      };
    },
  );

  /*
   * Bulk actions are handed straight to the table's action bar, which never
   * looks at permissions - so a viewer on an otherwise gated table could
   * still re-point every device they had selected at another template. Both
   * of these are an update of the records they touch.
   */
  const updateGate: PermissionGateResult = PermissionGate.check(
    new NetworkDevice(),
    ModelAction.Update,
  );

  type GateActionFunction = (
    action: BulkActionButtonSchema<NetworkDevice>,
  ) => BulkActionButtonSchema<NetworkDevice>;

  const gateAction: GateActionFunction = (
    action: BulkActionButtonSchema<NetworkDevice>,
  ): BulkActionButtonSchema<NetworkDevice> => {
    if (updateGate.isAllowed || !updateGate.disabledReason) {
      return action;
    }

    return {
      ...action,
      disabled: true,
      tooltip: updateGate.disabledReason,
    };
  };

  /*
   * A monitor-backed device is never walked, so an OID list on it collects
   * nothing - the same reason the Probe and Interfaces columns on this page
   * refuse to render poll values for one (OneUptime/oneuptime#3447). Offering
   * these actions on a selection made entirely of them would write a link
   * that can never take effect and report it as a success. A MIXED selection
   * keeps both buttons: the SNMP devices in it are the point, and the
   * monitor-backed ones are simply unaffected.
   */
  type IsSnmpSelectionFunction = (items: Array<NetworkDevice>) => boolean;

  const isSnmpSelection: IsSnmpSelectionFunction = (
    items: Array<NetworkDevice>,
  ): boolean => {
    if (items.length === 0) {
      return true;
    }

    return items.some((item: NetworkDevice): boolean => {
      return !NetworkDeviceMonitoringMethodUtil.isMonitorBacked(
        item.monitoringMethod,
      );
    });
  };

  const setTemplateAction: BulkActionButtonSchema<NetworkDevice> = {
    title: "Set OID Collection Template",
    buttonStyleType: ButtonStyleType.NORMAL,
    icon: IconProp.Template,
    isVisible: isSnmpSelection,
    onClick: async (
      actionProps: BulkActionOnClickProps<NetworkDevice>,
    ): Promise<void> => {
      setBulkActionProps(actionProps);
      setShowSetModal(true);
    },
  };

  const clearTemplateAction: BulkActionButtonSchema<NetworkDevice> = {
    title: "Clear OID Collection Template",
    buttonStyleType: ButtonStyleType.NORMAL,
    icon: IconProp.LinkSlash,
    isVisible: isSnmpSelection,
    confirmTitle: (items: Array<NetworkDevice>): string => {
      return `Clear the OID Collection Template on ${items.length} ${
        items.length === 1 ? "device" : "devices"
      }?`;
    },
    confirmMessage: (items: Array<NetworkDevice>): string => {
      return `${
        items.length === 1 ? "This device" : "These devices"
      } will stop collecting the template's OIDs on the next poll, and will keep only their own Device-Specific Health OIDs. Automatic vendor health templates are switched off at the same time, so nothing seeds a replacement list behind you.`;
    },
    onClick: async (
      actionProps: BulkActionOnClickProps<NetworkDevice>,
    ): Promise<void> => {
      /*
       * Turning the vendor auto-apply toggle off is part of "clear", not a
       * separate opinion. NetworkInventoryUtil seeds a vendor health
       * template on the first poll that finds a device with the toggle on,
       * no template linked and an empty snmpOids - which is EXACTLY what
       * this action produces for a device that adopted a template cleanly.
       * Leaving the toggle on would answer "no template please" with a
       * different, unnamed one, one poll later.
       */
      await applyOidTemplate(actionProps, {
        oidTemplateId: null,
        shouldClearDeviceOids: false,
        shouldDisableVendorAutoApply: true,
      });
    },
  };

  const closeSetModal: () => void = (): void => {
    setShowSetModal(false);
    setBulkActionProps(null);
  };

  const hasNoTemplates: boolean =
    !isLoadingTemplates && oidTemplateDropdownOptions.length === 0;

  const oidTemplatesSettingsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.NETWORK_DEVICE_SETTINGS_OID_TEMPLATES] as Route,
  );

  const modals: ReactElement = (
    <>
      {showSetModal &&
        (hasNoTemplates ? (
          <Modal
            title="No OID Collection Templates Yet"
            description="An OID Collection Template is a named list of health OIDs — CPU, memory, temperature, fans, power supplies — shared by every device of one type. Create one first, then come back and link these devices to it."
            onClose={closeSetModal}
            closeButtonText="Close"
          >
            <AppLink
              to={oidTemplatesSettingsRoute}
              className="text-sm font-medium text-indigo-600 hover:underline"
            >
              Create an OID Collection Template
            </AppLink>
          </Modal>
        ) : (
          <BasicFormModal<SetOidTemplateFormData>
            title="Set OID Collection Template"
            description="Every selected device collects this template's OIDs on its next poll, on top of its own Device-Specific Health OIDs. The link is live: editing the template later changes all of them, with nothing to re-apply."
            isLoading={isLoadingTemplates}
            onClose={closeSetModal}
            submitButtonText="Set Template"
            onSubmit={async (formData: SetOidTemplateFormData) => {
              const actionProps: BulkActionOnClickProps<NetworkDevice> | null =
                bulkActionProps;

              setShowSetModal(false);

              if (!actionProps) {
                return;
              }

              /*
               * The field is required, so an empty id means the option
               * itself came back without one. Writing "" would fail every
               * device over one unusable option, so stop before starting -
               * the same reason BulkLabelActions bails on an empty
               * selection rather than reporting a no-op as a success.
               */
              const templateId: string = String(
                formData.oidTemplateId || "",
              ).trim();

              if (!templateId) {
                setBulkActionProps(null);
                return;
              }

              await applyOidTemplate(actionProps, {
                oidTemplateId: new ObjectID(templateId),
                shouldClearDeviceOids: Boolean(formData.shouldClearDeviceOids),
                /*
                 * Left alone on purpose. A device with a template linked is
                 * already exempt from vendor auto-apply in
                 * NetworkInventoryUtil, so there is nothing to switch off -
                 * and switching it off silently would change what happens
                 * later, after the template is cleared again.
                 */
                shouldDisableVendorAutoApply: false,
              });
            }}
            formProps={{
              fields: [
                {
                  field: {
                    oidTemplateId: true,
                  },
                  title: "OID Collection Template",
                  description:
                    "The template these devices collect. Per-port counters — bits in and out, oper status, errors — are already collected automatically by the interface walk, so a template is for what is not per-port: CPU, memory, temperature, fans and power supplies.",
                  fieldType: FormFieldSchemaType.Dropdown,
                  required: true,
                  dropdownOptions: oidTemplateDropdownOptions,
                  placeholder: "Select a template",
                },
                {
                  field: {
                    shouldClearDeviceOids: true,
                  },
                  title:
                    "Also clear device-specific Health OIDs on these devices",
                  description:
                    "Recommended when adopting a template. An auto-imported device already had a handful of vendor OIDs written into its own list by its first poll, and on a duplicate the device's copy wins — so that leftover would quietly override the template's naming for the same OID. Clearing is how a device moves onto the template cleanly. Leave it off to keep genuinely device-specific additions.",
                  fieldType: FormFieldSchemaType.Checkbox,
                  required: false,
                  defaultValue: false,
                },
              ],
            }}
          />
        ))}
    </>
  );

  return {
    bulkActions: [
      gateAction(setTemplateAction),
      gateAction(clearTemplateAction),
    ],
    modals: modals,
  };
}

export default useBulkOidTemplateActions;
