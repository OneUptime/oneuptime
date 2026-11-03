import AppLink from "../AppLink/AppLink";
import {
  FLOW_KIND_AI_PROVIDER,
  FLOW_KIND_COPY,
  FLOW_KIND_EXTERNAL_HOST,
  FLOW_KIND_USES,
} from "./FlowKinds";
import { getStoreViewRoute } from "./IssueListRoute";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import DataSecurityFlow from "Common/Models/DatabaseModels/DataSecurityFlow";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * WHERE DATA GOES, AS A CHAIN: STORE -> SERVICE -> DESTINATION.
 *
 * Each flow (FlowKinds) is drawn as the boxes it passes through, with an
 * arrow between: the store the data comes from, the service it passes
 * through, and where it ends up - a store, a host or a provider. A box
 * links to the store's or the service's page.
 */

const UNKNOWN_STORE: string = translationKey("A store");
const UNKNOWN_SERVICE: string = translationKey("A service");
const UNKNOWN_DESTINATION: string = translationKey("Somewhere outside");

type FlowNodeKind = "store" | "service" | "host" | "provider";

interface FlowNode {
  kind: FlowNodeKind;
  name: string;
  to?: Route | undefined;
}

const NODE_ICONS: Record<FlowNodeKind, IconProp> = {
  store: IconProp.Database,
  service: IconProp.Cube,
  host: IconProp.Globe,
  provider: IconProp.Bolt,
};

// The boxes a flow passes through, in order.
export function getFlowNodes(
  flow: DataSecurityFlow,
  translator: Translator,
): Array<FlowNode> {
  const nodes: Array<FlowNode> = [];
  const kind: string = flow.kind || "";
  const sourceId: string = flow.sourceDataStoreId?.toString() || "";
  const serviceId: string = flow.serviceId?.toString() || "";
  const destinationStoreId: string =
    flow.destinationDataStoreId?.toString() || "";

  const storeNode: (id: string, name: string | undefined) => FlowNode = (
    id: string,
    name: string | undefined,
  ): FlowNode => {
    return {
      kind: "store",
      name: name || translator.translateText(UNKNOWN_STORE) || UNKNOWN_STORE,
      to: id ? getStoreViewRoute(id) : undefined,
    };
  };

  if (sourceId || flow.sourceDataStore?.name) {
    nodes.push(storeNode(sourceId, flow.sourceDataStore?.name));
  }

  if (kind !== FLOW_KIND_COPY) {
    // A Uses flow names the service it saw in its destination.
    const serviceName: string =
      flow.service?.name?.toString() ||
      (kind === FLOW_KIND_USES ? flow.destination || "" : "");

    nodes.push({
      kind: "service",
      name:
        serviceName ||
        translator.translateText(UNKNOWN_SERVICE) ||
        UNKNOWN_SERVICE,
      to: serviceId
        ? RouteUtil.populateRouteParams(
            RouteMap[PageMap.SERVICE_VIEW] as Route,
            {
              modelId: new ObjectID(serviceId),
            },
          )
        : undefined,
    });
  }

  if (kind === FLOW_KIND_COPY) {
    nodes.push(storeNode(destinationStoreId, flow.destinationDataStore?.name));
  } else if (
    kind === FLOW_KIND_AI_PROVIDER ||
    kind === FLOW_KIND_EXTERNAL_HOST
  ) {
    nodes.push({
      kind: kind === FLOW_KIND_AI_PROVIDER ? "provider" : "host",
      name:
        flow.destination ||
        translator.translateText(UNKNOWN_DESTINATION) ||
        UNKNOWN_DESTINATION,
    });
  } else if (destinationStoreId) {
    nodes.push(storeNode(destinationStoreId, flow.destinationDataStore?.name));
  }

  return nodes;
}

export interface FlowChainProps {
  flow: DataSecurityFlow;
  // Boxes for the riskiest chains; a line of text in a table's cell.
  size?: "compact" | "large" | undefined;
}

export const FlowChain: FunctionComponent<FlowChainProps> = (
  props: FlowChainProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const nodes: Array<FlowNode> = getFlowNodes(props.flow, translator);
  const isLarge: boolean = props.size === "large";

  return (
    <div
      className={`flex min-w-0 flex-wrap items-center ${
        isLarge ? "gap-2" : "gap-1.5"
      }`}
    >
      {nodes.map((node: FlowNode, index: number): ReactElement => {
        const label: ReactElement = (
          <span
            className={
              isLarge
                ? "inline-flex min-w-0 max-w-[16rem] items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm font-medium text-gray-900"
                : "inline-flex min-w-0 max-w-[12rem] items-center gap-1 text-sm text-gray-900"
            }
          >
            <Icon
              icon={NODE_ICONS[node.kind]}
              className="h-4 w-4 shrink-0 text-gray-400"
            />
            <IsolatedText text={node.name} className="min-w-0 truncate" />
          </span>
        );

        return (
          <React.Fragment key={`${index}-${node.kind}-${node.name}`}>
            {index > 0 ? (
              <Icon
                icon={IconProp.ArrowRight}
                className="h-4 w-4 shrink-0 text-gray-400"
              />
            ) : (
              <></>
            )}
            {node.to ? (
              <AppLink className="min-w-0 hover:underline" to={node.to}>
                {label}
              </AppLink>
            ) : (
              label
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

export default FlowChain;
