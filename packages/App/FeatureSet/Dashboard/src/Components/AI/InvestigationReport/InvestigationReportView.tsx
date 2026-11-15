import InvestigationCitationChip from "./InvestigationCitationChip";
import InvestigationReferenceLink from "./InvestigationReferenceLink";
import InvestigationStopNote from "./InvestigationStopNote";
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
  InvestigationImpactAspect,
  InvestigationImpactLine,
  InvestigationReportSection,
  InvestigationReportSectionKind,
  ParsedInvestigationReport,
  parseImpactLines,
  parseRuledOutCauses,
  RuledOutCause,
} from "Common/Utils/AI/InvestigationReport";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import Icon from "Common/UI/Components/Icon/Icon";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import { getShownMarkdownReadingDirection } from "Common/UI/Components/Markdown.tsx/MarkdownReadingDirection";
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
 * The mark an Impact line opens with, by what it is about: the people, the
 * services (the Service Catalog's own mark), the objectives (the SLOs'),
 * and a chart for a line about anything else.
 */
export const IMPACT_ASPECT_ICONS: Readonly<
  Record<InvestigationImpactAspect | "Other", IconProp>
> = {
  [InvestigationImpactAspect.Users]: IconProp.UserGroup,
  [InvestigationImpactAspect.Services]: IconProp.SquareStack,
  [InvestigationImpactAspect.Slos]: IconProp.Gauge,
  Other: IconProp.ChartBar,
};

// An Impact line as the card draws it: its label in bold, then what it says.
export function getImpactLineMarkdown(line: InvestigationImpactLine): string {
  return line.labelMarkdown
    ? `**${line.labelMarkdown}:** ${line.textMarkdown}`
    : line.textMarkdown;
}

/*
 * A word of lowercase letters at the start of a text, before a space, a
 * mark or the end: "its" in "its CPU stayed ...", never "eBPF" or "iOS".
 */
const LOWERCASE_FIRST_WORD: RegExp = /^[a-z]+(?=[\s,.;:!?)]|$)/;

/*
 * Why a ruled-out cause is ruled out, as its own line: the model writes it
 * after the cause and a colon - "**A traffic spike:** checkout requests
 * were flat ..." - so it starts in lowercase, which reads wrong once it
 * sits on a line under the cause. A first word of plain lowercase letters
 * takes a capital; anything else (code, a number, "eBPF") is left as
 * written.
 */
export function getRuledOutReasonForDisplay(reasonMarkdown: string): string {
  return LOWERCASE_FIRST_WORD.test(reasonMarkdown)
    ? `${reasonMarkdown.charAt(0).toUpperCase()}${reasonMarkdown.slice(1)}`
    : reasonMarkdown;
}

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
   * The first Summary is lifted into its own section above the report, and
   * the first Impact right under it - who and what the signal hurts is the
   * next thing a responder needs, as the leading AI SRE tools show it - so a
   * report that wrote its impact later still says it first. Any other
   * section keeps its place (a second Summary or Impact included), so
   * nothing the report said is dropped.
   */
  const firstSummaryIndex: number = report.sections.findIndex(
    (section: InvestigationReportSection): boolean => {
      return section.kind === InvestigationReportSectionKind.Summary;
    },
  );
  const firstImpactIndex: number = report.isStructured
    ? report.sections.findIndex(
        (section: InvestigationReportSection): boolean => {
          return section.kind === InvestigationReportSectionKind.Impact;
        },
      )
    : -1;
  const impactSection: InvestigationReportSection | undefined =
    firstImpactIndex >= 0 ? report.sections[firstImpactIndex] : undefined;
  const impactLines: Array<InvestigationImpactLine> = impactSection
    ? parseImpactLines(impactSection.markdown)
    : [];
  const impactHeadingId: string = `${idPrefix}-report-impact`;
  const reportSections: Array<{
    section: InvestigationReportSection;
    index: number;
  }> = report.sections
    .map((section: InvestigationReportSection, index: number) => {
      return { section, index };
    })
    .filter((entry: { index: number }): boolean => {
      return (
        entry.index !== firstSummaryIndex && entry.index !== firstImpactIndex
      );
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

  /*
   * A follow-up check's report says first why it was written: "Checked
   * again after alert #12 opened on host web-1, ...". It is the runner's
   * line, not the model's, and it frames everything under it, so it leads
   * the report as a quiet line with a mark rather than sitting between the
   * Summary and the root cause, where the report's own text has it.
   */
  const followUpLead: string = (report.followUpLead || "").trim();

  /*
   * A run a limit stopped: OneUptime's line saying which limit, and where
   * it is changed (InvestigationStopNote). It closes the report, before
   * the caveat.
   */
  const stopNote: string = (report.stopNote || "").trim();

  return (
    <>
      {followUpLead ? (
        <div
          data-testid="investigation-report-lead"
          className="flex items-start gap-3"
        >
          {/* A div, not a span: Icon renders its own div around the svg. */}
          <div className="flex h-6 w-4 flex-shrink-0 items-center justify-center">
            <Icon
              icon={IconProp.Refresh}
              className="h-4 w-4 flex-shrink-0 text-indigo-500"
            />
          </div>
          {/*
            The paragraph's own margins are dropped, so its first line sits
            level with the mark, as the feed draws a note.
          */}
          <div className="min-w-0 flex-1 break-words text-sm leading-6 text-gray-700 [&_.max-w-none>*:first-child]:mt-0 [&_.max-w-none>*:last-child]:mb-0">
            {renderMarkdown(followUpLead)}
          </div>
        </div>
      ) : (
        <></>
      )}

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
            is the one line set larger, because it is the answer. It reads
            in its own direction (dir="auto"), as the folded card's summary
            does: an English answer on a Persian page put its full stop at
            the start of its line.
          */}
          {tldr ? (
            <p
              dir="auto"
              className="mt-1 break-words text-base font-semibold leading-7 text-gray-900"
            >
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

      {/*
        Who and what it hurts, and how that was worked out: one line each,
        the people, the services and the objectives each with its own mark,
        the label first, as the report wrote it. A section that is not such
        a list is drawn as written, like every other.
      */}
      {impactSection ? (
        <section
          aria-labelledby={impactHeadingId}
          data-section-kind={InvestigationReportSectionKind.Impact}
          data-testid="investigation-report-impact"
        >
          <h3
            id={impactHeadingId}
            dir="auto"
            className={REPORT_SECTION_HEADING_CLASS_NAME}
          >
            {impactSection.title}
          </h3>
          {impactLines.length > 0 ? (
            <ul data-testid="investigation-impact" className="mt-2 space-y-2">
              {impactLines.map(
                (line: InvestigationImpactLine, lineIndex: number) => {
                  const markdown: string = getImpactLineMarkdown(line);

                  return (
                    <li
                      key={`${impactHeadingId}-line-${lineIndex}`}
                      dir={getShownMarkdownReadingDirection(markdown)}
                      data-testid="investigation-impact-line"
                      data-aspect={line.aspect || "Other"}
                      className="flex items-start gap-3"
                    >
                      {/* A div, not a span: Icon renders its own div around the svg. */}
                      <div className="flex h-6 w-4 flex-shrink-0 items-center justify-center">
                        <Icon
                          icon={IMPACT_ASPECT_ICONS[line.aspect || "Other"]}
                          className="h-4 w-4 flex-shrink-0 text-gray-400"
                        />
                      </div>
                      <div className="min-w-0 flex-1 break-words text-sm leading-6 text-gray-700 [&_.max-w-none>*:first-child]:mt-0 [&_.max-w-none>*:last-child]:mb-0">
                        {renderMarkdown(markdown)}
                      </div>
                    </li>
                  );
                },
              )}
            </ul>
          ) : (
            <div className={REPORT_SECTION_BODY_CLASS_NAME}>
              {renderMarkdown(impactSection.markdown)}
            </div>
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

                /*
                 * The causes the investigation ruled out, one per line
                 * with a cross before it, the cause first and why after
                 * it: a list a responder runs an eye down, rather than
                 * prose. A section that is not such a list is drawn as
                 * written, like every other.
                 */
                const ruledOutCauses: Array<RuledOutCause> =
                  entry.section.kind === InvestigationReportSectionKind.RuledOut
                    ? parseRuledOutCauses(entry.section.markdown)
                    : [];

                return (
                  <section
                    key={headingId}
                    aria-labelledby={headingId}
                    data-section-kind={entry.section.kind}
                  >
                    {/*
                      The section's title is the report's own, as OneUptime
                      AI wrote it ("Most likely root cause"): it reads in its
                      own direction, as its body does (MarkdownViewer), so an
                      English section on a Persian page keeps its title over
                      its text, not at the far edge.
                    */}
                    <h3
                      id={headingId}
                      dir="auto"
                      className={REPORT_SECTION_HEADING_CLASS_NAME}
                    >
                      {entry.section.title}
                    </h3>
                    {ruledOutCauses.length > 0 ? (
                      <ul
                        data-testid="investigation-ruled-out"
                        className="mt-2 space-y-3"
                      >
                        {ruledOutCauses.map(
                          (
                            cause: RuledOutCause,
                            causeIndex: number,
                          ): ReactElement => {
                            /*
                             * Each cause reads the way it is written, as
                             * the report's other lists do (the markdown
                             * viewer's MarkdownReadingDirection): an
                             * English cause on a Persian page keeps its
                             * cross beside its first word, at the left.
                             */
                            return (
                              <li
                                key={`${headingId}-cause-${causeIndex}`}
                                dir={getShownMarkdownReadingDirection(
                                  `${cause.causeMarkdown}\n${cause.reasonMarkdown}`,
                                )}
                                data-testid="investigation-ruled-out-cause"
                                className="flex items-start gap-3"
                              >
                                {/*
                                  A div, not a span: Icon renders its own
                                  div around the svg.
                                */}
                                <div className="flex h-6 w-4 flex-shrink-0 items-center justify-center">
                                  <Icon
                                    icon={IconProp.Close}
                                    className="h-3.5 w-3.5 flex-shrink-0 text-gray-400"
                                  />
                                </div>
                                <div className="min-w-0 flex-1 break-words text-sm leading-6 text-gray-700 [&_.max-w-none>*:first-child]:mt-0 [&_.max-w-none>*:last-child]:mb-0">
                                  {cause.causeMarkdown ? (
                                    <div
                                      data-testid="investigation-ruled-out-cause-name"
                                      className="font-medium text-gray-900"
                                    >
                                      {renderMarkdown(cause.causeMarkdown)}
                                    </div>
                                  ) : (
                                    <></>
                                  )}
                                  {cause.reasonMarkdown ? (
                                    <div data-testid="investigation-ruled-out-cause-reason">
                                      {renderMarkdown(
                                        getRuledOutReasonForDisplay(
                                          cause.reasonMarkdown,
                                        ),
                                      )}
                                    </div>
                                  ) : (
                                    <></>
                                  )}
                                </div>
                              </li>
                            );
                          },
                        )}
                      </ul>
                    ) : (
                      <div className={REPORT_SECTION_BODY_CLASS_NAME}>
                        {renderMarkdown(entry.section.markdown)}
                      </div>
                    )}
                  </section>
                );
              },
            )}
          </>
        ) : report.bodyMarkdown ? (
          <div className="text-sm leading-6 text-gray-700">
            {renderMarkdown(report.bodyMarkdown)}
          </div>
        ) : hasSummary || stopNote ? (
          <></>
        ) : (
          /*
           * Only the report's chrome was published (brand heading, evidence
           * list, footer): without this line the card would jump straight
           * from its title to the caveat. A run a limit stopped says why it
           * has nothing more instead (its stop note, below).
           */
          <p className="text-sm text-gray-500">
            {translator.translateText("The report has no further details.")}
          </p>
        )}

        {stopNote ? <InvestigationStopNote note={stopNote} /> : <></>}

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
