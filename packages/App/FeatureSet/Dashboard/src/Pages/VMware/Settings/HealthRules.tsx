import PageComponentProps from "../../PageComponentProps";
import { forgetProjectVMwareHealthRules } from "../Utils/VMwareHealthRulesStore";
import VMwareHealthRuleOverridesCard from "./HealthRuleOverrides";
import {
  VALUE_FOR_MINUTES,
  VALUE_LATEST_REPORT,
} from "../Utils/VMwareHealthRuleWords";
import VMwareHealthSetting from "Common/Models/DatabaseModels/VMwareHealthSetting";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import ObjectID from "Common/Types/ObjectID";
import {
  VMWARE_HEALTH_MAX_EVALUATION_MINUTES,
  VMwareHealthRuleKey,
} from "Common/Types/VMware/VMwareHealthRules";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ModelField from "Common/UI/Components/Forms/Types/Field";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * VMware > Settings > Health Rules (#11157): where every vCenter of the
 * project marks an ESXi host, a datastore, a VM or a resource pool as
 * needing a look (warning) or someone now (critical) - its Overview's Needs
 * attention, its parts' pages, the lists' Status column and the Topology.
 * A project has one row of them (VMwareHealthSetting), made with every
 * default the first time this page is opened, and each threshold left
 * empty turns its rule off.
 *
 * Swapping is its own card because it is three rules: memory ESXi left in
 * its swap file from earlier pressure is not swapping, and only the host
 * swapping memory out now is critical (Common/Types/VMware/VMwareHealthRules).
 *
 * Each card's rules can wait "for at least N minutes" before they mark a
 * part (#11469): folded under More fields in its dialog, since most people
 * judge the latest report. Under the cards, Overrides lists the vCenters,
 * clusters, hosts and VMs with rules of their own, and where each applies.
 */

export const HEALTH_RULES_NOT_MADE: string = translationKey(
  "These rules have not been set up yet. Someone who may edit vCenters needs to open this page first.",
);
const OFF: string = translationKey("Off");
const ANY: string = translationKey("Any");

async function readSettingId(projectId: ObjectID): Promise<ObjectID | null> {
  const result: ListResult<VMwareHealthSetting> =
    await ModelAPI.getList<VMwareHealthSetting>({
      modelType: VMwareHealthSetting,
      query: { projectId },
      limit: 1,
      skip: 0,
      select: { _id: true },
      sort: {},
    });

  return result.data[0]?.id || null;
}

type ThresholdUnit = "percent" | "kibPerSecond" | "mebibytes" | "minutes";

/*
 * A card's wait, folded under More fields in its dialog: a part is marked
 * once every report for that long was past the card's thresholds.
 */
function getPeriodFormField(data: {
  key: keyof VMwareHealthSetting & string;
  description: string;
}): ModelField<VMwareHealthSetting> {
  return {
    field: { [data.key]: true } as ModelField<VMwareHealthSetting>["field"],
    title: "For At Least (Minutes)",
    fieldType: FormFieldSchemaType.Number,
    required: false,
    placeholder: "0",
    description: data.description,
    validation: { minValue: 0, maxValue: VMWARE_HEALTH_MAX_EVALUATION_MINUTES },
    collapsibleSection: getAdvancedFormSection<VMwareHealthSetting>(),
  };
}

const VMwareHealthRulesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  const [settingId, setSettingId] = useState<ObjectID | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    const load: () => Promise<void> = async (): Promise<void> => {
      if (!projectId) {
        return;
      }

      try {
        let id: ObjectID | null = await readSettingId(projectId);

        if (!id) {
          const setting: VMwareHealthSetting = new VMwareHealthSetting();
          setting.projectId = projectId;

          try {
            await ModelAPI.create<VMwareHealthSetting>({
              model: setting,
              modelType: VMwareHealthSetting,
            });
          } catch {
            // Another tab made it first, or this person may only read: read below.
          }

          id = await readSettingId(projectId);
        }

        setSettingId(id);
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      } finally {
        setIsLoading(false);
      }
    };

    load().catch(() => {
      setIsLoading(false);
    });
  }, []);

  if (isLoading) {
    return <PageSkeleton />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!settingId) {
    return <ErrorMessage message={HEALTH_RULES_NOT_MADE} />;
  }

  // "Above 90%", "Above 1,024 KiB/s", "Any" for 0, "Off" for nothing.
  const threshold: (value: unknown, unit: ThresholdUnit) => string = (
    value: unknown,
    unit: ThresholdUnit,
  ): string => {
    // A wait: "For at least 10 min", or the latest report for 0 or nothing.
    if (unit === "minutes") {
      const minutes: number = Number(value);
      if (!Number.isFinite(minutes) || minutes <= 0 || value === null) {
        return (
          translator.translateText(VALUE_LATEST_REPORT) || VALUE_LATEST_REPORT
        );
      }
      return translator.translateTemplate(VALUE_FOR_MINUTES, {
        minutes: translator.formatNumber(minutes),
      });
    }
    if (value === null || value === undefined || value === "") {
      return translator.translateText(OFF) || OFF;
    }
    const number: number = Number(value);
    if (!Number.isFinite(number)) {
      return translator.translateText(OFF) || OFF;
    }
    if (number === 0) {
      return translator.translateText(ANY) || ANY;
    }
    const figure: string = translator.formatNumber(number);
    if (unit === "percent") {
      return translator.translateTemplate("Above {{percent}}%", {
        percent: figure,
      });
    }
    if (unit === "kibPerSecond") {
      return translator.translateTemplate("Above {{rate}} KiB/s", {
        rate: figure,
      });
    }
    return translator.translateTemplate("Above {{amount}} MiB", {
      amount: figure,
    });
  };

  const thresholdField: (data: {
    key: VMwareHealthRuleKey;
    title: string;
    unit: ThresholdUnit;
  }) => {
    field: Record<string, true>;
    title: string;
    fieldType: FieldType;
    getElement: (item: VMwareHealthSetting) => ReactElement;
  } = (data: {
    key: VMwareHealthRuleKey;
    title: string;
    unit: ThresholdUnit;
  }): {
    field: Record<string, true>;
    title: string;
    fieldType: FieldType;
    getElement: (item: VMwareHealthSetting) => ReactElement;
  } => {
    return {
      field: { [data.key]: true },
      title: data.title,
      fieldType: FieldType.Element,
      getElement: (item: VMwareHealthSetting): ReactElement => {
        return (
          <span data-testid={`vmware-health-rule-${data.key}`}>
            {threshold(
              (item as unknown as Record<string, unknown>)[data.key],
              data.unit,
            )}
          </span>
        );
      },
    };
  };

  const onSaveSuccess: () => void = (): void => {
    if (projectId) {
      forgetProjectVMwareHealthRules(projectId.toString());
    }
  };

  return (
    <Fragment>
      <CardModelDetail<VMwareHealthSetting>
        name="vmware-health-rules-hosts"
        cardProps={{
          title: "Busy ESXi Hosts",
          description:
            "When a busy ESXi host needs a look. A host vCenter cannot reach always needs someone now.",
        }}
        isEditable={true}
        onSaveSuccess={onSaveSuccess}
        formFields={[
          {
            field: { hostCpuWarningPercent: true },
            title: "CPU Warning Above",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "90",
            description:
              "In percent: a host whose CPU is busier needs a look. Leave empty to turn this off.",
            validation: { minValue: 0, maxValue: 100 },
          },
          {
            field: { hostMemoryWarningPercent: true },
            title: "Memory Warning Above",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "90",
            description:
              "In percent: a host whose memory is busier needs a look. Leave empty to turn this off.",
            validation: { minValue: 0, maxValue: 100 },
          },
          getPeriodFormField({
            key: "hostEvaluationMinutes",
            description:
              "How long a host must stay busy before it needs a look. 0 judges the latest report.",
          }),
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 3,
          modelType: VMwareHealthSetting,
          id: "vmware-health-rules-hosts-detail",
          modelId: settingId,
          fields: [
            thresholdField({
              key: "hostCpuWarningPercent",
              title: "CPU Warning Above",
              unit: "percent",
            }),
            thresholdField({
              key: "hostMemoryWarningPercent",
              title: "Memory Warning Above",
              unit: "percent",
            }),
            thresholdField({
              key: "hostEvaluationMinutes",
              title: "For At Least",
              unit: "minutes",
            }),
          ],
        }}
      />

      <CardModelDetail<VMwareHealthSetting>
        name="vmware-health-rules-datastores"
        cardProps={{
          title: "Full Datastores",
          description:
            "When a datastore filling up needs a look, and when it needs someone now.",
        }}
        isEditable={true}
        onSaveSuccess={onSaveSuccess}
        formFields={[
          {
            field: { datastoreWarningPercent: true },
            title: "Warning Above",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "80",
            description:
              "In percent: a datastore fuller than this needs a look. Leave empty to turn this off.",
            validation: { minValue: 0, maxValue: 100 },
          },
          {
            field: { datastoreCriticalPercent: true },
            title: "Critical Above",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "90",
            description:
              "In percent: a datastore fuller than this needs someone now. Leave empty to turn this off.",
            validation: { minValue: 0, maxValue: 100 },
          },
          getPeriodFormField({
            key: "datastoreEvaluationMinutes",
            description:
              "How long a datastore must stay that full before it is marked. 0 judges the latest report.",
          }),
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 3,
          modelType: VMwareHealthSetting,
          id: "vmware-health-rules-datastores-detail",
          modelId: settingId,
          fields: [
            thresholdField({
              key: "datastoreWarningPercent",
              title: "Warning Above",
              unit: "percent",
            }),
            thresholdField({
              key: "datastoreCriticalPercent",
              title: "Critical Above",
              unit: "percent",
            }),
            thresholdField({
              key: "datastoreEvaluationMinutes",
              title: "For At Least",
              unit: "minutes",
            }),
          ],
        }}
      />

      <CardModelDetail<VMwareHealthSetting>
        name="vmware-health-rules-vm-swapping"
        cardProps={{
          title: "VM Swapping",
          description:
            "ESXi keeps swapped memory until the VM touches it, so memory left from earlier is not swapping. Only swapping out now is critical.",
        }}
        isEditable={true}
        onSaveSuccess={onSaveSuccess}
        formFields={[
          {
            field: { vmSwapOutCriticalKibPerSecond: true },
            title: "Swapping Out: Critical Above",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "0",
            description:
              "In KiB/s: the host swapping a VM's memory out to disk faster than this needs someone now. 0 is any swapping out.",
            validation: { minValue: 0 },
          },
          {
            field: { vmSwapInWarningKibPerSecond: true },
            title: "Reading Back: Warning Above",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "1024",
            description:
              "In KiB/s: a VM reading swapped memory back faster than this needs a look. Leave empty to turn this off.",
            validation: { minValue: 0 },
          },
          {
            field: { vmSwappedWarningMebibytes: true },
            title: "Swapped Earlier: Warning Above",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "1024",
            description:
              "In MiB: more memory than this left in the swap file, with nothing swapping now, needs a look. Leave empty to turn this off.",
            validation: { minValue: 0 },
          },
          getPeriodFormField({
            key: "vmSwapEvaluationMinutes",
            description:
              "How long a VM's swapping must last before it is marked. 0 judges the latest report.",
          }),
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 4,
          modelType: VMwareHealthSetting,
          id: "vmware-health-rules-vm-swapping-detail",
          modelId: settingId,
          fields: [
            thresholdField({
              key: "vmSwapOutCriticalKibPerSecond",
              title: "Swapping Out: Critical Above",
              unit: "kibPerSecond",
            }),
            thresholdField({
              key: "vmSwapInWarningKibPerSecond",
              title: "Reading Back: Warning Above",
              unit: "kibPerSecond",
            }),
            thresholdField({
              key: "vmSwappedWarningMebibytes",
              title: "Swapped Earlier: Warning Above",
              unit: "mebibytes",
            }),
            thresholdField({
              key: "vmSwapEvaluationMinutes",
              title: "For At Least",
              unit: "minutes",
            }),
          ],
        }}
      />

      <CardModelDetail<VMwareHealthSetting>
        name="vmware-health-rules-vm-memory-cpu"
        cardProps={{
          title: "VM Ballooning and CPU Ready",
          description:
            "When the host taking memory back from a VM, or a VM waiting for a free CPU, needs a look.",
        }}
        isEditable={true}
        onSaveSuccess={onSaveSuccess}
        formFields={[
          {
            field: { vmBalloonedWarningMebibytes: true },
            title: "Ballooned: Warning Above",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "0",
            description:
              "In MiB: a VM the host takes more memory back from by ballooning needs a look. 0 is any ballooning.",
            validation: { minValue: 0 },
          },
          {
            field: { vmCpuReadyWarningPercent: true },
            title: "CPU Ready: Warning Above",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "10",
            description:
              "In percent of the time: a VM that waits longer for a free physical CPU needs a look. Leave empty to turn this off.",
            validation: { minValue: 0, maxValue: 100 },
          },
          getPeriodFormField({
            key: "vmMemoryCpuEvaluationMinutes",
            description:
              "How long the ballooning or CPU ready must last before the VM needs a look. 0 judges the latest report.",
          }),
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 3,
          modelType: VMwareHealthSetting,
          id: "vmware-health-rules-vm-memory-cpu-detail",
          modelId: settingId,
          fields: [
            thresholdField({
              key: "vmBalloonedWarningMebibytes",
              title: "Ballooned: Warning Above",
              unit: "mebibytes",
            }),
            thresholdField({
              key: "vmCpuReadyWarningPercent",
              title: "CPU Ready: Warning Above",
              unit: "percent",
            }),
            thresholdField({
              key: "vmMemoryCpuEvaluationMinutes",
              title: "For At Least",
              unit: "minutes",
            }),
          ],
        }}
      />

      <CardModelDetail<VMwareHealthSetting>
        name="vmware-health-rules-resource-pools"
        cardProps={{
          title: "Resource Pool Swapping",
          description:
            "When the host swapping a resource pool's memory out needs a look. Each VM in it says its own swapping.",
        }}
        isEditable={true}
        onSaveSuccess={onSaveSuccess}
        formFields={[
          {
            field: { resourcePoolSwapOutWarningKibPerSecond: true },
            title: "Swapping Out: Warning Above",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "0",
            description:
              "In KiB/s: the host swapping a pool's memory out faster than this needs a look. 0 is any swapping out.",
            validation: { minValue: 0 },
          },
          getPeriodFormField({
            key: "resourcePoolEvaluationMinutes",
            description:
              "How long the swapping out must last before the pool needs a look. 0 judges the latest report.",
          }),
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 2,
          modelType: VMwareHealthSetting,
          id: "vmware-health-rules-resource-pools-detail",
          modelId: settingId,
          fields: [
            thresholdField({
              key: "resourcePoolSwapOutWarningKibPerSecond",
              title: "Swapping Out: Warning Above",
              unit: "kibPerSecond",
            }),
            thresholdField({
              key: "resourcePoolEvaluationMinutes",
              title: "For At Least",
              unit: "minutes",
            }),
          ],
        }}
      />

      <VMwareHealthRuleOverridesCard onChanged={onSaveSuccess} />
    </Fragment>
  );
};

export default VMwareHealthRulesPage;
