import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Public Notes tab of an incident, a scheduled maintenance event and an
 * incident episode is a thin page around the shared notes feed
 * (Components/EventNotes). The page reads the event's own "notified
 * subscribers when it started" flag through useParentNotifyDefault, and the
 * feed turns that into where "Notify status page subscribers" starts on a new
 * public note, and why.
 *
 * What these pin is the wiring between the three pieces. What the feed then
 * does with the flag - that it is what gets posted, ticked or not - is pinned
 * against the rendered feed in Common/Tests/App/Dashboard/EventNotes.test.tsx
 * and PublicNotePagesNotifyDefault.test.tsx.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

export function readDashboardSource(...relativePath: Array<string>): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, ...relativePath), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");
}

function indexOfOrFail(source: string, fragment: string): number {
  const index: number = source.indexOf(fragment);

  if (index < 0) {
    throw new Error(`Expected source to contain: ${fragment}`);
  }

  return index;
}

export const HELPER_IMPORT: string =
  'import PublicNoteSubscriberNotificationDefault from "Common/Types/StatusPage/PublicNoteSubscriberNotificationDefault";';

export const EVENT_NOTES_FILE: Array<string> = [
  "Components",
  "EventNotes",
  "EventNotes.tsx",
];

export const PARENT_NOTIFY_DEFAULT_FILE: Array<string> = [
  "Components",
  "EventNotes",
  "useParentNotifyDefault.ts",
];

export interface PublicNotesTabCase {
  // e.g. "incident"
  eventName: string;
  file: Array<string>;
  // The event's model, e.g. "Incident".
  parentModel: string;
  // The note model the feed posts, e.g. "IncidentPublicNote".
  noteModel: string;
  // The note's foreign key to the event, e.g. "incidentId".
  parentIdField: string;
  // The event's own flag, e.g. "shouldStatusPageSubscribersBeNotifiedOnIncidentCreated".
  parentFlag: string;
  // The resolver argument's name and the helper it goes through.
  resolveArgument: string;
  helperCall: string;
  // e.g. "PublicNoteSubscriberNotificationDefault.quietIncidentDescription".
  quietDescriptionReference: string;
  // A neighbour's helper call and wording, easy to copy over by mistake.
  foreignReferences?: Array<string> | undefined;
}

export function describePublicNotesTab(tab: PublicNotesTabCase): void {
  describe(`${tab.eventName} Public Notes tab`, () => {
    const source: string = readDashboardSource(...tab.file);
    const lookup: string =
      source.match(
        new RegExp(
          `useParentNotifyDefault<${tab.parentModel}>\\(\\{[\\s\\S]*?\\}, \\}\\);`,
        ),
      )?.[0] || "";
    const feed: string =
      source.match(
        new RegExp(`<EventNotes<${tab.noteModel}>[\\s\\S]*?\\/>`),
      )?.[0] || "";

    test(`loads only the ${tab.eventName}'s own notify setting`, () => {
      expect(lookup).not.toBe("");
      expect(lookup).toContain(`modelType: ${tab.parentModel},`);
      expect(lookup).toContain("id: modelId,");
      expect(lookup).toContain(`select: { ${tab.parentFlag}: true, },`);
    });

    test("derives the default from the shared helper", () => {
      expect(source).toContain(HELPER_IMPORT);
      expect(lookup).toContain(
        `resolve: (${tab.resolveArgument}: ${tab.parentModel} | null): boolean => { return PublicNoteSubscriberNotificationDefault.${tab.helperCall}( ${tab.resolveArgument}, ); },`,
      );

      for (const reference of tab.foreignReferences || []) {
        expect(source).not.toContain(reference);
      }
    });

    test("does not render the notes feed until the default is known", () => {
      expect(source).toContain(
        "if (isNotifyingByDefault === null) { return <PageLoader isVisible={true} />; }",
      );
      expect(
        indexOfOrFail(source, "if (isNotifyingByDefault === null)"),
      ).toBeLessThan(indexOfOrFail(source, `<EventNotes<${tab.noteModel}>`));
    });

    test(`shows an error instead of the feed when the ${tab.eventName} cannot be loaded`, () => {
      expect(source).toContain(
        "if (error) { return <ErrorMessage message={error} />; }",
      );
      expect(indexOfOrFail(source, "if (error)")).toBeLessThan(
        indexOfOrFail(source, `<EventNotes<${tab.noteModel}>`),
      );
    });

    test("hands the feed the default and the quiet explanation", () => {
      expect(feed).not.toBe("");
      expect(feed).toContain(`modelType={${tab.noteModel}}`);
      expect(feed).toContain('visibility="public"');
      expect(feed).toContain(`parentIdField="${tab.parentIdField}"`);
      expect(feed).toContain("parentId={modelId}");
      expect(feed).toContain(
        `subscriberNotifications={{ isNotifyingByDefault, quietDescription: ${tab.quietDescriptionReference}, }}`,
      );
    });

    test(`starts a new feed per ${tab.eventName}, so a draft never follows you to the next one`, () => {
      expect(feed).toContain("key={modelId.toString()}");
    });
  });
}

/*
 * The shared pieces every Public Notes tab above relies on.
 */
export function describeSharedPublicNoteWiring(): void {
  describe("the shared notes feed", () => {
    const source: string = readDashboardSource(...EVENT_NOTES_FILE);

    test("starts a new public note's checkbox from the event's default instead of hard-coding true", () => {
      expect(source).toContain(
        "const isNotifyingByDefault: boolean = props.subscriberNotifications?.isNotifyingByDefault ?? true;",
      );
      expect(source).toContain("shouldNotify: isNotifyingByDefault,");
      expect(source).not.toContain("shouldNotify: true");
    });

    test("always sends the flag as a value, never leaving it to the server's fallback", () => {
      expect(source).toContain(
        'if (isNotifyControlShown) { record["shouldStatusPageSubscribersBeNotifiedOnNoteCreated"] = draft.shouldNotify; }',
      );
    });

    test("explains an unticked default with the page's quiet description", () => {
      expect(source).toMatch(
        /uncheckedDescription: isNotifyingByDefault \? "[^"]+" : props\.subscriberNotifications!\.quietDescription,/,
      );
    });

    test("opens the composer only when asked, not because of the default", () => {
      expect(source).toContain(
        "const [isComposerOpen, setIsComposerOpen] = useState<boolean>(false);",
      );
      expect(source).not.toMatch(
        /setIsComposerOpen\([^)]*isNotifyingByDefault/,
      );
    });
  });

  describe("the event's notify default lookup", () => {
    const source: string = readDashboardSource(...PARENT_NOTIFY_DEFAULT_FILE);

    test("reloads the setting per event and drops a stale answer", () => {
      expect(source).toContain("let isStale: boolean = false;");
      expect(source).toContain(
        'if (!isStale) { setLoaded({ id, isNotifyingByDefault: props.resolve(parent), error: "", }); }',
      );
      expect(source).toContain("return () => { isStale = true; }; }, [id]);");
    });

    test("never pairs one event with another event's answer", () => {
      expect(source).toContain(
        'if (!loaded || loaded.id !== id) { return { isNotifyingByDefault: null, error: "" }; }',
      );
    });

    test("turns a failed load into a readable error rather than a default", () => {
      expect(source).toContain(
        "if (!isStale) { setLoaded({ id, isNotifyingByDefault: null, error: API.getFriendlyMessage(err), }); }",
      );
    });
  });
}
