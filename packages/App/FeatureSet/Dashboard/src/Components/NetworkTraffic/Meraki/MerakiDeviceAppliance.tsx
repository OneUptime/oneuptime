import { unlinkMerakiAppliance } from "../NetworkTrafficUsageApi";
import MerakiApplianceLinkModal from "./MerakiApplianceLinkModal";
import {
  LINKED_TO_APPLIANCE,
  LINKED_WAITING_BODY,
  LINK_APPLIANCE_ACTION,
  UNLINKED_DEVICE_BODY,
  UNLINKED_DEVICE_TITLE,
  UNLINK_ACTION,
  UNLINK_DESCRIPTION,
  UNLINK_TITLE,
} from "./MerakiLinkWords";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import IconProp from "Common/Types/Icon/IconProp";
import {
  NetworkTrafficUsageApplianceLinkStatus,
  NetworkTrafficUsageDeviceAppliance,
} from "Common/Types/NetFlow/NetworkTrafficUsage";
import { NetworkControllerLinkableAppliance } from "Common/Types/NetworkController/NetworkControllerApplianceLink";
import ObjectID from "Common/Types/ObjectID";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import InlineSeparator from "Common/UI/Components/InlineSeparator/InlineSeparator";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import API from "Common/UI/Utils/API/API";
import PermissionGate, {
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

/*
 * A DEVICE'S PAGE AND THE MERAKI APPLIANCE IT IS (issue #5762).
 *
 * On a device's Meraki side, in a project that reads Meraki:
 *
 *   - not linked: why the side is empty - this device is not linked to a
 *     Meraki appliance - and the one thing to do, Link to a Meraki
 *     appliance (MerakiApplianceLinkModal). Whoever may not change a
 *     device's serial number reads why there is no button;
 *   - linked, its traffic still to be filed: which appliance, and that its
 *     traffic shows within minutes;
 *   - linked, its traffic shown: one quiet line over it naming the
 *     appliance - its Meraki name, serial number and network.
 *
 * A link made by the serial number on the device can be undone (Unlink, once
 * confirmed): the serial number comes off and its traffic goes back to the
 * network's Traffic page. A device matched another way - by its MAC, or by
 * Meraki's own record of it - has nothing to take off, and offers nothing.
 */

export interface ComponentProps {
  networkDeviceId: ObjectID;
  appliance: NetworkTrafficUsageDeviceAppliance;
  // Linked or unlinked: the page reads its traffic again.
  onChanged: () => void;
}

// Who may link and unlink: whoever may change a device's serial number.
export function getApplianceLinkGate(): PermissionGateResult {
  return PermissionGate.checkColumnUpdate(new NetworkDevice(), "serialNumber", {
    singularName: "Network Device",
  });
}

function getApplianceName(
  appliance: NetworkTrafficUsageDeviceAppliance,
): string {
  return appliance.name || appliance.serial || "";
}

const UnlinkButton: FunctionComponent<{
  networkDeviceId: ObjectID;
  appliance: NetworkTrafficUsageDeviceAppliance;
  onUnlinked: () => void;
}> = (props: {
  networkDeviceId: ObjectID;
  appliance: NetworkTrafficUsageDeviceAppliance;
  onUnlinked: () => void;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const [isConfirming, setIsConfirming] = useState<boolean>(false);
  const [isUnlinking, setIsUnlinking] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const unlink: () => Promise<void> = async (): Promise<void> => {
    setIsUnlinking(true);
    setError("");

    try {
      await unlinkMerakiAppliance(props.networkDeviceId);
      setIsConfirming(false);
      props.onUnlinked();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsUnlinking(false);
    }
  };

  return (
    <Fragment>
      <button
        type="button"
        className="whitespace-nowrap font-medium text-gray-700 underline hover:text-gray-900 hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        onClick={() => {
          setError("");
          setIsConfirming(true);
        }}
        data-testid="meraki-appliance-unlink"
      >
        {translator.translateText(UNLINK_ACTION)}
      </button>
      {isConfirming ? (
        <ConfirmModal
          title={UNLINK_TITLE}
          description={translator.translateTemplate(UNLINK_DESCRIPTION, {
            appliance: getApplianceName(props.appliance),
          })}
          submitButtonText={UNLINK_ACTION}
          onSubmit={() => {
            unlink().catch(() => {
              // handled inside.
            });
          }}
          onClose={() => {
            setIsConfirming(false);
          }}
          isLoading={isUnlinking}
          error={error || undefined}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

/*
 * The line over a linked device's traffic: "Linked to the Meraki appliance
 * LDS MX68 · Q2XX-AAAA-BBBB · Branch 012 · Unlink".
 */
export const MerakiApplianceLine: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const gate: PermissionGateResult = getApplianceLinkGate();
  const appliance: NetworkTrafficUsageDeviceAppliance = props.appliance;
  const name: string = getApplianceName(appliance);

  if (!name) {
    return <></>;
  }

  return (
    <div
      className="mb-4 flex flex-wrap items-center gap-x-1 gap-y-1 text-sm text-gray-600"
      data-testid="meraki-appliance-line"
    >
      <Icon
        icon={IconProp.Link}
        className="me-1 h-4 w-4 flex-shrink-0 text-gray-400"
      />
      <span>
        {translator.translateTemplate(LINKED_TO_APPLIANCE, {
          appliance: name,
        })}
      </span>
      {appliance.serial && appliance.serial !== name ? (
        <Fragment>
          <InlineSeparator />
          <span className="font-mono text-xs text-gray-500" dir="ltr">
            {appliance.serial}
          </span>
        </Fragment>
      ) : (
        <></>
      )}
      {appliance.controllerNetworkName ? (
        <Fragment>
          <InlineSeparator />
          <span className="text-gray-500">
            {appliance.controllerNetworkName}
          </span>
        </Fragment>
      ) : (
        <></>
      )}
      {appliance.isLinkedBySerialNumber && gate.isAllowed ? (
        <Fragment>
          <InlineSeparator />
          <UnlinkButton
            networkDeviceId={props.networkDeviceId}
            appliance={appliance}
            onUnlinked={props.onChanged}
          />
        </Fragment>
      ) : (
        <></>
      )}
    </div>
  );
};

/*
 * The Meraki side of a device with none of its traffic shown yet: not
 * linked, with the way to link it, or linked a moment ago.
 */
export const MerakiDeviceLinkState: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const gate: PermissionGateResult = getApplianceLinkGate();
  const [isLinking, setIsLinking] = useState<boolean>(false);
  const appliance: NetworkTrafficUsageDeviceAppliance = props.appliance;

  if (appliance.status === NetworkTrafficUsageApplianceLinkStatus.Linked) {
    return (
      <div
        className="flex flex-col items-center justify-center px-6 py-14 text-center"
        data-testid="meraki-appliance-waiting"
      >
        <Icon icon={IconProp.Link} className="h-6 w-6 text-gray-400" />
        <div className="mt-3 text-sm font-medium text-gray-900">
          {translator.translateTemplate(LINKED_TO_APPLIANCE, {
            appliance: getApplianceName(appliance),
          })}
        </div>
        <p className="mt-1 max-w-md text-sm text-gray-500">
          {translator.translateText(LINKED_WAITING_BODY)}
        </p>
        {appliance.isLinkedBySerialNumber && gate.isAllowed ? (
          <div className="mt-3 text-sm">
            <UnlinkButton
              networkDeviceId={props.networkDeviceId}
              appliance={appliance}
              onUnlinked={props.onChanged}
            />
          </div>
        ) : (
          <></>
        )}
      </div>
    );
  }

  return (
    <div
      className="flex flex-col items-center justify-center px-6 py-14 text-center"
      data-testid="meraki-appliance-unlinked"
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-50">
        <Icon icon={IconProp.Link} className="h-5 w-5 text-indigo-600" />
      </div>
      <div className="mt-3 text-sm font-medium text-gray-900">
        {translator.translateText(UNLINKED_DEVICE_TITLE)}
      </div>
      <p className="mt-1 max-w-md text-pretty text-sm text-gray-500">
        {translator.translateText(UNLINKED_DEVICE_BODY)}
      </p>
      <div className="mt-4">
        {gate.isAllowed ? (
          <Button
            title={LINK_APPLIANCE_ACTION}
            icon={IconProp.Link}
            buttonStyle={ButtonStyleType.PRIMARY}
            buttonSize={ButtonSize.Small}
            onClick={() => {
              setIsLinking(true);
            }}
            dataTestId="meraki-appliance-link"
          />
        ) : gate.disabledReason ? (
          <p
            className="max-w-md text-xs text-gray-500"
            data-testid="meraki-appliance-link-locked"
          >
            {gate.disabledReason}
          </p>
        ) : (
          <></>
        )}
      </div>
      {isLinking ? (
        <MerakiApplianceLinkModal
          networkDeviceId={props.networkDeviceId}
          onClose={() => {
            setIsLinking(false);
          }}
          onLinked={(_linked: NetworkControllerLinkableAppliance) => {
            setIsLinking(false);
            props.onChanged();
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};
