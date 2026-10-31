/*
 * SHA-256 (FIPS 180-4), in plain TypeScript.
 *
 * Base58Check - the checksum of Bitcoin addresses and wallet-import keys -
 * needs a SHA-256 that runs wherever classification runs: on the server, in
 * a probe, and in the Dashboard's Test It box. Node's crypto is not there in
 * a browser and Web Crypto is asynchronous, so this small synchronous one is
 * used for that checksum only. Nothing here is used to protect anything.
 */

const ROUND_CONSTANTS: Uint32Array = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

export function sha256(message: Uint8Array): Uint8Array {
  const state: Uint32Array = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);

  // The message, a 1 bit, zeros, and the length in bits as 64 bits.
  const paddedLength: number = Math.ceil((message.length + 9) / 64) * 64;
  const padded: Uint8Array = new Uint8Array(paddedLength);

  padded.set(message);
  padded[message.length] = 0x80;

  const bitLength: number = message.length * 8;
  const view: DataView = new DataView(padded.buffer);

  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  const words: Uint32Array = new Uint32Array(64);

  for (let block: number = 0; block < paddedLength; block += 64) {
    for (let index: number = 0; index < 16; index++) {
      words[index] = view.getUint32(block + index * 4);
    }

    for (let index: number = 16; index < 64; index++) {
      const w15: number = words[index - 15]!;
      const w2: number = words[index - 2]!;
      const s0: number =
        rotateRight(w15, 7) ^ rotateRight(w15, 18) ^ (w15 >>> 3);
      const s1: number =
        rotateRight(w2, 17) ^ rotateRight(w2, 19) ^ (w2 >>> 10);

      words[index] = (words[index - 16]! + s0 + words[index - 7]! + s1) >>> 0;
    }

    let a: number = state[0]!;
    let b: number = state[1]!;
    let c: number = state[2]!;
    let d: number = state[3]!;
    let e: number = state[4]!;
    let f: number = state[5]!;
    let g: number = state[6]!;
    let h: number = state[7]!;

    for (let index: number = 0; index < 64; index++) {
      const sum1: number =
        rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose: number = (e & f) ^ (~e & g);
      const temp1: number =
        (h + sum1 + choose + ROUND_CONSTANTS[index]! + words[index]!) >>> 0;
      const sum0: number =
        rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority: number = (a & b) ^ (a & c) ^ (b & c);
      const temp2: number = (sum0 + majority) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    state[0] = (state[0]! + a) >>> 0;
    state[1] = (state[1]! + b) >>> 0;
    state[2] = (state[2]! + c) >>> 0;
    state[3] = (state[3]! + d) >>> 0;
    state[4] = (state[4]! + e) >>> 0;
    state[5] = (state[5]! + f) >>> 0;
    state[6] = (state[6]! + g) >>> 0;
    state[7] = (state[7]! + h) >>> 0;
  }

  const digest: Uint8Array = new Uint8Array(32);
  const digestView: DataView = new DataView(digest.buffer);

  for (let index: number = 0; index < 8; index++) {
    digestView.setUint32(index * 4, state[index]!);
  }

  return digest;
}
