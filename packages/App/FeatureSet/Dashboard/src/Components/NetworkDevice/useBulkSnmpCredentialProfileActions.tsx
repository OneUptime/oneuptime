import React, { ReactElement, useRef, useState } from "react";

import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkSnmpCredentialProfile from "Common/Models/DatabaseModels/NetworkSnmpCredentialProfile";
import { NetworkDeviceMonitoringMethodUtil } from "Common/Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import BadDataException from "Common/Types/Exception/BadDataException";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import {
  BulkActionButtonSchema,
  BulkActionFailed,
  BulkActionOnClickProps,
} from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Modal from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AppLink from "../AppLink/AppLink";

/*
 * The bulk half of SNMP credential profiles.
 *
 * A profile only earns its keep once an EXISTING fleet can be moved onto it:
 * the devices that were registered without credentials, and are therefore
 * still pinged only, were imported long before the profile existed. These
 * two actions attach a profile to (and detach it from) a selection on the
 * device list, so a subnet's worth of ping-only devices becomes walked
 * devices on their next poll without one edit per device.
 *
 * Modelled on useBulkOidTemplateActions — same hook shape, same
 * { bulkActions, modals } return, same per-item loop — with one difference
 * borrowed from useBulkCreatePingMonitors: the profile list is fetched when
 * the modal OPENS, never on mount. The Devices page mounts this hook, and
 * that page is mounted by tests with no profile mock in place; a list page
 * also has no business fetching profiles for a menu item most visits never
 * open.
 */

export interface BulkSnmpCredentialProfileActionsResult {
  bulkActions: Array<BulkActionButtonSchema<NetworkDevice>>;
  modals: ReactElement;
}

/*
 * The one column the "Set" modal writes. A type alias rather than an
 * interface so it satisfies BasicFormModal's GenericObject constraint.
 */
type SetSnmpCredentialProfileFormData = {
  snmpCredentialProfileId: string;
};

export const SET_SNMP_CREDENTIAL_PROFILE_ACTION_TITLE: string =
  "Set SNMP Credential Profile";

export const CLEAR_SNMP_CREDENTIAL_PROFILE_ACTION_TITLE: string =
  "Clear SNMP Credential Profile";

function useBulkSnmpCredentialProfileActions(): BulkSnmpCredentialProfileActionsResult {
  const [profiles, setProfiles] = useState<Array<NetworkSnmpCredentialProfile>>(
    [],
  );
  const [isLoadingProfiles, setIsLoadingProfiles] = useState<boolean>(false);
  const [didProfileLoadFail, setDidProfileLoadFail] = useState<boolean>(false);
  const [showSetModal, setShowSetModal] = useState<boolean>(false);
  const [bulkActionProps, setBulkActionProps] =
    useState<BulkActionOnClickProps<NetworkDevice> | null>(null);

  /*
   * Which open of the modal a profile response belongs to. The modal is
   * closed and reopened freely, and a slow response from an earlier open
   * must not overwrite the list a later one fetched.
   */
  const profileLoadSequence: React.MutableRefObject<number> = useRef<number>(0);

  const loadProfiles: () => Promise<void> = async (): Promise<void> => {
    profileLoadSequence.current += 1;
    const sequence: number = profileLoadSequence.current;

    setIsLoadingProfiles(true);
    setDidProfileLoadFail(false);

    let loadedProfiles: Array<NetworkSnmpCredentialProfile> = [];
    let didFail: boolean = false;

    /*
     * Same guard as BulkLabelActions: `projectId: null` is not "every
     * project", it is a filter nothing matches, so the modal would offer an
     * empty dropdown and blame it on the project having no profiles.
     */
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (projectId) {
      try {
        const result: ListResult<NetworkSnmpCredentialProfile> =
          await ModelAPI.getList<NetworkSnmpCredentialProfile>({
            modelType: NetworkSnmpCredentialProfile,
            query: {
              projectId: projectId,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: {
              _id: true,
              name: true,
              snmpVersion: true,
            },
            sort: {
              name: SortOrder.Ascending,
            },
          });

        loadedProfiles = result.data;
      } catch {
        didFail = true;
      }
    }

    if (sequence !== profileLoadSequence.current) {
      return;
    }

    setProfiles(loadedProfiles);
    setDidProfileLoadFail(didFail);
    setIsLoadingProfiles(false);
  };

  /*
   * The per-item loop. Takes the action props explicitly rather than reading
   * them off state: the "Clear" action runs straight out of its confirm
   * dialog, in the same tick as its own onClick, so a state write made there
   * would not be visible yet.
   */
  type ApplyProfileFunction = (
    actionProps: BulkActionOnClickProps<NetworkDevice>,
    // null detaches whatever profile the device was on.
    profileId: ObjectID | null,
  ) => Promise<void>;

  const applyProfile: ApplyProfileFunction = async (
    actionProps: BulkActionOnClickProps<NetworkDevice>,
    profileId: ObjectID | null,
  ): Promise<void> => {
    const { items, onProgressInfo, onBulkActionStart, onBulkActionEnd } =
      actionProps;

    // Close the form modal first so the progress modal is visible.
    setShowSetModal(false);

    onBulkActionStart();

    const totalItems: Array<NetworkDevice> = [...items];
    const inProgressItems: Array<NetworkDevice> = [...items];
    const successItems: Array<NetworkDevice> = [];
    const failedItems: Array<BulkActionFailed<NetworkDevice>> = [];

    for (const item of totalItems) {
      inProgressItems.splice(inProgressItems.indexOf(item), 1);

      try {
        if (!item.id) {
          throw new BadDataException("Item ID not found");
        }

        /*
         * Nothing is read first: the link is one column the operator is
         * replacing outright. The device's own credentials are left alone —
         * they still win over the profile at poll time, which the modal
         * copy says.
         */
        const updateData: JSONObject = {
          snmpCredentialProfileId: profileId,
        };

        await ModelAPI.updateById<NetworkDevice>({
          id: item.id,
          modelType: NetworkDevice,
          data: updateData,
        });

        successItems.push(item);
      } catch (err) {
        failedItems.push({
          item: item,
          failedMessage: API.getFriendlyMessage(err),
        });
      }

      onProgressInfo({
        totalItems: totalItems,
        failed: failedItems,
        successItems: successItems,
        inProgressItems: inProgressItems,
      });
    }

    onBulkActionEnd();
    setBulkActionProps(null);
  };

  const profileDropdownOptions: Array<DropdownOption> = profiles.map(
    (profile: NetworkSnmpCredentialProfile): DropdownOption => {
      return {
        label: profile.snmpVersion
          ? `${profile.name || ""} (${profile.snmpVersion})`
          : profile.name || "",
        value: profile._id?.toString() || "",
      };
    },
  );

  /*
   * Bulk actions are handed straight to the table's action bar, which never
   * looks at permissions - so a viewer on an otherwise gated table could
   * still re-point every device they had selected at another profile. Both
   * of these are an update of the records they touch.
   */
  const updateGate: PermissionGateResult = PermissionGate.check(
    new NetworkDevice(),
    ModelAction.Update,
  );

  type GateActionFunction = (
    action: BulkActionButtonSchema<NetworkDevice>,
  ) => BulkActionButtonSchema<NetworkDevice>;

  const gateAction: GateActionFunction = (
    action: BulkActionButtonSchema<NetworkDevice>,
  ): BulkActionButtonSchema<NetworkDevice> => {
    if (updateGate.isAllowed || !updateGate.disabledReason) {
      return action;
    }

    return {
      ...action,
      disabled: true,
      tooltip: updateGate.disabledReason,
    };
  };

  /*
   * A monitor-backed device is never polled, so a credential profile on it
   * opens nothing. Offering these actions on a selection made entirely of
   * them would write a link that can never take effect and report it as a
   * success. A MIXED selection keeps both buttons: the probe-polled devices
   * in it are the point, and the monitor-backed ones are simply unaffected.
   */
  type IsProbePolledSelectionFunction = (
    items: Array<NetworkDevice>,
  ) => boolean;

  const isProbePolledSelection: IsProbePolledSelectionFunction = (
    items: Array<NetworkDevice>,
  ): boolean => {
    if (items.length === 0) {
      return true;
    }

    return items.some((item: NetworkDevice): boolean => {
      return !NetworkDeviceMonitoringMethodUtil.isMonitorBacked(
        item.monitoringMethod,
      );
    });
  };

  const setProfileAction: BulkActionButtonSchema<NetworkDevice> = {
    title: SET_SNMP_CREDENTIAL_PROFILE_ACTION_TITLE,
    buttonStyleType: ButtonStyleType.NORMAL,
    icon: IconProp.Key,
    isVisible: isProbePolledSelection,
    onClick: async (
      actionProps: BulkActionOnClickProps<NetworkDevice>,
    ): Promise<void> => {
      setBulkActionProps(actionProps);
      setShowSetModal(true);
      await loadProfiles();
    },
  };

  const clearProfileAction: BulkActionButtonSchema<NetworkDevice> = {
    title: CLEAR_SNMP_CREDENTIAL_PROFILE_ACTION_TITLE,
    buttonStyleType: ButtonStyleType.NORMAL,
    icon: IconProp.LinkSlash,
    isVisible: isProbePolledSelection,
    confirmTitle: (items: Array<NetworkDevice>): string => {
      return `Clear the SNMP Credential Profile on ${items.length} ${
        items.length === 1 ? "device" : "devices"
      }?`;
    },
    confirmMessage: (items: Array<NetworkDevice>): string => {
      return `${
        items.length === 1 ? "This device" : "These devices"
      } will fall back to ${
        items.length === 1 ? "its" : "their"
      } own credentials, then to the profile on ${
        items.length === 1 ? "its" : "their"
      } site. A device with neither is pinged only from its next poll — up or down, but no interfaces, inventory or health OIDs.`;
    },
    onClick: async (
      actionProps: BulkActionOnClickProps<NetworkDevice>,
    ): Promise<void> => {
      await applyProfile(actionProps, null);
    },
  };

  const closeSetModal: () => void = (): void => {
    /*
     * Invalidate any profile fetch still in flight for this open, so it
     * does not write state into a modal that is no longer there.
     */
    profileLoadSequence.current += 1;
    setIsLoadingProfiles(false);
    setShowSetModal(false);
    setBulkActionProps(null);
  };

  /*
   * "The project has none", as distinct from "the list did not arrive".
   * The failed-load branch below is rendered first, so the two never
   * compete; the term is kept here so this flag means only the one thing.
   */
  const hasNoProfiles: boolean =
    !isLoadingProfiles &&
    !didProfileLoadFail &&
    profileDropdownOptions.length === 0;

  const profilesSettingsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.NETWORK_DEVICE_SETTINGS_SNMP_CREDENTIAL_PROFILES] as Route,
  );

  /*
   * Three modals behind the one flag, in the order they are asked:
   *
   *   1. the fetch failed - there is nothing to pick from, so say so and
   *      write nothing. Offering the form here would show a REQUIRED
   *      dropdown with no options, which cannot be submitted and reads as
   *      "this project has no profiles" rather than "we could not ask";
   *   2. the project genuinely has none - point at the page that creates
   *      one, rather than at the same empty dropdown;
   *   3. otherwise the form, which covers the moment before the list
   *      arrives too (isLoading draws the loader in its place).
   */
  const modals: ReactElement = (
    <>
      {showSetModal &&
        (didProfileLoadFail ? (
          <Modal
            title="SNMP Credential Profiles Could Not Be Loaded"
            description="The project's SNMP credential profiles could not be loaded just now, so there is nothing to choose from. Close this and try again."
            onClose={closeSetModal}
            closeButtonText="Close"
          >
            <p className="text-sm text-gray-500">No device has been changed.</p>
          </Modal>
        ) : hasNoProfiles ? (
          <Modal
            title="No SNMP Credential Profiles Yet"
            description="An SNMP Credential Profile is one named credential set — a community string, or a v3 user with its keys — shared by every device and site that picks it. Create one first, then come back and attach these devices to it."
            onClose={closeSetModal}
            closeButtonText="Close"
          >
            <AppLink
              to={profilesSettingsRoute}
              className="text-sm font-medium text-indigo-600 hover:underline"
            >
              Create an SNMP Credential Profile
            </AppLink>
          </Modal>
        ) : (
          <BasicFormModal<SetSnmpCredentialProfileFormData>
            title={SET_SNMP_CREDENTIAL_PROFILE_ACTION_TITLE}
            description="Every selected device is walked with this profile's credentials on its next poll. A device that carries its own SNMP credentials keeps using them — its own credentials win over the profile — and a monitor-backed device is not polled at all, so the profile has no effect on it."
            isLoading={isLoadingProfiles}
            onClose={closeSetModal}
            submitButtonText="Set Profile"
            onSubmit={async (formData: SetSnmpCredentialProfileFormData) => {
              const actionProps: BulkActionOnClickProps<NetworkDevice> | null =
                bulkActionProps;

              setShowSetModal(false);

              if (!actionProps) {
                return;
              }

              /*
               * The field is required, so an empty id means the option
               * itself came back without one. Writing "" would fail every
               * device over one unusable option, so stop before starting.
               */
              const profileId: string = String(
                formData.snmpCredentialProfileId || "",
              ).trim();

              if (!profileId) {
                setBulkActionProps(null);
                return;
              }

              await applyProfile(actionProps, new ObjectID(profileId));
            }}
            formProps={{
              fields: [
                {
                  field: {
                    snmpCredentialProfileId: true,
                  },
                  title: "SNMP Credential Profile",
                  description:
                    "The credential set these devices are walked with. A profile set on a device wins over the profile on its site.",
                  fieldType: FormFieldSchemaType.Dropdown,
                  required: true,
                  dropdownOptions: profileDropdownOptions,
                  placeholder: "Select a profile",
                },
              ],
            }}
          />
        ))}
    </>
  );

  return {
    bulkActions: [gateAction(setProfileAction), gateAction(clearProfileAction)],
    modals: modals,
  };
}

export default useBulkSnmpCredentialProfileActions;
