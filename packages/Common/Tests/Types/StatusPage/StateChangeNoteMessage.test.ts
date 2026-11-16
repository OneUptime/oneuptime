import { StateListType } from "../../../Utils/StateOrder";
import StateChangeNoteMessage from "../../../Types/StatusPage/StateChangeNoteMessage";
import { getServerTranslator } from "../../../Server/Utils/ServerTranslation";
import { Translator } from "../../../UI/Utils/TranslateTemplate";
import { WORD_JOINER } from "../../../Utils/Markdown/MarkdownEscape";
import { describe, expect, test } from "@jest/globals";
import { Token, Tokens, marked } from "marked";

/*
 * The words a public note posted with a state change adds to its default
 * messages, so subscribers learn the state the event moved to. They are the
 * words the state change's own messages used (the state change jobs in
 * App/FeatureSet/Workers/Jobs/*StateTimeline), so a subscriber reads the
 * same subject and the same sentence whether the change came with a note
 * or not.
 */

describe("StateChangeNoteMessage", () => {
  test("names a state as the state change messages always did: first letter up, trimmed", () => {
    expect(StateChangeNoteMessage.formatStateName("resolved")).toBe("Resolved");
    expect(StateChangeNoteMessage.formatStateName("  Acknowledged ")).toBe(
      "Acknowledged",
    );
    expect(StateChangeNoteMessage.formatStateName("in progress")).toBe(
      "In progress",
    );
    expect(StateChangeNoteMessage.formatStateName("")).toBe("");
  });

  describe("email subjects", () => {
    test("an incident's default email: the state change email's subject", () => {
      expect(
        StateChangeNoteMessage.getIncidentEmailSubject({
          stateName: "resolved",
          incidentTitle: "Checkout is down",
        }),
      ).toBe("[Resolved Incident] Checkout is down");
    });

    test("an incident's custom template with no subject: the state change's custom subject", () => {
      expect(
        StateChangeNoteMessage.getIncidentCustomTemplateEmailSubject({
          stateName: "Resolved",
          incidentTitle: "Checkout is down",
        }),
      ).toBe("[Incident Resolved] Checkout is down");
    });

    test("a scheduled maintenance event's default email", () => {
      expect(
        StateChangeNoteMessage.getScheduledMaintenanceEmailSubject({
          stateName: "Ongoing",
          eventTitle: "Database upgrade",
        }),
      ).toBe("[Ongoing Scheduled Maintenance] Database upgrade");
    });

    test("a scheduled maintenance event's custom template with no subject", () => {
      expect(
        StateChangeNoteMessage.getScheduledMaintenanceCustomTemplateEmailSubject(
          {
            stateName: "completed",
            eventTitle: "Database upgrade",
          },
        ),
      ).toBe("[Scheduled Maintenance Completed] Database upgrade");
    });

    test("a title is used as it is: subjects are sent as written", () => {
      expect(
        StateChangeNoteMessage.getIncidentEmailSubject({
          stateName: "Resolved",
          incidentTitle: "<b>Checkout</b> & payments",
        }),
      ).toBe("[Resolved Incident] <b>Checkout</b> & payments");
    });
  });

  describe("SMS", () => {
    test("an incident: 'Incident <title> on <page> is <State>.'", () => {
      expect(
        StateChangeNoteMessage.getIncidentSmsHeadline({
          stateName: "resolved",
          incidentTitle: "Checkout is down",
          statusPageName: "Acme Status",
        }),
      ).toBe("Incident Checkout is down on Acme Status is Resolved.");
    });

    test("a scheduled maintenance event: 'Maintenance <title> on <page> is <State>.'", () => {
      expect(
        StateChangeNoteMessage.getScheduledMaintenanceSmsHeadline({
          stateName: "Ongoing",
          eventTitle: "Database upgrade",
          statusPageName: "Acme Status",
        }),
      ).toBe("Maintenance Database upgrade on Acme Status is Ongoing.");
    });
  });

  describe("Slack and Microsoft Teams", () => {
    test("a Status line, as the incident state change message has", () => {
      expect(
        StateChangeNoteMessage.getChatStatusLine(
          StateListType.IncidentState,
          "Resolved",
        ).toString(),
      ).toBe("**Status:** Resolved");
      expect(
        StateChangeNoteMessage.getChatStatusLine(
          StateListType.IncidentState,
          " Monitoring ",
        ).toString(),
      ).toBe("**Status:** Monitoring");
    });

    test("the label is the one the email row uses", () => {
      expect(StateChangeNoteMessage.statusLabel).toBe("Status");
      expect(
        StateChangeNoteMessage.getChatStatusLine(
          StateListType.IncidentState,
          "Resolved",
        ).toString(),
      ).toContain(`**${StateChangeNoteMessage.statusLabel}:**`);
    });

    /*
     * A state's name is the project's own to set, and the line is Markdown
     * posted to Slack and Teams: the name is escaped as a plain value, so it
     * reads as typed and cannot become a link, an image, HTML or a mention.
     */
    test("a state's name is plain text in the line, and reads as typed", () => {
      const name: string =
        "![](https://tracker.example/p.png) [Open](https://evil.example) <!channel> <b>x</b>";
      const line: string = StateChangeNoteMessage.getChatStatusLine(
        StateListType.IncidentState,
        name,
      ).toString();

      expect(line).toBe(
        `**Status:** !\\[\\](https://tracker.example/p.png) \\[Open\\](https://evil.example) \\<${WORD_JOINER}!channel> \\<b>x\\</b>`,
      );

      const tokens: Array<Token> = [];
      marked.walkTokens(marked.lexer(line), (token: Token): void => {
        tokens.push(token);
      });

      /*
       * A bare address still becomes a link, as it does anywhere - one that
       * shows where it goes. No image, no HTML, and no link whose words hide
       * its address.
       */
      expect(
        tokens
          .filter((token: Token): boolean => {
            return (
              token.type === "image" ||
              token.type === "html" ||
              (token.type === "link" &&
                (token as Tokens.Link).text !== (token as Tokens.Link).href)
            );
          })
          .map((token: Token): string => {
            return token.raw;
          }),
      ).toEqual([]);
    });

    test("an ordinary state's name is left exactly as typed", () => {
      expect(
        StateChangeNoteMessage.getChatStatusLine(
          StateListType.IncidentState,
          "Fixing - part 2 (EU) #1",
        ).toString(),
      ).toBe("**Status:** Fixing - part 2 (EU) #1");
    });
  });
});

/*
 * In the subscriber's language (Server/Utils/StatusPage/SubscriberLanguage):
 * the same subject, sentence and line, worded whole in it, OneUptime's
 * default state names in it, a project's own as written.
 */
describe("StateChangeNoteMessage in the reader's language", () => {
  const german: Translator = getServerTranslator("de");
  const french: Translator = getServerTranslator("fr");

  test("the email subjects", () => {
    expect(
      StateChangeNoteMessage.getIncidentEmailSubject({
        stateName: "resolved",
        incidentTitle: "Checkout is down",
        translator: german,
      }),
    ).toBe("[Vorfall: Resolved] Checkout is down");
    expect(
      StateChangeNoteMessage.getIncidentEmailSubject({
        stateName: "Resolved",
        incidentTitle: "Checkout is down",
        translator: german,
      }),
    ).toBe("[Vorfall: Behoben] Checkout is down");
    expect(
      StateChangeNoteMessage.getIncidentCustomTemplateEmailSubject({
        stateName: "Resolved",
        incidentTitle: "Checkout is down",
        translator: french,
      }),
    ).toBe("[Incident\u00A0: Résolu] Checkout is down");
    expect(
      StateChangeNoteMessage.getScheduledMaintenanceEmailSubject({
        stateName: "Ongoing",
        eventTitle: "Database upgrade",
        translator: german,
      }),
    ).toBe("[Geplante Wartung: Laufend] Database upgrade");
    expect(
      StateChangeNoteMessage.getScheduledMaintenanceCustomTemplateEmailSubject({
        stateName: "Completed",
        eventTitle: "Database upgrade",
        translator: getServerTranslator("ja"),
      }),
    ).toBe("[定期メンテナンス: 完了] Database upgrade");
  });

  test("the text message's first sentence", () => {
    expect(
      StateChangeNoteMessage.getIncidentSmsHeadline({
        stateName: "Acknowledged",
        incidentTitle: "Checkout is down",
        statusPageName: "Acme Status",
        translator: german,
      }),
    ).toBe("Vorfall Checkout is down auf Acme Status: Bestätigt.");
    expect(
      StateChangeNoteMessage.getScheduledMaintenanceSmsHeadline({
        stateName: "In progress",
        eventTitle: "Database upgrade",
        statusPageName: "Acme Status",
        translator: german,
      }),
    ).toBe("Wartung Database upgrade auf Acme Status: In progress.");
  });

  test("the chat line, with the language's own label", () => {
    expect(
      StateChangeNoteMessage.getChatStatusLine(
        StateListType.IncidentState,
        " Resolved ",
        german,
      ).toString(),
    ).toBe("**Status:** Behoben");
    expect(
      StateChangeNoteMessage.getChatStatusLine(
        StateListType.IncidentState,
        "Resolved",
        french,
      ).toString(),
    ).toBe("**Statut\u00A0:** Résolu");
    expect(
      StateChangeNoteMessage.getChatStatusLine(
        StateListType.IncidentState,
        "Monitoring",
        getServerTranslator("fa"),
      ).toString(),
    ).toBe("**وضعیت:** Monitoring");
  });

  test("a title or a state that looks like a placeholder is put in as written", () => {
    expect(
      StateChangeNoteMessage.getIncidentEmailSubject({
        stateName: "{{title}}",
        incidentTitle: "{{state}} $t(x)",
        translator: german,
      }),
    ).toBe("[Vorfall: {{title}}] {{state}} $t(x)");
  });
});

/*
 * An incident's state is read against the incident states' defaults, an
 * event's against the maintenance states' (#8066). Read against every
 * list at once, an incident state a project named "Ongoing" - a default
 * maintenance state - read "Laufend" in a German subject.
 */
describe("StateChangeNoteMessage reads a state against its own list", () => {
  const german: Translator = getServerTranslator("de");

  test("an incident's subject and text message: a maintenance state's name reads as written", () => {
    expect(
      StateChangeNoteMessage.getIncidentEmailSubject({
        stateName: "Ongoing",
        incidentTitle: "Checkout is down",
        translator: german,
      }),
    ).toBe("[Vorfall: Ongoing] Checkout is down");
    expect(
      StateChangeNoteMessage.getIncidentCustomTemplateEmailSubject({
        stateName: "Degraded",
        incidentTitle: "Checkout is down",
        translator: german,
      }),
    ).not.toContain("Beeinträchtigt");
    expect(
      StateChangeNoteMessage.getIncidentSmsHeadline({
        stateName: "Completed",
        incidentTitle: "Checkout is down",
        statusPageName: "Acme Status",
        translator: german,
      }),
    ).toBe("Vorfall Checkout is down auf Acme Status: Completed.");
  });

  test("an event's subject and text message: an incident state's name reads as written", () => {
    expect(
      StateChangeNoteMessage.getScheduledMaintenanceEmailSubject({
        stateName: "Resolved",
        eventTitle: "Database upgrade",
        translator: german,
      }),
    ).not.toContain("Behoben");
    expect(
      StateChangeNoteMessage.getScheduledMaintenanceCustomTemplateEmailSubject({
        stateName: "Acknowledged",
        eventTitle: "Database upgrade",
        translator: german,
      }),
    ).not.toContain("Bestätigt");
    expect(
      StateChangeNoteMessage.getScheduledMaintenanceSmsHeadline({
        stateName: "Identified",
        eventTitle: "Database upgrade",
        statusPageName: "Acme Status",
        translator: german,
      }),
    ).toBe("Wartung Database upgrade auf Acme Status: Identified.");
  });

  test("its own list's defaults still read in the reader's language", () => {
    expect(
      StateChangeNoteMessage.getIncidentSmsHeadline({
        stateName: "Resolved",
        incidentTitle: "Checkout is down",
        statusPageName: "Acme Status",
        translator: german,
      }),
    ).toBe("Vorfall Checkout is down auf Acme Status: Behoben.");
    expect(
      StateChangeNoteMessage.getScheduledMaintenanceSmsHeadline({
        stateName: "Ongoing",
        eventTitle: "Database upgrade",
        statusPageName: "Acme Status",
        translator: german,
      }),
    ).toBe("Wartung Database upgrade auf Acme Status: Laufend.");
  });

  test("the chat line reads the state against the list it is handed", () => {
    expect(
      StateChangeNoteMessage.getChatStatusLine(
        StateListType.ScheduledMaintenanceState,
        "Resolved",
        german,
      ).toString(),
    ).toBe("**Status:** Resolved");
    expect(
      StateChangeNoteMessage.getChatStatusLine(
        StateListType.ScheduledMaintenanceState,
        "Completed",
        german,
      ).toString(),
    ).toBe("**Status:** Abgeschlossen");
    expect(
      StateChangeNoteMessage.getChatStatusLine(
        StateListType.IncidentState,
        "Completed",
        german,
      ).toString(),
    ).toBe("**Status:** Completed");
  });
});
