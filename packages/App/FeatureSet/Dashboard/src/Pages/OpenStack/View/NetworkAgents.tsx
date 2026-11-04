import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Link from "Common/UI/Components/Link/Link";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement, useMemo } from "react";
import { OpenStackNetworkAgentList } from "../../../Components/OpenStack/OpenStackLists";
import OpenStackPartNotice from "../../../Components/OpenStack/Part/OpenStackPartNotice";
import { getOpenStackPartRoutes } from "../../../Components/OpenStack/Part/OpenStackPartRoutes";

/*
 * Neutron's agents on their own, because each one has something to say that a row of the
 * Services page has no room for: which routers it holds. The Services page has them beside
 * every other worker, and this says so.
 */
const OpenStackCloudNetworkAgents: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const servicesRoute: Route = useMemo(() => {
    return getOpenStackPartRoutes(modelId).getServicesRoute();
  }, [modelId.toString()]);

  return (
    <Fragment>
      <OpenStackPartNotice testId="openstack-network-agents-services">
        <TranslatedSentence
          template="These are also on the {{services}} page, beside every other worker of this cloud."
          slots={{
            services: (
              <Link
                to={servicesRoute}
                className="font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
              >
                {translator.translateText("Services")}
              </Link>
            ),
          }}
        />
      </OpenStackPartNotice>
      <OpenStackNetworkAgentList openStackCloudId={modelId} />
    </Fragment>
  );
};

export default OpenStackCloudNetworkAgents;
