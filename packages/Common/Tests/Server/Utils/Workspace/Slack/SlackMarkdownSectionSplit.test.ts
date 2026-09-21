import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * Slack rejects a section whose text is over 3000 characters, and a message
 * with more than 50 blocks (100 in a modal view) — and it rejects the whole
 * message, not the one block. chat.postMessage answers ok:false and the
 * caller only logs it, so an "Incident Created" message whose root cause
 * carried a long Affected Resources list silently never reached the channel.
 *
 * These tests pin how SlackUtil turns a markdown payload into sections:
 *
 * - text that fits is one section, byte for byte what it always was,
 * - longer text becomes consecutive sections of at most 3000 characters,
 *   split between paragraphs first, then between list items (an item keeps
 *   its nested bullets), then between lines, and only inside a line that is
 *   longer than the limit on its own,
 * - code blocks cut by a section boundary are closed and reopened,
 * - the message never goes over Slack's block limit: extra sections come out
 *   of what the other blocks leave, and text that still does not fit is cut
 *   short with a note pointing to OneUptime.
 */

import SlackifyMarkdown from "slackify-markdown";
import SlackUtil from "../../../../../Server/Utils/Workspace/Slack/Slack";
import WorkspaceBase, {
  WorkspaceSendMessageResponse,
} from "../../../../../Server/Utils/Workspace/WorkspaceBase";
import AffectedResourceList, {
  AffectedResourceListEntry,
} from "../../../../../Server/Utils/Monitor/AffectedResourceList";
import logger from "../../../../../Server/Utils/Logger";
import API from "../../../../../Utils/API";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import URL from "../../../../../Types/API/URL";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import {
  WorkspaceMessageBlock,
  WorkspaceModalBlock,
  WorkspacePayloadButtons,
  WorkspacePayloadDivider,
  WorkspacePayloadHeader,
  WorkspacePayloadMarkdown,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";

const MAX_LENGTH: number = SlackUtil.SECTION_TEXT_MAX_LENGTH;
const NOTE: string = SlackUtil.TRUNCATED_SECTION_NOTE;

interface PostCallArgs {
  url: URL;
  data: JSONObject;
}

function markdown(text: string): WorkspacePayloadMarkdown {
  return {
    _type: "WorkspacePayloadMarkdown",
    text: text,
  };
}

function divider(): WorkspacePayloadDivider {
  return {
    _type: "WorkspacePayloadDivider",
  };
}

function header(text: string): WorkspacePayloadHeader {
  return {
    _type: "WorkspacePayloadHeader",
    text: text,
  };
}

function buttons(): WorkspacePayloadButtons {
  return {
    _type: "WorkspacePayloadButtons",
    buttons: [
      {
        _type: "WorkspaceMessagePayloadButton",
        title: "🔗 View Incident",
        value: "incident-id",
        actionId: "ViewIncident",
        url: URL.fromString("https://oneuptime.test/dashboard/incidents/1"),
      },
      {
        _type: "WorkspaceMessagePayloadButton",
        title: "✅ Acknowledge",
        value: "incident-id",
        actionId: "AcknowledgeIncident",
      },
    ],
  };
}

// What a markdown payload rendered to before sections could be split.
function legacySection(text: string): JSONObject {
  return {
    type: "section",
    text: {
      type: "mrkdwn",
      text: text ? SlackifyMarkdown(text) : "",
    },
  };
}

function isSection(block: JSONObject): boolean {
  return block["type"] === "section";
}

function sectionText(block: JSONObject): string {
  return (block["text"] as JSONObject)["text"] as string;
}

function sectionTexts(blocks: Array<JSONObject>): Array<string> {
  return blocks.filter(isSection).map(sectionText);
}

function repeatLines(data: {
  count: number;
  line: (index: number) => string;
}): Array<string> {
  const lines: Array<string> = [];

  for (let index: number = 0; index < data.count; index++) {
    lines.push(data.line(index));
  }

  return lines;
}

// A string of exactly `length` characters that says where it is.
function filler(label: string, length: number): string {
  return (label + ":" + "x".repeat(length)).slice(0, length);
}

function hasLoneSurrogate(text: string): boolean {
  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);

    if (code >= 0xd800 && code <= 0xdbff) {
      const next: number = text.charCodeAt(index + 1);

      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return true;
      }

      index++;
      continue;
    }

    if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }

  return false;
}

// The limits Slack enforces on what we send it.
function expectValidSlackBlocks(
  blocks: Array<JSONObject>,
  maxBlocks: number,
): void {
  expect(blocks.length).toBeLessThanOrEqual(maxBlocks);

  for (const text of sectionTexts(blocks)) {
    expect(text.length).toBeLessThanOrEqual(MAX_LENGTH);
    expect(hasLoneSurrogate(text)).toBe(false);
  }
}

/*
 * The sections are consecutive, non-overlapping slices of the original with
 * nothing but whitespace (the newlines they were split at) between them —
 * so no content is lost, duplicated or reordered.
 */
function expectSlicesOfOriginal(original: string, pieces: Array<string>): void {
  let cursor: number = 0;

  for (const piece of pieces) {
    expect(piece.length).toBeGreaterThan(0);

    const index: number = original.indexOf(piece, cursor);

    expect(index).toBeGreaterThanOrEqual(cursor);
    expect(original.slice(cursor, index).trim()).toBe("");

    cursor = index + piece.length;
  }

  expect(original.slice(cursor).trim()).toBe("");
}

/*
 * A root cause the way the Kubernetes monitor writes one when containers
 * are crash-looping: cluster details, the ranked Affected Resources list
 * (ten container-level entries, the longest kind), then the analysis.
 */
function buildKubernetesRootCause(): string {
  const entries: Array<AffectedResourceListEntry> = [];

  for (let index: number = 0; index < 10; index++) {
    entries.push({
      kind: "Container",
      name: `${AffectedResourceList.code(`checkout-worker-${index}`)} in pod ${AffectedResourceList.code(`checkout-service-7d9f8b6c5d-x2k9q${index}`)}`,
      value: `**${20 - index}**`,
      details: [
        {
          label: "Namespace",
          value: AffectedResourceList.code("payments-production"),
        },
        {
          label: "Deployment",
          value: AffectedResourceList.code("checkout-service"),
        },
        {
          label: "Node",
          value: AffectedResourceList.code(
            `gke-gke-prod-cluster-default-pool-662f6819-c6w${index}`,
          ),
        },
      ],
    });
  }

  const clusterDetails: string = [
    "**Kubernetes Cluster Details**",
    "- Cluster: gke-prod-cluster",
    "- Metric: Container Restarts (`k8s.container.restarts`)",
    "- Namespace: payments-production",
  ].join("\n");

  const affectedResources: string = AffectedResourceList.render({
    heading: "Affected Resources",
    overflowNoun: "affected resources",
    totalCount: 83,
    entries: entries,
  });

  const analysis: string = [
    "**Root Cause Analysis**",
    "Container `checkout-worker-0` in pod `checkout-service-7d9f8b6c5d-x2k9q0` has restarted 20 times in the evaluation window. " +
      "Frequent restarts usually mean the container is crashing on start (CrashLoopBackOff), being OOMKilled because it exceeds its memory limit, " +
      "or failing its liveness probe. Check the previous container logs with `kubectl logs --previous` and the pod events with `kubectl describe pod`.",
  ].join("\n");

  return `${clusterDetails}${affectedResources}\n\n${analysis}`;
}

// The feed text IncidentService.createIncidentFeedAsync posts to Slack.
function buildIncidentCreatedFeed(rootCause: string): string {
  return `#### 🚨 Incident #4211 Created:

**Container restarts in payments-production**:

Containers in the checkout service are restarting repeatedly on gke-prod-cluster.

🔴 **Incident State**: Created

⚠️ **Severity**: Critical

🌎 **Resources Affected**:
- [Kubernetes: gke-prod-cluster container restarts](https://oneuptime.test/dashboard/${ObjectID.generate().toString()}/monitors/${ObjectID.generate().toString()})



\n
📄 **Root Cause**:

${rootCause}

`;
}

/*
 * Many paragraphs — far more than MAX_SECTIONS_PER_MARKDOWN_BLOCK sections
 * could ever hold.
 */
function buildAbsurdlyLongMarkdown(): string {
  return repeatLines({
    count: 2000,
    line: (index: number): string => {
      return `Paragraph ${index}: ${"lorem ipsum dolor sit amet ".repeat(4)}`;
    },
  }).join("\n\n");
}

describe("SlackUtil.splitSectionText", () => {
  test("returns text that fits unchanged, as the only section", () => {
    const text: string = "*Incident created*\n\nSomething happened.\n";

    expect(SlackUtil.splitSectionText({ text: text })).toEqual([text]);
  });

  test("returns empty text as a single empty section", () => {
    expect(SlackUtil.splitSectionText({ text: "" })).toEqual([""]);
  });

  test("keeps text of exactly 3000 characters whole", () => {
    const text: string = `${filler("a", 1500)}\n\n${filler("b", 1498)}`;

    expect(text.length).toBe(3000);
    expect(SlackUtil.splitSectionText({ text: text })).toEqual([text]);
  });

  test("splits text of 3001 characters at its paragraph break", () => {
    const first: string = filler("a", 1500);
    const second: string = filler("b", 1499);
    const text: string = `${first}\n\n${second}`;

    expect(text.length).toBe(3001);
    expect(SlackUtil.splitSectionText({ text: text })).toEqual([first, second]);
  });

  test("hard-cuts a single 3001-character line into 3000 + 1", () => {
    const text: string = "x".repeat(3001);

    expect(SlackUtil.splitSectionText({ text: text })).toEqual([
      "x".repeat(3000),
      "x",
    ]);
  });

  test("moves a whole paragraph to the next section rather than splitting it", () => {
    const paragraphA: string = repeatLines({
      count: 4,
      line: (index: number): string => {
        return filler(`a${index}`, 499);
      },
    }).join("\n");

    const paragraphB: string = repeatLines({
      count: 3,
      line: (index: number): string => {
        return filler(`b${index}`, 499);
      },
    }).join("\n");

    /*
     * Two of paragraph B's lines would still fit after paragraph A, so a
     * line-by-line fill would split B across the two sections.
     */
    expect(paragraphA.length + 1 + 2 * 500).toBeLessThanOrEqual(MAX_LENGTH);

    const pieces: Array<string> = SlackUtil.splitSectionText({
      text: `${paragraphA}\n\n${paragraphB}`,
    });

    expect(pieces).toEqual([paragraphA, paragraphB]);
  });

  test("packs several short paragraphs into one section before starting another", () => {
    const paragraphs: Array<string> = repeatLines({
      count: 6,
      line: (index: number): string => {
        return filler(`p${index}`, 900);
      },
    });

    const text: string = paragraphs.join("\n\n");
    const pieces: Array<string> = SlackUtil.splitSectionText({ text: text });

    // 3 × 900 + 2 × 2 = 2704 fits; a fourth paragraph would make 3606.
    expect(pieces).toEqual([
      paragraphs.slice(0, 3).join("\n\n"),
      paragraphs.slice(3).join("\n\n"),
    ]);
  });

  test("splits a paragraph longer than the limit between its lines", () => {
    const lines: Array<string> = repeatLines({
      count: 8,
      line: (index: number): string => {
        return filler(`line${index}`, 900);
      },
    });

    const pieces: Array<string> = SlackUtil.splitSectionText({
      text: lines.join("\n"),
    });

    expect(pieces).toEqual([
      lines.slice(0, 3).join("\n"),
      lines.slice(3, 6).join("\n"),
      lines.slice(6).join("\n"),
    ]);
  });

  test("keeps a list item together with its indented bullets", () => {
    const items: Array<string> = repeatLines({
      count: 6,
      line: (index: number): string => {
        return [
          filler(`${index + 1}.  item`, 100),
          ...repeatLines({
            count: 3,
            line: (detail: number): string => {
              return filler(`    •   item ${index + 1} detail ${detail}`, 200);
            },
          }),
        ].join("\n");
      },
    });

    // Each item is 100 + 3 × 201 = 703 characters; four fit, five do not.
    const pieces: Array<string> = SlackUtil.splitSectionText({
      text: items.join("\n"),
    });

    expect(pieces).toEqual([
      items.slice(0, 4).join("\n"),
      items.slice(4).join("\n"),
    ]);

    /*
     * Filling line by line would have put item 5's title in the first
     * section and its bullets in the second.
     */
    expect(items.slice(0, 4).join("\n").length + 1 + 100 + 1).toBeLessThan(
      MAX_LENGTH,
    );
  });

  test("splits a single list item larger than the limit between its lines", () => {
    const itemLines: Array<string> = [
      filler("1.  huge item", 80),
      ...repeatLines({
        count: 5,
        line: (index: number): string => {
          return filler(`    •   detail ${index}`, 800);
        },
      }),
    ];

    const text: string = itemLines.join("\n");
    const pieces: Array<string> = SlackUtil.splitSectionText({ text: text });

    expect(pieces.length).toBe(2);
    expectSlicesOfOriginal(text, pieces);

    // Every line of every piece is a whole line of the original.
    for (const piece of pieces) {
      for (const line of piece.split("\n")) {
        expect(itemLines).toContain(line);
      }
    }
  });

  test("hard-cuts a 7000-character line without spaces into pieces of at most 3000", () => {
    const text: string = filler("unbroken", 7000);
    const pieces: Array<string> = SlackUtil.splitSectionText({ text: text });

    expect(
      pieces.map((piece: string): number => {
        return piece.length;
      }),
    ).toEqual([3000, 3000, 1000]);
    expect(pieces.join("")).toBe(text);
  });

  test("hard-cuts a long line of words at spaces, keeping every word whole", () => {
    const text: string = "incident ".repeat(800).trim();

    expect(text.length).toBeGreaterThan(7000);

    const pieces: Array<string> = SlackUtil.splitSectionText({ text: text });

    expect(pieces.length).toBe(3);
    expect(pieces.join("")).toBe(text);

    for (const piece of pieces) {
      expect(piece.length).toBeLessThanOrEqual(MAX_LENGTH);

      for (const word of piece.split(" ")) {
        expect(["incident", ""]).toContain(word);
      }
    }
  });

  test("never cuts between the two halves of an emoji", () => {
    // After the leading "a", every emoji's high surrogate sits at an odd index — 2999 among them.
    const text: string = "a" + "😀".repeat(2000);
    const pieces: Array<string> = SlackUtil.splitSectionText({ text: text });

    expect(pieces.join("")).toBe(text);
    expect(pieces[0]!.length).toBe(2999);

    for (const piece of pieces) {
      expect(piece.length).toBeLessThanOrEqual(MAX_LENGTH);
      expect(hasLoneSurrogate(piece)).toBe(false);
    }
  });

  test("never starts or ends a section with a newline, and never emits an empty one", () => {
    const text: string = `\n\n\n${filler("a", 2000)}\n\n\n\n\n${filler("b", 2000)}\n\n\n`;
    const pieces: Array<string> = SlackUtil.splitSectionText({ text: text });

    expect(pieces).toEqual([filler("a", 2000), filler("b", 2000)]);
  });

  test("returns a single empty section for text that is nothing but whitespace", () => {
    expect(SlackUtil.splitSectionText({ text: "\n".repeat(4000) })).toEqual([
      "",
    ]);
  });

  test("closes a code block at a section boundary and reopens it in the next section", () => {
    const codeLines: Array<string> = repeatLines({
      count: 120,
      line: (index: number): string => {
        return filler(`2026-09-21T10:00:${index} ERROR checkout`, 60);
      },
    });

    const text: string = `Logs from the failing pod:\n\n\`\`\`\n${codeLines.join("\n")}\n\`\`\`\n\nRestart the deployment once fixed.`;

    const pieces: Array<string> = SlackUtil.splitSectionText({ text: text });

    /*
     * The code block is a paragraph longer than a section, so it starts a
     * section of its own and is split between its lines across three.
     */
    expect(pieces.length).toBe(4);
    expect(pieces[0]).toBe("Logs from the failing pod:");

    for (let index: number = 1; index < pieces.length; index++) {
      const piece: string = pieces[index]!;

      expect(piece.length).toBeLessThanOrEqual(MAX_LENGTH);

      // Every section opens and closes its own code blocks.
      expect((piece.split("```").length - 1) % 2).toBe(0);
      expect(piece.startsWith("```\n")).toBe(true);

      if (index < pieces.length - 1) {
        expect(piece.endsWith("\n```")).toBe(true);
      }
    }

    // Every log line survives, in order.
    const allLines: Array<string> = pieces.join("\n").split("\n");
    const loggedLines: Array<string> = allLines.filter((line: string) => {
      return line.includes("ERROR checkout");
    });

    expect(loggedLines).toEqual(codeLines);
    expect(pieces[0]!.startsWith("Logs from the failing pod:")).toBe(true);
    expect(
      pieces[pieces.length - 1]!.endsWith(
        "```\n\nRestart the deployment once fixed.",
      ),
    ).toBe(true);
  });

  test("leaves a code block alone when the original never closes it", () => {
    const text: string = `\`\`\`\n${repeatLines({
      count: 80,
      line: (index: number): string => {
        return filler(`unterminated ${index}`, 60);
      },
    }).join("\n")}`;

    const pieces: Array<string> = SlackUtil.splitSectionText({ text: text });
    const lastPiece: string = pieces[pieces.length - 1]!;

    expect(pieces.length).toBe(2);
    expect(pieces[0]!.endsWith("\n```")).toBe(true);
    expect(lastPiece.startsWith("```\n")).toBe(true);
    // Nothing is added after the original's last line.
    expect(lastPiece.endsWith(filler("unterminated 79", 60))).toBe(true);
  });

  test("stops at maxSections and ends the last section with the truncation note", () => {
    const paragraphs: Array<string> = repeatLines({
      count: 30,
      line: (index: number): string => {
        return filler(`p${index}`, 1000);
      },
    });

    const text: string = paragraphs.join("\n\n");
    const untruncated: Array<string> = SlackUtil.splitSectionText({
      text: text,
      maxSections: 100,
    });

    // Two 1000-character paragraphs per section.
    expect(untruncated.length).toBe(15);

    const pieces: Array<string> = SlackUtil.splitSectionText({
      text: text,
      maxSections: 3,
    });

    expect(pieces).toEqual([
      untruncated[0],
      untruncated[1],
      untruncated[2] + NOTE,
    ]);

    for (const piece of pieces) {
      expect(piece.length).toBeLessThanOrEqual(MAX_LENGTH);
    }
  });

  test("shortens the last section at a paragraph break to make room for the note", () => {
    const first: string = filler("first", 1400);
    const second: string = filler("second", 1590);
    const third: string = filler("third", 1000);

    const pieces: Array<string> = SlackUtil.splitSectionText({
      text: [first, second, third].join("\n\n"),
      maxSections: 1,
    });

    // first + second (2992) fits a section but leaves no room for the note.
    expect(pieces).toEqual([first + NOTE]);
  });

  test("hard-cuts a single long line to make room for the note", () => {
    const pieces: Array<string> = SlackUtil.splitSectionText({
      text: filler("unbroken", 7000),
      maxSections: 1,
    });

    expect(pieces.length).toBe(1);
    expect(pieces[0]!.length).toBe(MAX_LENGTH);
    expect(pieces[0]!.endsWith(NOTE)).toBe(true);
    expect(pieces[0]!.startsWith(filler("unbroken", 2000))).toBe(true);
  });

  test("closes an open code block before the truncation note", () => {
    const text: string = `\`\`\`\n${repeatLines({
      count: 500,
      line: (index: number): string => {
        return filler(`trace ${index}`, 60);
      },
    }).join("\n")}\n\`\`\``;

    const pieces: Array<string> = SlackUtil.splitSectionText({
      text: text,
      maxSections: 2,
    });

    expect(pieces.length).toBe(2);
    expect(pieces[1]!.startsWith("```\n")).toBe(true);
    expect(pieces[1]!.endsWith("\n```" + NOTE)).toBe(true);

    for (const piece of pieces) {
      expect(piece.length).toBeLessThanOrEqual(MAX_LENGTH);
      expect((piece.split("```").length - 1) % 2).toBe(0);
    }
  });

  test("treats a maxSections below one as one", () => {
    const pieces: Array<string> = SlackUtil.splitSectionText({
      text: filler("zero", 5000),
      maxSections: 0,
    });

    expect(pieces.length).toBe(1);
    expect(pieces[0]!.endsWith(NOTE)).toBe(true);
  });

  test("defaults to MAX_SECTIONS_PER_MARKDOWN_BLOCK sections", () => {
    const pieces: Array<string> = SlackUtil.splitSectionText({
      text: buildAbsurdlyLongMarkdown(),
    });

    expect(pieces.length).toBe(SlackUtil.MAX_SECTIONS_PER_MARKDOWN_BLOCK);
    expect(pieces[pieces.length - 1]!.endsWith(NOTE)).toBe(true);
  });
});

describe("SlackUtil markdown sections", () => {
  test("renders short markdown as exactly one section, identical to the SlackifyMarkdown output", () => {
    const text: string =
      "#### 🚨 Incident #12 Created:\n\n**Checkout is down**\n\n- [Checkout API](https://oneuptime.test/monitors/1)\n";

    expect(
      SlackUtil.getMarkdownBlocks({ payloadMarkdownBlock: markdown(text) }),
    ).toEqual([legacySection(text)]);

    expect(
      SlackUtil.getMarkdownBlock({ payloadMarkdownBlock: markdown(text) }),
    ).toEqual(legacySection(text));

    expect(
      SlackUtil.getBlocksFromWorkspaceMessagePayload({
        messageBlocks: [markdown(text)],
      }),
    ).toEqual([legacySection(text)]);
  });

  test("renders empty text as one section with empty text, as before", () => {
    const expected: Array<JSONObject> = [
      { type: "section", text: { type: "mrkdwn", text: "" } },
    ];

    expect(
      SlackUtil.getBlocksFromWorkspaceMessagePayload({
        messageBlocks: [markdown("")],
      }),
    ).toEqual(expected);

    expect(
      SlackUtil.getMarkdownBlock({ payloadMarkdownBlock: markdown("") }),
    ).toEqual(expected[0]);
  });

  test("keeps markdown that slackifies to exactly 3000 characters in one section", () => {
    const text: string = `${"a".repeat(1500)}\n\n${"b".repeat(1497)}`;

    // slackify-markdown ends its output with a newline.
    expect(SlackifyMarkdown(text).length).toBe(3000);

    expect(
      SlackUtil.getBlocksFromWorkspaceMessagePayload({
        messageBlocks: [markdown(text)],
      }),
    ).toEqual([legacySection(text)]);
  });

  test("splits markdown that slackifies to 3001 characters into two sections", () => {
    const text: string = `${"a".repeat(1500)}\n\n${"b".repeat(1498)}`;

    expect(SlackifyMarkdown(text).length).toBe(3001);

    expect(
      sectionTexts(
        SlackUtil.getBlocksFromWorkspaceMessagePayload({
          messageBlocks: [markdown(text)],
        }),
      ),
    ).toEqual(["a".repeat(1500), "b".repeat(1498)]);
  });

  test("hard-cuts a 7000-character line into sections of at most 3000", () => {
    const line: string = "z".repeat(7000);

    const texts: Array<string> = sectionTexts(
      SlackUtil.getMarkdownBlocks({ payloadMarkdownBlock: markdown(line) }),
    );

    expect(
      texts.map((text: string): number => {
        return text.length;
      }),
    ).toEqual([3000, 3000, 1000]);
    expect(texts.join("")).toBe(line);
  });

  test("getMarkdownBlock cuts long text short with a note instead of returning an invalid section", () => {
    const block: JSONObject = SlackUtil.getMarkdownBlock({
      payloadMarkdownBlock: markdown(buildAbsurdlyLongMarkdown()),
    });

    expect(block["type"]).toBe("section");
    expect(sectionText(block).length).toBeLessThanOrEqual(MAX_LENGTH);
    expect(sectionText(block).endsWith(NOTE)).toBe(true);
    expect(sectionText(block).startsWith("Paragraph 0:")).toBe(true);
  });

  describe("a realistic Incident Created feed with an Affected Resources list", () => {
    const rootCause: string = buildKubernetesRootCause();
    const feed: string = buildIncidentCreatedFeed(rootCause);
    const slackified: string = SlackifyMarkdown(feed);

    const texts: Array<string> = sectionTexts(
      SlackUtil.getBlocksFromWorkspaceMessagePayload({
        messageBlocks: [markdown(feed)],
      }),
    );

    test("is too long for one section in the first place", () => {
      expect(slackified.length).toBeGreaterThan(MAX_LENGTH);
    });

    test("becomes several sections, each within Slack's limit", () => {
      expect(texts.length).toBeGreaterThan(1);

      for (const text of texts) {
        expect(text.length).toBeLessThanOrEqual(MAX_LENGTH);
      }
    });

    test("keeps all the content, in order", () => {
      expectSlicesOfOriginal(slackified, texts);

      expect(texts[0]!.startsWith("*🚨 Incident #4211 Created:*")).toBe(true);
      expect(texts.join("\n")).toContain("Root Cause Analysis");
      expect(texts.join("\n")).toContain("and 73 more affected resources");
    });

    test("never splits inside a line", () => {
      const originalLines: Set<string> = new Set(slackified.split("\n"));

      for (const text of texts) {
        for (const line of text.split("\n")) {
          expect(originalLines.has(line)).toBe(true);
        }
      }
    });

    test("keeps the whole ranked list in one section, every item with its bullets", () => {
      const listSection: string | undefined = texts.find((text: string) => {
        return text.includes("checkout-worker-0");
      });

      expect(listSection).toBeDefined();

      for (let index: number = 0; index < 10; index++) {
        expect(listSection).toContain(`\`checkout-worker-${index}\``);
        expect(listSection).toContain(
          `gke-gke-prod-cluster-default-pool-662f6819-c6w${index}`,
        );
      }

      // No section opens with a nested bullet cut off from its item.
      for (const text of texts) {
        expect(text.startsWith(" ")).toBe(false);
      }
    });
  });
});

describe("SlackUtil.getBlocksFromWorkspaceMessagePayload", () => {
  const longText: string = repeatLines({
    count: 40,
    line: (index: number): string => {
      return `Paragraph ${index}: ${"the checkout service is failing health checks ".repeat(4)}`;
    },
  }).join("\n\n");

  test("renders every other block type exactly as the base class does", () => {
    const messageBlocks: Array<WorkspaceMessageBlock> = [
      header("Incident #12 created"),
      markdown("**Checkout is down**"),
      divider(),
      buttons(),
    ];

    const expected: Array<JSONObject> =
      WorkspaceBase.getBlocksFromWorkspaceMessagePayload.call(SlackUtil, {
        messageBlocks: messageBlocks,
      });

    expect(
      SlackUtil.getBlocksFromWorkspaceMessagePayload({
        messageBlocks: messageBlocks,
      }),
    ).toEqual(expected);

    expect(expected[1]).toEqual(legacySection("**Checkout is down**"));
  });

  test("keeps the header, divider and buttons in place around a split markdown block", () => {
    const blocks: Array<JSONObject> =
      SlackUtil.getBlocksFromWorkspaceMessagePayload({
        messageBlocks: [
          header("Incident #12 created"),
          markdown(longText),
          divider(),
          buttons(),
        ],
      });

    const sectionCount: number = sectionTexts(blocks).length;

    expect(sectionCount).toBeGreaterThan(1);
    expect(blocks.length).toBe(sectionCount + 3);

    expect(blocks[0]).toEqual(
      SlackUtil.getHeaderBlock({
        payloadHeaderBlock: header("Incident #12 created"),
      }),
    );

    for (let index: number = 1; index <= sectionCount; index++) {
      expect(blocks[index]!["type"]).toBe("section");
    }

    expect(blocks[sectionCount + 1]).toEqual(SlackUtil.getDividerBlock());
    expect(blocks[sectionCount + 2]).toEqual(
      SlackUtil.getButtonsBlock({ payloadButtonsBlock: buttons() }),
    );

    expectSlicesOfOriginal(SlackifyMarkdown(longText), sectionTexts(blocks));
    expectValidSlackBlocks(blocks, SlackUtil.MAX_BLOCKS_PER_MESSAGE);
  });

  test("keeps several markdown blocks in their own sections and order", () => {
    const blocks: Array<JSONObject> =
      SlackUtil.getBlocksFromWorkspaceMessagePayload({
        messageBlocks: [
          markdown(longText),
          divider(),
          markdown("**Second**"),
          markdown(longText),
        ],
      });

    const firstSplit: Array<string> = SlackUtil.splitSectionText({
      text: SlackifyMarkdown(longText),
    });

    const types: Array<string> = blocks.map((block: JSONObject): string => {
      return block["type"] as string;
    });

    expect(types).toEqual([
      ...firstSplit.map((): string => {
        return "section";
      }),
      "divider",
      "section",
      ...firstSplit.map((): string => {
        return "section";
      }),
    ]);

    expect(sectionText(blocks[firstSplit.length + 1]!)).toBe(
      SlackifyMarkdown("**Second**"),
    );
  });

  test("caps one absurdly long markdown block at MAX_SECTIONS_PER_MARKDOWN_BLOCK sections", () => {
    const blocks: Array<JSONObject> =
      SlackUtil.getBlocksFromWorkspaceMessagePayload({
        messageBlocks: [
          markdown(buildAbsurdlyLongMarkdown()),
          divider(),
          buttons(),
        ],
      });

    const texts: Array<string> = sectionTexts(blocks);

    expect(texts.length).toBe(SlackUtil.MAX_SECTIONS_PER_MARKDOWN_BLOCK);
    expect(blocks.length).toBe(SlackUtil.MAX_SECTIONS_PER_MARKDOWN_BLOCK + 2);
    expect(texts[texts.length - 1]!.endsWith(NOTE)).toBe(true);
    expectValidSlackBlocks(blocks, SlackUtil.MAX_BLOCKS_PER_MESSAGE);
  });

  test("never goes over 50 blocks, however much markdown the message carries", () => {
    const absurd: string = buildAbsurdlyLongMarkdown();

    const blocks: Array<JSONObject> =
      SlackUtil.getBlocksFromWorkspaceMessagePayload({
        messageBlocks: repeatLines({
          count: 8,
          line: (): string => {
            return absurd;
          },
        }).map(markdown),
      });

    /*
     * 8 sections are owed up front, leaving 42 extra: the first four
     * payloads take 9 each, the fifth the 6 left, the rest keep one.
     */
    expect(blocks.length).toBe(SlackUtil.MAX_BLOCKS_PER_MESSAGE);
    expectValidSlackBlocks(blocks, SlackUtil.MAX_BLOCKS_PER_MESSAGE);

    const texts: Array<string> = sectionTexts(blocks);
    const payloadStarts: Array<number> = [];

    texts.forEach((text: string, index: number): void => {
      if (text.startsWith("Paragraph 0:")) {
        payloadStarts.push(index);
      }
    });

    expect(payloadStarts).toEqual([0, 10, 20, 30, 40, 47, 48, 49]);

    // Every payload was cut short, and says so.
    const notedSections: number = texts.filter((text: string): boolean => {
      return text.endsWith(NOTE);
    }).length;

    expect(notedSections).toBe(8);
  });

  test("gives a long markdown block only the blocks the rest of the message leaves", () => {
    const blocks: Array<JSONObject> =
      SlackUtil.getBlocksFromWorkspaceMessagePayload({
        messageBlocks: [
          markdown(buildAbsurdlyLongMarkdown()),
          ...repeatLines({
            count: 47,
            line: (): string => {
              return "";
            },
          }).map(divider),
        ],
      });

    expect(blocks.length).toBe(SlackUtil.MAX_BLOCKS_PER_MESSAGE);
    expect(sectionTexts(blocks).length).toBe(3);
    expectValidSlackBlocks(blocks, SlackUtil.MAX_BLOCKS_PER_MESSAGE);
  });

  test("keeps one section per markdown block when the message is already over the limit", () => {
    const blocks: Array<JSONObject> =
      SlackUtil.getBlocksFromWorkspaceMessagePayload({
        messageBlocks: [
          ...repeatLines({
            count: 55,
            line: (): string => {
              return "";
            },
          }).map(divider),
          markdown(longText),
        ],
      });

    // As many blocks as before — sendMessage posts the overflow separately.
    expect(blocks.length).toBe(56);

    const texts: Array<string> = sectionTexts(blocks);

    expect(texts.length).toBe(1);
    expect(texts[0]!.length).toBeLessThanOrEqual(MAX_LENGTH);
    expect(texts[0]!.endsWith(NOTE)).toBe(true);
  });

  test("honours a larger maxBlocks", () => {
    const blocks: Array<JSONObject> =
      SlackUtil.getBlocksFromWorkspaceMessagePayload({
        messageBlocks: [
          ...repeatLines({
            count: 60,
            line: (): string => {
              return "";
            },
          }).map(divider),
          markdown(longText),
        ],
        maxBlocks: SlackUtil.MAX_BLOCKS_PER_MODAL,
      });

    expect(sectionTexts(blocks).length).toBeGreaterThan(1);
    expectValidSlackBlocks(blocks, SlackUtil.MAX_BLOCKS_PER_MODAL);
  });

  test("still drops and logs a block of an unknown type", () => {
    const errorSpy: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation((): void => {});

    try {
      const blocks: Array<JSONObject> =
        SlackUtil.getBlocksFromWorkspaceMessagePayload({
          messageBlocks: [
            { _type: "SomethingSlackHasNeverHeardOf" },
            markdown("**Hello**"),
          ],
        });

      expect(blocks).toEqual([legacySection("**Hello**")]);
      expect(errorSpy).toHaveBeenCalledWith(
        "Unknown block type: SomethingSlackHasNeverHeardOf",
        { blockType: "SomethingSlackHasNeverHeardOf" },
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe("Slack callers of getBlocksFromWorkspaceMessagePayload", () => {
  const rootCause: string = buildKubernetesRootCause();
  const feed: string = buildIncidentCreatedFeed(rootCause);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function mockSlackPost(): jest.SpyInstance {
    return jest.spyOn(API, "post").mockResolvedValue({
      jsonData: { ok: true, ts: "1726912800.000100" },
    } as unknown as HTTPResponse<JSONObject>);
  }

  function postedData(postSpy: jest.SpyInstance, index: number): JSONObject {
    return (postSpy.mock.calls[index]![0] as PostCallArgs).data;
  }

  test("sendMessage posts the Incident Created message once, with every section within the limit", async () => {
    jest
      .spyOn(SlackUtil, "getWorkspaceChannelFromChannelId")
      .mockResolvedValue({
        id: "C0INCIDENTS",
        name: "incidents",
        workspaceType: WorkspaceType.Slack,
      });

    const postSpy: jest.SpyInstance = mockSlackPost();

    const response: WorkspaceSendMessageResponse = await SlackUtil.sendMessage({
      workspaceMessagePayload: {
        _type: "WorkspaceMessagePayload",
        channelNames: [],
        channelIds: ["C0INCIDENTS"],
        messageBlocks: [markdown(feed), divider(), buttons()],
        workspaceType: WorkspaceType.Slack,
      },
      authToken: "xoxb-test-token",
      userId: "",
      projectId: ObjectID.generate(),
    });

    expect(response.errors).toEqual([]);
    expect(response.threads.length).toBe(1);
    expect(postSpy).toHaveBeenCalledTimes(1);

    const args: PostCallArgs = postSpy.mock.calls[0]![0] as PostCallArgs;

    expect(args.url.toString()).toBe("https://slack.com/api/chat.postMessage");

    const blocks: Array<JSONObject> = args.data["blocks"] as Array<JSONObject>;

    expect(sectionTexts(blocks).length).toBeGreaterThan(1);
    expect(blocks[blocks.length - 2]).toEqual({ type: "divider" });
    expect(blocks[blocks.length - 1]!["type"]).toBe("actions");
    expectValidSlackBlocks(blocks, SlackUtil.MAX_BLOCKS_PER_MESSAGE);
  });

  test("sendDirectMessageToUser posts valid blocks", async () => {
    const postSpy: jest.SpyInstance = mockSlackPost();

    await SlackUtil.sendDirectMessageToUser({
      authToken: "xoxb-test-token",
      workspaceUserId: "U0ONCALL",
      messageBlocks: [markdown(buildAbsurdlyLongMarkdown())],
    });

    expect(postSpy).toHaveBeenCalledTimes(1);

    const blocks: Array<JSONObject> = postedData(postSpy, 0)[
      "blocks"
    ] as Array<JSONObject>;

    expect(blocks.length).toBe(SlackUtil.MAX_SECTIONS_PER_MARKDOWN_BLOCK);
    expectValidSlackBlocks(blocks, SlackUtil.MAX_BLOCKS_PER_MESSAGE);
  });

  test("sendEphemeralMessageToChannel stays within 50 blocks", async () => {
    const postSpy: jest.SpyInstance = mockSlackPost();

    await SlackUtil.sendEphemeralMessageToChannel({
      authToken: "xoxb-test-token",
      channelId: "C0INCIDENTS",
      userId: "U0ONCALL",
      messageBlocks: [
        markdown(buildAbsurdlyLongMarkdown()),
        ...repeatLines({
          count: 45,
          line: (): string => {
            return "";
          },
        }).map(divider),
      ],
    });

    const blocks: Array<JSONObject> = postedData(postSpy, 0)[
      "blocks"
    ] as Array<JSONObject>;

    expect(blocks.length).toBe(SlackUtil.MAX_BLOCKS_PER_MESSAGE);
    expectValidSlackBlocks(blocks, SlackUtil.MAX_BLOCKS_PER_MESSAGE);
  });

  test("getModalBlock splits within a view's 100-block limit", () => {
    const modalBlock: WorkspaceModalBlock = {
      _type: "WorkspaceModalBlock",
      title: "Incident details",
      submitButtonTitle: "Close",
      cancelButtonTitle: "Cancel",
      actionId: "ViewIncident",
      actionValue: "incident-id",
      blocks: [
        ...repeatLines({
          count: 60,
          line: (): string => {
            return "";
          },
        }).map(divider),
        markdown(feed),
      ],
    };

    const view: JSONObject = SlackUtil.getModalBlock({
      payloadModalBlock: modalBlock,
    });

    const blocks: Array<JSONObject> = view["blocks"] as Array<JSONObject>;

    // Over a message's 50 blocks already, but a view still has room to split.
    expect(sectionTexts(blocks).length).toBeGreaterThan(1);
    expect(
      sectionTexts(blocks).some((text: string): boolean => {
        return text.endsWith(NOTE);
      }),
    ).toBe(false);
    expectValidSlackBlocks(blocks, SlackUtil.MAX_BLOCKS_PER_MODAL);
  });
});
