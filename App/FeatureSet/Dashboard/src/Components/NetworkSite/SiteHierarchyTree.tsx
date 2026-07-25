import { SiteTreeNode, SiteTreeRow, buildSiteTree } from "./SiteTreeUtil";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AppLink from "../AppLink/AppLink";
import Route from "Common/Types/API/Route";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import Icon from "Common/UI/Components/Icon/Icon";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * Expandable hierarchy view for the Sites page — the drill-down mental
 * model (Region → Franchisee → Market → Unit) that a flat table hides.
 * Every row shows rollup status, subtree device count, and links into
 * the site. Levels beyond the second start collapsed so a thousand-unit
 * franchise still loads readable.
 */

const AUTO_EXPAND_DEPTH: number = 1;

export interface ComponentProps {
  // Bumped by the parent whenever sites change (e.g. created via the table).
  refreshToggle?: string | undefined;
}

const SiteHierarchyTree: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [roots, setRoots] = useState<Array<SiteTreeNode>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(
    new Set<string>(),
  );

  const fetchTree: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);

    try {
      const projectId: ObjectID = ProjectUtil.getCurrentProjectId()!;

      const [siteResult, deviceResult]: [
        ListResult<NetworkSite>,
        ListResult<NetworkDevice>,
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
        ModelAPI.getList<NetworkDevice>({
          modelType: NetworkDevice,
          query: {
            projectId: projectId,
            isArchived: false,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            siteId: true,
          },
          sort: {},
        }),
      ]);

      const deviceCountBySiteId: Record<string, number> = {};
      for (const device of deviceResult.data) {
        const siteId: string | undefined = device.siteId?.toString();
        if (!siteId) {
          continue;
        }
        deviceCountBySiteId[siteId] = (deviceCountBySiteId[siteId] || 0) + 1;
      }

      const rows: Array<SiteTreeRow> = siteResult.data.map(
        (site: NetworkSite): SiteTreeRow => {
          return {
            _id: site._id?.toString(),
            name: site.name,
            siteType: site.siteType?.toString(),
            parentSiteId: site.parentSiteId?.toString(),
            statusName: site.currentMonitorStatus?.name,
            statusColor: site.currentMonitorStatus?.color?.toString(),
            isOperational: site.currentMonitorStatus
              ? Boolean(site.currentMonitorStatus.isOperationalState)
              : undefined,
          };
        },
      );

      const tree: Array<SiteTreeNode> = buildSiteTree(
        rows,
        deviceCountBySiteId,
      );

      // Collapse everything deeper than AUTO_EXPAND_DEPTH by default.
      const toCollapse: Set<string> = new Set<string>();
      const stack: Array<SiteTreeNode> = [...tree];
      while (stack.length > 0) {
        const node: SiteTreeNode = stack.pop() as SiteTreeNode;
        if (
          node.depth >= AUTO_EXPAND_DEPTH &&
          node.children.length > 0 &&
          node.site._id
        ) {
          toCollapse.add(node.site._id);
        }
        stack.push(...node.children);
      }

      setRoots(tree);
      setCollapsedIds(toCollapse);
      setError("");
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    fetchTree().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
      setIsLoading(false);
    });
  }, [props.refreshToggle]);

  type ToggleNodeFunction = (siteId: string) => void;

  const toggleNode: ToggleNodeFunction = (siteId: string): void => {
    setCollapsedIds((current: Set<string>) => {
      const next: Set<string> = new Set<string>(current);
      if (next.has(siteId)) {
        next.delete(siteId);
      } else {
        next.add(siteId);
      }
      return next;
    });
  };

  type RenderNodeFunction = (node: SiteTreeNode) => ReactElement;

  const renderNode: RenderNodeFunction = (node: SiteTreeNode): ReactElement => {
    const siteId: string = node.site._id || "";
    const isCollapsed: boolean = collapsedIds.has(siteId);
    const hasChildren: boolean = node.children.length > 0;

    const siteRoute: Route = RouteUtil.populateRouteParams(
      RouteMap[PageMap.NETWORK_SITE_VIEW] as Route,
      { modelId: new ObjectID(siteId) },
    );

    type GetStatusDotFunction = () => ReactElement;
    const getStatusDot: GetStatusDotFunction = (): ReactElement => {
      if (!node.site.statusName) {
        return (
          <span
            title="No health data yet"
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

    return (
      <Fragment key={siteId}>
        <div
          className="flex items-center gap-2 rounded py-1.5 pr-2 hover:bg-gray-50"
          style={{ paddingLeft: `${node.depth * 1.5}rem` }}
        >
          {hasChildren ? (
            <button
              type="button"
              aria-label={isCollapsed ? "Expand" : "Collapse"}
              onClick={() => {
                toggleNode(siteId);
              }}
              className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-200 hover:text-gray-600"
            >
              <Icon
                icon={
                  isCollapsed ? IconProp.ChevronRight : IconProp.ChevronDown
                }
                className="h-4 w-4"
              />
            </button>
          ) : (
            <span className="h-5 w-5 flex-shrink-0"></span>
          )}

          {getStatusDot()}

          <AppLink
            to={siteRoute}
            className="truncate text-sm font-medium text-gray-900 hover:underline"
          >
            {node.site.name || "—"}
          </AppLink>

          {node.site.siteType && (
            <span className="flex-shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
              {node.site.siteType}
            </span>
          )}

          <span className="ml-auto flex-shrink-0 text-xs text-gray-500">
            {node.subtreeDeviceCount} device
            {node.subtreeDeviceCount === 1 ? "" : "s"}
          </span>
        </div>

        {hasChildren && !isCollapsed && (
          <div>
            {node.children.map((child: SiteTreeNode): ReactElement => {
              return renderNode(child);
            })}
          </div>
        )}
      </Fragment>
    );
  };

  if (isLoading) {
    return (
      <Card
        title="Hierarchy"
        description="Your sites as the tree they roll up through."
      >
        <ComponentLoader />
      </Card>
    );
  }

  if (error) {
    // The hierarchy is supplementary — the table below still works.
    return <></>;
  }

  if (roots.length === 0) {
    return <></>;
  }

  return (
    <Card
      title="Hierarchy"
      description="Your sites as the tree they roll up through — status and device counts include everything below each site."
    >
      <div data-testid="site-hierarchy-tree" className="-mx-2">
        {roots.map((root: SiteTreeNode): ReactElement => {
          return renderNode(root);
        })}
      </div>
    </Card>
  );
};

export default SiteHierarchyTree;
