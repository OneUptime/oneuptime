/**
 * Make all properties in T optional. Deep version.
 */

type QueryDeepPartialEntity<T> = {
  [P in keyof T]?:
    | (T[P] extends Array<infer U>
        ? Array<QueryDeepPartialEntity<U>>
        : T[P] extends ReadonlyArray<infer U>
          ? ReadonlyArray<QueryDeepPartialEntity<U>>
          : QueryDeepPartialEntity<T[P]>)
    | (() => string)
    | null;
};

export default QueryDeepPartialEntity;
