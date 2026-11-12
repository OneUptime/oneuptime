import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as React from "react";
import DataTableWidget from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/Widgets/DataTableWidget";
import {
  CHAT_TABLE_WHOLE_WORD_LENGTH,
  ChatTableCellPiece,
  getChatTableCellPieces,
  getChatTableWordParts,
} from "../../../UI/Utils/AIChatExport/ChatWidgetData";
import { AIChatWidget, AIChatWidgetType } from "../../../Types/AI/AIChatTypes";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * A TABLE'S SHORT WORDS STAY WHOLE ON A PHONE (issue #6969).
 *
 * Ask AI's tables let every text cell break anywhere, so an endpoint - no
 * spaces to wrap at - wrapped inside the table instead of pushing the
 * other columns out of view. But "anywhere" let a 360 px phone's table
 * make a column narrower than its words, and the monitors table drew
 * "Operational" as "Operationa" over "l" on every row.
 *
 * A cell's words are kept whole now: each wraps after its spaces and
 * hyphens, and is broken only when it is wider than the whole column. A
 * word longer than CHAT_TABLE_WHOLE_WORD_LENGTH letters between hyphens -
 * an id, a long host name - is set apart, and only it may break anywhere;
 * so is a path - an endpoint, a URL - however short its parts, which
 * wraps after its slashes first: "POST /ledger/entries" kept whole was as
 * wide as a long word, and a phone's table of endpoints no longer fit.
 * Real Chromium measures the same at 360 and 390 px in packages/E2E/AskAi
 * (thread=monitors, thread=rich).
 */

// A run of spaces, and one space, as a cell's text has them.
const SPACES: RegExp = /\s+/;
const SPACE: RegExp = /\s/;
// A slash of a path, either way it leans.
const SLASH: RegExp = /[/\\]/;

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {},
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(() => {
  cleanup();
});

// The monitors table query_monitors leaves (MonitorTools): Monitor, Type, Status.
function monitorsTable(): AIChatWidget {
  return {
    id: "W1",
    type: AIChatWidgetType.Table,
    title: "Monitors (3)",
    data: {
      columns: [
        { key: "name", title: "Monitor", type: "text" },
        { key: "type", title: "Type", type: "text" },
        { key: "currentStatus", title: "Status", type: "text" },
      ],
      rows: [
        {
          name: "https://payments.example.com/api/v2/health/checkout",
          type: "Website",
          currentStatus: "Offline",
        },
        {
          name: "legacy-payments-api",
          type: "API",
          currentStatus: "Operational",
        },
        {
          name: "Checkout API (eu-west-1)",
          type: "Incoming Request",
          currentStatus: "Disabled",
        },
      ],
    },
  };
}

function cellsOfRow(row: number): Array<HTMLElement> {
  return screen
    .getAllByTestId("ai-chat-table-cell")
    .slice(row * 3, row * 3 + 3);
}

// The texts a cell may break anywhere in, in order.
function longWordsOf(cell: HTMLElement): Array<string> {
  return within(cell)
    .queryAllByTestId("ai-chat-table-cell-long-word")
    .map((word: HTMLElement): string => {
      return word.textContent || "";
    });
}

function pieces(text: string): Array<[string, boolean]> {
  return getChatTableCellPieces(text).map(
    (piece: ChatTableCellPiece): [string, boolean] => {
      return [piece.text, piece.breaksAnywhere];
    },
  );
}

describe("a cell's words, in runs (getChatTableCellPieces)", () => {
  test("a short word is one run, kept whole", () => {
    expect(pieces("Operational")).toEqual([["Operational", false]]);
    expect(pieces("Investigating")).toEqual([["Investigating", false]]);
  });

  test("short words with their spaces are one run", () => {
    expect(pieces("Incoming Request")).toEqual([["Incoming Request", false]]);
    expect(pieces("Brute force from one address · sshd")).toEqual([
      ["Brute force from one address · sshd", false],
    ]);
  });

  test("an endpoint's path is a run of its own, which may break anywhere; the words beside it are not", () => {
    expect(
      pieces("POST /api/v2/checkout/sessions/{sessionId}/confirm"),
    ).toEqual([
      ["POST ", false],
      ["/api/v2/checkout/sessions/{sessionId}/confirm", true],
    ]);
    expect(
      pieces("Checkout API (https://payments.example.com/health) is down"),
    ).toEqual([
      ["Checkout API ", false],
      ["(https://payments.example.com/health)", true],
      [" is down", false],
    ]);
  });

  test("a path is a run of its own, which may break anywhere however short its parts", () => {
    expect(pieces("POST /ledger/entries")).toEqual([
      ["POST ", false],
      ["/ledger/entries", true],
    ]);
    expect(pieces("api/v2")).toEqual([["api/v2", true]]);
    expect(pieces("C:\\Windows\\System32 on host-01")).toEqual([
      ["C:\\Windows\\System32", true],
      [" on host-01", false],
    ]);
    // Short, and never broken all the same: a text column is 5rem at least.
    expect(pieces("N/A")).toEqual([["N/A", true]]);
  });

  test("a word wraps after its hyphens, so its longest part between them is what counts", () => {
    expect(pieces("legacy-payments-api")).toEqual([
      ["legacy-payments-api", false],
    ]);
    expect(pieces("payments-worker-eu-west-1-production")).toEqual([
      ["payments-worker-eu-west-1-production", false],
    ]);
    expect(pieces("svc-0123456789abcdef0123")).toEqual([
      ["svc-0123456789abcdef0123", true],
    ]);
  });

  test(`up to ${CHAT_TABLE_WHOLE_WORD_LENGTH} letters is a word; one more is a token that may break anywhere`, () => {
    expect(CHAT_TABLE_WHOLE_WORD_LENGTH).toBe(16);
    expect(pieces("a".repeat(16))).toEqual([["a".repeat(16), false]]);
    expect(pieces("a".repeat(17))).toEqual([["a".repeat(17), true]]);
    // A German word of the product's own: whole.
    expect(pieces("Betriebsbereit")).toEqual([["Betriebsbereit", false]]);
  });

  test("letters as a person counts them: an emoji or a CJK character is one", () => {
    const sixteenFaces: string = "\u{1F642}".repeat(16);
    expect(sixteenFaces.length).toBe(32);
    expect(pieces(sixteenFaces)).toEqual([[sixteenFaces, false]]);
    expect(pieces(`${sixteenFaces}\u{1F642}`)).toEqual([
      [`${sixteenFaces}\u{1F642}`, true],
    ]);
    expect(pieces("監視は無効です")).toEqual([["監視は無効です", false]]);
  });

  test("the spaces are kept as they were, and never break anywhere", () => {
    expect(pieces("  Operational  ")).toEqual([["  Operational  ", false]]);
    expect(pieces("a\tb\nc")).toEqual([["a\tb\nc", false]]);
    expect(
      pieces(`${"x".repeat(20)}${" ".repeat(20)}${"y".repeat(20)}`),
    ).toEqual([
      ["x".repeat(20), true],
      [" ".repeat(20), false],
      ["y".repeat(20), true],
    ]);
  });

  test("nothing, no runs", () => {
    expect(pieces("")).toEqual([]);
  });

  test("any text: its runs put back together are the text, two whole runs never side by side, each run's kind true to its words", () => {
    const alphabet: Array<string> = [
      "a",
      "b",
      "/",
      "\\",
      ":",
      "-",
      " ",
      " ",
      "\t",
      "é",
      "\u{1F642}",
    ];
    const random: SeededRandom = seededRandom(6969);

    for (let round: number = 0; round < 2000; round++) {
      const length: number = random(60);
      let text: string = "";
      for (let index: number = 0; index < length; index++) {
        // Runs of one letter now and then, long enough to pass the limit.
        const letter: string = alphabet[random(alphabet.length)]!;
        text += random(7) === 0 ? letter.repeat(random(20)) : letter;
      }

      const runs: Array<ChatTableCellPiece> = getChatTableCellPieces(text);

      expect(
        runs
          .map((run: ChatTableCellPiece): string => {
            return run.text;
          })
          .join(""),
      ).toBe(text);

      for (let index: number = 0; index < runs.length; index++) {
        const run: ChatTableCellPiece = runs[index]!;
        expect(run.text).not.toBe("");

        const longest: number = Math.max(
          0,
          ...run.text.split(SPACES).flatMap((word: string): Array<number> => {
            return word.split("-").map((part: string): number => {
              return Array.from(part).length;
            });
          }),
        );

        if (run.breaksAnywhere) {
          // One word: a path, or with a part past the limit.
          expect(run.text.trim()).toBe(run.text);
          expect(run.text).not.toMatch(SPACE);
          expect(
            SLASH.test(run.text) || longest > CHAT_TABLE_WHOLE_WORD_LENGTH,
          ).toBe(true);
        } else {
          expect(run.text).not.toMatch(SLASH);
          expect(longest).toBeLessThanOrEqual(CHAT_TABLE_WHOLE_WORD_LENGTH);
          if (index > 0) {
            expect(runs[index - 1]!.breaksAnywhere).toBe(true);
          }
        }
      }
    }
  });
});

describe("a long word's parts, which it wraps between first (getChatTableWordParts)", () => {
  test("a path wraps after each run of slashes inside it", () => {
    expect(
      getChatTableWordParts("/api/v2/checkout/sessions/{sessionId}/confirm"),
    ).toEqual([
      "/api/",
      "v2/",
      "checkout/",
      "sessions/",
      "{sessionId}/",
      "confirm",
    ]);
    expect(getChatTableWordParts("/ledger/entries")).toEqual([
      "/ledger/",
      "entries",
    ]);
    expect(getChatTableWordParts("src//lib/index.ts")).toEqual([
      "src//",
      "lib/",
      "index.ts",
    ]);
    expect(getChatTableWordParts("C:\\Windows\\System32\\svchost.exe")).toEqual(
      ["C:\\Windows\\", "System32\\", "svchost.exe"],
    );
  });

  test("the slashes a word starts with stay with its first part: alone on a line they say nothing", () => {
    expect(getChatTableWordParts("/ledger")).toEqual(["/ledger"]);
    expect(getChatTableWordParts("//cdn.example.com/app.js")).toEqual([
      "//cdn.example.com/",
      "app.js",
    ]);
  });

  test("the slashes after a colon stay with the name after them: a URL's scheme with its host", () => {
    expect(
      getChatTableWordParts(
        "https://payments.example.com/api/v2/health/checkout",
      ),
    ).toEqual([
      "https://payments.example.com/",
      "api/",
      "v2/",
      "health/",
      "checkout",
    ]);
    expect(
      getChatTableWordParts("(https://payments.example.com/health)"),
    ).toEqual(["(https://payments.example.com/", "health)"]);
    // A port's colon is not before a slash: the path still wraps after it.
    expect(getChatTableWordParts("db-01:5432/payments")).toEqual([
      "db-01:5432/",
      "payments",
    ]);
  });

  test("a slash at the end stays with the last part", () => {
    expect(getChatTableWordParts("api/v2/")).toEqual(["api/", "v2/"]);
    expect(getChatTableWordParts("https://example.com/")).toEqual([
      "https://example.com/",
    ]);
  });

  test("a word with no slash is one part, slashes alone are one, and nothing is none", () => {
    expect(getChatTableWordParts("svc-0123456789abcdef0123")).toEqual([
      "svc-0123456789abcdef0123",
    ]);
    expect(getChatTableWordParts("//")).toEqual(["//"]);
    expect(getChatTableWordParts("")).toEqual([]);
  });

  test("letters as a person counts them are never split: a slash is never half of one", () => {
    expect(getChatTableWordParts("\u{1F642}/\u{1F642}/監視")).toEqual([
      "\u{1F642}/",
      "\u{1F642}/",
      "監視",
    ]);
  });

  test("any word: its parts put back together are the word, each ends after a run of slashes not after a colon, and none could wrap sooner", () => {
    const alphabet: Array<string> = [
      "a",
      "/",
      "\\",
      ":",
      ".",
      "-",
      "é",
      "\u{1F642}",
    ];
    const random: SeededRandom = seededRandom(69690);

    for (let round: number = 0; round < 2000; round++) {
      const length: number = random(30);
      let word: string = "";
      for (let index: number = 0; index < length; index++) {
        const letter: string = alphabet[random(alphabet.length)]!;
        word += random(5) === 0 ? letter.repeat(1 + random(3)) : letter;
      }

      const parts: Array<string> = getChatTableWordParts(word);

      expect(parts.join("")).toBe(word);
      if (!word) {
        expect(parts).toEqual([]);
        continue;
      }

      for (let index: number = 0; index < parts.length; index++) {
        const part: string = parts[index]!;
        const letters: Array<string> = Array.from(part);
        expect(part).not.toBe("");

        if (index < parts.length - 1) {
          // Ends after a run of slashes, which a colon is not just before...
          expect(letters[letters.length - 1]).toMatch(SLASH);
          const beforeRun: string | undefined = letters
            .slice(0, letters.length)
            .reverse()
            .find((letter: string): boolean => {
              return !SLASH.test(letter);
            });
          expect(beforeRun).toBeDefined();
          expect(beforeRun).not.toBe(":");
          // ...and the next part starts with a letter, not a slash.
          expect(parts[index + 1]![0]).not.toMatch(SLASH);
        }

        /*
         * None could wrap sooner: inside a part, a slash before a letter
         * is one of the slashes it starts with, or comes after a colon.
         */
        for (let at: number = 1; at < letters.length; at++) {
          if (SLASH.test(letters[at - 1]!) && !SLASH.test(letters[at]!)) {
            const before: Array<string> = letters
              .slice(0, at)
              .filter((letter: string): boolean => {
                return !SLASH.test(letter);
              });
            const lastBefore: string | undefined = before[before.length - 1];
            expect(lastBefore === undefined || lastBefore === ":").toBe(true);
          }
        }
      }
    }
  });
});

describe("the monitors table's cells (#6969)", () => {
  test("a status keeps its word whole: wrapped at its spaces only, never anywhere", () => {
    render(<DataTableWidget widget={monitorsTable()} />);

    for (const [row, status] of [
      [0, "Offline"],
      [1, "Operational"],
      [2, "Disabled"],
    ] as const) {
      const cell: HTMLElement = cellsOfRow(row)[2]!;
      const text: HTMLElement = cell.firstElementChild as HTMLElement;

      expect(text.textContent).toBe(status);
      expect(text).toHaveClass("line-clamp-3", "break-words");
      expect(text).not.toHaveClass("[overflow-wrap:anywhere]");
      expect(longWordsOf(cell)).toEqual([]);
      expect(cell.innerHTML).not.toContain("anywhere");
    }
  });

  test("a monitor's URL for a name may break anywhere: it has no spaces to wrap at", () => {
    render(<DataTableWidget widget={monitorsTable()} />);

    const name: HTMLElement = cellsOfRow(0)[0]!;

    expect(name).toHaveAttribute(
      "title",
      "https://payments.example.com/api/v2/health/checkout",
    );
    expect(longWordsOf(name)).toEqual([
      "https://payments.example.com/api/v2/health/checkout",
    ]);
    expect(
      within(name).getByTestId("ai-chat-table-cell-long-word"),
    ).toHaveClass("[overflow-wrap:anywhere]");
    expect(name).toHaveClass("min-w-[5rem]");
  });

  test("a path is drawn with a place to wrap after its slashes, its letters as they are", () => {
    const widget: AIChatWidget = monitorsTable();
    widget.data.rows = [
      {
        name: "https://payments.example.com/api/v2/health/checkout",
        type: "Website",
        currentStatus: "Offline",
      },
      {
        name: "POST /ledger/entries",
        type: "API",
        currentStatus: "Operational",
      },
      {
        name: "svc-0123456789abcdef0123",
        type: "API",
        currentStatus: "Operational",
      },
    ];

    render(<DataTableWidget widget={widget} />);

    const url: HTMLElement = within(cellsOfRow(0)[0]!).getByTestId(
      "ai-chat-table-cell-long-word",
    );
    expect(url.textContent).toBe(
      "https://payments.example.com/api/v2/health/checkout",
    );
    expect(url.innerHTML).toBe(
      "https://payments.example.com/<wbr>api/<wbr>v2/<wbr>health/<wbr>checkout",
    );

    const endpoint: HTMLElement = cellsOfRow(1)[0]!;
    expect(endpoint.textContent).toBe("POST /ledger/entries");
    expect(longWordsOf(endpoint)).toEqual(["/ledger/entries"]);
    expect(
      within(endpoint).getByTestId("ai-chat-table-cell-long-word").innerHTML,
    ).toBe("/ledger/<wbr>entries");

    // A long word with no slash has no place to wrap but anywhere.
    const id: HTMLElement = within(cellsOfRow(2)[0]!).getByTestId(
      "ai-chat-table-cell-long-word",
    );
    expect(id.innerHTML).toBe("svc-0123456789abcdef0123");
    expect(id.querySelector("wbr")).toBeNull();
  });

  test("a hyphenated name and words with spaces wrap whole, as they read", () => {
    render(<DataTableWidget widget={monitorsTable()} />);

    expect(longWordsOf(cellsOfRow(1)[0]!)).toEqual([]);
    expect(cellsOfRow(1)[0]!.textContent).toBe("legacy-payments-api");
    expect(longWordsOf(cellsOfRow(2)[0]!)).toEqual([]);
    expect(longWordsOf(cellsOfRow(2)[1]!)).toEqual([]);
    expect(cellsOfRow(2)[1]!.textContent).toBe("Incoming Request");
  });

  test("only a long token is set apart: the words beside it stay in the cell's own text", () => {
    const widget: AIChatWidget = monitorsTable();
    widget.data.rows = [
      {
        name: "Checkout API (https://payments.example.com/api/v2/health) EU",
        type: "Website",
        currentStatus: "Operational",
      },
    ];

    render(<DataTableWidget widget={widget} />);

    const name: HTMLElement = cellsOfRow(0)[0]!;
    const text: HTMLElement = name.firstElementChild as HTMLElement;

    expect(text.textContent).toBe(
      "Checkout API (https://payments.example.com/api/v2/health) EU",
    );
    expect(longWordsOf(name)).toEqual([
      "(https://payments.example.com/api/v2/health)",
    ]);
    expect(
      Array.from(text.childNodes).map((node: ChildNode): string => {
        return node.nodeType === Node.TEXT_NODE
          ? `text:${node.textContent}`
          : `long:${node.textContent}`;
      }),
    ).toEqual([
      "text:Checkout API ",
      "long:(https://payments.example.com/api/v2/health)",
      "text: EU",
    ]);
  });

  test("no text cell of the table breaks every word anywhere", () => {
    render(<DataTableWidget widget={monitorsTable()} />);

    for (const cell of screen.getAllByTestId("ai-chat-table-cell")) {
      expect(cell).not.toHaveClass("[overflow-wrap:anywhere]");
      expect(cell.firstElementChild).not.toHaveClass(
        "[overflow-wrap:anywhere]",
      );
    }
  });

  test("a number and a date keep their one line, as before", () => {
    const widget: AIChatWidget = {
      id: "W2",
      type: AIChatWidgetType.Table,
      title: "Checks",
      data: {
        columns: [
          { key: "at", title: "Checked", type: "date" },
          { key: "ms", title: "Response (ms)", type: "number" },
          { key: "status", title: "Status", type: "text" },
        ],
        rows: [
          {
            at: "2026-11-12T09:30:00.000Z",
            ms: 1234567,
            status: "Operational",
          },
        ],
      },
    };

    render(<DataTableWidget widget={widget} />);

    const [date, number, status] = screen.getAllByTestId("ai-chat-table-cell");
    expect(date).toHaveClass("whitespace-nowrap");
    expect(date!.querySelector("time")).not.toBeNull();
    expect(number).toHaveClass("whitespace-nowrap", "text-right");
    expect(longWordsOf(number!)).toEqual([]);
    expect(longWordsOf(status!)).toEqual([]);
    expect(status!.firstElementChild).toHaveClass("break-words");
  });
});
