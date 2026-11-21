import {
  SecurityBlockAction,
  SecurityBlockIndicatorType,
  SecurityBlockIndicatorValue,
  SecurityBlockReach,
  readSecurityBlockIndicator,
} from "../../../Types/SecurityBlocklist/SecurityBlock";
import {
  SECURITY_BLOCK_SAMPLE_VALUES,
  SecurityBlockHolder,
  getEveryMachineHolders,
  getSecurityBlockHolderNames,
  getSecurityBlockHolders,
  getSecurityBlockUnheldMessage,
} from "../../../Types/SecurityBlocklist/SecurityBlockHolders";
import { describe, expect, test } from "@jest/globals";

/*
 * What the project's destinations can hold (#10346): what the server reads
 * before it refuses a block nothing could hold, and what a case's plan
 * reads to offer a step as one click and name the product.
 */

const CLOUDFLARE: SecurityBlockHolder = {
  name: "Cloudflare",
  provider: "Cloudflare",
  enforcesOnEveryMachine: false,
  blocks: [SecurityBlockIndicatorType.IpAddress, SecurityBlockIndicatorType.IpRange],
  quarantinesFiles: false,
};

const DEFENDER: SecurityBlockHolder = {
  name: "Microsoft Defender",
  provider: "MicrosoftDefender",
  enforcesOnEveryMachine: true,
  blocks: [
    SecurityBlockIndicatorType.IpAddress,
    SecurityBlockIndicatorType.Domain,
    SecurityBlockIndicatorType.Url,
    SecurityBlockIndicatorType.FileSha256,
    SecurityBlockIndicatorType.FileSha1,
    SecurityBlockIndicatorType.FileMd5,
  ],
  quarantinesFiles: true,
};

const CROWDSTRIKE: SecurityBlockHolder = {
  name: "CrowdStrike Falcon",
  provider: "CrowdStrike",
  enforcesOnEveryMachine: true,
  blocks: [
    SecurityBlockIndicatorType.FileSha256,
    SecurityBlockIndicatorType.FileMd5,
  ],
  quarantinesFiles: false,
};

const ALL: Array<SecurityBlockHolder> = [CLOUDFLARE, DEFENDER, CROWDSTRIKE];

describe("getSecurityBlockHolders", () => {
  test("an address at the edge is held at the edge only", () => {
    expect(
      getSecurityBlockHolders({
        holders: ALL,
        indicatorType: SecurityBlockIndicatorType.IpAddress,
      }),
    ).toEqual([CLOUDFLARE]);
  });

  test("an address everywhere is held at the edge and on every machine that blocks addresses", () => {
    expect(
      getSecurityBlockHolders({
        holders: ALL,
        indicatorType: SecurityBlockIndicatorType.IpAddress,
        reach: SecurityBlockReach.Everywhere,
      }),
    ).toEqual([CLOUDFLARE, DEFENDER]);
  });

  test("a range is never held on a machine that takes one address at a time", () => {
    expect(
      getSecurityBlockHolders({
        holders: ALL,
        indicatorType: SecurityBlockIndicatorType.IpRange,
        reach: SecurityBlockReach.Everywhere,
      }),
    ).toEqual([CLOUDFLARE]);
  });

  test("a domain, whatever reach is asked, is held where domains are blocked", () => {
    expect(
      getSecurityBlockHolders({
        holders: ALL,
        indicatorType: SecurityBlockIndicatorType.Domain,
        reach: SecurityBlockReach.Edge,
      }),
    ).toEqual([DEFENDER]);
  });

  test("a file is held by every product that blocks its hash's kind; quarantined only where files are", () => {
    expect(
      getSecurityBlockHolders({
        holders: ALL,
        indicatorType: SecurityBlockIndicatorType.FileSha256,
      }),
    ).toEqual([DEFENDER, CROWDSTRIKE]);
    expect(
      getSecurityBlockHolders({
        holders: ALL,
        indicatorType: SecurityBlockIndicatorType.FileSha1,
      }),
    ).toEqual([DEFENDER]);
    expect(
      getSecurityBlockHolders({
        holders: ALL,
        indicatorType: SecurityBlockIndicatorType.FileMd5,
        action: SecurityBlockAction.BlockAndQuarantine,
      }),
    ).toEqual([DEFENDER]);
  });

  test("getEveryMachineHolders keeps the endpoint products alone", () => {
    expect(
      getEveryMachineHolders({
        holders: ALL,
        indicatorType: SecurityBlockIndicatorType.IpAddress,
      }),
    ).toEqual([DEFENDER]);
    expect(
      getEveryMachineHolders({
        holders: [CLOUDFLARE],
        indicatorType: SecurityBlockIndicatorType.IpAddress,
      }),
    ).toEqual([]);
  });
});

describe("getSecurityBlockHolderNames", () => {
  test("each name once, in the order given, blanks left out", () => {
    expect(
      getSecurityBlockHolderNames([
        DEFENDER,
        { ...DEFENDER },
        { ...CROWDSTRIKE, name: "  " },
        CROWDSTRIKE,
      ]),
    ).toEqual(["Microsoft Defender", "CrowdStrike Falcon"]);
  });
});

describe("getSecurityBlockUnheldMessage", () => {
  test("an address at the edge is kept whatever is connected", () => {
    expect(
      getSecurityBlockUnheldMessage({
        indicatorType: SecurityBlockIndicatorType.IpAddress,
        action: SecurityBlockAction.Block,
        reach: SecurityBlockReach.Edge,
      }),
    ).toBeNull();
  });

  test("each other kind says what to turn on, and where", () => {
    expect(
      getSecurityBlockUnheldMessage({
        indicatorType: SecurityBlockIndicatorType.IpAddress,
        action: SecurityBlockAction.Block,
        reach: SecurityBlockReach.Everywhere,
      }),
    ).toContain("blocks an address on every machine");
    expect(
      getSecurityBlockUnheldMessage({
        indicatorType: SecurityBlockIndicatorType.Domain,
        action: SecurityBlockAction.Block,
        reach: SecurityBlockReach.Everywhere,
      }),
    ).toBe(
      "Nothing you have connected blocks domains. Turn on Block domains, addresses and files with Defender on your Microsoft Defender XDR connection.",
    );
    expect(
      getSecurityBlockUnheldMessage({
        indicatorType: SecurityBlockIndicatorType.Url,
        action: SecurityBlockAction.Block,
        reach: SecurityBlockReach.Everywhere,
      }),
    ).toContain("blocks URLs");
    expect(
      getSecurityBlockUnheldMessage({
        indicatorType: SecurityBlockIndicatorType.FileSha256,
        action: SecurityBlockAction.Block,
        reach: SecurityBlockReach.Everywhere,
      }),
    ).toContain("Microsoft Defender XDR or CrowdStrike Falcon");
    expect(
      getSecurityBlockUnheldMessage({
        indicatorType: SecurityBlockIndicatorType.FileSha1,
        action: SecurityBlockAction.Block,
        reach: SecurityBlockReach.Everywhere,
      }),
    ).toContain("SHA-1");
    expect(
      getSecurityBlockUnheldMessage({
        indicatorType: SecurityBlockIndicatorType.FileMd5,
        action: SecurityBlockAction.BlockAndQuarantine,
        reach: SecurityBlockReach.Everywhere,
      }),
    ).toContain("quarantines files");
  });

  test("every message is a sentence", () => {
    for (const indicatorType of Object.values(SecurityBlockIndicatorType)) {
      const message: string | null = getSecurityBlockUnheldMessage({
        indicatorType,
        action: SecurityBlockAction.Block,
        reach: SecurityBlockReach.Everywhere,
      });

      expect(message).not.toBeNull();
      expect(message!.charAt(0)).toMatch(/[A-Z]/);
      expect(message!.endsWith(".")).toBe(true);
    }
  });
});

describe("SECURITY_BLOCK_SAMPLE_VALUES", () => {
  test("each is read as its own kind, so a destination is asked about exactly that kind", () => {
    for (const indicatorType of Object.values(SecurityBlockIndicatorType)) {
      const read: SecurityBlockIndicatorValue | null =
        readSecurityBlockIndicator(SECURITY_BLOCK_SAMPLE_VALUES[indicatorType]);

      expect(read?.indicatorType).toBe(indicatorType);
    }
  });
});
