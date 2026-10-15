import {
  DeviceAttachment,
  DeviceAttachmentLookupResult,
  getDeviceAttachment,
} from "./DeviceAttachmentLookupUtil";
import {
  DeviceNeighbour,
  NEIGHBOURS_SHOWN,
  getDeviceNeighbours,
  isPortNamedAsPort,
} from "./DeviceNeighbours";
import PageMap from "../../Utils/PageMap";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkInterface from "Common/Models/DatabaseModels/NetworkInterface";
import Includes from "Common/Types/BaseDatabase/Includes";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
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
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
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
  const translator: Translator = useTranslator();
  const [attachment, setAttachment] = useState<DeviceAttachment | undefined>(
    undefined,
  );
  const [isLookupPossible, setIsLookupPossible] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  // What the device reports it is cabled to, over LLDP or CDP.
  const [neighbours, setNeighbours] = useState<Array<DeviceNeighbour>>([]);
  // This device's port names, by interface index.
  const [portNames, setPortNames] = useState<Map<number, string>>(new Map());
  // The neighbours that are devices here, by name (lower case) to their id.
  const [neighbourDeviceIds, setNeighbourDeviceIds] = useState<
    Map<string, string>
  >(new Map());

  /*
   * The names a neighbour list needs: this device's ports, and which
   * neighbours are devices in this project (to link them). Best effort: a
   * failed read leaves the ports as their numbers and the names unlinked.
   */
  const fetchNeighbourNames: (
    found: Array<DeviceNeighbour>,
  ) => Promise<void> = async (
    found: Array<DeviceNeighbour>,
  ): Promise<void> => {
    const advertisedNames: Array<string> = found
      .filter((neighbour: DeviceNeighbour): boolean => {
        return neighbour.hasAdvertisedName;
      })
      .map((neighbour: DeviceNeighbour): string => {
        return neighbour.name;
      });

    try {
      const [interfaces, devices]: [
        ListResult<NetworkInterface>,
        ListResult<NetworkDevice>,
      ] = await Promise.all([
        ModelAPI.getList<NetworkInterface>({
          modelType: NetworkInterface,
          query: {
            networkDeviceId: props.modelId.toString(),
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            interfaceIndex: true,
            name: true,
          },
          sort: {},
        }),
        // Chassis ids alone name no device: nothing to look up then.
        advertisedNames.length > 0
          ? ModelAPI.getList<NetworkDevice>({
              modelType: NetworkDevice,
              query: {
                name: new Includes(advertisedNames),
              },
              limit: LIMIT_PER_PROJECT,
              skip: 0,
              select: {
                _id: true,
                name: true,
              },
              sort: {},
            })
          : Promise.resolve({
              data: [],
              count: 0,
              skip: 0,
              limit: 0,
            } as ListResult<NetworkDevice>),
      ]);

      const names: Map<number, string> = new Map<number, string>();

      for (const item of interfaces.data) {
        if (item.interfaceIndex !== undefined && item.name) {
          names.set(item.interfaceIndex, item.name);
        }
      }

      const ids: Map<string, string> = new Map<string, string>();

      for (const item of devices.data) {
        if (item.name && item._id) {
          ids.set(item.name.toLowerCase(), item._id.toString());
        }
      }

      setPortNames(names);
      setNeighbourDeviceIds(ids);
    } catch {
      // The list still reads well with port numbers and plain names.
    }
  };

  const fetchAttachment: PromiseVoidFunction = async (): Promise<void> => {
    try {
      const result: DeviceAttachmentLookupResult = await getDeviceAttachment(
        props.modelId,
      );

      const found: Array<DeviceNeighbour> = getDeviceNeighbours({
        lldpNeighbors: result.device.lldpNeighbors,
        cdpNeighbors: result.device.cdpNeighbors,
      });

      setAttachment(result.attachment);
      setIsLookupPossible(result.isLookupPossible);
      setNeighbours(found);
      setError("");

      if (found.length > 0) {
        await fetchNeighbourNames(found);
      }
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
    const switchName: string =
      found.switchName || translator.translateTemplate("Unnamed switch");

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
      return translator.translateTemplate("ifIndex {{index}}", {
        index: found.interfaceIndex,
      });
    }

    return "—";
  };

  type GetEmptyStateFunction = () => ReactElement;

  const getEmptyState: GetEmptyStateFunction = (): ReactElement => {
    return (
      <div data-testid="device-attachment-empty" className="py-6 text-center">
        <p className="text-sm text-gray-500">
          {translator.translateText(
            isLookupPossible
              ? "No switch at this site has reported this device yet. Its port appears here once a switch or router at the site with Collect Connected Endpoints turned on sees it."
              : "There is nothing to look this device up by yet. Give it a MAC address, or an IP address as its hostname, and its switch port appears here once a switch at its site with Collect Connected Endpoints turned on sees it.",
          )}
        </p>
        <div className="mt-3">
          <AppLink
            to={settingsRoute}
            className="text-sm font-medium text-indigo-600 hover:underline"
          >
            {translator.translateText("Edit this device in Settings →") || ""}
          </AppLink>
        </div>
      </div>
    );
  };

  type GetNeighboursFunction = () => ReactElement;

  /*
   * The device's neighbours, each on its own line: this device's port, then
   * the neighbour (a link when it is a device here) and the port at its end.
   */
  const getNeighbours: GetNeighboursFunction = (): ReactElement => {
    const shown: Array<DeviceNeighbour> = neighbours.slice(0, NEIGHBOURS_SHOWN);
    const hidden: number = neighbours.length - shown.length;

    return (
      <div data-testid="device-neighbours">
        <ul className="divide-y divide-gray-100">
          {shown.map((neighbour: DeviceNeighbour, index: number) => {
            const localPort: string | undefined =
              neighbour.localInterfaceIndex !== undefined
                ? portNames.get(neighbour.localInterfaceIndex) ||
                  translator.translateTemplate("ifIndex {{index}}", {
                    index: neighbour.localInterfaceIndex,
                  })
                : undefined;
            const neighbourId: string | undefined = neighbour.hasAdvertisedName
              ? neighbourDeviceIds.get(neighbour.name.toLowerCase())
              : undefined;

            return (
              <li
                key={`${neighbour.name}-${index}`}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2 text-sm"
                data-testid="device-neighbour"
              >
                <span className="min-w-0 text-gray-500">
                  {localPort || "—"}
                </span>
                <span className="min-w-0 text-right">
                  {neighbourId ? (
                    <AppLink
                      to={RouteUtil.populateRouteParams(
                        RouteMap[PageMap.NETWORK_DEVICE_VIEW] as Route,
                        { modelId: new ObjectID(neighbourId) },
                      )}
                      className="font-medium text-indigo-600 hover:underline"
                    >
                      {neighbour.name}
                    </AppLink>
                  ) : (
                    <span className="font-medium text-gray-900">
                      {neighbour.name}
                    </span>
                  )}
                  {neighbour.remotePort ? (
                    <span className="text-gray-500">
                      {" · "}
                      {isPortNamedAsPort(neighbour.remotePort)
                        ? neighbour.remotePort
                        : translator.translateTemplate("port {{port}}", {
                            port: neighbour.remotePort,
                          })}
                    </span>
                  ) : (
                    <></>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-xs text-gray-500">
          {hidden > 0
            ? translator.translatePlural(
                {
                  one: "Reported over LLDP or CDP, and {{count}} more on the map.",
                  other: "Reported over LLDP or CDP, and {{count}} more on the map.",
                },
                hidden,
              )
            : translator.translateText("Reported over LLDP or CDP.")}{" "}
          <AppLink
            to={RouteUtil.populateRouteParams(
              RouteMap[PageMap.NETWORK_DEVICE_TOPOLOGY] as Route,
            )}
            className="font-medium text-indigo-600 hover:underline"
          >
            {translator.translateText("Open the map") || ""}
          </AppLink>
        </p>
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

    /*
     * A switch, router or firewall that reports its neighbours: those are
     * what it is connected to. (The switch-port lookup below is for devices
     * that report none - a printer, a register, a phone.)
     */
    if (!attachment && neighbours.length > 0) {
      return getNeighbours();
    }

    if (!attachment) {
      return getEmptyState();
    }

    return (
      <div>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
              {translator.translateText("Switch")}
            </dt>
            <dd className="mt-0.5">{getSwitchElement(attachment)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
              {translator.translateText("Port")}
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
              {translator.translateText("VLAN")}
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
              {translator.translateText("MAC Address")}
            </dt>
            <dd className="mt-0.5 font-mono text-gray-900">
              {attachment.macAddress}
            </dd>
          </div>
        </dl>
        <p className="mt-4 text-xs text-gray-500">
          {attachment.lastSeenAt
            ? translator.translateTemplate(
                attachment.matchedBy === "mac"
                  ? "Matched by MAC address · Last seen {{time}}"
                  : "Matched by IP address · Last seen {{time}}",
                { time: OneUptimeDate.fromNow(attachment.lastSeenAt) },
              )
            : translator.translateText(
                attachment.matchedBy === "mac"
                  ? "Matched by MAC address"
                  : "Matched by IP address",
              )}
        </p>
      </div>
    );
  };

  return (
    <Card
      title="Connected to"
      description="What this device is cabled to: the neighbours it reports, or the switch port a switch at its site sees it on."
    >
      <div data-testid="device-attachment-card">{getContent()}</div>
    </Card>
  );
};

export default DeviceAttachmentCard;
