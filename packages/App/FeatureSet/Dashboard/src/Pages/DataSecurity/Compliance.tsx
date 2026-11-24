import PageComponentProps from "../PageComponentProps";
import CardListSkeleton from "Common/UI/Components/Skeleton/CardListSkeleton";
import AppLink from "../../Components/AppLink/AppLink";
import {
  downloadFrameworkReportCsv,
  downloadFrameworkReportJson,
} from "../../Components/DataSecurity/ComplianceExport";
import ComplianceFrameworkTile, {
  NOT_EVALUATED,
  REQUIREMENT_STATUS_TONES,
  STORES_TURNED_OFF,
  formatComplianceScore,
  getComplianceScoreClassName,
  getFailingRequirementCount,
} from "../../Components/DataSecurity/ComplianceFrameworkTile";
import DataSecurityApi from "../../Components/DataSecurity/DataSecurityApi";
import {
  getAuditEvidenceRoute,
  getIssueListRoute,
} from "../../Components/DataSecurity/IssueListRoute";
import RecordOfProcessingCard from "../../Components/DataSecurity/RecordOfProcessingCard";
import { ComplianceTurnedOffList } from "../../Components/ResourceDataSecurity/ComplianceTurnedOffNote";
import { getTurnedOffEntries } from "../../Components/ResourceDataSecurity/ResourceComplianceModel";
import { COMPLIANCE_FRAMEWORK_INFO } from "Common/Types/DataSecurity/ComplianceFramework";
import {
  DataSecurityComplianceFramework,
  DataSecurityComplianceResponse,
  DataSecurityComplianceTurnedOff,
} from "Common/Types/DataSecurity/DataSecurityApiTypes";
import { ComplianceRequirementResult } from "Common/Types/DataSecurity/ComplianceRequirementCatalog";
import {
  DataSecurityCheckInfo,
  getDataSecurityCheck,
} from "Common/Types/DataSecurity/DataSecurityCheckCatalog";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import LocalTable from "Common/UI/Components/Table/LocalTable";
import TableEmptyState, {
  TableEmptyStateKind,
} from "Common/UI/Components/Table/TableEmptyState";
import { getTableHeaderButtons } from "Common/UI/Components/Table/TableHeaderControls";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
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
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";

/*
 * HOW DOES EACH FRAMEWORK STAND?
 *
 * Every framework Data Security reports on, scored from the open issues
 * on the stores in its scope (ComplianceRequirementCatalog): a requirement
 * passes while no open issue of its checks sits on a store in scope, fails
 * while one does, and is not evaluated until a store in scope was read.
 * The score is the share of evaluated requirements that pass.
 *
 * Picking a framework lists every requirement with where it stands and
 * the open issues behind it - a link to Issues, narrowed to its checks -
 * opens its audit evidence (#10375), and exports the framework's report
 * as CSV or JSON for an auditor.
 *
 * Under them, the GDPR record of processing: every store that holds
 * personal data, the ones OneUptime keeps for the project's security
 * among them, exported as CSV or JSON (RecordOfProcessingCard).
 */

const OPEN_ISSUES: PluralTemplate = {
  one: "{{count}} open issue",
  other: "{{count}} open issues",
};

const MORE_CHECKS: PluralTemplate = {
  one: "+{{count}} more",
  other: "+{{count}} more",
};

const MET_BY_INVENTORY: string = translationKey(
  "Met by Data Security itself once every store in scope is read.",
);

const SCORE_LABEL: string = translationKey("Score");

const TURNED_OFF_ON_RESOURCES: string = translationKey(
  "Turned Off for the Whole Framework",
);

// The checks a requirement's row names before "+2 more".
const CHECKS_SHOWN: number = 2;

const RequirementsTable: FunctionComponent<{
  framework: DataSecurityComplianceFramework;
}> = (props: { framework: DataSecurityComplianceFramework }): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <LocalTable<ComplianceRequirementResult>
      id="data-security-compliance-requirements"
      data={props.framework.requirements}
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
          getElement: (row: ComplianceRequirementResult): ReactElement => {
            return (
              <div className="min-w-[12rem]">
                <div className="text-sm font-medium text-gray-900">
                  <span className="me-2 font-mono text-xs text-gray-500">
                    {row.requirement}
                  </span>
                  <span>
                    {translator.translateText(row.title) || row.title}
                  </span>
                </div>
              </div>
            );
          },
        },
        {
          key: "status",
          title: "Status",
          type: FieldType.Element,
          disableSort: true,
          // The resources that turned it off, and why, beside it (#9629).
          wrapContent: true,
          wrapMaxWidthClassName: "max-w-xs",
          getElement: (row: ComplianceRequirementResult): ReactElement => {
            const turnedOff: Array<DataSecurityComplianceTurnedOff> =
              getTurnedOffEntries(props.framework, row.requirement);

            return (
              <div className="min-w-[8rem] space-y-2">
                <Pill
                  text={row.status}
                  tone={
                    REQUIREMENT_STATUS_TONES[row.status] || PillTone.Neutral
                  }
                />
                {turnedOff.length > 0 ? (
                  <ComplianceTurnedOffList
                    entries={turnedOff}
                    dataTestId={`data-security-compliance-turned-off-${row.requirement}`}
                  />
                ) : (
                  <></>
                )}
              </div>
            );
          },
        },
        {
          key: "checkIds",
          title: "Checks",
          type: FieldType.Element,
          disableSort: true,
          hideOnMobile: true,
          wrapContent: true,
          wrapMaxWidthClassName: "max-w-sm",
          getElement: (row: ComplianceRequirementResult): ReactElement => {
            const checks: Array<DataSecurityCheckInfo> = row.checkIds
              .map((checkId: string): DataSecurityCheckInfo | undefined => {
                return getDataSecurityCheck(checkId);
              })
              .filter(
                (
                  check: DataSecurityCheckInfo | undefined,
                ): check is DataSecurityCheckInfo => {
                  return Boolean(check);
                },
              );

            if (checks.length === 0) {
              return (
                <span className="text-xs text-gray-500">
                  {translator.translateText(MET_BY_INVENTORY)}
                </span>
              );
            }

            const hidden: number = checks.length - CHECKS_SHOWN;

            return (
              <ul className="space-y-0.5 text-xs text-gray-600">
                {checks
                  .slice(0, CHECKS_SHOWN)
                  .map((check: DataSecurityCheckInfo): ReactElement => {
                    return (
                      <li key={check.id}>
                        {translator.translateText(check.title) || check.title}
                      </li>
                    );
                  })}
                {hidden > 0 ? (
                  <li
                    className="text-gray-500"
                    title={checks
                      .slice(CHECKS_SHOWN)
                      .map((check: DataSecurityCheckInfo): string => {
                        return (
                          translator.translateText(check.title) || check.title
                        );
                      })
                      .join("\n")}
                  >
                    {translator.translatePlural(MORE_CHECKS, hidden)}
                  </li>
                ) : (
                  <></>
                )}
              </ul>
            );
          },
        },
        {
          key: "failingIssueCount",
          title: "Open Issues",
          type: FieldType.Element,
          disableSort: true,
          getElement: (row: ComplianceRequirementResult): ReactElement => {
            if (row.failingIssueCount <= 0 || row.checkIds.length === 0) {
              return <TableEmptyValue />;
            }

            return (
              <AppLink
                className="whitespace-nowrap text-sm font-medium text-indigo-600 hover:underline"
                to={getIssueListRoute({ checkIds: row.checkIds })}
              >
                {translator.translatePlural(OPEN_ISSUES, row.failingIssueCount)}
              </AppLink>
            );
          },
        },
      ]}
    />
  );
};

const DataSecurityCompliancePage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [frameworks, setFrameworks] =
    useState<Array<DataSecurityComplianceFramework> | null>(null);
  const [error, setError] = useState<string>("");
  const [readCount, setReadCount] = useState<number>(0);
  const [selected, setSelected] = useState<string>("");

  useEffect(() => {
    let isCurrent: boolean = true;

    setError("");

    DataSecurityApi.getCompliance()
      .then((response: DataSecurityComplianceResponse) => {
        if (isCurrent) {
          setFrameworks(response.frameworks || []);
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
  }, [readCount]);

  const title: string = translationKey("Compliance");
  const description: string = translationKey(
    "How each framework stands, scored from the open issues on the stores in its scope. Pick one to see every requirement.",
  );

  /*
   * The record of processing comes last, whatever the frameworks say: a
   * project nothing was scored for yet may still keep personal data - the
   * security events, network flows and address vault OneUptime declares
   * (#10398).
   */
  if (error) {
    return (
      <>
        <Card title={title} description={description}>
          <ErrorMessage
            message={error}
            onRefreshClick={() => {
              setFrameworks(null);
              setReadCount((count: number): number => {
                return count + 1;
              });
            }}
          />
        </Card>
        <RecordOfProcessingCard />
      </>
    );
  }

  if (!frameworks) {
    return (
      <>
        <Card title={title} description={description}>
          <CardListSkeleton
            count={3}
            gridClassName="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
          />
        </Card>
        <RecordOfProcessingCard />
      </>
    );
  }

  if (frameworks.length === 0) {
    return (
      <>
        <Card title={title} description={description}>
          <TableEmptyState
            kind={TableEmptyStateKind.Empty}
            icon={IconProp.ShieldCheck}
            title="Nothing to score yet"
            description="Frameworks are scored once Data Security has read a store."
            isCompact={true}
          />
        </Card>
        <RecordOfProcessingCard />
      </>
    );
  }

  const framework: DataSecurityComplianceFramework | undefined =
    frameworks.find((item: DataSecurityComplianceFramework): boolean => {
      return item.framework === selected;
    });

  const scope: string = framework
    ? COMPLIANCE_FRAMEWORK_INFO[framework.framework]?.scope ||
      framework.scope ||
      ""
    : "";
  const wholeFrameworkTurnedOff: Array<DataSecurityComplianceTurnedOff> =
    framework ? getTurnedOffEntries(framework, null) : [];

  return (
    <>
      <Card title={title} description={description}>
        <div
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
          data-testid="data-security-compliance-frameworks"
        >
          {frameworks.map(
            (item: DataSecurityComplianceFramework): ReactElement => {
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
      </Card>

      {framework ? (
        <Card
          title={
            translator.translateText(framework.fullName) || framework.fullName
          }
          description={translator.translateText(scope) || scope}
          /*
           * Its audit evidence in sight (#10375) - what an auditor reads
           * under each requirement - and the report's CSV and JSON in the
           * header's ⋯.
           */
          buttons={getTableHeaderButtons([
            {
              title: "Audit Evidence",
              icon: IconProp.DocumentText,
              buttonStyle: ButtonStyleType.NORMAL,
              onClick: () => {
                Navigation.navigate(getAuditEvidenceRoute(framework.framework));
              },
            },
            {
              title: "Export CSV",
              icon: IconProp.Download,
              buttonStyle: ButtonStyleType.OUTLINE,
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
              {/*
               * Stores the framework would cover, left out because the
               * cluster, database or service they are on turned it off
               * there (#9555): said, so an auditor knows the score's
               * scope.
               */}
              {(framework.storesTurnedOff || 0) > 0 ? (
                <div
                  className="text-sm text-gray-600"
                  data-testid="data-security-compliance-stores-turned-off"
                >
                  {translator.translatePlural(
                    STORES_TURNED_OFF,
                    framework.storesTurnedOff,
                  )}
                </div>
              ) : (
                <></>
              )}
            </div>
            {/*
             * The resources that turned the whole framework off, each with
             * who, when and why (#9629): what an auditor asks to see
             * justified.
             */}
            {wholeFrameworkTurnedOff.length > 0 ? (
              <div
                className="rounded-md border border-gray-200 bg-gray-50 px-4 py-3"
                data-testid="data-security-compliance-framework-turned-off"
              >
                <h4 className="mb-2 text-sm font-medium text-gray-900">
                  {translator.translateText(TURNED_OFF_ON_RESOURCES)}
                </h4>
                <ComplianceTurnedOffList
                  entries={wholeFrameworkTurnedOff}
                  dataTestId="data-security-compliance-framework-turned-off-list"
                />
              </div>
            ) : (
              <></>
            )}
            <RequirementsTable framework={framework} />
          </div>
        </Card>
      ) : (
        <></>
      )}

      <RecordOfProcessingCard />
    </>
  );
};

export default DataSecurityCompliancePage;
