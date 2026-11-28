import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import Route from "Common/Types/API/Route";
import {
  DashboardResourceScope,
  isDashboardResourceScope,
} from "Common/Types/Dashboard/DashboardResourceScope";
import DashboardVariable, {
  DashboardVariableType,
} from "Common/Types/Dashboard/DashboardVariable";
import ObjectID from "Common/Types/ObjectID";
import Query from "Common/Types/BaseDatabase/Query";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CephCluster from "Common/Models/DatabaseModels/CephCluster";
import DockerSwarmCluster from "Common/Models/DatabaseModels/DockerSwarmCluster";
import Host from "Common/Models/DatabaseModels/Host";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
import StorageArray from "Common/Models/DatabaseModels/StorageArray";
import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";
import XcpNgPool from "Common/Models/DatabaseModels/XcpNgPool";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import {
  getDashboardResourceScopeNoneTitle,
  getDashboardResourceScopeSetUpLabel,
} from "Common/UI/Components/Dashboard/DashboardResourceScopeWords";
import Link from "Common/UI/Components/Link/Link";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";

/*
 * WHAT A BOARD OF A KIND OF RESOURCE SAYS WHILE THE PROJECT HAS NONE OF IT
 * (issue #11258).
 *
 * A template's variable picks among one kind of resource, so the board's
 * widgets read only that kind's telemetry (DashboardResourceScope). A Docker
 * Swarm board in a project with no swarm is therefore empty, where it used to
 * draw the Docker Agent's containers and every log - and empty widgets alone
 * read as a fault. So the board says what is true, above its widgets: there
 * is no Docker Swarm cluster yet, this board shows only theirs, and here is
 * where one is set up. It goes away by itself once the first one is in the
 * project, and shows nothing for a variable that names no kind.
 *
 * The count is of the kind's own rows in the project, archived ones left
 * out, as each product's list leaves them out. A count that cannot be read
 * (no permission to the product) says nothing rather than something untrue.
 */

interface ResourceScopeProduct {
  modelType: { new (): BaseModel };
  page: PageMap;
}

const PRODUCTS: Record<DashboardResourceScope, ResourceScopeProduct> = {
  [DashboardResourceScope.KubernetesCluster]: {
    modelType: KubernetesCluster,
    page: PageMap.KUBERNETES_CLUSTERS,
  },
  [DashboardResourceScope.Host]: { modelType: Host, page: PageMap.HOSTS },
  [DashboardResourceScope.DockerSwarmCluster]: {
    modelType: DockerSwarmCluster,
    page: PageMap.DOCKER_SWARM_CLUSTERS,
  },
  [DashboardResourceScope.ProxmoxCluster]: {
    modelType: ProxmoxCluster,
    page: PageMap.PROXMOX_CLUSTERS,
  },
  [DashboardResourceScope.OpenStackCloud]: {
    modelType: OpenStackCloud,
    page: PageMap.OPENSTACK_CLOUDS,
  },
  [DashboardResourceScope.VMwareVCenter]: {
    modelType: VMwareVCenter,
    page: PageMap.VMWARE_VCENTERS,
  },
  [DashboardResourceScope.XcpNgPool]: {
    modelType: XcpNgPool,
    page: PageMap.XCP_NG_POOLS,
  },
  [DashboardResourceScope.CephCluster]: {
    modelType: CephCluster,
    page: PageMap.CEPH_CLUSTERS,
  },
  [DashboardResourceScope.StorageArray]: {
    modelType: StorageArray,
    page: PageMap.STORAGE_ARRAYS,
  },
};

// The kinds the board's variables pick among, each once, in their order.
export function getDashboardResourceScopes(
  variables: Array<DashboardVariable> | undefined,
): Array<DashboardResourceScope> {
  const scopes: Array<DashboardResourceScope> = [];

  for (const variable of variables || []) {
    if (
      variable.type === DashboardVariableType.TelemetryAttribute &&
      isDashboardResourceScope(variable.resourceScope) &&
      !scopes.includes(variable.resourceScope)
    ) {
      scopes.push(variable.resourceScope);
    }
  }

  return scopes;
}

// The page a kind is set up from: its product's own list.
export function getDashboardResourceScopeSetUpRoute(
  scope: DashboardResourceScope,
): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PRODUCTS[scope].page] as Route,
  );
}

async function hasNoneOfKind(
  scope: DashboardResourceScope,
  projectId: ObjectID,
): Promise<boolean> {
  // Every kind's row has a project and an archived flag (Hosts.tsx reads both).
  const query: Query<BaseModel> = {
    projectId: projectId,
    isArchived: false,
  } as unknown as Query<BaseModel>;

  const count: number = await ModelAPI.count<BaseModel>({
    modelType: PRODUCTS[scope].modelType,
    query: query,
  });

  return count === 0;
}

export interface ComponentProps {
  variables?: Array<DashboardVariable> | undefined;
}

const DashboardResourceScopeNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const scopes: Array<DashboardResourceScope> = useMemo(() => {
    return getDashboardResourceScopes(props.variables);
  }, [props.variables]);
  const scopesKey: string = scopes.join(",");
  const [missingScopes, setMissingScopes] = useState<
    Array<DashboardResourceScope>
  >([]);

  useEffect(() => {
    let cancelled: boolean = false;
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (scopes.length === 0 || !projectId) {
      setMissingScopes([]);
      return undefined;
    }

    Promise.all(
      scopes.map(
        async (
          scope: DashboardResourceScope,
        ): Promise<DashboardResourceScope | null> => {
          try {
            return (await hasNoneOfKind(scope, projectId)) ? scope : null;
          } catch {
            // Unreadable: say nothing rather than something untrue.
            return null;
          }
        },
      ),
    )
      .then((results: Array<DashboardResourceScope | null>) => {
        if (cancelled) {
          return;
        }

        setMissingScopes(
          results.filter(
            (
              scope: DashboardResourceScope | null,
            ): scope is DashboardResourceScope => {
              return scope !== null;
            },
          ),
        );
      })
      .catch(() => {
        if (!cancelled) {
          setMissingScopes([]);
        }
      });

    return () => {
      cancelled = true;
    };
    /*
     * scopesKey stands for scopes: a new list of the same kinds reads
     * nothing again.
     */
  }, [scopesKey]);

  if (missingScopes.length === 0) {
    return <></>;
  }

  return (
    <div className="mb-3 md:mx-3 space-y-2">
      {missingScopes.map((scope: DashboardResourceScope): ReactElement => {
        return (
          <Alert
            key={scope}
            type={AlertType.INFO}
            dataTestId={`dashboard-resource-scope-notice-${scope}`}
            strongTitle={getDashboardResourceScopeNoneTitle(translator, scope)}
            title={
              <span>
                {translator.translateText(
                  "This dashboard shows only their data, so its widgets stay empty until the first one reports to OneUptime.",
                )}{" "}
                <Link
                  to={getDashboardResourceScopeSetUpRoute(scope)}
                  className="font-medium underline"
                >
                  {getDashboardResourceScopeSetUpLabel(translator, scope)}
                </Link>
              </span>
            }
          />
        );
      })}
    </div>
  );
};

export default DashboardResourceScopeNotice;
