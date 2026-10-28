import {
  GuideQuestion,
  GuideSnippet,
  GuideStep,
  GuideTab,
  OpenTelemetryGuide,
} from "./GuideTypes";

function stepSnippets(steps: Array<GuideStep>): Array<GuideSnippet> {
  return steps.flatMap((step: GuideStep): Array<GuideSnippet> => {
    return [
      ...(step.snippets || []),
      ...(step.tabs
        ? step.tabs.tabs.flatMap((tab: GuideTab): Array<GuideSnippet> => {
            return tab.snippets;
          })
        : []),
    ];
  });
}

function questionSnippets(
  questions: Array<GuideQuestion>,
): Array<GuideSnippet> {
  return questions.flatMap((question: GuideQuestion): Array<GuideSnippet> => {
    return question.snippets || [];
  });
}

// Every snippet a guide's page shows, in the page's order.
export function guideSnippets(guide: OpenTelemetryGuide): Array<GuideSnippet> {
  return [
    ...guide.install.snippets,
    ...(guide.install.tabs
      ? guide.install.tabs.tabs.flatMap(
          (tab: GuideTab): Array<GuideSnippet> => {
            return tab.snippets;
          },
        )
      : []),
    ...guide.configure.tabs.tabs.flatMap(
      (tab: GuideTab): Array<GuideSnippet> => {
        return tab.snippets;
      },
    ),
    ...stepSnippets(guide.setup.steps),
    ...guide.autoInstrumentation.snippets,
    ...guide.manualSpans.snippets,
    ...guide.logs.snippets,
    ...guide.metrics.snippets,
    ...guide.sampling.snippets,
    ...guide.deploy.snippets,
    ...stepSnippets(guide.verify.steps),
    ...questionSnippets(guide.troubleshooting),
    ...questionSnippets(guide.faq),
  ];
}

export function findGuideSnippet(
  guide: OpenTelemetryGuide,
  id: string,
): GuideSnippet | undefined {
  return guideSnippets(guide).find((snippet: GuideSnippet): boolean => {
    return snippet.id === id;
  });
}
