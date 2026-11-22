import {
  SecurityBlockAction,
  SecurityBlockIndicatorType,
  SecurityBlockReach,
  getSecurityBlockReach,
  isSecurityBlockAddressType,
  isSecurityBlockFileType,
} from "./SecurityBlock";

/*
 * WHAT THE PROJECT'S DESTINATIONS CAN HOLD (#10346), as everyone who asks
 * before a block reads it: the server, refusing a block nothing could hold;
 * a case's Response Plan, offering a step as one click only where a
 * destination holds it and naming the destinations ("Block evil.example on
 * every machine with Microsoft Defender."); the Blocklist page.
 *
 * Worked out on the server from each destination's supports()
 * (SecurityBlockDestinations.getHolders), and sent as it is: a destination
 * that cannot hold a kind of value says so itself - CrowdStrike Falcon only
 * detects a domain or an address on a computer, so it holds files alone.
 */

export interface SecurityBlockHolder {
  // As people read it: "Microsoft Defender", "Cloudflare".
  name: string;
  provider: string;
  // An endpoint product: it holds an address only when it is blocked everywhere.
  enforcesOnEveryMachine: boolean;
  // The kinds of value it blocks.
  blocks: Array<SecurityBlockIndicatorType>;
  // Whether it can also quarantine the copies of a file it blocks.
  quarantinesFiles: boolean;
}

// A value of each kind, for asking a destination whether it holds that kind at all.
export const SECURITY_BLOCK_SAMPLE_VALUES: Readonly<
  Record<SecurityBlockIndicatorType, string>
> = {
  [SecurityBlockIndicatorType.IpAddress]: "198.51.100.7",
  [SecurityBlockIndicatorType.IpRange]: "198.51.100.0/24",
  [SecurityBlockIndicatorType.Domain]: "evil.example",
  [SecurityBlockIndicatorType.Url]: "https://evil.example/",
  [SecurityBlockIndicatorType.FileSha256]: "a".repeat(64),
  [SecurityBlockIndicatorType.FileSha1]: "a".repeat(40),
  [SecurityBlockIndicatorType.FileMd5]: "a".repeat(32),
};

/*
 * The holders a block of this kind, with this action and reach, would be
 * held by: an endpoint product only for a block everywhere, and only of a
 * kind it blocks; a file to quarantine only where files are quarantined.
 */
export function getSecurityBlockHolders(data: {
  holders: ReadonlyArray<SecurityBlockHolder>;
  indicatorType: SecurityBlockIndicatorType;
  action?: SecurityBlockAction | undefined;
  reach?: SecurityBlockReach | undefined;
}): Array<SecurityBlockHolder> {
  const reach: SecurityBlockReach = getSecurityBlockReach({
    indicatorType: data.indicatorType,
    reach: data.reach,
  });

  return data.holders.filter((holder: SecurityBlockHolder): boolean => {
    if (
      holder.enforcesOnEveryMachine &&
      reach !== SecurityBlockReach.Everywhere
    ) {
      return false;
    }

    if (!holder.blocks.includes(data.indicatorType)) {
      return false;
    }

    return (
      data.action !== SecurityBlockAction.BlockAndQuarantine ||
      holder.quarantinesFiles
    );
  });
}

/*
 * The endpoint products that block a value of this kind on every machine:
 * what a case's step names ("with Microsoft Defender").
 */
export function getEveryMachineHolders(data: {
  holders: ReadonlyArray<SecurityBlockHolder>;
  indicatorType: SecurityBlockIndicatorType;
  action?: SecurityBlockAction | undefined;
}): Array<SecurityBlockHolder> {
  return getSecurityBlockHolders({
    ...data,
    reach: SecurityBlockReach.Everywhere,
  }).filter((holder: SecurityBlockHolder): boolean => {
    return holder.enforcesOnEveryMachine;
  });
}

// The names of the holders, each once, in the order given.
export function getSecurityBlockHolderNames(
  holders: ReadonlyArray<SecurityBlockHolder>,
): Array<string> {
  const names: Array<string> = [];

  for (const holder of holders) {
    const name: string = (holder.name || "").trim();

    if (name && !names.includes(name)) {
      names.push(name);
    }
  }

  return names;
}

/*
 * Why a block of this kind is refused when nothing the project connected
 * could hold it, in English, as the server answers: what to turn on, and
 * where. Null for an address at the edge - the blocklist keeps it, and says
 * it is not enforced anywhere until a destination is connected (#10338).
 */
export function getSecurityBlockUnheldMessage(data: {
  indicatorType: SecurityBlockIndicatorType;
  action: SecurityBlockAction;
  reach: SecurityBlockReach;
}): string | null {
  if (isSecurityBlockAddressType(data.indicatorType)) {
    return data.reach === SecurityBlockReach.Everywhere
      ? "Nothing you have connected blocks an address on every machine. Turn on Block domains, addresses and files with Defender on your Microsoft Defender XDR connection, or block the address at the edge."
      : null;
  }

  if (isSecurityBlockFileType(data.indicatorType)) {
    if (data.action === SecurityBlockAction.BlockAndQuarantine) {
      return "Nothing you have connected quarantines files. Turn on Block domains, addresses and files with Defender on your Microsoft Defender XDR connection, or block the file without quarantining it.";
    }

    return data.indicatorType === SecurityBlockIndicatorType.FileSha1
      ? "Nothing you have connected blocks a file by its SHA-1 hash. Turn on Block domains, addresses and files with Defender on your Microsoft Defender XDR connection, or block the file by its SHA-256 or MD5 hash."
      : "Nothing you have connected blocks files. Turn on blocking on your Microsoft Defender XDR or CrowdStrike Falcon connection.";
  }

  return data.indicatorType === SecurityBlockIndicatorType.Url
    ? "Nothing you have connected blocks URLs. Turn on Block domains, addresses and files with Defender on your Microsoft Defender XDR connection."
    : "Nothing you have connected blocks domains. Turn on Block domains, addresses and files with Defender on your Microsoft Defender XDR connection.";
}
