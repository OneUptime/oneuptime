import AppLink from "../AppLink/AppLink";
import ComplianceFrameworkTile, {
  NOT_EVALUATED,
  REQUIREMENT_STATUS_TONES,
  formatComplianceScore,
  getComplianceScoreClassName,
} from "../DataSecurity/ComplianceFrameworkTile";
import { ComplianceTurnedOffNote } from "../ResourceDataSecurity/ComplianceTurnedOffNote";
import { getKubernetesPartRoute } from "../../Pages/Kubernetes/Utils/KubernetesPartRoutes";
import KubernetesComplianceApi from "./KubernetesComplianceApi";
import {
  downloadKubernetesFrameworkReportCsv,
  downloadKubernetesFrameworkReportJson,
} from "./KubernetesComplianceExport";
import {
  KubernetesComplianceSwitchKey,
  NOT_EVALUATED_REASONS,
  POD_COUNT,
  findTurnedOff,
  getControlInfo,
  getFailingControlCount,
  getFailingCountTemplate,
  getKubernetesSwitchKey,
  getNamespaceRows,
  getObjectName,
  isSwitchOn,
  sortControlsForPage,
} from "./KubernetesComplianceModel";
import DataSecurityComplianceSetting from "Common/Models/DatabaseModels/DataSecurityComplianceSetting";
import Route from "Common/Types/API/Route";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import { ComplianceRequirementStatus } from "Common/Types/DataSecurity/ComplianceRequirementCatalog";
import { DataSecurityComplianceTurnedOff } from "Common/Types/DataSecurity/DataSecurityApiTypes";
import { DataStoreResourceKind } from "Common/Types/DataSecurity/DataStoreResource";
import IconProp from "Common/Types/Icon/IconProp";
import {
  KubernetesComplianceFrameworkResponse,
  KubernetesComplianceNamespace,
  KubernetesComplianceResponse,
} from "Common/Types/Kubernetes/Compliance/KubernetesComplianceApiTypes";
import {
  CIS_NOT_SCORED,
  CIS_NOT_SCORED_REASON_WORDS,
  CisNotScoredGroup,
  CisNotScoredReason,
  KubernetesComplianceControlInfo,
} from "Common/Types/Kubernetes/Compliance/KubernetesComplianceCatalog";
import {
  KubernetesComplianceAgentObject,
  KubernetesComplianceDetail,
  KubernetesComplianceFinding,
  getComplianceDetailKey,
  getComplianceObjectKey,
} from "Common/Types/Kubernetes/Compliance/KubernetesComplianceFinding";
import { KubernetesComplianceFramework } from "Common/Types/Kubernetes/Compliance/KubernetesComplianceFramework";
import { OneUptimeAgentNodesProxyReason } from "Common/Types/Kubernetes/Compliance/KubernetesRbac";
import {
  KubernetesComplianceNotEvaluatedReason,
  KubernetesComplianceRequirementResult,
} from "Common/Types/Kubernetes/Compliance/KubernetesComplianceScoring";
import ObjectID from "Common/Types/ObjectID";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FoldedSection from "Common/UI/Components/FoldedSection/FoldedSection";
import { FoldedSectionItem } from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import Icon from "Common/UI/Components/Icon/Icon";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import CardListSkeleton from "Common/UI/Components/Skeleton/CardListSkeleton";
import LocalTable from "Common/UI/Components/Table/LocalTable";
import TableEmptyState, {
  TableEmptyStateKind,
} from "Common/UI/Components/Table/TableEmptyState";
import { getTableHeaderButtons } from "Common/UI/Components/Table/TableHeaderControls";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import Toast, { CHANGES_SAVED } from "Common/UI/Utils/Toast";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * A KUBERNETES CLUSTER'S OWN HARDENING, ON ITS COMPLIANCE PAGE (#9627).
 *
 * The Pod Security Standards' Baseline and Restricted policies and the CIS
 * Kubernetes Benchmark, scored from what the cluster runs (the server's
 * KubernetesClusterCompliance), as tiles beside the data frameworks its
 * databases are scored on - with the same tiles, the same switches and
 * the same record of who turned what off, when and why
 * (DataSecurityComplianceSetting).
 *
 * A framework picked lists its controls, the failing ones first: each says
 * what it finds wrong and how to fix it, in a sentence, and the workloads,
 * bindings or namespaces that fail it, each linked to its own page where
 * there is one, with the fields that fail it as Kubernetes names them. Its
 * namespaces fold below, each with a switch that leaves it out of the
 * framework, as Pod Security Admission exempts a namespace; the CIS
 * benchmark also says plainly which of its controls need node or control
 * plane access, or a person's review, and are not scored here.
 */

export const KUBERNETES_COMPLIANCE_TEST_ID: string = "kubernetes-compliance";

// How many objects a failing control shows before Show all.
export const FINDINGS_SHOWN: number = 5;

// Every framework's controls on one page: at most the CIS benchmark's 27.
const CONTROLS_PER_PAGE: number = 30;

const TITLE: string = translationKey("Cluster Hardening");

const DESCRIPTION: string = translationKey(
  "How this cluster stands against the Pod Security Standards and the CIS Kubernetes Benchmark, from what it runs. Turn off what does not apply to it.",
);

const READ_FAILED: string = translationKey(
  "The hardening of this cluster could not be read.",
);

const SETTINGS_READ_FAILED: string = translationKey(
  "What is turned off for this cluster could not be read.",
);

const SCORE_LABEL: string = translationKey("Score");

const APPLIES_LABEL: string = translationKey("Applies Here");

const FRAMEWORK_APPLIES_DESCRIPTION: string = translationKey(
  "Off leaves this cluster out of this framework.",
);

const TURNED_OFF_FRAMEWORK_DESCRIPTION: string = translationKey(
  "Turned off here: this cluster is not scored against it.",
);

const CONTROL_APPLIES_LABEL: string = translationKey(
  "{{requirement}} applies here",
);

const NAMESPACE_APPLIES_LABEL: string = translationKey(
  "{{namespace}} applies here",
);

const HOW_TO_FIX: string = translationKey("How to fix");

const TURNED_OFF_FOR_NAMESPACES: string = translationKey(
  "Turned off for {{namespaces}}",
);

const STANDARD_OF_CLUSTER: string = translationKey(
  "Scored against the standard for Kubernetes {{version}}, this cluster's version.",
);

const STANDARD_NEWEST: string = translationKey(
  "Scored against the standard for Kubernetes {{version}}, the newest OneUptime knows.",
);

const TRUNCATED: string = translationKey(
  "This cluster runs more than {{count}} pods: the first {{count}} were scored.",
);

const POLICY_ENGINE_RUNS: string = translationKey(
  "{{engine}} runs on this cluster: 5.2.1 counts it as its policy control mechanism.",
);

const MANAGED_CONTROL_PLANE: string = translationKey(
  "{{provider}} runs this cluster's control plane, so its node and control plane controls are the provider's benchmark's.",
);

const IS_NOT_SET: string = translationKey("{{field}} is not set");

const SHOW_FEWER: string = translationKey("Show fewer");

// As every other Show all reads it: one sentence, whatever the count.
const SHOW_ALL: string = translationKey("Show all {{count}}");

const MORE_NOT_LISTED: PluralTemplate = {
  one: translationKey("{{count}} more is not listed here; the export has it."),
  other: translationKey(
    "{{count}} more are not listed here; the export has them.",
  ),
};

const WORKLOADS_EVALUATED: PluralTemplate = {
  one: translationKey("{{count}} workload evaluated"),
  other: translationKey("{{count}} workloads evaluated"),
};

const WORKLOADS_FAILING: PluralTemplate = {
  one: translationKey("{{count}} workload fails it"),
  other: translationKey("{{count}} workloads fail it"),
};

const CONTROLS_FAILING: PluralTemplate = {
  one: translationKey("{{count}} control failing"),
  other: translationKey("{{count}} controls failing"),
};

const NO_CONTROL_FAILING: string = translationKey("No control failing");

const PODS_NOT_READ: PluralTemplate = {
  one: translationKey(
    "{{count}} pod is scored at the agent's next report, within five minutes by default.",
  ),
  other: translationKey(
    "{{count}} pods are scored at the agent's next report, within five minutes by default.",
  ),
};

const NAMESPACES_TURNED_OFF: PluralTemplate = {
  one: translationKey("{{count}} namespace turned off"),
  other: translationKey("{{count}} namespaces turned off"),
};

const EVERY_NAMESPACE_APPLIES: string = translationKey(
  "Every namespace applies",
);

// A namespace's failing count: one sentence whatever the count, as the monitor overview's.
const FAILING_IN_NAMESPACE: string = translationKey("{{count}} failing");

const ENFORCES_LEVEL: string = translationKey("Enforces {{level}}");

const CONTROL_COUNT: PluralTemplate = {
  one: translationKey("{{count}} control"),
  other: translationKey("{{count}} controls"),
};

const NOT_SCORED_COUNT: PluralTemplate = {
  one: translationKey("{{count}} control not scored here"),
  other: translationKey("{{count}} controls not scored here"),
};

const CONTAINER_LABEL: string = translationKey("Container {{name}}");

const VOLUME_LABEL: string = translationKey("Volume {{name}}");

/*
 * The OneUptime agent's own binding (#9878): said so, and under 5.1.10, why
 * its role grants nodes/proxy, with the one value that drops it once nothing
 * needs it. The values are code, drawn as written in every language.
 */
const AGENT_OWN_BINDING: string = translationKey(
  "This binding is the OneUptime Kubernetes agent's own.",
);

const AGENT_NODES_PROXY_REASONS: Readonly<
  Record<OneUptimeAgentNodesProxyReason, { template: string; setting: string }>
> = {
  [OneUptimeAgentNodesProxyReason.KubeletPods]: {
    template: translationKey(
      "A kubelet older than Kubernetes 1.33 lets the agent read its node's pods only through nodes/proxy. Once every node runs 1.33 or later, upgrade the agent with {{setting}}.",
    ),
    setting: "--set kubeletstats.nodesProxy=false",
  },
  [OneUptimeAgentNodesProxyReason.CostPrometheus]: {
    template: translationKey(
      "The agent's cost Prometheus reads each node's cAdvisor through the API server, as EKS Fargate needs. Where pods can reach each node's kubelet, upgrade the agent with {{setting}}.",
    ),
    setting: "--set cost.prometheus.nodesProxy=false",
  },
};

// A role from a chart before the label grants nodes/proxy on every cluster.
const AGENT_NODES_PROXY_OLDER_CHART: string = translationKey(
  "Upgrade the agent: newer versions grant nodes/proxy only where a node's kubelet needs it.",
);

// The control a binding's nodes/proxy fails.
const NODES_PROXY_CONTROL: string = "5.1.10";

// A field, a value or a setting, drawn as code.
const INLINE_CODE_CLASS_NAME: string =
  "rounded bg-white px-1.5 py-0.5 font-mono text-xs text-gray-800 ring-1 ring-gray-200";

// The reasons a CIS control is not scored here, in the order the fold lists them.
const NOT_SCORED_REASONS: ReadonlyArray<CisNotScoredReason> = [
  CisNotScoredReason.NodeAccess,
  CisNotScoredReason.ControlPlaneAccess,
  CisNotScoredReason.Manual,
];

export interface ComponentProps {
  clusterId: ObjectID;
}

const KubernetesComplianceSection: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  const clusterId: string = props.clusterId.toString();

  const [compliance, setCompliance] =
    useState<KubernetesComplianceResponse | null>(null);
  const [error, setError] = useState<string>("");
  const [readCount, setReadCount] = useState<number>(0);
  const [selected, setSelected] = useState<string>("");
  const [rows, setRows] = useState<
    Record<string, DataSecurityComplianceSetting>
  >({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [switchErrors, setSwitchErrors] = useState<Record<string, string>>({});
  const [settingsError, setSettingsError] = useState<string>("");
  // A switch keeps where it was pressed until its value changes: redrawn after a failed save.
  const [redrawCount, setRedrawCount] = useState<number>(0);
  // The switch just turned off, whose reason is asked for at once (#9629).
  const [askReasonFor, setAskReasonFor] = useState<string>("");
  // The failing controls whose every object is listed.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let isCurrent: boolean = true;

    setError("");

    KubernetesComplianceApi.getClusterCompliance(props.clusterId)
      .then((answer: KubernetesComplianceResponse) => {
        if (isCurrent) {
          setCompliance(answer);
        }
      })
      .catch((err: unknown) => {
        if (isCurrent) {
          setError(API.getFriendlyMessage(err));
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [clusterId, readCount]);

  // The cluster's settings rows, so a switch changes its row rather than making a second.
  useEffect(() => {
    if (!projectId) {
      return () => {};
    }

    let isCurrent: boolean = true;

    setSettingsError("");

    ModelAPI.getList<DataSecurityComplianceSetting>({
      modelType: DataSecurityComplianceSetting,
      query: {
        projectId,
        resourceType: DataStoreResourceKind.KubernetesCluster,
        resourceId: props.clusterId,
      },
      limit: 1000,
      skip: 0,
      select: {
        _id: true,
        framework: true,
        requirement: true,
        namespace: true,
        isEnabled: true,
      },
      sort: {},
    })
      .then((result: ListResult<DataSecurityComplianceSetting>) => {
        if (!isCurrent) {
          return;
        }

        const byKey: Record<string, DataSecurityComplianceSetting> = {};

        for (const row of result.data) {
          if (row.framework) {
            byKey[
              getKubernetesSwitchKey({
                framework: row.framework as KubernetesComplianceFramework,
                requirement: row.requirement,
                namespace: row.namespace,
              })
            ] = row;
          }
        }

        setRows(byKey);
      })
      .catch((err: unknown) => {
        if (isCurrent) {
          setSettingsError(API.getFriendlyMessage(err));
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [clusterId, readCount]);

  const model: DataSecurityComplianceSetting =
    new DataSecurityComplianceSetting();
  const createGate: PermissionGateResult = PermissionGate.check(
    model,
    ModelAction.Create,
  );
  const updateGate: PermissionGateResult = PermissionGate.check(
    model,
    ModelAction.Update,
  );
  const lockedReason: string | undefined = !createGate.isAllowed
    ? createGate.disabledReason
    : !updateGate.isAllowed
      ? updateGate.disabledReason
      : undefined;

  // A switch flipped: its row made or changed, then the scores read again.
  const flip: (
    switchKey: KubernetesComplianceSwitchKey,
    isOn: boolean,
  ) => Promise<void> = async (
    switchKey: KubernetesComplianceSwitchKey,
    isOn: boolean,
  ): Promise<void> => {
    const key: string = getKubernetesSwitchKey(switchKey);

    if (!projectId || lockedReason || saving[key]) {
      return;
    }

    const existing: DataSecurityComplianceSetting | undefined = rows[key];

    if (!existing && isOn) {
      return;
    }

    setSaving((current: Record<string, boolean>) => {
      return { ...current, [key]: true };
    });
    setSwitchErrors((current: Record<string, string>) => {
      return { ...current, [key]: "" };
    });

    try {
      if (existing?.id) {
        await ModelAPI.updateById<DataSecurityComplianceSetting>({
          modelType: DataSecurityComplianceSetting,
          id: existing.id,
          data: { isEnabled: isOn },
        });
      } else {
        const row: DataSecurityComplianceSetting =
          new DataSecurityComplianceSetting();
        row.projectId = projectId;
        row.resourceType = DataStoreResourceKind.KubernetesCluster;
        row.resourceId = props.clusterId;
        row.framework = switchKey.framework;

        if (switchKey.requirement) {
          row.requirement = switchKey.requirement;
        }

        if (switchKey.namespace) {
          row.namespace = switchKey.namespace;
        }

        row.isEnabled = isOn;

        await ModelAPI.create<DataSecurityComplianceSetting>({
          model: row,
          modelType: DataSecurityComplianceSetting,
        });
      }

      Toast.success(translator.translateText(CHANGES_SAVED) || CHANGES_SAVED);
      // Turned off: why is asked for next. Turned on again: nothing is.
      setAskReasonFor(isOn ? "" : key);
      setReadCount((count: number): number => {
        return count + 1;
      });
    } catch (err) {
      setSwitchErrors((current: Record<string, string>) => {
        return { ...current, [key]: API.getFriendlyMessage(err) };
      });
      setRedrawCount((count: number): number => {
        return count + 1;
      });
    }

    setSaving((current: Record<string, boolean>) => {
      return { ...current, [key]: false };
    });
  };

  // A reason written for what is turned off, then the page read again to show it.
  const saveReason: (
    entry: DataSecurityComplianceTurnedOff,
    reason: string,
  ) => Promise<void> = async (
    entry: DataSecurityComplianceTurnedOff,
    reason: string,
  ): Promise<void> => {
    await ModelAPI.updateById<DataSecurityComplianceSetting>({
      modelType: DataSecurityComplianceSetting,
      id: new ObjectID(entry.id),
      data: { note: reason },
    });

    Toast.success(translator.translateText(CHANGES_SAVED) || CHANGES_SAVED);
    setReadCount((count: number): number => {
      return count + 1;
    });
  };

  // Who turned a switch off, when and why, under it; the reason asked for where it was turned off.
  const renderTurnedOffNote: (
    framework: KubernetesComplianceFrameworkResponse,
    switchKey: KubernetesComplianceSwitchKey,
    dataTestId: string,
    options?: { isAskedHere?: boolean; onDone?: () => void },
  ) => ReactElement = (
    framework: KubernetesComplianceFrameworkResponse,
    switchKey: KubernetesComplianceSwitchKey,
    dataTestId: string,
    options: { isAskedHere?: boolean; onDone?: () => void } = {},
  ): ReactElement => {
    const entry: DataSecurityComplianceTurnedOff | undefined = findTurnedOff(
      framework,
      switchKey,
    );
    const key: string = getKubernetesSwitchKey(switchKey);
    const onDone: (() => void) | undefined = options.onDone;

    if (!entry) {
      return <></>;
    }

    return (
      <ComplianceTurnedOffNote
        key={`${key}-${entry.id}`}
        entry={entry}
        isEditable={!lockedReason}
        isAsking={askReasonFor === key && options.isAskedHere !== false}
        onSaveReason={saveReason}
        onDone={(): void => {
          setAskReasonFor((current: string): string => {
            return current === key ? "" : current;
          });
          onDone?.();
        }}
        dataTestId={dataTestId}
      />
    );
  };

  const renderSwitch: (
    framework: KubernetesComplianceFrameworkResponse,
    switchKey: KubernetesComplianceSwitchKey,
    options: {
      title?: string;
      description?: string;
      ariaLabel?: string;
      dataTestId: string;
    },
  ) => ReactElement = (
    framework: KubernetesComplianceFrameworkResponse,
    switchKey: KubernetesComplianceSwitchKey,
    options: {
      title?: string;
      description?: string;
      ariaLabel?: string;
      dataTestId: string;
    },
  ): ReactElement => {
    const key: string = getKubernetesSwitchKey(switchKey);

    return (
      <Toggle
        key={`${key}-${redrawCount}`}
        title={options.title}
        description={options.description}
        value={isSwitchOn(framework, switchKey)}
        disabled={Boolean(lockedReason) || saving[key]}
        tooltip={lockedReason}
        isTooltipTranslated={true}
        error={switchErrors[key]}
        ariaLabel={options.ariaLabel}
        isAriaLabelTranslated={Boolean(options.ariaLabel)}
        onChange={(isOn: boolean): void => {
          void flip(switchKey, isOn);
        }}
        dataTestId={options.dataTestId}
      />
    );
  };

  if (error) {
    return (
      <Card title={TITLE} description={DESCRIPTION}>
        <ErrorMessage
          message={error}
          whatFailed={translator.translateText(READ_FAILED)}
          onRefreshClick={() => {
            setCompliance(null);
            setReadCount((count: number): number => {
              return count + 1;
            });
          }}
        />
      </Card>
    );
  }

  if (!compliance) {
    return (
      <Card title={TITLE} description={DESCRIPTION}>
        <CardListSkeleton
          count={3}
          gridClassName="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
        />
      </Card>
    );
  }

  const applying: Array<KubernetesComplianceFrameworkResponse> =
    compliance.frameworks.filter(
      (item: KubernetesComplianceFrameworkResponse): boolean => {
        return !item.isTurnedOff;
      },
    );
  const turnedOff: Array<KubernetesComplianceFrameworkResponse> =
    compliance.frameworks.filter(
      (item: KubernetesComplianceFrameworkResponse): boolean => {
        return item.isTurnedOff;
      },
    );
  const framework: KubernetesComplianceFrameworkResponse | undefined =
    applying.find((item: KubernetesComplianceFrameworkResponse): boolean => {
      return item.framework === selected;
    });
  // A framework turned off from its own card keeps that card, asking why (#9629).
  const turnedOffFramework: KubernetesComplianceFrameworkResponse | undefined =
    framework
      ? undefined
      : turnedOff.find(
          (item: KubernetesComplianceFrameworkResponse): boolean => {
            return item.framework === selected;
          },
        );

  return (
    <div className="space-y-4" data-testid={KUBERNETES_COMPLIANCE_TEST_ID}>
      <Card title={TITLE} description={DESCRIPTION}>
        {compliance.podCount === 0 ? (
          <TableEmptyState
            kind={TableEmptyStateKind.Empty}
            icon={IconProp.ShieldCheck}
            title="Nothing to score yet"
            description="This cluster is scored once the Kubernetes agent reports the pods it runs."
            isCompact={true}
          />
        ) : applying.length > 0 ? (
          <div
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
            data-testid={`${KUBERNETES_COMPLIANCE_TEST_ID}-frameworks`}
          >
            {applying.map(
              (item: KubernetesComplianceFrameworkResponse): ReactElement => {
                const failing: number = getFailingControlCount(item);

                return (
                  <ComplianceFrameworkTile
                    key={item.framework}
                    framework={item}
                    isSelected={item.framework === selected}
                    summary={{
                      scope: translator.translatePlural(
                        WORKLOADS_EVALUATED,
                        item.workloadsEvaluated,
                      ),
                      note:
                        failing > 0
                          ? translator.translatePlural(
                              CONTROLS_FAILING,
                              failing,
                            )
                          : translator.translateText(NO_CONTROL_FAILING) ||
                            NO_CONTROL_FAILING,
                      isFailing: failing > 0,
                    }}
                    onSelect={() => {
                      setSelected(
                        item.framework === selected ? "" : item.framework,
                      );
                    }}
                  />
                );
              },
            )}
          </div>
        ) : (
          <TableEmptyState
            kind={TableEmptyStateKind.Empty}
            icon={IconProp.ShieldCheck}
            title="Every framework is turned off"
            description="Turn one on below to score this cluster against it again."
            isCompact={true}
          />
        )}
      </Card>

      {framework ? (
        <Card
          title={
            translator.translateText(framework.fullName) || framework.fullName
          }
          description={
            translator.translateText(framework.scope) || framework.scope
          }
          buttons={getTableHeaderButtons([
            {
              title: "Export CSV",
              icon: IconProp.Download,
              buttonStyle: ButtonStyleType.NORMAL,
              onClick: () => {
                downloadKubernetesFrameworkReportCsv(framework);
              },
            },
            {
              title: "Export JSON",
              icon: IconProp.Download,
              buttonStyle: ButtonStyleType.OUTLINE,
              onClick: () => {
                downloadKubernetesFrameworkReportJson(compliance, framework);
              },
            },
          ])}
        >
          <div
            className="space-y-4"
            data-testid={`${KUBERNETES_COMPLIANCE_TEST_ID}-framework`}
          >
            <FrameworkFigures
              compliance={compliance}
              framework={framework}
              translator={translator}
            />

            <div
              data-testid={`${KUBERNETES_COMPLIANCE_TEST_ID}-framework-switch`}
            >
              {renderSwitch(
                framework,
                { framework: framework.framework },
                {
                  title: APPLIES_LABEL,
                  description: FRAMEWORK_APPLIES_DESCRIPTION,
                  dataTestId: `${KUBERNETES_COMPLIANCE_TEST_ID}-applies-${framework.framework}`,
                },
              )}
            </div>

            {settingsError ? (
              <ErrorMessage
                message={settingsError}
                whatFailed={translator.translateText(SETTINGS_READ_FAILED)}
              />
            ) : (
              <></>
            )}

            <LocalTable<KubernetesComplianceRequirementResult>
              id="kubernetes-compliance-controls"
              data={sortControlsForPage(framework.requirements)}
              singularLabel="Control"
              pluralLabel="Controls"
              // A framework's controls are read as a whole: the CIS benchmark's 27 on one page.
              itemsPerPage={CONTROLS_PER_PAGE}
              columns={[
                {
                  key: "requirement",
                  title: "Control",
                  type: FieldType.Element,
                  disableSort: true,
                  wrapContent: true,
                  wrapMaxWidthClassName: "max-w-2xl",
                  getElement: (
                    row: KubernetesComplianceRequirementResult,
                  ): ReactElement => {
                    return (
                      <ControlCell
                        clusterId={props.clusterId}
                        framework={framework.framework}
                        row={row}
                        isExpanded={Boolean(
                          expanded[`${framework.framework}|${row.requirement}`],
                        )}
                        onToggleExpanded={() => {
                          const key: string = `${framework.framework}|${row.requirement}`;
                          setExpanded((current: Record<string, boolean>) => {
                            return { ...current, [key]: !current[key] };
                          });
                        }}
                        translator={translator}
                      />
                    );
                  },
                },
                {
                  key: "status",
                  title: "Status",
                  type: FieldType.Element,
                  disableSort: true,
                  wrapContent: true,
                  wrapMaxWidthClassName: "max-w-xs",
                  getElement: (
                    row: KubernetesComplianceRequirementResult,
                  ): ReactElement => {
                    const rowSwitch: KubernetesComplianceSwitchKey = {
                      framework: framework.framework,
                      requirement: row.requirement,
                    };

                    return (
                      <div className="min-w-[8rem]">
                        <Pill
                          text={row.status}
                          tone={
                            REQUIREMENT_STATUS_TONES[row.status] ||
                            PillTone.Neutral
                          }
                        />
                        {isSwitchOn(framework, rowSwitch) ? (
                          <></>
                        ) : (
                          renderTurnedOffNote(
                            framework,
                            rowSwitch,
                            `${KUBERNETES_COMPLIANCE_TEST_ID}-turned-off-${framework.framework}-${row.requirement}`,
                          )
                        )}
                      </div>
                    );
                  },
                },
                {
                  key: "failingCount",
                  title: "Applies Here",
                  type: FieldType.Element,
                  disableSort: true,
                  getElement: (
                    row: KubernetesComplianceRequirementResult,
                  ): ReactElement => {
                    return renderSwitch(
                      framework,
                      {
                        framework: framework.framework,
                        requirement: row.requirement,
                      },
                      {
                        ariaLabel: translator.translateTemplate(
                          CONTROL_APPLIES_LABEL,
                          { requirement: row.requirement },
                        ),
                        dataTestId: `${KUBERNETES_COMPLIANCE_TEST_ID}-applies-${framework.framework}-${row.requirement}`,
                      },
                    );
                  },
                },
              ]}
            />
          </div>
        </Card>
      ) : (
        <></>
      )}

      {framework ? (
        <FoldedSection
          title="Namespaces"
          icon={IconProp.Folder}
          description="Turn a namespace off to leave everything in it out of this framework, as Pod Security Admission exempts a namespace."
          summary={
            // In the reader's words already: an element, so it is not looked up again.
            <span>
              {framework.turnedOffNamespaces.length > 0
                ? translator.translatePlural(
                    NAMESPACES_TURNED_OFF,
                    framework.turnedOffNamespaces.length,
                  )
                : translator.translateText(EVERY_NAMESPACE_APPLIES)}
            </span>
          }
          isElevated={true}
          dataTestId={`${KUBERNETES_COMPLIANCE_TEST_ID}-namespaces`}
        >
          <ul className="divide-y divide-gray-100">
            {getNamespaceRows(compliance, framework).map(
              (namespace: KubernetesComplianceNamespace): ReactElement => {
                const namespaceSwitch: KubernetesComplianceSwitchKey = {
                  framework: framework.framework,
                  namespace: namespace.name,
                };
                const failing: number =
                  framework.failingByNamespace[namespace.name] || 0;

                return (
                  <li
                    key={namespace.name}
                    className="flex flex-wrap items-start justify-between gap-3 px-5 py-4 md:px-6"
                    data-testid={`${KUBERNETES_COMPLIANCE_TEST_ID}-namespace-${namespace.name}`}
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-medium text-gray-900">
                          {namespace.name}
                        </span>
                        {namespace.enforce ? (
                          <Pill
                            text={translator.translateTemplate(ENFORCES_LEVEL, {
                              level: namespace.enforce,
                            })}
                            isUserContent={true}
                            tone={PillTone.Neutral}
                            isDotHidden={true}
                          />
                        ) : (
                          <></>
                        )}
                        {failing > 0 ? (
                          <Pill
                            text={translator.translateTemplate(
                              FAILING_IN_NAMESPACE,
                              { count: translator.formatNumber(failing) },
                            )}
                            isUserContent={true}
                            tone={PillTone.Danger}
                          />
                        ) : (
                          <></>
                        )}
                      </div>
                      {isSwitchOn(framework, namespaceSwitch) ? (
                        <></>
                      ) : (
                        renderTurnedOffNote(
                          framework,
                          namespaceSwitch,
                          `${KUBERNETES_COMPLIANCE_TEST_ID}-namespace-turned-off-${namespace.name}`,
                        )
                      )}
                    </div>
                    {renderSwitch(framework, namespaceSwitch, {
                      ariaLabel: translator.translateTemplate(
                        NAMESPACE_APPLIES_LABEL,
                        { namespace: namespace.name },
                      ),
                      dataTestId: `${KUBERNETES_COMPLIANCE_TEST_ID}-applies-${framework.framework}-namespace-${namespace.name}`,
                    })}
                  </li>
                );
              },
            )}
          </ul>
        </FoldedSection>
      ) : (
        <></>
      )}

      {framework?.framework === KubernetesComplianceFramework.CisKubernetes ? (
        <NotScoredFold compliance={compliance} translator={translator} />
      ) : (
        <></>
      )}

      {turnedOffFramework ? (
        <Card
          title={
            translator.translateText(turnedOffFramework.fullName) ||
            turnedOffFramework.fullName
          }
          description={TURNED_OFF_FRAMEWORK_DESCRIPTION}
        >
          <div
            className="space-y-2"
            data-testid={`${KUBERNETES_COMPLIANCE_TEST_ID}-framework-turned-off`}
          >
            {renderSwitch(
              turnedOffFramework,
              { framework: turnedOffFramework.framework },
              {
                title: APPLIES_LABEL,
                description: FRAMEWORK_APPLIES_DESCRIPTION,
                dataTestId: `${KUBERNETES_COMPLIANCE_TEST_ID}-applies-here-${turnedOffFramework.framework}`,
              },
            )}
            {renderTurnedOffNote(
              turnedOffFramework,
              { framework: turnedOffFramework.framework },
              `${KUBERNETES_COMPLIANCE_TEST_ID}-framework-turned-off-note`,
              {
                onDone: (): void => {
                  setSelected("");
                },
              },
            )}
          </div>
        </Card>
      ) : (
        <></>
      )}

      {turnedOff.length > 0 ? (
        <FoldedSection
          title="Turned Off"
          icon={IconProp.AdjustmentHorizontal}
          description="Hardening frameworks turned off for this cluster."
          items={turnedOff.map(
            (
              item: KubernetesComplianceFrameworkResponse,
            ): FoldedSectionItem => {
              return {
                key: item.framework,
                title: item.framework,
                isSet: true,
                value: "Off",
                translateValue: true,
              };
            },
          )}
          isElevated={true}
          dataTestId={`${KUBERNETES_COMPLIANCE_TEST_ID}-turned-off`}
        >
          <ul className="divide-y divide-gray-100">
            {turnedOff.map(
              (item: KubernetesComplianceFrameworkResponse): ReactElement => {
                const itemSwitch: KubernetesComplianceSwitchKey = {
                  framework: item.framework,
                };

                return (
                  <li
                    key={item.framework}
                    className="px-5 py-4 md:px-6"
                    data-testid={`${KUBERNETES_COMPLIANCE_TEST_ID}-off-${item.framework}`}
                  >
                    {renderSwitch(item, itemSwitch, {
                      title: item.framework,
                      description:
                        translator.translateText(item.fullName) ||
                        item.fullName,
                      dataTestId: `${KUBERNETES_COMPLIANCE_TEST_ID}-applies-${item.framework}`,
                    })}
                    {renderTurnedOffNote(
                      item,
                      itemSwitch,
                      `${KUBERNETES_COMPLIANCE_TEST_ID}-turned-off-${item.framework}`,
                      // Turned off from its own card, which asks why there.
                      { isAskedHere: item.framework !== selected },
                    )}
                  </li>
                );
              },
            )}
          </ul>
        </FoldedSection>
      ) : (
        <></>
      )}
    </div>
  );
};

// The framework's score, what it is scored over, and what it cannot say yet.
const FrameworkFigures: FunctionComponent<{
  compliance: KubernetesComplianceResponse;
  framework: KubernetesComplianceFrameworkResponse;
  translator: Translator;
}> = (props: {
  compliance: KubernetesComplianceResponse;
  framework: KubernetesComplianceFrameworkResponse;
  translator: Translator;
}): ReactElement => {
  const { compliance, framework, translator } = props;
  const isPodSecurity: boolean =
    framework.framework !== KubernetesComplianceFramework.CisKubernetes;
  const failingWorkloads: number =
    framework.workloadsEvaluated - framework.workloadsPassing;
  // Each reason a control cannot be scored yet, said once for the framework.
  const reasons: Array<KubernetesComplianceNotEvaluatedReason> = Array.from(
    new Set(
      framework.requirements
        .map(
          (
            row: KubernetesComplianceRequirementResult,
          ): KubernetesComplianceNotEvaluatedReason | undefined => {
            return row.notEvaluatedReason;
          },
        )
        .filter(
          (
            reason: KubernetesComplianceNotEvaluatedReason | undefined,
          ): reason is KubernetesComplianceNotEvaluatedReason => {
            return Boolean(reason);
          },
        ),
    ),
  );
  const notes: Array<{ key: string; text: string }> = [];

  if (isPodSecurity && compliance.standardVersion) {
    notes.push({
      key: "version",
      text: translator.translateTemplate(
        compliance.kubernetesVersion === compliance.standardVersion
          ? STANDARD_OF_CLUSTER
          : STANDARD_NEWEST,
        { version: compliance.standardVersion },
      ),
    });
  }

  if (compliance.podsRead > 0 && compliance.podCount > compliance.podsRead) {
    notes.push({
      key: "unread",
      text: translator.translatePlural(
        PODS_NOT_READ,
        compliance.podCount - compliance.podsRead,
      ),
    });
  }

  if (compliance.isTruncated) {
    notes.push({
      key: "truncated",
      text: translator.translateTemplate(TRUNCATED, {
        count: translator.formatNumber(compliance.podCount),
      }),
    });
  }

  if (!isPodSecurity && compliance.policyEngine) {
    notes.push({
      key: "engine",
      text: translator.translateTemplate(POLICY_ENGINE_RUNS, {
        engine: compliance.policyEngine,
      }),
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
            {translator.translateText(SCORE_LABEL)}
          </div>
          <div
            className={`text-2xl font-semibold tabular-nums ${getComplianceScoreClassName(
              framework.score,
            )}`}
          >
            {framework.score === null
              ? translator.translateText(NOT_EVALUATED)
              : formatComplianceScore(framework.score, translator)}
          </div>
        </div>
        <div className="text-sm text-gray-600">
          {translator.translatePlural(
            WORKLOADS_EVALUATED,
            framework.workloadsEvaluated,
          )}
        </div>
        {isPodSecurity && failingWorkloads > 0 ? (
          <div className="text-sm text-gray-600">
            {translator.translatePlural(WORKLOADS_FAILING, failingWorkloads)}
          </div>
        ) : (
          <></>
        )}
        <div className="text-sm text-gray-600">
          {translator.translatePlural(
            CONTROLS_FAILING,
            getFailingControlCount(framework),
          )}
        </div>
      </div>
      {reasons.map(
        (reason: KubernetesComplianceNotEvaluatedReason): ReactElement => {
          return (
            <p
              key={reason}
              className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
              data-testid={`${KUBERNETES_COMPLIANCE_TEST_ID}-not-evaluated-${reason}`}
            >
              {translator.translateText(NOT_EVALUATED_REASONS[reason])}
            </p>
          );
        },
      )}
      {notes.map((note: { key: string; text: string }): ReactElement => {
        return (
          <p
            key={note.key}
            className="text-sm text-gray-600"
            data-testid={`${KUBERNETES_COMPLIANCE_TEST_ID}-note-${note.key}`}
          >
            {note.text}
          </p>
        );
      })}
    </div>
  );
};

// A control: its number and title, and for a failing one what fails it and how to fix it.
const ControlCell: FunctionComponent<{
  clusterId: ObjectID;
  framework: KubernetesComplianceFramework;
  row: KubernetesComplianceRequirementResult;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  translator: Translator;
}> = (props: {
  clusterId: ObjectID;
  framework: KubernetesComplianceFramework;
  row: KubernetesComplianceRequirementResult;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  translator: Translator;
}): ReactElement => {
  const { row, translator } = props;
  const info: KubernetesComplianceControlInfo | undefined = getControlInfo(
    props.framework,
    row.requirement,
  );
  const title: string = info?.title || row.title;
  const isFailing: boolean = row.status === ComplianceRequirementStatus.Failing;
  const shown: Array<KubernetesComplianceFinding> = props.isExpanded
    ? row.findings
    : row.findings.slice(0, FINDINGS_SHOWN);
  const notListed: number = row.failingCount - row.findings.length;

  return (
    <div
      className="min-w-[14rem] space-y-2"
      data-testid={`${KUBERNETES_COMPLIANCE_TEST_ID}-control-${row.requirement}`}
    >
      <div className="text-sm font-medium text-gray-900">
        {info?.isNumbered ? (
          <span className="me-2 font-mono text-xs text-gray-500">
            {row.requirement}
          </span>
        ) : (
          <></>
        )}
        <span>{translator.translateText(title) || title}</span>
      </div>
      {info ? (
        <p className="text-sm text-gray-600">
          {translator.translateText(info.description) || info.description}
        </p>
      ) : (
        <></>
      )}
      {row.turnedOffNamespaces.length > 0 ? (
        <p className="text-xs text-gray-500">
          <TranslatedSentence
            template={TURNED_OFF_FOR_NAMESPACES}
            slots={{
              namespaces: (
                <span className="font-mono">
                  {row.turnedOffNamespaces.join(", ")}
                </span>
              ),
            }}
          />
        </p>
      ) : (
        <></>
      )}
      {isFailing && info ? (
        <div className="space-y-2">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
              {translator.translateText(HOW_TO_FIX)}
            </div>
            <p className="text-sm text-gray-700">
              {translator.translateText(info.fix) || info.fix}
            </p>
          </div>
          <div className="text-xs font-medium text-red-700">
            {translator.translatePlural(
              getFailingCountTemplate(row.findings),
              row.failingCount,
            )}
          </div>
          <ul
            className="space-y-2"
            data-testid={`${KUBERNETES_COMPLIANCE_TEST_ID}-findings-${row.requirement}`}
          >
            {shown.map((finding: KubernetesComplianceFinding): ReactElement => {
              return (
                <FindingLine
                  key={getComplianceObjectKey(finding.object)}
                  clusterId={props.clusterId}
                  requirement={row.requirement}
                  finding={finding}
                  translator={translator}
                />
              );
            })}
          </ul>
          {row.findings.length > FINDINGS_SHOWN ? (
            <Button
              buttonStyle={ButtonStyleType.LINK}
              title={
                props.isExpanded
                  ? translator.translateText(SHOW_FEWER)
                  : translator.translateTemplate(SHOW_ALL, {
                      count: translator.formatNumber(row.findings.length),
                    })
              }
              isTitleTranslated={true}
              ariaExpanded={props.isExpanded}
              onClick={props.onToggleExpanded}
              dataTestId={`${KUBERNETES_COMPLIANCE_TEST_ID}-show-all-${row.requirement}`}
            />
          ) : (
            <></>
          )}
          {props.isExpanded && notListed > 0 ? (
            <p className="text-xs text-gray-500">
              {translator.translatePlural(MORE_NOT_LISTED, notListed)}
            </p>
          ) : (
            <></>
          )}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

// One object a control fails on: its page, its kind, and the fields that fail it.
const FindingLine: FunctionComponent<{
  clusterId: ObjectID;
  // The control it fails.
  requirement: string;
  finding: KubernetesComplianceFinding;
  translator: Translator;
}> = (props: {
  clusterId: ObjectID;
  requirement: string;
  finding: KubernetesComplianceFinding;
  translator: Translator;
}): ReactElement => {
  const { finding, translator } = props;
  const route: Route | undefined = getKubernetesPartRoute(props.clusterId, {
    kind: finding.object.kind,
    name: finding.object.name,
    namespace: finding.object.namespace || undefined,
  });
  const name: string = getObjectName(finding);

  return (
    <li className="rounded-md bg-gray-50 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-xs text-gray-500">{finding.object.kind}</span>
        {route ? (
          <AppLink
            to={route}
            className="font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
          >
            <span>{name}</span>
          </AppLink>
        ) : (
          <span className="font-medium text-gray-900">{name}</span>
        )}
        {finding.podCount && finding.podCount > 0 ? (
          <span className="text-xs text-gray-500">
            {translator.translatePlural(POD_COUNT, finding.podCount)}
          </span>
        ) : (
          <></>
        )}
      </div>
      {finding.details.length > 0 ? (
        <ul className="mt-1 flex flex-wrap gap-1.5">
          {finding.details.map(
            (detail: KubernetesComplianceDetail): ReactElement => {
              return (
                <DetailChip
                  key={getComplianceDetailKey(detail)}
                  detail={detail}
                  translator={translator}
                />
              );
            },
          )}
        </ul>
      ) : (
        <></>
      )}
      {finding.oneUptimeAgent ? (
        <AgentBindingNote
          agent={finding.oneUptimeAgent}
          isNodesProxyControl={props.requirement === NODES_PROXY_CONTROL}
          translator={translator}
        />
      ) : (
        <></>
      )}
    </li>
  );
};

/*
 * The OneUptime agent's own binding (#9878): whose it is, and, under 5.1.10,
 * why its role grants nodes/proxy - as the role's label says - with the
 * value that drops it once nothing needs it. A role from an older chart
 * names no reason: it grants nodes/proxy everywhere, and upgrading drops it.
 */
const AgentBindingNote: FunctionComponent<{
  agent: KubernetesComplianceAgentObject;
  isNodesProxyControl: boolean;
  translator: Translator;
}> = (props: {
  agent: KubernetesComplianceAgentObject;
  isNodesProxyControl: boolean;
  translator: Translator;
}): ReactElement => {
  const { translator } = props;
  const reasons: Array<OneUptimeAgentNodesProxyReason> =
    props.isNodesProxyControl ? props.agent.nodesProxyReasons : [];

  return (
    <div
      className="mt-2 flex items-start gap-2 text-xs text-gray-600"
      data-testid={`${KUBERNETES_COMPLIANCE_TEST_ID}-agent-binding`}
    >
      <Icon
        icon={IconProp.Info}
        className="mt-0.5 h-3.5 w-3.5 flex-none text-gray-400"
      />
      <div className="space-y-1">
        <p>{translator.translateText(AGENT_OWN_BINDING)}</p>
        {reasons.map((reason: OneUptimeAgentNodesProxyReason): ReactElement => {
          const words: { template: string; setting: string } =
            AGENT_NODES_PROXY_REASONS[reason];

          return (
            <p key={reason}>
              <TranslatedSentence
                template={words.template}
                slots={{
                  setting: (
                    <code className={INLINE_CODE_CLASS_NAME}>
                      {words.setting}
                    </code>
                  ),
                }}
              />
            </p>
          );
        })}
        {props.isNodesProxyControl && reasons.length === 0 ? (
          <p>{translator.translateText(AGENT_NODES_PROXY_OLDER_CHART)}</p>
        ) : (
          <></>
        )}
      </div>
    </div>
  );
};

// A field that fails a control, as Kubernetes names it, with the container or volume it is of.
const DetailChip: FunctionComponent<{
  detail: KubernetesComplianceDetail;
  translator: Translator;
}> = (props: {
  detail: KubernetesComplianceDetail;
  translator: Translator;
}): ReactElement => {
  const { detail, translator } = props;
  const part: { icon: IconProp; name: string; label: string } | null =
    detail.container
      ? {
          icon: IconProp.Cube,
          name: detail.container,
          label: translator.translateTemplate(CONTAINER_LABEL, {
            name: detail.container,
          }),
        }
      : detail.volume
        ? {
            icon: IconProp.Disc,
            name: detail.volume,
            label: translator.translateTemplate(VOLUME_LABEL, {
              name: detail.volume,
            }),
          }
        : null;
  const code: ReactElement = (
    <code className={INLINE_CODE_CLASS_NAME}>
      {detail.isNotSet || !detail.value
        ? detail.field
        : `${detail.field}: ${detail.value}`}
    </code>
  );

  return (
    <li className="flex flex-wrap items-center gap-1 text-xs text-gray-700">
      {part ? (
        <span
          className="inline-flex items-center gap-1 font-mono text-gray-600"
          title={part.label}
          aria-label={part.label}
        >
          <Icon icon={part.icon} className="h-3 w-3 text-gray-400" />
          <span aria-hidden="true">{part.name}</span>
        </span>
      ) : (
        <></>
      )}
      {detail.isNotSet ? (
        /*
         * One item of the chip's row: loose in the flex <li>, each piece of
         * the sentence would be an item of its own, and on a page read right
         * to left the marks that set the field apart would be gaps too.
         */
        <span>
          <TranslatedSentence template={IS_NOT_SET} slots={{ field: code }} />
        </span>
      ) : (
        code
      )}
    </li>
  );
};

// The CIS benchmark's controls not scored here, by why: plainly, never as passing or failing.
const NotScoredFold: FunctionComponent<{
  compliance: KubernetesComplianceResponse;
  translator: Translator;
}> = (props: {
  compliance: KubernetesComplianceResponse;
  translator: Translator;
}): ReactElement => {
  const { compliance, translator } = props;
  const total: number = CIS_NOT_SCORED.reduce(
    (sum: number, group: CisNotScoredGroup): number => {
      return sum + group.controlCount;
    },
    0,
  );

  return (
    <FoldedSection
      title="Not Scored Here"
      icon={IconProp.Info}
      description="The benchmark's controls that need access to the nodes or the control plane, or a person's review. They are neither passing nor failing here."
      summary={
        <span>{translator.translatePlural(NOT_SCORED_COUNT, total)}</span>
      }
      isElevated={true}
      dataTestId={`${KUBERNETES_COMPLIANCE_TEST_ID}-not-scored`}
    >
      <div className="space-y-5 px-5 py-4 md:px-6">
        {compliance.isManagedControlPlane && compliance.provider ? (
          <p
            className="text-sm text-gray-700"
            data-testid={`${KUBERNETES_COMPLIANCE_TEST_ID}-managed-control-plane`}
          >
            {translator.translateTemplate(MANAGED_CONTROL_PLANE, {
              provider: compliance.provider,
            })}
          </p>
        ) : (
          <></>
        )}
        {NOT_SCORED_REASONS.map((reason: CisNotScoredReason): ReactElement => {
          const groups: Array<CisNotScoredGroup> = CIS_NOT_SCORED.filter(
            (group: CisNotScoredGroup): boolean => {
              return group.reason === reason;
            },
          );

          return (
            <div
              key={reason}
              data-testid={`${KUBERNETES_COMPLIANCE_TEST_ID}-not-scored-${reason}`}
            >
              <p className="text-sm font-medium text-gray-900">
                {translator.translateText(CIS_NOT_SCORED_REASON_WORDS[reason])}
              </p>
              <ul className="mt-2 space-y-1.5">
                {groups.map((group: CisNotScoredGroup): ReactElement => {
                  return (
                    <li key={group.id} className="text-sm text-gray-700">
                      <span className="me-2 font-mono text-xs text-gray-500">
                        {group.id}
                      </span>
                      <span>{translator.translateText(group.title)}</span>
                      {group.controlCount > 1 ? (
                        <span className="ms-2 text-xs text-gray-500">
                          {translator.translatePlural(
                            CONTROL_COUNT,
                            group.controlCount,
                          )}
                        </span>
                      ) : (
                        <></>
                      )}
                      {group.why ? (
                        <p className="text-xs text-gray-500">
                          {translator.translateText(group.why)}
                        </p>
                      ) : (
                        <></>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </FoldedSection>
  );
};

export default KubernetesComplianceSection;
