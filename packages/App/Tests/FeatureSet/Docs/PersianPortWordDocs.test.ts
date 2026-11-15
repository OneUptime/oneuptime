// UX rule: Docs/ux/README.md#in-every-language
import { wordsOf } from "../../Dashboard/OneNamePerThing";
import {
  DocsBlock,
  PairedBlock,
  ownWordsOf,
  pairedBlocksOf,
} from "./DocsBlocks";
import { describe, expect, test } from "@jest/globals";
import { readDashboardLocale } from "Common/Tests/Helpers/DashboardLocales";

/*
 * THE PERSIAN DOCS CALL A NETWORK PORT پورت, NEVER درگاه (#7932).
 *
 * The Persian product names a port پورت (پورت‌ها for ports): the Port
 * monitor, a probe's ports, a receiver's port field. درگاه is a gateway or a
 * portal (an SMS and call gateway, the Azure portal), and the Dashboard keeps
 * it for those only (DashboardWordsInPersian, #7284). The docs still said
 * درگاه for a port on about 80 lines of 30 pages: a Persian reader was told
 * to free "gateway 443" or open "gateway 8080", and the Docker Compose page's
 * headings about the ports the stack listens on said درگاه.
 *
 * A Persian page follows its English page block for block (DocsBlocks), so
 * each block is read beside its English:
 *
 *   - a block whose English says port or ports, and no gateway or portal,
 *     never says درگاه;
 *   - a block whose English says both says درگاه no more often than its
 *     English names a gateway or a portal ("the gateway's upstream service
 *     port" is دروازه and پورت, or درگاه once);
 *   - the word is the Dashboard's, read from its locale (Port, Ports);
 *   - a gateway keeps درگاه (control), and nearly every block naming a port
 *     says پورت, so a third word cannot take its place.
 *
 * Code, link targets and placeholders are not words, and what a block has
 * word for word from its English block is the English kept as written
 * (ownWordsOf).
 */

const LANGUAGE: string = "fa";
const GATEWAY_WORD: RegExp = /درگاه/g;
const GATEWAY_WORD_ONCE: RegExp = /درگاه/;
const NAMES_A_PORT: RegExp = /\bports?\b/i;
const NAMES_A_GATEWAY: RegExp = /gateway|portal/gi;

function count(pattern: RegExp, text: string): number {
  return Array.from(text.matchAll(new RegExp(pattern.source, "gi"))).length;
}

/*
 * What is wrong with a Persian block beside its English: null, or the
 * reason. Both are read as words (wordsOf).
 */
function portProblem(english: string, persian: string): string | null {
  const said: string = wordsOf(english);
  const text: string = wordsOf(persian);

  if (!NAMES_A_PORT.test(said)) {
    return null;
  }

  const gateways: number = count(NAMES_A_GATEWAY, said);
  const saysGateway: number = count(GATEWAY_WORD, text);

  if (saysGateway > gateways) {
    return gateways === 0
      ? "says درگاه for a port: write پورت"
      : `says درگاه ${saysGateway} times where its English names ${gateways} gateway or portal: a port is پورت`;
  }

  return null;
}

function blocks(): Array<PairedBlock> {
  const { paired, unpaired } = pairedBlocksOf(LANGUAGE);

  expect(
    unpaired.filter((page: string): boolean => {
      return page === "installation/docker-compose";
    }),
  ).toEqual([]);

  return paired;
}

function englishOf(block: PairedBlock): string {
  return block.english.text;
}

function persianOf(block: PairedBlock): string {
  return ownWordsOf(block.english, block.translation);
}

function block(text: string): DocsBlock {
  return { line: 0, text, code: false, diagram: false };
}

describe("a port is پورت in the Persian docs (#7932)", () => {
  test("the Dashboard's word is پورت, and پورت‌ها", () => {
    const words: Record<string, string> = readDashboardLocale(LANGUAGE);

    expect(words["Port"]).toBe("پورت");
    expect(words["Ports"]).toBe("پورت‌ها");
  });

  test("no block whose English names a port says درگاه for it", () => {
    const problems: Array<string> = blocks().flatMap(
      (paired: PairedBlock): Array<string> => {
        const problem: string | null = portProblem(
          englishOf(paired),
          persianOf(paired),
        );

        return problem
          ? [
              `packages/App/FeatureSet/Docs/Content/fa/${paired.page}.md:${paired.line} ${problem}`,
            ]
          : [];
      },
    );

    expect(problems).toEqual([]);
  });

  test("hundreds of blocks name a port, and nearly every one says پورت", () => {
    const naming: Array<PairedBlock> = blocks().filter(
      (paired: PairedBlock): boolean => {
        return (
          NAMES_A_PORT.test(wordsOf(englishOf(paired))) &&
          persianOf(paired).trim() !== ""
        );
      },
    );
    const port: string = readDashboardLocale(LANGUAGE)["Port"]!;
    const saying: number = naming.filter((paired: PairedBlock): boolean => {
      return wordsOf(persianOf(paired)).includes(port);
    }).length;

    expect(naming.length).toBeGreaterThan(400);
    expect(saying / naming.length).toBeGreaterThan(0.9);
  });

  test("a gateway and a portal keep درگاه (control)", () => {
    const gateways: Array<PairedBlock> = blocks().filter(
      (paired: PairedBlock): boolean => {
        return (
          count(NAMES_A_GATEWAY, wordsOf(englishOf(paired))) > 0 &&
          !NAMES_A_PORT.test(wordsOf(englishOf(paired))) &&
          GATEWAY_WORD_ONCE.test(persianOf(paired))
        );
      },
    );

    expect(gateways.length).toBeGreaterThan(20);
    expect(
      gateways.some((paired: PairedBlock): boolean => {
        return paired.page === "self-hosted/sms-and-call-gateway";
      }),
    ).toBe(true);
  });

  test("the Docker Compose page's headings about its ports say پورت‌ها", () => {
    const headings: Array<string> = blocks()
      .filter((paired: PairedBlock): boolean => {
        return (
          paired.page === "installation/docker-compose" &&
          paired.translation.text.startsWith("#") &&
          NAMES_A_PORT.test(paired.english.text)
        );
      })
      .map((paired: PairedBlock): string => {
        return paired.translation.text;
      });

    expect(headings).toEqual(
      expect.arrayContaining([
        "#### ingress را از پورت‌های ۸۰ و ۴۴۳ جابه‌جا کنید",
        "#### OneUptime را روی پورت‌های تازه دوباره اجرا کنید",
      ]),
    );
    expect(
      headings.filter((heading: string): boolean => {
        return GATEWAY_WORD_ONCE.test(heading);
      }),
    ).toEqual([]);
  });
});

describe("the check of a Persian block for درگاه (controls)", () => {
  test("finds a port written as a gateway", () => {
    expect(
      portProblem(
        "Free ports 80 and 443 first.",
        "نخست درگاه‌های ۸۰ و ۴۴۳ را آزاد کنید.",
      ),
    ).toBe("says درگاه for a port: write پورت");
    expect(
      portProblem("Open port 8080.", "درگاه ۸۰۸۰ را باز کنید."),
    ).not.toBeNull();
  });

  test("passes پورت, a gateway and a portal", () => {
    expect(
      portProblem(
        "Free ports 80 and 443 first.",
        "نخست پورت‌های ۸۰ و ۴۴۳ را آزاد کنید.",
      ),
    ).toBeNull();
    expect(
      portProblem(
        "Set up your SMS gateway.",
        "درگاه پیامک خود را راه بیندازید.",
      ),
    ).toBeNull();
    expect(
      portProblem(
        "In the Azure portal, open the resource.",
        "در درگاه Azure منبع را باز کنید.",
      ),
    ).toBeNull();
  });

  test("a block naming a gateway and a port may say درگاه for the gateway only", () => {
    expect(
      portProblem(
        "The gateway listens on port 443.",
        "درگاه روی پورت ۴۴۳ گوش می‌دهد.",
      ),
    ).toBeNull();
    expect(
      portProblem(
        "The gateway listens on port 443.",
        "درگاه روی درگاه ۴۴۳ گوش می‌دهد.",
      ),
    ).toBe(
      "says درگاه 2 times where its English names 1 gateway or portal: a port is پورت",
    );
  });

  test("a port in code, a link's target or a word like report is not a port", () => {
    expect(portProblem("Export the report.", "درگاه")).toBeNull();
    expect(
      portProblem(
        "Set `DATABASE_PUBLISHED_PORT`.",
        "`DATABASE_PUBLISHED_PORT` را در درگاه تنظیم کنید.",
      ),
    ).toBeNull();
    expect(
      portProblem(
        "See [the gateway](/docs/monitor/port-monitor).",
        "[درگاه](/docs/monitor/port-monitor) را ببینید.",
      ),
    ).toBeNull();
  });

  test("an English row kept as written is not read", () => {
    expect(
      persianOf({
        page: "x",
        line: 1,
        english: block("| `PROBE_PORT` | The port to listen on |"),
        translation: block("| `PROBE_PORT` | The port to listen on |"),
      }),
    ).toBe("");
  });
});
