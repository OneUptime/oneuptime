/*
 * What LogsAiDocsFacts, TracesAiDocsFacts and MetricsAiDocsFacts read their
 * explorer page's tab table with: the sentence that counts the explorer's
 * tabs ("The explorer has six tabs:") and the table right under it, with a
 * row for each tab. Kept here, not in any one suite: importing a .test.ts
 * file runs its tests.
 *
 * The count is a fact about the Dashboard, so it is read off the Dashboard
 * and never written into a test. An explorer draws the tabs of its nav tabs
 * (Components/<Signal>/<Signal>NavTabs.tsx, which Pages/<Signal>/Layout.tsx
 * puts above each of its pages), in order, each label written in English
 * and translated as it is drawn. A tab the explorer gains, as Metrics gained
 * PromQL (#6796), fails until the English page counts it and names it in a
 * row of its own, and passes as soon as it does.
 */

// A tab of an explorer's nav tabs: `label: "Setup Guide"`.
const TAB_LABEL: RegExp = /label: "([^"]+)"/g;

// The sentence that opens the table, its count in words.
const TAB_COUNT_SENTENCE: RegExp = /^The explorer has \S+ tabs:$/;

const NUMBER_WORDS: ReadonlyArray<string> = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
];

export interface ExplorerTabTable {
  // The sentence that counts the tabs: "The explorer has six tabs:".
  sentence: string;
  // The tabs, in order: the table's first column, bold markers dropped.
  tabs: Array<string>;
}

/*
 * The tabs an explorer draws, in order, read from its nav tabs' source, and
 * the sentence that counts them.
 */
export function drawnExplorerTabs(navTabsSource: string): ExplorerTabTable {
  const tabs: Array<string> = Array.from(
    navTabsSource.matchAll(TAB_LABEL),
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );

  return {
    sentence: `The explorer has ${NUMBER_WORDS[tabs.length]} tabs:`,
    tabs: tabs,
  };
}

/*
 * The sentence an English explorer page counts its tabs with, and the tabs
 * the table right under it names: none when the page has no such sentence,
 * or something other than a table follows it.
 */
export function writtenExplorerTabs(markdown: string): ExplorerTabTable {
  const lines: Array<string> = markdown.split("\n");
  const at: number = lines.findIndex((line: string): boolean => {
    return TAB_COUNT_SENTENCE.test(line);
  });

  if (at < 0) {
    return { sentence: "", tabs: [] };
  }

  const table: Array<string> = [];

  for (const line of lines.slice(at + 1)) {
    if (line.startsWith("|")) {
      table.push(line);
    } else if (table.length > 0 || line.trim() !== "") {
      break;
    }
  }

  // The body rows: the header and the delimiter row come first.
  const tabs: Array<string> = table.slice(2).map((row: string): string => {
    return (row.split("|")[1] || "").trim().split("**").join("");
  });

  return { sentence: lines[at] as string, tabs: tabs };
}
