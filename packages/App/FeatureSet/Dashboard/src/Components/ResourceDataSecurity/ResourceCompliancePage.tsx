import PageComponentProps from "../../Pages/PageComponentProps";
import AppLink from "../AppLink/AppLink";
import {
  downloadFrameworkReportCsv,
  downloadFrameworkReportJson,
} from "../DataSecurity/ComplianceExport";
import ComplianceFrameworkTile, {
  NOT_EVALUATED,
  formatComplianceScore,
  getComplianceScoreClassName,
  getFailingRequirementCount,
} from "../DataSecurity/ComplianceFrameworkTile";
import DataSecurityApi from "../DataSecurity/DataSecurityApi";
import { RESOURCE_DATA_SECURITY_ISSUES_TABLE_ID } from "./ResourceDataSecurityPage";
import {
  RESOURCE_COMPLIANCE_DESCRIPTIONS,
  getResourceComplianceRoute,
  getResourceDataSecurityRoute,
} from "./ResourceDataSecurityPages";
import {
  ComplianceSwitchKey,
  OWNER_NOTICE_TEMPLATES,
  REQUIREMENT_STATUS_TONES,
  SET_ON_OWNER_SENTENCES,
  getAppliesSwitchState,
  getComplianceSwitchKey,
  splitResourceFrameworks,
} from "./ResourceComplianceModel";
import DataSecurityComplianceSetting from "Common/Models/DatabaseModels/DataSecurityComplianceSetting";
import Route from "Common/Types/API/Route";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import { COMPLIANCE_FRAMEWORK_INFO } from "Common/Types/DataSecurity/ComplianceFramework";
import { ComplianceRequirementResult } from "Common/Types/DataSecurity/ComplianceRequirementCatalog";
import {
  DataSecurityResourceComplianceFramework,
  DataSecurityResourceComplianceResponse,
} from "Common/Types/DataSecurity/DataSecurityApiTypes";
import { DataStoreResourceKind } from "Common/Types/DataSecurity/DataStoreResource";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FoldedSection from "Common/UI/Components/FoldedSection/FoldedSection";
import { FoldedSectionItem } from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import CardListSkeleton from "Common/UI/Components/Skeleton/CardListSkeleton";
import LocalTable from "Common/UI/Components/Table/LocalTable";
import TableEmptyState, {
  TableEmptyStateKind,
} from "Common/UI/Components/Table/TableEmptyState";
import { getTableHeaderButtons } from "Common/UI/Components/Table/TableHeaderControls";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import TableFilterUrlState from "Common/UI/Utils/TableFilterUrlState";
import Toast, { CHANGES_SAVED } from "Common/UI/Utils/Toast";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * A RESOURCE'S COMPLIANCE PAGE (#9555): how the data stores of one
 * Kubernetes cluster, container host, database, cloud resource or service
 * stand against each framework Data Security scores - the same scores as
 * Data Security > Compliance, over this resource's stores alone - and what
 * does not apply to it.
 *
 * The frameworks its data puts in scope come first, as tiles to pick;
 * picking one lists its requirements, each with where it stands, its open
 * issues on this resource's stores (opening the resource's own Data
 * Security page, narrowed to that requirement's checks) and a switch: it
 * applies here, or it does not. The framework itself has one too. A switch
 * saves when it is flipped, and what is turned off leaves the resource's
 * stores out of that framework or requirement on the project's Compliance
 * page as well (Types/DataSecurity/ComplianceScope). The frameworks turned
 * off, and the ones no data here puts in scope, fold away below.
 *
 * A database running on a cluster or a container host is scored with that
 * cluster's or host's switches, which only its page changes: this page
 * says so, and links there.
 */

export const RESOURCE_COMPLIANCE_TEST_ID: string = "resource-compliance";

const OPEN_ISSUES: PluralTemplate = {
  one: "{{count}} open issue",
  other: "{{count}} open issues",
};

const SCORE_LABEL: string = translationKey("Score");

const APPLIES_LABEL: string = translationKey("Applies Here");

const APPLIES_DESCRIPTION: string = translationKey(
  "Off leaves these data stores out of this framework, here and on the project's Compliance page.",
);

const REQUIREMENT_APPLIES_LABEL: string = translationKey(
  "{{requirement}} applies here",
);

const READ_FAILED: string = translationKey(
  "The compliance of this resource could not be read.",
);

const SETTINGS_READ_FAILED: string = translationKey(
  "What is turned off for this resource could not be read.",
);

export interface ComponentProps extends PageComponentProps {
  kind: DataStoreResourceKind;
}

const ResourceCompliancePage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  const [compliance, setCompliance] =
    useState<DataSecurityResourceComplianceResponse | null>(null);
  const [error, setError] = useState<string>("");
  const [readCount, setReadCount] = useState<number>(0);
  const [selected, setSelected] = useState<string>("");
  const [rows, setRows] = useState<
    Record<string, DataSecurityComplianceSetting>
  >({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [switchErrors, setSwitchErrors] = useState<Record<string, string>>({});
  const [settingsError, setSettingsError] = useState<string>("");

  useEffect(() => {
    let isCurrent: boolean = true;

    setError("");

    DataSecurityApi.getResourceCompliance({ kind: props.kind, id: modelId })
      .then((answer: DataSecurityResourceComplianceResponse) => {
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
  }, [props.kind, modelId.toString(), readCount]);

  // The settings rows of where this resource's switches are set.
  const settingsResource: { kind: DataStoreResourceKind; id: string } | null =
    compliance
      ? compliance.complianceOwner
        ? {
            kind: compliance.complianceOwner.kind,
            id: compliance.complianceOwner.id,
          }
        : { kind: compliance.kind, id: compliance.id }
      : null;
  const settingsKey: string = settingsResource
    ? `${settingsResource.kind}:${settingsResource.id}`
    : "";

  useEffect(() => {
    if (!settingsResource || !projectId || compliance?.complianceOwner) {
      setRows({});
      return () => {};
    }

    let isCurrent: boolean = true;

    setSettingsError("");

    ModelAPI.getList<DataSecurityComplianceSetting>({
      modelType: DataSecurityComplianceSetting,
      query: {
        projectId,
        resourceType: settingsResource.kind,
        resourceId: new ObjectID(settingsResource.id),
      },
      limit: 1000,
      skip: 0,
      select: {
        _id: true,
        framework: true,
        requirement: true,
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
              getComplianceSwitchKey({
                framework: row.framework,
                requirement: row.requirement,
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
  }, [settingsKey, readCount]);

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
  const isSetElsewhere: boolean = Boolean(compliance?.complianceOwner);
  const lockedReason: string | undefined = isSetElsewhere
    ? translator.translateText(
        SET_ON_OWNER_SENTENCES[compliance!.complianceOwner!.kind] || "",
      )
    : !createGate.isAllowed
      ? createGate.disabledReason
      : !updateGate.isAllowed
        ? updateGate.disabledReason
        : undefined;

  // A switch flipped: its row made or changed, then the scores read again.
  const flip: (
    switchKey: ComplianceSwitchKey,
    isOn: boolean,
  ) => Promise<void> = async (
    switchKey: ComplianceSwitchKey,
    isOn: boolean,
  ): Promise<void> => {
    const key: string = getComplianceSwitchKey(switchKey);

    if (!projectId || !settingsResource || lockedReason || saving[key]) {
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
        row.resourceType = settingsResource.kind;
        row.resourceId = new ObjectID(settingsResource.id);
        row.framework = switchKey.framework;

        if (switchKey.requirement) {
          row.requirement = switchKey.requirement;
        }

        row.isEnabled = isOn;

        await ModelAPI.create<DataSecurityComplianceSetting>({
          model: row,
          modelType: DataSecurityComplianceSetting,
        });
      }

      Toast.success(translator.translateText(CHANGES_SAVED) || CHANGES_SAVED);
      setReadCount((count: number): number => {
        return count + 1;
      });
    } catch (err) {
      setSwitchErrors((current: Record<string, string>) => {
        return { ...current, [key]: API.getFriendlyMessage(err) };
      });
    }

    setSaving((current: Record<string, boolean>) => {
      return { ...current, [key]: false };
    });
  };

  const title: string = translationKey("Compliance");
  const description: string = RESOURCE_COMPLIANCE_DESCRIPTIONS[props.kind];

  if (error) {
    return (
      <Card title={title} description={description}>
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
      <Card title={title} description={description}>
        <CardListSkeleton
          count={3}
          gridClassName="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
        />
      </Card>
    );
  }

  const ownerNotice: ReactElement = compliance.complianceOwner ? (
    <OwnerNotice
      kind={compliance.complianceOwner.kind}
      id={compliance.complianceOwner.id}
      name={compliance.complianceOwner.name}
    />
  ) : (
    <></>
  );

  if (compliance.storeCount === 0) {
    return (
      <Fragment>
        {ownerNotice}
        <Card title={title} description={description}>
          <TableEmptyState
            kind={TableEmptyStateKind.Empty}
            icon={IconProp.ClipboardDocumentCheck}
            title="Nothing to score yet"
            description="Frameworks are scored once Data Security has read a data store here."
            isCompact={true}
          />
        </Card>
      </Fragment>
    );
  }

  const { applying, turnedOff, notInScope } = splitResourceFrameworks(
    compliance.frameworks,
  );
  const framework: DataSecurityResourceComplianceFramework | undefined =
    applying.find((item: DataSecurityResourceComplianceFramework): boolean => {
      return item.framework === selected;
    });
  const scope: string = framework
    ? COMPLIANCE_FRAMEWORK_INFO[framework.framework]?.scope ||
      framework.scope ||
      ""
    : "";
  const frameworkSwitch: ComplianceSwitchKey | null = framework
    ? { framework: framework.framework }
    : null;
  const foldItems: Array<FoldedSectionItem> = [
    ...turnedOff.map(
      (item: DataSecurityResourceComplianceFramework): FoldedSectionItem => {
        return {
          key: item.framework,
          title: item.framework,
          isSet: true,
          value: "Off",
          translateValue: true,
        };
      },
    ),
    ...notInScope.map(
      (item: DataSecurityResourceComplianceFramework): FoldedSectionItem => {
        return { key: item.framework, title: item.framework, isSet: false };
      },
    ),
  ];

  return (
    <div data-testid={RESOURCE_COMPLIANCE_TEST_ID}>
      {ownerNotice}

      <Card title={title} description={description}>
        {applying.length > 0 ? (
          <div
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
            data-testid={`${RESOURCE_COMPLIANCE_TEST_ID}-frameworks`}
          >
            {applying.map(
              (item: DataSecurityResourceComplianceFramework): ReactElement => {
                return (
                  <ComplianceFrameworkTile
                    key={item.framework}
                    framework={item}
                    isSelected={item.framework === selected}
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
            icon={IconProp.ClipboardDocumentCheck}
            title="No framework applies here"
            description="None of these data stores holds data a framework protects, or every framework that would apply is turned off below."
            isCompact={true}
          />
        )}
      </Card>

      {framework && frameworkSwitch ? (
        <Card
          title={
            translator.translateText(framework.fullName) || framework.fullName
          }
          description={translator.translateText(scope) || scope}
          buttons={getTableHeaderButtons([
            {
              title: "Export CSV",
              icon: IconProp.Download,
              buttonStyle: ButtonStyleType.NORMAL,
              onClick: () => {
                downloadFrameworkReportCsv(framework);
              },
            },
            {
              title: "Export JSON",
              icon: IconProp.Download,
              buttonStyle: ButtonStyleType.OUTLINE,
              onClick: () => {
                downloadFrameworkReportJson(framework);
              },
            },
          ])}
        >
          <div className="space-y-4">
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
                  {
                    one: "{{count}} store in scope",
                    other: "{{count}} stores in scope",
                  },
                  framework.storesInScope,
                )}
              </div>
              <div className="text-sm text-gray-600">
                {translator.translatePlural(
                  {
                    one: "{{count}} requirement failing",
                    other: "{{count}} requirements failing",
                  },
                  getFailingRequirementCount(framework),
                )}
              </div>
            </div>

            <div
              data-testid={`${RESOURCE_COMPLIANCE_TEST_ID}-framework-switch`}
            >
              <Toggle
                title={APPLIES_LABEL}
                description={APPLIES_DESCRIPTION}
                value={getAppliesSwitchState(framework, frameworkSwitch)}
                disabled={
                  Boolean(lockedReason) ||
                  saving[getComplianceSwitchKey(frameworkSwitch)]
                }
                tooltip={lockedReason}
                isTooltipTranslated={true}
                error={switchErrors[getComplianceSwitchKey(frameworkSwitch)]}
                onChange={(isOn: boolean): void => {
                  void flip(frameworkSwitch, isOn);
                }}
                dataTestId={`${RESOURCE_COMPLIANCE_TEST_ID}-applies-${framework.framework}`}
              />
            </div>

            {settingsError ? (
              <ErrorMessage
                message={settingsError}
                whatFailed={translator.translateText(SETTINGS_READ_FAILED)}
              />
            ) : (
              <></>
            )}

            <LocalTable<ComplianceRequirementResult>
              id="resource-compliance-requirements"
              data={framework.requirements}
              singularLabel="Requirement"
              pluralLabel="Requirements"
              columns={[
                {
                  key: "requirement",
                  title: "Requirement",
                  type: FieldType.Element,
                  disableSort: true,
                  wrapContent: true,
                  wrapMaxWidthClassName: "max-w-md",
                  getElement: (
                    row: ComplianceRequirementResult,
                  ): ReactElement => {
                    return (
                      <div className="min-w-[12rem] text-sm font-medium text-gray-900">
                        <span className="me-2 font-mono text-xs text-gray-500">
                          {row.requirement}
                        </span>
                        <span>
                          {translator.translateText(row.title) || row.title}
                        </span>
                      </div>
                    );
                  },
                },
                {
                  key: "status",
                  title: "Status",
                  type: FieldType.Element,
                  disableSort: true,
                  getElement: (
                    row: ComplianceRequirementResult,
                  ): ReactElement => {
                    return (
                      <Pill
                        text={row.status}
                        tone={
                          REQUIREMENT_STATUS_TONES[row.status] ||
                          PillTone.Neutral
                        }
                      />
                    );
                  },
                },
                {
                  key: "failingIssueCount",
                  title: "Open Issues",
                  type: FieldType.Element,
                  disableSort: true,
                  getElement: (
                    row: ComplianceRequirementResult,
                  ): ReactElement => {
                    const route: Route | null = getResourceDataSecurityRoute(
                      props.kind,
                      modelId,
                    );

                    if (
                      row.failingIssueCount <= 0 ||
                      row.checkIds.length === 0 ||
                      !route
                    ) {
                      return <TableEmptyValue />;
                    }

                    return (
                      <AppLink
                        className="whitespace-nowrap text-sm font-medium text-indigo-600 hover:underline"
                        to={route.addQueryParams(
                          TableFilterUrlState.getLinkQueryParams(
                            RESOURCE_DATA_SECURITY_ISSUES_TABLE_ID,
                            { filter: { checkId: row.checkIds } },
                          ),
                        )}
                      >
                        {translator.translatePlural(
                          OPEN_ISSUES,
                          row.failingIssueCount,
                        )}
                      </AppLink>
                    );
                  },
                },
                {
                  key: "checkIds",
                  title: "Applies Here",
                  type: FieldType.Element,
                  disableSort: true,
                  getElement: (
                    row: ComplianceRequirementResult,
                  ): ReactElement => {
                    const rowSwitch: ComplianceSwitchKey = {
                      framework: framework.framework,
                      requirement: row.requirement,
                    };
                    const key: string = getComplianceSwitchKey(rowSwitch);

                    return (
                      <Toggle
                        value={getAppliesSwitchState(framework, rowSwitch)}
                        disabled={Boolean(lockedReason) || saving[key]}
                        tooltip={lockedReason}
                        isTooltipTranslated={true}
                        error={switchErrors[key]}
                        ariaLabel={translator.translateTemplate(
                          REQUIREMENT_APPLIES_LABEL,
                          { requirement: row.requirement },
                        )}
                        isAriaLabelTranslated={true}
                        onChange={(isOn: boolean): void => {
                          void flip(rowSwitch, isOn);
                        }}
                        dataTestId={`${RESOURCE_COMPLIANCE_TEST_ID}-applies-${framework.framework}-${row.requirement}`}
                      />
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

      {foldItems.length > 0 ? (
        <FoldedSection
          title="Turned Off and Not in Scope"
          icon={IconProp.AdjustmentHorizontal}
          description="Frameworks turned off here, and the ones none of these data stores holds data for."
          items={foldItems}
          isElevated={true}
          dataTestId={`${RESOURCE_COMPLIANCE_TEST_ID}-fold`}
        >
          <ul className="divide-y divide-gray-100">
            {turnedOff.map(
              (item: DataSecurityResourceComplianceFramework): ReactElement => {
                const itemSwitch: ComplianceSwitchKey = {
                  framework: item.framework,
                };
                const key: string = getComplianceSwitchKey(itemSwitch);

                return (
                  <li
                    key={item.framework}
                    className="px-5 py-4 md:px-6"
                    data-testid={`${RESOURCE_COMPLIANCE_TEST_ID}-off-${item.framework}`}
                  >
                    <Toggle
                      title={item.framework}
                      description={
                        translator.translateText(item.fullName) || item.fullName
                      }
                      value={false}
                      disabled={Boolean(lockedReason) || saving[key]}
                      tooltip={lockedReason}
                      isTooltipTranslated={true}
                      error={switchErrors[key]}
                      onChange={(isOn: boolean): void => {
                        void flip(itemSwitch, isOn);
                      }}
                      dataTestId={`${RESOURCE_COMPLIANCE_TEST_ID}-applies-${item.framework}`}
                    />
                  </li>
                );
              },
            )}
            {notInScope.map(
              (item: DataSecurityResourceComplianceFramework): ReactElement => {
                const itemScope: string =
                  COMPLIANCE_FRAMEWORK_INFO[item.framework]?.scope ||
                  item.scope ||
                  "";

                return (
                  <li
                    key={item.framework}
                    className="px-5 py-4 md:px-6"
                    data-testid={`${RESOURCE_COMPLIANCE_TEST_ID}-out-of-scope-${item.framework}`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">
                        {item.framework}
                      </span>
                      <Pill text="Not in scope" tone={PillTone.Neutral} />
                    </div>
                    <p className="mt-1 text-sm text-gray-500">
                      {translator.translateText(itemScope) || itemScope}
                    </p>
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

/*
 * Where a database's switches are: the cluster or container host it runs
 * on, named and linked when the reader may open it.
 */
const OwnerNotice: FunctionComponent<{
  kind: DataStoreResourceKind;
  id: string;
  name: string;
}> = (props: {
  kind: DataStoreResourceKind;
  id: string;
  name: string;
}): ReactElement => {
  const route: Route | null = getResourceComplianceRoute(props.kind, props.id);
  const linkClassName: string =
    "font-medium text-indigo-600 hover:text-indigo-700 hover:underline";

  return (
    <p
      className="mb-4 rounded-md border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700"
      data-testid={`${RESOURCE_COMPLIANCE_TEST_ID}-owner`}
    >
      <TranslatedSentence
        template={
          OWNER_NOTICE_TEMPLATES[props.kind] ||
          OWNER_NOTICE_TEMPLATES[DataStoreResourceKind.KubernetesCluster]!
        }
        slots={{
          name:
            route && props.name ? (
              <AppLink to={route} className={linkClassName}>
                <span>{props.name}</span>
              </AppLink>
            ) : (
              <span className="font-medium">{props.name || props.id}</span>
            ),
        }}
      />
    </p>
  );
};

export default ResourceCompliancePage;
