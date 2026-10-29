import PageComponentProps from "../PageComponentProps";
import {
  ADDED_COLUMN_TITLE,
  DESCRIPTION_FIELD_TITLE,
  FEED_FIELD_TITLE,
  FEED_VALUES_DESCRIPTION,
  FEED_VALUES_GONE,
  FEED_VALUES_TITLE,
  HOLDS_FIELD_TITLE,
  IMPORT_VALUES,
  NAME_FIELD_TITLE,
  NOTE_COLUMN_TITLE,
  NOTE_FIELD_DESCRIPTION,
  NOTE_FIELD_TITLE,
  OPEN_THREAT_INTEL,
  SOURCE_FEED_TITLE,
  SOURCE_FIELD_TITLE,
  SOURCE_VALUES_TITLE,
  VALUES_COLUMN_TITLE,
  VALUES_EMPTY_DESCRIPTION,
  VALUES_EMPTY_TITLE,
  VALUES_TABLE_DESCRIPTION,
  VALUES_TABLE_DESCRIPTION_IP,
  VALUES_TABLE_TITLE,
  VALUE_COLUMN_TITLE,
  VALUE_FIELD_DESCRIPTION,
  VALUE_FIELD_TITLE,
  VALUE_PLURAL,
  VALUE_SINGULAR,
  WATCHLISTS_TEST_IDS,
  WATCHLIST_DETAIL_DESCRIPTION,
  WATCHLIST_DETAIL_TITLE,
  WATCHLIST_NOT_FOUND,
} from "../../Components/SecurityEvents/Watchlists/WatchlistsCopy";
import {
  WatchlistHoldsCell,
  WatchlistValuesCell,
} from "../../Components/SecurityEvents/Watchlists/WatchlistCells";
import { getWatchlistEditFields } from "../../Components/SecurityEvents/Watchlists/WatchlistFormFields";
import WatchlistImportModal from "../../Components/SecurityEvents/Watchlists/WatchlistImportModal";
import WatchlistRuleSnippet from "../../Components/SecurityEvents/Watchlists/WatchlistRuleSnippet";
import {
  getWatchlistReaders,
  isFeedWatchlist,
} from "../../Components/SecurityEvents/Watchlists/WatchlistsModel";
import useWatchlistReaders, {
  WatchlistReadersResult,
} from "../../Components/SecurityEvents/Watchlists/useWatchlistReaders";
import { RuleExceptionAddedLine } from "../../Components/SecurityEvents/RuleExceptions/RuleExceptionCells";
import { getSecurityEventsBreadcrumbs } from "../../Utils/Breadcrumbs";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import SecurityWatchlist from "Common/Models/DatabaseModels/SecurityWatchlist";
import SecurityWatchlistItem from "Common/Models/DatabaseModels/SecurityWatchlistItem";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import IconProp from "Common/Types/Icon/IconProp";
import Link from "Common/Types/Link";
import ObjectID from "Common/Types/ObjectID";
import { SecurityEntityType } from "Common/Types/SecurityCase/SecurityEntity";
import { getSecurityWatchlistValueProblem } from "Common/Types/SecurityEvent/SecurityWatchlist";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import { DetailStyle } from "Common/UI/Components/Detail/Detail";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import { ModalTableBulkDefaultActions } from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { usePageBreadcrumbLinks } from "Common/UI/Components/Page/Page";
import { nameRecordInTrail } from "Common/UI/Components/Page/RecordNameInTrail";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

/*
 * ONE WATCHLIST: what it holds and where its values come from (its
 * settings, edited here), how a rule reads it, with the rules that do, and
 * its values - kept by hand (added, imported, edited, deleted) or, for a
 * list that follows a threat intel feed, the feed's.
 *
 * Inside the Security Events menu, Watchlists lit; its crumb names the
 * list once it is read (nameRecordInTrail, as a playbook's does).
 */
const SecurityWatchlistViewPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const watchlistId: ObjectID = Navigation.getLastParamAsObjectID();
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  const [watchlist, setWatchlist] = useState<SecurityWatchlist | null>(null);
  const [isLoaded, setIsLoaded] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [isImporting, setIsImporting] = useState<boolean>(false);
  // Bumped when the values change from outside the table: an import.
  const [valuesVersion, setValuesVersion] = useState<number>(0);

  const readers: WatchlistReadersResult = useWatchlistReaders(projectId);

  const load: () => Promise<void> = useCallback(async (): Promise<void> => {
    try {
      const item: SecurityWatchlist | null =
        await ModelAPI.getItem<SecurityWatchlist>({
          modelType: SecurityWatchlist,
          id: watchlistId,
          select: {
            _id: true,
            name: true,
            description: true,
            entityType: true,
            source: true,
            valueCount: true,
            threatIntelFeedId: true,
            threatIntelFeed: { name: true },
          },
        });

      setWatchlist(item);
      setError(
        item
          ? ""
          : translator.translateText(WATCHLIST_NOT_FOUND) ||
              WATCHLIST_NOT_FOUND,
      );
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoaded(true);
  }, [watchlistId.toString()]);

  useEffect(() => {
    void load();
  }, [load]);

  // "Security Events > Detections > Watchlists > vip_users", once it is read.
  const breadcrumbs: Array<Link> | null = useMemo(() => {
    return (
      nameRecordInTrail({
        links: getSecurityEventsBreadcrumbs(path),
        recordId: watchlistId.toString(),
        recordName: watchlist?.name,
      }) || null
    );
  }, [path, watchlistId.toString(), watchlist?.name]);

  usePageBreadcrumbLinks(watchlist?.name ? breadcrumbs : null);

  if (!isLoaded) {
    return <ComponentLoader />;
  }

  if (error || !watchlist) {
    return <ErrorMessage message={error || WATCHLIST_NOT_FOUND} />;
  }

  const isFeed: boolean = isFeedWatchlist(watchlist.source);
  const entityType: SecurityEntityType | undefined = watchlist.entityType;

  const importButton: CardButtonSchema | null = isFeed
    ? null
    : PermissionGate.gateCardButton(
        {
          title: IMPORT_VALUES,
          buttonStyle: ButtonStyleType.OUTLINE,
          icon: IconProp.Upload,
          onClick: (): void => {
            setIsImporting(true);
          },
        },
        new SecurityWatchlistItem(),
        ModelAction.Create,
      );

  const threatIntel: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.SECURITY_EVENTS_THREAT_INTEL] as Route,
  );

  return (
    <div className="space-y-6">
      <CardModelDetail<SecurityWatchlist>
        name="Security Events > Watchlist"
        cardProps={{
          title: WATCHLIST_DETAIL_TITLE,
          description: WATCHLIST_DETAIL_DESCRIPTION,
        }}
        isEditable={true}
        editButtonText="Edit"
        formFields={getWatchlistEditFields({
          translator,
          entityType: watchlist.entityType,
          source: watchlist.source,
        })}
        onSaveSuccess={() => {
          void load();
        }}
        modelDetailProps={{
          modelType: SecurityWatchlist,
          id: "security-watchlist-detail",
          modelId: watchlistId,
          showDetailsInNumberOfColumns: 2,
          style: DetailStyle.Compact,
          fields: [
            {
              field: { name: true },
              title: NAME_FIELD_TITLE,
              fieldType: FieldType.Element,
              getElement: (item: SecurityWatchlist): ReactElement => {
                return (
                  <span className="text-sm text-gray-900 [overflow-wrap:anywhere]">
                    <IsolatedText
                      text={item.name || ""}
                      className="font-mono"
                    />
                  </span>
                );
              },
            },
            {
              field: { entityType: true },
              title: HOLDS_FIELD_TITLE,
              fieldType: FieldType.Element,
              getElement: (item: SecurityWatchlist): ReactElement => {
                return <WatchlistHoldsCell entityType={item.entityType} />;
              },
            },
            {
              field: { source: true },
              title: SOURCE_FIELD_TITLE,
              fieldType: FieldType.Element,
              getElement: (item: SecurityWatchlist): ReactElement => {
                return (
                  <span className="text-sm text-gray-700">
                    {translator.translateText(
                      isFeedWatchlist(item.source)
                        ? SOURCE_FEED_TITLE
                        : SOURCE_VALUES_TITLE,
                    )}
                  </span>
                );
              },
            },
            {
              field: { valueCount: true },
              title: isFeed ? FEED_FIELD_TITLE : VALUES_COLUMN_TITLE,
              fieldType: FieldType.Element,
              getElement: (): ReactElement => {
                return (
                  <WatchlistValuesCell
                    source={watchlist.source}
                    valueCount={watchlist.valueCount}
                    threatIntelFeedId={watchlist.threatIntelFeedId}
                    feedName={watchlist.threatIntelFeed?.name}
                  />
                );
              },
            },
            {
              field: { description: true },
              title: DESCRIPTION_FIELD_TITLE,
              fieldType: FieldType.LongText,
              placeholder: "-",
            },
          ],
        }}
      />

      <WatchlistRuleSnippet
        name={watchlist.name || ""}
        entityType={watchlist.entityType}
        readers={getWatchlistReaders(readers.readersByKey, watchlist.name)}
        isReadersLoaded={readers.isLoaded}
        hasReadersError={readers.hasError}
      />

      {isFeed ? (
        <Card title={FEED_VALUES_TITLE}>
          <div
            className="space-y-3 text-sm text-gray-700"
            data-testid={WATCHLISTS_TEST_IDS.feedValues}
          >
            <p>
              {watchlist.threatIntelFeedId &&
              watchlist.threatIntelFeed?.name ? (
                <TranslatedSentence
                  template={FEED_VALUES_DESCRIPTION}
                  slots={{
                    feed: (
                      <span className="font-medium text-gray-900">
                        <IsolatedText text={watchlist.threatIntelFeed.name} />
                      </span>
                    ),
                  }}
                />
              ) : (
                translator.translateText(FEED_VALUES_GONE)
              )}
            </p>
            <p>
              <a
                href={threatIntel.toString()}
                onClick={(event: React.MouseEvent<HTMLAnchorElement>) => {
                  event.preventDefault();
                  Navigation.navigate(threatIntel);
                }}
                className="font-medium text-indigo-600 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                {translator.translateText(OPEN_THREAT_INTEL)}
              </a>
            </p>
          </div>
        </Card>
      ) : (
        <ModelTable<SecurityWatchlistItem>
          modelType={SecurityWatchlistItem}
          id={WATCHLISTS_TEST_IDS.valuesTable}
          name="Security Events > Watchlist > Values"
          userPreferencesKey={WATCHLISTS_TEST_IDS.valuesTable}
          singularName={VALUE_SINGULAR}
          pluralName={VALUE_PLURAL}
          createVerb="Add"
          // A row is named by its value: Delete asks about it by name.
          getItemName={(item: SecurityWatchlistItem): string => {
            return item.value || "";
          }}
          query={{
            projectId: projectId!,
            securityWatchlistId: watchlistId,
          }}
          refreshToggle={String(valuesVersion)}
          isDeleteable={true}
          isEditable={true}
          isCreateable={true}
          isViewable={false}
          bulkActions={{
            buttons: [ModalTableBulkDefaultActions.Delete],
          }}
          onCreateSuccess={(
            item: SecurityWatchlistItem,
          ): Promise<SecurityWatchlistItem> => {
            void load();
            return Promise.resolve(item);
          }}
          onItemDeleted={() => {
            void load();
          }}
          sortBy="value"
          sortOrder={SortOrder.Ascending}
          cardProps={{
            title: VALUES_TABLE_TITLE,
            description:
              entityType === SecurityEntityType.IpAddress
                ? VALUES_TABLE_DESCRIPTION_IP
                : VALUES_TABLE_DESCRIPTION,
            buttons: importButton ? [importButton] : [],
          }}
          emptyState={{
            title: VALUES_EMPTY_TITLE,
            description: VALUES_EMPTY_DESCRIPTION,
            icon: IconProp.ListBullet,
          }}
          createInitialValues={
            {
              securityWatchlistId: watchlistId,
            } as FormValues<SecurityWatchlistItem>
          }
          formFields={[
            {
              field: { value: true },
              title: VALUE_FIELD_TITLE,
              description: VALUE_FIELD_DESCRIPTION,
              fieldType: FormFieldSchemaType.Text,
              required: true,
              disableSpellCheck: true,
              customValidation: (
                values: FormValues<SecurityWatchlistItem>,
              ): string | null => {
                const problem: string | null = getSecurityWatchlistValueProblem(
                  {
                    value: (values as Record<string, unknown>)["value"],
                    entityType,
                  },
                );

                return problem
                  ? translator.translateText(problem) || problem
                  : null;
              },
              dataTestId: "watchlist-value",
            },
            {
              field: { note: true },
              title: NOTE_FIELD_TITLE,
              description: NOTE_FIELD_DESCRIPTION,
              fieldType: FormFieldSchemaType.LongText,
              required: false,
              dataTestId: "watchlist-note",
            },
          ]}
          onBeforeCreate={(
            item: SecurityWatchlistItem,
          ): Promise<SecurityWatchlistItem> => {
            item.securityWatchlistId = watchlistId;
            return Promise.resolve(item);
          }}
          showRefreshButton={true}
          searchableFields={["value", "note"]}
          filters={[]}
          selectMoreFields={{ createdAt: true }}
          columns={[
            {
              field: { value: true },
              title: VALUE_COLUMN_TITLE,
              type: FieldType.Element,
              wrapContent: true,
              wrapMaxWidthClassName: "max-w-[20rem]",
              getElement: (item: SecurityWatchlistItem): ReactElement => {
                return (
                  <span className="block text-sm text-gray-900 [overflow-wrap:anywhere]">
                    <IsolatedText
                      text={item.value || ""}
                      className="font-mono"
                      breaksLikeAName={true}
                    />
                  </span>
                );
              },
            },
            {
              field: { note: true },
              title: NOTE_COLUMN_TITLE,
              type: FieldType.Element,
              disableSort: true,
              wrapContent: true,
              wrapMaxWidthClassName: "max-w-[18rem]",
              contentClassName: "min-w-[8rem]",
              getElement: (item: SecurityWatchlistItem): ReactElement => {
                const note: string = (item.note || "").trim();

                return note ? (
                  <span className="block whitespace-pre-line break-words text-sm text-gray-700">
                    <IsolatedText text={note} />
                  </span>
                ) : (
                  <span className="text-sm text-gray-400">-</span>
                );
              },
            },
            {
              field: {
                createdByUser: { name: true, email: true },
              },
              title: ADDED_COLUMN_TITLE,
              type: FieldType.Element,
              disableSort: true,
              hideOnMobile: true,
              wrapContent: true,
              wrapMaxWidthClassName: "max-w-[14rem]",
              getElement: (item: SecurityWatchlistItem): ReactElement => {
                return (
                  <span className="block text-xs text-gray-500">
                    <RuleExceptionAddedLine
                      addedBy={
                        item.createdByUser?.name?.toString() ||
                        item.createdByUser?.email?.toString() ||
                        undefined
                      }
                      createdAt={item.createdAt}
                    />
                  </span>
                );
              },
            },
          ]}
        />
      )}

      {isImporting ? (
        <WatchlistImportModal
          watchlistId={watchlistId}
          entityType={watchlist.entityType}
          onClose={() => {
            setIsImporting(false);
          }}
          onImported={() => {
            setValuesVersion((current: number): number => {
              return current + 1;
            });
            void load();
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default SecurityWatchlistViewPage;
