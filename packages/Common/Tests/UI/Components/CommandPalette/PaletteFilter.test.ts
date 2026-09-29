import {
  filterPaletteCommands,
  getHighlightSegments,
  getPaletteSectionId,
  isSubsequenceMatch,
  normalizePaletteQuery,
  PaletteCommandMatch,
  PaletteHighlightSegment,
  PaletteMatchRank,
  rankPaletteCommand,
} from "../../../../UI/Components/CommandPalette/PaletteFilter";
import { PaletteCommand } from "../../../../UI/Components/CommandPalette/Types";
import { describe, expect, test } from "@jest/globals";

type MakeCommandFunction = (
  id: string,
  title: string,
  category: string,
  keywords?: Array<string>,
) => PaletteCommand;

const makeCommand: MakeCommandFunction = (
  id: string,
  title: string,
  category: string,
  keywords?: Array<string>,
): PaletteCommand => {
  return {
    id,
    title,
    category,
    keywords,
    onSelect: (): void => {},
  };
};

describe("normalizePaletteQuery", () => {
  test("trims whitespace and lowercases", () => {
    expect(normalizePaletteQuery("  MoNiToRs  ")).toBe("monitors");
    expect(normalizePaletteQuery("   ")).toBe("");
  });
});

describe("isSubsequenceMatch", () => {
  test("matches characters in order with gaps", () => {
    expect(isSubsequenceMatch("mtr", "monitors")).toBe(true);
  });

  test("rejects characters out of order", () => {
    expect(isSubsequenceMatch("rtm", "monitors")).toBe(false);
  });

  test("rejects characters that are missing entirely", () => {
    expect(isSubsequenceMatch("xyz", "monitors")).toBe(false);
  });

  test("an empty needle matches anything", () => {
    expect(isSubsequenceMatch("", "monitors")).toBe(true);
  });
});

describe("rankPaletteCommand", () => {
  test("title prefix wins over everything", () => {
    const command: PaletteCommand = makeCommand("a", "Monitors", "Monitoring", [
      "monitor",
    ]);
    expect(rankPaletteCommand(command, "mon")).toBe(
      PaletteMatchRank.TitlePrefix,
    );
  });

  test("title substring ranks below prefix", () => {
    const command: PaletteCommand = makeCommand("a", "Create Monitor", "Other");
    expect(rankPaletteCommand(command, "mon")).toBe(
      PaletteMatchRank.TitleSubstring,
    );
  });

  test("keyword match ranks below title matches", () => {
    const command: PaletteCommand = makeCommand("a", "Uptime", "Other", [
      "monitor",
      "checks",
    ]);
    expect(rankPaletteCommand(command, "mon")).toBe(PaletteMatchRank.Keyword);
  });

  test("category match ranks below keyword", () => {
    const command: PaletteCommand = makeCommand("a", "Stats", "Monitoring");
    expect(rankPaletteCommand(command, "mon")).toBe(PaletteMatchRank.Category);
  });

  test("title subsequence is the last resort", () => {
    // "mtr" is not a substring of anything here, but m→t→r appear in order.
    const command: PaletteCommand = makeCommand("a", "Metrics", "Other");
    expect(rankPaletteCommand(command, "mtr")).toBe(
      PaletteMatchRank.TitleSubsequence,
    );
  });

  test("no match at all returns null", () => {
    const command: PaletteCommand = makeCommand("a", "Logs", "Telemetry");
    expect(rankPaletteCommand(command, "zzz")).toBe(null);
  });

  test("matching is case-insensitive", () => {
    const command: PaletteCommand = makeCommand("a", "MONITORS", "Other");
    expect(rankPaletteCommand(command, "mon")).toBe(
      PaletteMatchRank.TitlePrefix,
    );
  });
});

describe("filterPaletteCommands", () => {
  test("orders results prefix > substring > keyword > category > subsequence", () => {
    const commands: Array<PaletteCommand> = [
      // Deliberately listed in reverse rank order to prove sorting happens.
      makeCommand("subsequence", "Man on wire", "Zeta"),
      makeCommand("category", "Stats", "Monitoring"),
      makeCommand("keyword", "Uptime", "Other", ["monitor"]),
      makeCommand("substring", "Create Monitor", "Other"),
      makeCommand("prefix", "Monitors", "Other"),
      makeCommand("excluded", "Logs", "Telemetry"),
    ];

    const matches: Array<PaletteCommandMatch> = filterPaletteCommands(
      commands,
      "mon",
    );

    expect(
      matches.map((match: PaletteCommandMatch) => {
        return match.command.id;
      }),
    ).toEqual(["prefix", "substring", "keyword", "category", "subsequence"]);
  });

  test("keeps catalog order within the same rank tier", () => {
    const commands: Array<PaletteCommand> = [
      makeCommand("first", "Monitors", "A"),
      makeCommand("second", "Monitor Groups", "B"),
      makeCommand("third", "Monitoring Secrets", "C"),
    ];

    const matches: Array<PaletteCommandMatch> = filterPaletteCommands(
      commands,
      "mon",
    );

    expect(
      matches.map((match: PaletteCommandMatch) => {
        return match.command.id;
      }),
    ).toEqual(["first", "second", "third"]);
  });

  test("an empty or whitespace query matches everything in original order", () => {
    const commands: Array<PaletteCommand> = [
      makeCommand("one", "Alpha", "A"),
      makeCommand("two", "Beta", "B"),
    ];

    expect(
      filterPaletteCommands(commands, "   ").map(
        (match: PaletteCommandMatch) => {
          return match.command.id;
        },
      ),
    ).toEqual(["one", "two"]);
  });

  test("excludes commands that match nowhere", () => {
    const commands: Array<PaletteCommand> = [
      makeCommand("only", "Monitors", "Other"),
      makeCommand("gone", "Logs", "Telemetry"),
    ];

    const matches: Array<PaletteCommandMatch> = filterPaletteCommands(
      commands,
      "monitors",
    );

    expect(matches).toHaveLength(1);
    expect(matches[0]!.command.id).toBe("only");
  });
});

describe("getHighlightSegments", () => {
  test("marks a single case-insensitive occurrence, preserving original casing", () => {
    const segments: Array<PaletteHighlightSegment> = getHighlightSegments(
      "Monitors",
      "mon",
    );

    expect(segments).toEqual([
      { text: "Mon", isMatch: true },
      { text: "itors", isMatch: false },
    ]);
  });

  test("marks every occurrence", () => {
    const segments: Array<PaletteHighlightSegment> = getHighlightSegments(
      "on and on",
      "on",
    );

    expect(segments).toEqual([
      { text: "on", isMatch: true },
      { text: " and ", isMatch: false },
      { text: "on", isMatch: true },
    ]);
  });

  test("no occurrence yields one unmarked segment", () => {
    expect(getHighlightSegments("Monitors", "zzz")).toEqual([
      { text: "Monitors", isMatch: false },
    ]);
  });

  test("an empty query yields one unmarked segment", () => {
    expect(getHighlightSegments("Monitors", "  ")).toEqual([
      { text: "Monitors", isMatch: false },
    ]);
  });
});

describe("getPaletteSectionId", () => {
  test("slugs human titles for test ids", () => {
    expect(getPaletteSectionId("Analytics & Automation")).toBe(
      "analytics-automation",
    );
    expect(getPaletteSectionId("Essentials")).toBe("essentials");
    expect(getPaletteSectionId("  Odd  Spacing  ")).toBe("odd-spacing");
  });
});
