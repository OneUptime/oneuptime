import Host from "Common/Models/DatabaseModels/Host";
import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Link from "Common/UI/Components/Link/Link";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import useOpenStackRead, { OpenStackRead } from "./UseOpenStackRead";

/*
 * Which cloud a host is part of. OneUptime works this out on its own when only one cloud could
 * be it, and refuses to guess when two could: a name in two clouds, or a restored copy of one.
 * This is the way out of that, and what someone chooses here is never written over.
 *
 * A project with no clouds never sees it, and neither does a read that fails: this is one more
 * thing to set on a host, and never what its settings stand on.
 */

const OpenStackCloudOfHostCard: FunctionComponent<{
  hostId: ObjectID;
}> = (props: { hostId: ObjectID }): ReactElement => {
  const translator: Translator = useTranslator();
  const clouds: OpenStackRead<number> =
    useOpenStackRead<number>(async (): Promise<number> => {
      return await ModelAPI.count<OpenStackCloud>({
        modelType: OpenStackCloud,
        query: { isArchived: false },
      });
    }, []);

  if (!clouds.data) {
    return <></>;
  }

  return (
    <div data-testid="host-openstack-cloud">
      <CardModelDetail<Host>
        name="OpenStack Cloud"
        cardProps={{
          title: translationKey("OpenStack Cloud"),
          description: translationKey(
            "Which OpenStack cloud this host is part of. OneUptime links a host on its own when only one cloud could be it. Choose one here when its name is in more than one. Your choice is never written over.",
          ),
        }}
        isEditable={true}
        editButtonText={translationKey("Choose Cloud")}
        formFields={[
          {
            field: { openStackCloud: true },
            title: translationKey("OpenStack Cloud"),
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: OpenStackCloud,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: translationKey("Select OpenStack Cloud"),
          },
        ]}
        modelDetailProps={{
          modelType: Host,
          id: "model-detail-host-openstack-cloud",
          modelId: props.hostId,
          fields: [
            {
              field: { openStackCloud: { name: true, _id: true } },
              title: translationKey("OpenStack Cloud"),
              fieldType: FieldType.Element,
              getElement: (host: Host): ReactElement => {
                const cloud: OpenStackCloud | undefined = host.openStackCloud;
                return cloud?._id ? (
                  <Link
                    to={
                      RouteUtil.populateRouteParams(
                        RouteMap[PageMap.OPENSTACK_CLOUD_VIEW] as Route,
                        { modelId: new ObjectID(cloud._id.toString()) },
                      ) as Route
                    }
                    className="font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
                  >
                    <bdi>{cloud.name}</bdi>
                  </Link>
                ) : (
                  <span className="text-gray-500">
                    {translator.translateText("None")}
                  </span>
                );
              },
            },
          ],
        }}
      />
    </div>
  );
};

export default OpenStackCloudOfHostCard;
