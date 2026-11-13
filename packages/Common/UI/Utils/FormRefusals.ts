/*
 * A FORM REFUSED SOMEBODY (issue #6834).
 *
 * Told by the forms themselves, each time a person presses to go on and the
 * form will not: its own checks found a field to fix (BasicForm), or the
 * server said no (ModelForm). Nobody listens unless something asked to:
 * on OneUptime Cloud, a recording of the Dashboard's setup pages counts
 * them, and a form refused again and again is a sign that somebody is
 * stuck (Dashboard/Utils/DashboardRecording/DashboardSignals).
 *
 * What is said is only that it happened, and how - never the form's
 * values, its fields' names or the server's message.
 */

export enum FormRefusalKind {
  // The form's own checks: a required field empty, a value that is not valid.
  Invalid = "invalid",
  // The server refused what was sent.
  Refused = "refused",
}

type Listener = (kind: FormRefusalKind) => void;

const listeners: Set<Listener> = new Set<Listener>();

export default class FormRefusals {
  public static report(kind: FormRefusalKind): void {
    for (const listener of Array.from(listeners)) {
      try {
        listener(kind);
      } catch {
        // A listener's mistake is never a form's.
      }
    }
  }

  public static subscribe(listener: Listener): () => void {
    listeners.add(listener);

    return (): void => {
      listeners.delete(listener);
    };
  }
}
