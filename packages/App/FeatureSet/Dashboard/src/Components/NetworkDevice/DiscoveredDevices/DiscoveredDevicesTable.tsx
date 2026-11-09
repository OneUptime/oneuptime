import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkEndpoint from "Common/Models/DatabaseModels/NetworkEndpoint";
import NetworkTopologySuppression from "Common/Models/DatabaseModels/NetworkTopologySuppression";
import Project from "Common/Models/DatabaseModels/Project";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import {
  DEFAULT_DISCOVERED_DEVICE_PAGE_SIZE,
  DiscoveredDeviceCounts,
  DiscoveredDeviceIdsResponse,
  DiscoveredDeviceListResponse,
  DiscoveredDeviceMapChange,
  DiscoveredDeviceSelected,
  DiscoveredDeviceShow,
  DiscoveredDeviceSort,
  DiscoveredDeviceSortOrder,
} from "Common/Types/NetworkDevice/DiscoveredDevice";
import { DiscoveryImportView } from "Common/Types/NetworkDevice/DiscoveryImport";
import ObjectID from "Common/Types/ObjectID";
import ActionButtonSchema, {
  ActionButtonPlacement,
} from "Common/UI/Components/ActionButton/ActionButtonSchema";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import {
  BULK_ITEM_CHANGED,
  BulkItemOutcome,
  bulkItemUnchanged,
  runBulkAction,
} from "Common/UI/Components/BulkUpdate/BulkActionRunner";
import {
  BulkActionButtonSchema,
  BulkActionOnClickProps,
} from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import FilterButtons from "Common/UI/Components/FilterButtons/FilterButtons";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import Table from "Common/UI/Components/Table/Table";
import { useAreTableColumnsFolded } from "Common/UI/Components/Table/TableCellContext";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import {
  TableEmptyStateActionStyle,
  TableEmptyStateKind,
  TableEmptyStateProps,
} from "Common/UI/Components/Table/TableEmptyState";
import { CLEAR_SEARCH } from "Common/UI/Components/Table/TableEmptyStateBuilders";
import {
  TABLE_HEADER_CONTROL_HEIGHT_CLASS_NAME,
  TABLE_HEADER_SEARCH_CLEAR_BUTTON_CLASS_NAME,
  TableHeaderSearchSlot,
  TableHeaderToolbar,
  renderTableHeaderMoreMenu,
  useTableHeaderSearchShortcut,
} from "Common/UI/Components/Table/TableHeaderControls";
import Columns from "Common/UI/Components/Table/Types/Columns";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import { getRouteToPageAnchor } from "Common/UI/Utils/PageAnchor";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
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
import DiscoveryImportRowStatus from "../DiscoveryImport/DiscoveryImportRowStatus";
import useActiveDiscoveryImports, {
  ActiveDiscoveryImports,
} from "../DiscoveryImport/useActiveDiscoveryImports";
import AddDiscoveredDevicesDialog from "./AddDiscoveredDevicesDialog";
import {
  hideDiscoveredDevicesFromMap,
  listDiscoveredDevices,
  selectAllDiscoveredDevices,
  showDiscoveredDevicesOnMap,
} from "./DiscoveredDeviceApi";
import {
  DISCOVERED_DEVICE_STATE_LABELS,
  DiscoveredDeviceEmptyKind,
  DiscoveredDeviceItem,
  DiscoveredDeviceState,
  MapChangeIndex,
  MapChangeItemOutcome,
  canAddToMonitoring,
  getDiscoveredDeviceEmptyKind,
  getDiscoveredDeviceLabel,
  getDiscoveredDeviceShowOptions,
  getDiscoveredDeviceSort,
  getDiscoveredDeviceState,
  getHostnameUnderName,
  getMapChangeItemOutcome,
  getSeenOnParts,
  indexMapChange,
  isDiscoveredDeviceShow,
  isSortableDiscoveredDeviceField,
  toDiscoveredDeviceItem,
  toSelectedDiscoveredDeviceItem,
} from "./DiscoveredDeviceItems";
import DiscoveredDeviceRetentionCopy, {
  DISCOVERED_DEVICE_RETENTION_PLACE,
  DISCOVERED_DEVICES_RETENTION_LINE_TEST_ID,
  getDiscoveredDeviceRetentionLine,
} from "./DiscoveredDeviceRetentionCopy";

/*
 * THE DISCOVERED DEVICES LIST (Network > Topology > Discovered Devices, and
 * a site's own page; OneUptime issue #5775).
 *
 * Every device a switch's or router's tables, or a network controller's
 * client list, saw - and whether OneUptime monitors it, decided the way the
 * topology map decides to draw a monitored device as itself. A site can see
 * thousands, so the search, the counts, the paging and the sort are the
 * server's; "select every matching row" asks it for their ids.
 *
 * What a person does here, one row or a selection at a time:
 *
 *  - Add to monitoring: the discovery import's own pipeline and its
 *    Monitoring step (AddDiscoveredDevicesDialog). It runs on the server, so
 *    the dialog can be closed; the strip over the table says how far it got.
 *  - Hide from map / Show on map: the map's own suppressions, written in one
 *    request for the whole selection. Nothing is deleted, and a monitored
 *    device is never hidden: the map draws it as the device it is.
 *  - A row's classification (what it is) and Delete, as before.
 */

export interface DiscoveredDevicesTableProps {
  // One site's devices only: the site's own page.
  siteId?: string | undefined;
  /*
   * How long the project keeps a device nothing sees (Unseen Devices), when
   * the page knows it better than the list's last read: the project's page
   * holds the card that changes it, and hands each save on at once.
   */
  retentionInDays?: number | undefined;
}

// English keys, looked up where they are drawn.
export const DISCOVERED_DEVICES_COPY: {
  title: string;
  siteTitle: string;
  description: string;
  siteDescription: string;
  searchPlaceholder: string;
  noneYet: string;
  siteNoneYet: string;
  howToCollect: string;
  siteHowToCollect: string;
  noMatch: string;
  noMatchHint: string;
  matchesElsewhere: Record<
    Exclude<DiscoveredDeviceShow, DiscoveredDeviceShow.All>,
    string
  >;
  showAll: string;
  clearSearch: string;
  allMonitored: string;
  allMonitoredHint: string;
  noneMonitored: string;
  noneMonitoredHint: string;
  noneHidden: string;
  noAddressYet: string;
  noAddress: string;
  addToMonitoring: string;
  add: string;
  hideFromMap: string;
  showOnMap: string;
  viewDevice: string;
  view: string;
  editClassification: string;
  delete: string;
} = {
  title: translationKey("Discovered Devices"),
  siteTitle: translationKey("Discovered Devices at this Site"),
  /*
   * What the list is. How long a device nothing sees stays on it, the line
   * under the table says (DiscoveredDeviceRetentionCopy); what each row's
   * State says and what its buttons do, the rows show.
   */
  description: translationKey(
    "Every device your switches, routers and network controllers have seen, and when each was last there.",
  ),
  siteDescription: translationKey(
    "Every device this site's switches, routers and network controllers have seen, and when each was last there.",
  ),
  searchPlaceholder: translationKey("Search by name, IP, MAC or vendor"),
  noneYet: translationKey("No discovered devices yet."),
  siteNoneYet: translationKey("No discovered devices at this site yet."),
  howToCollect: translationKey(
    "Turn on Collect Connected Endpoints in a switch or router's polling settings to see what is plugged into it.",
  ),
  siteHowToCollect: translationKey(
    "Turn on Collect Connected Endpoints in a switch or router's polling settings to see what is plugged in.",
  ),
  noMatch: translationKey("No discovered device matches this search."),
  noMatchHint: translationKey(
    "Search by a name, an IP address, a MAC address with or without separators, or a vendor.",
  ),
  /*
   * The search matches, but not under the choice shown: a monitored device
   * looked for under Not monitored, which the list opens on.
   */
  matchesElsewhere: {
    [DiscoveredDeviceShow.NotMonitored]: translationKey(
      "No device that is not monitored matches this search.",
    ),
    [DiscoveredDeviceShow.Monitored]: translationKey(
      "No monitored device matches this search.",
    ),
    [DiscoveredDeviceShow.Hidden]: translationKey(
      "No device hidden from the map matches this search.",
    ),
  },
  showAll: translationKey("Show all"),
  // Beside Show all, cased as the list's other words are.
  clearSearch: translationKey("Clear search"),
  allMonitored: translationKey("Every discovered device is monitored."),
  allMonitoredHint: translationKey("Pick All to see them."),
  noneMonitored: translationKey(
    "None of the discovered devices is monitored yet.",
  ),
  noneMonitoredHint: translationKey(
    "Add the ones you want to monitor from Not monitored.",
  ),
  noneHidden: translationKey("No discovered device is hidden from the map."),
  noAddressYet: translationKey(
    "No IP address yet: a device gets one once a router's ARP table or a network controller reports it.",
  ),
  // In the IP Address column: why the row's Add is greyed out, on a phone too.
  noAddress: translationKey("No IP address yet"),
  addToMonitoring: translationKey("Add to monitoring"),
  // The row's own button: the words its name starts with, or holds.
  add: translationKey("Add"),
  hideFromMap: translationKey("Hide from map"),
  showOnMap: translationKey("Show on map"),
  viewDevice: translationKey("View device"),
  view: translationKey("View"),
  editClassification: translationKey("Edit classification"),
  delete: translationKey("Delete"),
};

// How long the search waits for the typing to stop.
export const DISCOVERED_DEVICE_SEARCH_DEBOUNCE_MS: number = 300;

const STATE_BADGE_CLASS_NAMES: Record<DiscoveredDeviceState, string> = {
  [DiscoveredDeviceState.Monitored]:
    "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  [DiscoveredDeviceState.Hidden]: "bg-gray-100 text-gray-600 ring-gray-500/20",
  [DiscoveredDeviceState.NotSeenRecently]:
    "bg-amber-50 text-amber-700 ring-amber-600/20",
  [DiscoveredDeviceState.DiscoveredOnly]:
    "bg-indigo-50 text-indigo-700 ring-indigo-600/20",
};

const LINK_CLASS_NAME: string =
  "font-medium text-indigo-600 hover:text-indigo-700 hover:underline";

// A gate the reader is known to fail locks its action, and says why.
function lockFor(gate: PermissionGateResult): {
  disabled?: boolean | undefined;
  tooltip?: string | undefined;
} {
  if (gate.isAllowed || !gate.disabledReason) {
    return {};
  }

  return { disabled: true, tooltip: gate.disabledReason };
}

/*
 * A vendor's name: as dark as the row's other values in a column of its
 * own, and, folded under the device's name, as small and quiet as the
 * hostname above it - the name stays what the eye finds first.
 */
const VendorName: FunctionComponent<{ vendor: string }> = (props: {
  vendor: string;
}): ReactElement => {
  const isFolded: boolean = useAreTableColumnsFolded();

  return (
    <span
      className={`break-words ${isFolded ? "text-xs text-gray-500" : "text-sm text-gray-900"}`}
    >
      {props.vendor}
    </span>
  );
};

function deviceRoute(deviceId: string): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.NETWORK_DEVICE_VIEW] as Route,
    { modelId: new ObjectID(deviceId) },
  );
}

const DiscoveredDevicesTable: FunctionComponent<DiscoveredDevicesTableProps> = (
  props: DiscoveredDevicesTableProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const [search, setSearch] = useState<string>("");
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false);
  const searchInputRef: React.MutableRefObject<HTMLInputElement | null> =
    useRef<HTMLInputElement | null>(null);

  const [show, setShow] = useState<DiscoveredDeviceShow>(
    DiscoveredDeviceShow.NotMonitored,
  );
  const [sortBy, setSortBy] = useState<keyof DiscoveredDeviceItem | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>(SortOrder.Descending);
  const [currentPageNumber, setCurrentPageNumber] = useState<number>(1);
  const [itemsOnPage, setItemsOnPage] = useState<number>(
    DEFAULT_DISCOVERED_DEVICE_PAGE_SIZE,
  );

  const [rows, setRows] = useState<Array<DiscoveredDeviceItem>>([]);
  const [count, setCount] = useState<number>(0);
  const [counts, setCounts] = useState<DiscoveredDeviceCounts | null>(null);
  // Unseen Devices, as the list last read it: undefined until it says.
  const [listedRetentionInDays, setListedRetentionInDays] = useState<
    number | undefined
  >(undefined);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [reloadToken, setReloadToken] = useState<number>(0);
  const requestRef: React.MutableRefObject<number> = useRef<number>(0);

  const [selected, setSelected] = useState<Array<DiscoveredDeviceItem>>([]);
  const [isSelectAllLoading, setIsSelectAllLoading] = useState<boolean>(false);
  const [selectionError, setSelectionError] = useState<string>("");
  const [isSelectionTruncated, setIsSelectionTruncated] =
    useState<boolean>(false);
  const [selectionTotal, setSelectionTotal] = useState<number>(0);
  const selectAllRef: React.MutableRefObject<number> = useRef<number>(0);

  const [dialogDevices, setDialogDevices] =
    useState<Array<DiscoveredDeviceItem> | null>(null);
  const [dialogImportId, setDialogImportId] = useState<string | null>(null);
  const [itemToClassify, setItemToClassify] =
    useState<DiscoveredDeviceItem | null>(null);

  const activeImports: ActiveDiscoveryImports = useActiveDiscoveryImports();

  const sort: {
    sort: DiscoveredDeviceSort;
    sortOrder: DiscoveredDeviceSortOrder;
  } = getDiscoveredDeviceSort(sortBy, sortOrder);

  useEffect(() => {
    const handle: ReturnType<typeof setTimeout> = setTimeout(() => {
      setDebouncedSearch(search);
    }, DISCOVERED_DEVICE_SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(handle);
    };
  }, [search]);

  // A selection belongs to the rows it was made over.
  const clearSelection: () => void = useCallback((): void => {
    selectAllRef.current += 1;
    setIsSelectAllLoading(false);
    setSelectionError("");
    setIsSelectionTruncated(false);
    setSelectionTotal(0);
    setSelected((current: Array<DiscoveredDeviceItem>) => {
      return current.length === 0 ? current : [];
    });
  }, []);

  useEffect(() => {
    setCurrentPageNumber(1);
    clearSelection();
  }, [debouncedSearch, show, props.siteId]);

  const reload: () => void = useCallback((): void => {
    setReloadToken((token: number): number => {
      return token + 1;
    });
  }, []);

  useEffect(() => {
    requestRef.current += 1;
    const request: number = requestRef.current;

    setIsLoading(true);
    setError("");

    listDiscoveredDevices({
      search: debouncedSearch,
      show: show,
      ...(props.siteId ? { siteId: props.siteId } : {}),
      sort: sort.sort,
      sortOrder: sort.sortOrder,
      limit: itemsOnPage,
      skip: (currentPageNumber - 1) * itemsOnPage,
    })
      .then((response: DiscoveredDeviceListResponse) => {
        if (request !== requestRef.current) {
          return;
        }

        setRows(response.rows.map(toDiscoveredDeviceItem));
        setCount(response.count);
        setCounts(response.counts);

        // A list that does not say keeps what it said before.
        if (response.retentionInDays !== undefined) {
          setListedRetentionInDays(response.retentionInDays);
        }
      })
      .catch((err: unknown) => {
        if (request === requestRef.current) {
          setError(API.getFriendlyMessage(err));
        }
      })
      .finally(() => {
        if (request === requestRef.current) {
          setIsLoading(false);
        }
      });
  }, [
    debouncedSearch,
    show,
    props.siteId,
    sort.sort,
    sort.sortOrder,
    itemsOnPage,
    currentPageNumber,
    reloadToken,
  ]);

  // ---- Permissions: an action the reader may not take is locked, with why.

  const addGate: PermissionGateResult = PermissionGate.check(
    new NetworkDevice(),
    ModelAction.Create,
  );
  const hideGate: PermissionGateResult = PermissionGate.check(
    new NetworkTopologySuppression(),
    ModelAction.Create,
  );
  const showGate: PermissionGateResult = PermissionGate.check(
    new NetworkTopologySuppression(),
    ModelAction.Delete,
  );
  const editGate: PermissionGateResult = PermissionGate.check(
    new NetworkEndpoint(),
    ModelAction.Update,
  );
  const deleteGate: PermissionGateResult = PermissionGate.check(
    new NetworkEndpoint(),
    ModelAction.Delete,
  );

  // ---- Hide from map / Show on map.

  const changeMap: (
    endpointIds: Array<string>,
    isHiding: boolean,
  ) => Promise<DiscoveredDeviceMapChange> = (
    endpointIds: Array<string>,
    isHiding: boolean,
  ): Promise<DiscoveredDeviceMapChange> => {
    return isHiding
      ? hideDiscoveredDevicesFromMap(endpointIds)
      : showDiscoveredDevicesOnMap(endpointIds);
  };

  // One request for the whole selection; each row reads its own outcome.
  const runMapChange: (
    actionProps: BulkActionOnClickProps<DiscoveredDeviceItem>,
    isHiding: boolean,
  ) => Promise<void> = async (
    actionProps: BulkActionOnClickProps<DiscoveredDeviceItem>,
    isHiding: boolean,
  ): Promise<void> => {
    let request: Promise<MapChangeIndex> | null = null;

    await runBulkAction<DiscoveredDeviceItem>({
      actionProps: actionProps,
      concurrency: Math.max(1, actionProps.items.length),
      isStoppable: false,
      step: async (item: DiscoveredDeviceItem): Promise<BulkItemOutcome> => {
        if (!request) {
          request = changeMap(
            actionProps.items.map((selectedItem: DiscoveredDeviceItem) => {
              return selectedItem.id;
            }),
            isHiding,
          ).then(indexMapChange);
        }

        const outcome: MapChangeItemOutcome = getMapChangeItemOutcome({
          id: item.id,
          index: await request,
          isHiding: isHiding,
        });

        if (outcome.kind === "changed") {
          return BULK_ITEM_CHANGED;
        }

        if (outcome.kind === "unchanged") {
          return bulkItemUnchanged(outcome.reason);
        }

        throw new Error(outcome.reason);
      },
    });
  };

  // A row's own Hide from map / Show on map: done, or why not.
  const changeRowOnMap: (
    item: DiscoveredDeviceItem,
    isHiding: boolean,
    onCompleteAction: () => void,
    onError: (err: Error) => void,
  ) => void = (
    item: DiscoveredDeviceItem,
    isHiding: boolean,
    onCompleteAction: () => void,
    onError: (err: Error) => void,
  ): void => {
    changeMap([item.id], isHiding)
      .then((change: DiscoveredDeviceMapChange) => {
        const outcome: MapChangeItemOutcome = getMapChangeItemOutcome({
          id: item.id,
          index: indexMapChange(change),
          isHiding: isHiding,
        });

        if (outcome.kind === "failed") {
          onError(new Error(translator.translateText(outcome.reason)));
          return;
        }

        onCompleteAction();
        reload();
      })
      .catch((err: unknown) => {
        onError(new Error(API.getFriendlyMessage(err)));
      });
  };

  const bulkActions: Array<BulkActionButtonSchema<DiscoveredDeviceItem>> = [
    {
      title: DISCOVERED_DEVICES_COPY.addToMonitoring,
      icon: IconProp.Add,
      buttonStyleType: ButtonStyleType.NORMAL,
      opensItsOwnDialog: true,
      ...lockFor(addGate),
      onClick: async (
        actionProps: BulkActionOnClickProps<DiscoveredDeviceItem>,
      ): Promise<void> => {
        setDialogImportId(null);
        setDialogDevices([...actionProps.items]);
      },
    },
    {
      title: DISCOVERED_DEVICES_COPY.hideFromMap,
      icon: IconProp.EyeSlash,
      buttonStyleType: ButtonStyleType.NORMAL,
      ...lockFor(hideGate),
      confirmTitle: (items: Array<DiscoveredDeviceItem>): string => {
        return translator.translatePlural(
          {
            one: "Hide {{count}} device from the map?",
            other: "Hide {{count}} devices from the map?",
          },
          items.length,
          { count: translator.formatNumber(items.length) },
        );
      },
      confirmMessage: (items: Array<DiscoveredDeviceItem>): string => {
        return translator.translatePlural(
          {
            one: "It is taken off the topology map for everyone in this project, and stays in this list. Nothing is deleted: a monitored device and its monitoring are never changed, and Show on map brings it back.",
            other:
              "They are taken off the topology map for everyone in this project, and stay in this list. Nothing is deleted: monitored devices and their monitoring are never changed, and Show on map brings them back.",
          },
          items.length,
        );
      },
      resultLabels: {
        succeeded: {
          one: "{{count}} device hidden from the map",
          other: "{{count}} devices hidden from the map",
        },
        failed: {
          one: "{{count}} device not hidden",
          other: "{{count}} devices not hidden",
        },
        unchanged: {
          one: "{{count}} device left as it was",
          other: "{{count}} devices left as they were",
        },
      },
      onClick: async (
        actionProps: BulkActionOnClickProps<DiscoveredDeviceItem>,
      ): Promise<void> => {
        await runMapChange(actionProps, true);
      },
    },
    {
      title: DISCOVERED_DEVICES_COPY.showOnMap,
      icon: IconProp.Eye,
      buttonStyleType: ButtonStyleType.NORMAL,
      ...lockFor(showGate),
      resultLabels: {
        succeeded: {
          one: "{{count}} device back on the map",
          other: "{{count}} devices back on the map",
        },
        failed: {
          one: "{{count}} device not shown",
          other: "{{count}} devices not shown",
        },
        unchanged: {
          one: "{{count}} device left as it was",
          other: "{{count}} devices left as they were",
        },
      },
      onClick: async (
        actionProps: BulkActionOnClickProps<DiscoveredDeviceItem>,
      ): Promise<void> => {
        await runMapChange(actionProps, false);
      },
    },
  ];

  // ---- A row's own actions.

  const actionButtons: Array<ActionButtonSchema<DiscoveredDeviceItem>> = [
    {
      title: DISCOVERED_DEVICES_COPY.addToMonitoring,
      /*
       * "Add" on the row's button, its name still "Add to monitoring": the
       * whole words in German ("Zur Überwachung hinzufügen") pushed the
       * State column under the row's buttons at 1280px beside the menu.
       */
      rowButtonTitle: DISCOVERED_DEVICES_COPY.add,
      icon: IconProp.Add,
      buttonStyleType: ButtonStyleType.NORMAL,
      placement: ActionButtonPlacement.Primary,
      ...lockFor(addGate),
      isVisible: (item: DiscoveredDeviceItem): boolean => {
        return !item.isMonitored;
      },
      // A device the probe has no address for cannot be checked yet.
      getDisabledReason: (item: DiscoveredDeviceItem): string | undefined => {
        return canAddToMonitoring(item)
          ? undefined
          : translator.translateText(DISCOVERED_DEVICES_COPY.noAddressYet);
      },
      onClick: (
        item: DiscoveredDeviceItem,
        onCompleteAction: () => void,
      ): void => {
        setDialogImportId(null);
        setDialogDevices([item]);
        onCompleteAction();
      },
    },
    {
      title: DISCOVERED_DEVICES_COPY.viewDevice,
      rowButtonTitle: DISCOVERED_DEVICES_COPY.view,
      icon: IconProp.ArrowRight,
      buttonStyleType: ButtonStyleType.NORMAL,
      isVisible: (item: DiscoveredDeviceItem): boolean => {
        return Boolean(item.monitoredDevice?.id);
      },
      onClick: (
        item: DiscoveredDeviceItem,
        onCompleteAction: () => void,
      ): void => {
        onCompleteAction();

        if (item.monitoredDevice?.id) {
          Navigation.navigate(deviceRoute(item.monitoredDevice.id));
        }
      },
    },
    {
      title: DISCOVERED_DEVICES_COPY.hideFromMap,
      icon: IconProp.EyeSlash,
      buttonStyleType: ButtonStyleType.NORMAL,
      placement: ActionButtonPlacement.MoreMenu,
      ...lockFor(hideGate),
      isVisible: (item: DiscoveredDeviceItem): boolean => {
        return !item.isMonitored && !item.isHidden;
      },
      onClick: (
        item: DiscoveredDeviceItem,
        onCompleteAction: () => void,
        onError: (err: Error) => void,
      ): void => {
        changeRowOnMap(item, true, onCompleteAction, onError);
      },
    },
    {
      title: DISCOVERED_DEVICES_COPY.showOnMap,
      icon: IconProp.Eye,
      buttonStyleType: ButtonStyleType.NORMAL,
      placement: ActionButtonPlacement.MoreMenu,
      ...lockFor(showGate),
      isVisible: (item: DiscoveredDeviceItem): boolean => {
        return !item.isMonitored && item.isHidden;
      },
      onClick: (
        item: DiscoveredDeviceItem,
        onCompleteAction: () => void,
        onError: (err: Error) => void,
      ): void => {
        changeRowOnMap(item, false, onCompleteAction, onError);
      },
    },
    {
      title: DISCOVERED_DEVICES_COPY.editClassification,
      icon: IconProp.Edit,
      buttonStyleType: ButtonStyleType.NORMAL,
      placement: ActionButtonPlacement.MoreMenu,
      ...lockFor(editGate),
      onClick: (
        item: DiscoveredDeviceItem,
        onCompleteAction: () => void,
      ): void => {
        setItemToClassify(item);
        onCompleteAction();
      },
    },
    {
      title: DISCOVERED_DEVICES_COPY.delete,
      icon: IconProp.Trash,
      buttonStyleType: ButtonStyleType.DANGER_OUTLINE,
      placement: ActionButtonPlacement.MoreMenu,
      ...lockFor(deleteGate),
      getConfirmation: (item: DiscoveredDeviceItem) => {
        return {
          title: translator.translateTemplate("Delete {{name}}?", {
            name: getDiscoveredDeviceLabel(item),
          }),
          description:
            "It leaves this list until a switch, router or network controller reports it again. A monitored device and its monitoring are not changed.",
          submitButtonText: "Delete",
          submitButtonType: ButtonStyleType.DANGER,
        };
      },
      onClick: (
        item: DiscoveredDeviceItem,
        onCompleteAction: () => void,
        onError: (err: Error) => void,
      ): void => {
        ModelAPI.deleteItem<NetworkEndpoint>({
          modelType: NetworkEndpoint,
          id: new ObjectID(item.id),
        })
          .then(() => {
            onCompleteAction();
            reload();
          })
          .catch((err: unknown) => {
            onError(new Error(API.getFriendlyMessage(err)));
          });
      },
    },
  ];

  // ---- Cells.

  const columns: Columns<DiscoveredDeviceItem> = [
    {
      title: "Name",
      key: "name",
      type: FieldType.Element,
      wrapContent: true,
      wrapMaxWidthClassName: "max-w-xs",
      getElement: (item: DiscoveredDeviceItem): ReactElement => {
        const hostname: string | undefined = getHostnameUnderName(item);

        return (
          <div className="min-w-32">
            <p className="break-words text-sm font-medium text-gray-900">
              {item.name}
            </p>
            {hostname ? (
              <p className="break-words text-xs text-gray-500">{hostname}</p>
            ) : (
              <></>
            )}
          </div>
        );
      },
    },
    {
      title: "IP Address",
      key: "ipAddress",
      type: FieldType.Element,
      getElement: (item: DiscoveredDeviceItem): ReactElement => {
        /*
         * Said where the address would be, not only in the greyed-out
         * Add's tooltip, which a phone never shows.
         */
        if (!item.ipAddress) {
          return (
            <span
              className="text-xs text-gray-500"
              data-testid={`discovered-device-no-address-${item.id}`}
            >
              {translator.translateText(DISCOVERED_DEVICES_COPY.noAddress)}
            </span>
          );
        }

        return (
          <span className="text-sm text-gray-900" dir="ltr">
            {item.ipAddress}
          </span>
        );
      },
    },
    /*
     * Where the rows do not fit their card - a 1280px window beside the
     * Network menu - the MAC address goes under the IP address, the vendor
     * under the name and Last Seen under where it was seen, so the State
     * column is never pushed under the row's buttons (TableFit).
     */
    {
      title: "MAC Address",
      key: "macAddress",
      type: FieldType.Element,
      disableSort: true,
      hideOnMobile: true,
      hideBelowLargeScreen: true,
      foldInto: "ipAddress",
      getElement: (item: DiscoveredDeviceItem): ReactElement => {
        if (!item.macAddress) {
          return <TableEmptyValue />;
        }

        return (
          <span className="font-mono text-xs text-gray-700" dir="ltr">
            {item.macAddress}
          </span>
        );
      },
    },
    {
      title: "Vendor",
      key: "vendor",
      type: FieldType.Element,
      hideOnMobile: true,
      hideBelowLargeScreen: true,
      foldInto: "name",
      wrapContent: true,
      wrapMaxWidthClassName: "max-w-48",
      getElement: (item: DiscoveredDeviceItem): ReactElement => {
        if (!item.vendor) {
          return <TableEmptyValue />;
        }

        return <VendorName vendor={item.vendor} />;
      },
    },
    {
      title: "Seen On",
      key: "seenOn",
      type: FieldType.Element,
      disableSort: true,
      hideOnMobile: true,
      wrapContent: true,
      wrapMaxWidthClassName: "max-w-56",
      getElement: (item: DiscoveredDeviceItem): ReactElement => {
        const parts: {
          deviceName?: string | undefined;
          port?: string | undefined;
          vlanId?: number | undefined;
        } = getSeenOnParts(item);
        const where: Array<string> = [];

        if (parts.port) {
          where.push(parts.port);
        }

        if (parts.vlanId !== undefined) {
          where.push(
            translator.translateTemplate("VLAN {{id}}", { id: parts.vlanId }),
          );
        }

        if (!parts.deviceName && where.length === 0) {
          return <TableEmptyValue />;
        }

        return (
          <div className="min-w-28">
            {parts.deviceName && item.seenOn?.id ? (
              <Link
                to={deviceRoute(item.seenOn.id)}
                className={`break-words text-sm ${LINK_CLASS_NAME}`}
              >
                {parts.deviceName}
              </Link>
            ) : (
              <></>
            )}
            {where.length > 0 ? (
              <p className="break-words text-xs text-gray-500">
                {where.join(" · ")}
              </p>
            ) : (
              <></>
            )}
          </div>
        );
      },
    },
    {
      title: "Last Seen",
      key: "lastSeenAt",
      type: FieldType.Element,
      hideBelowLargeScreen: true,
      foldInto: "seenOn",
      showTitleWhenFolded: true,
      getElement: (item: DiscoveredDeviceItem): ReactElement => {
        if (!item.lastSeenAt) {
          return <TableEmptyValue />;
        }

        const lastSeen: Date = OneUptimeDate.fromString(item.lastSeenAt);

        return (
          <span
            className="text-sm text-gray-600"
            title={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
              lastSeen,
            )}
          >
            {OneUptimeDate.fromNow(lastSeen)}
          </span>
        );
      },
    },
    {
      title: "State",
      key: "isHidden",
      type: FieldType.Element,
      disableSort: true,
      getElement: (item: DiscoveredDeviceItem): ReactElement => {
        const state: DiscoveredDeviceState = getDiscoveredDeviceState(item);

        return (
          <div className="space-y-0.5">
            <span
              className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATE_BADGE_CLASS_NAMES[state]}`}
              data-testid={`discovered-device-state-${item.id}`}
            >
              {translator.translateText(DISCOVERED_DEVICE_STATE_LABELS[state])}
            </span>
            {state === DiscoveredDeviceState.Monitored &&
            item.monitoredDevice?.id ? (
              <div>
                <Link
                  to={deviceRoute(item.monitoredDevice.id)}
                  className={`break-words text-xs ${LINK_CLASS_NAME}`}
                  dataTestId={`discovered-device-monitored-${item.id}`}
                >
                  {item.monitoredDevice.name ||
                    translator.translateText(
                      DISCOVERED_DEVICES_COPY.viewDevice,
                    )}
                </Link>
              </div>
            ) : (
              <></>
            )}
          </div>
        );
      },
    },
    /*
     * A Table draws a row's own actions (Add to monitoring, View device and
     * the ⋯) only in a column of their own: ModelTable adds it, this list
     * says it.
     */
    {
      title: "Actions",
      type: FieldType.Actions,
      key: null,
      disableSort: true,
      disableCsvExport: true,
    },
  ];

  // ---- Select every matching row.

  const selectAll: () => Promise<boolean> = async (): Promise<boolean> => {
    selectAllRef.current += 1;
    const token: number = selectAllRef.current;

    setIsSelectAllLoading(true);
    setSelectionError("");

    try {
      const matching: DiscoveredDeviceIdsResponse =
        await selectAllDiscoveredDevices({
          search: debouncedSearch,
          show: show,
          ...(props.siteId ? { siteId: props.siteId } : {}),
          sort: sort.sort,
          sortOrder: sort.sortOrder,
        });

      if (token !== selectAllRef.current) {
        return false;
      }

      // A row on the page keeps everything it shows.
      const onPage: Map<string, DiscoveredDeviceItem> = new Map<
        string,
        DiscoveredDeviceItem
      >(
        rows.map((row: DiscoveredDeviceItem) => {
          return [row.id, row];
        }),
      );

      setSelected(
        matching.devices.map(
          (device: DiscoveredDeviceSelected): DiscoveredDeviceItem => {
            return (
              onPage.get(device.id) || toSelectedDiscoveredDeviceItem(device)
            );
          },
        ),
      );
      setSelectionTotal(matching.count);
      setIsSelectionTruncated(matching.count > matching.devices.length);

      return true;
    } catch (err) {
      if (token === selectAllRef.current) {
        setSelectionError(API.getFriendlyMessage(err));
      }

      return false;
    } finally {
      if (token === selectAllRef.current) {
        setIsSelectAllLoading(false);
      }
    }
  };

  // ---- The header: the search, and Refresh in the ⋯.

  const openSearch: () => void = (): void => {
    setIsSearchOpen(true);
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
  };

  useTableHeaderSearchShortcut(true, openSearch);

  const isSearchExpanded: boolean = isSearchOpen || search.trim().length > 0;

  const moreMenu: ReactElement | null = renderTableHeaderMoreMenu(
    [
      {
        title: "Refresh",
        icon: IconProp.Refresh,
        buttonStyle: ButtonStyleType.ICON,
        onClick: () => {
          reload();
          activeImports.refresh();
        },
      },
    ],
    { dataTestId: "discovered-devices-more" },
  );

  const headerToolbar: ReactElement = (
    <TableHeaderToolbar
      key="discovered-devices-toolbar"
      dataTestId="discovered-devices-toolbar"
      isSearchOpen={isSearchExpanded}
      search={
        <TableHeaderSearchSlot
          isOpen={isSearchExpanded}
          onOpen={openSearch}
          dataTestId="discovered-devices-search-slot"
        >
          <div
            className={`flex w-full items-center gap-2 rounded-md border border-gray-300 bg-white px-3 shadow-sm ${TABLE_HEADER_CONTROL_HEIGHT_CLASS_NAME}`}
            onClick={() => {
              searchInputRef.current?.focus();
            }}
            role="presentation"
          >
            <Icon
              icon={IconProp.Search}
              className="h-4 w-4 flex-none text-gray-500"
            />
            <input
              ref={searchInputRef}
              type="search"
              data-testid="discovered-devices-search"
              aria-label={translator.translateText(
                DISCOVERED_DEVICES_COPY.searchPlaceholder,
              )}
              placeholder={translator.translateText(
                DISCOVERED_DEVICES_COPY.searchPlaceholder,
              )}
              value={search}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                setSearch(event.target.value);
              }}
              onBlur={() => {
                if (!search.trim()) {
                  setIsSearchOpen(false);
                }
              }}
              onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
                if (event.key === "Escape") {
                  setSearch("");
                  setIsSearchOpen(false);
                  event.currentTarget.blur();
                }
              }}
              className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm leading-5 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-0 [&::-webkit-search-cancel-button]:hidden"
            />
            {search ? (
              <button
                type="button"
                data-testid="discovered-devices-search-clear"
                aria-label={translator.translateText(CLEAR_SEARCH)}
                title={translator.translateText(CLEAR_SEARCH)}
                onMouseDown={(event: React.MouseEvent) => {
                  event.preventDefault();
                }}
                onClick={() => {
                  setSearch("");
                  searchInputRef.current?.focus();
                }}
                className={TABLE_HEADER_SEARCH_CLEAR_BUTTON_CLASS_NAME}
              >
                <Icon icon={IconProp.Close} className="h-3.5 w-3.5" />
              </button>
            ) : (
              <></>
            )}
          </div>
        </TableHeaderSearchSlot>
      }
    >
      {moreMenu}
    </TableHeaderToolbar>
  );

  // ---- What an empty list says.

  const emptyState: TableEmptyStateProps | undefined = useMemo(() => {
    if (!counts) {
      return undefined;
    }

    const kind: DiscoveredDeviceEmptyKind = getDiscoveredDeviceEmptyKind({
      search: debouncedSearch,
      show: show,
      counts: counts,
    });

    switch (kind) {
      case DiscoveredDeviceEmptyKind.NoMatch:
        return {
          kind: TableEmptyStateKind.Filtered,
          title: DISCOVERED_DEVICES_COPY.noMatch,
          description: DISCOVERED_DEVICES_COPY.noMatchHint,
          actions: [
            {
              title: DISCOVERED_DEVICES_COPY.clearSearch,
              onClick: () => {
                setSearch("");
              },
              dataTestId: "discovered-devices-clear-search",
            },
          ],
          dataTestId: "discovered-devices-empty",
        };
      case DiscoveredDeviceEmptyKind.MatchesElsewhere:
        return {
          kind: TableEmptyStateKind.Filtered,
          title:
            show === DiscoveredDeviceShow.All
              ? DISCOVERED_DEVICES_COPY.noMatch
              : DISCOVERED_DEVICES_COPY.matchesElsewhere[show],
          description: translator.translatePlural(
            {
              one: "It matches {{count}} device in All.",
              other: "It matches {{count}} devices in All.",
            },
            counts.all,
            { count: translator.formatNumber(counts.all) },
          ),
          actions: [
            {
              title: DISCOVERED_DEVICES_COPY.showAll,
              onClick: () => {
                setShow(DiscoveredDeviceShow.All);
              },
              dataTestId: "discovered-devices-empty-show-all",
            },
            {
              title: DISCOVERED_DEVICES_COPY.clearSearch,
              style: TableEmptyStateActionStyle.Link,
              onClick: () => {
                setSearch("");
              },
              dataTestId: "discovered-devices-clear-search",
            },
          ],
          dataTestId: "discovered-devices-empty",
        };
      case DiscoveredDeviceEmptyKind.AllMonitored:
        return {
          kind: TableEmptyStateKind.AllClear,
          title: DISCOVERED_DEVICES_COPY.allMonitored,
          description: DISCOVERED_DEVICES_COPY.allMonitoredHint,
          dataTestId: "discovered-devices-empty",
        };
      case DiscoveredDeviceEmptyKind.NoneMonitored:
        return {
          kind: TableEmptyStateKind.Empty,
          title: DISCOVERED_DEVICES_COPY.noneMonitored,
          description: DISCOVERED_DEVICES_COPY.noneMonitoredHint,
          dataTestId: "discovered-devices-empty",
        };
      case DiscoveredDeviceEmptyKind.NoneHidden:
        return {
          kind: TableEmptyStateKind.Empty,
          title: DISCOVERED_DEVICES_COPY.noneHidden,
          dataTestId: "discovered-devices-empty",
        };
      case DiscoveredDeviceEmptyKind.NoneYet:
        return {
          kind: TableEmptyStateKind.Empty,
          title: props.siteId
            ? DISCOVERED_DEVICES_COPY.siteNoneYet
            : DISCOVERED_DEVICES_COPY.noneYet,
          description: props.siteId
            ? DISCOVERED_DEVICES_COPY.siteHowToCollect
            : DISCOVERED_DEVICES_COPY.howToCollect,
          dataTestId: "discovered-devices-empty",
        };
    }
  }, [counts, debouncedSearch, show, props.siteId, translator]);

  const runningImports: Array<DiscoveryImportView> =
    activeImports.fromDiscoveredDevices;

  /*
   * The line under the table (issue #6389): how long a device nothing sees
   * stays, once the list or the page has said, and only while there is a
   * device to say it of. Change, for whoever may change it, opens the
   * project's Discovered Devices page at the setting - from a site's list
   * too, as it is the project's.
   */
  const retentionInDays: number | undefined =
    props.retentionInDays ?? listedRetentionInDays;

  const canChangeRetention: boolean = PermissionGate.checkColumnUpdate(
    new Project(),
    "discoveredDeviceRetentionInDays",
  ).isAllowed;

  return (
    <>
      <Card
        title={
          props.siteId
            ? DISCOVERED_DEVICES_COPY.siteTitle
            : DISCOVERED_DEVICES_COPY.title
        }
        description={
          props.siteId
            ? DISCOVERED_DEVICES_COPY.siteDescription
            : DISCOVERED_DEVICES_COPY.description
        }
        headerLayout="toolbar"
        buttons={[headerToolbar]}
      >
        <div data-testid="discovered-devices">
          {runningImports.length > 0 ? (
            <div
              className="mb-4 flex flex-wrap gap-x-8 gap-y-3 rounded-md border border-indigo-100 bg-indigo-50 px-4 py-3"
              data-testid="discovered-devices-running-imports"
            >
              {runningImports.map((view: DiscoveryImportView) => {
                return (
                  <DiscoveryImportRowStatus
                    key={view.id}
                    view={view}
                    onView={() => {
                      setDialogDevices([]);
                      setDialogImportId(view.id);
                    }}
                  />
                );
              })}
            </div>
          ) : (
            <></>
          )}

          <div className="mb-4" data-testid="discovered-devices-show">
            <FilterButtons
              options={getDiscoveredDeviceShowOptions(counts)}
              selectedValue={show}
              ariaLabel="Show"
              dataTestId="discovered-devices-show"
              className="flex-wrap"
              onSelect={(value: string) => {
                if (isDiscoveredDeviceShow(value)) {
                  setShow(value);
                }
              }}
            />
          </div>

          {error && rows.length > 0 ? (
            <div className="mb-4">
              <Alert
                type={AlertType.DANGER}
                title={error}
                dataTestId="discovered-devices-refresh-error"
              />
            </div>
          ) : (
            <></>
          )}

          <Table<DiscoveredDeviceItem>
            id="discovered-devices-table"
            columns={columns}
            data={rows}
            actionButtons={actionButtons}
            singularLabel="Device"
            pluralLabel="Devices"
            isLoading={isLoading}
            error={rows.length === 0 ? error : ""}
            onRefreshClick={reload}
            emptyStateProps={emptyState}
            currentPageNumber={currentPageNumber}
            totalItemsCount={count}
            itemsOnPage={itemsOnPage}
            onNavigateToPage={(pageNumber: number, onPage: number) => {
              setCurrentPageNumber(pageNumber);
              setItemsOnPage(onPage);
            }}
            sortBy={sortBy}
            sortOrder={sortOrder}
            onSortChanged={(
              newSortBy: keyof DiscoveredDeviceItem | null,
              newSortOrder: SortOrder,
            ) => {
              setSortBy(
                newSortBy && isSortableDiscoveredDeviceField(newSortBy)
                  ? newSortBy
                  : null,
              );
              setSortOrder(newSortOrder);
              setCurrentPageNumber(1);
            }}
            bulkActions={{ buttons: bulkActions }}
            bulkSelectedItems={selected}
            matchBulkSelectedItemByField="_id"
            bulkItemToString={(item: DiscoveredDeviceItem): string => {
              return getDiscoveredDeviceLabel(item);
            }}
            onBulkSelectedItemAdded={(item: DiscoveredDeviceItem) => {
              setSelectionError("");
              setSelected((current: Array<DiscoveredDeviceItem>) => {
                return current.some((each: DiscoveredDeviceItem): boolean => {
                  return each.id === item.id;
                })
                  ? current
                  : [...current, item];
              });
            }}
            onBulkSelectedItemRemoved={(item: DiscoveredDeviceItem) => {
              setSelectionError("");
              setSelected((current: Array<DiscoveredDeviceItem>) => {
                return current.filter((each: DiscoveredDeviceItem): boolean => {
                  return each.id !== item.id;
                });
              });
            }}
            onBulkSelectItemsOnCurrentPage={() => {
              setSelected((current: Array<DiscoveredDeviceItem>) => {
                const ids: Set<string> = new Set<string>(
                  current.map((each: DiscoveredDeviceItem): string => {
                    return each.id;
                  }),
                );

                return [
                  ...current,
                  ...rows.filter((row: DiscoveredDeviceItem): boolean => {
                    return !ids.has(row.id);
                  }),
                ];
              });
            }}
            onBulkSelectAllItems={selectAll}
            onBulkClearAllItems={clearSelection}
            bulkSelectionError={selectionError || undefined}
            isBulkSelectAllLoading={isSelectAllLoading}
            isBulkSelectionTruncated={isSelectionTruncated}
            bulkSelectionTotalCount={
              selectionTotal > 0 ? selectionTotal : undefined
            }
            onBulkActionEnd={() => {
              clearSelection();
              reload();
            }}
            /*
             * Rows selected on other pages carry their names only, so a
             * file of them would be mostly empty.
             */
            disableBulkCsvExport={true}
          />

          {retentionInDays !== undefined && counts && counts.all > 0 ? (
            <p
              className="mt-4 text-sm text-gray-500"
              data-testid={DISCOVERED_DEVICES_RETENTION_LINE_TEST_ID}
            >
              {getDiscoveredDeviceRetentionLine(retentionInDays, translator)}
              {canChangeRetention ? (
                <>
                  {" "}
                  <Link
                    to={getRouteToPageAnchor(
                      RouteUtil.populateRouteParams(
                        RouteMap[PageMap.NETWORK_DEVICE_ENDPOINTS] as Route,
                      ),
                      DISCOVERED_DEVICE_RETENTION_PLACE,
                    )}
                    className={LINK_CLASS_NAME}
                    dataTestId={`${DISCOVERED_DEVICES_RETENTION_LINE_TEST_ID}-change`}
                  >
                    {translator.translateText(
                      DiscoveredDeviceRetentionCopy.change,
                    )}
                  </Link>
                </>
              ) : (
                <></>
              )}
            </p>
          ) : (
            <></>
          )}
        </div>
      </Card>

      {dialogDevices ? (
        <AddDiscoveredDevicesDialog
          devices={dialogDevices}
          importId={dialogImportId || undefined}
          onClose={() => {
            setDialogDevices(null);
            setDialogImportId(null);
          }}
          onImportsChanged={() => {
            clearSelection();
            reload();
            activeImports.refresh();
          }}
        />
      ) : (
        <></>
      )}

      {itemToClassify ? (
        <ModelFormModal<NetworkEndpoint>
          modelType={NetworkEndpoint}
          name="discovered-device-classification"
          title={DISCOVERED_DEVICES_COPY.editClassification}
          description={getDiscoveredDeviceLabel(itemToClassify)}
          submitButtonText="Save"
          modelIdToEdit={new ObjectID(itemToClassify.id)}
          onClose={() => {
            setItemToClassify(null);
          }}
          onSuccess={() => {
            setItemToClassify(null);
            reload();
          }}
          formProps={{
            name: "discovered-device-classification-form",
            id: "discovered-device-classification-form",
            modelType: NetworkEndpoint,
            formType: FormType.Update,
            fields: [
              {
                field: {
                  classification: true,
                },
                title: "Classification",
                fieldType: FormFieldSchemaType.Text,
                required: false,
                placeholder: "POS, Kiosk, Camera, Printer, ...",
                description:
                  "What this device is. Free-form: use whatever your team searches by. It names the device in this list and on the map.",
              },
            ],
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default DiscoveredDevicesTable;
