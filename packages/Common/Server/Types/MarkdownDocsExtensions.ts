import { MarkedExtension, RendererThis, Token, Tokens } from "marked";
import SafeHtml from "../../Types/SafeHtml";

/*
 * Block components for the docs, written in plain Markdown.
 *
 * A docs page used to have three ways to break up text: headings, lists and
 * tables. Procedures, alternatives ("Docker Compose or Kubernetes?"), "where
 * to go next" and asides all came out as one more paragraph. These extensions
 * give authors - and translators, who only ever see Markdown - a small set of
 * components that read well as raw text too (the /docs/as-markdown endpoints
 * and llms.txt serve the source as written):
 *
 *   :::steps            A numbered procedure. Each heading inside starts a
 *   ### Install         step, and keeps its id, so a step can be linked to
 *   ...                 and is listed under "On this page".
 *   :::
 *
 *   :::tabs             Alternatives, one shown at a time. The reader's pick
 *   @tab Docker         is remembered and applied to every tab set on the
 *   ...                 page that offers the same label.
 *   @tab Kubernetes
 *   ...
 *   :::
 *
 *   :::cards            A grid of links. Each list item is a card: its first
 *   - [Monitors](/docs/monitor/create-monitor): Watch websites and APIs.
 *   :::
 *
 *   :::details Why?     A section that starts folded.
 *   ...
 *   :::
 *
 *   :::warning Title    A callout; the title is optional. Also note, tip,
 *   ...                 info, important, caution and danger. GitHub's
 *   :::                 `> [!NOTE]` alerts work as well (see the blockquote
 *                       renderer in Markdown.ts).
 *
 * Containers nest (tabs inside a step, a callout inside a tab), and a fenced
 * code block inside one is left alone, so a `:::` line in a code sample never
 * closes anything. A container that is never closed is not a container: its
 * lines stay text, which the docs content tests report.
 *
 * Everything the reader sees in a default label ("Note", "Warning") is
 * marked with data-docs-label, so the docs app can put it into the page's
 * language: the renderer itself does not know which language it is rendering.
 */

export const DOCS_CALLOUT_TYPES: ReadonlyArray<string> = [
  "note",
  "tip",
  "info",
  "important",
  "warning",
  "caution",
  "danger",
];

export const DOCS_CONTAINER_NAMES: ReadonlyArray<string> = [
  "steps",
  "tabs",
  "cards",
  "details",
  ...DOCS_CALLOUT_TYPES,
];

// English default labels; the docs app swaps them for the page's language.
export const DOCS_CALLOUT_LABELS: Readonly<Record<string, string>> = {
  note: "Note",
  tip: "Tip",
  info: "Info",
  important: "Important",
  warning: "Warning",
  caution: "Caution",
  danger: "Danger",
};

// Heroicons outline paths, drawn in a 24x24 box with currentColor.
export const DOCS_CALLOUT_ICONS: Readonly<Record<string, string>> = {
  note: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>`,
  info: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>`,
  tip: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>`,
  important: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"/>`,
  warning: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"/>`,
  caution: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"/>`,
  danger: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>`,
};

export interface DocsContainerMatch {
  // The exact text the container takes up, its closing line's newline too.
  raw: string;
  name: string;
  // Whatever follows the name on the opening line, trimmed.
  argument: string;
  body: string;
}

const OPENING_LINE: RegExp =
  /^ {0,3}:{3,}[ \t]*([a-z]+)(?:[ \t]+(.*?))?[ \t]*$/;
const CONTAINER_START: RegExp = new RegExp(
  `^ {0,3}:{3,}[ \\t]*(?:${DOCS_CONTAINER_NAMES.join("|")})(?:[ \\t]|$)`,
  "m",
);
const CLOSING_LINE: RegExp = /^ {0,3}:{3,}[ \t]*$/;
const FENCE_OPEN: RegExp = /^ {0,3}(`{3,}|~{3,})/;
const TAB_LINE: RegExp = /^ {0,3}@tab[ \t]+(.+?)[ \t]*$/;
// A card link that leaves the docs.
const EXTERNAL_URL: RegExp = /^https?:\/\//i;

interface FenceState {
  marker: string;
  length: number;
}

/*
 * Walks lines the way a reader of the source would: a fenced code block is
 * opaque, and containers nest. `visit` is told each line's index, whether it
 * is inside a fence, and the container depth before the line is applied.
 */
const walkLines: (
  lines: Array<string>,
  visit: (index: number, inFence: boolean, depth: number) => boolean | void,
  startDepth: number,
) => void = (
  lines: Array<string>,
  visit: (index: number, inFence: boolean, depth: number) => boolean | void,
  startDepth: number,
): void => {
  let fence: FenceState | null = null;
  let depth: number = startDepth;

  for (let index: number = 0; index < lines.length; index++) {
    const line: string = lines[index]!;

    if (fence) {
      const closing: RegExpMatchArray | null = line.match(
        /^ {0,3}(`{3,}|~{3,})[ \t]*$/,
      );

      if (
        closing &&
        closing[1]![0] === fence.marker &&
        closing[1]!.length >= fence.length
      ) {
        fence = null;
      }

      if (visit(index, true, depth) === true) {
        return;
      }
      continue;
    }

    const opening: RegExpMatchArray | null = line.match(FENCE_OPEN);

    if (opening) {
      fence = { marker: opening[1]![0]!, length: opening[1]!.length };

      if (visit(index, true, depth) === true) {
        return;
      }
      continue;
    }

    if (visit(index, false, depth) === true) {
      return;
    }

    if (CLOSING_LINE.test(line)) {
      depth--;
    } else if (isOpeningLine(line)) {
      depth++;
    }
  }
};

const isOpeningLine: (line: string) => boolean = (line: string): boolean => {
  const match: RegExpMatchArray | null = line.match(OPENING_LINE);
  return Boolean(match && DOCS_CONTAINER_NAMES.includes(match[1]!));
};

/*
 * The container at the very start of `src`, or null when `src` does not open
 * one, opens one with a name we do not know, or never closes it.
 */
export const readDocsContainer: (src: string) => DocsContainerMatch | null = (
  src: string,
): DocsContainerMatch | null => {
  const newline: number = src.indexOf("\n");
  const firstLine: string = newline === -1 ? src : src.slice(0, newline);
  const opening: RegExpMatchArray | null = firstLine.match(OPENING_LINE);

  if (!opening || !DOCS_CONTAINER_NAMES.includes(opening[1]!)) {
    return null;
  }

  const lines: Array<string> = src.split("\n");
  let closingIndex: number = -1;

  walkLines(
    lines.slice(1),
    (index: number, inFence: boolean, depth: number): boolean => {
      if (!inFence && depth === 1 && CLOSING_LINE.test(lines[index + 1]!)) {
        closingIndex = index + 1;
        return true;
      }
      return false;
    },
    1,
  );

  if (closingIndex === -1) {
    return null;
  }

  const consumed: Array<string> = lines.slice(0, closingIndex + 1);
  const hasTrailingNewline: boolean = closingIndex < lines.length - 1;

  return {
    raw: consumed.join("\n") + (hasTrailingNewline ? "\n" : ""),
    name: opening[1]!,
    argument: (opening[2] || "").trim(),
    body: lines.slice(1, closingIndex).join("\n"),
  };
};

export interface DocsTabSource {
  label: string;
  body: string;
}

/*
 * A tabs container's body, split at its own `@tab` lines - not at ones inside
 * a code sample or a nested container. Text before the first `@tab` is
 * returned as `intro`.
 */
export const splitDocsTabs: (body: string) => {
  intro: string;
  tabs: Array<DocsTabSource>;
} = (body: string): { intro: string; tabs: Array<DocsTabSource> } => {
  const lines: Array<string> = body.split("\n");
  const starts: Array<{ index: number; label: string }> = [];

  walkLines(
    lines,
    (index: number, inFence: boolean, depth: number): void => {
      if (inFence || depth !== 0) {
        return;
      }
      const tab: RegExpMatchArray | null = lines[index]!.match(TAB_LINE);
      if (tab) {
        starts.push({ index: index, label: tab[1]! });
      }
    },
    0,
  );

  const intro: string = lines
    .slice(0, starts.length > 0 ? starts[0]!.index : lines.length)
    .join("\n");

  const tabs: Array<DocsTabSource> = starts.map(
    (start: { index: number; label: string }, position: number) => {
      const end: number =
        position + 1 < starts.length
          ? starts[position + 1]!.index
          : lines.length;
      return {
        label: start.label,
        body: lines.slice(start.index + 1, end).join("\n"),
      };
    },
  );

  return { intro: intro, tabs: tabs };
};

// The value a tab label is matched on: case and spacing do not matter.
export const docsTabKey: (label: string) => string = (
  label: string,
): string => {
  return label
    .toLowerCase()
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
};

const escapeHtml: (text: string) => string = (text: string): string => {
  return SafeHtml.escape(text);
};

export const renderDocsCallout: (data: {
  type: string;
  title: string | null;
  bodyHtml: string;
}) => string = (data: {
  type: string;
  title: string | null;
  bodyHtml: string;
}): string => {
  const type: string = DOCS_CALLOUT_TYPES.includes(data.type)
    ? data.type
    : "note";
  const icon: string = DOCS_CALLOUT_ICONS[type]!;
  // A default label is marked so the docs app can translate it.
  const label: string = data.title
    ? `<span class="docs-callout__label">${data.title}</span>`
    : `<span class="docs-callout__label" data-docs-label="${type}">${DOCS_CALLOUT_LABELS[type]}</span>`;

  return `<div class="docs-callout docs-callout--${type}">
          <div class="docs-callout__head">
            <svg class="docs-callout__icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>
            ${label}
          </div>
          <div class="docs-callout__body">${data.bodyHtml}</div>
        </div>`;
};

interface DocsContainerToken extends Tokens.Generic {
  type: "docsContainer";
  raw: string;
  name: string;
  argument: string;
  argumentTokens: Array<Token>;
  tokens: Array<Token>;
  tabs: Array<{ label: string; tokens: Array<Token> }>;
}

// The first link in a run of inline tokens, looking inside emphasis too.
const findLink: (
  tokens: Array<Token>,
) => { link: Tokens.Link; topIndex: number } | null = (
  tokens: Array<Token>,
): { link: Tokens.Link; topIndex: number } | null => {
  for (let index: number = 0; index < tokens.length; index++) {
    const token: Token = tokens[index]!;

    if (token.type === "link") {
      return { link: token as Tokens.Link, topIndex: index };
    }

    if (
      (token.type === "strong" || token.type === "em") &&
      (token as Tokens.Strong).tokens
    ) {
      const inner: { link: Tokens.Link; topIndex: number } | null = findLink(
        (token as Tokens.Strong).tokens,
      );
      if (inner) {
        return { link: inner.link, topIndex: index };
      }
    }
  }

  return null;
};

// "— text", ": text", "- text" after a card's link: the separator is not text.
const stripLeadingSeparator: (tokens: Array<Token>) => Array<Token> = (
  tokens: Array<Token>,
): Array<Token> => {
  if (tokens.length === 0 || tokens[0]!.type !== "text") {
    return tokens;
  }

  const first: Tokens.Text = tokens[0] as Tokens.Text;
  const stripped: string = first.text.replace(/^\s*(?:[—–:|-]\s*)?/, "");

  if (stripped.length === 0) {
    return tokens.slice(1);
  }

  // Plain text from here on: the separator's own inline tokens are dropped.
  const rest: Tokens.Text = { type: "text", raw: stripped, text: stripped };

  return [rest, ...tokens.slice(1)];
};

const renderCards: (
  parser: RendererThis["parser"],
  tokens: Array<Token>,
) => string = (
  parser: RendererThis["parser"],
  tokens: Array<Token>,
): string => {
  const cards: Array<string> = [];

  for (const token of tokens) {
    if (token.type !== "list") {
      if (token.type !== "space") {
        // Anything that is not a list is kept, above the grid.
        cards.push(
          `<div class="docs-cards__extra">${parser.parse([token])}</div>`,
        );
      }
      continue;
    }

    for (const item of (token as Tokens.List).items) {
      const [lead, ...rest]: Array<Token> = item.tokens;
      const inline: Array<Token> =
        lead && (lead.type === "text" || lead.type === "paragraph")
          ? (lead as Tokens.Text).tokens || []
          : [];
      const found: { link: Tokens.Link; topIndex: number } | null =
        findLink(inline);
      const more: string = rest.length > 0 ? parser.parse(rest) : "";

      if (!found) {
        cards.push(
          `<div class="docs-card docs-card--static"><span class="docs-card__icon" aria-hidden="true"></span><span class="docs-card__body">${parser.parseInline(inline)}${more}</span></div>`,
        );
        continue;
      }

      const before: Array<Token> = inline.slice(0, found.topIndex);
      const after: Array<Token> = stripLeadingSeparator(
        inline.slice(found.topIndex + 1),
      );
      const title: string = parser.parseInline(found.link.tokens);
      const description: string =
        parser.parseInline(before) + parser.parseInline(after) + more;
      const href: string = escapeHtml(found.link.href);
      const isExternal: boolean = EXTERNAL_URL.test(found.link.href);
      const external: string = isExternal
        ? ' target="_blank" rel="noopener noreferrer"'
        : "";

      cards.push(
        `<a class="docs-card" href="${href}"${external}><span class="docs-card__icon" aria-hidden="true"></span><span class="docs-card__title">${title}</span>${
          description.trim()
            ? `<span class="docs-card__body">${description}</span>`
            : ""
        }</a>`,
      );
    }
  }

  return `<div class="docs-cards">${cards.join("")}</div>`;
};

const renderSteps: (
  parser: RendererThis["parser"],
  tokens: Array<Token>,
) => string = (
  parser: RendererThis["parser"],
  tokens: Array<Token>,
): string => {
  const depths: Array<number> = tokens
    .filter((token: Token): boolean => {
      return token.type === "heading";
    })
    .map((token: Token): number => {
      return (token as Tokens.Heading).depth;
    });

  if (depths.length === 0) {
    // No headings: a plain numbered list, drawn as steps.
    return `<div class="docs-steps docs-steps--list">${parser.parse(tokens)}</div>`;
  }

  const stepDepth: number = Math.min(...depths);
  const intro: Array<Token> = [];
  const steps: Array<{ heading: Token; body: Array<Token> }> = [];

  for (const token of tokens) {
    if (
      token.type === "heading" &&
      (token as Tokens.Heading).depth === stepDepth
    ) {
      steps.push({ heading: token, body: [] });
    } else if (steps.length === 0) {
      intro.push(token);
    } else {
      steps[steps.length - 1]!.body.push(token);
    }
  }

  const introHtml: string = intro.some((token: Token): boolean => {
    return token.type !== "space";
  })
    ? parser.parse(intro)
    : "";

  return `${introHtml}<ol class="docs-steps" role="list">${steps
    .map((step: { heading: Token; body: Array<Token> }): string => {
      return `<li class="docs-step">${parser.parse([step.heading])}<div class="docs-step__body">${parser.parse(step.body)}</div></li>`;
    })
    .join("")}</ol>`;
};

/*
 * Ids for tab sets, unique within one rendered page: the counter is reset by
 * the preprocess hook each time a page starts rendering.
 */
let tabSetCounter: number = 0;

const renderTabs: (
  parser: RendererThis["parser"],
  token: DocsContainerToken,
) => string = (
  parser: RendererThis["parser"],
  token: DocsContainerToken,
): string => {
  const setId: string = `docs-tabs-${++tabSetCounter}`;
  const introHtml: string = token.tokens.some((inner: Token): boolean => {
    return inner.type !== "space";
  })
    ? parser.parse(token.tokens)
    : "";

  const buttons: string = token.tabs
    .map(
      (tab: { label: string; tokens: Array<Token> }, index: number): string => {
        const label: string = escapeHtml(tab.label);
        return `<button type="button" role="tab" class="docs-tabs__tab" id="${setId}-tab-${index}" aria-controls="${setId}-panel-${index}" aria-selected="${index === 0 ? "true" : "false"}" tabindex="${index === 0 ? "0" : "-1"}" data-docs-tab="${escapeHtml(docsTabKey(tab.label))}">${label}</button>`;
      },
    )
    .join("");

  /*
   * Every panel is in the page, each under its own label, so the page reads
   * in order without scripting and search engines see all of it. The page's
   * script turns the set into tabs (see Scripts.ejs) and hides the labels.
   */
  const panels: string = token.tabs
    .map(
      (tab: { label: string; tokens: Array<Token> }, index: number): string => {
        return `<div class="docs-tabs__panel${index === 0 ? " is-active" : ""}" role="tabpanel" id="${setId}-panel-${index}" aria-labelledby="${setId}-tab-${index}" tabindex="0" data-docs-tab="${escapeHtml(docsTabKey(tab.label))}"><p class="docs-tabs__panel-label">${escapeHtml(tab.label)}</p>${parser.parse(tab.tokens)}</div>`;
      },
    )
    .join("");

  return `${introHtml}<div class="docs-tabs" data-docs-tabs id="${setId}"><div class="docs-tabs__list" role="tablist">${buttons}</div>${panels}</div>`;
};

export const docsMarkdownExtensions: MarkedExtension = {
  hooks: {
    preprocess: (markdown: string): string => {
      tabSetCounter = 0;
      return markdown;
    },
  },
  extensions: [
    {
      name: "docsContainer",
      level: "block",
      /*
       * Only the names we know: marked ends a paragraph wherever this says a
       * container might start, so a stray ":::word" line must not count.
       */
      start: (src: string): number | undefined => {
        const match: RegExpMatchArray | null = src.match(CONTAINER_START);
        return match ? match.index : undefined;
      },
      tokenizer: function (src: string): DocsContainerToken | undefined {
        const container: DocsContainerMatch | null = readDocsContainer(src);

        if (!container) {
          return undefined;
        }

        const token: DocsContainerToken = {
          type: "docsContainer",
          raw: container.raw,
          name: container.name,
          argument: container.argument,
          argumentTokens: [],
          tokens: [],
          tabs: [],
        };

        if (container.argument) {
          this.lexer.inlineTokens(container.argument, token.argumentTokens);
        }

        if (container.name === "tabs") {
          const split: { intro: string; tabs: Array<DocsTabSource> } =
            splitDocsTabs(container.body);
          this.lexer.blockTokens(split.intro, token.tokens);
          for (const tab of split.tabs) {
            const tabTokens: Array<Token> = [];
            this.lexer.blockTokens(tab.body, tabTokens);
            token.tabs.push({ label: tab.label, tokens: tabTokens });
          }
        } else {
          this.lexer.blockTokens(container.body, token.tokens);
        }

        return token;
      },
      renderer: function (this: RendererThis, generic: Tokens.Generic): string {
        const token: DocsContainerToken = generic as DocsContainerToken;
        const argumentHtml: string = token.argument
          ? this.parser.parseInline(token.argumentTokens)
          : "";

        switch (token.name) {
          case "steps":
            return renderSteps(this.parser, token.tokens);
          case "tabs":
            return renderTabs(this.parser, token);
          case "cards":
            return renderCards(this.parser, token.tokens);
          case "details":
            return `<details class="docs-details"><summary class="docs-details__summary">${
              argumentHtml || '<span data-docs-label="details">Details</span>'
            }</summary><div class="docs-details__body">${this.parser.parse(token.tokens)}</div></details>`;
          default:
            return renderDocsCallout({
              type: token.name,
              title: argumentHtml || null,
              bodyHtml: this.parser.parse(token.tokens),
            });
        }
      },
    },
  ],
};
