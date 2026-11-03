import { useEffect, useState } from "react";

/*
 * A library a page loads the first time something on it needs it, rather
 * than before it can draw: react-beautiful-dnd for a list that drags its
 * rows (DragAndDropLoader), highlight.js's grammars for a code editor
 * (CodeEditorHighlight). Every page draws tables and forms, and few drag a
 * row or show code (issue #5619).
 *
 * The bundler puts a module that is only ever import()ed in a file of its
 * own, so the loader names the module in full: import("react-beautiful-dnd").
 * It is loaded once, however many ask. A load that fails - a lost
 * connection, a file a deploy has since replaced - is not kept: the next to
 * ask tries again. Once loaded, it is there from the first frame of whatever
 * is drawn after.
 */
export class LazyLibrary<T> {
  private loaded: T | null = null;
  private loading: Promise<T> | null = null;
  private loadLibrary: () => Promise<T>;

  public constructor(loadLibrary: () => Promise<T>) {
    this.loadLibrary = loadLibrary;
  }

  // The library, when it has loaded.
  public getLoaded(): T | null {
    return this.loaded;
  }

  public load(): Promise<T> {
    if (!this.loading) {
      this.loading = this.loadLibrary().then(
        (library: T): T => {
          this.loaded = library;
          return library;
        },
        (error: unknown): never => {
          this.loading = null;
          throw error;
        },
      );
    }

    return this.loading;
  }
}

/*
 * A library for a component that needs it, once it is there: null while it
 * loads, if it cannot, and while the component does not need it - nothing is
 * loaded for it then.
 */
export function useLazyLibrary<T>(
  library: LazyLibrary<T>,
  isNeeded: boolean,
): T | null {
  /*
   * Boxed: state set to a function would be taken for an update, and a
   * library may be one.
   */
  const [arrived, setArrived] = useState<{ library: T } | null>(() => {
    const loaded: T | null = library.getLoaded();
    return loaded === null ? null : { library: loaded };
  });

  useEffect(() => {
    if (!isNeeded || arrived) {
      return;
    }

    let isMounted: boolean = true;

    library.load().then(
      (loaded: T): void => {
        if (isMounted) {
          setArrived({ library: loaded });
        }
      },
      (): void => {
        // The component stays as it is drawn without it.
      },
    );

    return () => {
      isMounted = false;
    };
  }, [library, isNeeded, arrived]);

  return isNeeded && arrived ? arrived.library : null;
}
