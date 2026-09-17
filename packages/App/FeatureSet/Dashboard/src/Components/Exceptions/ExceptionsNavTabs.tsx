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
import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import { NON_ACTIONABLE_ERROR_CLASSES } from "Common/Types/Telemetry/ErrorClass";
import { ExceptionsTabKey } from "../../Utils/ExceptionsNavigation";

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
            /*
             * The badge is the outstanding actionable backlog signal for the
             * unified Exceptions tab. It deliberately remains unresolved and
             * unarchived when the in-page status filter changes.
             *
             * Match the default "Issues" class lens, which hides user errors
             * and expected denials, so this count represents work that needs
             * attention rather than every captured exception group.
             *
             * IncludesNone, matching ExceptionsViewer exactly: it compiles to
             * `NOT IN ('user-error', 'expected-denial')`, so a class this
             * build has never seen is still counted. An allow-list of the
             * classes we consider real would silently undercount instead.
             */
            errorClass: new IncludesNone([...NON_ACTIONABLE_ERROR_CLASSES]),
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

  /*
   * The Exceptions destination is the only top-level tab backed by
   * ExceptionsViewer. Carry list scope into it from preserved legacy status
   * URLs; Insights and Setup Guide do not render that scope.
   *
   * `status` is not in the carried set because the unified list owns it.
   */
  const tabs: Array<TelemetryTab> = [
    {
      key: "exceptions",
      label: "Exceptions",
      icon: IconProp.Alert,
      to: RouteUtil.populateRouteParams(RouteMap[PageMap.EXCEPTIONS] as Route),
      ...(unresolvedCount !== null && unresolvedCount > 0
        ? {
            badge: {
              text: unresolvedCount > 99 ? "99+" : unresolvedCount.toString(),
              tone: "danger" as const,
            },
          }
        : {}),
      carriesScope: true,
    },
    {
      key: "overview",
      label: "Insights",
      icon: IconProp.ChartBar,
      to: RouteUtil.populateRouteParams(
        RouteMap[PageMap.EXCEPTIONS_OVERVIEW] as Route,
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
