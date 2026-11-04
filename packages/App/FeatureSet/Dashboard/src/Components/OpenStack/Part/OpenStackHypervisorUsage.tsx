import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import IconProp from "Common/Types/Icon/IconProp";
import {
  OPENSTACK_INSTANCE_METRICS_AUTOMATIC_LIMIT,
  OpenStackInstanceUsageReading,
  rankOpenStackInstancesByCpu,
} from "Common/Types/OpenStack/OpenStackInstanceMetrics";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledListClassName } from "Common/UI/Components/Card/CardSurface";
import Link from "Common/UI/Components/Link/Link";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import { fetchOpenStackNames } from "../../../Pages/OpenStack/Utils/OpenStackPartData";
import {
  OpenStackHypervisorLoad,
  getOpenStackHypervisorLoad,
  getOpenStackHypervisorPhysicalCapacity,
  isOpenStackInstanceContended,
} from "../../../Pages/OpenStack/Utils/OpenStackUsage";
import {
  OpenStackHypervisorUsage as HypervisorUsage,
  fetchOpenStackHypervisorUsage,
} from "../../../Pages/OpenStack/Utils/OpenStackUsageReads";
import GoldenMetricTile from "../../Infrastructure/GoldenMetricTile";
import { formatOpenStackBytes } from "../OpenStackResourceList";
import OpenStackPartNotice from "./OpenStackPartNotice";
import { OpenStackPart } from "./UseOpenStackPart";
import useOpenStackRead, { OpenStackRead } from "./UseOpenStackRead";

/*
 * What a hypervisor's instances really use, beside what Placement has promised on it, and
 * when it is over a line, which of them are responsible. The tiles above this on its page say
 * what is promised, and an idle instance holds all of that. These say what is busy.
 */

const NO_SOURCE_WITH_HOST_AGENT: string = translationKey(
  "OneUptime's agent says what this machine is doing, but nothing says which instances are doing it. Point the OpenStack agent at prometheus-libvirt-exporter or Ceilometer's exporter on this node to name them.",
);
const NO_SOURCE: string = translationKey(
  "Nothing here says how busy this hypervisor is, only what is promised on it. Run OneUptime's agent on this machine for its real load, or point the OpenStack agent at prometheus-libvirt-exporter or Ceilometer's exporter on this node to see its instances' too.",
);
const OVER_THE_CPU_LINE: string = translationKey(
  "This hypervisor's instances are really using nearly all of its CPU, so they are waiting for each other. The instances responsible are named below.",
);
const OVER_THE_MEMORY_LINE: string = translationKey(
  "This hypervisor's instances really hold nearly all of its memory, which leaves little for the host. The instances holding the most are named below.",
);

interface UsageRead {
  usage: HypervisorUsage;
  names: Record<string, string>;
  busiest: Array<OpenStackInstanceUsageReading>;
}

const OpenStackHypervisorUsage: FunctionComponent<{
  part: OpenStackPart;
  row: OpenStackResource;
  // Whether OneUptime's own agent already says what this machine is doing.
  hasHostAgent: boolean;
}> = (props: {
  part: OpenStackPart;
  row: OpenStackResource;
  hasHostAgent: boolean;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const listClassName: string = useCardRuledListClassName();
  const { part, row } = props;
  const hypervisorName: string = row.hypervisorName || row.name || "";

  const read: OpenStackRead<UsageRead> = useOpenStackRead<UsageRead>(async () => {
    const usage: HypervisorUsage = await fetchOpenStackHypervisorUsage({
      cloudName: part.cloudName,
      hypervisorName,
    });
    const busiest: Array<OpenStackInstanceUsageReading> =
      rankOpenStackInstancesByCpu(usage.instances);
    const names: Record<string, string> = await fetchOpenStackNames({
      openStackCloudId: part.openStackCloudId,
      kind: OpenStackResourceKind.Instance,
      externalIds: busiest.map(
        (reading: OpenStackInstanceUsageReading): string => {
          return reading.instanceId;
        },
      ),
    });
    return { usage, names, busiest };
  }, [hypervisorName, part.cloudName, part.refreshToken]);

  if (!read.data) {
    return <></>;
  }

  const { usage, names, busiest } = read.data;

  if (usage.sources.length === 0) {
    /*
     * The Host product is enough for this machine's load, so it only says what its
     * instances' share is missing. With neither, nothing on this page says how busy it is.
     */
    return (
      <OpenStackPartNotice
        testId="openstack-hypervisor-usage-missing"
        tone="neutral"
        text={props.hasHostAgent ? NO_SOURCE_WITH_HOST_AGENT : NO_SOURCE}
      />
    );
  }

  const physical: { cores: number | null; memoryBytes: number | null } =
    getOpenStackHypervisorPhysicalCapacity(row);
  const load: OpenStackHypervisorLoad = getOpenStackHypervisorLoad({
    cpuCores: usage.cpuCores,
    memoryResidentBytes: usage.memoryResidentBytes,
    physicalCores: physical.cores,
    physicalMemoryBytes: physical.memoryBytes,
  });

  return (
    <div data-testid="openstack-hypervisor-usage">
      {load.isCpuSaturated || load.isMemoryPressured ? (
        <OpenStackPartNotice
          testId="openstack-hypervisor-over-line"
          tone="warning"
          text={load.isCpuSaturated ? OVER_THE_CPU_LINE : OVER_THE_MEMORY_LINE}
        />
      ) : (
        <></>
      )}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <GoldenMetricTile
          title="CPU used by instances"
          icon={IconProp.CPUChip}
          iconColor="blue"
          value={
            load.cpuPercent === null ? "—" : `${Math.round(load.cpuPercent)}%`
          }
          sublabel={
            usage.cpuCores === null
              ? "Not reported"
              : translator.translateTemplate("{{count}} CPU threads in use", {
                  count: usage.cpuCores.toFixed(1),
                })
          }
          isSublabelAsWritten={usage.cpuCores !== null}
          percent={load.cpuPercent}
          tone={load.isCpuSaturated ? "warning" : "positive"}
          description="What this hypervisor's instances really use, over the last quarter of an hour, against the CPU threads it has before any allocation ratio. The host's own processes aren't in this."
        />
        <GoldenMetricTile
          title="Memory held by instances"
          icon={IconProp.SquareStack}
          iconColor="violet"
          value={
            load.memoryPercent === null
              ? "—"
              : `${Math.round(load.memoryPercent)}%`
          }
          sublabel={
            usage.memoryResidentBytes === null
              ? "Not reported"
              : translator.translateTemplate("{{amount}} held", {
                  amount: formatOpenStackBytes(usage.memoryResidentBytes),
                })
          }
          isSublabelAsWritten={usage.memoryResidentBytes !== null}
          percent={load.memoryPercent}
          tone={load.isMemoryPressured ? "warning" : "positive"}
          description="What this hypervisor's instances really hold of its memory, whatever they have been promised, against what it has before any allocation ratio."
        />
      </div>

      <div className="mb-6">
        <Card
          title="Busiest instances"
          description="Which instances are really using this hypervisor, the most first, over the last quarter of an hour. Waiting is how much of its time an instance's vCPUs wanted to run and were made to wait: that one is the victim, and the one using the most is usually why."
        >
          {busiest.length === 0 ? (
            <p
              className="text-sm text-gray-600"
              data-testid="openstack-hypervisor-busiest-none"
            >
              {translator.translateTemplate(
                "This cloud keeps no per-instance series for this hypervisor's instances, which it stops doing by default past {{count}} instances. Choose what to keep under its Settings.",
                {
                  count: translator.formatNumber(
                    OPENSTACK_INSTANCE_METRICS_AUTOMATIC_LIMIT,
                  ),
                },
              )}
            </p>
          ) : (
            <ul className={listClassName}>
              {busiest.map(
                (reading: OpenStackInstanceUsageReading): ReactElement => {
                  return (
                    <li
                      key={reading.instanceId}
                      data-testid="openstack-hypervisor-busiest-instance"
                      className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm md:px-6"
                    >
                      <Link
                        to={part.routes.getPartRoute(
                          OpenStackResourceKind.Instance,
                          reading.instanceId,
                        )}
                        className="font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
                      >
                        <bdi>
                          {names[reading.instanceId] || reading.instanceId}
                        </bdi>
                      </Link>
                      <span className="flex flex-wrap gap-x-4 text-xs text-gray-500">
                        {reading.cpuCores === null ? (
                          <></>
                        ) : (
                          <span>
                            {translator.translateTemplate(
                              "{{count}} CPU threads",
                              { count: reading.cpuCores.toFixed(1) },
                            )}
                          </span>
                        )}
                        {reading.memoryResidentBytes === null ? (
                          <></>
                        ) : (
                          <span>
                            {translator.translateTemplate("{{amount}} held", {
                              amount: formatOpenStackBytes(
                                reading.memoryResidentBytes,
                              ),
                            })}
                          </span>
                        )}
                        {reading.contentionPercent === null ? (
                          <></>
                        ) : (
                          <span
                            className={
                              isOpenStackInstanceContended(
                                reading.contentionPercent,
                              )
                                ? "font-medium text-amber-700"
                                : ""
                            }
                          >
                            {translator.translateTemplate(
                              "waiting {{percent}}%",
                              {
                                percent: Math.round(
                                  reading.contentionPercent,
                                ).toString(),
                              },
                            )}
                          </span>
                        )}
                      </span>
                    </li>
                  );
                },
              )}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
};

export default OpenStackHypervisorUsage;
