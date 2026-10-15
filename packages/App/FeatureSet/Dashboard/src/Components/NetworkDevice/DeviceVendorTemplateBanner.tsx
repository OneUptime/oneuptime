import {
  DeviceVendorTemplatePlan,
  getVendorTemplateWriteData,
  planDeviceVendorTemplate,
} from "./VendorTemplateApplication";
import ObjectID from "Common/Types/ObjectID";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import SnmpVendorTemplateUtil from "Common/Types/Monitor/SnmpMonitor/SnmpVendorTemplate";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import {
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  modelId: ObjectID;
}

export const VENDOR_TEMPLATE_OFFER_TITLE: string = translationKey(
  "{{vendor}} health checks are available",
);

export const VENDOR_TEMPLATE_OFFER: string = translationKey(
  "Add the {{template}} template and every poll also reads this device's health, such as CPU, memory and temperature, for its Metrics page. Nothing it already collects changes.",
);

export const VENDOR_TEMPLATE_APPLIED: string = translationKey(
  "The {{template}} template is added. Its health values are read from the next poll and charted on Metrics.",
);

/*
 * A device's offer of its vendor's health template, on its Overview: one
 * click adds the template's health OIDs and SNMP tables to the device - the
 * same merge as Bulk Actions → Apply Vendor Template and the Settings page's
 * Vendor Health Template (VendorTemplateApplication).
 *
 * It used to show on every visit to every device whose vendor has a template,
 * with no button, saying the template "is recommended when creating
 * monitors" - also on devices that collected every OID of it already (a
 * discovery import applies it on the first poll). Now it shows only while the
 * template would add something, and does what it offers.
 *
 * Dismissing it lasts for the visit only: the offer stays true until the
 * template is applied, and costs nothing to show again.
 */
const DeviceVendorTemplateBanner: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [device, setDevice] = useState<NetworkDevice | null>(null);
  const [isDismissed, setIsDismissed] = useState<boolean>(false);
  const [isApplying, setIsApplying] = useState<boolean>(false);
  const [appliedTemplate, setAppliedTemplate] = useState<string | null>(null);
  const [error, setError] = useState<string>("");

  const canEditDevice: boolean = PermissionGate.check(
    new NetworkDevice(),
    ModelAction.Update,
  ).isAllowed;

  useEffect(() => {
    const fetchDevice: PromiseVoidFunction = async (): Promise<void> => {
      const item: NetworkDevice | null = await ModelAPI.getItem({
        modelType: NetworkDevice,
        id: props.modelId,
        select: {
          sysObjectId: true,
          // Tells platforms that share an enterprise arc apart.
          sysDescr: true,
          monitoringMethod: true,
          oidTemplateId: true,
          snmpOids: true,
          snmpTables: true,
        },
      });

      setDevice(item);
    };

    fetchDevice().catch(() => {
      /*
       * The banner is an offer. If the fetch fails the rest of the page
       * surfaces the error - no banner is the right fallback here.
       */
    });
  }, [props.modelId]);

  if (isDismissed) {
    return <></>;
  }

  if (appliedTemplate) {
    return (
      <Alert
        type={AlertType.SUCCESS}
        title={translator.translateTemplate(VENDOR_TEMPLATE_APPLIED, {
          template: appliedTemplate,
        })}
        onClose={() => {
          setIsDismissed(true);
        }}
        className="mb-4"
        dataTestId="device-vendor-template-applied"
      />
    );
  }

  const plan: DeviceVendorTemplatePlan | null = device
    ? planDeviceVendorTemplate({
        monitoringMethod: device.monitoringMethod,
        oidTemplateId: device.oidTemplateId,
        sysObjectId: device.sysObjectId,
        sysDescr: device.sysDescr,
        snmpOids: device.snmpOids,
        snmpTables: device.snmpTables,
      })
    : null;

  // Nothing to add, or nobody here who may add it.
  if (!device || !plan || !canEditDevice) {
    return <></>;
  }

  const vendorName: string =
    SnmpVendorTemplateUtil.getVendorName({
      sysObjectId: device.sysObjectId,
      sysDescr: device.sysDescr,
    }) || plan.template.label;

  const applyTemplate: PromiseVoidFunction = async (): Promise<void> => {
    setIsApplying(true);
    setError("");

    try {
      await ModelAPI.updateById<NetworkDevice>({
        modelType: NetworkDevice,
        id: props.modelId,
        data: getVendorTemplateWriteData(plan.merge),
      });

      setAppliedTemplate(plan.template.label);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsApplying(false);
  };

  return (
    <Alert
      type={AlertType.INFO}
      strongTitle={translator.translateTemplate(VENDOR_TEMPLATE_OFFER_TITLE, {
        vendor: vendorName,
      })}
      title={
        <div className="space-y-2">
          <div>
            {translator.translateTemplate(VENDOR_TEMPLATE_OFFER, {
              template: plan.template.label,
            })}
          </div>
          {error && (
            <div
              className="text-red-700"
              data-testid="device-vendor-template-error"
            >
              {error}
            </div>
          )}
          <div>
            <Button
              title="Add health checks"
              buttonStyle={ButtonStyleType.NORMAL}
              buttonSize={ButtonSize.Small}
              isLoading={isApplying}
              dataTestId="device-vendor-template-apply"
              onClick={() => {
                applyTemplate().catch((err: Error) => {
                  setError(API.getFriendlyMessage(err));
                  setIsApplying(false);
                });
              }}
            />
          </div>
        </div>
      }
      onClose={() => {
        setIsDismissed(true);
      }}
      className="mb-4"
      dataTestId="device-vendor-template-banner"
    />
  );
};

export default DeviceVendorTemplateBanner;
