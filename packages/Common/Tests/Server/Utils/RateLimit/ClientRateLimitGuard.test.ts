import { listProductFiles } from "../../../Helpers/CodeScanning";
import { REPOSITORY_DIRECTORY } from "../../../Helpers/TagStripScan";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * NO RATE LIMIT COUNTS A CLIENT BY ITS BARE ADDRESS.
 *
 * One IPv6 host is commonly given a whole /64 and can send each request from
 * another address of it, so a limit that counts each address on its own
 * holds that host to nothing. Every limit that counts a client therefore
 * counts it in one of two ways:
 *
 *  - in Redis, through ClientRateLimitCounter, which counts the client's
 *    address and, for an IPv6 client, its /64;
 *  - in a process's memory (the push relay, the website's forms), through
 *    getRateLimitClient (ClientIp), which hands over the address and the
 *    /64, and the limit counts the /64.
 *
 * Two lists below hold every other place to that, so a new limit cannot
 * quietly count the bare address:
 *
 *  - every product file that increments a Redis counter is
 *    ClientRateLimitCounter, or is listed with what it counts - something
 *    that is not a client address;
 *  - every product file that reads a client address counts through one of
 *    the two ways above, or is listed with why it reads it.
 *
 * A new file on either side fails this guard until it is sorted: a limit on
 * a client counts through ClientRateLimitCounter (or getRateLimitClient and
 * its /64); anything else is listed here with what it counts or why it
 * reads the address.
 *
 * Read from the code with its comments removed, across all product code
 * (ee/ too, when it is checked out).
 */

const COUNTER: string =
  "packages/Common/Server/Utils/RateLimit/ClientRateLimitCounter.ts";

/*
 * Every other product file that increments a Redis counter, with what the
 * counter is keyed on. None is a client address.
 */
const COUNTERS_NOT_KEYED_ON_A_CLIENT: Record<string, string> = {
  "packages/Common/Server/Middleware/SubscriberNotificationTestSendRateLimit.ts":
    "test emails per signed-in user",
  "packages/Common/Server/Middleware/SubscriberNotificationPreviewRateLimit.ts":
    "previews per signed-in user",
  "packages/Common/Server/Utils/Telemetry/TelemetryIngestionKeyRateLimiter.ts":
    "telemetry per ingestion key",
  "packages/Common/Server/Utils/Telemetry/TelemetryWriterShedMetrics.ts":
    "telemetry writes shed per minute, for the instance's health",
  "packages/Common/Server/Utils/SessionReplay/SessionReplayHealthCounters.ts":
    "session replay refusals per project and reason, for its health page",
  "packages/App/FeatureSet/Telemetry/Utils/SessionReplayRateLimiter.ts":
    "session replay chunks and bytes per project and application",
  "packages/App/FeatureSet/Workers/Jobs/Rum/FinalizeSessions.ts":
    "the project a worker run starts from",
  "packages/Common/Server/Infrastructure/GlobalCache.ts":
    "the counters its callers name: certificate orders and production review AI reads, below",
  "packages/Common/Server/Utils/CodeRepository/ProductionReview/ProductionReviewRunner.ts":
    "OneUptime AI's production review reads per repository and day",
  "packages/Common/Server/Utils/Greenlock/CertificateOrder.ts":
    "certificate orders per budget",
  "packages/Common/Server/Utils/Greenlock/CertificateOrderBudget.ts":
    "certificate orders for the instance's ACME account",
  "packages/Common/Server/Utils/TwoFactorWrongCodes.ts":
    "wrong two factor codes per account, wherever they come from",
  "packages/Common/Server/Utils/Telemetry/ChangeDetection/TelemetryChangeDetector.ts":
    "deploys and rollouts recorded per service or workload and hour",
};

/*
 * Every product file that reads a client address and does not count it
 * itself, with why it reads it. A route whose limit is a middleware - its
 * attempts counted by a limiter that counts through ClientRateLimitCounter -
 * reads the address only for what it records.
 */
const ADDRESS_READERS_THAT_DO_NOT_COUNT: Record<string, string> = {
  "packages/Common/Server/Utils/Express.ts":
    "defines getClientIp, the address requests are recorded and logged with",
  "packages/App/FeatureSet/Identity/API/Authentication.ts":
    "records the address of a sign-in and hands it to the captcha check; its attempts are counted by IdentityRateLimit",
  "packages/App/FeatureSet/Identity/API/StatusPageAuthentication.ts":
    "records the address of a status page sign-in; its attempts are counted by IdentityRateLimit",
  "packages/App/FeatureSet/Identity/API/SSO.ts":
    "records the address of a single sign-on",
  "packages/App/FeatureSet/Identity/API/GlobalSSO.ts":
    "records the address of a single sign-on",
  "packages/App/FeatureSet/Identity/API/OIDC.ts":
    "records the address of a single sign-on",
  "packages/App/FeatureSet/Identity/API/GlobalOIDC.ts":
    "records the address of a single sign-on",
  "packages/App/FeatureSet/Identity/API/MicrosoftSignIn.ts":
    "records the address of a Microsoft sign-in",
  "packages/App/FeatureSet/Identity/API/StatusPageSSO.ts":
    "records the address of a status page single sign-on",
  "packages/App/FeatureSet/Identity/API/StatusPageOIDC.ts":
    "records the address of a status page single sign-on",
  "packages/App/FeatureSet/Notification/API/Telegram.ts":
    "hands the address to VerificationCodeRateLimit.consume, which counts through ClientRateLimitCounter",
  "packages/App/FeatureSet/Runbook/API/RunbookWebhook.ts":
    "records the caller of a run; its calls are counted by RunbookWebhookRateLimit",
  "ee/Server/CloudMarketplace/API/VercelSignIn.ts":
    "records the address of a sign-in from Vercel Marketplace",
  "packages/Common/Server/API/FormAPI.ts":
    "checks the form's IP allowlist; its requests are counted by FormRateLimit",
  "packages/Common/Server/API/TelemetryAPI.ts":
    "records who watched a session replay",
  "packages/Common/Server/Services/DashboardService.ts":
    "checks a dashboard's IP allowlist",
  "packages/Common/Server/Services/StatusPageService.ts":
    "checks a status page's IP allowlist",
  "packages/Common/Server/Utils/StatusPage/StatusPageRssFeed.ts":
    "forwards the feed reader's address with the feed's reads of the page, so the page's IP allowlist judges the reader",
  "packages/Probe/Services/SyslogReceiver.ts":
    "records the address a syslog message arrived from",
  "packages/Probe/Utils/ProbeApiDiagnostics.ts":
    "reports the address an outbound connection to the API reached",
};

/*
 * The limits that count a client in Redis, each through
 * ClientRateLimitCounter.count - or countDifferent, which counts the
 * different values a client presents under its address and /64 alike: the
 * wrong keys it sent, counted by WrongKeyLimit, on which the cluster key's
 * limit (WrongClusterKeyLimit) and the probe, Runner and AI agent keys'
 * (WrongComponentKeyLimit) are built, and which leaves a key from a private
 * network address uncounted for all of them. Each one's behaviour under a host that
 * rotates through its /64 is driven in RateLimitsCountIpv6Networks.test.ts
 * (and LicenseServerRateLimit.test.ts in ee/).
 */
const REDIS_LIMITS: Array<string> = [
  "packages/Common/Server/Middleware/IdentityRateLimit.ts",
  "packages/Common/Server/Middleware/VerificationCodeRateLimit.ts",
  "packages/Common/Server/Middleware/PublicDashboardRateLimit.ts",
  "packages/Common/Server/Middleware/FormRateLimit.ts",
  "packages/Common/Server/Middleware/OnCallCalendarFeedRateLimit.ts",
  "packages/Common/Server/Middleware/McpOAuthRateLimit.ts",
  "packages/Common/Server/Utils/Runbook/RunbookWebhookRateLimit.ts",
  "packages/Common/Server/Utils/RateLimit/PublicMessageRateLimit.ts",
  "packages/Common/Server/Utils/RateLimit/WrongKeyLimit.ts",
  "ee/Server/LicenseServer/LicenseServerRateLimit.ts",
];

/*
 * The limits that count a client in a process's memory: each reads the
 * client's /64 from getRateLimitClient and counts it.
 */
const IN_MEMORY_LIMITS: Array<string> = [
  "packages/App/FeatureSet/Notification/API/PushRelay.ts",
  "packages/Home/API/ResellerInquiryAPI.ts",
];

const CODE_FILE: RegExp = /\.(?:ts|tsx)$/;
const CLIENT_IP_MODULE: string = "packages/Common/Server/Utils/ClientIp.ts";

const REDIS_INCREMENT: RegExp =
  /(?:\.(?:incr|incrby|incrbyfloat|hincrby|hincrbyfloat|zincrby)\s*\(|\bincrementWithExpiry\s*\(|\bincrementIfBelow\s*\(|["'`](?:INCR|INCRBY|HINCRBY)["'`])/;

/*
 * Reading a client address: importing the ClientIp module (from any
 * folder), calling Express's getClientIp, or a limiter's resolveClientIp or
 * getAddressKey - or reading one around them: a request's ip or ips, a
 * socket's remoteAddress, or a header a proxy names the client in.
 */
const CLIENT_ADDRESS_READ: RegExp =
  /(?:from\s+["'](?:[^"']*\/)?ClientIp["']|\bgetClientIp\s*\(|\.resolveClientIp\s*\(|\.getAddressKey\s*\(|\b(?:req|request)\??\.ips?\b|\.remoteAddress\b|["'`](?:x-forwarded-for|x-real-ip|cf-connecting-ip|true-client-ip|x-client-ip|fastly-client-ip)["'`])/i;

/*
 * ClientRateLimitCounter.count(...) or .countDifferent(...), with or
 * without its type argument.
 */
const COUNTS_THROUGH_COUNTER: RegExp =
  /\bClientRateLimitCounter\.count(?:Different)?(?:<[^<>()]*>)?\(/;
// From any folder, or from its own (a limit next to it in RateLimit/).
const IMPORTS_COUNTER: RegExp =
  /from\s+["'](?:[^"']*\/)?(?:RateLimit\/|\.\/)ClientRateLimitCounter["']/;
const READS_RATE_LIMIT_CLIENT: RegExp = /\bgetRateLimitClient\s*\(/;
const COUNTS_THE_NETWORK: RegExp = /\.ipv6Network64\b/;

const hasEe: boolean = fs.existsSync(path.join(REPOSITORY_DIRECTORY, "ee"));

// The code of a file, its comments removed by TypeScript's own printer.
function codeOf(relativePath: string): string {
  const source: string = fs.readFileSync(
    path.join(REPOSITORY_DIRECTORY, relativePath),
    "utf8",
  );
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    path.basename(relativePath),
    source,
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  return ts.createPrinter({ removeComments: true }).printFile(sourceFile);
}

let productCodeFiles: Array<string> | null = null;

function productFiles(): Array<string> {
  if (!productCodeFiles) {
    productCodeFiles = listProductFiles(REPOSITORY_DIRECTORY, [
      "packages",
      "ee",
    ]).filter((relativePath: string): boolean => {
      return CODE_FILE.test(relativePath);
    });
  }

  return productCodeFiles;
}

// Product files whose raw text matches (a cheap first pass), then whose code does.
function productFilesWhoseCodeMatches(pattern: RegExp): Array<string> {
  return productFiles()
    .filter((relativePath: string): boolean => {
      return pattern.test(
        fs.readFileSync(path.join(REPOSITORY_DIRECTORY, relativePath), "utf8"),
      );
    })
    .filter((relativePath: string): boolean => {
      return pattern.test(codeOf(relativePath));
    });
}

// A listed file that should be in this checkout: ee/ only when it is there.
function isCheckedOut(relativePath: string): boolean {
  return hasEe || !relativePath.startsWith("ee/");
}

describe("every Redis counter is the client counter, or counts something that is not a client", () => {
  const incrementers: Array<string> =
    productFilesWhoseCodeMatches(REDIS_INCREMENT);

  test("the client counter is one of them", () => {
    expect(incrementers).toContain(COUNTER);
  });

  test("every other file that increments a Redis counter is listed with what it counts", () => {
    const unlisted: Array<string> = incrementers.filter(
      (relativePath: string): boolean => {
        return (
          relativePath !== COUNTER &&
          COUNTERS_NOT_KEYED_ON_A_CLIENT[relativePath] === undefined
        );
      },
    );

    expect(unlisted).toEqual([]);
  });

  test("every listed file still increments a counter, so the list cannot rot", () => {
    for (const relativePath of Object.keys(COUNTERS_NOT_KEYED_ON_A_CLIENT)) {
      if (!isCheckedOut(relativePath)) {
        continue;
      }

      expect([relativePath, incrementers.includes(relativePath)]).toEqual([
        relativePath,
        true,
      ]);
    }
  });

  test("no listed counter reads a client address", () => {
    for (const relativePath of Object.keys(COUNTERS_NOT_KEYED_ON_A_CLIENT)) {
      if (!isCheckedOut(relativePath)) {
        continue;
      }

      expect([
        relativePath,
        CLIENT_ADDRESS_READ.test(codeOf(relativePath)),
      ]).toEqual([relativePath, false]);
    }
  });

  test("the limits that count a client through the counter are the ones known, and increment nothing themselves", () => {
    const counterUsers: Array<string> = productFilesWhoseCodeMatches(
      COUNTS_THROUGH_COUNTER,
    );

    expect(counterUsers).toEqual([...REDIS_LIMITS].filter(isCheckedOut).sort());

    for (const relativePath of counterUsers) {
      expect([
        relativePath,
        REDIS_INCREMENT.test(codeOf(relativePath)),
      ]).toEqual([relativePath, false]);
    }
  });
});

describe("every file that reads a client address counts its /64, or does not count at all", () => {
  const readers: Array<string> = productFilesWhoseCodeMatches(
    CLIENT_ADDRESS_READ,
  ).filter((relativePath: string): boolean => {
    return relativePath !== CLIENT_IP_MODULE && relativePath !== COUNTER;
  });

  function countsThroughCounter(relativePath: string): boolean {
    const code: string = codeOf(relativePath);

    return IMPORTS_COUNTER.test(code) && COUNTS_THROUGH_COUNTER.test(code);
  }

  test("each one is a limit that counts through ClientRateLimitCounter, an in-memory limit that counts the /64, or is listed with why it reads the address", () => {
    const unsorted: Array<string> = readers.filter(
      (relativePath: string): boolean => {
        return (
          !countsThroughCounter(relativePath) &&
          !IN_MEMORY_LIMITS.includes(relativePath) &&
          ADDRESS_READERS_THAT_DO_NOT_COUNT[relativePath] === undefined
        );
      },
    );

    expect(unsorted).toEqual([]);
  });

  test("the limits that count in memory read the client's /64 and count it", () => {
    for (const relativePath of IN_MEMORY_LIMITS) {
      const code: string = codeOf(relativePath);

      expect([relativePath, READS_RATE_LIMIT_CLIENT.test(code)]).toEqual([
        relativePath,
        true,
      ]);
      expect([relativePath, COUNTS_THE_NETWORK.test(code)]).toEqual([
        relativePath,
        true,
      ]);
    }
  });

  test("every limit known to count a client address reads it, and counts it through ClientRateLimitCounter", () => {
    for (const relativePath of REDIS_LIMITS) {
      if (!isCheckedOut(relativePath)) {
        continue;
      }

      expect([relativePath, readers.includes(relativePath)]).toEqual([
        relativePath,
        true,
      ]);
      expect([relativePath, countsThroughCounter(relativePath)]).toEqual([
        relativePath,
        true,
      ]);
    }
  });

  test("every listed reader still reads a client address and counts nothing, so the list cannot rot", () => {
    for (const relativePath of Object.keys(ADDRESS_READERS_THAT_DO_NOT_COUNT)) {
      if (!isCheckedOut(relativePath)) {
        continue;
      }

      expect([relativePath, readers.includes(relativePath)]).toEqual([
        relativePath,
        true,
      ]);
      expect([
        relativePath,
        REDIS_INCREMENT.test(codeOf(relativePath)),
      ]).toEqual([relativePath, false]);
    }
  });
});

describe("the guard's own patterns", () => {
  test("see a Redis counter however it is incremented", () => {
    for (const code of [
      "await client.incr(`limit:${ip}`);",
      "client.pipeline().incr(key).exec();",
      "await client.incrby(key, 5);",
      "await redis.hincrby(key, field, 1);",
      "await GlobalCache.incrementWithExpiry(namespace, key, options);",
      "await GlobalCache.incrementIfBelow(namespace, key, options);",
      "redis.call('INCR', KEYS[1])",
    ]) {
      expect([code, REDIS_INCREMENT.test(code)]).toEqual([code, true]);
    }

    expect(REDIS_INCREMENT.test("const increment: number = 1;")).toBe(false);
  });

  test("see a client address read however it is imported", () => {
    for (const code of [
      'import resolveClientIp from "Common/Server/Utils/ClientIp";',
      'import { resolveClientIp } from "../Utils/ClientIp";',
      'import resolveTrustedClientIp, { ClientIpRequestLike } from "../ClientIp";',
      'import { getRateLimitClient } from "./ClientIp";',
      "const ip: string | undefined = getClientIp(req);",
      "const ip: string = IdentityRateLimit.resolveClientIp(req);",
      "const key: string = RunbookWebhookRateLimit.getAddressKey(req);",
    ]) {
      expect([code, CLIENT_ADDRESS_READ.test(code)]).toEqual([code, true]);
    }

    expect(
      CLIENT_ADDRESS_READ.test('import IP from "../../Types/IP/IP";'),
    ).toBe(false);
  });

  test("see a client address read around the ClientIp module", () => {
    for (const code of [
      "const key: string = `limit:${req.ip}`;",
      "const chain: Array<string> = req.ips;",
      "const ip: string | undefined = request?.ip;",
      "const peer: string | undefined = req.socket.remoteAddress;",
      "const peer: string | undefined = connection.remoteAddress;",
      'const header: unknown = req.headers["x-forwarded-for"];',
      'const header: unknown = req.get("X-Forwarded-For");',
      'const header: unknown = req.headers["x-real-ip"];',
      "const header: unknown = req.headers['cf-connecting-ip'];",
      'const header: unknown = req.header("True-Client-IP");',
    ]) {
      expect([code, CLIENT_ADDRESS_READ.test(code)]).toEqual([code, true]);
    }

    for (const code of [
      "const ip: string = monitor.ipAddress;",
      "const ips: Array<string> = section.ips;",
      'const legend: string = "Forwarded";',
      "const requestIp: string = data.requestIp;",
    ]) {
      expect([code, CLIENT_ADDRESS_READ.test(code)]).toEqual([code, false]);
    }
  });

  test("see the client counter imported from any folder, and from its own", () => {
    for (const code of [
      'import ClientRateLimitCounter from "../Utils/RateLimit/ClientRateLimitCounter";',
      'import ClientRateLimitCounter, { ClientRateLimitRefusal } from "../RateLimit/ClientRateLimitCounter";',
      'import ClientRateLimitCounter from "Common/Server/Utils/RateLimit/ClientRateLimitCounter";',
      'import ClientRateLimitCounter from "./ClientRateLimitCounter";',
    ]) {
      expect([code, IMPORTS_COUNTER.test(code)]).toEqual([code, true]);
    }

    for (const code of [
      'import OtherClientRateLimitCounter from "./OtherClientRateLimitCounter";',
      'import ClientRateLimitCounter from "../Elsewhere/ClientRateLimitCounter";',
    ]) {
      expect([code, IMPORTS_COUNTER.test(code)]).toEqual([code, false]);
    }
  });

  test("see a count through the client counter, with or without its type argument", () => {
    expect(
      COUNTS_THROUGH_COUNTER.test("await ClientRateLimitCounter.count({"),
    ).toBe(true);
    expect(
      COUNTS_THROUGH_COUNTER.test(
        "await ClientRateLimitCounter.count<IdentityRateLimitScope>({",
      ),
    ).toBe(true);
    expect(
      COUNTS_THROUGH_COUNTER.test(
        "await ClientRateLimitCounter.countDifferent<string>({",
      ),
    ).toBe(true);
    expect(
      COUNTS_THROUGH_COUNTER.test(
        "await ClientRateLimitCounter.countDifferent({",
      ),
    ).toBe(true);
    expect(
      COUNTS_THROUGH_COUNTER.test("await ClientRateLimitCounter.countFixed({"),
    ).toBe(false);
    expect(
      COUNTS_THROUGH_COUNTER.test(
        "await ClientRateLimitCounter.countDifferentThings({",
      ),
    ).toBe(false);
  });
});
