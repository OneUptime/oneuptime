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
            /*
             * The badge has to count what the tab it sits on SHOWS. The
             * Unresolved list opens on the "Issues" class lens, which hides
             * user errors and expected denials, so counting every unresolved
             * group would put a 400 on a tab that lists 12 — and the number a
             * user cannot reconcile with the list is the number that teaches
             * them to ignore the badge.
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
   * Unresolved / Resolved / Archived are the SAME ExceptionsViewer with a
   * different status default, so the service filter, the search and the
   * window the user set on one of them describe the other two just as well.
   * They used to be dropped on every tab click — filter to five services in
   * Unresolved, click Resolved, and the filter was gone.
   *
   * Overview deliberately does not carry: it is a different, unscoped
   * component, and handing it a filtered URL would put a scope in the
   * address bar that none of its numbers honour.
   *
   * `status` is not in the carried set, so each tab still selects its own —
   * carrying it would make every tab show whichever status the user came
   * from.
   */
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
      carriesScope: true,
    },
    {
      key: "resolved",
      label: "Resolved",
      icon: IconProp.Check,
      to: RouteUtil.populateRouteParams(
        RouteMap[PageMap.EXCEPTIONS_RESOLVED] as Route,
      ),
      carriesScope: true,
    },
    {
      key: "archived",
      label: "Archived",
      icon: IconProp.Archive,
      to: RouteUtil.populateRouteParams(
        RouteMap[PageMap.EXCEPTIONS_ARCHIVED] as Route,
      ),
      carriesScope: true,
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
