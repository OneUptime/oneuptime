import {
  OPEN_TELEMETRY_GUIDES_INDEX_PATH,
  OpenTelemetryGuideEntry,
  OpenTelemetryGuideKind,
  OpenTelemetryGuideLanguageGroup,
  getOpenTelemetryGuidePath,
} from "Common/Types/Telemetry/OpenTelemetryGuides";
import { JSONObject } from "Common/Types/JSON";
import {
  ProviderLogoImage,
  getProviderLogoImage,
} from "../../ProviderLogoFiles";
import {
  ExampleSpan,
  GuideCodeSection,
  GuideLink,
  GuideQuestion,
  GuideSnippet,
  GuideStep,
  GuideTabs,
  InlineText,
  OpenTelemetryGuide,
} from "./GuideTypes";
import { SNIPPET_LANGUAGE_LABELS, highlightSnippet } from "./GuideHighlight";
import { inlineTextToHtml, inlineTextToPlainText } from "./GuideText";
import {
  GuideVerificationRecord,
  formatCheckedOn,
  getVerificationRecord,
} from "./GuideVerifications";
import {
  getGuideEntry,
  getGuideLanguageGroup,
  getGuidePage,
} from "./OpenTelemetryGuides";

/*
 * A guide made ready for its template (Views/integrations/
 * opentelemetry-guide.ejs): every inline text drawn as HTML, every snippet
 * highlighted, the sections named for the contents list, and the structured
 * data written. The template only places what it is handed.
 */

export interface RenderedSnippet {
  id: string;
  title?: string | undefined;
  languageLabel: string;
  // Highlighted HTML, escaped.
  html: string;
  // The code as written, for the copy button.
  code: string;
}

export interface RenderedTab {
  id: string;
  label: string;
  bodyHtml?: string | undefined;
  snippets: Array<RenderedSnippet>;
  notesHtml: Array<string>;
}

export interface RenderedTabs {
  group: string;
  // Unique on the page, for the tab buttons' ids.
  id: string;
  tabs: Array<RenderedTab>;
}

export interface RenderedStep {
  title: string;
  bodyHtml: string;
  snippets: Array<RenderedSnippet>;
  tabs?: RenderedTabs | undefined;
  notesHtml: Array<string>;
}

export interface RenderedCodeSection {
  introHtml: string;
  snippets: Array<RenderedSnippet>;
  notesHtml: Array<string>;
}

export interface RenderedQuestion {
  question: string;
  answerHtml: string;
  snippets: Array<RenderedSnippet>;
}

export interface GuideMark {
  logo?: ProviderLogoImage | undefined;
  /*
   * A guide no one brand owns - plain JavaScript in the browser - has a
   * generic mark instead: a browser window.
   */
  icon?: "browser" | undefined;
  // Shown in the logo's place where there is neither: a framework's initials.
  monogram: string;
}

export interface GuideCard {
  href: string;
  name: string;
  description: string;
  mark: GuideMark;
  languageTitle: string;
}

export interface GuideSection {
  id: string;
  // The section's h2.
  title: string;
  // Its line in the contents list.
  label: string;
}

export interface GuidePageContent {
  slug: string;
  name: string;
  h1: string;
  leadHtml: string;
  highlights: Array<string>;
  kindLabel: string;
  language: OpenTelemetryGuideLanguageGroup;
  mark: GuideMark;
  checked?: { onLabel: string; withLabel: string } | undefined;
  sections: Array<GuideSection>;
  whatYouGet: {
    introHtml: string;
    signals: Array<{ name: string; html: string }>;
  };
  exampleTrace: { caption: string; spans: Array<ExampleSpan> };
  prerequisitesHtml: Array<string>;
  install: RenderedCodeSection;
  configure: {
    introHtml: string;
    tabs: RenderedTabs;
    notesHtml: Array<string>;
  };
  setup: { introHtml: string; steps: Array<RenderedStep> };
  autoInstrumentation: {
    introHtml: string;
    rows: Array<{ libraryHtml: string; coversHtml: string }>;
    snippets: Array<RenderedSnippet>;
    notesHtml: Array<string>;
  };
  manualSpans: RenderedCodeSection;
  logs: RenderedCodeSection;
  metrics: {
    introHtml: string;
    builtIn: Array<{ name: string; descriptionHtml: string }>;
    snippets: Array<RenderedSnippet>;
    notesHtml: Array<string>;
  };
  sampling: RenderedCodeSection;
  deploy: RenderedCodeSection;
  verify: { introHtml: string; steps: Array<RenderedStep> };
  troubleshooting: Array<RenderedQuestion>;
  faq: Array<RenderedQuestion>;
  related: Array<GuideCard>;
  docs: Array<GuideLink>;
  indexHref: string;
  structuredData: Array<JSONObject>;
}

const KIND_LABELS: Record<OpenTelemetryGuideKind, string> = {
  runtime: "Runtime",
  framework: "Framework",
  browser: "Browser",
};

// "Ex" for Express, "N" for Next.js: a mark's place when there is no logo.
export function monogramOf(name: string): string {
  const letters: string = name.replace(/[^A-Za-z]/g, "");

  if (!letters) {
    return name.slice(0, 2);
  }

  return letters.charAt(0).toUpperCase() + letters.charAt(1).toLowerCase();
}

export function guideMark(entry: OpenTelemetryGuideEntry): GuideMark {
  return {
    logo: entry.logo ? getProviderLogoImage(entry.logo) : undefined,
    icon: !entry.logo && entry.kind === "browser" ? "browser" : undefined,
    monogram: monogramOf(entry.name),
  };
}

export function guideCard(slug: string): GuideCard {
  const entry: OpenTelemetryGuideEntry = getGuideEntry(slug);
  const guide: OpenTelemetryGuide | undefined = getGuidePage(slug);

  return {
    href: getOpenTelemetryGuidePath(slug),
    name: entry.name,
    description: guide ? guide.cardDescription : "",
    mark: guideMark(entry),
    languageTitle: getGuideLanguageGroup(slug).title,
  };
}

function renderSnippet(snippet: GuideSnippet): RenderedSnippet {
  return {
    id: snippet.id,
    title: snippet.title,
    languageLabel: SNIPPET_LANGUAGE_LABELS[snippet.language],
    html: highlightSnippet(snippet.code, snippet.language),
    code: snippet.code,
  };
}

function renderNotes(notes: Array<InlineText> | undefined): Array<string> {
  return (notes || []).map(inlineTextToHtml);
}

let tabsOnPage: number = 0;

function renderTabs(tabs: GuideTabs, slug: string): RenderedTabs {
  tabsOnPage++;
  const id: string = `${slug}-${tabs.group}-${tabsOnPage}`;

  return {
    group: tabs.group,
    id: id,
    tabs: tabs.tabs.map((tab: GuideTabs["tabs"][number], index: number) => {
      return {
        id: `${id}-${index}`,
        label: tab.label,
        bodyHtml: tab.body ? inlineTextToHtml(tab.body) : undefined,
        snippets: tab.snippets.map(renderSnippet),
        notesHtml: renderNotes(tab.notes),
      };
    }),
  };
}

function renderStep(step: GuideStep, slug: string): RenderedStep {
  return {
    title: step.title,
    bodyHtml: inlineTextToHtml(step.body),
    snippets: (step.snippets || []).map(renderSnippet),
    tabs: step.tabs ? renderTabs(step.tabs, slug) : undefined,
    notesHtml: renderNotes(step.notes),
  };
}

function renderCodeSection(section: GuideCodeSection): RenderedCodeSection {
  return {
    introHtml: inlineTextToHtml(section.intro),
    snippets: section.snippets.map(renderSnippet),
    notesHtml: renderNotes(section.notes),
  };
}

function renderQuestion(question: GuideQuestion): RenderedQuestion {
  return {
    question: question.question,
    answerHtml: inlineTextToHtml(question.answer),
    snippets: (question.snippets || []).map(renderSnippet),
  };
}

/*
 * How the section titles name what the page is for. A framework's catalog
 * name reads well there ("Add OpenTelemetry to Express"); the browser
 * entry's ("JavaScript in the browser") does not, so a browser page names
 * the web app instead, and its deploy section is about shipping a bundle,
 * not running a container.
 */
interface SectionWords {
  setupTitle: string;
  setupLabel: string;
  troubleshootingTitle: string;
  faqTitle: string;
  deployTitle: string;
  deployLabel: string;
}

function sectionWords(
  name: string,
  kind: OpenTelemetryGuideKind,
): SectionWords {
  if (kind === "browser") {
    const isPlainBrowser: boolean = name.toLowerCase().includes("browser");
    const app: string = isPlainBrowser ? "your web app" : `your ${name} app`;

    return {
      setupTitle: `Add OpenTelemetry to ${app}`,
      setupLabel: isPlainBrowser ? "Add to your web app" : `Add to ${name}`,
      troubleshootingTitle: isPlainBrowser
        ? "Troubleshooting OpenTelemetry in the browser"
        : `Troubleshooting OpenTelemetry in ${name}`,
      faqTitle: isPlainBrowser
        ? "Browser OpenTelemetry FAQ"
        : `${name} OpenTelemetry FAQ`,
      deployTitle: "Ship it to production",
      deployLabel: "Production",
    };
  }

  return {
    setupTitle: `Add OpenTelemetry to ${name}`,
    setupLabel: `Add to ${name}`,
    troubleshootingTitle: `Troubleshooting OpenTelemetry in ${name}`,
    faqTitle: `${name} OpenTelemetry FAQ`,
    deployTitle: "Run it in Docker and Kubernetes",
    deployLabel: "Docker and Kubernetes",
  };
}

// The page's sections, in order: its h2s and the contents list.
export function guideSections(
  name: string,
  kind: OpenTelemetryGuideKind,
): Array<GuideSection> {
  const words: SectionWords = sectionWords(name, kind);

  return [
    {
      id: "what-you-get",
      title: "What you get in OneUptime",
      label: "What you get",
    },
    {
      id: "before-you-start",
      title: "Before you start",
      label: "Before you start",
    },
    {
      id: "install",
      title: "Install the OpenTelemetry packages",
      label: "Install",
    },
    {
      id: "configure",
      title: "Point the exporter at OneUptime",
      label: "Configure",
    },
    { id: "setup", title: words.setupTitle, label: words.setupLabel },
    {
      id: "automatic-instrumentation",
      title: "What is traced automatically",
      label: "Automatic instrumentation",
    },
    {
      id: "custom-spans",
      title: "Add your own spans",
      label: "Your own spans",
    },
    { id: "logs", title: "Logs and trace correlation", label: "Logs" },
    { id: "metrics", title: "Metrics", label: "Metrics" },
    { id: "sampling", title: "Sampling and noise", label: "Sampling" },
    { id: "containers", title: words.deployTitle, label: words.deployLabel },
    {
      id: "check",
      title: "Check that data is arriving",
      label: "Check it works",
    },
    {
      id: "troubleshooting",
      title: words.troubleshootingTitle,
      label: "Troubleshooting",
    },
    { id: "faq", title: words.faqTitle, label: "FAQ" },
  ];
}

// "Express 5.3.0 · Node.js 24.22.1 · OpenTelemetry JS 3.0", or nothing unchecked.
function checkedLabels(
  record: GuideVerificationRecord | undefined,
): { onLabel: string; withLabel: string } | undefined {
  if (!record) {
    return undefined;
  }

  // A runtime's own guide names it once: "Bun 1.4.4", not "Bun · Bun 1.4.4".
  const parts: Array<string> = record.runtime.startsWith(record.framework)
    ? [record.runtime]
    : [record.framework, record.runtime];

  return {
    onLabel: `Checked end to end on ${formatCheckedOn(record.checkedOn)}`,
    withLabel: parts
      .filter((part: string): boolean => {
        return Boolean(part);
      })
      .join(" · "),
  };
}

function plainAnswer(text: InlineText): string {
  return inlineTextToPlainText(text);
}

export function guideStructuredData(
  guide: OpenTelemetryGuide,
  pageUrl: string,
): Array<JSONObject> {
  const entry: OpenTelemetryGuideEntry = getGuideEntry(guide.slug);
  const record: GuideVerificationRecord | undefined = getVerificationRecord(
    guide.slug,
  );

  const article: JSONObject = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: guide.h1,
    description: guide.seo.description,
    url: pageUrl,
    mainEntityOfPage: pageUrl,
    inLanguage: "en",
    proficiencyLevel: "Beginner",
    about: [
      { "@type": "SoftwareApplication", name: entry.name },
      { "@type": "Thing", name: "OpenTelemetry" },
    ],
    author: {
      "@type": "Organization",
      "@id": "https://oneuptime.com/#organization",
      name: "OneUptime",
      url: "https://oneuptime.com",
    },
    publisher: {
      "@type": "Organization",
      "@id": "https://oneuptime.com/#organization",
      name: "OneUptime",
      logo: {
        "@type": "ImageObject",
        url: "https://oneuptime.com/img/ou-bb.svg",
      },
    },
  };

  if (record) {
    // The day the steps were last run end to end: the page's own date.
    article["dateModified"] = record.checkedOn;
  }

  const faq: JSONObject = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: guide.faq.map((question: GuideQuestion): JSONObject => {
      return {
        "@type": "Question",
        name: question.question,
        acceptedAnswer: {
          "@type": "Answer",
          text: plainAnswer(question.answer),
        },
      };
    }),
  };

  return [article, faq];
}

export function getGuidePageContent(
  slug: string,
  homeUrl: string,
): GuidePageContent | null {
  const guide: OpenTelemetryGuide | undefined = getGuidePage(slug);

  if (!guide) {
    return null;
  }

  tabsOnPage = 0;

  const entry: OpenTelemetryGuideEntry = getGuideEntry(slug);
  const baseUrl: string = homeUrl.replace(/\/$/, "");
  const pageUrl: string = `${baseUrl}${getOpenTelemetryGuidePath(slug)}`;

  return {
    slug: slug,
    name: entry.name,
    h1: guide.h1,
    leadHtml: inlineTextToHtml(guide.lead),
    highlights: guide.highlights,
    kindLabel: KIND_LABELS[entry.kind],
    language: getGuideLanguageGroup(slug),
    mark: guideMark(entry),
    checked: checkedLabels(getVerificationRecord(slug)),
    sections: guideSections(entry.name, entry.kind),
    whatYouGet: {
      introHtml: inlineTextToHtml(guide.whatYouGet.intro),
      signals: [
        { name: "Traces", html: inlineTextToHtml(guide.whatYouGet.traces) },
        { name: "Metrics", html: inlineTextToHtml(guide.whatYouGet.metrics) },
        { name: "Logs", html: inlineTextToHtml(guide.whatYouGet.logs) },
        {
          name: "Exceptions",
          html: inlineTextToHtml(guide.whatYouGet.exceptions),
        },
      ],
    },
    exampleTrace: guide.exampleTrace,
    prerequisitesHtml: guide.prerequisites.map(inlineTextToHtml),
    install: renderCodeSection(guide.install),
    configure: {
      introHtml: inlineTextToHtml(guide.configure.intro),
      tabs: renderTabs(guide.configure.tabs, slug),
      notesHtml: renderNotes(guide.configure.notes),
    },
    setup: {
      introHtml: inlineTextToHtml(guide.setup.intro),
      steps: guide.setup.steps.map((step: GuideStep): RenderedStep => {
        return renderStep(step, slug);
      }),
    },
    autoInstrumentation: {
      introHtml: inlineTextToHtml(guide.autoInstrumentation.intro),
      rows: guide.autoInstrumentation.rows.map(
        (row: { library: InlineText; covers: InlineText }) => {
          return {
            libraryHtml: inlineTextToHtml(row.library),
            coversHtml: inlineTextToHtml(row.covers),
          };
        },
      ),
      snippets: guide.autoInstrumentation.snippets.map(renderSnippet),
      notesHtml: renderNotes(guide.autoInstrumentation.notes),
    },
    manualSpans: renderCodeSection(guide.manualSpans),
    logs: renderCodeSection(guide.logs),
    metrics: {
      introHtml: inlineTextToHtml(guide.metrics.intro),
      builtIn: guide.metrics.builtIn.map(
        (row: { name: string; description: InlineText }) => {
          return {
            name: row.name,
            descriptionHtml: inlineTextToHtml(row.description),
          };
        },
      ),
      snippets: guide.metrics.snippets.map(renderSnippet),
      notesHtml: renderNotes(guide.metrics.notes),
    },
    sampling: renderCodeSection(guide.sampling),
    deploy: renderCodeSection(guide.deploy),
    verify: {
      introHtml: inlineTextToHtml(guide.verify.intro),
      steps: guide.verify.steps.map((step: GuideStep): RenderedStep => {
        return renderStep(step, slug);
      }),
    },
    troubleshooting: guide.troubleshooting.map(renderQuestion),
    faq: guide.faq.map(renderQuestion),
    related: guide.related
      .filter((relatedSlug: string): boolean => {
        return Boolean(getGuidePage(relatedSlug));
      })
      .map(guideCard),
    docs: guide.docs,
    indexHref: OPEN_TELEMETRY_GUIDES_INDEX_PATH,
    structuredData: guideStructuredData(guide, pageUrl),
  };
}
