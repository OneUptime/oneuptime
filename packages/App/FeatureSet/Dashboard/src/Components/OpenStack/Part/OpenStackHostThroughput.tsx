import IconProp from "Common/Types/Icon/IconProp";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import { OpenStackHostThroughput as Throughput } from "../../../Pages/OpenStack/Utils/OpenStackUsage";
import { fetchOpenStackHostThroughput } from "../../../Pages/OpenStack/Utils/OpenStackUsageReads";
import GoldenMetricTile from "../../Infrastructure/GoldenMetricTile";
import { formatOpenStackBytes } from "../OpenStackResourceList";
import useOpenStackRead, { OpenStackRead } from "./UseOpenStackRead";

/*
 * What a machine's own disks and network interfaces are moving, from OneUptime's agent on it.
 * No OpenStack API says this: Nova and Placement only say what is promised on them. A read
 * that fails leaves the tiles out, and the rest of the page says what it can.
 */

// "۱٫۲ MiB/s": a rate in the reader's digits, read as a value of its own.
export function formatOpenStackRate(value: number | null): string {
  return value === null ? "—" : `${formatOpenStackBytes(value)}/s`;
}

export function addOpenStackRates(
  first: number | null,
  second: number | null,
): number | null {
  return first === null && second === null
    ? null
    : (first || 0) + (second || 0);
}

const OpenStackHostThroughput: FunctionComponent<{
  hostIdentifier: string;
}> = (props: { hostIdentifier: string }): ReactElement => {
  const translator: Translator = useTranslator();
  const read: OpenStackRead<Throughput> = useOpenStackRead<Throughput>(() => {
    return fetchOpenStackHostThroughput(props.hostIdentifier);
  }, [props.hostIdentifier]);

  if (!read.data) {
    return <></>;
  }

  const {
    diskReadBytesPerSecond,
    diskWriteBytesPerSecond,
    networkReceiveBytesPerSecond,
    networkTransmitBytesPerSecond,
  } = read.data;
  const hasDisk: boolean =
    diskReadBytesPerSecond !== null || diskWriteBytesPerSecond !== null;
  const hasNetwork: boolean =
    networkReceiveBytesPerSecond !== null ||
    networkTransmitBytesPerSecond !== null;

  return (
    <div
      className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2"
      data-testid="openstack-hypervisor-host-throughput"
    >
      <GoldenMetricTile
        title="Disk throughput"
        icon={IconProp.Disc}
        iconColor="amber"
        value={formatOpenStackRate(
          addOpenStackRates(diskReadBytesPerSecond, diskWriteBytesPerSecond),
        )}
        sublabel={
          hasDisk
            ? translator.translateTemplate(
                "{{read}} read, {{written}} written",
                {
                  read: formatOpenStackRate(diskReadBytesPerSecond),
                  written: formatOpenStackRate(diskWriteBytesPerSecond),
                },
                /*
                 * A sentence, read the page's way, each rate set apart: a
                 * Persian tile reads "۱٫۲ MiB/s خوانده" from the right, its
                 * number before its unit (issue #7191).
                 */
                { setsValuesApart: true },
              )
            : "Not reported"
        }
        description="What this machine's whole disks are reading and writing, from OneUptime's agent on it. Partitions and volumes on top of a disk aren't added in again."
      />
      <GoldenMetricTile
        title="Network throughput"
        icon={IconProp.Globe}
        iconColor="emerald"
        value={formatOpenStackRate(
          addOpenStackRates(
            networkReceiveBytesPerSecond,
            networkTransmitBytesPerSecond,
          ),
        )}
        sublabel={
          hasNetwork
            ? translator.translateTemplate(
                "{{received}} in, {{transmitted}} out",
                {
                  received: formatOpenStackRate(networkReceiveBytesPerSecond),
                  transmitted: formatOpenStackRate(
                    networkTransmitBytesPerSecond,
                  ),
                },
                { setsValuesApart: true },
              )
            : "Not reported"
        }
        description="What this machine's interfaces are moving, from OneUptime's agent on it. Bridges and instances' tap devices aren't added in again, since the same bytes pass through them."
      />
    </div>
  );
};

export default OpenStackHostThroughput;
