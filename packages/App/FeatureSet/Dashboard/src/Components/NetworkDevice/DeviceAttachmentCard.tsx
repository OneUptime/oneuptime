import {
  DeviceAttachment,
  DeviceAttachmentLookupResult,
  getDeviceAttachment,
} from "./DeviceAttachmentLookupUtil";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AppLink from "../AppLink/AppLink";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import API from "Common/UI/Utils/API/API";
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
 * "Connected to" on the device Overview: the switch port this device is
 * plugged into, learned from the tables the switches and routers at its
 * site already report - the cable the topology map draws for a device
 * that speaks neither LLDP nor CDP, such as a register or a handset.
 *
 * It says exactly what the map says (the lookup util restates the map's
 * matching rules), and when it has nothing to say it explains what would
 * give it something: the device needs a MAC address, or an IP hostname
 * plus a router at its site that collects endpoints; and the switch it
 * hangs off needs Collect Connected Endpoints turned on.
 */
const DeviceAttachmentCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [attachment, setAttachment] = useState<DeviceAttachment | undefined>(
    undefined,
  );
  const [isLookupPossible, setIsLookupPossible] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchAttachment: PromiseVoidFunction = async (): Promise<void> => {
    try {
      const result: DeviceAttachmentLookupResult = await getDeviceAttachment(
        props.modelId,
      );

      setAttachment(result.attachment);
      setIsLookupPossible(result.isLookupPossible);
      setError("");
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    fetchAttachment().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
      setIsLoading(false);
    });
  }, []);

  const settingsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.NETWORK_DEVICE_VIEW_SETTINGS] as Route,
    { modelId: props.modelId },
  );

  type GetSwitchElementFunction = (found: DeviceAttachment) => ReactElement;

  /*
   * A link when the switch is a device the operator can open; its name
   * alone when the row's relation did not come back (a switch deleted
   * since the walk, or one the viewer cannot read).
   */
  const getSwitchElement: GetSwitchElementFunction = (
    found: DeviceAttachment,
  ): ReactElement => {
    const switchName: string = found.switchName || "Unnamed switch";

    if (!found.switchDeviceId) {
      return <span className="text-gray-900">{switchName}</span>;
    }

    const switchRoute: Route = RouteUtil.populateRouteParams(
      RouteMap[PageMap.NETWORK_DEVICE_VIEW] as Route,
      { modelId: new ObjectID(found.switchDeviceId) },
    );

    return (
      <span data-testid="device-attachment-switch-link">
        <AppLink
          to={switchRoute}
          className="font-medium text-indigo-600 hover:underline"
        >
          {switchName}
        </AppLink>
      </span>
    );
  };

  type GetPortLabelFunction = (found: DeviceAttachment) => string;

  const getPortLabel: GetPortLabelFunction = (
    found: DeviceAttachment,
  ): string => {
    if (found.portName) {
      return found.portName;
    }

    if (found.interfaceIndex !== undefined && found.interfaceIndex !== null) {
      return `ifIndex ${found.interfaceIndex}`;
    }

    return "—";
  };

  type GetEmptyStateFunction = () => ReactElement;

  const getEmptyState: GetEmptyStateFunction = (): ReactElement => {
    return (
      <div data-testid="device-attachment-empty" className="py-6 text-center">
        <p className="text-sm text-gray-500">
          {isLookupPossible
            ? "No switch at this site has reported this device yet. The port appears once a switch with Collect Connected Endpoints turned on sees this device's MAC address in its forwarding table — or, for a device known by its IP address, once a router at the same site that collects endpoints has that address in its ARP table."
            : "There is nothing to look this device up by. Give it a MAC address, or set its hostname to an IP address so a router at its site that collects endpoints can learn the MAC from its ARP table — then the switch port appears here once a switch with Collect Connected Endpoints turned on sees it."}
        </p>
        <div className="mt-3">
          <AppLink
            to={settingsRoute}
            className="text-sm font-medium text-indigo-600 hover:underline"
          >
            Edit this device in Settings →
          </AppLink>
        </div>
      </div>
    );
  };

  type GetContentFunction = () => ReactElement;

  const getContent: GetContentFunction = (): ReactElement => {
    if (isLoading) {
      return <ComponentLoader />;
    }

    if (error) {
      return <ErrorMessage message={error} />;
    }

    if (!attachment) {
      return getEmptyState();
    }

    return (
      <div>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
              Switch
            </dt>
            <dd className="mt-0.5">{getSwitchElement(attachment)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
              Port
            </dt>
            <dd
              className="mt-0.5 text-gray-900"
              data-testid="device-attachment-port"
            >
              {getPortLabel(attachment)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
              VLAN
            </dt>
            <dd
              className="mt-0.5 text-gray-900"
              data-testid="device-attachment-vlan"
            >
              {attachment.vlanId !== undefined && attachment.vlanId !== null
                ? String(attachment.vlanId)
                : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
              MAC Address
            </dt>
            <dd className="mt-0.5 font-mono text-gray-900">
              {attachment.macAddress}
            </dd>
          </div>
        </dl>
        <p className="mt-4 text-xs text-gray-500">
          {attachment.matchedBy === "mac"
            ? "Matched by MAC address"
            : "Matched by IP address"}
          {attachment.lastSeenAt
            ? ` · Last seen ${OneUptimeDate.fromNow(attachment.lastSeenAt)}`
            : ""}
        </p>
      </div>
    );
  };

  return (
    <Card
      title="Connected to"
      description="Where this device is plugged in, learned from the forwarding and ARP tables of the switches and routers at its site."
    >
      <div data-testid="device-attachment-card">{getContent()}</div>
    </Card>
  );
};

export default DeviceAttachmentCard;
