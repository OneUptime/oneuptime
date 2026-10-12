import { formatTrafficBytes } from "./NetworkTrafficFormat";
import {
  NetworkQuickAction,
  getNetworkQuickActionRoute,
} from "../Network/NetworkQuickActions";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AppLink from "../AppLink/AppLink";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { NetworkTrafficSource } from "Common/Types/NetFlow/NetworkTraffic";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import NetworkDeviceOtherAddressesUtil from "Common/Utils/NetworkDevice/NetworkDeviceOtherAddresses";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Icon from "Common/UI/Components/Icon/Icon";
import Modal from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * Who is sending flow records (the last hour): each device by name, and each
 * address that is not a device yet - with the two ways to make it one. "Add
 * as device" opens Add Device with the address and the probe filled in; "It
 * is one of my devices" adds the address to that device's Other Addresses,
 * and its flows go to the device from the next minute on.
 */

export interface ComponentProps {
  sources: Array<NetworkTrafficSource>;
  // Called once an address was added to a device, to read the page again.
  onLinked: () => void;
}

const LIST_LIMIT: number = 500;

function getDeviceRoute(networkDeviceId: string): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.NETWORK_DEVICE_VIEW_TRAFFIC] as Route,
    { modelId: new ObjectID(networkDeviceId) },
  );
}

export const LinkExporterModal: FunctionComponent<{
  address: string;
  onClose: () => void;
  onLinked: (deviceName: string) => void;
}> = (props: {
  address: string;
  onClose: () => void;
  onLinked: (deviceName: string) => void;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const [devices, setDevices] = useState<Array<NetworkDevice>>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    const load: () => Promise<void> = async (): Promise<void> => {
      try {
        const result: ListResult<NetworkDevice> =
          await ModelAPI.getList<NetworkDevice>({
            modelType: NetworkDevice,
            query: {
              projectId: ProjectUtil.getCurrentProjectId()!,
            },
            limit: LIST_LIMIT,
            skip: 0,
            select: {
              _id: true,
              name: true,
              hostname: true,
              otherAddresses: true,
            },
            sort: {
              name: SortOrder.Ascending,
            },
          });

        setDevices(result.data);
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      } finally {
        setIsLoading(false);
      }
    };

    load().catch(() => {
      // handled inside.
    });
  }, []);

  const options: Array<DropdownOption> = devices.map(
    (device: NetworkDevice): DropdownOption => {
      return {
        value: device.id?.toString() || "",
        label: device.name
          ? `${device.name} (${device.hostname || ""})`
          : device.hostname || "",
      };
    },
  );

  const save: () => Promise<void> = async (): Promise<void> => {
    const device: NetworkDevice | undefined = devices.find(
      (candidate: NetworkDevice): boolean => {
        return candidate.id?.toString() === selected;
      },
    );

    if (!device || !device.id) {
      setError(
        translator.translateText("Pick the device that sends these flows.") ||
          "",
      );
      return;
    }

    setIsSaving(true);
    setError("");

    try {
      await ModelAPI.updateById<NetworkDevice>({
        modelType: NetworkDevice,
        id: device.id,
        data: {
          otherAddresses: NetworkDeviceOtherAddressesUtil.add(
            device.otherAddresses,
            props.address,
          ),
        },
      });

      props.onLinked(device.name || device.hostname || "");
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      setIsSaving(false);
    }
  };

  return (
    <Modal
      title="Which device sends these flows?"
      description={translator.translateTemplate(
        "Flows from {{address}} will go to the device you pick. The address is added to the device's Other Addresses, where you can remove it again.",
        { address: props.address },
      )}
      onClose={props.onClose}
      submitButtonText="Use this device"
      onSubmit={() => {
        save().catch(() => {
          // handled inside.
        });
      }}
      isLoading={isSaving}
      isBodyLoading={isLoading}
      disableSubmitButton={!selected}
      error={error || undefined}
    >
      <div data-testid="traffic-link-exporter">
        <Dropdown
          options={options}
          placeholder={translator.translateText("Pick a device")}
          ariaLabel={translator.translateText("Device")}
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            setSelected(value ? String(value) : null);
          }}
          dataTestId="traffic-link-exporter-device"
        />
      </div>
    </Modal>
  );
};

const TrafficSourcesCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [linkingAddress, setLinkingAddress] = useState<string | null>(null);
  const [notice, setNotice] = useState<string>("");

  if (props.sources.length === 0) {
    return <></>;
  }

  return (
    <div id="traffic-sources">
      <Card
        title="Sending flows"
        description="Every device and address that sent flow records in the last hour, newest first."
      >
        <div data-testid="traffic-sources">
          {notice ? (
            <div
              role="status"
              className="mb-3 flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-200"
              data-testid="traffic-sources-notice"
            >
              <Icon
                icon={IconProp.CheckCircle}
                className="h-4 w-4 text-emerald-600"
              />
              <span>{notice}</span>
            </div>
          ) : (
            <></>
          )}
          <ul className="divide-y divide-gray-100">
            {props.sources.map((source: NetworkTrafficSource): ReactElement => {
              const isKnown: boolean = Boolean(source.networkDeviceId);
              const details: Array<string> = [
                source.flowFormat ||
                  translator.translateText("NetFlow v5 or v9") ||
                  "",
              ];

              if (source.samplingRate > 1) {
                details.push(
                  translator.translateTemplate("1 in {{rate}} sampled", {
                    rate: translator.formatNumber(source.samplingRate),
                  }),
                );
              }

              const lastFlowAt: Date = OneUptimeDate.fromString(
                source.lastFlowAt.includes("T")
                  ? source.lastFlowAt
                  : `${source.lastFlowAt.replace(" ", "T")}Z`,
              );

              return (
                <li
                  key={`${source.networkDeviceId || "unknown"}-${source.exporterIp}`}
                  className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                  data-testid="traffic-source"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${
                        isKnown ? "bg-emerald-500" : "bg-amber-500"
                      }`}
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        {isKnown ? (
                          <AppLink
                            to={getDeviceRoute(source.networkDeviceId!)}
                            className="truncate text-sm font-medium text-gray-900 hover:underline"
                          >
                            {source.name || source.exporterIp}
                          </AppLink>
                        ) : (
                          <span className="font-mono text-sm font-medium text-gray-900">
                            {source.exporterIp}
                          </span>
                        )}
                        {isKnown ? (
                          <span className="font-mono text-xs text-gray-500">
                            {source.exporterIp}
                          </span>
                        ) : (
                          <span
                            className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-amber-200"
                            data-testid="traffic-source-unknown"
                          >
                            {translator.translateText("Not a device yet")}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-xs text-gray-500">
                        {details.join(" · ")}
                        {" · "}
                        {translator.translateTemplate(
                          "{{bytes}} in the last hour, last flow {{time}}",
                          {
                            bytes: formatTrafficBytes(source.octets),
                            time: OneUptimeDate.fromNow(lastFlowAt),
                          },
                        )}
                      </div>
                    </div>
                  </div>
                  {isKnown ? (
                    <></>
                  ) : (
                    <div className="flex flex-shrink-0 flex-wrap gap-2 sm:justify-end">
                      <Button
                        title="Add as device"
                        icon={IconProp.Add}
                        buttonSize={ButtonSize.Small}
                        buttonStyle={ButtonStyleType.NORMAL}
                        dataTestId="traffic-source-add"
                        onClick={() => {
                          Navigation.navigate(
                            getNetworkQuickActionRoute(
                              NetworkQuickAction.AddDevice,
                              {
                                address: source.exporterIp,
                                probeId: source.probeId,
                              },
                            ),
                          );
                        }}
                      />
                      <Button
                        title="It is one of my devices"
                        icon={IconProp.Link}
                        buttonSize={ButtonSize.Small}
                        buttonStyle={ButtonStyleType.NORMAL}
                        dataTestId="traffic-source-link"
                        onClick={() => {
                          setLinkingAddress(source.exporterIp);
                        }}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </Card>
      {linkingAddress ? (
        <LinkExporterModal
          address={linkingAddress}
          onClose={() => {
            setLinkingAddress(null);
          }}
          onLinked={(deviceName: string) => {
            setNotice(
              translator.translateTemplate(
                "Flows from {{address}} go to {{device}} from the next minute on.",
                { address: linkingAddress, device: deviceName },
              ),
            );
            setLinkingAddress(null);
            props.onLinked();
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default TrafficSourcesCard;
