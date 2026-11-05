import PageComponentProps from "../../PageComponentProps";
import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import {
  OpenStackResourceKind,
  OpenStackServiceType,
} from "Common/Types/OpenStack/OpenStackResourceKind";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";
import GoldenMetricTile from "../../../Components/Infrastructure/GoldenMetricTile";
import OpenStackPartPage from "../../../Components/OpenStack/Part/OpenStackPartPage";
import OpenStackServicePartOverview from "../../../Components/OpenStack/Part/OpenStackServicePartOverview";
import useOpenStackPart, {
  OpenStackPart,
} from "../../../Components/OpenStack/Part/UseOpenStackPart";
import { ResourcePartDetailRow } from "../../../Components/ResourcePart/ResourcePartDetailsCard";
import {
  formatOpenStackBytes,
  formatOpenStackCount,
} from "../../../Components/OpenStack/OpenStackResourceList";
import { OPENSTACK_OBJECT_CONTAINER_ALERT_TEMPLATE_IDS } from "../Utils/OpenStackPartFacts";

/*
 * One Swift container: how much it holds, which is all Swift's account list says of it. A stopped object server
 * reads no differently here, recorded, because the list comes from the account and container servers: only
 * what each storage server says through /recon would say so.
 */
const OpenStackCloudObjectContainerDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const part: OpenStackPart = useOpenStackPart(
    OpenStackResourceKind.ObjectContainer,
  );

  return (
    <OpenStackPartPage
      part={part}
      overview={(row: OpenStackResource): ReactElement => {
        const facts: JSONObject = (row.facts as JSONObject | undefined) || {};
        const objects: JSONValue | undefined = facts["objectCount"];

        const detailRows: Array<ResourcePartDetailRow> = [
          {
            key: "name",
            label: "Container",
            value: row.name || "—",
            mono: true,
            copyText: row.name || "",
          },
        ];
        if (row.regionName) {
          detailRows.push({
            key: "region",
            label: "Region",
            value: row.regionName,
          });
        }

        return (
          <OpenStackServicePartOverview
            part={part}
            row={row}
            service={OpenStackServiceType.ObjectStore}
            slug="object-container"
            alertTemplateIds={OPENSTACK_OBJECT_CONTAINER_ALERT_TEMPLATE_IDS}
            detailRows={detailRows}
            words={{
              thisOne: translationKey("This container"),
              attentionDescription: translationKey(
                "What about this container needs a look.",
              ),
              openTitle: translationKey("Open on this container"),
              openDescription: translationKey(
                "Unresolved incidents and alerts about this container, incidents first.",
              ),
              alertsTitle: translationKey("Object storage alerts"),
              alertsDescription: translationKey(
                "The cloud's alerts that watch every container this credential can read, this one included: each is one monitor on the cloud.",
              ),
              detailsDescription: translationKey(
                "What Swift's account list says about this container.",
              ),
            }}
            tiles={
              <>
                <GoldenMetricTile
                  title="Holds"
                  icon={IconProp.Database}
                  iconColor="sky"
                  value={
                    typeof row.diskAllocatedBytes === "number"
                      ? formatOpenStackBytes(row.diskAllocatedBytes)
                      : "—"
                  }
                  description="How much this container holds, as Swift's account list last said. Swift counts this as it goes, so it can lag behind what has just been written."
                />
                <GoldenMetricTile
                  title="Objects"
                  icon={IconProp.List}
                  iconColor="slate"
                  value={
                    typeof objects === "number"
                      ? formatOpenStackCount(objects)
                      : "—"
                  }
                  description="How many objects this container holds, as Swift's account list last said."
                />
              </>
            }
          />
        );
      }}
    />
  );
};

export default OpenStackCloudObjectContainerDetail;
