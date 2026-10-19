import ObjectID from "Common/Types/ObjectID";
import { MutableRefObject, useEffect, useRef } from "react";
import RunnerChoicesLoader, { RunnerChoices } from "./RunnerChoices";

/*
 * The Runner picker links to Runbooks -> Runners in a new tab when a step
 * has nothing to pick, so the steps being edited are not lost. When the
 * person comes back to this tab, the Runner choices are read again and
 * handed to `onChoices`, so the Runner they just added - or the global
 * Runners they just turned on - can be picked at once, without a reload
 * that would drop their unsaved steps.
 *
 * Quietly: a failed read keeps the choices the page already has, and an
 * answer for a read the page has moved on from (a newer focus) is dropped.
 */
export default function useRefreshRunnerChoicesOnFocus(
  projectId: ObjectID | null,
  onChoices: (choices: RunnerChoices) => void,
): void {
  const onChoicesRef: MutableRefObject<(choices: RunnerChoices) => void> =
    useRef<(choices: RunnerChoices) => void>(onChoices);
  onChoicesRef.current = onChoices;

  const projectIdText: string = projectId?.toString() || "";

  useEffect(() => {
    if (!projectIdText) {
      return;
    }

    let isMounted: boolean = true;
    let latestRead: number = 0;

    const onWindowFocus: () => void = (): void => {
      latestRead++;
      const thisRead: number = latestRead;

      RunnerChoicesLoader.load(new ObjectID(projectIdText))
        .then((choices: RunnerChoices) => {
          if (isMounted && thisRead === latestRead) {
            onChoicesRef.current(choices);
          }
        })
        .catch(() => {
          // The choices the page already has stand.
        });
    };

    window.addEventListener("focus", onWindowFocus);

    return () => {
      isMounted = false;
      window.removeEventListener("focus", onWindowFocus);
    };
  }, [projectIdText]);
}
