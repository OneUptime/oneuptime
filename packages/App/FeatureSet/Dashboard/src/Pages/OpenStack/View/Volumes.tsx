import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import { OpenStackCountRow } from "Common/Types/OpenStack/OpenStackCounts";
import Card from "Common/UI/Components/Card/Card";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { OpenStackVolumeList } from "../../../Components/OpenStack/OpenStackLists";
import { formatOpenStackBytes } from "../../../Components/OpenStack/OpenStackResourceList";
import {
  OpenStackRegionState,
  useOpenStackRegion,
} from "../../../Components/OpenStack/OpenStackRegionContext";
import OpenStackLimitedViewNotice from "../../../Components/OpenStack/Part/OpenStackLimitedViewNotice";
import useOpenStackRead, {
  OpenStackRead,
} from "../../../Components/OpenStack/Part/UseOpenStackRead";
import { fetchOpenStackCounts } from "../Utils/OpenStackPartData";
import { getOpenStackCountTotals } from "../Utils/OpenStackPartFacts";

/*
 * Every Cinder volume, and above them which volume types are in use: how many of each and
 * what they add up to, counted on the server. Left out when it can't be read, because the
 * list below it is what a person came for.
 */
const OpenStackCloudVolumes: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const { region }: OpenStackRegionState = useOpenStackRegion();

  const types: OpenStackRead<Array<OpenStackCountRow>> = useOpenStackRead<
    Array<OpenStackCountRow>
  >(() => {
    return fetchOpenStackCounts({
      openStackCloudId: modelId,
      kind: OpenStackResourceKind.Volume,
      by: "volumeType",
    });
  }, [modelId.toString()]);

  const typeTotals: Array<OpenStackCountRow> = getOpenStackCountTotals(
    types.data || [],
    region,
  );
  const noType: string = translator.translateText("No type") || "No type";

  return (
    <Fragment>
      <OpenStackLimitedViewNotice
        openStackCloudId={modelId}
        kind={OpenStackResourceKind.Volume}
      />
      {typeTotals.length > 0 ? (
        <div className="mb-6" data-testid="openstack-volume-types">
          <Card
            title="Volume types in use"
            description="Which types this cloud's volumes are, how many of each, and what they add up to."
          >
            <div className="flex flex-wrap gap-1.5">
              {typeTotals.map((type: OpenStackCountRow): ReactElement => {
                return (
                  <span
                    key={type.value || ""}
                    data-testid="openstack-volume-type"
                    className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-700"
                  >
                    <span className="font-medium">
                      <bdi>{type.value || noType}</bdi>
                    </span>
                    <span>
                      {translator.translatePlural(
                        { one: "{{count}} volume", other: "{{count}} volumes" },
                        type.count,
                      )}
                    </span>
                    {/*
                     * A size reads its own way: "۶٫۰ TiB", its number first
                     * on a page read from the right (issue #7191).
                     */}
                    <IsolatedText
                      text={formatOpenStackBytes(type.sizeBytes, {
                        language: translator.language,
                      })}
                      className="text-gray-500"
                      dataTestId="openstack-volume-type-size"
                    />
                  </span>
                );
              })}
            </div>
          </Card>
        </div>
      ) : (
        <></>
      )}
      <OpenStackVolumeList openStackCloudId={modelId} />
    </Fragment>
  );
};

export default OpenStackCloudVolumes;
