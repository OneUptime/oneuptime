import crypto from "crypto";
import net from "net";

/*
 * A self-signed certificate made when a test runs, so the IRC client's TLS
 * can be tested against a real handshake without a private key in the
 * repository or a dependency on openssl being installed.
 *
 * Node can sign but not build a certificate, so this writes the few DER
 * structures X.509 needs (RFC 5280) by hand: a P-256 key, a day either side
 * of now, a subjectAltName with the names and addresses asked for, and
 * basicConstraints CA:TRUE, as `openssl req -x509` makes. A client trusts it
 * by being given it as its `ca`.
 */

export interface TestCertificate {
  key: string;
  cert: string;
}

const encodeLength: (length: number) => Buffer = (length: number): Buffer => {
  if (length < 0x80) {
    return Buffer.from([length]);
  }

  const bytes: Array<number> = [];
  let remaining: number = length;

  while (remaining > 0) {
    bytes.unshift(remaining % 256);
    remaining = Math.floor(remaining / 256);
  }

  return Buffer.from([0x80 | bytes.length, ...bytes]);
};

const encode: (tag: number, value: Buffer) => Buffer = (
  tag: number,
  value: Buffer,
): Buffer => {
  return Buffer.concat([Buffer.from([tag]), encodeLength(value.length), value]);
};

const sequence: (...items: Array<Buffer>) => Buffer = (
  ...items: Array<Buffer>
): Buffer => {
  return encode(0x30, Buffer.concat(items));
};

const set: (...items: Array<Buffer>) => Buffer = (
  ...items: Array<Buffer>
): Buffer => {
  return encode(0x31, Buffer.concat(items));
};

const objectIdentifier: (dotted: string) => Buffer = (
  dotted: string,
): Buffer => {
  const parts: Array<number> = dotted.split(".").map(Number);
  const bytes: Array<number> = [parts[0]! * 40 + parts[1]!];

  for (const part of parts.slice(2)) {
    const base128: Array<number> = [part % 128];
    let rest: number = Math.floor(part / 128);

    while (rest > 0) {
      base128.unshift(rest % 128 | 0x80);
      rest = Math.floor(rest / 128);
    }

    bytes.push(...base128);
  }

  return encode(0x06, Buffer.from(bytes));
};

const utcTime: (date: Date) => Buffer = (date: Date): Buffer => {
  const pad: (value: number) => string = (value: number): string => {
    return String(value).padStart(2, "0");
  };

  return encode(
    0x17,
    Buffer.from(
      `${pad(date.getUTCFullYear() % 100)}${pad(date.getUTCMonth() + 1)}${pad(
        date.getUTCDate(),
      )}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(
        date.getUTCSeconds(),
      )}Z`,
      "ascii",
    ),
  );
};

const TRUE: Buffer = encode(0x01, Buffer.from([0xff]));

// ecdsa-with-SHA256, which takes no parameters.
const SIGNATURE_ALGORITHM: Buffer = sequence(
  objectIdentifier("1.2.840.10045.4.3.2"),
);

export const createTestCertificate: (data: {
  commonName: string;
  dnsNames?: Array<string> | undefined;
  ipAddresses?: Array<string> | undefined;
}) => TestCertificate = (data: {
  commonName: string;
  dnsNames?: Array<string> | undefined;
  ipAddresses?: Array<string> | undefined;
}): TestCertificate => {
  const keys: { publicKey: crypto.KeyObject; privateKey: crypto.KeyObject } =
    crypto.generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });

  const name: Buffer = sequence(
    set(
      sequence(
        objectIdentifier("2.5.4.3"),
        encode(0x0c, Buffer.from(data.commonName, "utf8")),
      ),
    ),
  );

  const now: number = Date.now();
  const day: number = 24 * 60 * 60 * 1000;

  const alternativeNames: Array<Buffer> = [
    // dNSName [2] IA5String
    ...(data.dnsNames || []).map((dnsName: string) => {
      return encode(0x82, Buffer.from(dnsName, "ascii"));
    }),
    // iPAddress [7] OCTET STRING
    ...(data.ipAddresses || []).map((address: string) => {
      if (net.isIPv4(address) === false) {
        throw new Error("Only IPv4 addresses are supported here.");
      }

      return encode(
        0x87,
        Buffer.from(
          address.split(".").map((octet: string) => {
            return Number(octet);
          }),
        ),
      );
    }),
  ];

  // Positive, and with no leading zero byte: DER wants the shortest form.
  const serialNumber: Buffer = crypto.randomBytes(8);
  serialNumber[0] = (serialNumber[0]! & 0x7f) | 0x01;

  const toBeSigned: Buffer = sequence(
    // [0] EXPLICIT version: v3
    encode(0xa0, encode(0x02, Buffer.from([2]))),
    encode(0x02, serialNumber),
    SIGNATURE_ALGORITHM,
    name,
    sequence(utcTime(new Date(now - day)), utcTime(new Date(now + day))),
    name,
    keys.publicKey.export({ type: "spki", format: "der" }),
    // [3] EXPLICIT extensions
    encode(
      0xa3,
      sequence(
        // basicConstraints, critical: CA:TRUE
        sequence(
          objectIdentifier("2.5.29.19"),
          TRUE,
          encode(0x04, sequence(TRUE)),
        ),
        // subjectAltName
        sequence(
          objectIdentifier("2.5.29.17"),
          encode(0x04, sequence(...alternativeNames)),
        ),
      ),
    ),
  );

  // Node signs with an EC key in DER, which is what X.509 carries.
  const signature: Buffer = crypto.sign("sha256", toBeSigned, keys.privateKey);

  const certificate: Buffer = sequence(
    toBeSigned,
    SIGNATURE_ALGORITHM,
    // BIT STRING, no unused bits
    encode(0x03, Buffer.concat([Buffer.from([0]), signature])),
  );

  const base64: string = certificate.toString("base64");
  const lines: Array<string> = [];

  for (let start: number = 0; start < base64.length; start += 64) {
    lines.push(base64.substring(start, start + 64));
  }

  return {
    key: keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    cert: `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----\n`,
  };
};
