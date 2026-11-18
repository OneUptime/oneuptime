import {
  buildEntitySearchQuery,
  buildEntitySearchSelect,
  buildEntitySearchSort,
  getEntitySearchResultTitle,
  PALETTE_SEARCH_PRIORITY,
  slugifyPaletteCommandId,
} from "./DashboardCommandPaletteHelpers";
import { getPageSearchAreas, PageSearchArea } from "./PageSearchIndex";
import {
  matchRecordPageQuery,
  OpenRecord,
  RECORD_PAGE_SEARCH_MAX_RESULTS,
  RECORD_PAGE_SEARCH_RECORD_LIMIT,
  RecordPageQueryMatch,
} from "./RecordPageSearch";
import {
  RecordPageSearchKind,
  RecordPageSearchPage,
} from "./RecordPageSearchIndex";
import { RecordPageSearchModel } from "./RecordPageSearchModels";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import DatabaseBaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Route from "Common/Types/API/Route";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import Sort from "Common/Types/BaseDatabase/Sort";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  PaletteCommand,
  PaletteSearchProvider,
  PaletteSearchResult,
} from "Common/UI/Components/CommandPalette/Types";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";

/*
 * Search's rows for a record's pages (#9204), from RecordPageSearchIndex.ts:
 *
 *  - on a record's page, a row per page of its menu, found by the page's
 *    name alone ("sso" on a status page), above the pages that open without
 *    a record (PALETTE_SEARCH_PRIORITY.recordPage);
 *  - anywhere, the "Pages of records" group: a page's name with a record's
 *    name or its kind ("status page sso", "acme subscribers") looks the
 *    records up, as the record search does, and offers that page of each.
 *
 * The records looked up are the ones the person can see: a kind is looked
 * up only where they may read it, and the server answers with their
 * project's rows they may read.
 */

// The product a kind is in, for a row's breadcrumb and icon.
const getArea: (kind: RecordPageSearchKind) => PageSearchArea | undefined = (
  kind: RecordPageSearchKind,
): PageSearchArea | undefined => {
  return getPageSearchAreas().find((area: PageSearchArea): boolean => {
    return area.id === kind.area;
  });
};

// Where a page of a record opens.
export const getRecordPageRoute: (data: {
  page: RecordPageSearchPage;
  modelId: string;
}) => Route | null = (data: {
  page: RecordPageSearchPage;
  modelId: string;
}): Route | null => {
  const route: Route | undefined = RouteMap[data.page.page];

  if (!route) {
    return null;
  }

  const populated: Route = RouteUtil.populateRouteParams(route, {
    modelId: new ObjectID(data.modelId),
  });

  return new Route(populated.toString() + (data.page.queryString || ""));
};

/**
 * The open record's pages, each a row found by its name: "Single Sign-On",
 * under "Status Pages > Acme Status > Security".
 */
export const buildOpenRecordPageCommands: (data: {
  openRecord: OpenRecord;
  // The record's name, once read; what one is called until then.
  recordTitle?: string | undefined;
  translate: (text: string) => string;
  category: string;
  onNavigate: () => void;
}) => Array<PaletteCommand> = (data: {
  openRecord: OpenRecord;
  recordTitle?: string | undefined;
  translate: (text: string) => string;
  category: string;
  onNavigate: () => void;
}): Array<PaletteCommand> => {
  const kind: RecordPageSearchKind = data.openRecord.kind;
  const area: PageSearchArea | undefined = getArea(kind);
  const areaTitle: string = area ? data.translate(area.title) : "";
  const recordTitle: string =
    data.recordTitle || data.translate(kind.recordName);

  return kind.pages
    .map((page: RecordPageSearchPage): PaletteCommand | null => {
      const route: Route | null = getRecordPageRoute({
        page,
        modelId: data.openRecord.modelId,
      });

      if (!route) {
        return null;
      }

      const title: string = data.translate(page.title);
      const section: string = data.translate(page.section);

      return {
        id: slugifyPaletteCommandId(
          "record-page",
          `${kind.id}-${data.openRecord.modelId}-${page.page}`,
        ),
        title,
        // The English title behind a translated one, and the titles it had.
        titleAliases: Array.from(
          new Set([page.title, ...(page.formerTitles || [])]),
        ).filter((alias: string): boolean => {
          return alias !== title;
        }),
        keywords: page.keywords,
        breadcrumb: [areaTitle, recordTitle, section].filter(
          (crumb: string, index: number, crumbs: Array<string>): boolean => {
            return Boolean(crumb) && crumbs.indexOf(crumb) === index;
          },
        ),
        breadcrumbKeywords: [kind.recordName, page.section, ...kind.keywords],
        icon: area?.icon || IconProp.Search,
        iconColor: area?.iconColor,
        category: data.category,
        isSearchOnly: true,
        searchPriority: PALETTE_SEARCH_PRIORITY.recordPage,
        onSelect: () => {
          data.onNavigate();
          Navigation.navigate(route);
        },
      };
    })
    .filter((command: PaletteCommand | null): command is PaletteCommand => {
      return command !== null;
    });
};

/**
 * The open record's name, for its rows' breadcrumb, or "" when it cannot be
 * read (a kind not looked up, a record the person may not read).
 */
export const loadOpenRecordTitle: (data: {
  openRecord: OpenRecord;
  model: RecordPageSearchModel | undefined;
}) => Promise<string> = async (data: {
  openRecord: OpenRecord;
  model: RecordPageSearchModel | undefined;
}): Promise<string> => {
  if (!data.model) {
    return "";
  }

  try {
    const item: DatabaseBaseModel | null = await ModelAPI.getItem({
      modelType: data.model.modelType,
      id: new ObjectID(data.openRecord.modelId),
      select: buildEntitySearchSelect(
        data.model.spec,
      ) as Select<DatabaseBaseModel>,
    });

    return item ? getEntitySearchResultTitle(data.model.spec, item) : "";
  } catch {
    return "";
  }
};

// The records of one kind the words name, as the record search finds them.
const findRecords: (data: {
  match: RecordPageQueryMatch;
  model: RecordPageSearchModel;
}) => Promise<Array<{ modelId: string; title: string }>> = async (data: {
  match: RecordPageQueryMatch;
  model: RecordPageSearchModel;
}): Promise<Array<{ modelId: string; title: string }>> => {
  const query: JSONObject = data.match.recordText
    ? buildEntitySearchQuery(data.model.spec, data.match.recordText)
    : { ...(data.model.spec.filter || {}) };

  const result: ListResult<DatabaseBaseModel> =
    await ModelAPI.getList<DatabaseBaseModel>({
      modelType: data.model.modelType,
      query: query as Query<DatabaseBaseModel>,
      select: buildEntitySearchSelect(
        data.model.spec,
      ) as Select<DatabaseBaseModel>,
      sort: buildEntitySearchSort(data.model.spec) as Sort<DatabaseBaseModel>,
      limit: RECORD_PAGE_SEARCH_RECORD_LIMIT,
      skip: 0,
    });

  const records: Array<{ modelId: string; title: string }> = [];

  for (const item of result.data) {
    const modelId: string | undefined =
      item._id?.toString() || item.id?.toString();
    const title: string = getEntitySearchResultTitle(data.model.spec, item);

    if (modelId && title) {
      records.push({ modelId, title });
    }
  }

  return records;
};

/**
 * The "Pages of records" group: "status page sso" offers each status page's
 * Single Sign-On, "acme subscribers" the Subscribers of the records named
 * Acme. Only the kinds handed in are looked up: the person may read them
 * and their product is on. A kind that fails to answer shows nothing.
 */
export const createRecordPageSearchProvider: (data: {
  kinds: Array<RecordPageSearchKind>;
  models: Map<string, RecordPageSearchModel>;
  translate: (text: string) => string;
  sectionTitle: string;
  onNavigate: () => void;
}) => PaletteSearchProvider = (data: {
  kinds: Array<RecordPageSearchKind>;
  models: Map<string, RecordPageSearchModel>;
  translate: (text: string) => string;
  sectionTitle: string;
  onNavigate: () => void;
}): PaletteSearchProvider => {
  return {
    id: "record-pages",
    title: data.sectionTitle,
    search: async (searchText: string): Promise<Array<PaletteSearchResult>> => {
      const matches: Array<RecordPageQueryMatch> = matchRecordPageQuery({
        query: searchText,
        kinds: data.kinds,
        translate: data.translate,
      });

      const rowsOfEachKind: Array<Array<PaletteSearchResult>> =
        await Promise.all(
          matches.map(
            async (
              match: RecordPageQueryMatch,
            ): Promise<Array<PaletteSearchResult>> => {
              const model: RecordPageSearchModel | undefined = data.models.get(
                match.kind.id,
              );

              if (!model) {
                return [];
              }

              let records: Array<{ modelId: string; title: string }> = [];

              try {
                records = await findRecords({ match, model });
              } catch {
                return [];
              }

              const area: PageSearchArea | undefined = getArea(match.kind);
              const areaTitle: string = area ? data.translate(area.title) : "";
              const rows: Array<PaletteSearchResult> = [];

              for (const record of records) {
                for (const page of match.pages) {
                  const route: Route | null = getRecordPageRoute({
                    page,
                    modelId: record.modelId,
                  });

                  if (!route) {
                    continue;
                  }

                  rows.push({
                    id: `${match.kind.id}-${record.modelId}-${page.page}`,
                    title: data.translate(page.title),
                    breadcrumb: [
                      areaTitle,
                      record.title,
                      data.translate(page.section),
                    ].filter(
                      (
                        crumb: string,
                        index: number,
                        crumbs: Array<string>,
                      ): boolean => {
                        return (
                          Boolean(crumb) && crumbs.indexOf(crumb) === index
                        );
                      },
                    ),
                    icon: area?.icon || IconProp.Search,
                    iconColor: area?.iconColor,
                    onSelect: () => {
                      data.onNavigate();
                      Navigation.navigate(route);
                    },
                  });
                }
              }

              return rows;
            },
          ),
        );

      return rowsOfEachKind.flat().slice(0, RECORD_PAGE_SEARCH_MAX_RESULTS);
    },
  };
};
