/*
 * Projects the SERVER has refused on SSO grounds.
 *
 * The app used to infer per-project SSO status entirely from what it had in
 * storage: "a global SSO token exists, therefore every project is satisfied".
 * That was true when a global token unconditionally satisfied every project.
 * It is no longer guaranteed - a provider can be disabled, or (when an admin
 * opts in) restricted to the projects it is attached to - and it was never
 * true for an expired token, which the app would happily keep presenting as
 * "Authenticated" while every request came back 406.
 *
 * The server is the only thing that actually knows. So rather than guessing
 * harder, the API client records which projects it has been refused for, and
 * the screens treat that as authoritative over what is in storage. The result
 * is that a denial turns into a visible "Authenticate with SSO" button instead
 * of an error string on every individual screen.
 *
 * Deliberately in-memory: it is a cache of the server's last word, not state
 * worth persisting across launches, and a fresh launch should ask again.
 */

const deniedProjectIds: Set<string> = new Set<string>();

type Listener = () => void;
let listeners: Array<Listener> = [];

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

/** Records that the server refused this project for SSO reasons. */
export function markProjectSsoDenied(projectId: string): void {
  if (!projectId || deniedProjectIds.has(projectId)) {
    return;
  }

  deniedProjectIds.add(projectId);
  notify();
}

/**
 * Clears a project's denial - call after an SSO login that could plausibly
 * have fixed it, so the UI stops demanding SSO the user has just completed.
 */
export function clearProjectSsoDenial(projectId: string): void {
  if (deniedProjectIds.delete(projectId)) {
    notify();
  }
}

/**
 * Clears every denial. A GLOBAL SSO login can satisfy any number of projects
 * at once, and the app cannot tell which from the token alone - so it drops
 * every denial and lets the server say again.
 */
export function clearAllSsoDenials(): void {
  if (deniedProjectIds.size === 0) {
    return;
  }

  deniedProjectIds.clear();
  notify();
}

export function isProjectSsoDenied(projectId: string): boolean {
  return deniedProjectIds.has(projectId);
}

export function getSsoDeniedProjectIds(): Array<string> {
  return [...deniedProjectIds];
}

/** Subscribe to changes. Returns an unsubscribe function. */
export function subscribeToSsoDenials(listener: Listener): () => void {
  listeners.push(listener);

  return (): void => {
    listeners = listeners.filter((candidate: Listener): boolean => {
      return candidate !== listener;
    });
  };
}
