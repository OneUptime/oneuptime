import { cardLines, cardTargets } from "./DocsTranslationChecks";

/*
 * Getting Started, the docs' front door (issue #6822), read the way its
 * suites check it. It chooses a path before it lists anything:
 *
 *   ## What do you want to do?   the eight jobs people come with (#6821)
 *   ## New to OneUptime?         Quickstart, Core Concepts, Glossary, Which One
 *   ## Coming from another tool  the import, its two tables folded
 *   ## How OneUptime fits together
 *   ## Explore the docs          one folded `:::details <section>` per sidebar
 *                                section, its cards inside
 *   ## Next steps
 */

export const GETTING_STARTED_PAGE: string = "introduction/getting-started";

/*
 * The eight jobs of "What do you want to do?", in #6821's order, each with
 * the page that answers it today. When #6821 writes a job's guide, its card
 * (in every language) and its target here move to the guide together.
 */
export const GETTING_STARTED_JOBS: ReadonlyArray<{
  job: string;
  target: string;
}> = [
  {
    job: "Know when your website or API is down",
    target: "/docs/guides/website-down",
  },
  {
    job: "Get paged by phone, SMS or push, and escalate",
    target: "/docs/guides/paging",
  },
  {
    job: "Publish a status page on your own domain",
    target: "/docs/guides/status-page",
  },
  {
    job: "Send logs, metrics and traces",
    target: "/docs/telemetry/open-telemetry",
  },
  { job: "Monitor a server", target: "/docs/telemetry/hosts" },
  {
    job: "Monitor a Kubernetes cluster",
    target: "/docs/telemetry/kubernetes-agent",
  },
  { job: "Bring your team in", target: "/docs/permissions/index" },
  {
    job: "Run an incident from the first page to the postmortem",
    target: "/docs/incidents/index",
  },
];

// What "New to OneUptime?" opens, in order.
export const GETTING_STARTED_NEWCOMER_TARGETS: ReadonlyArray<string> = [
  "/docs/introduction/quickstart",
  "/docs/introduction/core-concepts",
  "/docs/introduction/glossary",
  "/docs/introduction/which-one",
];

// The "## " sections of a page, by heading text, each with the lines under it.
export const pageSections: (
  markdown: string,
) => Array<{ heading: string; body: string }> = (
  markdown: string,
): Array<{ heading: string; body: string }> => {
  const sections: Array<{ heading: string; lines: Array<string> }> = [];
  let inFence: boolean = false;

  for (const line of markdown.split("\n")) {
    if (line.trim().startsWith("```")) {
      inFence = !inFence;
    }

    if (!inFence && line.startsWith("## ")) {
      sections.push({ heading: line.slice(3).trim(), lines: [] });
      continue;
    }

    sections[sections.length - 1]?.lines.push(line);
  }

  return sections.map((section: { heading: string; lines: Array<string> }) => {
    return { heading: section.heading, body: section.lines.join("\n") };
  });
};

// The "## " section at a place on the page (0 is the first).
export const sectionAt: (markdown: string, place: number) => string = (
  markdown: string,
  place: number,
): string => {
  const section: { body: string } | undefined = pageSections(markdown)[place];

  if (!section) {
    throw new Error(`No section ${place}`);
  }

  return section.body;
};

// The targets of the cards a "## " section at a place holds, in order.
export const cardTargetsAt: (
  markdown: string,
  place: number,
) => Array<string> = (markdown: string, place: number): Array<string> => {
  return cardTargets(cardLines(sectionAt(markdown, place)));
};

const CONTAINER_OPEN: RegExp = /^:::(\S+)\s*(.*)$/;
const CONTAINER_CLOSE: RegExp = /^:::\s*$/;

// Every folded `:::details <title>` block of a piece of Markdown, with its lines.
export const foldedBlocks: (
  markdown: string,
) => Array<{ title: string; lines: Array<string> }> = (
  markdown: string,
): Array<{ title: string; lines: Array<string> }> => {
  const blocks: Array<{ title: string; lines: Array<string> }> = [];
  let current: { title: string; lines: Array<string> } | null = null;
  let depth: number = 0;

  for (const line of markdown.split("\n")) {
    const opens: RegExpMatchArray | null = line.match(CONTAINER_OPEN);

    if (opens) {
      if (!current && opens[1] === "details") {
        current = { title: (opens[2] || "").trim(), lines: [] };
        depth = 1;
        continue;
      }
      depth++;
    } else if (CONTAINER_CLOSE.test(line)) {
      depth--;
      if (current && depth === 0) {
        blocks.push(current);
        current = null;
        continue;
      }
    }

    current?.lines.push(line);
  }

  return blocks;
};

/*
 * Explore the docs: each sidebar section's title, as its fold names it,
 * with the targets of the cards inside it.
 */
export const exploreSections: (
  markdown: string,
  place: number,
) => Array<{ title: string; targets: Array<string> }> = (
  markdown: string,
  place: number,
): Array<{ title: string; targets: Array<string> }> => {
  return foldedBlocks(sectionAt(markdown, place)).map(
    (block: { title: string; lines: Array<string> }) => {
      return {
        title: block.title,
        targets: cardTargets(cardLines(block.lines.join("\n"))),
      };
    },
  );
};

// The card lines of one sidebar section's fold under Explore the docs.
export const exploreCardLines: (
  markdown: string,
  place: number,
  title: string,
) => Array<string> = (
  markdown: string,
  place: number,
  title: string,
): Array<string> => {
  const block: { title: string; lines: Array<string> } | undefined =
    foldedBlocks(sectionAt(markdown, place)).find(
      (candidate: { title: string }): boolean => {
        return candidate.title === title;
      },
    );

  if (!block) {
    throw new Error(`No fold "${title}" under Explore the docs`);
  }

  return cardLines(block.lines.join("\n"));
};

// Where each part of the front door is, as a "## " section's place on the page.
export const GETTING_STARTED_PLACES: {
  jobs: number;
  newcomers: number;
  comingFrom: number;
  fitsTogether: number;
  explore: number;
  nextSteps: number;
} = {
  jobs: 0,
  newcomers: 1,
  comingFrom: 2,
  fitsTogether: 3,
  explore: 4,
  nextSteps: 5,
};
