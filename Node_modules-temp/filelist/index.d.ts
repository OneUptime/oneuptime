// Type definitions for filelist v0.0.6
// Project: https://github.com/mde/filelist
// Definitions by: Christophe MASSOLIN <https://github.com/FuriouZz>
// Definitions: https://github.com/DefinitelyTyped/DefinitelyTyped

declare module "filelist" {
  export class FileList {
    pendingAdd: string[]
    pending: boolean
    excludes: {
      pats: RegExp[],
      funcs: Function[],
      regex: null | RegExp
    }
    items: string[]
    static clone(): FileList
    static verbose: boolean
    toArray(): string[]
    include(options: any, ...items: string[]): void
    exclude(...items: string[]): void
    resolve(): void
    clearInclusions(): void
    clearExclusions(): void
    length(): number
    toString(): string;
    toLocaleString(): string;
    push(...items: string[]): number;
    pop(): string | undefined;
    concat(...items: ReadonlyArray<string>[]): string[];
    concat(...items: (string | ReadonlyArray<string>)[]): string[];
    join(separator?: string): string;
    reverse(): string[];
    shift(): string | undefined;
    slice(start?: number, end?: number): string[];
    sort(compareFn?: (a: string, b: string) => number): this;
    splice(start: number, deleteCount?: number): string[];
    splice(start: number, deleteCount: number, ...items: string[]): string[];
    unshift(...items: string[]): number;
    indexOf(searchElement: string, fromIndex?: number): number;
    lastIndexOf(searchElement: string, fromIndex?: number): number;
    every(callbackfn: (value: string, index: number, array: string[]) => boolean, thisArg?: any): boolean;
    some(callbackfn: (value: string, index: number, array: string[]) => boolean, thisArg?: any): boolean;
    forEach(callbackfn: (value: string, index: number, array: string[]) => void, thisArg?: any): void;
    map<U>(callbackfn: (value: string, index: number, array: string[]) => U, thisArg?: any): U[];
    filter<S extends string>(callbackfn: (value: string, index: number, array: string[]) => value is S, thisArg?: any): S[];
    filter(callbackfn: (value: string, index: number, array: string[]) => any, thisArg?: any): string[];
    reduce(callbackfn: (previousValue: string, currentValue: string, currentIndex: number, array: string[]) => string): string;
    reduce(callbackfn: (previousValue: string, currentValue: string, currentIndex: number, array: string[]) => string, initialValue: string): string;
    reduce<U>(callbackfn: (previousValue: U, currentValue: string, currentIndex: number, array: string[]) => U, initialValue: U): U;
    reduceRight(callbackfn: (previousValue: string, currentValue: string, currentIndex: number, array: string[]) => string): string;
    reduceRight(callbackfn: (previousValue: string, currentValue: string, currentIndex: number, array: string[]) => string, initialValue: string): string;
    reduceRight<U>(callbackfn: (previousValue: U, currentValue: string, currentIndex: number, array: string[]) => U, initialValue: U): U;
  }
}