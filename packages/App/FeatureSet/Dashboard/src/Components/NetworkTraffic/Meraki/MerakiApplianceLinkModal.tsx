import { formatTrafficBytes } from "../NetworkTrafficFormat";
import {
  fetchLinkableAppliances,
  linkMerakiAppliance,
} from "../NetworkTrafficUsageApi";
import {
  ALL_APPLIANCES_HEADING,
  APPLIANCE_LINKED_TO_ANOTHER_DEVICE,
  APPLIANCE_LINKED_TO_DEVICE,
  LIKELY_APPLIANCES_HEADING,
  LINK_APPLIANCE_ACTION,
  LINK_DIALOG_DESCRIPTION,
  LINK_SEARCH_PLACEHOLDER,
  LINK_SUBMIT,
  MORE_APPLIANCES,
  MerakiLinkTemplate,
  NO_APPLIANCE_MATCHES,
  NO_LINKABLE_APPLIANCES,
  getLikenessWords,
  isApplianceLinkable,
} from "./MerakiLinkWords";
import { LIST_SEARCH_DELAY_MS } from "./MerakiTrafficListModal";
import IconProp from "Common/Types/Icon/IconProp";
import {
  MAX_APPLIANCE_SEARCH_LENGTH,
  NetworkControllerLinkableAppliance,
  NetworkControllerLinkableApplianceList,
} from "Common/Types/NetworkController/NetworkControllerApplianceLink";
import ObjectID from "Common/Types/ObjectID";
import {
  getHandDrawnButtonStateClassName,
  getLockedPartClassName,
} from "Common/UI/Components/Button/ButtonStates";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * LINK TO A MERAKI APPLIANCE (issue #5762): one question - which appliance
 * is this device?
 *
 * The appliances the project's Meraki connections reported lately, as the
 * server lists them (POST /network-traffic/usage-appliances): the likely
 * ones first, under "Likely matches", each saying why (the same name, a
 * number both names have), then every other one by name. Each row is one
 * whole label - a press anywhere picks it - with what tells two appliances
 * apart: the serial number, the network, the connection. An appliance
 * another device is already is listed, and says so, but cannot be picked:
 * one appliance is one device. A search narrows the list (a part of a name,
 * a serial number, a network); the list says when it shows only part.
 *
 * Link device writes the appliance's serial number on the device (POST
 * /network-traffic/link-appliance) and files its stored traffic under it;
 * a refusal - the person may not change a device's serial number, another
 * device took the appliance a moment ago - is said in the dialog.
 */

export interface ComponentProps {
  networkDeviceId: ObjectID;
  onClose: () => void;
  // Linked: the page reads its traffic again.
  onLinked: (appliance: NetworkControllerLinkableAppliance) => void;
}

const MerakiApplianceLinkModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [searchInput, setSearchInput] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [list, setList] =
    useState<NetworkControllerLinkableApplianceList | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string>("");
  const [retryKey, setRetryKey] = useState<number>(0);
  const [selected, setSelected] =
    useState<NetworkControllerLinkableAppliance | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string>("");
  const latestRef: React.MutableRefObject<number> = useRef<number>(0);

  useEffect(() => {
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      setSearch(searchInput.trim());
    }, LIST_SEARCH_DELAY_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [searchInput]);

  useEffect(() => {
    latestRef.current += 1;
    const requestId: number = latestRef.current;

    setIsLoading(true);
    setLoadError("");

    fetchLinkableAppliances({
      networkDeviceId: props.networkDeviceId,
      search,
    })
      .then((next: NetworkControllerLinkableApplianceList) => {
        if (requestId === latestRef.current) {
          setList(next);
        }
      })
      .catch((err: Error) => {
        if (requestId === latestRef.current) {
          setLoadError(API.getFriendlyMessage(err));
        }
      })
      .finally(() => {
        if (requestId === latestRef.current) {
          setIsLoading(false);
        }
      });
  }, [search, retryKey]);

  const link: () => Promise<void> = async (): Promise<void> => {
    if (!selected) {
      return;
    }

    setIsSaving(true);
    setSaveError("");

    try {
      await linkMerakiAppliance({
        networkDeviceId: props.networkDeviceId,
        deviceSerial: selected.serial,
      });

      props.onLinked(selected);
    } catch (err) {
      setSaveError(API.getFriendlyMessage(err));
      setIsSaving(false);
    }
  };

  const deviceId: string = props.networkDeviceId.toString();
  const appliances: Array<NetworkControllerLinkableAppliance> =
    list?.appliances || [];
  const likely: Array<NetworkControllerLinkableAppliance> = appliances.filter(
    (appliance: NetworkControllerLinkableAppliance): boolean => {
      return appliance.isLikely;
    },
  );
  const others: Array<NetworkControllerLinkableAppliance> = appliances.filter(
    (appliance: NetworkControllerLinkableAppliance): boolean => {
      return !appliance.isLikely;
    },
  );

  const renderRow: (
    appliance: NetworkControllerLinkableAppliance,
  ) => ReactElement = (
    appliance: NetworkControllerLinkableAppliance,
  ): ReactElement => {
    const isLinkable: boolean = isApplianceLinkable(appliance, deviceId);
    const likeness: MerakiLinkTemplate | null = appliance.isLikely
      ? getLikenessWords(appliance)
      : null;
    const isOtherDevices: boolean = !isLinkable;
    const details: Array<string> = [
      appliance.controllerNetworkName,
      appliance.connectionName,
      appliance.octets > 0 ? formatTrafficBytes(appliance.octets) : "",
    ].filter(Boolean);

    // Another device's appliance: its name and details fade, not its reason.
    const lockedPartClassName: string = getLockedPartClassName({
      isLocked: !isLinkable,
    });

    return (
      <label
        key={appliance.serial}
        className={`flex items-start gap-3 px-4 py-3 ${getHandDrawnButtonStateClassName(
          {
            isLocked: !isLinkable,
            /*
             * Saving, no row answers the pointer; a locked row keeps its
             * look meanwhile.
             */
            isBusy: isLinkable && isSaving,
            /*
             * The line naming the device it already is stays as easy to
             * read as any other.
             */
            holdsItsReason: true,
            hoverClassName: "cursor-pointer hover:bg-gray-50",
          },
        )}`}
        data-testid="meraki-link-appliance"
        data-serial={appliance.serial}
        data-locked={isLinkable ? "false" : "true"}
      >
        <input
          type="radio"
          name="meraki-link-appliance"
          className="mt-0.5 h-4 w-4 flex-shrink-0 border-gray-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-50"
          checked={selected?.serial === appliance.serial}
          disabled={!isLinkable || isSaving}
          onChange={() => {
            setSelected(appliance);
            setSaveError("");
          }}
        />
        <span className="min-w-0 flex-1">
          <span
            className={`flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 ${lockedPartClassName}`}
          >
            <span
              className="truncate text-sm font-medium text-gray-900"
              data-testid="meraki-link-appliance-name"
            >
              {appliance.name || appliance.serial}
            </span>
            {likeness ? (
              <span
                className="inline-flex flex-none items-center rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-200"
                data-testid="meraki-link-appliance-likeness"
              >
                {translator.translateTemplate(
                  likeness.template,
                  likeness.values,
                )}
              </span>
            ) : (
              <></>
            )}
          </span>
          <span
            className={`mt-0.5 block truncate text-xs text-gray-500 ${lockedPartClassName}`}
          >
            <span className="font-mono" dir="ltr">
              {appliance.serial}
            </span>
            {details.length > 0 ? ` · ${details.join(" · ")}` : ""}
          </span>
          {isOtherDevices ? (
            <span
              className="mt-0.5 block truncate text-xs text-gray-600"
              data-testid="meraki-link-appliance-taken"
            >
              {appliance.linkedDeviceName
                ? translator.translateTemplate(APPLIANCE_LINKED_TO_DEVICE, {
                    device: appliance.linkedDeviceName,
                  })
                : translator.translateText(APPLIANCE_LINKED_TO_ANOTHER_DEVICE)}
            </span>
          ) : (
            <></>
          )}
        </span>
      </label>
    );
  };

  const body: ReactElement = ((): ReactElement => {
    if (!list && isLoading) {
      return <ComponentLoader />;
    }

    if (loadError && !list) {
      return (
        <div data-testid="meraki-link-error">
          <ErrorMessage
            message={loadError}
            onRefreshClick={() => {
              setRetryKey((key: number) => {
                return key + 1;
              });
            }}
          />
        </div>
      );
    }

    if (appliances.length === 0) {
      return (
        <p
          className="px-4 py-10 text-center text-sm text-gray-500"
          role="status"
          data-testid="meraki-link-empty"
        >
          {search
            ? translator.translateTemplate(NO_APPLIANCE_MATCHES, { search })
            : translator.translateTemplate(
                NO_LINKABLE_APPLIANCES.template,
                NO_LINKABLE_APPLIANCES.values,
              )}
        </p>
      );
    }

    return (
      <div
        role="radiogroup"
        aria-label={translator.translateText(LINK_APPLIANCE_ACTION)}
        className={isLoading ? "opacity-75 transition-opacity" : ""}
        aria-busy={isLoading}
      >
        {likely.length > 0 ? (
          <Fragment>
            <div
              className="bg-gray-50 px-4 py-2 text-xs font-medium uppercase tracking-wide text-gray-500"
              data-testid="meraki-link-likely-heading"
            >
              {translator.translateText(LIKELY_APPLIANCES_HEADING)}
            </div>
            <div className="divide-y divide-gray-200">
              {likely.map(renderRow)}
            </div>
            {others.length > 0 ? (
              <div className="border-t border-gray-200 bg-gray-50 px-4 py-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                {translator.translateText(ALL_APPLIANCES_HEADING)}
              </div>
            ) : (
              <></>
            )}
          </Fragment>
        ) : (
          <></>
        )}
        <div className="divide-y divide-gray-200">{others.map(renderRow)}</div>
      </div>
    );
  })();

  return (
    <Modal
      title={LINK_APPLIANCE_ACTION}
      description={LINK_DIALOG_DESCRIPTION}
      onClose={props.onClose}
      submitButtonText={LINK_SUBMIT}
      onSubmit={() => {
        link().catch(() => {
          // handled inside.
        });
      }}
      isLoading={isSaving}
      disableSubmitButton={!selected}
      error={saveError || undefined}
      modalWidth={ModalWidth.Medium}
    >
      <div data-testid="meraki-link-dialog">
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 start-0 flex items-center ps-3">
            <Icon icon={IconProp.Search} className="h-4 w-4 text-gray-400" />
          </div>
          <input
            type="search"
            data-unsaved-changes-ignore
            value={searchInput}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              setSearchInput(event.target.value);
            }}
            placeholder={translator.translateText(LINK_SEARCH_PLACEHOLDER)}
            aria-label={translator.translateText(LINK_SEARCH_PLACEHOLDER)}
            maxLength={MAX_APPLIANCE_SEARCH_LENGTH}
            className="block w-full rounded-md border border-gray-300 bg-white py-2 pe-3 ps-9 text-sm text-gray-900 placeholder-gray-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            data-testid="meraki-link-search"
          />
        </div>
        <div className="mt-3 max-h-96 overflow-y-auto rounded-lg border border-gray-200 bg-white">
          {body}
        </div>
        {list && list.matching > list.appliances.length ? (
          <p
            className="mt-2 text-xs text-gray-500"
            data-testid="meraki-link-more"
          >
            {translator.translateTemplate(MORE_APPLIANCES, {
              shown: translator.formatNumber(list.appliances.length),
              matching: translator.formatNumber(list.matching),
            })}
          </p>
        ) : (
          <></>
        )}
      </div>
    </Modal>
  );
};

export default MerakiApplianceLinkModal;
