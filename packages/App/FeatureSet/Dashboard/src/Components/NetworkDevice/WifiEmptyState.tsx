import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AppLink from "../AppLink/AppLink";
import {
  VendorTemplateMerge,
  mergeVendorTemplate,
} from "./VendorTemplateApplication";
import {
  WIFI_VENDORS_DOCS_PATH,
  WifiAdvice,
  WifiAdviceDeviceFacts,
  WifiAdviceKind,
  getWifiAdvice,
} from "./WifiTemplateAdvice";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import { SnmpVendorTemplate } from "Common/Types/Monitor/SnmpMonitor/SnmpVendorTemplate";
import ObjectID from "Common/Types/ObjectID";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { DOCS_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

export interface ComponentProps {
  modelId: ObjectID;
  // What the page read: identity, monitoring method, links and own tables.
  device: WifiAdviceDeviceFacts;
}

// What a fresh read of the device needs before a template is merged into it.
const APPLY_SELECT: JSONObject = {
  monitoringMethod: true,
  oidTemplateId: true,
  sysObjectId: true,
  sysDescr: true,
  snmpOids: true,
  snmpTables: true,
};

/*
 * The Wi-Fi tab of a device that reports no Wi-Fi tables yet. It says what
 * to do for THIS device (WifiTemplateAdvice): apply its vendor's template
 * with one click, wait for the next poll, or - where a template cannot
 * help - why not and where to go instead. Every variant links the docs'
 * table of what each vendor reports over SNMP, so a reader with Juniper Mist
 * or TP-Link Omada access points learns what works for them too.
 */
const WifiEmptyState: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const [isApplying, setIsApplying] = useState<boolean>(false);
  const [applyError, setApplyError] = useState<string>("");
  const [appliedTemplate, setAppliedTemplate] =
    useState<SnmpVendorTemplate | null>(null);

  const advice: WifiAdvice = getWifiAdvice(props.device);

  const settingsLink: ReactElement = (
    <AppLink
      to={RouteUtil.populateRouteParams(
        RouteMap[PageMap.NETWORK_DEVICE_VIEW_SETTINGS] as Route,
        { modelId: props.modelId },
      )}
    >
      {translator.translateTemplate("Settings")}
    </AppLink>
  );

  const docsLink: ReactElement = (
    <div data-testid="network-device-wifi-vendors-docs">
      <Link
        to={URL.fromString(`${DOCS_URL.toString()}${WIFI_VENDORS_DOCS_PATH}`)}
        openInNewTab={true}
        className="inline-flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-indigo-600"
      >
        {translator.translateText(
          "Which access points report Wi-Fi over SNMP",
        )}
        <Icon icon={IconProp.ExternalLink} className="h-3.5 w-3.5" />
      </Link>
    </div>
  );

  /*
   * Reads the device again (the page's copy is as old as the page), decides
   * again, and writes only the lists the template adds to - the same merge
   * as "Apply Vendor Template" on the Devices list.
   */
  const applyTemplate: () => Promise<void> = async (): Promise<void> => {
    setIsApplying(true);
    setApplyError("");

    try {
      const fresh: NetworkDevice | null = await ModelAPI.getItem<NetworkDevice>(
        {
          modelType: NetworkDevice,
          id: props.modelId,
          select: APPLY_SELECT,
        },
      );

      const freshAdvice: WifiAdvice = getWifiAdvice({
        monitoringMethod: fresh?.monitoringMethod,
        oidTemplateId: fresh?.oidTemplateId,
        sysObjectId: fresh?.sysObjectId,
        sysDescr: fresh?.sysDescr,
        snmpTables: fresh?.snmpTables,
      });

      if (freshAdvice.kind !== WifiAdviceKind.ApplyTemplate) {
        setApplyError(
          translator.translateText(
            "This device changed since the page opened. Reload the page to see what it needs now.",
          ) ||
            "This device changed since the page opened. Reload the page to see what it needs now.",
        );
        return;
      }

      const merge: VendorTemplateMerge = mergeVendorTemplate({
        snmpOids: fresh?.snmpOids,
        snmpTables: fresh?.snmpTables,
        template: freshAdvice.template,
      });

      const data: JSONObject = {};

      if (merge.addedOidCount > 0) {
        data["snmpOids"] = merge.snmpOids as unknown as JSONArray;
      }

      if (merge.addedTableCount > 0) {
        data["snmpTables"] = merge.snmpTables as unknown as JSONArray;
      }

      if (Object.keys(data).length > 0) {
        await ModelAPI.updateById<NetworkDevice>({
          modelType: NetworkDevice,
          id: props.modelId,
          data: data,
        });
      }

      setAppliedTemplate(freshAdvice.template);
    } catch (err) {
      setApplyError(API.getFriendlyMessage(err));
    } finally {
      setIsApplying(false);
    }
  };

  const renderDescription: () => ReactElement = (): ReactElement => {
    if (appliedTemplate) {
      return (
        <>
          {translator.translateTemplate(
            "Applied the {{template}} template. This device's radios and SSIDs appear here after its next poll.",
            { template: appliedTemplate.label },
          )}
        </>
      );
    }

    switch (advice.kind) {
      case WifiAdviceKind.ApplyTemplate:
        return (
          <>
            {translator.translateTemplate(
              "The {{template}} template reads this device's radios and SSIDs over SNMP. Apply it, and they appear here after the next poll.",
              { template: advice.template.label },
            )}
          </>
        );
      case WifiAdviceKind.WaitForPoll:
        return (
          <>
            {translator.translateTemplate(
              "This device walks the {{template}} template's Wi-Fi tables. Its radios and SSIDs appear here after its next successful SNMP poll.",
              { template: advice.template.label },
            )}
          </>
        );
      case WifiAdviceKind.NotIdentified:
        return (
          <TranslatedSentence
            template="This device has not been read over SNMP yet, so its vendor is not known. Once a poll reads it, this page offers the vendor's Wi-Fi template. Check its SNMP credentials in {{settings}}."
            slots={{ settings: settingsLink }}
          />
        );
      case WifiAdviceKind.LinkedToOidTemplate:
        return (
          <>
            {translator.translateText(
              "This device takes its SNMP tables from an OID Collection Template. Add your access points' vendor tables to that template - its table editor offers them under Add a Vendor's Tables.",
            )}
          </>
        );
      case WifiAdviceKind.MonitorBacked:
        return (
          <TranslatedSentence
            template="A monitor reports this device's health, so it is not walked over SNMP and reports no radios. Switch it to probe polling in {{settings}} to read them."
            slots={{ settings: settingsLink }}
          />
        );
      default:
        return (
          <TranslatedSentence
            template="Radios and SSIDs appear here once the device walks a Wi-Fi table. Cambium, Ubiquiti UniFi, HPE Aruba and Extreme Networks have vendor templates that read them - apply one in {{settings}}."
            slots={{ settings: settingsLink }}
          />
        );
    }
  };

  const footer: ReactElement = (
    <div className="flex flex-col items-center gap-4">
      {advice.kind === WifiAdviceKind.ApplyTemplate && !appliedTemplate ? (
        <Button
          title="Apply Template"
          buttonStyle={ButtonStyleType.PRIMARY}
          icon={IconProp.Wifi}
          isLoading={isApplying}
          onClick={() => {
            void applyTemplate();
          }}
          dataTestId="network-device-wifi-apply-template"
        />
      ) : (
        <></>
      )}
      {applyError ? (
        <p
          className="max-w-xl text-sm text-red-700"
          data-testid="network-device-wifi-apply-error"
        >
          {applyError}
        </p>
      ) : (
        <></>
      )}
      {docsLink}
    </div>
  );

  return (
    <EmptyState
      id="network-device-wifi-empty"
      icon={IconProp.Wifi}
      title={
        appliedTemplate
          ? "Template applied"
          : advice.kind === WifiAdviceKind.ApplyTemplate
            ? "Wi-Fi template available"
            : "No Wi-Fi radios reported"
      }
      description={renderDescription()}
      footer={footer}
    />
  );
};

export default WifiEmptyState;
