import { HOME_ROW_CARD_BODY_CLASS_NAME } from "./HomeRowCard";
import AppLink from "../AppLink/AppLink";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import {
  ICON_COLOR_CLASSES,
  IconColorClasses,
} from "Common/UI/Components/Navbar/NavBarMenuModal";
import UiAnalytics from "Common/UI/Utils/Analytics";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import Service from "Common/Models/DatabaseModels/Service";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * What the project is made of: how many monitors, status pages, on-call
 * policies, SLOs, services, dashboards and workflows it has, each opening
 * its list. A count of zero says "Set up" instead, so the same card that
 * shows an experienced team their inventory shows a new one what is still
 * missing.
 *
 * Monitors and SLOs are already counted in Home's batch; the other five are
 * counted here, in parallel. Each count stands alone: a role that may not
 * read workflows loses that row, not the card.
 */

export enum ProjectResourceKey {
  Monitors = "monitors",
  StatusPages = "status-pages",
  OnCallPolicies = "on-call-policies",
  Slos = "slos",
  Services = "services",
  Dashboards = "dashboards",
  Workflows = "workflows",
}

export interface ProjectResourceDefinition {
  key: ProjectResourceKey;
  title: string;
  icon: IconProp;
  // The products menu's colour for the product (NavigationItems).
  iconColor: string;
  pageMap: PageMap;
  /*
   * Counts the resource for the project; undefined for the ones Home's batch
   * counts already.
   */
  count?: ((projectId: ObjectID) => Promise<number>) | undefined;
}

/*
 * Archived records are left out, as their lists leave them out: the number
 * is what the reader finds when they open the list.
 */
export const PROJECT_RESOURCES: Array<ProjectResourceDefinition> = [
  {
    key: ProjectResourceKey.Monitors,
    title: translationKey("Monitors"),
    icon: IconProp.AltGlobe,
    iconColor: "blue",
    pageMap: PageMap.MONITORS,
  },
  {
    key: ProjectResourceKey.StatusPages,
    title: translationKey("Status Pages"),
    icon: IconProp.CheckCircle,
    iconColor: "emerald",
    pageMap: PageMap.STATUS_PAGES,
    count: (projectId: ObjectID): Promise<number> => {
      return ModelAPI.count<StatusPage>({
        modelType: StatusPage,
        query: { projectId: projectId, isArchived: false },
      });
    },
  },
  {
    key: ProjectResourceKey.OnCallPolicies,
    title: translationKey("On-Call Policies"),
    icon: IconProp.Call,
    iconColor: "stone",
    pageMap: PageMap.ON_CALL_DUTY_POLICIES,
    count: (projectId: ObjectID): Promise<number> => {
      return ModelAPI.count<OnCallDutyPolicy>({
        modelType: OnCallDutyPolicy,
        query: { projectId: projectId, isArchived: false },
      });
    },
  },
  {
    key: ProjectResourceKey.Slos,
    title: translationKey("SLOs"),
    icon: IconProp.Gauge,
    iconColor: "violet",
    pageMap: PageMap.SLOS,
  },
  {
    key: ProjectResourceKey.Services,
    title: translationKey("Services"),
    icon: IconProp.SquareStack,
    iconColor: "indigo",
    pageMap: PageMap.SERVICES,
    count: (projectId: ObjectID): Promise<number> => {
      return ModelAPI.count<Service>({
        modelType: Service,
        query: { projectId: projectId, isArchived: false },
      });
    },
  },
  {
    key: ProjectResourceKey.Dashboards,
    title: translationKey("Dashboards"),
    icon: IconProp.ChartPie,
    iconColor: "indigo",
    pageMap: PageMap.DASHBOARDS,
    count: (projectId: ObjectID): Promise<number> => {
      return ModelAPI.count<Dashboard>({
        modelType: Dashboard,
        query: { projectId: projectId, isArchived: false },
      });
    },
  },
  {
    key: ProjectResourceKey.Workflows,
    title: translationKey("Workflows"),
    icon: IconProp.FlowDiagram,
    iconColor: "sky",
    pageMap: PageMap.WORKFLOWS,
    count: (projectId: ObjectID): Promise<number> => {
      return ModelAPI.count<Workflow>({
        modelType: Workflow,
        query: { projectId: projectId, isArchived: false },
      });
    },
  },
];

/*
 * A count per resource key: a number, null while it is being read, or
 * undefined when it could not be read (the row is then left out).
 */
export type ProjectResourceCounts = Partial<
  Record<ProjectResourceKey, number | null | undefined>
>;

export interface ComponentProps {
  projectId: ObjectID;
  // From Home's batch: null while it loads, undefined when it failed.
  totalMonitors: number | null | undefined;
  totalSlos: number | null | undefined;
  // Bumped by Home's Refresh, to count again.
  refreshKey?: number | undefined;
}

const ProjectResources: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const projectIdString: string = props.projectId.toString();

  const [counts, setCounts] = useState<ProjectResourceCounts>({});

  useEffect(() => {
    let isCurrent: boolean = true;
    const projectId: ObjectID = new ObjectID(projectIdString);

    const loading: ProjectResourceCounts = {};

    for (const resource of PROJECT_RESOURCES) {
      if (resource.count) {
        loading[resource.key] = null;
      }
    }

    setCounts(loading);

    Promise.all(
      PROJECT_RESOURCES.filter(
        (resource: ProjectResourceDefinition): boolean => {
          return Boolean(resource.count);
        },
      ).map(
        async (
          resource: ProjectResourceDefinition,
        ): Promise<[ProjectResourceKey, number | undefined]> => {
          try {
            return [resource.key, await resource.count!(projectId)];
          } catch {
            // Not readable by this role, or not reachable: leave the row out.
            return [resource.key, undefined];
          }
        },
      ),
    )
      .then((results: Array<[ProjectResourceKey, number | undefined]>) => {
        if (!isCurrent) {
          return;
        }

        const next: ProjectResourceCounts = {};

        for (const [key, value] of results) {
          next[key] = value;
        }

        setCounts(next);
      })
      .catch(() => {
        // every count catches its own failure.
      });

    return () => {
      isCurrent = false;
    };
  }, [projectIdString, props.refreshKey]);

  const countOf: (
    resource: ProjectResourceDefinition,
  ) => number | null | undefined = (
    resource: ProjectResourceDefinition,
  ): number | null | undefined => {
    if (resource.key === ProjectResourceKey.Monitors) {
      return props.totalMonitors;
    }

    if (resource.key === ProjectResourceKey.Slos) {
      return props.totalSlos;
    }

    return counts[resource.key];
  };

  const visibleResources: Array<ProjectResourceDefinition> =
    PROJECT_RESOURCES.filter((resource: ProjectResourceDefinition): boolean => {
      // A count that failed hides its row; a loading one keeps it.
      return countOf(resource) !== undefined;
    });

  return (
    <div data-testid="home-project-resources">
      {/*
       * The last card of Home's side column - when nothing is scheduled -
       * runs down to the end of the row, level with Needs attention.
       */}
      <Card
        fillHeight={true}
        title="Your project"
        description="What is set up in this project. Open one to manage it."
        headerLayout="stacked"
        bodyClassName={HOME_ROW_CARD_BODY_CLASS_NAME}
      >
        <ul className="divide-y divide-gray-100 border-t border-gray-100">
          {visibleResources.map(
            (resource: ProjectResourceDefinition): ReactElement => {
              const count: number | null | undefined = countOf(resource);
              const colors: IconColorClasses =
                ICON_COLOR_CLASSES[resource.iconColor] ||
                ICON_COLOR_CLASSES["indigo"]!;
              const isEmpty: boolean = count === 0;

              return (
                <li key={resource.key}>
                  <AppLink
                    to={RouteUtil.populateRouteParams(
                      RouteMap[resource.pageMap] as Route,
                    )}
                    onNavigateComplete={() => {
                      UiAnalytics.capture("dashboard/home/resource-opened", {
                        projectId: projectIdString,
                        resource: resource.key,
                        isEmpty: isEmpty,
                      });
                    }}
                    className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 md:px-6"
                  >
                    <span
                      data-testid={`home-resource-${resource.key}`}
                      className="flex min-w-0 flex-1 items-center gap-3"
                    >
                      <span
                        className={`flex h-8 w-8 flex-none items-center justify-center rounded-lg ring-1 ring-inset ${colors.bg} ${colors.ring}`}
                      >
                        <Icon
                          icon={resource.icon}
                          className={`h-4 w-4 ${colors.text}`}
                        />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">
                        {translator.translateText(resource.title)}
                      </span>
                      {count === null ? (
                        <span
                          data-testid={`home-resource-${resource.key}-loading`}
                          className="h-4 w-6 flex-none animate-pulse rounded bg-gray-100"
                        ></span>
                      ) : isEmpty ? (
                        <span
                          data-testid={`home-resource-${resource.key}-set-up`}
                          className="flex-none text-xs font-medium text-indigo-600"
                        >
                          {translator.translateText("Set up")}
                        </span>
                      ) : (
                        <span
                          data-testid={`home-resource-${resource.key}-count`}
                          className="flex-none text-sm font-semibold tabular-nums text-gray-700"
                        >
                          {translator.formatNumber(count || 0)}
                        </span>
                      )}
                    </span>
                    <Icon
                      icon={IconProp.ChevronRight}
                      className="h-4 w-4 flex-none text-gray-400"
                    />
                  </AppLink>
                </li>
              );
            },
          )}
        </ul>
      </Card>
    </div>
  );
};

export default ProjectResources;
