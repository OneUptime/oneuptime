import React, { FunctionComponent, ReactElement } from "react";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AppLink from "../AppLink/AppLink";

/*
 * What a database's Logs / Traces / Metrics tabs (and its Overview) say
 * about the scope they read. A database's telemetry is whatever carries one
 * of its entity keys: its row key (telemetry sent with its id), one per
 * endpoint and one per pod / container it runs as.
 *
 *   - "unscoped": no key at all, so no viewer is mounted — an unscoped
 *     viewer would show the whole project's telemetry as this database's.
 *     A loaded row always has its row key, so this is a defensive state.
 *   - "id-only": the row key is all it has (no endpoint, no members). The
 *     viewer is mounted, and this hint above it says that only telemetry
 *     sent with the database's id — the Database Agent's DATABASE_SERVER_ID,
 *     or a collector stamping oneuptime.database.server.id — will show; the
 *     queries its applications send are matched by endpoint.
 */

export type DatabaseServerScopeBannerVariant = "unscoped" | "id-only";

export interface ComponentProps {
  modelId: ObjectID;
  signal?: string | undefined;
  variant?: DatabaseServerScopeBannerVariant | undefined;
}

export const DATABASE_SERVER_UNSCOPED_TITLE: string = "No telemetry scope yet";

export const DATABASE_SERVER_ID_ONLY_TITLE: string = "Matched by its id only";

/** The card's description for a variant and signal ("logs", "metrics"). */
export function getDatabaseServerScopeBannerDescription(
  variant: DatabaseServerScopeBannerVariant,
  signal?: string | undefined,
): string {
  const what: string = signal || "telemetry";
  if (variant === "id-only") {
    return `This database has no endpoint and no Kubernetes or container members yet, so what shows here is only the ${what} sent with its id. The queries your applications send it are matched by endpoint.`;
  }
  return `This database has no endpoint and no Kubernetes or container members yet, so no ${what} can be attributed to it.`;
}

const DatabaseServerUnscopedBanner: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const variant: DatabaseServerScopeBannerVariant = props.variant || "unscoped";
  const endpointsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.DATABASE_SERVER_VIEW_ENDPOINTS] as Route,
    { modelId: props.modelId },
  );
  const documentationRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.DATABASE_SERVER_VIEW_DOCUMENTATION] as Route,
    { modelId: props.modelId },
  );

  return (
    <Card
      title={
        variant === "id-only"
          ? DATABASE_SERVER_ID_ONLY_TITLE
          : DATABASE_SERVER_UNSCOPED_TITLE
      }
      description={getDatabaseServerScopeBannerDescription(
        variant,
        props.signal,
      )}
    >
      <div
        data-testid="database-server-unscoped-banner"
        data-variant={variant}
        className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-4"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-indigo-50 ring-1 ring-inset ring-indigo-200">
            <Icon
              icon={IconProp.Database}
              className="h-4 w-4 text-indigo-600"
            />
          </div>
          <div className="min-w-0 text-sm text-gray-700">
            {variant === "id-only" ? (
              <p>
                Data sent with this database&apos;s id shows here: the Database
                Agent run with{" "}
                <span className="font-mono">DATABASE_SERVER_ID</span>, or any
                collector that stamps{" "}
                <span className="font-mono">oneuptime.database.server.id</span>.
                To see the queries your applications send it as well, add the{" "}
                <span className="font-mono">host:port</span> they connect to.
              </p>
            ) : (
              <p>
                A database&apos;s telemetry is matched by its endpoints — the{" "}
                <span className="font-mono">host:port</span> your applications
                connect to — and by the pods or containers it runs as. Add the
                endpoint your applications use, or connect the Database Agent
                with this database&apos;s id, and its data appears here.
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-4">
              <AppLink
                to={endpointsRoute}
                className="text-sm font-medium text-indigo-600 hover:underline"
              >
                Add an endpoint →
              </AppLink>
              <AppLink
                to={documentationRoute}
                className="text-sm font-medium text-indigo-600 hover:underline"
              >
                Connect the Database Agent →
              </AppLink>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
};

export default DatabaseServerUnscopedBanner;
