import React, { ReactElement, useState } from "react";

import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import BadDataException from "Common/Types/Exception/BadDataException";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { NetworkDeviceMonitoringMethodUtil } from "Common/Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import { SnmpVendorTemplate } from "Common/Types/Monitor/SnmpMonitor/SnmpVendorTemplate";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import {
  BULK_ITEM_CHANGED,
  BulkItemOutcome,
  bulkItemUnchanged,
  runBulkAction,
} from "Common/UI/Components/BulkUpdate/BulkActionRunner";
import BulkReadAhead from "Common/UI/Components/BulkUpdate/BulkReadAhead";
import {
  BulkActionButtonSchema,
  BulkActionOnClickProps,
} from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
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
  getVendorTemplateWriteData,
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
 * now, never overwritten. The devices are read fifty at a time, each window
 * just before its devices are written (BulkReadAhead, as every bulk action
 * that reads before it writes): one list request for fifty devices, not one
 * read each.
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
 * A device the fresh read did not find: deleted since the list was loaded,
 * or no longer one the person may read. It fails on its own, saying so, and
 * nothing is written to it.
 */
export const DEVICE_NOT_READABLE_MESSAGE: string = translationKey(
  "This device could not be read. It may have been deleted since the list was loaded.",
);

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
 * The fresh reads of a run, a window of fifty devices at a time
 * (BULK_READ_WINDOW_SIZE): the first device of a window the run asks about
 * reads the whole window in one list request, and the window's other
 * devices wait for that same request. A device the answer leaves out was
 * deleted since, or is out of reach: read() answers null for it. A window
 * whose request fails reads each of its devices on its own (getItem), so
 * one failed request costs speed, not devices.
 */
export function createVendorTemplateDeviceReader(
  items: Array<NetworkDevice>,
): BulkReadAhead<NetworkDevice, NetworkDevice> {
  return new BulkReadAhead<NetworkDevice, NetworkDevice>({
    items: items,
    getKey: (item: NetworkDevice): string => {
      return item.id?.toString() || "";
    },
    readWindow: async (
      windowItems: Array<NetworkDevice>,
    ): Promise<Map<string, NetworkDevice>> => {
      const found: Map<string, NetworkDevice> = new Map<
        string,
        NetworkDevice
      >();

      const ids: Array<string> = windowItems
        .map((item: NetworkDevice): string => {
          return item.id?.toString() || "";
        })
        .filter((id: string): boolean => {
          return id.length > 0;
        });

      if (ids.length === 0) {
        return found;
      }

      const query: Query<NetworkDevice> = {
        _id: new Includes(ids),
      } as Query<NetworkDevice>;

      /*
       * The project the page is working in. The API scopes every read to it
       * anyway; naming it keeps this read the same shape as the table's.
       */
      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

      if (projectId) {
        (query as Record<string, unknown>)["projectId"] = projectId;
      }

      const result: ListResult<NetworkDevice> =
        await ModelAPI.getList<NetworkDevice>({
          modelType: NetworkDevice,
          query: query,
          limit: ids.length,
          skip: 0,
          select: VENDOR_TEMPLATE_DEVICE_SELECT,
          sort: {},
        });

      for (const device of result.data) {
        const id: string | undefined = device._id?.toString();

        if (id) {
          found.set(id, device);
        }
      }

      return found;
    },
    readOne: async (item: NetworkDevice): Promise<NetworkDevice | null> => {
      if (!item.id) {
        return null;
      }

      // Null for a device the API cannot find (404), as the window's answer.
      return await ModelAPI.getItem<NetworkDevice>({
        modelType: NetworkDevice,
        id: item.id,
        select: VENDOR_TEMPLATE_DEVICE_SELECT,
      });
    },
  });
}

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
    const reader: BulkReadAhead<NetworkDevice, NetworkDevice> =
      createVendorTemplateDeviceReader(actionProps.items);

    await runBulkAction<NetworkDevice>({
      actionProps: actionProps,
      concurrency: APPLY_VENDOR_TEMPLATE_CONCURRENCY,
      step: async (item: NetworkDevice): Promise<BulkItemOutcome> => {
        if (!item.id) {
          throw new BadDataException("Item ID not found");
        }

        const device: NetworkDevice | null = await reader.read(item);

        if (!device) {
          throw new BadDataException(
            translator.translateText(DEVICE_NOT_READABLE_MESSAGE) ||
              DEVICE_NOT_READABLE_MESSAGE,
          );
        }

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

        // Only the list that grew is written (getVendorTemplateWriteData).
        const data: JSONObject = getVendorTemplateWriteData(merge);

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
          description="Adds the template's health OIDs and SNMP tables to every selected device, and removes nothing a device already collects."
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
                  "Matching picks each device's template from what it reports over SNMP.",
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
