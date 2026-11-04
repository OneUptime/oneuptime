import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  OPENSTACK_INSTANCE_METRICS_AUTOMATIC_LIMIT,
  OpenStackInstanceMetricSource,
  OpenStackInstanceMetricsMode,
  OpenStackInstanceMetricsOptions,
  OpenStackInstanceMetricsVolume,
  estimateOpenStackInstanceMetricsVolume,
} from "Common/Types/OpenStack/OpenStackInstanceMetrics";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import { fetchOpenStackRows } from "../../Pages/OpenStack/Utils/OpenStackPartData";
import { parseOpenStackAggregates } from "../../Pages/OpenStack/Utils/OpenStackPartFacts";
import {
  OpenStackInstanceMetricsChoice,
  fetchOpenStackInstanceMetricsChoice,
} from "../../Pages/OpenStack/Utils/OpenStackUsageReads";
import useOpenStackRead, { OpenStackRead } from "./Part/UseOpenStackRead";

/*
 * Whether each instance keeps series of its own. Cost is a choice: they multiply fast, so a
 * cloud past a stated size keeps only its hypervisors' totals until someone chooses otherwise,
 * for the whole cloud, or for the projects and aggregates they care about. It says what the
 * choice costs, on the numbers the agent really collects at.
 */

const MODE_LABELS: Record<OpenStackInstanceMetricsMode, string> = {
  [OpenStackInstanceMetricsMode.Automatic]: translationKey(
    "Automatic: every instance, until this cloud is too large",
  ),
  [OpenStackInstanceMetricsMode.All]: translationKey("Every instance"),
  [OpenStackInstanceMetricsMode.Selected]: translationKey(
    "Only the projects and aggregates I choose",
  ),
  [OpenStackInstanceMetricsMode.Off]: translationKey(
    "None: only each hypervisor's totals",
  ),
};

interface Choices {
  choice: OpenStackInstanceMetricsChoice;
  projects: Array<DropdownOption>;
  aggregates: Array<DropdownOption>;
}

const OpenStackInstanceMetricsCard: FunctionComponent<{
  modelId: ObjectID;
}> = (props: { modelId: ObjectID }): ReactElement => {
  const translator: Translator = useTranslator();
  const [options, setOptions] = useState<OpenStackInstanceMetricsOptions | null>(
    null,
  );
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string>("");

  const read: OpenStackRead<Choices> = useOpenStackRead<Choices>(async () => {
    const [choice, projects, hypervisors]: [
      OpenStackInstanceMetricsChoice,
      Array<OpenStackResource>,
      Array<OpenStackResource>,
    ] = await Promise.all([
      fetchOpenStackInstanceMetricsChoice(props.modelId),
      fetchOpenStackRows({
        openStackCloudId: props.modelId,
        kind: OpenStackResourceKind.Project,
        limit: 500,
      }),
      fetchOpenStackRows({
        openStackCloudId: props.modelId,
        kind: OpenStackResourceKind.Hypervisor,
        limit: 2000,
      }),
    ]);
    return {
      choice,
      projects: projects.map((row: OpenStackResource): DropdownOption => {
        return {
          label: row.name || row.externalId || "",
          value: row.externalId || "",
        };
      }),
      aggregates: Array.from(
        new Set(hypervisors.flatMap(parseOpenStackAggregates)),
      )
        .sort()
        .map((name: string): DropdownOption => {
          return { label: name, value: name };
        }),
    };
  }, [props.modelId.toString()]);

  useEffect(() => {
    if (read.data && !options) {
      setOptions(read.data.choice.options);
    }
  }, [read.data]);

  if (read.error) {
    return (
      <div className="mb-6">
        <Card
          title="Real usage per instance"
          description="Whether each instance keeps CPU, memory, disk and network series of its own."
        >
          <ErrorMessage message={read.error} onRefreshClick={read.reload} />
        </Card>
      </div>
    );
  }

  if (!read.data || !options) {
    return <></>;
  }

  const instanceCount: number = read.data.choice.instanceCount;
  const volume: (
    source: OpenStackInstanceMetricSource,
    instances: number,
  ) => OpenStackInstanceMetricsVolume = (
    source: OpenStackInstanceMetricSource,
    instances: number,
  ): OpenStackInstanceMetricsVolume => {
    return estimateOpenStackInstanceMetricsVolume({ source, instances });
  };
  const libvirt: OpenStackInstanceMetricsVolume = volume(
    OpenStackInstanceMetricSource.Libvirt,
    instanceCount,
  );
  const ceilometer: OpenStackInstanceMetricsVolume = volume(
    OpenStackInstanceMetricSource.Ceilometer,
    instanceCount,
  );

  const toOption: (mode: OpenStackInstanceMetricsMode) => DropdownOption = (
    mode: OpenStackInstanceMetricsMode,
  ): DropdownOption => {
    return { label: translator.translateText(MODE_LABELS[mode]), value: mode };
  };

  const valuesOf: (
    value: DropdownValue | Array<DropdownValue> | null,
  ) => Array<string> = (
    value: DropdownValue | Array<DropdownValue> | null,
  ): Array<string> => {
    return (Array.isArray(value) ? value : []).map(
      (one: DropdownValue): string => {
        return String(one);
      },
    );
  };

  const save: () => Promise<void> = async (): Promise<void> => {
    setIsSaving(true);
    setSaveError("");
    try {
      await ModelAPI.updateById<OpenStackCloud>({
        modelType: OpenStackCloud,
        id: props.modelId,
        data: {
          instanceMetricsOptions: options as unknown as JSONObject,
        },
      });
    } catch (err) {
      setSaveError(API.getFriendlyMessage(err));
    }
    setIsSaving(false);
  };

  return (
    <div className="mb-6" data-testid="openstack-instance-metrics-card">
      <Card
        title="Real usage per instance"
        description="Whether each instance keeps CPU, memory, disk and network series of its own, from libvirt's or Ceilometer's exporter. Each hypervisor's totals are kept whatever this says."
      >
        <div className="space-y-4 text-sm">
          {saveError ? <ErrorMessage message={saveError} /> : <></>}
          <Dropdown
            options={Object.values(OpenStackInstanceMetricsMode).map(toOption)}
            value={toOption(options.mode)}
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
              setOptions({
                ...options,
                mode: value as OpenStackInstanceMetricsMode,
              });
            }}
          />
          {options.mode === OpenStackInstanceMetricsMode.Selected ? (
            <div
              className="grid grid-cols-1 gap-3 sm:grid-cols-2"
              data-testid="openstack-instance-metrics-selection"
            >
              <Dropdown
                isMultiSelect={true}
                placeholder="Projects"
                options={read.data.projects}
                value={read.data.projects.filter(
                  (option: DropdownOption): boolean => {
                    return options.projectIds.includes(String(option.value));
                  },
                )}
                onChange={(
                  value: DropdownValue | Array<DropdownValue> | null,
                ) => {
                  setOptions({ ...options, projectIds: valuesOf(value) });
                }}
              />
              <Dropdown
                isMultiSelect={true}
                placeholder="Aggregates"
                options={read.data.aggregates}
                value={read.data.aggregates.filter(
                  (option: DropdownOption): boolean => {
                    return options.aggregates.includes(String(option.value));
                  },
                )}
                onChange={(
                  value: DropdownValue | Array<DropdownValue> | null,
                ) => {
                  setOptions({ ...options, aggregates: valuesOf(value) });
                }}
              />
            </div>
          ) : (
            <></>
          )}
          <p className="text-gray-600" data-testid="openstack-instance-metrics-cost">
            {translator.translateTemplate(
              "This cloud has {{instances}} instances. Keeping all of them costs about {{libvirt}} rows an hour from libvirt's exporter, or {{ceilometer}} from Ceilometer's. Automatic stops keeping them past {{limit}} instances.",
              {
                instances: translator.formatNumber(instanceCount),
                libvirt: translator.formatNumber(libvirt.rowsPerHour),
                ceilometer: translator.formatNumber(ceilometer.rowsPerHour),
                limit: translator.formatNumber(
                  OPENSTACK_INSTANCE_METRICS_AUTOMATIC_LIMIT,
                ),
              },
            )}
          </p>
          <Button
            title="Save"
            buttonStyle={ButtonStyleType.PRIMARY}
            isLoading={isSaving}
            onClick={() => {
              void save();
            }}
          />
        </div>
      </Card>
    </div>
  );
};

export default OpenStackInstanceMetricsCard;
