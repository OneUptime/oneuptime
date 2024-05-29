// https://www.typescriptlang.org/docs/handbook/mixins.html
import GenericObject from './GenericObject';

export type GConstructor<T = GenericObject> = new (...args: any[]) => T;
