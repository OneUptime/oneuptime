import DeviceDiagnostics from "./DeviceDiagnostics";
import DeviceLatencyTrend from "./DeviceLatencyTrend";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
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
 */
const DeviceDiagnosticsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
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
      </div>
    </Card>
  );
};

export default DeviceDiagnosticsCard;
