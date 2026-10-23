import DeviceDiagnostics from "./DeviceDiagnostics";
import DeviceLatencyTrend from "./DeviceLatencyTrend";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import Link from "Common/UI/Components/Link/Link";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  modelId: ObjectID;
  /*
   * Whether the Ping / Traceroute buttons are offered. Decided by the page
   * from the create permission on NetworkDeviceDiagnostic, the same way the
   * topology drawer is handed the decision: hidden for a viewer, never
   * disabled with nothing honest to say. The trend above the buttons is
   * read-only and shows regardless.
   */
  canRunDiagnostics: boolean;
}

/*
 * "Connectivity tools" on the device Overview (issue #3745): the past hour
 * of ping round-trip time, and Ping / Traceroute on demand from the
 * device's probe — the same two things the topology drawer offers, for the
 * operator who arrived at the device page rather than the map.
 *
 * Nothing is fetched here. DeviceDiagnostics reads the device itself (for
 * the probe and the labels), so the drawer and this card say "no probe
 * assigned" the same way from the same read.
 *
 * The card ends with the way to the device's SNMP Walk page (issue #5184),
 * the third thing a probe can do for a device on demand: list every OID it
 * answers. Shown to everyone - the page itself says what the reader may do.
 */
const DeviceDiagnosticsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const snmpWalkRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.NETWORK_DEVICE_VIEW_SNMP_WALK] as Route,
    { modelId: props.modelId },
  );

  return (
    <Card
      title="Connectivity tools"
      description="Ping or traceroute this device from its probe, and see its recent round-trip time."
    >
      <div data-testid="network-device-diagnostics-card" className="space-y-5">
        <DeviceLatencyTrend networkDeviceId={props.modelId} />
        {props.canRunDiagnostics ? (
          <DeviceDiagnostics networkDeviceId={props.modelId} />
        ) : (
          <></>
        )}
        <p
          className="border-t border-gray-100 pt-4 text-sm text-gray-600"
          data-testid="network-device-snmp-walk-link"
        >
          <TranslatedSentence
            template="See every OID this device answers with an {{walk}}."
            slots={{
              walk: (
                <Link
                  to={snmpWalkRoute}
                  className="font-medium text-indigo-600 hover:text-indigo-800"
                >
                  {translator.translateText("SNMP walk")}
                </Link>
              ),
            }}
          />
        </p>
      </div>
    </Card>
  );
};

export default DeviceDiagnosticsCard;
