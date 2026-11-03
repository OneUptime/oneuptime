import React, { FunctionComponent, ReactElement } from "react";
import CephResource from "Common/Models/DatabaseModels/CephResource";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Link from "Common/UI/Components/Link/Link";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import ResourcePartHero from "../../ResourcePart/ResourcePartHero";
import {
  ResourcePartBadge,
  ResourcePartChip,
  ResourcePartStatus,
} from "../../ResourcePart/ResourcePartTypes";
import { CEPH_METRIC_DESCRIPTIONS } from "../../MetricDescriptions/CephMetricDescriptions";
import {
  CephAssessment,
  CephOsdReadings,
  CephPoolReadings,
  getCephDisplayName,
  getCephOsdReadings,
  getCephPoolReadings,
  toCephDate,
} from "../../../Pages/Ceph/Utils/CephHealth";
import { getCephOsdPlacementBadge } from "../../../Pages/Ceph/Utils/CephPartFacts";
import { formatBytes } from "../../../Pages/Ceph/Utils/CephResourceUtils";

/*
 * The top of an OSD's or a pool's page, above its tabs: which part it is,
 * how it is doing by the cluster's rules (CephHealth, as Needs attention
 * says it), where it sits - an OSD on its host, each one step from the
 * cluster - and the facts a Ceph administrator looks for first: an OSD's
 * placement, device class, size and placement groups; a pool's id, what it
 * stores and its objects. The shared ResourcePartHero draws it.
 */

export type CephPartPageKind = "Osd" | "Pool";

export interface ComponentProps {
  kind: CephPartPageKind;
  // The part's inventory row; null while it has not reported.
  row: CephResource | null;
  externalId: string;
  assessment: CephAssessment | null;
  clusterName: string;
  clusterRoute: Route;
  now: Date;
}

const LINK_CLASS_NAME: string =
  "font-medium text-gray-700 hover:text-indigo-600 hover:underline";

// A name with no page of its own, as strong as the linked one beside it.
const NAME_CLASS_NAME: string = "font-medium text-gray-700";

const CephPartHero: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const row: CephResource | null = props.row;

  const name: string = row
    ? getCephDisplayName(row)
    : props.kind === "Pool"
      ? `pool ${props.externalId}`
      : props.externalId;

  const status: ResourcePartStatus | undefined = props.assessment
    ? {
        ...props.assessment.status,
        description:
          props.kind === "Osd"
            ? CEPH_METRIC_DESCRIPTIONS.osdStatus
            : CEPH_METRIC_DESCRIPTIONS.poolStatus,
      }
    : undefined;

  const badges: Array<ResourcePartBadge> = [];
  const chips: Array<ResourcePartChip> = [];

  const clusterLink: ReactElement = (
    <Link to={props.clusterRoute} className={LINK_CLASS_NAME}>
      <bdi>{props.clusterName}</bdi>
    </Link>
  );

  let location: ReactElement;

  if (props.kind === "Osd") {
    location = row?.hostname ? (
      <TranslatedSentence
        template="OSD of cluster {{cluster}} on host {{host}}"
        slots={{
          cluster: clusterLink,
          host: <bdi className={NAME_CLASS_NAME}>{row.hostname}</bdi>,
        }}
      />
    ) : (
      <TranslatedSentence
        template="OSD of cluster {{cluster}}"
        slots={{ cluster: clusterLink }}
      />
    );

    if (row) {
      const placement: ResourcePartBadge | null = getCephOsdPlacementBadge(
        row,
        props.assessment?.status.label,
      );
      if (placement) {
        badges.push(placement);
      }
      if (row.deviceClass) {
        // Ceph's own word for the device, as it writes it: hdd, ssd, nvme.
        chips.push({
          key: "device-class",
          icon: IconProp.Tag,
          label: row.deviceClass,
        });
      }
      const readings: CephOsdReadings = getCephOsdReadings(row, props.now);
      if (readings.totalBytes !== null && readings.totalBytes > 0) {
        chips.push({
          key: "capacity",
          icon: IconProp.Disc,
          label: translator.translateTemplate(
            "{{size}} capacity",
            { size: formatBytes(readings.totalBytes) },
            // "8.0 TiB" reads as written in a Persian chip.
            { setsValuesApart: true },
          ),
        });
      }
      if (readings.pgCount !== null) {
        chips.push({
          key: "pgs",
          icon: IconProp.SquareStack,
          label: translator.translatePlural(
            {
              one: "{{count}} placement group",
              other: "{{count}} placement groups",
            },
            Math.round(readings.pgCount),
          ),
        });
      }
    }
  } else {
    location = (
      <TranslatedSentence
        template="Pool of cluster {{cluster}}"
        slots={{ cluster: clusterLink }}
      />
    );

    chips.push({
      key: "pool-id",
      icon: IconProp.Hashtag,
      label: translator.translateTemplate("Pool ID {{id}}", {
        id: props.externalId,
      }),
    });

    if (row) {
      const readings: CephPoolReadings = getCephPoolReadings(row, props.now);
      if (readings.storedBytes !== null) {
        chips.push({
          key: "stored",
          icon: IconProp.Database,
          label: translator.translateTemplate(
            "{{size}} stored",
            { size: formatBytes(readings.storedBytes) },
            { setsValuesApart: true },
          ),
        });
      }
      if (readings.objects !== null) {
        chips.push({
          key: "objects",
          icon: IconProp.Cube,
          label: translator.translatePlural(
            { one: "{{count}} object", other: "{{count}} objects" },
            Math.round(readings.objects),
          ),
        });
      }
    }
  }

  return (
    <ResourcePartHero
      testId={`ceph-${props.kind.toLowerCase()}-hero`}
      icon={props.kind === "Osd" ? IconProp.Disc : IconProp.Database}
      accent={props.kind === "Osd" ? "orange" : "indigo"}
      name={name}
      status={status}
      badges={badges}
      location={location}
      lastReportAt={toCephDate(row?.lastSeenAt)}
      chips={chips}
    />
  );
};

export default CephPartHero;
