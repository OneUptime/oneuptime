import {
  SiteTreeNode,
  SiteTreeRow,
  FilteredSiteTree,
  buildSiteTree,
  countTreeNodes,
  filterSiteTree,
} from "./SiteTreeUtil";
import {
  HIDE_EMPTY_SITES,
  HIDE_HIERARCHY,
  HIERARCHY_ALL_EMPTY,
  HIERARCHY_DESCRIPTION,
  HIERARCHY_DEVICE_COUNT,
  HIERARCHY_MATCH_COUNT,
  HIERARCHY_NO_MATCH,
  HIERARCHY_OPEN_STORAGE_KEY,
  HIERARCHY_PAGE_SIZE,
  HIERARCHY_SEARCH_PLACEHOLDER,
  HIERARCHY_SHOW_MORE,
  HIERARCHY_SITE_COUNT,
  HIERARCHY_TITLE,
  HIERARCHY_TOP_LEVEL_COUNT,
  SHOW_HIERARCHY,
} from "./SiteHierarchyWords";
import CardListSkeleton from "Common/UI/Components/Skeleton/CardListSkeleton";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AppLink from "../AppLink/AppLink";
import Route from "Common/Types/API/Route";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import { fetchSiteDeviceCounts } from "../Network/NetworkSummaryApi";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import CheckboxElement from "Common/UI/Components/Checkbox/Checkbox";
import { ErrorInSentence } from "Common/UI/Components/ErrorMessage/ErrorSentence";
import Icon from "Common/UI/Components/Icon/Icon";
import Input from "Common/UI/Components/Input/Input";
import API from "Common/UI/Utils/API/API";
import LocalStorage from "Common/UI/Utils/LocalStorage";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator, formatInline } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { getNetworkSiteTypeName } from "Common/Utils/NetworkSite/SiteTypeName";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";

/*
 * THE SITES PAGE'S HIERARCHY: the drill-down mental model (Region ->
 * Franchisee -> Market -> Unit) that a flat table hides, each row with its
 * rollup status, its subtree's device count and a link into the site.
 *
 * At the size an import of a Meraki organization leaves - 700 sites, one a
 * network, all at the top (#10188) - drawing every site made the page two
 * very long lists, the table reachable only past the whole tree. So:
 *
 *   - it starts folded under its title, reads nothing until it is shown,
 *     and remembers whether the reader keeps it shown;
 *   - shown, it draws the sites at the top first, a page of them at a time
 *     (Show more), and a site's children only when the site is opened;
 *   - a search narrows it to the sites whose names hold every word typed,
 *     with the sites above each drawn open; and "Hide sites with no
 *     devices" leaves out every site whose subtree holds none.
 */

export interface ComponentProps {
  // Bumped by the parent whenever sites change (e.g. created via the table).
  refreshToggle?: string | undefined;
}

// Whether the reader chose to keep it shown; storage can be unavailable.
export function readHierarchyOpenChoice(): boolean {
  try {
    const value: unknown = LocalStorage.getItem(HIERARCHY_OPEN_STORAGE_KEY);
    return value === true || value === "true";
  } catch {
    return false;
  }
}

function writeHierarchyOpenChoice(isOpen: boolean): void {
  try {
    LocalStorage.setItem(HIERARCHY_OPEN_STORAGE_KEY, isOpen);
  } catch {
    // Not remembering the choice is fine; the toggle still works.
  }
}

// The key a level's "Show more" is kept by: the parent site, or the top.
const TOP_LEVEL_KEY: string = "";

const SiteHierarchyTree: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isOpen, setIsOpen] = useState<boolean>(readHierarchyOpenChoice);
  const [roots, setRoots] = useState<Array<SiteTreeNode> | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [hideEmpty, setHideEmpty] = useState<boolean>(false);
  /*
   * The sites the reader opened or closed, by id: each is drawn the other
   * way from how it starts - closed, or open above what a search found.
   */
  const [toggledIds, setToggledIds] = useState<Set<string>>(new Set<string>());
  // How many sites the project has: none, and there is no tree to show.
  const [projectSiteCount, setProjectSiteCount] = useState<number | null>(null);
  // How many sites of each level are drawn, by its parent's id.
  const [shownByParent, setShownByParent] = useState<Record<string, number>>(
    {},
  );

  const fetchTree: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);

    try {
      const projectId: ObjectID = ProjectUtil.getCurrentProjectId()!;

      /*
       * The sites themselves are drawn, so they come back as rows. The device
       * COUNTS do not: one row per site that has devices
       * (fetchSiteDeviceCounts), never every device of the project.
       */
      const [siteResult, deviceCountBySiteId]: [
        ListResult<NetworkSite>,
        Record<string, number>,
      ] = await Promise.all([
        ModelAPI.getList<NetworkSite>({
          modelType: NetworkSite,
          query: {
            projectId: projectId,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            name: true,
            // The type's name: the relation, and the old column as its fallback.
            networkSiteType: {
              name: true,
            },
            siteType: true,
            parentSiteId: true,
            currentMonitorStatus: {
              name: true,
              color: true,
              isOperationalState: true,
            },
          },
          sort: {},
        }),
        fetchSiteDeviceCounts(),
      ]);

      const rows: Array<SiteTreeRow> = siteResult.data.map(
        (site: NetworkSite): SiteTreeRow => {
          return {
            _id: site._id?.toString(),
            name: site.name,
            siteType: getNetworkSiteTypeName(site),
            parentSiteId: site.parentSiteId?.toString(),
            statusName: site.currentMonitorStatus?.name,
            statusColor: site.currentMonitorStatus?.color?.toString(),
            isOperational: site.currentMonitorStatus
              ? Boolean(site.currentMonitorStatus.isOperationalState)
              : undefined,
          };
        },
      );

      setRoots(buildSiteTree(rows, deviceCountBySiteId));
      setError("");
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  // Whether there are sites at all: one count, never the rows.
  useEffect(() => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      return;
    }

    ModelAPI.count<NetworkSite>({
      modelType: NetworkSite,
      query: { projectId: projectId },
    })
      .then((count: number) => {
        setProjectSiteCount(count);
      })
      .catch(() => {
        // Unknown: the card stays, folded, as it is for any project.
        setProjectSiteCount(null);
      });
  }, [props.refreshToggle]);

  // Read only while shown, and again whenever the page's sites change.
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    fetchTree().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
      setIsLoading(false);
    });
  }, [isOpen, props.refreshToggle]);

  const filtered: FilteredSiteTree | null = useMemo(() => {
    return roots
      ? filterSiteTree(roots, { search: search, hideEmpty: hideEmpty })
      : null;
  }, [roots, search, hideEmpty]);

  // A new search, or hiding the empty sites, starts the tree afresh.
  useEffect(() => {
    setToggledIds(new Set<string>());
    setShownByParent({});
  }, [search, hideEmpty]);

  // Open above what a search found, closed otherwise - or as the reader set it.
  const isNodeOpen: (siteId: string) => boolean = (siteId: string): boolean => {
    const isOpenAtFirst: boolean = Boolean(
      filtered?.isSearching && filtered.openIds.has(siteId),
    );

    return toggledIds.has(siteId) ? !isOpenAtFirst : isOpenAtFirst;
  };

  const toggleOpen: () => void = (): void => {
    const next: boolean = !isOpen;
    setIsOpen(next);
    writeHierarchyOpenChoice(next);
  };

  const toggleNode: (siteId: string) => void = (siteId: string): void => {
    setToggledIds((current: Set<string>) => {
      const next: Set<string> = new Set<string>(current);

      if (next.has(siteId)) {
        next.delete(siteId);
      } else {
        next.add(siteId);
      }

      return next;
    });
  };

  const showMore: (parentKey: string) => void = (parentKey: string): void => {
    setShownByParent((current: Record<string, number>) => {
      return {
        ...current,
        [parentKey]:
          (current[parentKey] || HIERARCHY_PAGE_SIZE) + HIERARCHY_PAGE_SIZE,
      };
    });
  };

  const renderStatusDot: (node: SiteTreeNode) => ReactElement = (
    node: SiteTreeNode,
  ): ReactElement => {
    if (!node.site.statusName) {
      return (
        <span
          title={translator.translateText("No health data yet")}
          className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full bg-gray-300"
        ></span>
      );
    }

    return (
      <span
        title={node.site.statusName}
        className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full"
        style={{
          backgroundColor: node.site.statusColor || "#9ca3af",
        }}
      ></span>
    );
  };

  // One level of sites: a page of them, then Show more.
  const renderLevel: (
    nodes: Array<SiteTreeNode>,
    parentKey: string,
    depth: number,
  ) => ReactElement = (
    nodes: Array<SiteTreeNode>,
    parentKey: string,
    depth: number,
  ): ReactElement => {
    const shown: number = shownByParent[parentKey] || HIERARCHY_PAGE_SIZE;
    const hidden: number = Math.max(0, nodes.length - shown);

    return (
      <>
        {nodes.slice(0, shown).map((node: SiteTreeNode): ReactElement => {
          return renderNode(node);
        })}
        {hidden > 0 ? (
          <div style={{ paddingInlineStart: `${depth * 1.5 + 1.75}rem` }}>
            <button
              type="button"
              className="my-1 text-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:underline"
              onClick={() => {
                showMore(parentKey);
              }}
              data-testid="site-hierarchy-show-more"
            >
              {translator.translatePlural(
                HIERARCHY_SHOW_MORE,
                Math.min(hidden, HIERARCHY_PAGE_SIZE),
              )}
            </button>
          </div>
        ) : (
          <></>
        )}
      </>
    );
  };

  const renderNode: (node: SiteTreeNode) => ReactElement = (
    node: SiteTreeNode,
  ): ReactElement => {
    const siteId: string = node.site._id || "";
    const isOpenNow: boolean = isNodeOpen(siteId);
    const hasChildren: boolean = node.children.length > 0;

    const siteRoute: Route = RouteUtil.populateRouteParams(
      RouteMap[PageMap.NETWORK_SITE_VIEW] as Route,
      { modelId: new ObjectID(siteId) },
    );

    return (
      <Fragment key={siteId}>
        <div
          className="flex items-center gap-2 rounded py-1.5 pr-2 hover:bg-gray-50"
          style={{ paddingInlineStart: `${node.depth * 1.5}rem` }}
          data-testid="site-hierarchy-row"
          data-site-id={siteId}
        >
          {hasChildren ? (
            <button
              type="button"
              aria-label={translator.translateText(
                isOpenNow ? "Collapse" : "Expand",
              )}
              aria-expanded={isOpenNow}
              onClick={() => {
                toggleNode(siteId);
              }}
              className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-200 hover:text-gray-600"
              data-testid="site-hierarchy-toggle"
            >
              <Icon
                icon={isOpenNow ? IconProp.ChevronDown : IconProp.ChevronRight}
                className="h-4 w-4"
              />
            </button>
          ) : (
            <span className="h-5 w-5 flex-shrink-0"></span>
          )}

          {renderStatusDot(node)}

          <AppLink
            to={siteRoute}
            className="truncate text-sm font-medium text-gray-900 hover:underline"
          >
            {node.site.name || <TableEmptyValue />}
          </AppLink>

          {node.site.siteType && (
            <span className="flex-shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
              {node.site.siteType}
            </span>
          )}

          <span className="ml-auto flex-shrink-0 text-xs text-gray-500">
            {translator.translatePlural(
              HIERARCHY_DEVICE_COUNT,
              node.subtreeDeviceCount,
            )}
          </span>
        </div>

        {hasChildren && isOpenNow ? (
          renderLevel(node.children, siteId, node.depth + 1)
        ) : (
          <></>
        )}
      </Fragment>
    );
  };

  const button: CardButtonSchema = {
    title: isOpen ? HIDE_HIERARCHY : SHOW_HIERARCHY,
    buttonStyle: ButtonStyleType.NORMAL,
    icon: isOpen ? IconProp.ChevronUp : IconProp.ChevronDown,
    onClick: toggleOpen,
  };

  const renderBody: () => ReactElement = (): ReactElement => {
    if (isLoading && !roots) {
      return <CardListSkeleton count={3} lines={0} />;
    }

    if (error) {
      return (
        <p className="text-sm text-red-700" data-testid="site-hierarchy-error">
          <ErrorInSentence message={error} />
        </p>
      );
    }

    // No site at all (the count could not say so beforehand): nothing to draw.
    if (!roots || !filtered || roots.length === 0) {
      return <></>;
    }

    const siteCount: number = countTreeNodes(roots);

    const summary: string = filtered.isSearching
      ? translator.translatePlural(HIERARCHY_MATCH_COUNT, filtered.matchCount)
      : formatInline(
          [
            translator.translatePlural(HIERARCHY_SITE_COUNT, siteCount),
            translator.translatePlural(HIERARCHY_TOP_LEVEL_COUNT, roots.length),
          ],
          translator,
        );

    return (
      <div data-testid="site-hierarchy-body">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="w-full sm:max-w-xs">
            <Input
              value={search}
              placeholder={HIERARCHY_SEARCH_PLACEHOLDER}
              ariaLabel={
                translator.translateText(HIERARCHY_SEARCH_PLACEHOLDER) ||
                HIERARCHY_SEARCH_PLACEHOLDER
              }
              onChange={(value: string) => {
                setSearch(value);
              }}
              dataTestId="site-hierarchy-search"
            />
          </div>
          <CheckboxElement
            title={HIDE_EMPTY_SITES}
            value={hideEmpty}
            onChange={(value: boolean) => {
              setHideEmpty(value);
            }}
            dataTestId="site-hierarchy-hide-empty"
          />
          <span
            className="text-sm text-gray-500 sm:ml-auto"
            data-testid="site-hierarchy-summary"
          >
            {summary}
          </span>
        </div>

        {filtered.roots.length === 0 ? (
          <p
            className="py-2 text-sm text-gray-500"
            data-testid="site-hierarchy-nothing"
          >
            {filtered.isSearching
              ? translator.translateTemplate(HIERARCHY_NO_MATCH, {
                  search: search.trim(),
                })
              : translator.translateText(HIERARCHY_ALL_EMPTY) ||
                HIERARCHY_ALL_EMPTY}
          </p>
        ) : (
          <div data-testid="site-hierarchy-tree" className="-mx-2">
            {renderLevel(filtered.roots, TOP_LEVEL_KEY, 0)}
          </div>
        )}
      </div>
    );
  };

  // A project with no site has no tree: the list below says so.
  if (projectSiteCount === 0) {
    return <></>;
  }

  return (
    <Card
      title={HIERARCHY_TITLE}
      description={HIERARCHY_DESCRIPTION}
      buttons={[button]}
    >
      {isOpen ? renderBody() : <></>}
    </Card>
  );
};

export default SiteHierarchyTree;
