import { DiscoveredNetworkDevice } from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import NetworkDeviceRole from "Common/Models/DatabaseModels/NetworkDeviceRole";
import NetworkSnmpCredentialProfile from "Common/Models/DatabaseModels/NetworkSnmpCredentialProfile";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import IconProp from "Common/Types/Icon/IconProp";
import {
  DEFAULT_DISCOVERY_IMPORT_SETTINGS,
  DiscoveryImportHostResult,
  DiscoveryImportSettings,
  DiscoveryImportSource,
  DiscoveryImportView,
  MAX_HOSTS_PER_DISCOVERY_IMPORT,
} from "Common/Types/NetworkDevice/DiscoveryImport";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import FoldedSection from "Common/UI/Components/FoldedSection/FoldedSection";
import { FoldedSectionItem } from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import { MORE_FIELDS_SECTION_TITLE } from "Common/UI/Components/FoldedSection/FoldedSectionTitles";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import Modal, {
  ModalSecondaryButton,
  ModalWidth,
} from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import {
  DEVICE_ROLE_FIELD_DESCRIPTION,
  DEVICE_ROLE_FIELD_PLACEHOLDER,
  DEVICE_ROLE_FIELD_TITLE,
} from "../DeviceRoleFormFields";
import {
  getDiscoveryImport,
  retryDiscoveryImport,
  startDiscoveredDeviceImport,
  stopDiscoveryImport,
} from "../DiscoveryImport/DiscoveryImportApi";
import DiscoveryImportMonitoringStep from "../DiscoveryImport/DiscoveryImportMonitoringStep";
import {
  DiscoveryImportTemplateChoice,
  getDiscoveryImportBlocker,
} from "../DiscoveryImport/DiscoveryImportOutcome";
import DiscoveryImportProgressPanel from "../DiscoveryImport/DiscoveryImportProgressPanel";
import {
  DiscoveryImportProgressModel,
  getDiscoveryImportProgressModel,
} from "../DiscoveryImport/DiscoveryImportProgressModel";
import {
  DiscoveryImportProjectFacts,
  loadDiscoveryImportProjectFacts,
  mergeRefreshedFacts,
} from "../DiscoveryImport/DiscoveryImportProjectFacts";
import {
  getPickedTemplate,
  keepPickedTemplate,
} from "../DiscoveryImport/DiscoveryImportReview";
import { resolveImportMonitorTemplateId } from "../DiscoveryImport/DiscoveryImportTemplateId";
import useDiscoveryImportPolling, {
  DiscoveryImportPolling,
} from "../DiscoveryImport/useDiscoveryImportPolling";
import {
  AddToMonitoringPlan,
  DiscoveredDeviceItem,
  getAddToMonitoringPlan,
  getDiscoveredDeviceLabel,
} from "./DiscoveredDeviceItems";
import useNamingPreview, {
  NamingPreviewState,
} from "../Naming/useNamingPreview";
import NamingPreviewSummary, {
  NamingPreviewList,
} from "../Naming/NamingPreviewSummary";
import ErrorSentence from "Common/UI/Components/ErrorMessage/ErrorSentence";

/*
 * ADDING DISCOVERED DEVICES TO MONITORING (Network > Discovered Devices and
 * the topology map's node panel, OneUptime issue #5775).
 *
 * The discovery import's own pipeline, from the list instead of a scan: the
 * same monitoring step - how often each device is checked, who hears about
 * a problem, from which monitor template - with what the devices are and
 * the SNMP credentials they are walked with in a More fields fold after it
 * (left empty, the map works a role out from SNMP and a device is pinged,
 * or walked with its site's credentials); and the same progress, run on the
 * server, so the dialog can be closed and the import carries on.
 *
 * Only devices with an address the probe can check and not monitored
 * already are sent; the rest are named, and the server refuses a duplicate
 * (same MAC anywhere in the project, or same address in the same site) with
 * its reason, row by row.
 */

export interface AddDiscoveredDevicesDialogProps {
  // The selected rows: on a page, or selected across pages.
  devices: Array<DiscoveredDeviceItem>;
  onClose: () => void;
  // An import was started, finished or retried: read the list again.
  onImportsChanged: () => void;
  // Open on this import's progress (a running import, reopened).
  importId?: string | undefined;
}

// What the devices are and what they are walked with, as the step asks.
interface NamedOption {
  id: string;
  name: string;
}

// The rows a picker offers: named, by name.
function toNamedOptions(
  rows: Array<NetworkDeviceRole | NetworkSnmpCredentialProfile>,
): Array<NamedOption> {
  return rows
    .map(
      (row: NetworkDeviceRole | NetworkSnmpCredentialProfile): NamedOption => {
        return {
          id: row.id?.toString() || "",
          name: row.name || "",
        };
      },
    )
    .filter((option: NamedOption): boolean => {
      return Boolean(option.id && option.name);
    });
}

async function loadRoles(): Promise<Array<NamedOption>> {
  const result: ListResult<NetworkDeviceRole> =
    await ModelAPI.getList<NetworkDeviceRole>({
      modelType: NetworkDeviceRole,
      query: {},
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      select: { _id: true, name: true },
      sort: { name: SortOrder.Ascending },
    });

  return toNamedOptions(result.data);
}

async function loadSnmpProfiles(): Promise<Array<NamedOption>> {
  const result: ListResult<NetworkSnmpCredentialProfile> =
    await ModelAPI.getList<NetworkSnmpCredentialProfile>({
      modelType: NetworkSnmpCredentialProfile,
      query: {},
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      select: { _id: true, name: true },
      sort: { name: SortOrder.Ascending },
    });

  return toNamedOptions(result.data);
}

// English keys, looked up where they are drawn.
export const ADD_DISCOVERED_DEVICES_TITLE: string =
  translationKey("Add to monitoring");
export const SNMP_PROFILE_FIELD_TITLE: string = translationKey(
  "SNMP Credential Profile",
);
export const SNMP_PROFILE_FIELD_DESCRIPTION: string = translationKey(
  "The devices are walked with these credentials. Left empty, they are pinged, and a device whose site has SNMP credentials is walked with the site's.",
);
export const SNMP_PROFILE_FIELD_PLACEHOLDER: string = translationKey(
  "The site's credentials, if it has any",
);

// The names a sentence lists before "and N more".
const NAMES_LISTED: number = 3;

function namesOf(
  translator: Translator,
  items: ReadonlyArray<DiscoveredDeviceItem>,
): string {
  const named: Array<string> = items
    .slice(0, NAMES_LISTED)
    .map(getDiscoveredDeviceLabel);

  if (items.length <= NAMES_LISTED) {
    return named.join(", ");
  }

  return translator.translateTemplate("{{names}} and {{count}} more", {
    names: named.join(", "),
    count: translator.formatNumber(items.length - NAMES_LISTED),
  });
}

const AddDiscoveredDevicesDialog: FunctionComponent<
  AddDiscoveredDevicesDialogProps
> = (props: AddDiscoveredDevicesDialogProps): ReactElement => {
  const translator: Translator = useTranslator();
  const [settings, setSettings] = useState<DiscoveryImportSettings>({
    ...DEFAULT_DISCOVERY_IMPORT_SETTINGS,
  });
  const [facts, setFacts] = useState<DiscoveryImportProjectFacts | null>(null);
  const [isLoadingFacts, setIsLoadingFacts] = useState<boolean>(true);
  const [factsError, setFactsError] = useState<string>("");
  const [roles, setRoles] = useState<Array<NamedOption> | null>(null);
  const [rolesError, setRolesError] = useState<string>("");
  const [profiles, setProfiles] = useState<Array<NamedOption> | null>(null);
  const [profilesError, setProfilesError] = useState<string>("");
  const [isActing, setIsActing] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string>("");
  const [importId, setImportId] = useState<string | null>(
    props.importId || null,
  );
  const [allResults, setAllResults] =
    useState<Array<DiscoveryImportHostResult> | null>(null);
  const [isLoadingAllResults, setIsLoadingAllResults] =
    useState<boolean>(false);
  const [allResultsError, setAllResultsError] = useState<string>("");
  const [now, setNow] = useState<number>(Date.now());
  const contentRef: React.MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);

  const isOnProgress: boolean = Boolean(importId);

  const plan: AddToMonitoringPlan = useMemo(() => {
    return getAddToMonitoringPlan(props.devices);
  }, [props.devices]);

  /*
   * The devices as the monitoring step counts them: walked over SNMP when
   * credentials are picked for them, else pinged - what the import does.
   */
  const hosts: Array<DiscoveredNetworkDevice> = useMemo(() => {
    return plan.toAdd.map((item: DiscoveredDeviceItem) => {
      return {
        ipAddress: item.ipAddress || "",
        snmpReachable: Boolean(settings.snmpCredentialProfileId),
      } as DiscoveredNetworkDevice;
    });
  }, [plan, settings.snmpCredentialProfileId]);

  // What the step needs to know about the project, read once on opening.
  useEffect(() => {
    if (props.importId) {
      setIsLoadingFacts(false);
      return;
    }

    let isCurrent: boolean = true;

    loadDiscoveryImportProjectFacts()
      .then((loaded: DiscoveryImportProjectFacts) => {
        if (!isCurrent) {
          return;
        }

        setFacts(loaded);
        setSettings((current: DiscoveryImportSettings) => {
          return keepPickedTemplate({
            settings: current,
            templates: loaded.templates,
          });
        });
      })
      .catch((err: unknown) => {
        if (isCurrent) {
          setFactsError(API.getFriendlyMessage(err));
        }
      })
      .finally(() => {
        if (isCurrent) {
          setIsLoadingFacts(false);
        }
      });

    // Each read can fail on its own: the import goes ahead without it.
    loadRoles()
      .then((rows: Array<NamedOption>) => {
        if (isCurrent) {
          setRoles(rows);
        }
      })
      .catch((err: unknown) => {
        if (isCurrent) {
          setRolesError(API.getFriendlyMessage(err));
        }
      });

    loadSnmpProfiles()
      .then((rows: Array<NamedOption>) => {
        if (isCurrent) {
          setProfiles(rows);
        }
      })
      .catch((err: unknown) => {
        if (isCurrent) {
          setProfilesError(API.getFriendlyMessage(err));
        }
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  /*
   * Templates made in another tab ("Manage templates") belong in the list
   * on coming back, as in a scan's import (issue #5145): read again
   * quietly when the window is focused, keeping the choice made.
   */
  const factsRef: React.MutableRefObject<DiscoveryImportProjectFacts | null> =
    useRef<DiscoveryImportProjectFacts | null>(null);
  factsRef.current = isLoadingFacts ? null : facts;
  const isActingRef: React.MutableRefObject<boolean> = useRef<boolean>(false);
  isActingRef.current = isActing || isOnProgress;

  useEffect(() => {
    let request: number = 0;

    const onWindowFocus: () => void = (): void => {
      if (!factsRef.current || isActingRef.current) {
        return;
      }

      request += 1;
      const asked: number = request;

      loadDiscoveryImportProjectFacts()
        .then((loaded: DiscoveryImportProjectFacts) => {
          const current: DiscoveryImportProjectFacts | null = factsRef.current;

          if (asked !== request || isActingRef.current || !current) {
            return;
          }

          const merged: DiscoveryImportProjectFacts | null =
            mergeRefreshedFacts({ current: current, loaded: loaded });

          if (!merged) {
            return;
          }

          setFacts(merged);
          setSettings((settingsNow: DiscoveryImportSettings) => {
            return keepPickedTemplate({
              settings: settingsNow,
              templates: merged.templates,
            });
          });
        })
        .catch(() => {
          // The list the step already has stands.
        });
    };

    window.addEventListener("focus", onWindowFocus);

    return () => {
      request += 1;
      window.removeEventListener("focus", onWindowFocus);
    };
  }, []);

  // The clock the progress's "waiting" state is told apart by.
  useEffect(() => {
    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      setNow(Date.now());
    }, 5000);

    return () => {
      clearInterval(timer);
    };
  }, []);

  const onFinished: (view: DiscoveryImportView) => void = useCallback(
    (_view: DiscoveryImportView): void => {
      props.onImportsChanged();
    },
    [props.onImportsChanged],
  );

  const polling: DiscoveryImportPolling = useDiscoveryImportPolling({
    importId: importId,
    onFinished: onFinished,
  });

  const pickedTemplate: DiscoveryImportTemplateChoice | null =
    getPickedTemplate({
      settings: settings,
      templates: facts?.templates || [],
    });

  const tooMany: boolean = plan.toAdd.length > MAX_HOSTS_PER_DISCOVERY_IMPORT;

  /*
   * What the project's naming rules call each device this adds (issue
   * #6619): said under the devices' names, before anything is added.
   */
  const namingPreview: NamingPreviewState = useNamingPreview({
    isActive: !props.importId && plan.toAdd.length > 0 && !tooMany,
    endpointIds: plan.toAdd.map((item: DiscoveredDeviceItem): string => {
      return item.id;
    }),
  });

  const blocker: string | null =
    plan.toAdd.length === 0
      ? translationKey("None of the selected devices can be added.")
      : getDiscoveryImportBlocker({
          hostCount: plan.toAdd.length,
          settings: settings,
          template: pickedTemplate,
        });

  const startImport: () => Promise<void> = async (): Promise<void> => {
    if (blocker || tooMany || isActing) {
      return;
    }

    setIsActing(true);
    setActionError("");

    try {
      const monitorTemplateId: string | undefined =
        await resolveImportMonitorTemplateId({
          settings: settings,
          pickedTemplate: pickedTemplate,
          seedIds: facts?.seedIds,
        });

      const started: DiscoveryImportView = await startDiscoveredDeviceImport({
        endpointIds: plan.toAdd.map((item: DiscoveredDeviceItem): string => {
          return item.id;
        }),
        settings: {
          pollingIntervalInMinutes: settings.pollingIntervalInMinutes,
          applyVendorTemplates: settings.applyVendorTemplates,
          alerting: settings.alerting,
          ...(monitorTemplateId
            ? { monitorTemplateId: monitorTemplateId }
            : {}),
          ...(settings.networkDeviceRoleId
            ? { networkDeviceRoleId: settings.networkDeviceRoleId }
            : {}),
          ...(settings.snmpCredentialProfileId
            ? { snmpCredentialProfileId: settings.snmpCredentialProfileId }
            : {}),
        },
      });

      polling.setView(started);
      setImportId(started.id);
      setAllResults(null);
      contentRef.current?.focus({ preventScroll: true });
      props.onImportsChanged();
    } catch (err) {
      setActionError(API.getFriendlyMessage(err));
    } finally {
      setIsActing(false);
    }
  };

  const stopImport: () => Promise<void> = async (): Promise<void> => {
    if (!importId || isActing) {
      return;
    }

    setIsActing(true);
    setActionError("");

    try {
      polling.setView(await stopDiscoveryImport(importId));
      void polling.refresh();
    } catch (err) {
      setActionError(API.getFriendlyMessage(err));
    } finally {
      setIsActing(false);
    }
  };

  const retryImport: () => Promise<void> = async (): Promise<void> => {
    if (!importId || isActing) {
      return;
    }

    setIsActing(true);
    setActionError("");

    try {
      const retried: DiscoveryImportView = await retryDiscoveryImport(importId);

      polling.setView(retried);
      setImportId(retried.id);
      setAllResults(null);
      setAllResultsError("");
      props.onImportsChanged();
    } catch (err) {
      setActionError(API.getFriendlyMessage(err));
    } finally {
      setIsActing(false);
    }
  };

  const showAllResults: () => Promise<void> = async (): Promise<void> => {
    if (!importId) {
      return;
    }

    setIsLoadingAllResults(true);
    setAllResultsError("");

    try {
      const full: DiscoveryImportView = await getDiscoveryImport(importId, {
        allResults: true,
      });

      setAllResults(full.results || []);
    } catch (err) {
      setAllResultsError(API.getFriendlyMessage(err));
    } finally {
      setIsLoadingAllResults(false);
    }
  };

  const progressView: DiscoveryImportView | null = polling.view;
  const progressModel: DiscoveryImportProgressModel | null = progressView
    ? getDiscoveryImportProgressModel(progressView, now)
    : null;

  let secondaryButton: ModalSecondaryButton | undefined = undefined;
  let submitButtonText: string | undefined = undefined;
  let onSubmit: (() => void) | undefined = undefined;
  let closeButtonText: string = translationKey("Cancel");
  let closeButtonStyleType: ButtonStyleType | undefined = undefined;
  let isSubmitDisabled: boolean = false;

  if (!isOnProgress) {
    submitButtonText = translator.translatePlural(
      {
        one: "Add {{count}} device",
        other: "Add {{count}} devices",
      },
      plan.toAdd.length,
      { count: translator.formatNumber(plan.toAdd.length) },
    );
    onSubmit = () => {
      void startImport();
    };
    isSubmitDisabled = Boolean(blocker) || tooMany || isLoadingFacts;
  } else if (progressModel) {
    closeButtonText = translationKey("Close");

    if (progressModel.isActive) {
      if (!progressView?.isStopRequested) {
        secondaryButton = {
          title: translationKey("Stop import"),
          dataTestId: "discovered-device-import-stop",
          disabled: isActing,
          onClick: () => {
            void stopImport();
          },
        };
      }
    } else if (progressModel.retryableCount > 0) {
      submitButtonText = translator.translatePlural(
        {
          one: "Retry {{count}} host",
          other: "Retry {{count}} hosts",
        },
        progressModel.retryableCount,
        { count: translator.formatNumber(progressModel.retryableCount) },
      );
      onSubmit = () => {
        void retryImport();
      };
    } else {
      closeButtonText = translationKey("Done");
      closeButtonStyleType = ButtonStyleType.PRIMARY;
    }
  }

  const roleOptions: Array<DropdownOption> = (roles || []).map(
    (role: NamedOption): DropdownOption => {
      return { value: role.id, label: role.name, isUserContent: true };
    },
  );
  const profileOptions: Array<DropdownOption> = (profiles || []).map(
    (profile: NamedOption): DropdownOption => {
      return { value: profile.id, label: profile.name, isUserContent: true };
    },
  );

  const pickedValue: (
    value: DropdownValue | Array<DropdownValue> | null,
  ) => string | undefined = (
    value: DropdownValue | Array<DropdownValue> | null,
  ): string | undefined => {
    const picked: string = Array.isArray(value)
      ? String(value[0] || "")
      : String(value || "");

    return picked || undefined;
  };

  const settingsLink: (
    page: PageMap,
    title: string,
    testId: string,
  ) => ReactElement = (
    page: PageMap,
    title: string,
    testId: string,
  ): ReactElement => {
    return (
      <Link
        to={RouteUtil.populateRouteParams(RouteMap[page] as Route)}
        openInNewTab={true}
        className="inline-flex items-center gap-0.5 font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
        dataTestId={testId}
      >
        {translator.translateText(title)}
        <Icon icon={IconProp.ExternalLink} className="h-3 w-3 flex-shrink-0" />
        <span className="sr-only">
          {" "}
          {translator.translateText("(opens in a new tab)")}
        </span>
      </Link>
    );
  };

  // What is added, and what is left out and why.
  const leadSection: ReactElement = (
    <section
      className="space-y-4"
      data-testid="discovered-device-import-devices"
    >
      <div>
        <h4 className="text-sm font-semibold text-gray-900">
          {translator.translateText("The devices")}
        </h4>
        {plan.toAdd.length > 0 && (
          <p
            className="mt-0.5 break-words text-sm text-gray-700"
            data-testid="discovered-device-import-names"
          >
            {namesOf(translator, plan.toAdd)}
          </p>
        )}
        {plan.toAdd.length > 0 && (
          <div className="mt-3 space-y-2">
            <NamingPreviewSummary
              preview={namingPreview.preview}
              hostCount={plan.toAdd.length}
            />
            <NamingPreviewList preview={namingPreview.preview} />
          </div>
        )}
        {tooMany && (
          <p
            className="mt-1 text-sm font-medium text-amber-700"
            data-testid="discovered-device-import-too-many"
          >
            {translator.translateTemplate(
              "One import brings in up to {{max}} hosts: narrow the selection, then import the rest after.",
              { max: translator.formatNumber(MAX_HOSTS_PER_DISCOVERY_IMPORT) },
            )}
          </p>
        )}
        {plan.monitored.length > 0 && (
          <p
            className="mt-1 text-sm text-gray-500"
            data-testid="discovered-device-import-monitored"
          >
            {translator.translatePlural(
              {
                one: "{{count}} selected device is monitored already, so it is left out.",
                other:
                  "{{count}} selected devices are monitored already, so they are left out.",
              },
              plan.monitored.length,
              { count: translator.formatNumber(plan.monitored.length) },
            )}
          </p>
        )}
        {plan.withoutAddress.length > 0 && (
          <p
            className="mt-1 text-sm text-gray-500"
            data-testid="discovered-device-import-no-address"
          >
            {translator.translatePlural(
              {
                one: "{{count}} selected device has no IP address yet, so it is left out: a device gets one once a router's ARP table or a network controller reports it.",
                other:
                  "{{count}} selected devices have no IP address yet, so they are left out: a device gets one once a router's ARP table or a network controller reports it.",
              },
              plan.withoutAddress.length,
              { count: translator.formatNumber(plan.withoutAddress.length) },
            )}
          </p>
        )}
      </div>
    </section>
  );

  const pickedRoleName: string | undefined = roles?.find(
    (role: NamedOption): boolean => {
      return role.id === settings.networkDeviceRoleId;
    },
  )?.name;
  const pickedProfileName: string | undefined = profiles?.find(
    (profile: NamedOption): boolean => {
      return profile.id === settings.snmpCredentialProfileId;
    },
  )?.name;

  /*
   * Folded, the line names both fields, and what each is set to once one
   * is picked ("SNMP Credential Profile: Office SNMP v3"): nothing in force
   * is hidden.
   */
  const moreFieldsItems: Array<FoldedSectionItem> = [
    {
      key: "networkDeviceRoleId",
      title: DEVICE_ROLE_FIELD_TITLE,
      isSet: Boolean(settings.networkDeviceRoleId),
      value: pickedRoleName,
    },
    {
      key: "snmpCredentialProfileId",
      title: SNMP_PROFILE_FIELD_TITLE,
      isSet: Boolean(settings.snmpCredentialProfileId),
      value: pickedProfileName,
    },
  ];

  /*
   * What the devices are and the SNMP credentials they are walked with:
   * left empty, the map works a role out from what a device reports over
   * SNMP, and a device is pinged - or walked with its site's credentials.
   * Most imports keep both, so they wait in a fold at the end of the step,
   * named, rather than standing first beside each other: side by side their
   * descriptions put the two pickers at different heights, and each
   * placeholder broke over two lines.
   */
  const trailingSection: ReactElement | undefined =
    plan.toAdd.length > 0 ? (
      <FoldedSection
        title={MORE_FIELDS_SECTION_TITLE}
        items={moreFieldsItems}
        dataTestId="discovered-device-import-more-fields"
      >
        <div className="max-w-md space-y-5">
          <div data-testid="discovered-device-import-role">
            <FieldLabelElement
              title={DEVICE_ROLE_FIELD_TITLE}
              required={false}
              description={
                <span>
                  {translator.translateText(DEVICE_ROLE_FIELD_DESCRIPTION)}{" "}
                  {settingsLink(
                    PageMap.NETWORK_DEVICE_SETTINGS_DEVICE_ROLES,
                    "Manage roles",
                    "discovered-device-import-manage-roles",
                  )}
                </span>
              }
            />
            <Dropdown
              id="discovered-device-import-role"
              dataTestId="discovered-device-import-role-dropdown"
              ariaLabel={DEVICE_ROLE_FIELD_TITLE}
              options={roleOptions}
              value={roleOptions.find((option: DropdownOption): boolean => {
                return option.value === settings.networkDeviceRoleId;
              })}
              isClearable={true}
              disabled={isActing || Boolean(rolesError) || roles === null}
              placeholder={DEVICE_ROLE_FIELD_PLACEHOLDER}
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ) => {
                const picked: string | undefined = pickedValue(value);
                setSettings((current: DiscoveryImportSettings) => {
                  const next: DiscoveryImportSettings = { ...current };
                  delete next.networkDeviceRoleId;
                  return picked
                    ? { ...next, networkDeviceRoleId: picked }
                    : next;
                });
              }}
            />
            {rolesError && (
              <p className="mt-1 text-xs text-amber-700">{rolesError}</p>
            )}
          </div>
          <div data-testid="discovered-device-import-snmp">
            <FieldLabelElement
              title={SNMP_PROFILE_FIELD_TITLE}
              required={false}
              description={
                <span>
                  {translator.translateText(SNMP_PROFILE_FIELD_DESCRIPTION)}{" "}
                  {settingsLink(
                    PageMap.NETWORK_DEVICE_SETTINGS_SNMP_CREDENTIAL_PROFILES,
                    "Manage credential profiles",
                    "discovered-device-import-manage-profiles",
                  )}
                </span>
              }
            />
            <Dropdown
              id="discovered-device-import-snmp"
              dataTestId="discovered-device-import-snmp-dropdown"
              ariaLabel={SNMP_PROFILE_FIELD_TITLE}
              options={profileOptions}
              value={profileOptions.find((option: DropdownOption): boolean => {
                return option.value === settings.snmpCredentialProfileId;
              })}
              isClearable={true}
              disabled={isActing || Boolean(profilesError) || profiles === null}
              placeholder={SNMP_PROFILE_FIELD_PLACEHOLDER}
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ) => {
                const picked: string | undefined = pickedValue(value);
                setSettings((current: DiscoveryImportSettings) => {
                  const next: DiscoveryImportSettings = { ...current };
                  delete next.snmpCredentialProfileId;
                  return picked
                    ? { ...next, snmpCredentialProfileId: picked }
                    : next;
                });
              }}
            />
            {profilesError && (
              <p className="mt-1 text-xs text-amber-700">{profilesError}</p>
            )}
          </div>
        </div>
      </FoldedSection>
    ) : undefined;

  const description: string =
    props.devices.length === 1 && props.devices[0]
      ? props.devices[0].name
      : translator.translatePlural(
          {
            one: "{{count}} device from the Discovered Devices list",
            other: "{{count}} devices from the Discovered Devices list",
          },
          props.devices.length,
          { count: translator.formatNumber(props.devices.length) },
        );

  return (
    <Modal
      title={ADD_DISCOVERED_DEVICES_TITLE}
      description={isOnProgress ? undefined : description}
      modalWidth={ModalWidth.Large}
      isBodyLoading={false}
      isLoading={isActing && !isOnProgress}
      error={actionError || undefined}
      onClose={props.onClose}
      closeButtonText={closeButtonText}
      disableCloseOnBackdropClick={true}
      {...(secondaryButton ? { secondaryButton: secondaryButton } : {})}
      {...(submitButtonText ? { submitButtonText: submitButtonText } : {})}
      {...(onSubmit ? { onSubmit: onSubmit } : {})}
      disableSubmitButton={isSubmitDisabled}
      submitButtonStyleType={ButtonStyleType.PRIMARY}
      {...(closeButtonStyleType !== undefined
        ? { closeButtonStyleType: closeButtonStyleType }
        : {})}
    >
      <div
        className="space-y-5 focus:outline-none"
        data-testid="discovered-device-import-dialog"
        ref={contentRef}
        tabIndex={-1}
      >
        {!isOnProgress && plan.toAdd.length === 0 && (
          <Alert
            type={AlertType.INFO}
            title="None of the selected devices can be added: each one is monitored already or has no IP address yet."
            dataTestId="discovered-device-import-nothing"
          />
        )}
        {!isOnProgress && (
          <DiscoveryImportMonitoringStep
            hosts={hosts}
            source={DiscoveryImportSource.DiscoveredDevices}
            leadSection={leadSection}
            trailingSection={trailingSection}
            settings={settings}
            onSettingsChange={setSettings}
            facts={facts}
            isLoadingFacts={isLoadingFacts}
            factsError={factsError || undefined}
            template={pickedTemplate}
            isDisabled={isActing}
          />
        )}
        {isOnProgress && (
          <>
            {polling.error && (
              <Alert
                type={AlertType.WARNING}
                title={
                  <ErrorSentence
                    template="Showing the last progress received. Retrying: {{error}}"
                    error={polling.error}
                  />
                }
                dataTestId="discovered-device-import-poll-error"
              />
            )}
            {progressView ? (
              <DiscoveryImportProgressPanel
                view={progressView}
                allResults={allResults}
                isLoadingAllResults={isLoadingAllResults}
                allResultsError={allResultsError || undefined}
                onShowAllResults={() => {
                  void showAllResults();
                }}
                now={now}
              />
            ) : (
              <p className="py-6 text-center text-sm text-gray-500">
                {translator.translateText("Reading the import…")}
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
};

export default AddDiscoveredDevicesDialog;
