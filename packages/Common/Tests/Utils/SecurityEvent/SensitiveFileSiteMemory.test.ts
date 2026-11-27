import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../Types/JSON";
import {
  SCANNING_FOR_SENSITIVE_FILES_RULE_ID,
  SENSITIVE_FILE_SERVED_RULE_ID,
  getDetectionRuleLibraryEntry,
} from "../../../Types/SecurityEvent/DetectionRuleLibrary";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import SecurityEventRequestOutcome from "../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import SigmaRule from "../../../Types/SecurityEvent/SigmaRule";
import SecurityLogParser, {
  matchesSecurityLogPrefilter,
} from "../../../Utils/SecurityEvent/LogParsers/SecurityLogParser";
import {
  SENSITIVE_FILE_SERVED_LABEL,
  WEB_SENSITIVE_FILE_ANSWER_ATTRIBUTE,
  WEB_SENSITIVE_FILE_PATH_ATTRIBUTE,
} from "../../../Utils/SecurityEvent/LogParsers/WebAttackLogParser";
import {
  MAX_REMEMBERED_OWN_PAGE_SIZES,
  MAX_REMEMBERED_PATH_LENGTH,
  MAX_REMEMBERED_SERVED_FILES,
  MAX_REMEMBERED_SITES,
  MAX_REMEMBERED_SITE_KEY_LENGTH,
  MAX_REMEMBERED_UNDECIDED_ANSWERS,
  MAX_SENSITIVE_FILE_MEMORY_BYTES,
  SENSITIVE_FILE_MEMORY_IN_HOURS,
  SENSITIVE_FILE_MEMORY_REFRESH_IN_MINUTES,
  SENSITIVE_FILE_MEMORY_VERSION,
  SensitiveFileMemory,
  SensitiveFileSiteMemory,
  createSensitiveFileMemory,
  getSensitiveFileRequestPath,
  getSensitiveFileSiteKey,
  getUtf8ByteLength,
  isSensitiveFileMemoryNeeded,
  judgeSensitiveFileAnswers,
  mergeSensitiveFileMemory,
  readSensitiveFileMemory,
  writeSensitiveFileMemory,
} from "../../../Utils/SecurityEvent/SensitiveFileAnswers";
import { SensitiveFileAnswer } from "../../../Utils/SecurityEvent/SensitiveFileProbe";
import SigmaRuleParser from "../../../Utils/SecurityEvent/Sigma/SigmaRuleParser";
import { logLine } from "./LogParsers/LogParserFixtures";
import { sigmaRuleMatchesEvent } from "./LogParsers/SigmaTestMatcher";

/*
 * A LONE REQUEST FOR A SENSITIVE FILE, JUDGED BY WHAT ITS SITE ANSWERED
 * BEFORE (#11036).
 *
 * An access log records a 200's size but not its type, so a request for
 * /.env is judged by what the same site answered the batch's other
 * requests (#10912). A scanner that asks a classic site for /.env alone,
 * and gets it, leaves a batch with nothing to compare it with - it was no
 * event. Each scan now keeps, per site, what its batches said of it for a
 * day, and a request is judged by that too. Pinned here, from the request
 * to the rule:
 *
 *   - a lone /.env on a site that answered 404 within the day is the file:
 *     Critical, "Sensitive file served", the rule fires - and the batch
 *     alone, as before, leaves it out;
 *   - the same request answered with a size its own page was answered
 *     with is that page, however the size was learnt: a JSON log's type,
 *     two paths of one batch, or two lone requests a day apart;
 *   - what the memory does not tell is left out as before: no 404 seen, a
 *     403 (a deny rule's), a fact a day old, another site's memory, a site
 *     with no record, a size a file of another path was served with, a
 *     size of neither on a site that has a page of its own;
 *   - the memory as it is kept: read defensively, capped, the most recent
 *     first, written only when it learnt something worth keeping.
 */

const SCANNER: string = "198.51.100.23";
const SITE: string = "0192f1a0-0000-7000-8000-0000000b1036";
const OTHER_SITE: string = "0192f1a0-0000-7000-8000-0000000b1037";

const NOW: Date = new Date("2026-11-27T12:00:00.000Z");
const HOUR: number = 60 * 60 * 1000;

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * HOUR);
}

// A line of nginx's combined log format: the body's size after the status.
function clf(data: {
  target: string;
  status: number;
  size: number | "-";
}): string {
  return `${SCANNER} - - [27/Nov/2026:10:45:00 +0000] "GET ${data.target} HTTP/1.1" ${data.status} ${data.size} "-" "Mozilla/5.0 zgrab/0.x"`;
}

let lineNumber: number = 0;

// What the log scan reads of a page of one site's logs, written at `at`.
function page(
  bodies: Array<string>,
  options: { site?: string | null; at?: Date } = {},
): Array<NormalizedSecurityEvent> {
  const events: Array<NormalizedSecurityEvent> = [];

  for (const body of bodies) {
    if (!matchesSecurityLogPrefilter(body)) {
      continue;
    }

    lineNumber++;

    const site: string | null =
      options.site === undefined ? SITE : options.site;

    events.push(
      ...SecurityLogParser.parse({
        ...logLine(
          body,
          {},
          `0192f1a0-0000-7000-8000-${String(lineNumber).padStart(12, "0")}`,
        ),
        time: options.at || hoursAgo(1),
        ...(site ? { resourceId: site, resourceType: "Service" } : {}),
      }),
    );
  }

  return events;
}

function answerOf(event: NormalizedSecurityEvent): string {
  return String(event.attributes[WEB_SENSITIVE_FILE_ANSWER_ATTRIBUTE] || "");
}

function byTarget(
  events: Array<NormalizedSecurityEvent>,
): Record<string, string> {
  const answers: Record<string, string> = {};

  for (const event of events) {
    answers[getSensitiveFileRequestPath(event)] = answerOf(event);
  }

  return answers;
}

function ruleOf(id: string): SigmaRule {
  return SigmaRuleParser.parse(getDetectionRuleLibraryEntry(id)!.sigmaRuleYaml);
}

const SERVED_RULE: SigmaRule = ruleOf(SENSITIVE_FILE_SERVED_RULE_ID);
const SCANNING_RULE: SigmaRule = ruleOf(SCANNING_FOR_SENSITIVE_FILES_RULE_ID);

function servedRuleFiresOn(
  events: Array<NormalizedSecurityEvent>,
): Array<string> {
  return events
    .filter((event: NormalizedSecurityEvent): boolean => {
      return sigmaRuleMatchesEvent(SERVED_RULE, event);
    })
    .map((event: NormalizedSecurityEvent): string => {
      return getSensitiveFileRequestPath(event);
    });
}

// A scan's memory, taught by the batches it judged, in order.
function memoryAfter(
  ...batches: Array<Array<NormalizedSecurityEvent>>
): SensitiveFileMemory {
  const memory: SensitiveFileMemory = createSensitiveFileMemory(NOW);

  for (const batch of batches) {
    judgeSensitiveFileAnswers(batch, memory);
  }

  return memory;
}

// What the next scan reads: the memory as it was kept, and read back.
function keptAndRead(memory: SensitiveFileMemory): SensitiveFileMemory {
  return readSensitiveFileMemory(
    JSON.parse(JSON.stringify(writeSensitiveFileMemory(memory))),
    NOW,
  );
}

const LONE_ENV: () => Array<NormalizedSecurityEvent> =
  (): Array<NormalizedSecurityEvent> => {
    return page([clf({ target: "/.env", status: 200, size: 412 })], {
      at: hoursAgo(0.1),
    });
  };

describe("a lone /.env a classic site served, caught from what it answered before", () => {
  test("left out by its batch alone, as before: nothing in it to compare it with", () => {
    expect(judgeSensitiveFileAnswers(LONE_ENV())).toEqual([]);
    // ...and by an empty memory.
    expect(
      judgeSensitiveFileAnswers(LONE_ENV(), createSensitiveFileMemory(NOW)),
    ).toEqual([]);
  });

  test("the file itself when the site answered a path it does not have 404 within the day", () => {
    const memory: SensitiveFileMemory = keptAndRead(
      memoryAfter(
        page([clf({ target: "/.git/config", status: 404, size: 153 })], {
          at: hoursAgo(20),
        }),
      ),
    );

    const stored: Array<NormalizedSecurityEvent> = judgeSensitiveFileAnswers(
      LONE_ENV(),
      memory,
    );

    expect(byTarget(stored)).toEqual({ "/.env": SensitiveFileAnswer.File });
    expect(stored[0]!.severityName).toBe(OcsfSeverity.Critical);
    expect(stored[0]!.message).toBe(
      `${SENSITIVE_FILE_SERVED_LABEL}: GET /.env → 200`,
    );
    expect(stored[0]!.requestOutcome).toBe(
      SecurityEventRequestOutcome.ReachedApp,
    );
    // So Sensitive file served opens its case, and Scanning for sensitive files counts it.
    expect(servedRuleFiresOn(stored)).toEqual(["/.env"]);
    expect(sigmaRuleMatchesEvent(SCANNING_RULE, stored[0]!)).toBe(true);
  });

  test("a 410 says the same as a 404", () => {
    const memory: SensitiveFileMemory = memoryAfter(
      page([clf({ target: "/.aws/credentials", status: 410, size: 0 })]),
    );

    expect(byTarget(judgeSensitiveFileAnswers(LONE_ENV(), memory))).toEqual({
      "/.env": SensitiveFileAnswer.File,
    });
  });

  test("learnt from an earlier page of the same scan, before anything was kept", () => {
    const memory: SensitiveFileMemory = createSensitiveFileMemory(NOW);

    expect(
      judgeSensitiveFileAnswers(
        page([clf({ target: "/.git/config", status: 404, size: 153 })]),
        memory,
      ),
    ).toHaveLength(1);
    expect(byTarget(judgeSensitiveFileAnswers(LONE_ENV(), memory))).toEqual({
      "/.env": SensitiveFileAnswer.File,
    });
  });

  test("a 403 is no sign: a deny rule refuses every dotfile, in front of a single-page app too", () => {
    const memory: SensitiveFileMemory = memoryAfter(
      page([
        clf({ target: "/.git/config", status: 403, size: 162 }),
        clf({ target: "/.htpasswd", status: 401, size: 162 }),
      ]),
    );

    expect(judgeSensitiveFileAnswers(LONE_ENV(), memory)).toEqual([]);
  });

  test("a 404 more than a day old is forgotten; one just inside the day still tells", () => {
    const old: SensitiveFileMemory = keptAndRead(
      memoryAfter(
        page([clf({ target: "/.git/config", status: 404, size: 153 })], {
          at: hoursAgo(SENSITIVE_FILE_MEMORY_IN_HOURS + 1),
        }),
      ),
    );

    expect(judgeSensitiveFileAnswers(LONE_ENV(), old)).toEqual([]);

    const recent: SensitiveFileMemory = keptAndRead(
      memoryAfter(
        page([clf({ target: "/.git/config", status: 404, size: 153 })], {
          at: hoursAgo(SENSITIVE_FILE_MEMORY_IN_HOURS - 1),
        }),
      ),
    );

    expect(byTarget(judgeSensitiveFileAnswers(LONE_ENV(), recent))).toEqual({
      "/.env": SensitiveFileAnswer.File,
    });
  });

  test("a site is judged by its own memory: another site's 404, or another host's, decides nothing of it", () => {
    const otherSite: SensitiveFileMemory = memoryAfter(
      page([clf({ target: "/.git/config", status: 404, size: 153 })], {
        site: OTHER_SITE,
      }),
    );

    expect(judgeSensitiveFileAnswers(LONE_ENV(), otherSite)).toEqual([]);

    // The same record, another host: a JSON log that names the URL.
    const otherHost: SensitiveFileMemory = memoryAfter(
      page([
        '{"remote_addr":"198.51.100.23","request":"GET https://shop.example/.git/config HTTP/1.1","status":404,"body_bytes_sent":153}',
      ]),
    );

    expect(Array.from(otherHost.sites.keys())).toEqual([
      `${SITE}|shop.example`,
    ]);
    expect(judgeSensitiveFileAnswers(LONE_ENV(), otherHost)).toEqual([]);

    // ...and the host's own lone request is judged by it.
    const sameHost: Array<NormalizedSecurityEvent> = page([
      '{"remote_addr":"198.51.100.23","request":"GET https://Shop.Example/.env HTTP/1.1","status":200,"body_bytes_sent":412}',
    ]);

    expect(byTarget(judgeSensitiveFileAnswers(sameHost, otherHost))).toEqual({
      "/.env": SensitiveFileAnswer.File,
    });
  });

  test("a line sent under no record is never remembered: it could be any of the project's sources", () => {
    const memory: SensitiveFileMemory = memoryAfter(
      page([clf({ target: "/.git/config", status: 404, size: 153 })], {
        site: null,
      }),
    );

    expect(memory.sites.size).toBe(0);
    expect(memory.isChanged).toBe(false);
    expect(
      judgeSensitiveFileAnswers(
        page([clf({ target: "/.env", status: 200, size: 412 })], {
          site: null,
        }),
        memory,
      ),
    ).toEqual([]);
  });
});

describe("not caught when what the site answered before says it is its own page", () => {
  test("a size its own page was answered with, learnt from one batch's two paths", () => {
    const memory: SensitiveFileMemory = keptAndRead(
      memoryAfter(
        page([
          clf({ target: "/.env", status: 200, size: 1789 }),
          clf({ target: "/.git/config", status: 200, size: 1789 }),
        ]),
      ),
    );

    const stored: Array<NormalizedSecurityEvent> = judgeSensitiveFileAnswers(
      page([clf({ target: "/.aws/credentials", status: 200, size: 1789 })]),
      memory,
    );

    expect(byTarget(stored)).toEqual({
      "/.aws/credentials": SensitiveFileAnswer.OwnPage,
    });
    // A probe that found nothing: Low, turned away, no case - but the scanner still counts.
    expect(stored[0]!.severityName).toBe(OcsfSeverity.Low);
    expect(stored[0]!.requestOutcome).toBe(
      SecurityEventRequestOutcome.Rejected,
    );
    expect(servedRuleFiresOn(stored)).toEqual([]);
    expect(sigmaRuleMatchesEvent(SCANNING_RULE, stored[0]!)).toBe(true);
    expect(stored[0]!.attributes[WEB_SENSITIVE_FILE_PATH_ATTRIBUTE]).toBe(
      "/.aws",
    );
  });

  test("even on a site that answers 404 too: its own page outranks the 404", () => {
    const memory: SensitiveFileMemory = memoryAfter(
      page([
        clf({ target: "/api/.env", status: 404, size: 22 }),
        clf({ target: "/.git/config", status: 200, size: 1789 }),
        clf({ target: "/.aws/credentials", status: 200, size: 1789 }),
      ]),
    );

    expect(
      byTarget(
        judgeSensitiveFileAnswers(
          page([clf({ target: "/.env", status: 200, size: 1789 })]),
          memory,
        ),
      ),
    ).toEqual({ "/.env": SensitiveFileAnswer.OwnPage });
  });

  test("a size its own page was answered with, learnt from a JSON log that named its type", () => {
    const memory: SensitiveFileMemory = memoryAfter(
      page([
        '{"request":{"remote_ip":"198.51.100.23","method":"GET","uri":"/.env"},"status":200,"size":1789,"resp_headers":{"Content-Type":["text/html; charset=utf-8"]}}',
      ]),
    );

    expect(
      byTarget(
        judgeSensitiveFileAnswers(
          page([clf({ target: "/.git/config", status: 200, size: 1789 })]),
          memory,
        ),
      ),
    ).toEqual({ "/.git/config": SensitiveFileAnswer.OwnPage });
  });

  test("two lone requests a scan apart, of two paths and one size: its own page, as two of one batch are", () => {
    const first: SensitiveFileMemory = memoryAfter(
      page([clf({ target: "/.env", status: 200, size: 1789 })], {
        at: hoursAgo(5),
      }),
    );

    // The first was no event, and is remembered as undecided.
    expect(first.isChanged).toBe(true);

    const stored: Array<NormalizedSecurityEvent> = judgeSensitiveFileAnswers(
      page([clf({ target: "/.git/config", status: 200, size: 1789 })]),
      keptAndRead(first),
    );

    expect(byTarget(stored)).toEqual({
      "/.git/config": SensitiveFileAnswer.OwnPage,
    });
  });

  test("the same path asked again with the same size is still one path: nothing tells", () => {
    const first: SensitiveFileMemory = memoryAfter(
      page([clf({ target: "/.env", status: 200, size: 1789 })], {
        at: hoursAgo(5),
      }),
    );

    expect(
      judgeSensitiveFileAnswers(
        page([clf({ target: "/.env?x=1", status: 200, size: 1789 })]),
        keptAndRead(first),
      ),
    ).toEqual([]);
  });

  test("a size two paths got before is remembered as its own page, and decides a third", () => {
    const memory: SensitiveFileMemory = memoryAfter(
      page([clf({ target: "/.env", status: 200, size: 1789 })], {
        at: hoursAgo(6),
      }),
      page([clf({ target: "/.git/config", status: 200, size: 1789 })], {
        at: hoursAgo(5),
      }),
    );

    const site: SensitiveFileSiteMemory = memory.sites.get(`${SITE}|`)!;

    expect(Array.from(site.ownPageSizes.keys())).toEqual([1789]);
    expect(
      byTarget(
        judgeSensitiveFileAnswers(
          page([clf({ target: "/.npmrc", status: 200, size: 1789 })]),
          keptAndRead(memory),
        ),
      ),
    ).toEqual({ "/.npmrc": SensitiveFileAnswer.OwnPage });
  });
});

describe("never an unknown made into a Critical case", () => {
  test("a site that has a page of its own and answers 404: a size of neither stays out, as a deploy changes the page", () => {
    const memory: SensitiveFileMemory = memoryAfter(
      page([
        clf({ target: "/.git/config", status: 404, size: 153 }),
        '{"request":{"remote_ip":"198.51.100.23","method":"GET","uri":"/.aws/credentials"},"status":200,"size":1789,"resp_headers":{"Content-Type":["text/html"]}}',
      ]),
    );

    expect(
      judgeSensitiveFileAnswers(
        page([clf({ target: "/.env", status: 200, size: 1802 })]),
        memory,
      ),
    ).toEqual([]);
  });

  test("a site whose own page was seen today makes its batch more careful too", () => {
    const memory: SensitiveFileMemory = memoryAfter(
      page([
        clf({ target: "/.aws/credentials", status: 200, size: 1789 }),
        clf({ target: "/.npmrc", status: 200, size: 1789 }),
      ]),
    );

    // Alone, this batch said the file (#10912); its site's page of today says it cannot tell.
    const batch: () => Array<NormalizedSecurityEvent> =
      (): Array<NormalizedSecurityEvent> => {
        return page([
          clf({ target: "/.env", status: 200, size: 412 }),
          clf({ target: "/.git/config", status: 404, size: 153 }),
        ]);
      };

    expect(byTarget(judgeSensitiveFileAnswers(batch()))).toEqual({
      "/.env": SensitiveFileAnswer.File,
      "/.git/config": SensitiveFileAnswer.Refused,
    });
    expect(byTarget(judgeSensitiveFileAnswers(batch(), memory))).toEqual({
      "/.git/config": SensitiveFileAnswer.Refused,
    });
  });

  test("a size a file of another path was served with is no proof of a file: the site may have moved to a single-page app", () => {
    // An hour ago: the .env, served, beside a 404.
    const memory: SensitiveFileMemory = memoryAfter(
      page(
        [
          clf({ target: "/.env", status: 200, size: 1789 }),
          clf({ target: "/.git/config", status: 404, size: 153 }),
        ],
        { at: hoursAgo(1) },
      ),
    );

    expect(
      Array.from(memory.sites.get(`${SITE}|`)!.served.get(1789)!.keys()),
    ).toEqual(["/.env"]);

    // Now /.aws/credentials alone, with the same size: no second Critical case.
    expect(
      judgeSensitiveFileAnswers(
        page([clf({ target: "/.aws/credentials", status: 200, size: 1789 })]),
        keptAndRead(memory),
      ),
    ).toEqual([]);

    // The same file asked for again is the same file.
    expect(
      byTarget(
        judgeSensitiveFileAnswers(
          page([clf({ target: "/.env", status: 200, size: 1789 })]),
          keptAndRead(memory),
        ),
      ),
    ).toEqual({ "/.env": SensitiveFileAnswer.File });
  });

  test("an answer with no size, or with nothing in it, is never decided by the memory", () => {
    const memory: SensitiveFileMemory = memoryAfter(
      page([clf({ target: "/.git/config", status: 404, size: 153 })]),
    );

    expect(
      judgeSensitiveFileAnswers(
        page([
          '{"remote_addr":"198.51.100.23","request":"GET /.env HTTP/1.1","status":200}',
        ]),
        memory,
      ),
    ).toEqual([]);

    // A HEAD's answer is empty as ever: a probe, never a leak.
    expect(
      byTarget(
        judgeSensitiveFileAnswers(
          page([clf({ target: "/.env", status: 200, size: "-" })]),
          memory,
        ),
      ),
    ).toEqual({ "/.env": SensitiveFileAnswer.Empty });
  });

  test("an answer already decided by its type is as it was: the memory decides only what nothing recorded", () => {
    const memory: SensitiveFileMemory = memoryAfter(
      page([
        clf({ target: "/.git/config", status: 200, size: 1789 }),
        clf({ target: "/.aws/credentials", status: 200, size: 1789 }),
      ]),
    );

    // text/plain is the file, whatever its size: its own page's size included.
    expect(
      byTarget(
        judgeSensitiveFileAnswers(
          page([
            '{"remote_addr":"198.51.100.23","request":"GET /.env HTTP/1.1","status":200,"body_bytes_sent":1789,"sent_http_content_type":"text/plain"}',
          ]),
          memory,
        ),
      ),
    ).toEqual({ "/.env": SensitiveFileAnswer.File });
  });

  test("whether a page needs the memory at all: only an answer nothing recorded", () => {
    expect(isSensitiveFileMemoryNeeded(LONE_ENV())).toBe(true);
    expect(
      isSensitiveFileMemoryNeeded(
        page([clf({ target: "/.git/config", status: 404, size: 153 })]),
      ),
    ).toBe(false);
    expect(
      isSensitiveFileMemoryNeeded(
        page([
          `${SCANNER} - - [27/Nov/2026:10:45:00 +0000] "GET /item?id=1%27%20or%201%3D1 HTTP/1.1" 200 512 "-" "sqlmap/1.7"`,
        ]),
      ),
    ).toBe(false);
    expect(isSensitiveFileMemoryNeeded([])).toBe(false);
  });
});

describe("what each batch teaches the memory", () => {
  test("a 404, its own page, a file it served, and what nothing decided - each with when it happened", () => {
    const memory: SensitiveFileMemory = memoryAfter(
      page(
        [
          clf({ target: "/.git/config", status: 404, size: 153 }),
          clf({ target: "/.env", status: 200, size: 412 }),
        ],
        { at: hoursAgo(3) },
      ),
      page(
        [
          '{"request":{"remote_ip":"198.51.100.23","method":"GET","uri":"/.npmrc"},"status":200,"size":2048,"resp_headers":{"Content-Type":["text/html"]}}',
        ],
        { at: hoursAgo(2) },
      ),
      page([clf({ target: "/web.config", status: 200, size: 999 })], {
        site: OTHER_SITE,
        at: hoursAgo(1),
      }),
    );

    const site: SensitiveFileSiteMemory = memory.sites.get(`${SITE}|`)!;

    expect(site.notFoundAt).toBe(hoursAgo(3).getTime());
    expect(Array.from(site.served.entries())).toEqual([
      [412, new Map([["/.env", hoursAgo(3).getTime()]])],
    ]);
    expect(Array.from(site.ownPageSizes.entries())).toEqual([
      [2048, hoursAgo(2).getTime()],
    ]);
    expect(site.seenAt).toBe(hoursAgo(2).getTime());

    const other: SensitiveFileSiteMemory = memory.sites.get(`${OTHER_SITE}|`)!;

    expect(other.notFoundAt).toBeNull();
    expect(Array.from(other.undecided.entries())).toEqual([
      [999, new Map([["/web.config", hoursAgo(1).getTime()]])],
    ]);
  });

  test("a refusal that is no 404, an answer with nothing in it, and an attack that is no probe teach it nothing", () => {
    const memory: SensitiveFileMemory = memoryAfter(
      page([
        clf({ target: "/.git/config", status: 403, size: 162 }),
        clf({ target: "/.env", status: 200, size: "-" }),
        `${SCANNER} - - [27/Nov/2026:10:45:00 +0000] "GET /item?id=1%27%20or%201%3D1 HTTP/1.1" 200 512 "-" "sqlmap/1.7"`,
      ]),
    );

    expect(memory.sites.size).toBe(0);
    expect(memory.isChanged).toBe(false);
  });

  test("a fact it holds is worth keeping again only once its time moved on by the refresh", () => {
    const memory: SensitiveFileMemory = memoryAfter(
      page([clf({ target: "/.git/config", status: 404, size: 153 })], {
        at: hoursAgo(3),
      }),
    );

    expect(memory.isChanged).toBe(true);
    memory.isChanged = false;

    // The same 404 a few minutes later: held already.
    judgeSensitiveFileAnswers(
      page([clf({ target: "/.env.local", status: 404, size: 153 })], {
        at: new Date(hoursAgo(3).getTime() + 5 * 60 * 1000),
      }),
      memory,
    );
    expect(memory.isChanged).toBe(false);
    // ...its time moved on all the same.
    expect(memory.sites.get(`${SITE}|`)!.notFoundAt).toBe(
      hoursAgo(3).getTime() + 5 * 60 * 1000,
    );

    // A refresh later: worth keeping, so it lasts a day from then.
    judgeSensitiveFileAnswers(
      page([clf({ target: "/.env.local", status: 404, size: 153 })], {
        at: new Date(
          hoursAgo(3).getTime() +
            SENSITIVE_FILE_MEMORY_REFRESH_IN_MINUTES * 60 * 1000 +
            5 * 60 * 1000,
        ),
      }),
      memory,
    );
    expect(memory.isChanged).toBe(true);
  });

  test("a later page of what happened earlier moves nothing back", () => {
    const memory: SensitiveFileMemory = memoryAfter(
      page([clf({ target: "/.git/config", status: 404, size: 153 })], {
        at: hoursAgo(1),
      }),
    );

    memory.isChanged = false;

    judgeSensitiveFileAnswers(
      page([clf({ target: "/.git/config", status: 404, size: 153 })], {
        at: hoursAgo(4),
      }),
      memory,
    );

    expect(memory.sites.get(`${SITE}|`)!.notFoundAt).toBe(
      hoursAgo(1).getTime(),
    );
    expect(memory.isChanged).toBe(false);
  });

  test("an event stamped after the scan's now is kept as now", () => {
    const memory: SensitiveFileMemory = memoryAfter(
      page([clf({ target: "/.git/config", status: 404, size: 153 })], {
        at: new Date(NOW.getTime() + 2 * HOUR),
      }),
    );

    expect(memory.sites.get(`${SITE}|`)!.notFoundAt).toBe(NOW.getTime());
  });

  test("a path too long to be one a person runs is not remembered", () => {
    const long: string = `/${"a".repeat(MAX_REMEMBERED_PATH_LENGTH)}/.env`;
    const memory: SensitiveFileMemory = memoryAfter(
      page([clf({ target: long, status: 200, size: 412 })]),
    );

    expect(memory.sites.size).toBe(0);
  });
});

describe("the memory as it is kept, and read back", () => {
  test("round trip: what is written is what is read, the most recent first", () => {
    const memory: SensitiveFileMemory = memoryAfter(
      page(
        [
          clf({ target: "/.git/config", status: 404, size: 153 }),
          clf({ target: "/.env", status: 200, size: 412 }),
        ],
        { at: hoursAgo(3) },
      ),
      page([clf({ target: "/.npmrc", status: 200, size: 77 })], {
        site: OTHER_SITE,
        at: hoursAgo(2),
      }),
    );

    const written: JSONObject = writeSensitiveFileMemory(memory);

    expect(written).toEqual({
      version: SENSITIVE_FILE_MEMORY_VERSION,
      sites: {
        [`${OTHER_SITE}|`]: {
          undecided: [{ size: 77, path: "/.npmrc", at: hoursAgo(2).getTime() }],
          seenAt: hoursAgo(2).getTime(),
        },
        [`${SITE}|`]: {
          notFoundAt: hoursAgo(3).getTime(),
          served: [{ size: 412, path: "/.env", at: hoursAgo(3).getTime() }],
          seenAt: hoursAgo(3).getTime(),
        },
      },
    });
    // Most recently seen first.
    expect(Object.keys(written["sites"] as JSONObject)).toEqual([
      `${OTHER_SITE}|`,
      `${SITE}|`,
    ]);

    const read: SensitiveFileMemory = readSensitiveFileMemory(written, NOW);

    expect(writeSensitiveFileMemory(read)).toEqual(written);
    expect(read.isChanged).toBe(false);
  });

  test("anything of another shape reads as a memory that says nothing", () => {
    for (const value of [
      null,
      undefined,
      "memory",
      42,
      [],
      {},
      { version: 2, sites: {} },
      { version: SENSITIVE_FILE_MEMORY_VERSION, sites: [] },
      { version: SENSITIVE_FILE_MEMORY_VERSION, sites: "x" },
    ]) {
      expect({
        value,
        sites: readSensitiveFileMemory(value as never, NOW).sites.size,
      }).toEqual({ value, sites: 0 });
    }
  });

  test("a fact that is no fact is dropped, and the rest of its site kept", () => {
    const fresh: number = hoursAgo(1).getTime();
    const read: SensitiveFileMemory = readSensitiveFileMemory(
      {
        version: SENSITIVE_FILE_MEMORY_VERSION,
        sites: {
          [`${SITE}|`]: {
            notFoundAt: "yesterday",
            ownPage: [
              { size: 1789, at: fresh },
              { size: -1, at: fresh },
              { size: 1.5, at: fresh },
              { size: "1789", at: fresh },
              { size: 200, at: hoursAgo(30).getTime() },
              "1789",
            ],
            undecided: [
              { size: 412, path: "/.env", at: fresh },
              { size: 412, path: ".env", at: fresh },
              {
                size: 412,
                path: `/${"a".repeat(MAX_REMEMBERED_PATH_LENGTH)}`,
                at: fresh,
              },
              { size: 412, at: fresh },
            ],
            served: "everything",
            seenAt: fresh,
          },
          // A site with no record, and one far too long: never a site.
          "|": { notFoundAt: fresh },
          [`${"x".repeat(MAX_REMEMBERED_SITE_KEY_LENGTH)}|`]: {
            notFoundAt: fresh,
          },
          // Every fact of it a day old: the site goes.
          [`${OTHER_SITE}|`]: {
            notFoundAt: hoursAgo(SENSITIVE_FILE_MEMORY_IN_HOURS + 2).getTime(),
            seenAt: hoursAgo(SENSITIVE_FILE_MEMORY_IN_HOURS + 2).getTime(),
          },
        },
      },
      NOW,
    );

    expect(Array.from(read.sites.keys())).toEqual([`${SITE}|`]);

    const site: SensitiveFileSiteMemory = read.sites.get(`${SITE}|`)!;

    expect(site.notFoundAt).toBeNull();
    expect(Array.from(site.ownPageSizes.entries())).toEqual([[1789, fresh]]);
    expect(Array.from(site.undecided.entries())).toEqual([
      [412, new Map([["/.env", fresh]])],
    ]);
    expect(site.served.size).toBe(0);
  });

  test("a time kept ahead of now is read as now", () => {
    const read: SensitiveFileMemory = readSensitiveFileMemory(
      {
        version: SENSITIVE_FILE_MEMORY_VERSION,
        sites: {
          [`${SITE}|`]: {
            notFoundAt: NOW.getTime() + 5 * HOUR,
            seenAt: NOW.getTime() + 5 * HOUR,
          },
        },
      },
      NOW,
    );

    expect(read.sites.get(`${SITE}|`)!.notFoundAt).toBe(NOW.getTime());
  });

  test("capped: the most recently seen sites, and of each the most recent facts", () => {
    const memory: SensitiveFileMemory = createSensitiveFileMemory(NOW);

    for (let index: number = 0; index < MAX_REMEMBERED_SITES + 30; index++) {
      const at: number = hoursAgo(20).getTime() + index * 60 * 1000;
      const ownPageSizes: Map<number, number> = new Map();
      const undecided: Map<number, Map<string, number>> = new Map();
      const served: Map<number, Map<string, number>> = new Map();

      for (let size: number = 1; size <= 20; size++) {
        ownPageSizes.set(1000 + size, at + size);
        undecided.set(2000 + size, new Map([[`/.env.${size}`, at + size]]));
        served.set(3000 + size, new Map([[`/.git/${size}`, at + size]]));
      }

      memory.sites.set(
        `0192f1a0-0000-7000-8000-${String(index).padStart(12, "0")}|`,
        {
          notFoundAt: at,
          ownPageSizes,
          undecided,
          served,
          seenAt: at + 20,
        },
      );
    }

    const written: JSONObject = writeSensitiveFileMemory(memory);
    const sites: JSONObject = written["sites"] as JSONObject;
    const keys: Array<string> = Object.keys(sites);

    // Every site full: the byte budget, not the count, is what binds.
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.length).toBeLessThanOrEqual(MAX_REMEMBERED_SITES);
    // The newest kept, the oldest gone.
    expect(keys[0]).toBe(
      `0192f1a0-0000-7000-8000-${String(MAX_REMEMBERED_SITES + 29).padStart(12, "0")}|`,
    );
    expect(keys).not.toContain(
      `0192f1a0-0000-7000-8000-${String(0).padStart(12, "0")}|`,
    );

    const newest: JSONObject = sites[keys[0]!] as JSONObject;

    expect((newest["ownPage"] as Array<JSONObject>).length).toBe(
      MAX_REMEMBERED_OWN_PAGE_SIZES,
    );
    expect((newest["undecided"] as Array<JSONObject>).length).toBe(
      MAX_REMEMBERED_UNDECIDED_ANSWERS,
    );
    expect((newest["served"] as Array<JSONObject>).length).toBe(
      MAX_REMEMBERED_SERVED_FILES,
    );
    // The most recent of each first: the largest size here was seen last.
    expect((newest["ownPage"] as Array<JSONObject>)[0]!["size"]).toBe(1020);

    /*
     * THE COST BOUND, MEASURED: a memory full of short facts - 100 sites,
     * each at every cap - is what one scan reads and writes at most, and
     * stays under the byte budget; a project with a few sites keeps a few
     * hundred bytes.
     */
    const bytes: number = Buffer.byteLength(JSON.stringify(written), "utf8");

    expect(bytes).toBeLessThanOrEqual(MAX_SENSITIVE_FILE_MEMORY_BYTES);

    const few: number = Buffer.byteLength(
      JSON.stringify(
        writeSensitiveFileMemory(
          memoryAfter(
            page([
              clf({ target: "/.git/config", status: 404, size: 153 }),
              clf({ target: "/.env", status: 200, size: 1789 }),
              clf({ target: "/.aws/credentials", status: 200, size: 1789 }),
            ]),
          ),
        ),
      ),
      "utf8",
    );

    expect(few).toBeLessThan(400);
  });

  test("a project of many sites, each with a fact or two, keeps the most recently seen hundred", () => {
    const memory: SensitiveFileMemory = createSensitiveFileMemory(NOW);

    for (let index: number = 0; index < MAX_REMEMBERED_SITES + 50; index++) {
      const at: number = hoursAgo(20).getTime() + index * 60 * 1000;

      memory.sites.set(
        `0192f1a0-0000-7000-8000-${String(index).padStart(12, "0")}|`,
        {
          notFoundAt: at,
          ownPageSizes: new Map([[1789, at]]),
          undecided: new Map(),
          served: new Map(),
          seenAt: at,
        },
      );
    }

    const written: string = JSON.stringify(writeSensitiveFileMemory(memory));
    const keys: Array<string> = Object.keys(
      (JSON.parse(written) as JSONObject)["sites"] as JSONObject,
    );

    expect(keys).toHaveLength(MAX_REMEMBERED_SITES);
    expect(keys[0]).toBe(
      `0192f1a0-0000-7000-8000-${String(MAX_REMEMBERED_SITES + 49).padStart(12, "0")}|`,
    );
    expect(keys[MAX_REMEMBERED_SITES - 1]).toBe(
      `0192f1a0-0000-7000-8000-${String(50).padStart(12, "0")}|`,
    );
    // About a hundred bytes a site.
    expect(Buffer.byteLength(written, "utf8")).toBeLessThan(
      MAX_REMEMBERED_SITES * 150,
    );
  });

  test("a memory an attacker fills - the longest hosts and paths, in letters of several bytes - weighs no more than its budget", () => {
    const memory: SensitiveFileMemory = createSensitiveFileMemory(NOW);
    // Three bytes each in UTF-8: a host and a path at the longest the memory keeps.
    const host: string = "ж".repeat(
      MAX_REMEMBERED_SITE_KEY_LENGTH - SITE.length - 1,
    );
    const path: string = `/${"ж".repeat(MAX_REMEMBERED_PATH_LENGTH - 1)}`;

    for (let index: number = 0; index < MAX_REMEMBERED_SITES; index++) {
      const at: number = hoursAgo(10).getTime() + index * 1000;
      const facts: Map<number, Map<string, number>> = new Map();

      for (let size: number = 1; size <= 10; size++) {
        facts.set(
          size,
          new Map([
            [`${path.slice(0, -2)}${String(size).padStart(2, "0")}`, at],
          ]),
        );
      }

      memory.sites.set(
        `${SITE.slice(0, -3)}${String(index).padStart(3, "0")}|${host}`,
        {
          notFoundAt: at,
          ownPageSizes: new Map([[1789, at]]),
          undecided: facts,
          served: new Map(facts),
          seenAt: at,
        },
      );
    }

    const written: string = JSON.stringify(writeSensitiveFileMemory(memory));
    const kept: Array<string> = Object.keys(
      (JSON.parse(written) as JSONObject)["sites"] as JSONObject,
    );

    expect(Buffer.byteLength(written, "utf8")).toBeLessThanOrEqual(
      MAX_SENSITIVE_FILE_MEMORY_BYTES,
    );
    // Some sites, the most recently seen, never none.
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(MAX_REMEMBERED_SITES);
    expect(kept[0]!.startsWith(`${SITE.slice(0, -3)}099|`)).toBe(true);
  });

  test("a text's length in bytes, as the cache stores it", () => {
    for (const text of [
      "",
      "/.env",
      "shop.example",
      "é",
      "жж",
      "中文",
      "😀",
      "a😀b",
      // A lone surrogate: what JSON writes for it is three bytes.
      "\ud83d",
    ]) {
      expect({ text, bytes: getUtf8ByteLength(text) }).toEqual({
        text,
        bytes: Buffer.byteLength(text, "utf8"),
      });
    }
  });

  test("merged: each fact once, at its latest time - and whether there is something to keep is left as it was", () => {
    const into: SensitiveFileMemory = memoryAfter(
      page([clf({ target: "/.git/config", status: 404, size: 153 })], {
        at: hoursAgo(5),
      }),
    );
    const kept: SensitiveFileMemory = memoryAfter(
      page([clf({ target: "/.git/config", status: 404, size: 153 })], {
        at: hoursAgo(2),
      }),
      page(
        [
          clf({ target: "/.env", status: 200, size: 1789 }),
          clf({ target: "/.npmrc", status: 200, size: 1789 }),
        ],
        { site: OTHER_SITE, at: hoursAgo(3) },
      ),
    );

    into.isChanged = false;
    mergeSensitiveFileMemory(into, keptAndRead(kept));

    expect(into.isChanged).toBe(false);
    expect(into.sites.get(`${SITE}|`)!.notFoundAt).toBe(hoursAgo(2).getTime());
    expect(
      Array.from(into.sites.get(`${OTHER_SITE}|`)!.ownPageSizes.keys()),
    ).toEqual([1789]);

    // What was merged in is its own copy: teaching one teaches not the other.
    into.sites.get(`${OTHER_SITE}|`)!.ownPageSizes.set(5, NOW.getTime());
    expect(
      Array.from(kept.sites.get(`${OTHER_SITE}|`)!.ownPageSizes.keys()),
    ).toEqual([1789]);
  });

  test("a site is the record and the host its URL names", () => {
    const [event] = page([
      '{"remote_addr":"198.51.100.23","request":"GET https://Shop.Example:8443/.env HTTP/1.1","status":404}',
    ]);

    expect(getSensitiveFileSiteKey(event!)).toBe(`${SITE}|shop.example:8443`);
  });
});
