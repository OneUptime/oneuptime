import BadDataException from "../../Types/Exception/BadDataException";
import dns from "dns";
import http from "http";
import https from "https";
import { isIP, type LookupFunction } from "net";

export interface SafeWebhookRequestAgents {
  httpAgent: http.Agent;
  httpsAgent: https.Agent;
}

export async function validateWebhookTargetIsSafe(
  rawUrl: string,
): Promise<void> {
  const hostname: string = getValidatedWebhookHostname(rawUrl);

  if (isIP(hostname)) {
    assertPublicIpAddress(hostname);
    return;
  }

  let resolvedAddresses: Array<dns.LookupAddress> = [];
  try {
    resolvedAddresses = await dns.promises.lookup(hostname, { all: true });
  } catch {
    throw new BadDataException(
      "Webhook URL hostname could not be resolved via DNS.",
    );
  }

  assertResolvedAddressesAreSafe(resolvedAddresses);
}

export function createSafeWebhookRequestAgents(): SafeWebhookRequestAgents {
  return {
    httpAgent: new http.Agent({ lookup: safeWebhookLookup }),
    httpsAgent: new https.Agent({ lookup: safeWebhookLookup }),
  };
}

const safeWebhookLookup: LookupFunction = (
  hostname: string,
  options: dns.LookupOptions,
  callback: (
    error: NodeJS.ErrnoException | null,
    address: string | Array<dns.LookupAddress>,
    family?: number,
  ) => void,
): void => {
  const normalizedHostname: string = normalizeHostname(hostname);

  if (isIP(normalizedHostname)) {
    try {
      assertPublicIpAddress(normalizedHostname);
      callback(null, normalizedHostname, isIP(normalizedHostname));
    } catch (error) {
      callback(toLookupError(error), "", 0);
    }
    return;
  }

  dns.lookup(
    normalizedHostname,
    {
      ...options,
      all: true,
    },
    (
      error: NodeJS.ErrnoException | null,
      addresses: Array<dns.LookupAddress>,
    ): void => {
      if (error) {
        callback(error, [], 0);
        return;
      }

      try {
        assertResolvedAddressesAreSafe(addresses);
      } catch (lookupError) {
        callback(toLookupError(lookupError), [], 0);
        return;
      }

      if (options.all) {
        callback(null, addresses);
        return;
      }

      const firstAddress: dns.LookupAddress | undefined = addresses[0];
      if (!firstAddress) {
        callback(
          createLookupError("Webhook URL hostname did not resolve."),
          "",
          0,
        );
        return;
      }

      callback(null, firstAddress.address, firstAddress.family);
    },
  );
};

function getValidatedWebhookHostname(rawUrl: string): string {
  let parsedUrl: globalThis.URL;
  try {
    parsedUrl = new globalThis.URL(rawUrl);
  } catch {
    throw new BadDataException("Webhook URL is not a valid URL");
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new BadDataException("Webhook URL must use http or https protocol.");
  }

  const hostname: string = normalizeHostname(parsedUrl.hostname);

  if (!hostname) {
    throw new BadDataException("Webhook URL must include a host.");
  }

  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "metadata.google.internal"
  ) {
    throw new BadDataException(
      "Webhook URL points to a private, loopback, or link-local address and is not allowed.",
    );
  }

  return hostname;
}

function normalizeHostname(hostname: string): string {
  return hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
}

function assertResolvedAddressesAreSafe(
  addresses: Array<dns.LookupAddress>,
): void {
  if (addresses.length === 0) {
    throw new BadDataException("Webhook URL hostname did not resolve.");
  }

  for (const entry of addresses) {
    assertPublicIpAddress(normalizeHostname(entry.address));
  }
}

function assertPublicIpAddress(address: string): void {
  const family: number = isIP(address);

  if (
    family === 0 ||
    (family === 4 && isBlockedIpv4Address(address)) ||
    (family === 6 && isBlockedIpv6Address(address))
  ) {
    throw new BadDataException(
      "Webhook URL points to a private, loopback, link-local, or reserved address and is not allowed.",
    );
  }
}

function isBlockedIpv4Address(address: string): boolean {
  const octets: Array<number> = address.split(".").map((value: string) => {
    return Number(value);
  });
  const first: number = octets[0] as number;
  const second: number = octets[1] as number;
  const third: number = octets[2] as number;

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && third === 0) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
}

function isBlockedIpv6Address(address: string): boolean {
  const words: Array<number> | null = parseIpv6Words(address);

  if (!words) {
    return true;
  }

  const isIpv4Mapped: boolean =
    words.slice(0, 5).every((word: number) => {
      return word === 0;
    }) && words[5] === 0xffff;

  if (isIpv4Mapped) {
    const mappedIpv4Address: string = [
      (words[6] as number) >> 8,
      (words[6] as number) & 0xff,
      (words[7] as number) >> 8,
      (words[7] as number) & 0xff,
    ].join(".");

    return isBlockedIpv4Address(mappedIpv4Address);
  }

  /*
   * Publicly routable IPv6 unicast space is 2000::/3. Everything outside
   * that range is local, reserved, multicast, or otherwise non-global.
   */
  return ((words[0] as number) & 0xe000) !== 0x2000;
}

function parseIpv6Words(address: string): Array<number> | null {
  const halves: Array<string> = address.split("::");
  if (halves.length > 2) {
    return null;
  }

  const left: Array<string> = halves[0] ? halves[0].split(":") : [];
  const right: Array<string> = halves[1] ? halves[1].split(":") : [];
  const missingWords: number = 8 - left.length - right.length;

  if (
    missingWords < 0 ||
    (halves.length === 1 && missingWords !== 0) ||
    (halves.length === 2 && missingWords < 1)
  ) {
    return null;
  }

  const wordStrings: Array<string> = [
    ...left,
    ...Array<string>(missingWords).fill("0"),
    ...right,
  ];

  const words: Array<number> = wordStrings.map((word: string) => {
    return Number.parseInt(word, 16);
  });

  if (
    words.length !== 8 ||
    words.some((word: number) => {
      return !Number.isInteger(word) || word < 0 || word > 0xffff;
    })
  ) {
    return null;
  }

  return words;
}

function toLookupError(error: unknown): NodeJS.ErrnoException {
  if (error instanceof Error) {
    const lookupError: NodeJS.ErrnoException = error;
    lookupError.code = "EACCES";
    return lookupError;
  }

  return createLookupError("Unsafe webhook target.");
}

function createLookupError(message: string): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error(message);
  error.code = "EACCES";
  return error;
}
