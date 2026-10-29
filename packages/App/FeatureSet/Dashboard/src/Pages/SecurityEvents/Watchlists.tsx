import PageComponentProps from "../PageComponentProps";
import {
  HOLDS_COLUMN_TITLE,
  NAME_COLUMN_TITLE,
  READ_BY_COLUMN_TITLE,
  WATCHLISTS_EMPTY_DESCRIPTION,
  WATCHLISTS_EMPTY_TITLE,
  WATCHLISTS_TABLE_DESCRIPTION,
  WATCHLISTS_TABLE_TITLE,
  WATCHLISTS_TEST_IDS,
  WATCHLIST_PLURAL,
  WATCHLIST_SINGULAR,
} from "../../Components/SecurityEvents/Watchlists/WatchlistsCopy";
import {
  WatchlistHoldsColumnCell,
  WatchlistNameCell,
  WatchlistReadByCell,
  WatchlistReadersState,
  WatchlistValuesFacts,
} from "../../Components/SecurityEvents/Watchlists/WatchlistCells";
import {
  getWatchlistCreateFields,
  getWatchlistHoldsDropdownOptions,
  prepareNewWatchlist,
} from "../../Components/SecurityEvents/Watchlists/WatchlistFormFields";
import {
  describeWatchlistValues,
  getWatchlistHoldsLabel,
  getWatchlistReaders,
} from "../../Components/SecurityEvents/Watchlists/WatchlistsModel";
import {
  WATCHLIST_CREATE_PARAM,
  readWatchlistNameToCreate,
} from "../../Components/SecurityEvents/Watchlists/WatchlistsRoute";
import WatchlistStarters from "../../Components/SecurityEvents/Watchlists/WatchlistStarters";
import useWatchlistReaders, {
  WatchlistReadersResult,
} from "../../Components/SecurityEvents/Watchlists/useWatchlistReaders";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import SecurityWatchlist from "Common/Models/DatabaseModels/SecurityWatchlist";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { SecurityWatchlistSource } from "Common/Types/SecurityEvent/SecurityWatchlist";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { ModalTableBulkDefaultActions } from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
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

// A watchlist's own page.
export function getWatchlistViewRoute(watchlistId: ObjectID | string): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.SECURITY_EVENTS_WATCHLIST_VIEW] as Route,
    { modelId: watchlistId.toString() },
  );
}

// A list's values as its row reads them.
function valuesOf(item: SecurityWatchlist): WatchlistValuesFacts {
  return {
    source: item.source,
    valueCount: item.valueCount,
    threatIntelFeedId: item.threatIntelFeedId,
    feedName: item.threatIntelFeed?.name,
  };
}

/*
 * SECURITY EVENTS > DETECTIONS > WATCHLISTS: the lists the project's rules
 * match against - VIP users, critical hosts, known-bad file hashes, allowed
 * admin addresses - each with what it holds, its values (how many it keeps,
 * or the threat intel feed it follows) and the rules that read it.
 *
 * Above them, while the project lacks one, the common lists to start with,
 * one click each (WatchlistStarters). A row opens the list's page, where its
 * values are added, imported and edited, and the list itself is edited.
 * Creating a list opens its page, ready for its values. Opened with a name
 * to create (?create=board_members, from a rule's form that names a list
 * the project lacks), Create Watchlist opens at once with that name.
 */
const SecurityWatchlistsPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  // Bumped when the lists change, so the starters and the readers read again.
  const [version, setVersion] = useState<number>(0);
  const readers: WatchlistReadersResult = useWatchlistReaders(
    projectId,
    String(version),
  );

  /*
   * The list a rule's form sent the reader here to create, read once: the
   * address forgets it, so a reload or Back never opens the form again.
   */
  const [nameToCreate] = useState<string | null>(() => {
    return readWatchlistNameToCreate(
      Navigation.getQueryStringByName(WATCHLIST_CREATE_PARAM),
    );
  });

  useEffect(() => {
    if (Navigation.getQueryStringByName(WATCHLIST_CREATE_PARAM)) {
      Navigation.setQueryString({ [WATCHLIST_CREATE_PARAM]: null });
    }
  }, []);

  const readersOf: (item: SecurityWatchlist) => WatchlistReadersState = (
    item: SecurityWatchlist,
  ): WatchlistReadersState => {
    return {
      readers: getWatchlistReaders(readers.readersByKey, item.name),
      isLoaded: readers.isLoaded,
      hasError: readers.hasError,
    };
  };

  // Same reseller-telemetry gate as every other Security Events page.
  if (props.currentProject?.reseller?.enableTelemetryFeatures === false) {
    return (
      <ErrorMessage message="Looks like you have bought this plan from a reseller. It did not include telemetry features in your plan. Telemetry features are disabled for this project." />
    );
  }

  if (!projectId) {
    return <></>;
  }

  return (
    <div className="space-y-6">
      <WatchlistStarters
        projectId={projectId}
        refreshToggle={String(version)}
        onAdded={() => {
          setVersion((current: number): number => {
            return current + 1;
          });
        }}
      />

      <ModelTable<SecurityWatchlist>
        modelType={SecurityWatchlist}
        id={WATCHLISTS_TEST_IDS.table}
        name="Security Events > Watchlists"
        userPreferencesKey={WATCHLISTS_TEST_IDS.table}
        singularName={WATCHLIST_SINGULAR}
        pluralName={WATCHLIST_PLURAL}
        // A row is named as rules write it: Delete asks about it by name.
        getItemName={(item: SecurityWatchlist): string => {
          return item.name || "";
        }}
        query={{ projectId }}
        refreshToggle={String(version)}
        isDeleteable={true}
        bulkActions={{
          buttons: [ModalTableBulkDefaultActions.Delete],
        }}
        // A list is edited on its page, which knows where its values come from.
        isEditable={false}
        isCreateable={true}
        isViewable={true}
        viewButtonText="View"
        viewPageRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.SECURITY_EVENTS_WATCHLISTS] as Route,
        )}
        onCreateSuccess={(
          item: SecurityWatchlist,
        ): Promise<SecurityWatchlist> => {
          // A new list is empty: its page is where its values go.
          if (item._id) {
            Navigation.navigate(getWatchlistViewRoute(item._id.toString()));
          }

          return Promise.resolve(item);
        }}
        onItemDeleted={() => {
          setVersion((current: number): number => {
            return current + 1;
          });
        }}
        sortBy="name"
        sortOrder={SortOrder.Ascending}
        cardProps={{
          title: WATCHLISTS_TABLE_TITLE,
          description: WATCHLISTS_TABLE_DESCRIPTION,
        }}
        emptyState={{
          title: WATCHLISTS_EMPTY_TITLE,
          description: WATCHLISTS_EMPTY_DESCRIPTION,
          icon: IconProp.QueueList,
        }}
        showCreateForm={Boolean(nameToCreate)}
        createInitialValues={
          {
            source: SecurityWatchlistSource.Values,
            ...(nameToCreate ? { name: nameToCreate } : {}),
          } as FormValues<SecurityWatchlist>
        }
        formFields={getWatchlistCreateFields({ translator })}
        // What the form hid is not sent: a list no feed can fill keeps its own values.
        onBeforeCreate={(
          item: SecurityWatchlist,
        ): Promise<SecurityWatchlist> => {
          return Promise.resolve(prepareNewWatchlist(item));
        }}
        showRefreshButton={true}
        searchableFields={["name", "description"]}
        filters={[
          {
            field: { entityType: true },
            title: HOLDS_COLUMN_TITLE,
            type: FieldType.Dropdown,
            filterDropdownOptions: getWatchlistHoldsDropdownOptions(),
          },
        ]}
        selectMoreFields={{
          description: true,
          entityType: true,
          source: true,
          valueCount: true,
          threatIntelFeedId: true,
        }}
        /*
         * Three columns that wrap inside their caps, so the list fits its
         * card beside the side menu at a laptop's width - 684px at 1024,
         * where the three at their floors (9rem, 7rem and 6rem) leave room
         * for the check box and the row's buttons in every language, a
         * German "Anzeigen" included: the list (its name as rules write
         * it, what it is for under it), what it holds with its values
         * under it, and the rules that read it.
         * Below lg - a tablet beside the side menu, a phone's card - Holds
         * and Read By fold under the name (WatchlistNameCell), so nothing
         * runs under the row's buttons.
         */
        columns={[
          {
            field: { name: true },
            title: NAME_COLUMN_TITLE,
            type: FieldType.Element,
            // A phone's card is about the list: its name needs no label.
            hideTitleOnMobile: true,
            wrapContent: true,
            wrapMaxWidthClassName: "max-w-[18rem]",
            // A name breaks anywhere, and what it is for between its words.
            contentClassName: "min-w-[9rem]",
            getExportValue: (item: SecurityWatchlist): string => {
              return item.name || "";
            },
            getElement: (item: SecurityWatchlist): ReactElement => {
              return (
                <WatchlistNameCell
                  name={item.name || ""}
                  description={item.description}
                  entityType={item.entityType}
                  values={valuesOf(item)}
                  readers={readersOf(item)}
                />
              );
            },
          },
          {
            field: { threatIntelFeed: { name: true } },
            title: HOLDS_COLUMN_TITLE,
            type: FieldType.Element,
            disableSort: true,
            hideBelowLargeScreen: true,
            wrapContent: true,
            wrapMaxWidthClassName: "max-w-[14rem]",
            // Its kind's name and values wrap between their words.
            contentClassName: "min-w-[7rem]",
            getExportValue: (item: SecurityWatchlist): string => {
              return [
                getWatchlistHoldsLabel(translator, item.entityType),
                describeWatchlistValues(translator, valuesOf(item)),
              ].join(" · ");
            },
            getElement: (item: SecurityWatchlist): ReactElement => {
              return (
                <WatchlistHoldsColumnCell
                  entityType={item.entityType}
                  {...valuesOf(item)}
                />
              );
            },
          },
          {
            field: { _id: true },
            title: READ_BY_COLUMN_TITLE,
            type: FieldType.Element,
            disableSort: true,
            hideBelowLargeScreen: true,
            wrapContent: true,
            wrapMaxWidthClassName: "max-w-[14rem]",
            // A rule's name wraps between its words.
            contentClassName: "min-w-[6rem]",
            getExportValue: (item: SecurityWatchlist): string => {
              return getWatchlistReaders(readers.readersByKey, item.name)
                .map((reader: { id: string; name: string }): string => {
                  return reader.name;
                })
                .join(", ");
            },
            getElement: (item: SecurityWatchlist): ReactElement => {
              return <WatchlistReadByCell {...readersOf(item)} />;
            },
          },
        ]}
      />
    </div>
  );
};

export default SecurityWatchlistsPage;
