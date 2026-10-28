import PageComponentProps from "../PageComponentProps";
import {
  HOLDS_COLUMN_TITLE,
  NAME_COLUMN_TITLE,
  READ_BY_COLUMN_TITLE,
  VALUES_COLUMN_TITLE,
  WATCHLISTS_EMPTY_DESCRIPTION,
  WATCHLISTS_EMPTY_TITLE,
  WATCHLISTS_TABLE_DESCRIPTION,
  WATCHLISTS_TABLE_TITLE,
  WATCHLISTS_TEST_IDS,
  WATCHLIST_PLURAL,
  WATCHLIST_SINGULAR,
} from "../../Components/SecurityEvents/Watchlists/WatchlistsCopy";
import {
  WatchlistHoldsCell,
  WatchlistNameCell,
  WatchlistReadByCell,
  WatchlistValuesCell,
} from "../../Components/SecurityEvents/Watchlists/WatchlistCells";
import {
  getWatchlistCreateFields,
  getWatchlistHoldsDropdownOptions,
  prepareNewWatchlist,
} from "../../Components/SecurityEvents/Watchlists/WatchlistFormFields";
import { getWatchlistReaders } from "../../Components/SecurityEvents/Watchlists/WatchlistsModel";
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
import React, { FunctionComponent, ReactElement, useState } from "react";

// A watchlist's own page.
export function getWatchlistViewRoute(watchlistId: ObjectID | string): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.SECURITY_EVENTS_WATCHLIST_VIEW] as Route,
    { modelId: watchlistId.toString() },
  );
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
 * Creating a list opens its page, ready for its values.
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
        createInitialValues={
          {
            source: SecurityWatchlistSource.Values,
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
         * Four columns that wrap inside their caps, so the list fits its card
         * beside the side menu at a laptop's width: the list (its name as
         * rules write it, what it is for under it), what it holds, its values
         * and the rules that read it.
         */
        columns={[
          {
            field: { name: true },
            title: NAME_COLUMN_TITLE,
            type: FieldType.Element,
            wrapContent: true,
            wrapMaxWidthClassName: "max-w-[18rem]",
            getElement: (item: SecurityWatchlist): ReactElement => {
              return (
                <WatchlistNameCell
                  name={item.name || ""}
                  description={item.description}
                />
              );
            },
          },
          {
            field: { entityType: true },
            title: HOLDS_COLUMN_TITLE,
            type: FieldType.Element,
            disableSort: true,
            hideOnMobile: true,
            getElement: (item: SecurityWatchlist): ReactElement => {
              return <WatchlistHoldsCell entityType={item.entityType} />;
            },
          },
          {
            field: { threatIntelFeed: { name: true } },
            title: VALUES_COLUMN_TITLE,
            type: FieldType.Element,
            disableSort: true,
            wrapContent: true,
            wrapMaxWidthClassName: "max-w-[14rem]",
            contentClassName: "min-w-[7rem]",
            getElement: (item: SecurityWatchlist): ReactElement => {
              return (
                <WatchlistValuesCell
                  source={item.source}
                  valueCount={item.valueCount}
                  threatIntelFeedId={item.threatIntelFeedId}
                  feedName={item.threatIntelFeed?.name}
                />
              );
            },
          },
          {
            field: { _id: true },
            title: READ_BY_COLUMN_TITLE,
            type: FieldType.Element,
            disableSort: true,
            hideOnMobile: true,
            wrapContent: true,
            wrapMaxWidthClassName: "max-w-[14rem]",
            contentClassName: "min-w-[8rem]",
            getElement: (item: SecurityWatchlist): ReactElement => {
              return (
                <WatchlistReadByCell
                  readers={getWatchlistReaders(readers.readersByKey, item.name)}
                  isLoaded={readers.isLoaded}
                  hasError={readers.hasError}
                />
              );
            },
          },
        ]}
      />
    </div>
  );
};

export default SecurityWatchlistsPage;
