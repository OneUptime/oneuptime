import InvestigationCitationChip from "./InvestigationCitationChip";
import InvestigationEvidenceList, {
  EvidenceFocusRequest,
} from "./InvestigationEvidenceList";
import InvestigationReferenceLink from "./InvestigationReferenceLink";
import {
  InvestigationReportSubjectType,
  getEventReferenceKey,
} from "./InvestigationReportData";
import {
  InvestigationEventReference,
  InvestigationEvidenceItem,
} from "Common/Types/AI/InvestigationEvidence";
import IconProp from "Common/Types/Icon/IconProp";
import {
  InvestigationEvidenceCheckedEntry,
  InvestigationReportSection,
  InvestigationReportSectionKind,
  ParsedInvestigationReport,
} from "Common/Utils/AI/InvestigationReport";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import Icon from "Common/UI/Components/Icon/Icon";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import type {
  MarkdownEventReference,
  MarkdownInlineReferenceRenderers,
} from "Common/UI/Components/Markdown.tsx/InlineReferences";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useId,
  useMemo,
  useState,
} from "react";

export interface ComponentProps {
  // The report exactly as published; "Copy report" copies this.
  analysisMarkdown: string;
  report: ParsedInvestigationReport;
  analysisTldr: string | null;
  evidence: Array<InvestigationEvidenceItem>;
  references: Array<InvestigationEventReference>;
  subjectType: InvestigationReportSubjectType;
  subjectId: string;
  runId: string | null;
}

interface SectionAppearance {
  icon: IconProp;
  isCallout: boolean;
}

function getSectionAppearance(
  kind: InvestigationReportSectionKind,
): SectionAppearance {
  switch (kind) {
    case InvestigationReportSectionKind.RootCause:
      return { icon: IconProp.LightBulb, isCallout: true };
    case InvestigationReportSectionKind.Evidence:
      return { icon: IconProp.MagnifyingGlass, isCallout: false };
    case InvestigationReportSectionKind.NextSteps:
      return { icon: IconProp.ClipboardDocumentList, isCallout: false };
    default:
      return { icon: IconProp.DocumentText, isCallout: false };
  }
}

/*
 * A completed AI investigation, laid out for a responder: the summary first,
 * then the report section by section, then every query the AI ran.
 *
 * The report is untrusted model output. Every piece of it renders through
 * MarkdownViewer in safeMode; the only interactive elements inside the prose
 * are citation chips for citations the server recorded and links to
 * incidents/alerts the server resolved for this viewer.
 */
const InvestigationReportView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const idPrefix: string = useId();
  const [focusRequest, setFocusRequest] = useState<EvidenceFocusRequest | null>(
    null,
  );
  const report: ParsedInvestigationReport = props.report;
  const legacyEntries: Array<InvestigationEvidenceCheckedEntry> =
    report.evidenceChecked;

  const citationLabels: Map<string, string> = useMemo((): Map<
    string,
    string
  > => {
    const labels: Map<string, string> = new Map<string, string>();

    if (props.evidence.length > 0) {
      for (const item of props.evidence) {
        labels.set(item.citationId, item.label);
      }
    } else {
      for (const entry of legacyEntries) {
        labels.set(entry.citationId, entry.label);
      }
    }

    return labels;
  }, [legacyEntries, props.evidence]);

  const referencesByKey: Map<string, InvestigationEventReference> =
    useMemo((): Map<string, InvestigationEventReference> => {
      const map: Map<string, InvestigationEventReference> = new Map<
        string,
        InvestigationEventReference
      >();

      for (const reference of props.references) {
        map.set(
          getEventReferenceKey(reference.kind, reference.number),
          reference,
        );
      }

      return map;
    }, [props.references]);

  const focusCitation: (citationId: string) => void = useCallback(
    (citationId: string): void => {
      setFocusRequest(
        (previous: EvidenceFocusRequest | null): EvidenceFocusRequest => {
          return {
            citationId,
            requestId: (previous?.requestId || 0) + 1,
          };
        },
      );
    },
    [],
  );

  const subjectType: InvestigationReportSubjectType = props.subjectType;

  const inlineReferences: MarkdownInlineReferenceRenderers =
    useMemo((): MarkdownInlineReferenceRenderers => {
      return {
        renderCitation: (citationId: string): ReactElement | null => {
          const label: string | undefined = citationLabels.get(citationId);

          if (label === undefined) {
            return null;
          }

          return (
            <InvestigationCitationChip
              citationId={citationId}
              label={label}
              onActivate={focusCitation}
            />
          );
        },
        renderEventReference: (
          reference: MarkdownEventReference,
        ): ReactElement | null => {
          const resolved: InvestigationEventReference | undefined =
            referencesByKey.get(
              getEventReferenceKey(
                reference.kind || subjectType,
                reference.number,
              ),
            );

          if (!resolved) {
            return null;
          }

          return (
            <InvestigationReferenceLink
              reference={resolved}
              text={reference.text}
            />
          );
        },
      };
    }, [citationLabels, focusCitation, referencesByKey, subjectType]);

  const tldr: string =
    typeof props.analysisTldr === "string" ? props.analysisTldr.trim() : "";
  const summaryMarkdown: string = report.summary || "";

  /*
   * The first Summary is lifted into its own section above the report; any
   * other section keeps its place (a second Summary included), so nothing the
   * report said is dropped.
   */
  const firstSummaryIndex: number = report.sections.findIndex(
    (section: InvestigationReportSection): boolean => {
      return section.kind === InvestigationReportSectionKind.Summary;
    },
  );
  const reportSections: Array<{
    section: InvestigationReportSection;
    index: number;
  }> = report.sections
    .map((section: InvestigationReportSection, index: number) => {
      return { section, index };
    })
    .filter((entry: { index: number }): boolean => {
      return entry.index !== firstSummaryIndex;
    });
  const hasReportBody: boolean = report.isStructured
    ? Boolean(report.preamble) || reportSections.length > 0
    : Boolean(report.bodyMarkdown);

  const renderMarkdown: (text: string) => ReactElement = (
    text: string,
  ): ReactElement => {
    return (
      <MarkdownViewer
        text={text}
        safeMode={true}
        inlineReferences={inlineReferences}
      />
    );
  };

  return (
    <>
      {tldr || summaryMarkdown ? (
        <section
          aria-label="Investigation summary"
          className="overflow-hidden rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 via-indigo-50/40 to-white px-5 py-4 shadow-sm"
        >
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-sm">
              <Icon icon={IconProp.Sparkles} className="h-4 w-4" />
            </span>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-indigo-600">
              Summary
            </h3>
          </div>
          {/*
            The TL;DR is AI-written prose about the report below it: always
            plain text, never markdown, and simply absent for older runs.
          */}
          {tldr ? (
            <div className="mt-3">
              <span className="inline-flex items-center rounded bg-indigo-100 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-indigo-700">
                TL;DR
              </span>
              <p className="mt-1.5 break-words text-base font-semibold leading-7 text-gray-900">
                {tldr}
              </p>
            </div>
          ) : (
            <></>
          )}
          {summaryMarkdown ? (
            <div
              className={
                tldr
                  ? "mt-3 border-t border-indigo-100 pt-2 text-sm leading-6 text-gray-700"
                  : "mt-1 text-sm leading-6 text-gray-800"
              }
            >
              {renderMarkdown(summaryMarkdown)}
            </div>
          ) : (
            <></>
          )}
        </section>
      ) : (
        <></>
      )}

      <section
        aria-label="Investigation report"
        className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
      >
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 bg-gray-50/80 px-5 py-4">
          <div className="flex min-w-0 items-start gap-2.5">
            <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-600">
              <Icon icon={IconProp.DocumentText} className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-gray-900">
                Investigation report
              </h3>
              <p className="mt-0.5 text-xs leading-5 text-gray-500">
                Root cause, supporting evidence, and recommended next steps from
                this investigation.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-xs font-medium text-gray-500 ring-1 ring-inset ring-gray-200">
              <Icon icon={IconProp.Sparkles} className="h-3 w-3" />
              AI generated
            </span>
            {/*
              Responders paste the RCA into a channel or a postmortem long
              before they act on it, so copy the report exactly as published
              rather than the sections rendered below.
            */}
            <CopyTextButton
              textToBeCopied={props.analysisMarkdown}
              size="sm"
              variant="ghost"
              label="Copy report"
              copiedLabel="Report copied"
            />
          </div>
        </div>
        <div className="space-y-5 px-5 py-5 text-sm leading-6 text-gray-700">
          {!hasReportBody ? (
            <p className="text-sm text-gray-500">
              {report.isStructured
                ? "The report's findings are in the summary above."
                : "The report has no further details."}
            </p>
          ) : report.isStructured ? (
            <>
              {report.preamble ? (
                <div>{renderMarkdown(report.preamble)}</div>
              ) : (
                <></>
              )}
              {reportSections.map(
                (entry: {
                  section: InvestigationReportSection;
                  index: number;
                }): ReactElement => {
                  const headingId: string = `${idPrefix}-report-section-${entry.index}`;
                  const appearance: SectionAppearance = getSectionAppearance(
                    entry.section.kind,
                  );

                  if (appearance.isCallout) {
                    return (
                      <section
                        key={headingId}
                        aria-labelledby={headingId}
                        data-section-kind={entry.section.kind}
                        className="rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3.5"
                      >
                        <div className="flex items-center gap-2">
                          <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-amber-100 text-amber-700">
                            <Icon
                              icon={appearance.icon}
                              className="h-3.5 w-3.5"
                            />
                          </span>
                          <h4
                            id={headingId}
                            className="text-xs font-semibold uppercase tracking-wider text-amber-700"
                          >
                            {entry.section.title}
                          </h4>
                        </div>
                        <div className="mt-1 text-sm leading-6 text-gray-800">
                          {renderMarkdown(entry.section.markdown)}
                        </div>
                      </section>
                    );
                  }

                  return (
                    <section
                      key={headingId}
                      aria-labelledby={headingId}
                      data-section-kind={entry.section.kind}
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-600">
                          <Icon icon={appearance.icon} className="h-4 w-4" />
                        </span>
                        <h4
                          id={headingId}
                          className="text-sm font-semibold text-gray-900"
                        >
                          {entry.section.title}
                        </h4>
                      </div>
                      <div className="mt-1 text-sm leading-6 text-gray-700">
                        {renderMarkdown(entry.section.markdown)}
                      </div>
                    </section>
                  );
                },
              )}
            </>
          ) : (
            renderMarkdown(report.bodyMarkdown)
          )}
        </div>
      </section>

      <InvestigationEvidenceList
        items={props.evidence}
        legacyEntries={legacyEntries}
        subjectType={props.subjectType}
        subjectId={props.subjectId}
        runId={props.runId}
        focusRequest={focusRequest}
      />
    </>
  );
};

export default InvestigationReportView;
