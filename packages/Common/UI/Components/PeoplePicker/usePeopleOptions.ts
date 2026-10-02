import ObjectID from "../../../Types/ObjectID";
import API from "../../Utils/API/API";
import ProjectUtil from "../../Utils/Project";
import {
  getPeoplePickerKindDefinition,
  PeoplePickerKindDefinition,
} from "./PeoplePickerKinds";
import {
  getPeoplePickerOptionKey,
  PeoplePickerKind,
  PeoplePickerOption,
  PeoplePickerValue,
} from "./PeoplePickerTypes";
import {
  MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * The names behind a picker's ids. A pick made in the search list is known
 * already; a pick the form started with - an edit form, a template's owners -
 * is only an id, and is looked up once, per kind in one request. One that is
 * not found any more (a person who left the project, a deleted team) is kept
 * as an unknown pick, so it can still be seen and removed.
 */

export interface PeopleOptionsLookup {
  // The option for a pick, once known; undefined while it is looked up.
  getOption: (
    kind: PeoplePickerKind,
    id: string,
  ) => PeoplePickerOption | undefined;
  // Options already in hand - a search result - so they are never fetched.
  remember: (options: Array<PeoplePickerOption>) => void;
  isLoading: boolean;
  error: string;
}

export const getPeoplePickerValueSignature: (
  kinds: Array<PeoplePickerKind>,
  value: PeoplePickerValue,
) => string = (
  kinds: Array<PeoplePickerKind>,
  value: PeoplePickerValue,
): string => {
  return kinds
    .map((kind: PeoplePickerKind): string => {
      return `${kind}=${(value[kind] || []).join(",")}`;
    })
    .join("|");
};

const usePeopleOptions: (data: {
  kinds: Array<PeoplePickerKind>;
  value: PeoplePickerValue;
}) => PeopleOptionsLookup = (data: {
  kinds: Array<PeoplePickerKind>;
  value: PeoplePickerValue;
}): PeopleOptionsLookup => {
  const cacheRef: MutableRefObject<Map<string, PeoplePickerOption>> = useRef<
    Map<string, PeoplePickerOption>
  >(new Map());
  const pendingRef: MutableRefObject<Set<string>> = useRef<Set<string>>(
    new Set(),
  );
  const isMountedRef: MutableRefObject<boolean> = useRef<boolean>(true);
  const [, setVersion] = useState<number>(0);
  const [loadingCount, setLoadingCount] = useState<number>(0);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const remember: (options: Array<PeoplePickerOption>) => void = useCallback(
    (options: Array<PeoplePickerOption>): void => {
      let changed: boolean = false;

      for (const option of options) {
        const key: string = getPeoplePickerOptionKey(option.kind, option.id);
        const existing: PeoplePickerOption | undefined =
          cacheRef.current.get(key);

        if (
          !existing ||
          existing.isUnknown ||
          existing.name !== option.name ||
          existing.hasProfilePicture !== option.hasProfilePicture
        ) {
          cacheRef.current.set(key, option);
          changed = true;
        }
      }

      if (changed && isMountedRef.current) {
        setVersion((version: number): number => {
          return version + 1;
        });
      }
    },
    [],
  );

  const signature: string = getPeoplePickerValueSignature(
    data.kinds,
    data.value,
  );

  useEffect(() => {
    const missing: Array<{ kind: PeoplePickerKind; ids: Array<string> }> = [];

    for (const kind of data.kinds) {
      const ids: Array<string> = [];

      for (const id of data.value[kind] || []) {
        const key: string = getPeoplePickerOptionKey(kind, id);

        if (cacheRef.current.has(key) || pendingRef.current.has(key)) {
          continue;
        }

        pendingRef.current.add(key);
        ids.push(id);
      }

      if (ids.length > 0) {
        missing.push({ kind, ids });
      }
    }

    if (missing.length === 0) {
      return;
    }

    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    setLoadingCount((count: number): number => {
      return count + 1;
    });

    Promise.all(
      missing.map(
        async (entry: {
          kind: PeoplePickerKind;
          ids: Array<string>;
        }): Promise<Array<PeoplePickerOption>> => {
          const definition: PeoplePickerKindDefinition =
            getPeoplePickerKindDefinition(entry.kind);

          const found: Array<PeoplePickerOption> = projectId
            ? await definition.getByIds({ projectId, ids: entry.ids })
            : [];

          const foundKeys: Set<string> = new Set<string>(
            found.map((option: PeoplePickerOption): string => {
              return getPeoplePickerOptionKey(option.kind, option.id);
            }),
          );

          const unknown: Array<PeoplePickerOption> = entry.ids
            .filter((id: string): boolean => {
              return !foundKeys.has(getPeoplePickerOptionKey(entry.kind, id));
            })
            .map((id: string): PeoplePickerOption => {
              return {
                kind: entry.kind,
                id: id,
                name: definition.unknownName,
                isUnknown: true,
              };
            });

          /*
           * Found under the server's spelling of the id, and also under the
           * one the form holds, so either finds it.
           */
          const aliases: Array<PeoplePickerOption> = [];

          for (const id of entry.ids) {
            const match: PeoplePickerOption | undefined = found.find(
              (option: PeoplePickerOption): boolean => {
                return option.id.toLowerCase() === id.toLowerCase();
              },
            );

            if (match && match.id !== id) {
              aliases.push({ ...match, id: id });
            }
          }

          return [...found, ...aliases, ...unknown];
        },
      ),
    )
      .then((results: Array<Array<PeoplePickerOption>>) => {
        for (const options of results) {
          for (const option of options) {
            const key: string = getPeoplePickerOptionKey(
              option.kind,
              option.id,
            );

            // Never let a late "unknown" overwrite a name already known.
            if (option.isUnknown && cacheRef.current.has(key)) {
              continue;
            }

            cacheRef.current.set(key, option);
          }
        }

        if (isMountedRef.current) {
          setError("");
        }
      })
      .catch((err: unknown) => {
        if (isMountedRef.current) {
          setError(API.getFriendlyMessage(err));
        }
      })
      .finally(() => {
        for (const entry of missing) {
          for (const id of entry.ids) {
            pendingRef.current.delete(getPeoplePickerOptionKey(entry.kind, id));
          }
        }

        if (isMountedRef.current) {
          setLoadingCount((count: number): number => {
            return Math.max(0, count - 1);
          });
          setVersion((version: number): number => {
            return version + 1;
          });
        }
      });
  }, [signature]);

  const getOption: (
    kind: PeoplePickerKind,
    id: string,
  ) => PeoplePickerOption | undefined = (
    kind: PeoplePickerKind,
    id: string,
  ): PeoplePickerOption | undefined => {
    return cacheRef.current.get(getPeoplePickerOptionKey(kind, id));
  };

  return {
    getOption,
    remember,
    isLoading: loadingCount > 0,
    error,
  };
};

export default usePeopleOptions;
