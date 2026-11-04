import {
  OPENSTACK_SERVICE_TITLES,
  OpenStackServiceType,
} from "Common/Types/OpenStack/OpenStackResourceKind";
import {
  OPENSTACK_DATABASE_PATH_HYPERVISOR_LIMIT,
  OPENSTACK_DATABASE_PATH_INSTANCE_LIMIT,
  OPENSTACK_SUMMARY_MODE_INSTANCE_LIMIT,
  OpenStackCloudCounts,
  OpenStackRequestsByService,
  OpenStackVolumeEstimate,
  estimateOpenStackVolume,
  getOpenStackCountsOfSize,
  getOpenStackProbeRequestsPerMinute,
  isOpenStackDatabasePathOffered,
} from "Common/Types/OpenStack/OpenStackScale";
import Card from "Common/UI/Components/Card/Card";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * What a cloud of a given size costs, before anything is installed: the load on its control plane,
 * and the data it sends. The numbers are OpenStackScale's, which OpenStackScaleBudget.test.ts holds
 * to what the real collector does against a mock API of that size, and the same ones the docs
 * publish. What it needs is three numbers anyone running a cloud knows: what the cloud holds
 * besides is worked out from them, and says so.
 */

const SERVICES: ReadonlyArray<OpenStackServiceType> = [
  OpenStackServiceType.Identity,
  OpenStackServiceType.Compute,
  OpenStackServiceType.Placement,
  OpenStackServiceType.Network,
  OpenStackServiceType.Volume,
  OpenStackServiceType.Image,
];

function readCount(text: string, fallback: number): number {
  const value: number = Number.parseInt(text, 10);

  return Number.isFinite(value) && value >= 0
    ? Math.min(value, 10_000_000)
    : fallback;
}

export interface OpenStackCostView {
  counts: OpenStackCloudCounts;
  isSummaryMode: boolean;
  isDatabasePathOffered: boolean;
  volume: OpenStackVolumeEstimate;
  everySeries: OpenStackVolumeEstimate;
  requestsPerMinute: OpenStackRequestsByService;
}

// Exported for tests: every number on the card, from what was typed.
export function getOpenStackCostView(data: {
  hypervisors: number;
  instances: number;
  projects: number;
}): OpenStackCostView {
  const counts: OpenStackCloudCounts = getOpenStackCountsOfSize(data);
  const isSummaryMode: boolean =
    counts.instances > OPENSTACK_SUMMARY_MODE_INSTANCE_LIMIT;

  return {
    counts: counts,
    isSummaryMode: isSummaryMode,
    isDatabasePathOffered: isOpenStackDatabasePathOffered(counts),
    volume: estimateOpenStackVolume({
      counts: counts,
      isSummaryMode: isSummaryMode,
      // One in a thousand in a state an alert watches, as a usual day has.
      keptInstances: isSummaryMode ? Math.ceil(counts.instances / 1000) : 0,
    }),
    everySeries: estimateOpenStackVolume({ counts: counts }),
    requestsPerMinute: getOpenStackProbeRequestsPerMinute(counts),
  };
}

const OpenStackCostCalculator: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [hypervisors, setHypervisors] = useState<string>("50");
  const [instances, setInstances] = useState<string>("2000");
  const [projects, setProjects] = useState<string>("100");

  const view: OpenStackCostView = getOpenStackCostView({
    hypervisors: readCount(hypervisors, 0),
    instances: readCount(instances, 0),
    projects: readCount(projects, 0),
  });

  const rounded: (value: number) => string = (value: number): string => {
    return translator.formatNumber(
      value >= 100 ? Math.round(value) : Math.round(value * 10) / 10,
    );
  };

  const field: (data: {
    title: string;
    value: string;
    onChange: (value: string) => void;
    testId: string;
  }) => ReactElement = (data: {
    title: string;
    value: string;
    onChange: (value: string) => void;
    testId: string;
  }): ReactElement => {
    return (
      <label className="block text-sm font-medium text-gray-700">
        <span className="mb-1 block">
          {translator.translateText(data.title)}
        </span>
        <Input
          type={InputType.NUMBER}
          value={data.value}
          onChange={data.onChange}
          dataTestId={data.testId}
        />
      </label>
    );
  };

  return (
    <div className="mt-5" data-testid="openstack-cost-calculator">
      <Card
        title="What this cloud would cost"
        description="The load on its control plane and the data it sends, from its size. What else it holds is assumed from these three: the docs say how, and how to work it out for yours."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {field({
            title: "Hypervisors",
            value: hypervisors,
            onChange: setHypervisors,
            testId: "openstack-cost-hypervisors",
          })}
          {field({
            title: "Instances",
            value: instances,
            onChange: setInstances,
            testId: "openstack-cost-instances",
          })}
          {field({
            title: "Projects",
            value: projects,
            onChange: setProjects,
            testId: "openstack-cost-projects",
          })}
        </div>

        <dl className="mt-5 grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-gray-500">
              {translator.translateText("Series")}
            </dt>
            <dd
              className="text-lg font-medium text-gray-900"
              data-testid="openstack-cost-series"
            >
              {rounded(view.volume.series)}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">
              {translator.translateText("Data per day")}
            </dt>
            <dd
              className="text-lg font-medium text-gray-900"
              data-testid="openstack-cost-gigabytes"
            >
              {translator.translateTemplate("{{gigabytes}} GB", {
                gigabytes: rounded(view.volume.gigabytesPerDay),
              })}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">
              {translator.translateText("Per month, kept 15 days")}
            </dt>
            <dd
              className="text-lg font-medium text-gray-900"
              data-testid="openstack-cost-dollars"
            >
              {translator.translateTemplate("${{dollars}}", {
                dollars: rounded(view.volume.costInUSDPerMonth),
              })}
            </dd>
          </div>
        </dl>

        <div className="mt-5 text-sm">
          <div className="font-medium text-gray-900">
            {translator.translateText(
              "Requests a minute a probe makes, by service",
            )}
          </div>
          <ul className="mt-1 grid grid-cols-1 gap-x-6 gap-y-1 text-gray-700 sm:grid-cols-2">
            {SERVICES.map((service: OpenStackServiceType): ReactElement => {
              return (
                <li
                  key={service}
                  className="flex justify-between"
                  data-testid={`openstack-cost-requests-${service}`}
                >
                  <span>{OPENSTACK_SERVICE_TITLES[service]}</span>
                  <span className="text-gray-900">
                    {rounded(view.requestsPerMinute[service])}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        {view.isSummaryMode ? (
          <p
            className="mt-4 text-sm text-gray-600"
            data-testid="openstack-cost-summary-mode"
          >
            {translator.translateTemplate(
              "Past {{limit}} instances a cloud keeps counts per hypervisor, project and status, and a row for every part, rather than a series per instance. Keeping every series would be about {{gigabytes}} GB a day.",
              {
                limit: translator.formatNumber(
                  OPENSTACK_SUMMARY_MODE_INSTANCE_LIMIT,
                ),
                gigabytes: rounded(view.everySeries.gigabytesPerDay),
              },
            )}
          </p>
        ) : (
          <></>
        )}

        {view.isDatabasePathOffered ? (
          <p
            className="mt-2 text-sm text-gray-600"
            data-testid="openstack-cost-database-path"
          >
            {translator.translateTemplate(
              "Past {{hypervisors}} hypervisors or {{instances}} instances, the agent can read the cloud's databases instead of its APIs. The docs say what that asks of you and what it leaves out.",
              {
                hypervisors: translator.formatNumber(
                  OPENSTACK_DATABASE_PATH_HYPERVISOR_LIMIT,
                ),
                instances: translator.formatNumber(
                  OPENSTACK_DATABASE_PATH_INSTANCE_LIMIT,
                ),
              },
            )}
          </p>
        ) : (
          <></>
        )}
      </Card>
    </div>
  );
};

export default OpenStackCostCalculator;
