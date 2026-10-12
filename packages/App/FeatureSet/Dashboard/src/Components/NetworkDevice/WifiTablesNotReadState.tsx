import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AppLink from "../AppLink/AppLink";
import { WIFI_VENDORS_DOCS_PATH } from "./WifiTemplateAdvice";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { FIRST_PROBE_VERSION_WITH_SNMP_TABLES } from "Common/Types/Probe/ProbeCapability";
import { WifiTablesState } from "Common/Utils/NetworkDevice/WifiRadioUtil";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { DOCS_URL } from "Common/UI/Config";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

// Where the docs say how to run a probe - and so how to run a newer one.
export const RUN_A_PROBE_DOCS_PATH: string =
  "/probe/custom-probe#run-the-probe";

export interface ComponentProps {
  modelId: ObjectID;
  // Why the polled Wi-Fi tables hold nothing (never HasRows).
  state: WifiTablesState;
  // The last walk's failure, for WalkFailed.
  failureCause?: string | undefined;
  // The probe that polls the device, when the page could read its name.
  probeName?: string | undefined;
}

/*
 * The Wi-Fi tab of a device whose Wi-Fi tables were polled and hold
 * nothing, saying why - so the tab never promises radios "after the next
 * poll" when the next poll cannot bring them:
 *
 *   - the probe that polls it predates SNMP tables, and answers every poll
 *     without walking them: update the probe;
 *   - the last walk failed, and no earlier one read them: the cause;
 *   - the walk worked and the device reported no rows: what to check.
 *
 * A device with no Wi-Fi tables at all gets WifiEmptyState instead.
 */
const WifiTablesNotReadState: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const docsLink: (data: {
    testId: string;
    path: string;
    text: string;
  }) => ReactElement = (data: {
    testId: string;
    path: string;
    text: string;
  }): ReactElement => {
    return (
      <div data-testid={data.testId}>
        <Link
          to={URL.fromString(`${DOCS_URL.toString()}${data.path}`)}
          openInNewTab={true}
          className="inline-flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-indigo-600"
        >
          {data.text}
          <Icon icon={IconProp.ExternalLink} className="h-3.5 w-3.5" />
        </Link>
      </div>
    );
  };

  const vendorsDocsLink: ReactElement = docsLink({
    testId: "network-device-wifi-vendors-docs",
    path: WIFI_VENDORS_DOCS_PATH,
    text:
      translator.translateText("Which access points report Wi-Fi over SNMP") ||
      "Which access points report Wi-Fi over SNMP",
  });

  if (props.state === WifiTablesState.NotWalkedByProbe) {
    return (
      <EmptyState
        id="network-device-wifi-not-read"
        icon={IconProp.Signal}
        title="Update the probe to read Wi-Fi"
        description={
          <>
            {props.probeName
              ? translator.translateTemplate(
                  "{{probe}}, the probe that polls this device, answered its last poll without walking the device's Wi-Fi tables. Probes released before version {{version}} do not walk SNMP tables. Update the probe to the latest version, and the radios and SSIDs appear here after its next poll.",
                  {
                    probe: props.probeName,
                    version: FIRST_PROBE_VERSION_WITH_SNMP_TABLES,
                  },
                )
              : translator.translateTemplate(
                  "The probe that polls this device answered its last poll without walking the device's Wi-Fi tables. Probes released before version {{version}} do not walk SNMP tables. Update the probe to the latest version, and the radios and SSIDs appear here after its next poll.",
                  { version: FIRST_PROBE_VERSION_WITH_SNMP_TABLES },
                )}
          </>
        }
        footer={
          <div className="flex flex-col items-center gap-4">
            {docsLink({
              testId: "network-device-wifi-probe-docs",
              path: RUN_A_PROBE_DOCS_PATH,
              text:
                translator.translateText("How to run the latest probe") ||
                "How to run the latest probe",
            })}
            {vendorsDocsLink}
          </div>
        }
      />
    );
  }

  if (props.state === WifiTablesState.WalkFailed) {
    return (
      <EmptyState
        id="network-device-wifi-not-read"
        icon={IconProp.Wifi}
        title="Wi-Fi tables could not be read"
        description={
          <>
            {translator.translateText(
              "The last walk of this device's Wi-Fi tables failed, and no earlier walk read them. Its radios and SSIDs appear here after a walk that succeeds.",
            )}
            {props.failureCause ? (
              <span
                className="mt-2 block break-words font-mono text-xs text-gray-600"
                data-testid="network-device-wifi-walk-failure"
              >
                {props.failureCause}
              </span>
            ) : (
              <></>
            )}
          </>
        }
        footer={vendorsDocsLink}
      />
    );
  }

  const tablesRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.NETWORK_DEVICE_VIEW_TABLES] as Route,
    { modelId: props.modelId },
  );

  return (
    <EmptyState
      id="network-device-wifi-not-read"
      icon={IconProp.Wifi}
      title="The device reported no Wi-Fi radios"
      description={
        <TranslatedSentence
          template="The device answered the walk of its Wi-Fi tables, but they hold no rows. Check that its firmware reports them, and that the SNMP view its credentials use includes them. The {{tables}} page shows each table as it was walked."
          slots={{
            tables: (
              <AppLink
                className="font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
                to={tablesRoute}
              >
                {translator.translateText("SNMP Tables") || "SNMP Tables"}
              </AppLink>
            ),
          }}
        />
      }
      footer={vendorsDocsLink}
    />
  );
};

export default WifiTablesNotReadState;
