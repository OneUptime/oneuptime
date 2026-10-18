import { DOCS_LANGUAGES, readPage } from "./DocsContentSupport";
import {
  getIpv6NetworkRateLimit,
  IPV6_NETWORK_RATE_LIMIT_ROOM_IN_ADDRESSES,
} from "Common/Server/Utils/ClientIp";
import { RUNBOOK_WEBHOOK_CALLS_PER_ADDRESS_PER_MINUTE } from "Common/Types/Runbook/RunbookWebhook";
import { describe, expect, it } from "@jest/globals";

/*
 * The docs pages that give a limit per client address say that the
 * addresses of one IPv6 /64 are counted together too, with ten addresses'
 * room (ClientIp getIpv6NetworkRateLimit, which every such limit counts
 * by): the forms' rate limits, the calendar feeds' rate limits and their
 * troubleshooting, and the runbook webhook's 429. Held here to the code's
 * own room, in English, and to being said in every language.
 */

const ROOM_IN_WORDS: Record<number, string> = { 10: "ten" };

const NETWORK_SENTENCES: Array<{ page: string; english: string }> = [
  {
    page: "forms/sharing-and-security",
    english: `Each per-address limit also counts the addresses of one IPv6 /64 together, at ${ROOM_IN_WORDS[IPV6_NETWORK_RATE_LIMIT_ROOM_IN_ADDRESSES]} times its number.`,
  },
  {
    page: "on-call/calendar-feeds",
    english: `are rate limited per link and per client address, and per IPv6 /64 at ${ROOM_IN_WORDS[IPV6_NETWORK_RATE_LIMIT_ROOM_IN_ADDRESSES]} times an address's limits.`,
  },
  {
    page: "on-call/calendar-feeds",
    english: `The clients of one IPv6 /64 share ${ROOM_IN_WORDS[IPV6_NETWORK_RATE_LIMIT_ROOM_IN_ADDRESSES]} times it as well.`,
  },
  {
    page: "runbooks/triggers",
    english: `or the addresses of one IPv6 /64 more than ${getIpv6NetworkRateLimit(
      RUNBOOK_WEBHOOK_CALLS_PER_ADDRESS_PER_MINUTE,
    )} together.`,
  },
];

// How many times a page names a /64 (each sentence above names one).
function networkMentionsOf(markdown: string): number {
  return markdown.split("/64").length - 1;
}

describe("the docs give the /64 rule with every per-address limit", () => {
  it("in English, with the room the limits count by", () => {
    expect(ROOM_IN_WORDS[IPV6_NETWORK_RATE_LIMIT_ROOM_IN_ADDRESSES]).toBe(
      "ten",
    );

    for (const sentence of NETWORK_SENTENCES) {
      expect([sentence.page, readPage("en", sentence.page)]).toEqual([
        sentence.page,
        expect.stringContaining(sentence.english),
      ]);
    }
  });

  it("in every language, as often as the English names it, and as IPv6", () => {
    for (const page of new Set(
      NETWORK_SENTENCES.map((sentence: { page: string }): string => {
        return sentence.page;
      }),
    )) {
      const english: number = networkMentionsOf(readPage("en", page));

      expect(english).toBeGreaterThan(0);

      for (const lang of DOCS_LANGUAGES) {
        const markdown: string = readPage(lang, page);

        expect([lang, page, networkMentionsOf(markdown)]).toEqual([
          lang,
          page,
          english,
        ]);
        expect([lang, page, markdown.includes("IPv6")]).toEqual([
          lang,
          page,
          true,
        ]);
      }
    }
  });

  it("with the runbook webhook's /64 number in every language", () => {
    const networkLimit: string = String(
      getIpv6NetworkRateLimit(RUNBOOK_WEBHOOK_CALLS_PER_ADDRESS_PER_MINUTE),
    );

    for (const lang of DOCS_LANGUAGES) {
      expect([lang, readPage(lang, "runbooks/triggers")]).toEqual([
        lang,
        expect.stringContaining(networkLimit),
      ]);
    }
  });
});
