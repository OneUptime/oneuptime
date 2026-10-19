/*
 * A SET OF UTF-16 CODE UNITS.
 *
 * The patterns this folder runs read a string the way JavaScript reads it
 * without the u flag: one code unit at a time, 0 to 0xFFFF. A character
 * class, an escape such as \d, the dot and a letter matched without regard
 * to case each come down to one of these sets.
 *
 * Kept as sorted, non-overlapping inclusive ranges. Membership is a bit test
 * for ASCII - most of what logs, names and titles hold - and a binary search
 * over the ranges above it.
 */

export const MAX_CODE_UNIT: number = 0xffff;

const ASCII_LIMIT: number = 128;

export default class CharacterSet {
  /*
   * [first0, last0, first1, last1, ...]: sorted, never overlapping or
   * touching, every bound inclusive.
   */
  public readonly ranges: ReadonlyArray<number>;

  private readonly asciiBits: Uint32Array;
  // The ranges above ASCII, each clipped to start at 128 at the lowest.
  private readonly highRanges: Uint32Array;
  // key(), once it has been asked for.
  private cachedKey: string | null = null;

  private constructor(ranges: Array<number>) {
    this.ranges = ranges;
    this.asciiBits = new Uint32Array(4);

    const high: Array<number> = [];

    for (let index: number = 0; index < ranges.length; index += 2) {
      const first: number = ranges[index]!;
      const last: number = ranges[index + 1]!;

      for (
        let codeUnit: number = first;
        codeUnit <= last && codeUnit < ASCII_LIMIT;
        codeUnit++
      ) {
        this.asciiBits[codeUnit >>> 5] =
          this.asciiBits[codeUnit >>> 5]! | (1 << (codeUnit & 31));
      }

      if (last >= ASCII_LIMIT) {
        high.push(Math.max(first, ASCII_LIMIT), last);
      }
    }

    this.highRanges = Uint32Array.from(high);
  }

  public static empty(): CharacterSet {
    return new CharacterSet([]);
  }

  public static all(): CharacterSet {
    return new CharacterSet([0, MAX_CODE_UNIT]);
  }

  public static of(codeUnit: number): CharacterSet {
    return new CharacterSet([codeUnit, codeUnit]);
  }

  /*
   * From [first, last] pairs in any order, overlapping or not. Bounds are
   * inclusive and must lie within 0..0xFFFF, first <= last.
   */
  public static fromPairs(pairs: ReadonlyArray<number>): CharacterSet {
    const count: number = pairs.length >>> 1;
    /*
     * Each range as one number - where it starts in the high half, where it
     * ends in the low half - so one numeric sort of a typed array orders
     * them by where they start, without an object per range.
     */
    const packed: Uint32Array = new Uint32Array(count);

    for (let index: number = 0; index < count; index++) {
      packed[index] = pairs[index * 2]! * 0x10000 + pairs[index * 2 + 1]!;
    }

    packed.sort();

    const merged: Array<number> = [];

    for (let index: number = 0; index < count; index++) {
      const first: number = packed[index]! >>> 16;
      const last: number = packed[index]! & 0xffff;
      const previousLast: number | undefined = merged[merged.length - 1];

      if (previousLast !== undefined && first <= previousLast + 1) {
        if (last > previousLast) {
          merged[merged.length - 1] = last;
        }

        continue;
      }

      merged.push(first, last);
    }

    return new CharacterSet(merged);
  }

  public static fromCodeUnits(codeUnits: Iterable<number>): CharacterSet {
    const pairs: Array<number> = [];

    for (const codeUnit of codeUnits) {
      pairs.push(codeUnit, codeUnit);
    }

    return CharacterSet.fromPairs(pairs);
  }

  public has(codeUnit: number): boolean {
    if (codeUnit < ASCII_LIMIT) {
      return ((this.asciiBits[codeUnit >>> 5]! >>> (codeUnit & 31)) & 1) === 1;
    }

    const high: Uint32Array = this.highRanges;
    let low: number = 0;
    let top: number = (high.length >>> 1) - 1;

    while (low <= top) {
      const middle: number = (low + top) >>> 1;

      if (codeUnit < high[middle * 2]!) {
        top = middle - 1;
      } else if (codeUnit > high[middle * 2 + 1]!) {
        low = middle + 1;
      } else {
        return true;
      }
    }

    return false;
  }

  public isEmpty(): boolean {
    return this.ranges.length === 0;
  }

  // How many code units the set holds.
  public size(): number {
    let size: number = 0;

    for (let index: number = 0; index < this.ranges.length; index += 2) {
      size += this.ranges[index + 1]! - this.ranges[index]! + 1;
    }

    return size;
  }

  // The one code unit the set holds, or null when it holds more or none.
  public singleCodeUnit(): number | null {
    if (this.ranges.length === 2 && this.ranges[0] === this.ranges[1]) {
      return this.ranges[0]!;
    }

    return null;
  }

  public union(other: CharacterSet): CharacterSet {
    return CharacterSet.fromPairs(this.ranges.concat(other.ranges));
  }

  public complement(): CharacterSet {
    const ranges: Array<number> = [];
    let next: number = 0;

    for (let index: number = 0; index < this.ranges.length; index += 2) {
      const first: number = this.ranges[index]!;

      if (first > next) {
        ranges.push(next, first - 1);
      }

      next = this.ranges[index + 1]! + 1;
    }

    if (next <= MAX_CODE_UNIT) {
      ranges.push(next, MAX_CODE_UNIT);
    }

    return new CharacterSet(ranges);
  }

  // A key two sets share exactly when they hold the same code units.
  public key(): string {
    if (this.cachedKey === null) {
      this.cachedKey = this.ranges.join(",");
    }

    return this.cachedKey;
  }
}
