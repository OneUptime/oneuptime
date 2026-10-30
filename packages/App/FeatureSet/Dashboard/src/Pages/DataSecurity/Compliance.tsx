import PageComponentProps from "../PageComponentProps";
import AppLink from "../../Components/AppLink/AppLink";
import {
  downloadFrameworkReportCsv,
  downloadFrameworkReportJson,
} from "../../Components/DataSecurity/ComplianceExport";
import ComplianceFrameworkTile, {
  NOT_EVALUATED,
  formatComplianceScore,
  getComplianceScoreClassName,
  getFailingRequirementCount,
} from "../../Components/DataSecurity/ComplianceFrameworkTile";
import DataSecurityApi from "../../Components/DataSecurity/DataSecurityApi";
import { getIssueListRoute } from "../../Components/DataSecurity/IssueListRoute";
import { Gray500, Green500, Red500 } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import { COMPLIANCE_FRAMEWORK_INFO } from "Common/Types/DataSecurity/ComplianceFramework";
import {
  DataSecurityComplianceFramework,
  DataSecurityComplianceResponse,
} from "Common/Types/DataSecurity/DataSecurityApiTypes";
import {
  ComplianceRequirementResult,
  ComplianceRequirementStatus,
} from "Common/Types/DataSecurity/ComplianceRequirementCatalog";
import {
  DataSecurityCheckInfo,
  getDataSecurityCheck,
} from "Common/Types/DataSecurity/DataSecurityCheckCatalog";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Pill from "Common/UI/Components/Pill/Pill";
import LocalTable from "Common/UI/Components/Table/LocalTable";
import TableEmptyState, {
  TableEmptyStateKind,
} from "Common/UI/Components/Table/TableEmptyState";
import { getTableHeaderButtons } from "Common/UI/Components/Table/TableHeaderControls";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
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
 * and exports the framework's report as CSV or JSON for an auditor.
 */

const REQUIREMENT_STATUS_COLOR: Readonly<Record<string, Color>> = {
  [ComplianceRequirementStatus.Passing]: Green500,
  [ComplianceRequirementStatus.Failing]: Red500,
  [ComplianceRequirementStatus.NotEvaluated]: Gray500,
};

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
          getElement: (row: ComplianceRequirementResult): ReactElement => {
            return (
              <Pill
                text={row.status}
                color={REQUIREMENT_STATUS_COLOR[row.status] || Gray500}
              />
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
              return <span className="text-sm text-gray-400">-</span>;
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

  if (error) {
    return (
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
    );
  }

  if (!frameworks) {
    return (
      <Card title={title} description={description}>
        <ComponentLoader />
      </Card>
    );
  }

  if (frameworks.length === 0) {
    return (
      <Card title={title} description={description}>
        <TableEmptyState
          kind={TableEmptyStateKind.Empty}
          icon={IconProp.ShieldCheck}
          title="Nothing to score yet"
          description="Frameworks are scored once Data Security has read a store."
          isCompact={true}
        />
      </Card>
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
          // The CSV in sight, the JSON in the header's ⋯.
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
            <RequirementsTable framework={framework} />
          </div>
        </Card>
      ) : (
        <></>
      )}
    </>
  );
};

export default DataSecurityCompliancePage;
