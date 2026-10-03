import InvestigationCitationChip from "./InvestigationCitationChip";
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
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useId, useMemo } from "react";

export interface ComponentProps {
  // The report exactly as published; "Copy report" copies this.
  analysisMarkdown: string;
  report: ParsedInvestigationReport;
  analysisTldr: string | null;
  evidence: Array<InvestigationEvidenceItem>;
  references: Array<InvestigationEventReference>;
  subjectType: InvestigationReportSubjectType;
  /*
   * A citation chip was activated. The host reveals the matching query in
   * the run's evidence, which it renders below the report.
   */
  onCitationActivate: (citationId: string) => void;
}

/*
 * Every section of the report, the summary included, shares one heading and
 * one body style, so a reader scans it as a single document: the root cause
 * is found by its title, not by a coloured box around it.
 */
export const REPORT_SECTION_HEADING_CLASS_NAME: string =
  "text-sm font-semibold text-gray-900";
export const REPORT_SECTION_BODY_CLASS_NAME: string =
  "mt-1 text-sm leading-6 text-gray-700";

// An English key, translated where it is drawn.
export const REPORT_CAVEAT_TEXT: string = translationKey(
  "AI-generated first pass — verify before acting.",
);

/*
 * A completed AI investigation, laid out for a responder as one plain
 * document: the summary first, then the report section by section, and a
 * closing line with the verify-first caveat and Copy report. None of it draws
 * a frame of its own. The panel's card is the only box, so the report reads
 * top to bottom instead of as panels nested inside panels, and no section is
 * set apart by colour. The queries its citations point at are the host's to
 * show (see InvestigationRunDetails).
 *
 * The report is untrusted model output. Every piece of it renders through
 * MarkdownViewer in safeMode; the only interactive elements inside the prose
 * are citation chips for citations the server recorded and links to
 * incidents/alerts the server resolved for this viewer.
 */
const InvestigationReportView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const idPrefix: string = useId();
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

  const subjectType: InvestigationReportSubjectType = props.subjectType;
  const onCitationActivate: (citationId: string) => void =
    props.onCitationActivate;

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
              onActivate={onCitationActivate}
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
    }, [citationLabels, onCitationActivate, referencesByKey, subjectType]);

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

  const hasSummary: boolean = Boolean(tldr || summaryMarkdown);

  return (
    <>
      {hasSummary ? (
        <section
          aria-label={translator.translateText("Investigation summary")}
          data-section-kind={InvestigationReportSectionKind.Summary}
        >
          <h3 className={REPORT_SECTION_HEADING_CLASS_NAME}>
            {translator.translateText("Summary")}
          </h3>
          {/*
            The TL;DR is AI-written prose about the report below it: always
            plain text, never markdown, and simply absent for older runs. It
            is the one line set larger, because it is the answer.
          */}
          {tldr ? (
            <p className="mt-1 break-words text-base font-semibold leading-7 text-gray-900">
              {tldr}
            </p>
          ) : (
            <></>
          )}
          {summaryMarkdown ? (
            <div
              className={
                tldr
                  ? "mt-2 text-sm leading-6 text-gray-700"
                  : REPORT_SECTION_BODY_CLASS_NAME
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
        aria-label={translator.translateText("Investigation report")}
        className="space-y-6"
      >
        {report.isStructured ? (
          <>
            {report.preamble ? (
              <div className="text-sm leading-6 text-gray-700">
                {renderMarkdown(report.preamble)}
              </div>
            ) : (
              <></>
            )}
            {reportSections.map(
              (entry: {
                section: InvestigationReportSection;
                index: number;
              }): ReactElement => {
                const headingId: string = `${idPrefix}-report-section-${entry.index}`;

                return (
                  <section
                    key={headingId}
                    aria-labelledby={headingId}
                    data-section-kind={entry.section.kind}
                  >
                    <h3
                      id={headingId}
                      className={REPORT_SECTION_HEADING_CLASS_NAME}
                    >
                      {entry.section.title}
                    </h3>
                    <div className={REPORT_SECTION_BODY_CLASS_NAME}>
                      {renderMarkdown(entry.section.markdown)}
                    </div>
                  </section>
                );
              },
            )}
          </>
        ) : report.bodyMarkdown ? (
          <div className="text-sm leading-6 text-gray-700">
            {renderMarkdown(report.bodyMarkdown)}
          </div>
        ) : hasSummary ? (
          <></>
        ) : (
          /*
           * Only the report's chrome was published (brand heading, evidence
           * list, footer): without this line the card would jump straight
           * from its title to the caveat.
           */
          <p className="text-sm text-gray-500">
            {translator.translateText("The report has no further details.")}
          </p>
        )}

        {/*
          The caveat closes the report it qualifies, and Copy report sits
          where a reader finishes it. Responders paste the RCA into a channel
          or a postmortem long before they act on it, so it copies the report
          exactly as published rather than the sections rendered above. On a
          phone the button wraps under the caveat instead of squeezing it.
        */}
        <div
          data-testid="investigation-report-footer"
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2"
        >
          {/* A div, not a p: Icon renders its own div around the svg. */}
          <div className="flex min-w-0 items-start gap-1.5 text-xs leading-5 text-gray-500">
            <Icon
              icon={IconProp.Sparkles}
              className="mt-1 h-3 w-3 flex-shrink-0 text-gray-400"
            />
            <span>{translator.translateText(REPORT_CAVEAT_TEXT)}</span>
          </div>
          <CopyTextButton
            className="flex-shrink-0 whitespace-nowrap"
            textToBeCopied={props.analysisMarkdown}
            size="sm"
            variant="soft"
            label="Copy report"
            copiedLabel={translator.translateText("Report copied") as string}
          />
        </div>
      </section>
    </>
  );
};

export default InvestigationReportView;
