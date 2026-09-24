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
 * Shown in place of the Logs / Traces / Metrics viewers (and above the
 * Overview) when a database has no telemetry scope yet: no endpoint that
 * parses and no Kubernetes / container members. A database's telemetry is
 * whatever carries one of its entity keys, and with no keys the honest
 * answer is "nothing yet" — an unscoped viewer would show the whole
 * project's telemetry as this database's.
 */

export interface ComponentProps {
  modelId: ObjectID;
  signal?: string | undefined;
}

export const DATABASE_SERVER_UNSCOPED_TITLE: string = "No telemetry scope yet";

const DatabaseServerUnscopedBanner: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
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
      title={DATABASE_SERVER_UNSCOPED_TITLE}
      description={`This database has no endpoint and no Kubernetes or container members yet, so no ${
        props.signal || "telemetry"
      } can be attributed to it.`}
    >
      <div
        data-testid="database-server-unscoped-banner"
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
            <p>
              A database&apos;s telemetry is matched by its endpoints — the{" "}
              <span className="font-mono">host:port</span> your applications
              connect to — and by the pods or containers it runs as. Add the
              endpoint your applications use, or connect the Database Agent with
              this database&apos;s id, and its data appears here.
            </p>
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
