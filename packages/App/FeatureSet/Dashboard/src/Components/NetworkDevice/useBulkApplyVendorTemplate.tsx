import React, { ReactElement, useState } from "react";

import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import BadDataException from "Common/Types/Exception/BadDataException";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import { NetworkDeviceMonitoringMethodUtil } from "Common/Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import { SnmpVendorTemplate } from "Common/Types/Monitor/SnmpMonitor/SnmpVendorTemplate";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import {
  BULK_ITEM_CHANGED,
  BulkItemOutcome,
  bulkItemUnchanged,
  runBulkAction,
} from "Common/UI/Components/BulkUpdate/BulkActionRunner";
import {
  BulkActionButtonSchema,
  BulkActionOnClickProps,
} from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import BulkDeviceReader from "./BulkDeviceReader";
import { APPLY_VENDOR_TEMPLATE_ACTION_TITLE } from "./BulkDeviceActionTitles";
import { gateDeviceBulkAction } from "./BulkDeviceActionGate";
import {
  MATCH_EACH_DEVICE_VALUE,
  VendorTemplateChoice,
  VendorTemplateDecision,
  VendorTemplateMerge,
  VendorTemplatePlanSummary,
  VendorTemplateSkip,
  decideVendorTemplate,
  getGenericVendorTemplateLabel,
  getVendorTemplateOptions,
  mergeVendorTemplate,
  readVendorTemplateChoice,
  summarizeVendorTemplatePlan,
} from "./VendorTemplateApplication";

/*
 * "Apply Vendor Template" over a selection on Network -> Devices.
 *
 * The customer words it exactly: thirty Cambium switches discovered, and
 * each one opened, its Settings edited and the vendor template picked by
 * hand. This is that pick for the whole selection, from the Bulk Actions
 * menu: one question - which template, or each device's own - and one
 * Apply.
 *
 * What a device ends up with is decided in VendorTemplateApplication, which
 * the dialog's preview uses too, so what the dialog says is what happens.
 * Each device is decided again from a fresh read when the action runs (the
 * rows are as old as the page), and its lists are merged into what it holds
 * now, never overwritten.
 *
 * The writes go through the ordinary device update, one request per device
 * that needs one, so permissions, label and owner scopes and the server's
 * list limits apply exactly as on the Settings page. Four at a time: a
 * health-OID write has no server-side effect that another device's write
 * could race (no site rollup, no alert-policy monitor), so there is nothing
 * to gain by queueing them one behind another. A device that needs nothing
 * costs no request at all.
 */

export interface BulkApplyVendorTemplateResult {
  bulkActions: Array<BulkActionButtonSchema<NetworkDevice>>;
  modals: ReactElement;
}

// Re-exported: the name lives in a React-free module the docs test reads.
export { APPLY_VENDOR_TEMPLATE_ACTION_TITLE };

// Health-OID writes are independent of each other; see the note above.
export const APPLY_VENDOR_TEMPLATE_CONCURRENCY: number = 4;

/*
 * Why a device was left as it is, one sentence each. Shown against the
 * device in the result's "not changed" list.
 */
export const VENDOR_TEMPLATE_MONITOR_BACKED_REASON: string = translationKey(
  "Nothing polls this device — its status comes from the monitor bound to it — so a vendor template would collect nothing.",
);

export const VENDOR_TEMPLATE_LINKED_REASON: string = translationKey(
  'Linked to the OID Collection Template "{{template}}", which decides what it collects. Add the vendor\'s OIDs to that template, or clear it on this device first.',
);

export const VENDOR_TEMPLATE_LINKED_UNNAMED_REASON: string = translationKey(
  "Linked to an OID Collection Template, which decides what it collects. Add the vendor's OIDs to that template, or clear it on this device first.",
);

export const VENDOR_TEMPLATE_NOT_IDENTIFIED_REASON: string = translationKey(
  "Not identified yet: a device's vendor is read on its first SNMP walk. Give it SNMP credentials, or choose its template yourself.",
);

export const VENDOR_TEMPLATE_NO_MATCH_FOR_VENDOR_REASON: string =
  translationKey(
    "No vendor template matches this {{vendor}} device. Choose one yourself — {{generic}} suits most Linux-based devices.",
  );

export const VENDOR_TEMPLATE_NO_MATCH_REASON: string = translationKey(
  "No vendor template matches this device's sysObjectID ({{sysObjectId}}). Choose one yourself — {{generic}} suits most Linux-based devices.",
);

export const VENDOR_TEMPLATE_ALREADY_APPLIED_REASON: string = translationKey(
  "Already collects everything in {{template}}.",
);

/*
 * The preview under the dropdown: one sentence per template and per reason
 * a device is left alone.
 */
export const VENDOR_TEMPLATE_PLAN_APPLY: PluralTemplate = {
  one: "{{count}} device gets {{template}}.",
  other: "{{count}} devices get {{template}}.",
};

export const VENDOR_TEMPLATE_PLAN_SKIPS: Record<
  VendorTemplateSkip,
  PluralTemplate
> = {
  [VendorTemplateSkip.NotIdentified]: {
    one: "{{count}} device is not identified yet and is left as it is.",
    other: "{{count}} devices are not identified yet and are left as they are.",
  },
  [VendorTemplateSkip.NoMatchingTemplate]: {
    one: "{{count}} device has no matching template and is left as it is.",
    other:
      "{{count}} devices have no matching template and are left as they are.",
  },
  [VendorTemplateSkip.LinkedToOidTemplate]: {
    one: "{{count}} device is linked to an OID Collection Template and is left as it is.",
    other:
      "{{count}} devices are linked to an OID Collection Template and are left as they are.",
  },
  [VendorTemplateSkip.MonitorBacked]: {
    one: "{{count}} device is monitor-backed and is left as it is.",
    other: "{{count}} devices are monitor-backed and are left as they are.",
  },
};

// What the fresh read selects: everything the decision and the merge read.
export const VENDOR_TEMPLATE_DEVICE_SELECT: {
  _id: true;
  name: true;
  monitoringMethod: true;
  oidTemplateId: true;
  oidTemplate: { name: true };
  sysObjectId: true;
  sysDescr: true;
  vendor: true;
  snmpOids: true;
  snmpTables: true;
} = {
  _id: true,
  name: true,
  monitoringMethod: true,
  oidTemplateId: true,
  oidTemplate: { name: true },
  sysObjectId: true,
  sysDescr: true,
  vendor: true,
  snmpOids: true,
  snmpTables: true,
};

/*
 * The one field the dialog asks. A type alias rather than an interface so it
 * satisfies BasicFormModal's GenericObject constraint.
 */
type ApplyVendorTemplateFormData = {
  vendorTemplate: string;
};

export function getVendorTemplateSkipReason(
  translator: Translator,
  skip: VendorTemplateSkip,
  device: NetworkDevice,
): string {
  switch (skip) {
    case VendorTemplateSkip.MonitorBacked:
      return (
        translator.translateText(VENDOR_TEMPLATE_MONITOR_BACKED_REASON) ||
        VENDOR_TEMPLATE_MONITOR_BACKED_REASON
      );
    case VendorTemplateSkip.LinkedToOidTemplate:
      return device.oidTemplate?.name
        ? translator.translateTemplate(VENDOR_TEMPLATE_LINKED_REASON, {
            template: device.oidTemplate.name,
          })
        : translator.translateText(VENDOR_TEMPLATE_LINKED_UNNAMED_REASON) ||
            VENDOR_TEMPLATE_LINKED_UNNAMED_REASON;
    case VendorTemplateSkip.NotIdentified:
      return (
        translator.translateText(VENDOR_TEMPLATE_NOT_IDENTIFIED_REASON) ||
        VENDOR_TEMPLATE_NOT_IDENTIFIED_REASON
      );
    case VendorTemplateSkip.NoMatchingTemplate:
      return device.vendor
        ? translator.translateTemplate(
            VENDOR_TEMPLATE_NO_MATCH_FOR_VENDOR_REASON,
            {
              vendor: device.vendor,
              generic: getGenericVendorTemplateLabel(),
            },
          )
        : translator.translateTemplate(VENDOR_TEMPLATE_NO_MATCH_REASON, {
            sysObjectId: device.sysObjectId || "",
            generic: getGenericVendorTemplateLabel(),
          });
  }
}

function useBulkApplyVendorTemplate(): BulkApplyVendorTemplateResult {
  const translator: Translator = useTranslator();
  const [bulkActionProps, setBulkActionProps] =
    useState<BulkActionOnClickProps<NetworkDevice> | null>(null);

  type ApplyFunction = (
    actionProps: BulkActionOnClickProps<NetworkDevice>,
    choice: VendorTemplateChoice,
  ) => Promise<void>;

  const apply: ApplyFunction = async (
    actionProps: BulkActionOnClickProps<NetworkDevice>,
    choice: VendorTemplateChoice,
  ): Promise<void> => {
    const reader: BulkDeviceReader = new BulkDeviceReader({
      deviceIds: actionProps.items.map((item: NetworkDevice): string => {
        return item._id?.toString() || "";
      }),
      select: VENDOR_TEMPLATE_DEVICE_SELECT,
    });

    await runBulkAction<NetworkDevice>({
      actionProps: actionProps,
      concurrency: APPLY_VENDOR_TEMPLATE_CONCURRENCY,
      step: async (item: NetworkDevice): Promise<BulkItemOutcome> => {
        if (!item.id) {
          throw new BadDataException("Item ID not found");
        }

        const device: NetworkDevice = await reader.read(item.id);

        const decision: VendorTemplateDecision = decideVendorTemplate(
          device,
          choice,
        );

        if (decision.kind === "skip") {
          return bulkItemUnchanged(
            getVendorTemplateSkipReason(translator, decision.skip, device),
          );
        }

        const merge: VendorTemplateMerge = mergeVendorTemplate({
          snmpOids: device.snmpOids,
          snmpTables: device.snmpTables,
          template: decision.template,
        });

        if (merge.addedOidCount === 0 && merge.addedTableCount === 0) {
          return bulkItemUnchanged(
            translator.translateTemplate(
              VENDOR_TEMPLATE_ALREADY_APPLIED_REASON,
              { template: decision.template.label },
            ),
          );
        }

        /*
         * Only the list that grew is written: an unchanged list sent back
         * would be validated and stored again for nothing.
         */
        const data: JSONObject = {};

        if (merge.addedOidCount > 0) {
          data["snmpOids"] = merge.snmpOids as unknown as JSONArray;
        }

        if (merge.addedTableCount > 0) {
          data["snmpTables"] = merge.snmpTables as unknown as JSONArray;
        }

        await ModelAPI.updateById<NetworkDevice>({
          id: item.id,
          modelType: NetworkDevice,
          data: data,
        });

        return BULK_ITEM_CHANGED;
      },
    });

    setBulkActionProps(null);
  };

  /*
   * Offered while the selection has a device a probe polls: a monitor-backed
   * device collects nothing, so a selection of only those has nothing to
   * apply a template to. A mixed selection keeps the action, and its
   * monitor-backed devices are listed as left alone.
   */
  type HasPolledDeviceFunction = (items: Array<NetworkDevice>) => boolean;

  const hasPolledDevice: HasPolledDeviceFunction = (
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

  const applyAction: BulkActionButtonSchema<NetworkDevice> = {
    title: APPLY_VENDOR_TEMPLATE_ACTION_TITLE,
    buttonStyleType: ButtonStyleType.NORMAL,
    icon: IconProp.CPUChip,
    isVisible: hasPolledDevice,
    onClick: async (
      actionProps: BulkActionOnClickProps<NetworkDevice>,
    ): Promise<void> => {
      setBulkActionProps(actionProps);
    },
  };

  const closeModal: () => void = (): void => {
    setBulkActionProps(null);
  };

  type RenderPlanFunction = (
    values: FormValues<ApplyVendorTemplateFormData>,
  ) => ReactElement;

  /*
   * What Apply would do to the selection, worked out from the rows on
   * screen. Redrawn whenever the dropdown changes.
   */
  const renderPlan: RenderPlanFunction = (
    values: FormValues<ApplyVendorTemplateFormData>,
  ): ReactElement => {
    const choice: VendorTemplateChoice | null = readVendorTemplateChoice(
      (values as Record<string, unknown>)["vendorTemplate"],
    );

    if (!choice || !bulkActionProps) {
      return <></>;
    }

    const plan: VendorTemplatePlanSummary = summarizeVendorTemplatePlan(
      bulkActionProps.items,
      choice,
    );

    return (
      <ul
        className="mt-3 space-y-1 text-sm text-gray-600"
        data-testid="vendor-template-plan"
        aria-live="polite"
      >
        {plan.applying.map(
          (entry: { template: SnmpVendorTemplate; deviceCount: number }) => {
            return (
              <li
                key={`apply-${entry.template.id}`}
                className="text-gray-900"
                data-testid="vendor-template-plan-apply"
              >
                {translator.translatePlural(
                  VENDOR_TEMPLATE_PLAN_APPLY,
                  entry.deviceCount,
                  { template: entry.template.label },
                )}
              </li>
            );
          },
        )}
        {plan.skipped.map(
          (entry: { skip: VendorTemplateSkip; deviceCount: number }) => {
            return (
              <li
                key={`skip-${entry.skip}`}
                data-testid="vendor-template-plan-skip"
              >
                {translator.translatePlural(
                  VENDOR_TEMPLATE_PLAN_SKIPS[entry.skip],
                  entry.deviceCount,
                )}
              </li>
            );
          },
        )}
      </ul>
    );
  };

  const modals: ReactElement = (
    <>
      {bulkActionProps && (
        <BasicFormModal<ApplyVendorTemplateFormData>
          title={APPLY_VENDOR_TEMPLATE_ACTION_TITLE}
          description="Adds the template's health OIDs and SNMP tables to every selected device, as choosing it on a device's Settings does, and removes nothing a device already collects. Devices imported from a discovery scan get theirs on their first poll."
          onClose={closeModal}
          submitButtonText="Apply Template"
          onSubmit={async (formData: ApplyVendorTemplateFormData) => {
            const actionProps: BulkActionOnClickProps<NetworkDevice> | null =
              bulkActionProps;

            /*
             * The field is required and every option is a template or the
             * match, so an unknown value means the option list itself is
             * wrong. Nothing is written for it.
             */
            const choice: VendorTemplateChoice | null =
              readVendorTemplateChoice(formData.vendorTemplate);

            setBulkActionProps(null);

            if (!actionProps || !choice) {
              return;
            }

            await apply(actionProps, choice);
          }}
          formProps={{
            fields: [
              {
                field: {
                  vendorTemplate: true,
                },
                title: "Vendor Template",
                description:
                  "Matching picks each device's template from what its SNMP walk reports, so a mixed selection gets the right one everywhere.",
                fieldType: FormFieldSchemaType.Dropdown,
                required: true,
                defaultValue: MATCH_EACH_DEVICE_VALUE,
                dropdownOptions: getVendorTemplateOptions(
                  (english: string): string => {
                    return translator.translateText(english) || english;
                  },
                ),
                placeholder: "Select a vendor template",
                getFooterElement: (
                  values: FormValues<ApplyVendorTemplateFormData>,
                ): ReactElement => {
                  return renderPlan(values);
                },
              },
            ],
          }}
        />
      )}
    </>
  );

  return {
    bulkActions: [gateDeviceBulkAction(applyAction)],
    modals: modals,
  };
}

export default useBulkApplyVendorTemplate;
