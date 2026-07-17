import ObjectID from "Common/Types/ObjectID";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import SnmpVendorTemplateUtil, {
  SnmpVendorTemplate,
} from "Common/Types/Monitor/SnmpMonitor/SnmpVendorTemplate";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
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

/*
 * Dismissible banner shown on the device Overview when the device's
 * sysObjectID fingerprints a vendor we ship an OID template for. Dismissal
 * is per-visit only (component state) — no persistence by design, since the
 * suggestion is cheap and stays relevant until a monitor is created.
 */
const DeviceVendorTemplateBanner: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [sysObjectId, setSysObjectId] = useState<string | undefined>(
    undefined,
  );
  const [isDismissed, setIsDismissed] = useState<boolean>(false);

  useEffect(() => {
    const fetchDevice: PromiseVoidFunction = async (): Promise<void> => {
      const item: NetworkDevice | null = await ModelAPI.getItem({
        modelType: NetworkDevice,
        id: props.modelId,
        select: {
          sysObjectId: true,
        },
      });

      setSysObjectId(item?.sysObjectId || undefined);
    };

    fetchDevice().catch(() => {
      /*
       * The banner is a nice-to-have hint. If the fetch fails the rest of
       * the page surfaces the error — no banner is the right fallback here.
       */
    });
  }, [props.modelId]);

  const template: SnmpVendorTemplate | undefined =
    SnmpVendorTemplateUtil.matchBySysObjectId(sysObjectId);

  if (!template || isDismissed) {
    return <></>;
  }

  const vendorName: string =
    SnmpVendorTemplateUtil.getVendorNameBySysObjectId(sysObjectId) ||
    template.label;

  return (
    <Alert
      type={AlertType.INFO}
      strongTitle="Vendor template available"
      title={`This looks like a ${vendorName} device — the ${template.label} OID template is recommended when creating monitors.`}
      onClose={() => {
        setIsDismissed(true);
      }}
      className="mb-4"
      dataTestId="device-vendor-template-banner"
    />
  );
};

export default DeviceVendorTemplateBanner;
