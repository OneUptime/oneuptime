import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import TelemetryNavTabs, { TelemetryTab } from "../Telemetry/NavTabs";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";

export type ExceptionsTabKey =
  | "overview"
  | "unresolved"
  | "resolved"
  | "archived"
  | "setup";

interface Props {
  active: ExceptionsTabKey;
  trailing?: ReactElement | undefined;
}

const ExceptionsNavTabs: FunctionComponent<Props> = (
  props: Props,
): ReactElement => {
  const [unresolvedCount, setUnresolvedCount] = useState<number | null>(null);

  useEffect(() => {
    const projectId: string | null =
      ProjectUtil.getCurrentProjectId()?.toString() || null;
    if (!projectId) {
      return;
    }
    let cancelled: boolean = false;
    const fetch: () => Promise<void> = async () => {
      try {
        const count: number = await ModelAPI.count({
          modelType: TelemetryException,
          query: {
            projectId: ProjectUtil.getCurrentProjectId()!,
            isResolved: false,
            isArchived: false,
          } as never,
        });
        if (!cancelled) {
          setUnresolvedCount(count);
        }
      } catch {
        // non-critical
      }
    };
    void fetch();
    return () => {
      cancelled = true;
    };
  }, []);

  const tabs: Array<TelemetryTab> = [
    {
      key: "overview",
      label: "Overview",
      icon: IconProp.Home,
      to: RouteUtil.populateRouteParams(
        RouteMap[PageMap.EXCEPTIONS_OVERVIEW] as Route,
      ),
    },
    {
      key: "unresolved",
      label: "Unresolved",
      icon: IconProp.Alert,
      to: RouteUtil.populateRouteParams(
        RouteMap[PageMap.EXCEPTIONS_UNRESOLVED] as Route,
      ),
      ...(unresolvedCount !== null && unresolvedCount > 0
        ? {
            badge: {
              text: unresolvedCount > 99 ? "99+" : unresolvedCount.toString(),
              tone: "danger" as const,
            },
          }
        : {}),
    },
    {
      key: "resolved",
      label: "Resolved",
      icon: IconProp.Check,
      to: RouteUtil.populateRouteParams(
        RouteMap[PageMap.EXCEPTIONS_RESOLVED] as Route,
      ),
    },
    {
      key: "archived",
      label: "Archived",
      icon: IconProp.Archive,
      to: RouteUtil.populateRouteParams(
        RouteMap[PageMap.EXCEPTIONS_ARCHIVED] as Route,
      ),
    },
    {
      key: "setup",
      label: "Setup Guide",
      icon: IconProp.Book,
      to: RouteUtil.populateRouteParams(
        RouteMap[PageMap.EXCEPTIONS_DOCUMENTATION] as Route,
      ),
    },
  ];

  return (
    <TelemetryNavTabs
      tabs={tabs}
      activeKey={props.active}
      trailing={props.trailing}
    />
  );
};

export default ExceptionsNavTabs;
