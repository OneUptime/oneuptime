/* eslint-disable @typescript-eslint/no-explicit-any */
// We have an ES6 Map available, return the native instance

import { getGlobal } from './utils/global';

/** @public */
let bsonMap: MapConstructor;

const bsonGlobal = getGlobal<{ Map?: MapConstructor }>();
if (bsonGlobal.Map) {
  bsonMap = bsonGlobal.Map;
} else {
  // We will return a polyfill
  bsonMap = class Map {
    private _keys: string[];
    private _values: Record<string, any>;
    constructor(array: [string, any][] = []) {
      this._keys = [];
      this._values = {};

      for (let i = 0; i < array.length; i++) {
        if (array[i] == null) continue; // skip null and undefined
        const entry = array[i];
        const key = entry[0];
        const value = entry[1];
        // Add the key to the list of keys in order
        this._keys.push(key);
        // Add the key and value to the values dictionary with a point
        // to the location in the ordered keys list
        this._values[key] = { v: value, i: this._keys.length - 1 };
      }
    }
    clear() {
      this._keys = [];
      this._values = {};
    }
    delete(key: string) {
      const value = this._values[key];
      if (value == null) return false;
      // Delete entry
      delete this._values[key];
      // Remove the key from the ordered keys list
      this._keys.splice(value.i, 1);
      return true;
    }
    entries() {
      let index = 0;

      return {
        next: () => {
          const key = this._keys[index++];
          return {
            value: key !== undefined ? [key, this._values[key].v] : undefined,
            done: key !== undefined ? false : true
          };
        }
      };
    }
    forEach(callback: (this: this, value: any, key: string, self: this) => void, self?: this) {
      self = self || this;

      for (let i = 0; i < this._keys.length; i++) {
        const key = this._keys[i];
        // Call the forEach callback
        callback.call(self, this._values[key].v, key, self);
      }
    }
    get(key: string) {
      return this._values[key] ? this._values[key].v : undefined;
    }
    has(key: string) {
      return this._values[key] != null;
    }
    keys() {
      let index = 0;

      return {
        next: () => {
          const key = this._keys[index++];
          return {
            value: key !== undefined ? key : undefined,
            done: key !== undefined ? false : true
          };
        }
      };
    }
    set(key: string, value: any) {
      if (this._values[key]) {
        this._values[key].v = value;
        return this;
      }

      // Add the key to the list of keys in order
      this._keys.push(key);
      // Add the key and value to the values dictionary with a point
      // to the location in the ordered keys list
      this._values[key] = { v: value, i: this._keys.length - 1 };
      return this;
    }
    values() {
      let index = 0;

      return {
        next: () => {
          const key = this._keys[index++];
          return {
            value: key !== undefined ? this._values[key].v : undefined,
            done: key !== undefined ? false : true
          };
        }
      };
    }
    get size() {
      return this._keys.length;
    }
  } as unknown as MapConstructor;
}

export { bsonMap as Map };
