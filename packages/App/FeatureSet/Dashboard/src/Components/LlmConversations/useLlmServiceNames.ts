import { MutableRefObject, useEffect, useRef, useState } from "react";
import Service from "Common/Models/DatabaseModels/Service";
import Select from "Common/Types/BaseDatabase/Select";
import RecordsById from "Common/UI/Utils/RecordsById";

/*
 * THE APPS (TELEMETRY SERVICES) A PAGE NAMES, READ BY THEIR IDS (#10764).
 *
 * The conversations list, a conversation and the setup check name the app a
 * conversation ran in. They read the project's first 10,000 services by
 * name for it: an app past them had no name, and the app filter could not
 * offer it. The filter searches the server now (LlmAppPicker), and an app
 * is named here by its id: each id a page asks for as it draws (nameOf) is
 * read once, after that draw, in pages (RecordsById). A failed read leaves
 * the names out: rows then simply leave the app out, as they always did.
 */

// What an app is named by.
export const LLM_APP_NAME_SELECT: Select<Service> = { name: true };

export interface LlmServiceNames {
  /*
   * An app's name by its id, once read; "" until then, and for an id no app
   * answers to. Asking reads it.
   */
  nameOf: (serviceId: string) => string;
}

export function useLlmServiceNames(): LlmServiceNames {
  const [names, setNames] = useState<Map<string, string>>(new Map());

  // The ids asked for: read, or being read - each once.
  const askedRef: MutableRefObject<Set<string>> = useRef<Set<string>>(
    new Set(),
  );
  // The ids asked for in a draw, read after it.
  const pendingRef: MutableRefObject<Set<string>> = useRef<Set<string>>(
    new Set(),
  );
  const isMountedRef: MutableRefObject<boolean> = useRef<boolean>(true);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // After every draw: read what it asked for and had no name for.
  useEffect(() => {
    if (pendingRef.current.size === 0) {
      return;
    }

    const ids: Array<string> = Array.from(pendingRef.current);
    pendingRef.current.clear();

    RecordsById.read<Service>({
      modelType: Service,
      ids: ids,
      select: LLM_APP_NAME_SELECT,
    })
      .then((services: Array<Service>): void => {
        if (!isMountedRef.current) {
          return;
        }

        setNames((current: Map<string, string>): Map<string, string> => {
          const next: Map<string, string> = new Map(current);

          for (const service of services) {
            const id: string =
              (service.id || service._id)?.toString().toLowerCase() || "";

            if (id && service.name) {
              next.set(id, service.name);
            }
          }

          return next;
        });
      })
      .catch((): void => {
        // Names are a nicety: the page works without them.
      });
  });

  return {
    nameOf: (serviceId: string): string => {
      const id: string = serviceId ? serviceId.trim().toLowerCase() : "";

      if (!id) {
        return "";
      }

      const name: string | undefined = names.get(id);

      if (name !== undefined) {
        return name;
      }

      if (!askedRef.current.has(id)) {
        askedRef.current.add(id);
        pendingRef.current.add(id);
      }

      return "";
    },
  };
}
