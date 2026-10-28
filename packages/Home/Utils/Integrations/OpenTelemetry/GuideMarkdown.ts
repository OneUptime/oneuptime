import {
  OPEN_TELEMETRY_GUIDES_INDEX_PATH,
  OpenTelemetryGuideEntry,
  getOpenTelemetryGuidePath,
} from "Common/Types/Telemetry/OpenTelemetryGuides";
import {
  GuideCodeSection,
  GuideQuestion,
  GuideSnippet,
  GuideStep,
  GuideTabs,
  InlineText,
  OpenTelemetryGuide,
} from "./GuideTypes";
import { guideSections, GuideSection } from "./GuidePage";
import { formatCheckedOn, getVerificationRecord } from "./GuideVerifications";
import {
  getGuideEntry,
  getGuideLanguageGroup,
  getPublishedGuides,
} from "./OpenTelemetryGuides";

/*
 * A guide as Markdown, at /integrations/opentelemetry/<slug>.md: the same
 * page for tools and AI assistants (llms.txt lists them). Inline text is
 * already Markdown; links to this site and the docs get the site's address
 * in front, so the copy reads the same wherever it is pasted.
 */

const FENCE: string = "```";

function absolute(text: InlineText, baseUrl: string): string {
  return text.split("](/").join(`](${baseUrl}/`);
}

function snippetMarkdown(snippet: GuideSnippet): Array<string> {
  const language: string = snippet.language === "text" ? "" : snippet.language;

  return [
    ...(snippet.title ? [`${snippet.title}:`, ""] : []),
    `${FENCE}${language}`,
    snippet.code,
    FENCE,
    "",
  ];
}

function notesMarkdown(
  notes: Array<InlineText> | undefined,
  baseUrl: string,
): Array<string> {
  if (!notes || notes.length === 0) {
    return [];
  }

  return [
    ...notes.map((note: InlineText): string => {
      return `- ${absolute(note, baseUrl)}`;
    }),
    "",
  ];
}

function tabsMarkdown(tabs: GuideTabs, baseUrl: string): Array<string> {
  return tabs.tabs.flatMap((tab: GuideTabs["tabs"][number]) => {
    return [
      `**${tab.label}**`,
      "",
      ...(tab.body ? [absolute(tab.body, baseUrl), ""] : []),
      ...tab.snippets.flatMap(snippetMarkdown),
      ...notesMarkdown(tab.notes, baseUrl),
    ];
  });
}

function stepsMarkdown(
  steps: Array<GuideStep>,
  baseUrl: string,
): Array<string> {
  return steps.flatMap((step: GuideStep, index: number): Array<string> => {
    return [
      `### ${index + 1}. ${step.title}`,
      "",
      absolute(step.body, baseUrl),
      "",
      ...(step.snippets || []).flatMap(snippetMarkdown),
      ...(step.tabs ? tabsMarkdown(step.tabs, baseUrl) : []),
      ...notesMarkdown(step.notes, baseUrl),
    ];
  });
}

function codeSectionMarkdown(
  section: GuideCodeSection,
  baseUrl: string,
): Array<string> {
  return [
    absolute(section.intro, baseUrl),
    "",
    ...section.snippets.flatMap(snippetMarkdown),
    ...notesMarkdown(section.notes, baseUrl),
  ];
}

function questionsMarkdown(
  questions: Array<GuideQuestion>,
  baseUrl: string,
): Array<string> {
  return questions.flatMap((question: GuideQuestion): Array<string> => {
    return [
      `### ${question.question}`,
      "",
      absolute(question.answer, baseUrl),
      "",
      ...(question.snippets || []).flatMap(snippetMarkdown),
    ];
  });
}

export function generateGuideMarkdown(
  guide: OpenTelemetryGuide,
  homeUrl: string,
): string {
  const baseUrl: string = homeUrl.replace(/\/$/, "");
  const entry: OpenTelemetryGuideEntry = getGuideEntry(guide.slug);
  const sections: Array<GuideSection> = guideSections(entry.name, entry.kind);
  const title: (id: string) => string = (id: string): string => {
    return (
      sections.find((section: GuideSection): boolean => {
        return section.id === id;
      })?.title || id
    );
  };
  const record: ReturnType<typeof getVerificationRecord> =
    getVerificationRecord(guide.slug);

  const lines: Array<string> = [
    `# ${guide.h1}`,
    "",
    `> ${absolute(guide.lead, baseUrl)}`,
    "",
    `Page: ${baseUrl}${getOpenTelemetryGuidePath(guide.slug)}`,
    `Language: ${getGuideLanguageGroup(guide.slug).title}`,
  ];

  if (record) {
    lines.push(
      `Checked end to end on ${formatCheckedOn(record.checkedOn)} with ${record.framework}, ${record.runtime}.`,
    );
  }

  lines.push(
    "",
    `## ${title("what-you-get")}`,
    "",
    absolute(guide.whatYouGet.intro, baseUrl),
    "",
    `- **Traces:** ${absolute(guide.whatYouGet.traces, baseUrl)}`,
    `- **Metrics:** ${absolute(guide.whatYouGet.metrics, baseUrl)}`,
    `- **Logs:** ${absolute(guide.whatYouGet.logs, baseUrl)}`,
    `- **Exceptions:** ${absolute(guide.whatYouGet.exceptions, baseUrl)}`,
    "",
    `## ${title("before-you-start")}`,
    "",
    ...guide.prerequisites.map((item: InlineText): string => {
      return `- ${absolute(item, baseUrl)}`;
    }),
    "",
    `## ${title("install")}`,
    "",
    ...codeSectionMarkdown(guide.install, baseUrl),
    `## ${title("configure")}`,
    "",
    absolute(guide.configure.intro, baseUrl),
    "",
    ...tabsMarkdown(guide.configure.tabs, baseUrl),
    ...notesMarkdown(guide.configure.notes, baseUrl),
    `## ${title("setup")}`,
    "",
    absolute(guide.setup.intro, baseUrl),
    "",
    ...stepsMarkdown(guide.setup.steps, baseUrl),
    `## ${title("automatic-instrumentation")}`,
    "",
    absolute(guide.autoInstrumentation.intro, baseUrl),
    "",
    "| Library | What you see in OneUptime |",
    "| --- | --- |",
    ...guide.autoInstrumentation.rows.map(
      (row: { library: InlineText; covers: InlineText }): string => {
        return `| ${absolute(row.library, baseUrl)} | ${absolute(row.covers, baseUrl)} |`;
      },
    ),
    "",
    ...notesMarkdown(guide.autoInstrumentation.notes, baseUrl),
    ...guide.autoInstrumentation.snippets.flatMap(snippetMarkdown),
    `## ${title("custom-spans")}`,
    "",
    ...codeSectionMarkdown(guide.manualSpans, baseUrl),
    `## ${title("logs")}`,
    "",
    ...codeSectionMarkdown(guide.logs, baseUrl),
    `## ${title("metrics")}`,
    "",
    absolute(guide.metrics.intro, baseUrl),
    "",
    ...guide.metrics.builtIn.map(
      (row: { name: string; description: InlineText }): string => {
        return `- \`${row.name}\`: ${absolute(row.description, baseUrl)}`;
      },
    ),
    "",
    ...guide.metrics.snippets.flatMap(snippetMarkdown),
    ...notesMarkdown(guide.metrics.notes, baseUrl),
    `## ${title("sampling")}`,
    "",
    ...codeSectionMarkdown(guide.sampling, baseUrl),
    `## ${title("containers")}`,
    "",
    ...codeSectionMarkdown(guide.deploy, baseUrl),
    `## ${title("check")}`,
    "",
    absolute(guide.verify.intro, baseUrl),
    "",
    ...stepsMarkdown(guide.verify.steps, baseUrl),
    `## ${title("troubleshooting")}`,
    "",
    ...questionsMarkdown(guide.troubleshooting, baseUrl),
    `## ${title("faq")}`,
    "",
    ...questionsMarkdown(guide.faq, baseUrl),
    "## Related",
    "",
    ...guide.related.map((slug: string): string => {
      return `- [${getGuideEntry(slug).name} OpenTelemetry](${baseUrl}${getOpenTelemetryGuidePath(slug)})`;
    }),
    ...guide.docs.map(
      (doc: { title: string; href: string; description: string }): string => {
        return `- [${doc.title}](${baseUrl}${doc.href}): ${doc.description}`;
      },
    ),
    "",
  );

  return lines.join("\n");
}

// The index as Markdown, at /integrations.md.
export function generateIntegrationsIndexMarkdown(homeUrl: string): string {
  const baseUrl: string = homeUrl.replace(/\/$/, "");
  const lines: Array<string> = [
    "# OpenTelemetry integrations",
    "",
    "> Step-by-step guides that send a framework's traces, metrics and logs to OneUptime with OpenTelemetry, each checked end to end before it was published.",
    "",
    `Page: ${baseUrl}${OPEN_TELEMETRY_GUIDES_INDEX_PATH}`,
    "",
  ];

  let lastLanguage: string = "";

  for (const { entry, guide } of getPublishedGuides()) {
    const language: string = getGuideLanguageGroup(entry.slug).title;

    if (language !== lastLanguage) {
      // A blank line ends the previous language's list before its heading.
      if (lastLanguage) {
        lines.push("");
      }
      lines.push(`## ${language}`, "");
      lastLanguage = language;
    }

    lines.push(
      `- [${guide.h1}](${baseUrl}${getOpenTelemetryGuidePath(entry.slug)}.md): ${guide.cardDescription}`,
    );
  }

  lines.push("");

  return lines.join("\n");
}
