import ObjectID from "Common/Types/ObjectID";
import { OpenStackBareMetalClass } from "Common/Types/OpenStack/OpenStackBareMetal";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledListClassName } from "Common/UI/Components/Card/CardSurface";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import { fetchOpenStackBareMetalClasses } from "../../Pages/OpenStack/Utils/OpenStackPartData";
import {
  OpenStackRegionState,
  useOpenStackRegion,
} from "./OpenStackRegionContext";
import useOpenStackRead, { OpenStackRead } from "./Part/UseOpenStackRead";

/*
 * What there is of each resource class, which is what a flavor asks a bare metal cloud for. Read on
 * the server, one statement, so it reads the same however many nodes there are. "Can take an
 * instance" is what Nova's Ironic driver asks of a node (canOpenStackBareMetalNodeTakeAnInstance).
 * What only says so much is left to Placement's numbers, which the capacity pages add up.
 */
export interface ComponentProps {
  openStackCloudId: ObjectID;
}

function countText(
  translator: Translator,
  label: string,
  count: number,
): string {
  return `${translator.translateText(label)}: ${translator.formatNumber(count)}`;
}

const OpenStackBareMetalClassesCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const listClassName: string = useCardRuledListClassName();
  const { region }: OpenStackRegionState = useOpenStackRegion();

  const read: OpenStackRead<Array<OpenStackBareMetalClass>> = useOpenStackRead<
    Array<OpenStackBareMetalClass>
  >(() => {
    return fetchOpenStackBareMetalClasses({
      openStackCloudId: props.openStackCloudId,
      regionName: region,
    });
  }, [props.openStackCloudId.toString(), region]);

  // Supplementary: the list below says the same a node at a time, however this read went.
  if (!read.data || read.data.length === 0) {
    return <></>;
  }

  return (
    <div className="mb-6" data-testid="openstack-bare-metal-classes">
      <Card
        title="Capacity by resource class"
        description="How many nodes there are of what a flavor can ask for, and how many of them could take an instance now: in available, out of maintenance, with a power state Nova can read, and not retired."
      >
        <ul className={listClassName}>
          {read.data.map((one: OpenStackBareMetalClass): ReactElement => {
            const details: Array<string> = [
              countText(translator, "Deployed", one.deployedCount),
              countText(translator, "In maintenance", one.maintenanceCount),
              countText(translator, "Failed", one.failedCount),
            ];

            return (
              <li
                key={one.resourceClass || ""}
                data-testid="openstack-bare-metal-class"
                className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-1 py-3"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-gray-900">
                    <bdi>
                      {one.resourceClass ||
                        translator.translateText("No resource class")}
                    </bdi>
                  </div>
                  <div className="text-xs text-gray-500">
                    {details.join(" · ")}
                  </div>
                </div>
                <div className="text-sm text-gray-700">
                  {translator.translateTemplate(
                    "{{available}} of {{total}} can take an instance",
                    {
                      available: translator.formatNumber(one.availableCount),
                      total: translator.formatNumber(one.nodeCount),
                    },
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
};

export default OpenStackBareMetalClassesCard;
