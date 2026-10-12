/*
 * Real NTP replies, captured on 2026-10-09 by sending one SNTP v4 client
 * request (LI 0, VN 4, mode 3, a random transmit timestamp) to each server
 * and recording the reply byte for byte, with the probe's send and receive
 * times in Unix milliseconds.
 *
 * tick.jrc.us and tock.jrc.us are the servers named in issue #4617. Both
 * answer a version 4 request in version 3 (first byte 0x1c), as time.nist.gov
 * does - which is why a reply may carry any version from 1 to 4.
 */
export interface CapturedNtpReply {
  server: string;
  // The request's transmit timestamp, which the reply must echo as its origin.
  nonceHex: string;
  replyHex: string;
  sentAtUnixMs: number;
  receivedAtUnixMs: number;
  // What the header says, read by hand from the bytes.
  expected: {
    leapIndicator: number;
    version: number;
    stratum: number;
    poll: number;
    precision: number;
    referenceId: string;
  };
}

export const CAPTURED_NTP_REPLIES: Array<CapturedNtpReply> = [
  {
    server: "time.google.com",
    nonceHex: "428eb344302e8294",
    replyHex:
      "240100ec0000000000000006474f4f47ee73ce7c5f62477e428eb344302e8294ee73ce7c5f62477fee73ce7c5f624781",
    sentAtUnixMs: 1791578108367,
    receivedAtUnixMs: 1791578108376,
    expected: {
      leapIndicator: 0,
      version: 4,
      stratum: 1,
      poll: 0,
      precision: -20,
      referenceId: "GOOG",
    },
  },
  {
    server: "time.cloudflare.com",
    nonceHex: "b159fbee12d84499",
    replyHex:
      "240300e700000260000000240a820804ee73ce7725b677fab159fbee12d84499ee73ce7c6160a827ee73ce7c616926d6",
    sentAtUnixMs: 1791578108378,
    receivedAtUnixMs: 1791578108380,
    expected: {
      leapIndicator: 0,
      version: 4,
      stratum: 3,
      poll: 0,
      precision: -25,
      referenceId: "10.130.8.4",
    },
  },
  {
    server: "pool.ntp.org",
    nonceHex: "8f892e2cec4ccc66",
    replyHex:
      "240200e8000002b900000972e4bc0f93ee73cafa8e4275118f892e2cec4ccc66ee73ce7c8dff7006ee73ce7c8e008c0a",
    sentAtUnixMs: 1791578108382,
    receivedAtUnixMs: 1791578108585,
    expected: {
      leapIndicator: 0,
      version: 4,
      stratum: 2,
      poll: 0,
      precision: -24,
      referenceId: "228.188.15.147",
    },
  },
  {
    server: "tick.jrc.us",
    nonceHex: "62c4f0881d03751b",
    replyHex:
      "1c0204ee0000022a00082d02121a0469ee73c9a5296b597562c4f0881d03751bee73ce7c9ac41c68ee73ce7c9ac5400f",
    sentAtUnixMs: 1791578108594,
    receivedAtUnixMs: 1791578108611,
    expected: {
      leapIndicator: 0,
      version: 3,
      stratum: 2,
      poll: 4,
      precision: -18,
      referenceId: "18.26.4.105",
    },
  },
  {
    server: "tock.jrc.us",
    nonceHex: "0ece3e76a0376d73",
    replyHex:
      "1c0204ee000000ac00000035d05a9049ee73cd16ed7e99690ece3e76a0376d73ee73ce7c9fc39e66ee73ce7c9fc40df3",
    sentAtUnixMs: 1791578108621,
    receivedAtUnixMs: 1791578108626,
    expected: {
      leapIndicator: 0,
      version: 3,
      stratum: 2,
      poll: 4,
      precision: -18,
      referenceId: "208.90.144.73",
    },
  },
  {
    server: "time.nist.gov",
    nonceHex: "21767e98c0755569",
    replyHex:
      "1c010de300000010000000204e495354ee73ce000000000021767e98c0755569ee73ce7ca89a4170ee73ce7ca89a6053",
    sentAtUnixMs: 1791578108637,
    receivedAtUnixMs: 1791578108679,
    expected: {
      leapIndicator: 0,
      version: 3,
      stratum: 1,
      poll: 13,
      precision: -29,
      referenceId: "NIST",
    },
  },
];
