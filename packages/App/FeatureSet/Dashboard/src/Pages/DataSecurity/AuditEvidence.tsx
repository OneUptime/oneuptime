import PageComponentProps from "../PageComponentProps";
import AppLink from "../../Components/AppLink/AppLink";
import {
  DAYS_TO_FIX,
  DRAFT_AGAIN,
  DRAFT_EVIDENCE,
  EVIDENCE_DESCRIPTION,
  EVIDENCE_DRAFTED,
  EVIDENCE_TITLE,
  EXPORT_MARKDOWN,
  EXPORT_PDF,
  FRAMEWORK,
  HOURS_TO_FIX,
  ISSUE_HISTORY,
  ISSUE_HISTORY_DESCRIPTION,
  LAST_DAYS,
  NO_ISSUE_HISTORY,
  NO_ISSUE_HISTORY_TITLE,
  NO_PARAGRAPH_YET,
  NOT_LEGAL_ADVICE,
  PERIOD,
  REQUIREMENTS_FAILING,
  STORES_IN_SCOPE,
  UNSAVED_EVIDENCE,
} from "../../Components/DataSecurity/ComplianceDraftsCopy";
import { ComplianceFactList } from "../../Components/DataSecurity/ComplianceFacts";
import {
  NOT_EVALUATED,
  REQUIREMENT_STATUS_TONES,
  formatComplianceScore,
  getComplianceScoreClassName,
} from "../../Components/DataSecurity/ComplianceFrameworkTile";
import CompliancePaperSection from "../../Components/DataSecurity/CompliancePaperSection";
import {
  PaperworkExportNames,
  downloadMarkdown,
  downloadMarkdownPdf,
  getAuditEvidenceExportNames,
  getAuditEvidenceMarkdown,
} from "../../Components/DataSecurity/CompliancePaperworkExport";
import DataSecurityApi from "../../Components/DataSecurity/DataSecurityApi";
import {
  IssueStatusPill,
  SeverityPill,
} from "../../Components/DataSecurity/DataSecurityPills";
import { getIssueViewRoute } from "../../Components/DataSecurity/IssueListRoute";
import LeaveWithoutSavingQuestion from "../../Components/UnsavedChanges/LeaveWithoutSavingQuestion";
import OneUptimeDate from "Common/Types/Date";
import {
  AUDIT_EVIDENCE_PERIODS,
  AuditEvidenceParagraphSource,
  readAuditEvidencePeriod,
} from "Common/Types/DataSecurity/AuditEvidence";
import ComplianceFramework, {
  ALL_COMPLIANCE_FRAMEWORKS,
} from "Common/Types/DataSecurity/ComplianceFramework";
import { ComplianceRequirementStatus } from "Common/Types/DataSecurity/ComplianceRequirementCatalog";
import {
  DataSecurityAuditEvidenceRequirement,
  DataSecurityAuditEvidenceResponse,
  DataSecurityEvidenceIssue,
} from "Common/Types/DataSecurity/DataSecurityApiTypes";
import { getDataSecurityCheck } from "Common/Types/DataSecurity/DataSecurityCheckCatalog";
import IconProp from "Common/Types/Icon/IconProp";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import ErrorLine from "Common/UI/Components/ErrorMessage/ErrorLine";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import DetailListSkeleton from "Common/UI/Components/Skeleton/DetailListSkeleton";
import LocalTable from "Common/UI/Components/Table/LocalTable";
import TableEmptyState, {
  TableEmptyStateKind,
} from "Common/UI/Components/Table/TableEmptyState";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import { getTableHeaderButtons } from "Common/UI/Components/Table/TableHeaderControls";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import Toast from "Common/UI/Utils/Toast";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useLeaveGuard, { LeavePrompt } from "Common/UI/Utils/UseLeaveGuard";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * A FRAMEWORK'S AUDIT EVIDENCE (#10375), FROM COMPLIANCE.
 *
 * Under each of the framework's requirements, the paragraph an auditor
 * reads - OneUptime AI's draft, or a person's words - and the evidence it
 * rests on, one click away: the stores in scope, how its checks stand, the
 * issues of its checks opened and fixed in the period and how fast, the
 * risks accepted with their reasons and expiry. A requirement with no
 * paragraph shows its evidence as it is. Under them, the issue history the
 * evidence cites. Exported as PDF or Markdown, with the record of
 * processing of the stores in scope and that issue history as appendices.
 *
 * The framework and the period are in the address (?framework=, ?period=),
 * so the page can be linked to - Compliance's Audit Evidence button opens
 * it on the framework picked there. "Not legal advice" is said once.
 */

export const AUDIT_EVIDENCE_TEST_ID: string = "data-security-audit-evidence";

// The framework the address names, or the first one.
export function readEvidenceFramework(
  value: string | null | undefined,
): ComplianceFramework {
  return (
    ALL_COMPLIANCE_FRAMEWORKS.find(
      (framework: ComplianceFramework): boolean => {
        return framework.toLowerCase() === (value || "").trim().toLowerCase();
      },
    ) || ALL_COMPLIANCE_FRAMEWORKS[0]!
  );
}

// How long an issue took to fix, in hours up to two days, in days after.
export function getTimeToFixText(
  hours: number,
  translator: Translator,
): string {
  return hours < 48
    ? translator.translatePlural(HOURS_TO_FIX, Math.max(0, Math.round(hours)))
    : translator.translatePlural(DAYS_TO_FIX, Math.round(hours / 24));
}

const IssueHistoryTable: FunctionComponent<{
  issues: Array<DataSecurityEvidenceIssue>;
}> = (props: { issues: Array<DataSecurityEvidenceIssue> }): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <LocalTable<DataSecurityEvidenceIssue>
      id={`${AUDIT_EVIDENCE_TEST_ID}-issue-history-table`}
      data={props.issues}
      singularLabel="Issue"
      pluralLabel="Issues"
      columns={[
        {
          key: "checkId",
          title: "Check",
          type: FieldType.Element,
          disableSort: true,
          wrapContent: true,
          wrapMaxWidthClassName: "max-w-xs",
          getElement: (issue: DataSecurityEvidenceIssue): ReactElement => {
            const title: string =
              getDataSecurityCheck(issue.checkId)?.title || issue.title;

            return (
              <AppLink
                to={getIssueViewRoute(issue.issueId)}
                className="text-sm font-medium text-indigo-600 hover:underline"
              >
                {translator.translateText(title) || title}
              </AppLink>
            );
          },
        },
        {
          key: "storeName",
          title: "Data Store",
          type: FieldType.Element,
          disableSort: true,
          wrapContent: true,
          wrapMaxWidthClassName: "max-w-[12rem]",
          getElement: (issue: DataSecurityEvidenceIssue): ReactElement => {
            return (
              <span className="text-sm text-gray-900 [overflow-wrap:anywhere]">
                <IsolatedText text={issue.storeName} />
              </span>
            );
          },
        },
        {
          key: "severity",
          title: "Severity",
          type: FieldType.Element,
          disableSort: true,
          hideOnMobile: true,
          getElement: (issue: DataSecurityEvidenceIssue): ReactElement => {
            return <SeverityPill severity={issue.severity} />;
          },
        },
        {
          key: "status",
          title: "Status",
          type: FieldType.Element,
          disableSort: true,
          getElement: (issue: DataSecurityEvidenceIssue): ReactElement => {
            return <IssueStatusPill status={issue.status} />;
          },
        },
        {
          key: "openedAt",
          title: "Opened",
          type: FieldType.Element,
          disableSort: true,
          hideOnMobile: true,
          getElement: (issue: DataSecurityEvidenceIssue): ReactElement => {
            return (
              <span className="whitespace-nowrap text-sm text-gray-700">
                {OneUptimeDate.getDateAsLocalFormattedString(
                  issue.openedAt,
                  true,
                )}
              </span>
            );
          },
        },
        {
          key: "hoursToFix",
          title: "Time to Fix",
          type: FieldType.Element,
          disableSort: true,
          getElement: (issue: DataSecurityEvidenceIssue): ReactElement => {
            if (issue.hoursToFix === undefined || !issue.resolvedAt) {
              return <TableEmptyValue />;
            }

            return (
              <span
                className="whitespace-nowrap text-sm text-gray-700"
                title={OneUptimeDate.getDateAsLocalFormattedString(
                  issue.resolvedAt,
                  true,
                )}
              >
                {getTimeToFixText(issue.hoursToFix, translator)}
              </span>
            );
          },
        },
      ]}
    />
  );
};

const DataSecurityAuditEvidencePage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [framework, setFramework] = useState<ComplianceFramework>(
    readEvidenceFramework(Navigation.getQueryStringByName("framework")),
  );
  const [periodInDays, setPeriodInDays] = useState<number>(
    readAuditEvidencePeriod(
      Number(Navigation.getQueryStringByName("period") || ""),
    ),
  );
  const [evidence, setEvidence] =
    useState<DataSecurityAuditEvidenceResponse | null>(null);
  const [error, setError] = useState<string>("");
  const [readCount, setReadCount] = useState<number>(0);
  const [isDrafting, setIsDrafting] = useState<boolean>(false);
  const [draftError, setDraftError] = useState<string>("");
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const hasUnsaved: boolean = Object.values(editing).some(Boolean);
  const leavePrompt: LeavePrompt = useLeaveGuard(hasUnsaved);

  useEffect(() => {
    let isCurrent: boolean = true;

    setEvidence(null);
    setError("");
    setDraftError("");
    setEditing({});
    Navigation.setQueryString({
      framework: framework,
      period: String(periodInDays),
    });

    DataSecurityApi.getAuditEvidence({ framework, periodInDays })
      .then((read: DataSecurityAuditEvidenceResponse) => {
        if (isCurrent) {
          setEvidence(read);
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
  }, [framework, periodInDays, readCount]);

  const draft: () => Promise<void> = async (): Promise<void> => {
    setIsDrafting(true);
    setDraftError("");

    try {
      setEvidence(
        await DataSecurityApi.draftAuditEvidence({ framework, periodInDays }),
      );
      Toast.success(translator.translateText(EVIDENCE_DRAFTED) || "");
    } catch (err) {
      setDraftError(API.getFriendlyMessage(err));
    } finally {
      setIsDrafting(false);
    }
  };

  const exportAs: (kind: "md" | "pdf") => Promise<void> = async (
    kind: "md" | "pdf",
  ): Promise<void> => {
    if (!evidence) {
      return;
    }

    const exportedAt: Date = new Date();
    const markdown: string = getAuditEvidenceMarkdown({
      evidence,
      exportedAt,
    });
    const names: PaperworkExportNames = getAuditEvidenceExportNames(
      evidence.framework,
    );

    if (kind === "md") {
      downloadMarkdown({ markdown, label: names.fileLabel, exportedAt });
      return;
    }

    setIsExporting(true);

    try {
      await downloadMarkdownPdf({
        title: names.pdfTitle,
        markdown,
        label: names.fileLabel,
        exportedAt,
      });
    } catch (err) {
      Toast.error(API.getFriendlyMessage(err));
    } finally {
      setIsExporting(false);
    }
  };

  const frameworkOptions: Array<DropdownOption> = ALL_COMPLIANCE_FRAMEWORKS.map(
    (item: ComplianceFramework): DropdownOption => {
      // A framework's own name, the same in every language.
      return { value: item, label: item, isUserContent: true };
    },
  );
  const periodOptions: Array<DropdownOption> = AUDIT_EVIDENCE_PERIODS.map(
    (days: number): DropdownOption => {
      return {
        value: String(days),
        label: translator.translatePlural(LAST_DAYS, days),
        isUserContent: true,
        isInPageDirection: true,
      };
    },
  );

  // The PDF in sight - what an auditor is handed - the Markdown in the ⋯.
  const buttons: Array<CardButtonSchema> = evidence
    ? [
        {
          title: EXPORT_PDF,
          icon: IconProp.Download,
          buttonStyle: ButtonStyleType.NORMAL,
          isLoading: isExporting,
          disabled: hasUnsaved,
          onClick: () => {
            void exportAs("pdf");
          },
        },
        {
          title: EXPORT_MARKDOWN,
          icon: IconProp.Download,
          buttonStyle: ButtonStyleType.OUTLINE,
          disabled: hasUnsaved,
          onClick: () => {
            void exportAs("md");
          },
        },
      ]
    : [];

  const failing: number = (evidence?.requirements || []).filter(
    (requirement: DataSecurityAuditEvidenceRequirement): boolean => {
      return requirement.status === ComplianceRequirementStatus.Failing;
    },
  ).length;
  const hasParagraphs: boolean = (evidence?.requirements || []).some(
    (requirement: DataSecurityAuditEvidenceRequirement): boolean => {
      return Boolean(requirement.paragraph);
    },
  );

  let summary: ReactElement = <></>;

  if (error) {
    summary = (
      <ErrorMessage
        message={error}
        onRefreshClick={() => {
          setReadCount((count: number): number => {
            return count + 1;
          });
        }}
      />
    );
  } else if (!evidence) {
    summary = <DetailListSkeleton />;
  } else {
    summary = (
      <div className="space-y-4">
        <div
          className="flex flex-wrap items-baseline gap-x-6 gap-y-1"
          data-testid={`${AUDIT_EVIDENCE_TEST_ID}-summary`}
        >
          <div
            className={`text-2xl font-semibold tabular-nums ${getComplianceScoreClassName(
              evidence.score,
            )}`}
          >
            {evidence.score === null
              ? translator.translateText(NOT_EVALUATED)
              : formatComplianceScore(evidence.score, translator)}
          </div>
          <div className="text-sm text-gray-600">
            {translator.translatePlural(
              STORES_IN_SCOPE,
              evidence.storesInScope,
            )}
          </div>
          <div className="text-sm text-gray-600">
            {translator.translatePlural(REQUIREMENTS_FAILING, failing)}
          </div>
        </div>
        <p className="text-xs text-gray-600">
          {translator.translateText(NOT_LEGAL_ADVICE)}
        </p>
        {draftError ? <ErrorLine message={draftError} /> : <></>}
        {evidence.canDraft ? (
          <div className="flex flex-wrap gap-2">
            <Button
              title={hasParagraphs ? DRAFT_AGAIN : DRAFT_EVIDENCE}
              icon={IconProp.Sparkles}
              buttonStyle={
                hasParagraphs
                  ? ButtonStyleType.OUTLINE
                  : ButtonStyleType.PRIMARY
              }
              isLoading={isDrafting}
              disabled={hasUnsaved}
              dataTestId={`${AUDIT_EVIDENCE_TEST_ID}-draft`}
              onClick={() => {
                void draft();
              }}
            />
          </div>
        ) : (
          <></>
        )}
      </div>
    );
  }

  return (
    <Fragment>
      <Card
        title={translator.translateTemplate(EVIDENCE_TITLE, {
          framework: framework,
        })}
        description={EVIDENCE_DESCRIPTION}
        buttons={getTableHeaderButtons(buttons)}
      >
        <div className="space-y-4" data-testid={AUDIT_EVIDENCE_TEST_ID}>
          <div className="flex flex-wrap items-end gap-4">
            <div className="w-full space-y-1 sm:w-48">
              <span
                className="block text-sm font-medium text-gray-700"
                id={`${AUDIT_EVIDENCE_TEST_ID}-framework-label`}
              >
                {translator.translateText(FRAMEWORK)}
              </span>
              <Dropdown
                options={frameworkOptions}
                value={frameworkOptions.find(
                  (option: DropdownOption): boolean => {
                    return option.value === framework;
                  },
                )}
                ariaLabelledby={`${AUDIT_EVIDENCE_TEST_ID}-framework-label`}
                disabled={hasUnsaved}
                dataTestId={`${AUDIT_EVIDENCE_TEST_ID}-framework`}
                onChange={(
                  value: DropdownValue | Array<DropdownValue> | null,
                ) => {
                  if (typeof value === "string") {
                    setFramework(readEvidenceFramework(value));
                  }
                }}
              />
            </div>
            <div className="w-full space-y-1 sm:w-48">
              <span
                className="block text-sm font-medium text-gray-700"
                id={`${AUDIT_EVIDENCE_TEST_ID}-period-label`}
              >
                {translator.translateText(PERIOD)}
              </span>
              <Dropdown
                options={periodOptions}
                value={periodOptions.find((option: DropdownOption): boolean => {
                  return option.value === String(periodInDays);
                })}
                ariaLabelledby={`${AUDIT_EVIDENCE_TEST_ID}-period-label`}
                disabled={hasUnsaved}
                dataTestId={`${AUDIT_EVIDENCE_TEST_ID}-period`}
                onChange={(
                  value: DropdownValue | Array<DropdownValue> | null,
                ) => {
                  setPeriodInDays(readAuditEvidencePeriod(Number(value)));
                }}
              />
            </div>
          </div>
          {summary}
        </div>
      </Card>

      {evidence ? (
        <Card>
          <div
            className="divide-y divide-gray-100"
            data-testid={`${AUDIT_EVIDENCE_TEST_ID}-document`}
          >
            {evidence.requirements.map(
              (
                requirement: DataSecurityAuditEvidenceRequirement,
              ): ReactElement => {
                const paragraph: DataSecurityAuditEvidenceRequirement["paragraph"] =
                  requirement.paragraph;
                const title: string =
                  translator.translateText(requirement.title) ||
                  requirement.title;

                return (
                  <CompliancePaperSection
                    key={`${evidence.framework}:${evidence.periodInDays}:${requirement.requirement}:${paragraph?.editedAt || ""}:${paragraph?.draftedAt || ""}`}
                    id={`${AUDIT_EVIDENCE_TEST_ID}-${requirement.requirement.replace(/[^A-Za-z0-9]+/g, "-")}`}
                    heading={`${requirement.requirement} · ${title}`}
                    aside={
                      <Pill
                        text={requirement.status}
                        tone={
                          REQUIREMENT_STATUS_TONES[requirement.status] ||
                          PillTone.Neutral
                        }
                      />
                    }
                    words={paragraph?.text || ""}
                    isMarkdown={false}
                    isEdited={
                      paragraph?.source === AuditEvidenceParagraphSource.Edited
                    }
                    draftedAt={paragraph?.draftedAt}
                    editedAt={paragraph?.editedAt}
                    editorName={
                      paragraph?.editedByUserId
                        ? evidence.editors[paragraph.editedByUserId]
                        : undefined
                    }
                    isStale={requirement.isParagraphStale}
                    facts={requirement.facts}
                    areFactsEvidence={true}
                    emptyElement={
                      <div className="space-y-2">
                        <p className="text-sm text-gray-500">
                          {translator.translateText(NO_PARAGRAPH_YET)}
                        </p>
                        <ComplianceFactList
                          facts={requirement.facts}
                          dataTestId={`${AUDIT_EVIDENCE_TEST_ID}-${requirement.requirement.replace(/[^A-Za-z0-9]+/g, "-")}-evidence`}
                        />
                      </div>
                    }
                    canEdit={evidence.canEdit}
                    onSave={async (text: string): Promise<void> => {
                      setEvidence(
                        await DataSecurityApi.editAuditEvidence({
                          framework: evidence.framework,
                          periodInDays: evidence.periodInDays,
                          requirement: requirement.requirement,
                          text,
                        }),
                      );
                    }}
                    onEditingChange={(isEditing: boolean) => {
                      setEditing((current: Record<string, boolean>) => {
                        return current[requirement.requirement] === isEditing
                          ? current
                          : {
                              ...current,
                              [requirement.requirement]: isEditing,
                            };
                      });
                    }}
                  />
                );
              },
            )}
          </div>
        </Card>
      ) : (
        <></>
      )}

      {evidence ? (
        <Card
          title={ISSUE_HISTORY}
          description={translator.translatePlural(
            ISSUE_HISTORY_DESCRIPTION,
            evidence.issueHistory.length,
          )}
        >
          {evidence.issueHistory.length > 0 ? (
            <div data-testid={`${AUDIT_EVIDENCE_TEST_ID}-issue-history`}>
              <IssueHistoryTable issues={evidence.issueHistory} />
            </div>
          ) : (
            <TableEmptyState
              kind={TableEmptyStateKind.Empty}
              icon={IconProp.CheckCircle}
              title={NO_ISSUE_HISTORY_TITLE}
              description={NO_ISSUE_HISTORY}
              isCompact={true}
            />
          )}
        </Card>
      ) : (
        <></>
      )}

      <LeaveWithoutSavingQuestion
        prompt={leavePrompt}
        description={UNSAVED_EVIDENCE}
      />
    </Fragment>
  );
};

export default DataSecurityAuditEvidencePage;
