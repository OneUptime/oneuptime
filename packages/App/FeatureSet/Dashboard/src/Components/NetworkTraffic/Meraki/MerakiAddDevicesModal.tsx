import ProbeUtil from "../../../Utils/Probe";
import { addNetworkControllerDevices } from "../NetworkTrafficUsageApi";
import {
  getDefaultProbeId,
  getGroupedProbeDropdownOptions,
  ProbeDropdownOption,
  ProbeDropdownOptionGroup,
} from "../../NetworkDevice/ProbeOptions";
import {
  ADD_COUNT_BUTTON,
  ADD_DEVICES_ACTION,
  ADD_DEVICES_DESCRIPTION,
  ADD_DEVICES_TITLE,
  ARCHIVED_NOTE,
  COUNTED_AT_NEXT_READ,
  DEVICE_KINDS_LABEL,
  DEVICE_KIND_NAMES,
  DEVICE_KIND_PRODUCT_LINES,
  NOTHING_LEFT_TO_ADD,
  NO_PROBE,
  NotAddedCounts,
  PROBE_HELP,
  PROBE_LABEL,
  SITES_CHECKBOX,
  SITES_HELP,
  SITES_LABEL,
  SITES_ON_VALUE,
  TAKEN_NOTE,
  WITHOUT_ADDRESS_NOTE,
  getDialogDeviceKinds,
  getNotAddedCounts,
} from "./MerakiAddDevicesWords";
import NetworkControllerConnection from "Common/Models/DatabaseModels/NetworkControllerConnection";
import Probe from "Common/Models/DatabaseModels/Probe";
import IconProp from "Common/Types/Icon/IconProp";
import {
  DEFAULT_CONTROLLER_PRODUCT_TYPES_TO_ADD,
  NetworkControllerDeviceAddRequest,
  NetworkControllerDeviceAddState,
  NetworkControllerUnaddedDeviceCount,
  getAddableControllerDeviceCount,
  getControllerProductTypesToOffer,
  readNetworkControllerDeviceAddState,
} from "Common/Types/NetworkController/NetworkControllerDeviceAdd";
import { readNetworkControllerConfig } from "Common/Types/NetworkController/NetworkControllerConnectionSettings";
import {
  NetworkControllerReadSummary,
  readNetworkControllerReadSummary,
} from "Common/Types/NetworkController/NetworkControllerReadSummary";
import CheckboxElement from "Common/UI/Components/Checkbox/Checkbox";
import Dropdown, {
  DropdownOption,
  DropdownOptionGroup,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import FoldedSection from "Common/UI/Components/FoldedSection/FoldedSection";
import { FoldedSectionItem } from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import { MORE_FIELDS_SECTION_TITLE } from "Common/UI/Components/FoldedSection/FoldedSectionTitles";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import Icon from "Common/UI/Components/Icon/Icon";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import { BILLING_ENABLED } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * ADD MERAKI DEVICES: the organization's devices that are no network device
 * here, added in one go (Common/Types/NetworkController/
 * NetworkControllerDeviceAdd says how, and why once per ask).
 *
 * One question, answered for most people by its defaults: which kinds of
 * device - each with how many of it the connection's last read counted, the
 * network gear ticked and cameras not. Under it, in grey, the devices of
 * those kinds it will not add and why (no address in Meraki, an address
 * another device here has, archived here), so nothing is left out silently.
 *
 * Folded under More fields, with what they are set to on the fold's line:
 * the sites (on: each device in the site named after its Meraki network)
 * and the probe that polls them (the project's one probe, when it has
 * exactly one; none otherwise - nothing polls an address no probe can
 * reach). An ask remembers its choices: the next one starts with them.
 *
 * Adding runs on the server; the dialog closes once it is asked for, and the
 * connection's row follows it.
 */

export interface ComponentProps {
  connection: NetworkControllerConnection;
  onClose: () => void;
  // The ask was recorded: the row follows it from here.
  onAsked: (state: NetworkControllerDeviceAddState | undefined) => void;
}

const MerakiAddDevicesModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const summary: NetworkControllerReadSummary | undefined =
    readNetworkControllerReadSummary(props.connection.lastPullResult);
  const counts: Array<NetworkControllerUnaddedDeviceCount> | undefined =
    summary?.unaddedDevices;
  const last: NetworkControllerDeviceAddState | undefined =
    readNetworkControllerDeviceAddState(props.connection.lastDeviceAdd);
  const organization: string =
    summary?.organizationName ||
    readNetworkControllerConfig(props.connection.config).organizationName ||
    props.connection.name ||
    "";

  const kinds: Array<string> = getDialogDeviceKinds(counts);

  // The kinds the last ask picked that are listed now, else the defaults.
  const initialKinds: Array<string> = ((): Array<string> => {
    const offered: Array<string> = getControllerProductTypesToOffer(last);
    const picked: Array<string> = kinds.filter((kind: string): boolean => {
      return offered.includes(kind);
    });

    if (picked.length > 0) {
      return picked;
    }

    return kinds.filter((kind: string): boolean => {
      return DEFAULT_CONTROLLER_PRODUCT_TYPES_TO_ADD.includes(kind);
    });
  })();

  const [productTypes, setProductTypes] =
    useState<Array<string>>(initialKinds);
  const [groupBySite, setGroupBySite] = useState<boolean>(
    last ? last.request.groupBySite : true,
  );
  const [probes, setProbes] = useState<Array<Probe>>([]);
  const [isLoadingProbes, setIsLoadingProbes] = useState<boolean>(true);
  const [probeId, setProbeId] = useState<string>("");
  const [isAsking, setIsAsking] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let isCurrent: boolean = true;

    ProbeUtil.getAllProbes()
      .then((loaded: Array<Probe>) => {
        if (!isCurrent) {
          return;
        }

        setProbes(loaded);

        // The last ask's probe while it is still there; else the project's one.
        const lastProbe: string | undefined = last?.request.probeId;
        const isLastStillThere: boolean = Boolean(
          lastProbe &&
            loaded.some((probe: Probe): boolean => {
              return probe._id?.toString() === lastProbe;
            }),
        );

        setProbeId(
          isLastStillThere && lastProbe
            ? lastProbe
            : last
              ? ""
              : getDefaultProbeId(loaded),
        );
      })
      .catch(() => {
        // No probes to pick from: the devices are added with none.
        if (isCurrent) {
          setProbes([]);
        }
      })
      .finally(() => {
        if (isCurrent) {
          setIsLoadingProbes(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  const countsKnown: boolean = Boolean(counts);
  const addCount: number = counts
    ? getAddableControllerDeviceCount(counts, productTypes)
    : 0;
  const notAdded: NotAddedCounts = getNotAddedCounts({
    counts,
    productTypes,
  });
  const nothingToAdd: boolean = countsKnown && kinds.length === 0;

  /*
   * No probe first, then the probes as every probe picker lists them: the
   * project's own under their heading, OneUptime's under theirs.
   */
  const noProbeOption: DropdownOption = {
    label: translator.translateText(NO_PROBE) || NO_PROBE,
    value: "",
  };
  const probeGroups: Array<ProbeDropdownOption | ProbeDropdownOptionGroup> =
    getGroupedProbeDropdownOptions(probes, {
      isOneUptimeCloud: BILLING_ENABLED,
    });
  const probeOptions: Array<DropdownOption | DropdownOptionGroup> = [
    noProbeOption,
    ...probeGroups,
  ];
  const pickedProbe: DropdownOption | undefined = [
    noProbeOption,
    ...probeGroups.flatMap(
      (
        option: ProbeDropdownOption | ProbeDropdownOptionGroup,
      ): Array<DropdownOption> => {
        return "options" in option ? option.options : [option];
      },
    ),
  ].find((option: DropdownOption): boolean => {
    return option.value === probeId;
  });

  const foldItems: Array<FoldedSectionItem> = [
    {
      key: "sites",
      title: SITES_LABEL,
      isSet: true,
      value: groupBySite
        ? translator.translateText(SITES_ON_VALUE) || SITES_ON_VALUE
        : translator.translateText("Off") || "Off",
    },
    {
      key: "probe",
      title: PROBE_LABEL,
      isSet: true,
      value: pickedProbe?.label || translator.translateText(NO_PROBE),
    },
  ];

  const ask: () => Promise<void> = async (): Promise<void> => {
    if (!props.connection.id || productTypes.length === 0) {
      return;
    }

    setIsAsking(true);
    setError("");

    const request: NetworkControllerDeviceAddRequest = {
      productTypes,
      groupBySite,
      ...(probeId ? { probeId } : {}),
    };

    try {
      const state: NetworkControllerDeviceAddState | undefined =
        await addNetworkControllerDevices(props.connection.id, request);

      props.onAsked(state);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      setIsAsking(false);
    }
  };

  const noteLines: Array<{ key: string; text: string }> = [
    notAdded.withoutAddress > 0
      ? {
          key: "without-address",
          text: translator.translatePlural(
            WITHOUT_ADDRESS_NOTE,
            notAdded.withoutAddress,
          ),
        }
      : null,
    notAdded.taken > 0
      ? {
          key: "taken",
          text: translator.translatePlural(TAKEN_NOTE, notAdded.taken),
        }
      : null,
    notAdded.archived > 0
      ? {
          key: "archived",
          text: translator.translatePlural(ARCHIVED_NOTE, notAdded.archived),
        }
      : null,
  ].filter((line: { key: string; text: string } | null): boolean => {
    return Boolean(line);
  }) as Array<{ key: string; text: string }>;

  return (
    <Modal
      title={ADD_DEVICES_TITLE}
      description={translator.translateTemplate(ADD_DEVICES_DESCRIPTION, {
        organization: organization,
      })}
      onClose={props.onClose}
      submitButtonText={
        addCount > 0
          ? translator.translatePlural(ADD_COUNT_BUTTON, addCount)
          : ADD_DEVICES_ACTION
      }
      onSubmit={() => {
        ask().catch(() => {
          setIsAsking(false);
        });
      }}
      disableSubmitButton={
        productTypes.length === 0 ||
        nothingToAdd ||
        (countsKnown && addCount === 0)
      }
      isLoading={isAsking}
      error={error || undefined}
      modalWidth={ModalWidth.Medium}
    >
      <div className="space-y-5" data-testid="meraki-add-devices">
        {nothingToAdd ? (
          <p
            className="text-sm text-gray-600"
            data-testid="meraki-add-devices-nothing"
          >
            {translator.translateText(NOTHING_LEFT_TO_ADD)}
          </p>
        ) : (
          <fieldset>
            <legend className="text-sm font-medium text-gray-900">
              {translator.translateText(DEVICE_KINDS_LABEL)}
            </legend>
            <ul
              className="mt-2 divide-y divide-gray-100 rounded-md border border-gray-200"
              data-testid="meraki-add-devices-kinds"
            >
              {kinds.map((kind: string): ReactElement => {
                const count: NetworkControllerUnaddedDeviceCount | undefined =
                  counts?.find(
                    (entry: NetworkControllerUnaddedDeviceCount): boolean => {
                      return entry.productType === kind;
                    },
                  );
                const name: string = DEVICE_KIND_NAMES[kind] || kind;
                const productLine: string =
                  DEVICE_KIND_PRODUCT_LINES[kind] || "";

                return (
                  <li
                    key={kind}
                    className="flex items-center justify-between gap-3 px-3 py-2"
                    data-testid="meraki-add-devices-kind"
                    data-kind={kind}
                  >
                    <CheckboxElement
                      title={
                        <span>
                          {translator.translateText(name) || name}
                          {productLine ? (
                            <span className="ml-1.5 font-normal text-gray-400">
                              {productLine}
                            </span>
                          ) : (
                            <></>
                          )}
                        </span>
                      }
                      value={productTypes.includes(kind)}
                      onChange={(isChecked: boolean) => {
                        setProductTypes((current: Array<string>) => {
                          const next: Array<string> = current.filter(
                            (picked: string): boolean => {
                              return picked !== kind;
                            },
                          );

                          return isChecked
                            ? kinds.filter((listed: string): boolean => {
                                return (
                                  listed === kind || next.includes(listed)
                                );
                              })
                            : next;
                        });
                      }}
                      dataTestId={`meraki-add-devices-kind-${kind}`}
                    />
                    {count ? (
                      <span
                        className="flex-none text-sm tabular-nums text-gray-500"
                        data-testid="meraki-add-devices-kind-count"
                      >
                        {translator.formatNumber(count.addable)}
                      </span>
                    ) : (
                      <></>
                    )}
                  </li>
                );
              })}
            </ul>
          </fieldset>
        )}

        {!countsKnown ? (
          <p
            className="text-sm text-gray-500"
            data-testid="meraki-add-devices-uncounted"
          >
            {translator.translateText(COUNTED_AT_NEXT_READ)}
          </p>
        ) : (
          <></>
        )}

        {noteLines.length > 0 ? (
          <ul
            className="space-y-1.5"
            data-testid="meraki-add-devices-not-added"
          >
            {noteLines.map(
              (line: { key: string; text: string }): ReactElement => {
                return (
                  <li
                    key={line.key}
                    className="flex items-start gap-1.5 text-xs text-gray-500"
                    data-testid="meraki-add-devices-not-added-line"
                    data-reason={line.key}
                  >
                    <Icon
                      icon={IconProp.Info}
                      className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-gray-400"
                    />
                    <span>{line.text}</span>
                  </li>
                );
              },
            )}
          </ul>
        ) : (
          <></>
        )}

        {nothingToAdd ? (
          <></>
        ) : (
          <FoldedSection
            title={MORE_FIELDS_SECTION_TITLE}
            items={foldItems}
            dataTestId="meraki-add-devices-more"
          >
            <div className="space-y-4">
              <div>
                <FieldLabelElement
                  title={SITES_LABEL}
                  required={false}
                  hideOptionalLabel={true}
                />
                <CheckboxElement
                  title={SITES_CHECKBOX}
                  description={SITES_HELP}
                  value={groupBySite}
                  onChange={(isChecked: boolean) => {
                    setGroupBySite(isChecked);
                  }}
                  dataTestId="meraki-add-devices-sites"
                />
              </div>
              <div>
                <FieldLabelElement
                  title={PROBE_LABEL}
                  description={PROBE_HELP}
                  required={false}
                  hideOptionalLabel={true}
                  htmlFor="meraki-add-devices-probe"
                />
                <Dropdown
                  id="meraki-add-devices-probe"
                  options={probeOptions}
                  value={pickedProbe}
                  isClearable={false}
                  isLoading={isLoadingProbes}
                  onChange={(
                    value: DropdownValue | Array<DropdownValue> | null,
                  ) => {
                    setProbeId(
                      typeof value === "string" || typeof value === "number"
                        ? String(value)
                        : "",
                    );
                  }}
                  dataTestId="meraki-add-devices-probe"
                />
              </div>
            </div>
          </FoldedSection>
        )}
      </div>
    </Modal>
  );
};

export default MerakiAddDevicesModal;
