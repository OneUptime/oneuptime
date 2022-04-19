import { Buffer } from 'buffer';
import { getGlobal } from '../utils/global';

type RandomBytesFunction = (size: number) => Uint8Array;

/**
 * Normalizes our expected stringified form of a function across versions of node
 * @param fn - The function to stringify
 */
export function normalizedFunctionString(fn: Function): string {
  return fn.toString().replace('function(', 'function (');
}

function isReactNative() {
  const g = getGlobal<{ navigator?: { product?: string } }>();
  return typeof g.navigator === 'object' && g.navigator.product === 'ReactNative';
}

const insecureRandomBytes: RandomBytesFunction = function insecureRandomBytes(size: number) {
  const insecureWarning = isReactNative()
    ? 'BSON: For React Native please polyfill crypto.getRandomValues, e.g. using: https://www.npmjs.com/package/react-native-get-random-values.'
    : 'BSON: No cryptographic implementation for random bytes present, falling back to a less secure implementation.';
  console.warn(insecureWarning);

  const result = Buffer.alloc(size);
  for (let i = 0; i < size; ++i) result[i] = Math.floor(Math.random() * 256);
  return result;
};

/* We do not want to have to include DOM types just for this check */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare let window: any;
declare let require: Function;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare let global: any;
declare const self: unknown;

const detectRandomBytes = (): RandomBytesFunction => {
  if (typeof window !== 'undefined') {
    // browser crypto implementation(s)
    const target = window.crypto || window.msCrypto; // allow for IE11
    if (target && target.getRandomValues) {
      return size => target.getRandomValues(Buffer.alloc(size));
    }
  }

  if (typeof global !== 'undefined' && global.crypto && global.crypto.getRandomValues) {
    // allow for RN packages such as https://www.npmjs.com/package/react-native-get-random-values to populate global
    return size => global.crypto.getRandomValues(Buffer.alloc(size));
  }

  let requiredRandomBytes: RandomBytesFunction | null | undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    requiredRandomBytes = require('crypto').randomBytes;
  } catch (e) {
    // keep the fallback
  }

  // NOTE: in transpiled cases the above require might return null/undefined

  return requiredRandomBytes || insecureRandomBytes;
};

export const randomBytes = detectRandomBytes();

export function isAnyArrayBuffer(value: unknown): value is ArrayBuffer {
  return ['[object ArrayBuffer]', '[object SharedArrayBuffer]'].includes(
    Object.prototype.toString.call(value)
  );
}

export function isUint8Array(value: unknown): value is Uint8Array {
  return Object.prototype.toString.call(value) === '[object Uint8Array]';
}

export function isBigInt64Array(value: unknown): value is BigInt64Array {
  return Object.prototype.toString.call(value) === '[object BigInt64Array]';
}

export function isBigUInt64Array(value: unknown): value is BigUint64Array {
  return Object.prototype.toString.call(value) === '[object BigUint64Array]';
}

export function isRegExp(d: unknown): d is RegExp {
  return Object.prototype.toString.call(d) === '[object RegExp]';
}

export function isMap(d: unknown): d is Map<unknown, unknown> {
  return Object.prototype.toString.call(d) === '[object Map]';
}

/** Call to check if your environment has `Buffer` */
export function haveBuffer(): boolean {
  return typeof global !== 'undefined' && typeof global.Buffer !== 'undefined';
}

// To ensure that 0.4 of node works correctly
export function isDate(d: unknown): d is Date {
  return isObjectLike(d) && Object.prototype.toString.call(d) === '[object Date]';
}

/**
 * @internal
 * this is to solve the `'someKey' in x` problem where x is unknown.
 * https://github.com/typescript-eslint/typescript-eslint/issues/1071#issuecomment-541955753
 */
export function isObjectLike(candidate: unknown): candidate is Record<string, unknown> {
  return typeof candidate === 'object' && candidate !== null;
}

declare let console: { warn(...message: unknown[]): void };
export function deprecate<T extends Function>(fn: T, message: string): T {
  let warned = false;
  function deprecated(this: unknown, ...args: unknown[]) {
    if (!warned) {
      console.warn(message);
      warned = true;
    }
    return fn.apply(this, args);
  }
  return deprecated as unknown as T;
}
