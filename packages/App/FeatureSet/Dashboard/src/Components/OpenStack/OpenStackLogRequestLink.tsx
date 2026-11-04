import Log from "Common/Models/AnalyticsModels/Log";
import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import Link from "Common/UI/Components/Link/Link";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { readOpenStackLineRequest } from "Common/Utils/OpenStack/OpenStackRequestTrail";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import { getOpenStackRequestRoute } from "./OpenStackRequestTrail";

/*
 * On any log line of an OpenStack cloud, wherever it is read: open the request it belongs
 * to, across every service. A line a cloud's own agent sent names its cloud as its record;
 * one from a pod names a Kubernetes cluster, so its cloud is looked up by the name on it.
 * Nothing for any other log.
 */

export interface ComponentProps {
  log: Log;
}

const OpenStackLogRequestLink: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const request: { rootId: string; cloudName: string } | null =
    readOpenStackLineRequest(props.log.attributes);
  const [cloudId, setCloudId] = useState<ObjectID | null>(
    props.log.primaryEntityType === ServiceType.OpenStackCloud &&
      props.log.primaryEntityId
      ? new ObjectID(props.log.primaryEntityId.toString())
      : null,
  );

  useEffect(() => {
    if (!request || cloudId) {
      return;
    }

    let isCurrent: boolean = true;

    ModelAPI.getList<OpenStackCloud>({
      modelType: OpenStackCloud,
      query: { name: request.cloudName },
      select: { _id: true },
      sort: {},
      limit: 1,
      skip: 0,
    })
      .then((result: { data: Array<OpenStackCloud> }): void => {
        const id: ObjectID | undefined | null = result.data[0]?.id;

        if (isCurrent && id) {
          setCloudId(id);
        }
      })
      .catch((): void => {
        // No link is better than one that goes nowhere.
      });

    return () => {
      isCurrent = false;
    };
  }, [request?.cloudName, cloudId?.toString()]);

  if (!request || !cloudId) {
    return <></>;
  }

  const route: Route = getOpenStackRequestRoute({
    openStackCloudId: cloudId,
    rootId: request.rootId,
    at: props.log.time ? new Date(props.log.time) : null,
  });

  return (
    <div className="mb-3 text-sm" data-testid="openstack-log-request-link">
      <Link className="text-indigo-600 hover:underline" to={route}>
        {translator.translateTemplate(
          "Follow request {{request}} across every service",
          { request: request.rootId },
        )}
      </Link>
    </div>
  );
};

export default OpenStackLogRequestLink;
