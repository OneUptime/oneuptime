import React, { FunctionComponent, ReactElement } from "react";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AppLink from "../AppLink/AppLink";

/*
 * Shown in place of the Logs / Traces / Metrics viewers (and above the
 * Overview tiles) when a Cloud Environment has no cloud.platform yet.
 *
 * Such an environment exists only because someone created it by hand; ingest
 * always stamps a platform. Until the first OTel batch carrying its
 * cloud.* attributes arrives there is nothing scoped to it, and the honest
 * answer is "nothing yet" — not the whole project's telemetry, which is what
 * an empty attribute filter used to return.
 */

export interface ComponentProps {
  modelId: ObjectID;
  /* The environment key ("platform|account|region"), when known. */
  environmentKey?: string | undefined;
}

const CloudResourceConnectBanner: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const documentationRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.CLOUD_RESOURCE_VIEW_DOCUMENTATION] as Route,
    { modelId: props.modelId },
  );

  return (
    <Card
      title="Waiting for telemetry"
      description="This environment has no cloud.platform yet, so nothing is scoped to it. Logs, traces, metrics and instances appear here once the first OpenTelemetry batch carrying its cloud.* resource attributes arrives."
    >
      <div
        data-testid="cloud-resource-connect-banner"
        className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-4"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-indigo-50 ring-1 ring-inset ring-indigo-200">
            <Icon icon={IconProp.Cloud} className="h-4 w-4 text-indigo-600" />
          </div>
          <div className="min-w-0 text-sm text-gray-700">
            <p>
              <TranslatedSentence
                template="Ingest matches telemetry to an environment by its {{platform}}, {{account}} and {{region}} resource attributes. Configure a cloud resource detector on your collector or SDK so those are set; the environment fills in automatically when the first batch is received."
                slots={{
                  platform: <span className="font-mono">cloud.platform</span>,
                  account: <span className="font-mono">cloud.account.id</span>,
                  region: <span className="font-mono">cloud.region</span>,
                }}
              />
            </p>
            {props.environmentKey ? (
              <p className="mt-2 text-xs text-gray-500">
                <TranslatedSentence
                  template="Environment key: {{key}}"
                  slots={{
                    key: (
                      <span className="font-mono">{props.environmentKey}</span>
                    ),
                  }}
                />
              </p>
            ) : (
              <></>
            )}
            <div className="mt-3">
              <AppLink
                to={documentationRoute}
                className="text-sm font-medium text-indigo-600 hover:underline"
              >
                {
                  translator.translateText(
                    "Open the connection guide →",
                  ) as string
                }
              </AppLink>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
};

export default CloudResourceConnectBanner;
