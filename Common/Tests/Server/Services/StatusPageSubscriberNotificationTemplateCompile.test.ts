import { Service as StatusPageSubscriberNotificationTemplateService } from "../../../Server/Services/StatusPageSubscriberNotificationTemplateService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import StatusPageSubscriberService from "../../../Server/Services/StatusPageSubscriberService";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";
import { getJestSpyOn } from "../../Spy";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * compileTemplate fills {{variable}} placeholders in a status page's custom
 * notification templates with text people wrote: note bodies, incident
 * titles, resource names. It used to hand each value to String.replace as a
 * replacement string, where "$&", "$$", "$`" and "$'" are commands, so that
 * text was silently rewritten on its way to subscribers.
 */

type Compile = (template: string, variables: Record<string, string>) => string;

const compile: Compile = (
  template: string,
  variables: Record<string, string>,
): string => {
  return StatusPageSubscriberNotificationTemplateService.compileTemplate(
    template,
    variables,
  );
};

describe("StatusPageSubscriberNotificationTemplateService.compileTemplate", () => {
  test("fills every occurrence of every variable", () => {
    expect(
      compile("{{title}} - {{ title }} on {{page}}", {
        title: "Checkout down",
        page: "Acme",
      }),
    ).toBe("Checkout down - Checkout down on Acme");
  });

  test.each([
    ["$$", "Refunds of $$5 issued"],
    ["$&", "Store $& Co"],
    ["$`", "cost $` now"],
    ["$'", "cost $' now"],
    ["$1", "group $1 reference"],
    ["$<name>", "named $<name> group"],
    ["a lone $", "costs $ 5"],
  ])(
    "inserts text containing %s exactly as written",
    (_label: string, text: string) => {
      expect(compile("Before {{note}} after", { note: text })).toBe(
        `Before ${text} after`,
      );
    },
  );

  test("does not let one value's $ sequences pull in other template text", () => {
    const rendered: string = compile(
      "Maintenance on {{statusPageName}}: {{scheduledMaintenanceDescription}} | {{unsubscribeUrl}}",
      {
        statusPageName: "Acme",
        scheduledMaintenanceDescription: "Env vars now use `$'` and `$&`",
        unsubscribeUrl: "https://status.acme.com/unsubscribe",
      },
    );

    expect(rendered).toBe(
      "Maintenance on Acme: Env vars now use `$'` and `$&` | https://status.acme.com/unsubscribe",
    );
  });

  test("renders an empty or missing value as nothing", () => {
    expect(
      compile("[{{a}}][{{b}}]", {
        a: "",
        b: undefined as unknown as string,
      }),
    ).toBe("[][]");
  });

  test("leaves placeholders it was not given a value for", () => {
    expect(compile("{{known}} {{unknown}}", { known: "x" })).toBe(
      "x {{unknown}}",
    );
  });

  test("does not expand placeholders that appear inside an inserted value", () => {
    expect(
      compile("{{first}} {{second}}", {
        first: "Reply to {{second}} or {{unsubscribeUrl}}",
        second: "2",
        unsubscribeUrl: "https://status.acme.com/unsubscribe",
      }),
    ).toBe("Reply to {{second}} or {{unsubscribeUrl}} 2");
  });

  test("gives the same result whatever order the variables were added in", () => {
    const template: string = "{{a}}/{{b}}";

    expect(compile(template, { a: "{{b}}", b: "B" })).toBe(
      compile(template, { b: "B", a: "{{b}}" }),
    );
  });

  test("matches dotted names and ignores inherited object keys", () => {
    expect(
      compile("{{report.totalIncidents}} {{constructor}} {{toString}}", {
        "report.totalIncidents": "3",
      }),
    ).toBe("3 {{constructor}} {{toString}}");
  });

  test("leaves text that only looks like a placeholder alone", () => {
    expect(compile("{{ }} {{not a name}} {single}", { single: "x" })).toBe(
      "{{ }} {{not a name}} {single}",
    );
  });
});

/*
 * The episode subscriber workers skip every status page whose
 * showEpisodesOnStatusPage is off. That column was missing from the select of
 * the lookup they all use, so it always read as undefined and no episode
 * notification was ever sent.
 */
describe("StatusPageSubscriberService.getStatusPagesToSendNotification", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("selects the show flag of every event type a worker checks", async () => {
    const findBy: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      StatusPageService,
      "findBy",
    ).mockResolvedValue([] as Array<StatusPage>);

    await StatusPageSubscriberService.getStatusPagesToSendNotification([
      new ObjectID("11111111-1111-4111-8111-111111111111"),
    ]);

    expect(findBy).toHaveBeenCalledTimes(1);

    const select: JSONObject = (
      findBy.mock.calls[0]![0] as { select: JSONObject }
    ).select;

    expect(select).toEqual(
      expect.objectContaining({
        showAnnouncementsOnStatusPage: true,
        showIncidentsOnStatusPage: true,
        showEpisodesOnStatusPage: true,
        showScheduledMaintenanceEventsOnStatusPage: true,
      }),
    );
  });

  test("passes the status pages it finds straight back", async () => {
    const page: StatusPage = new StatusPage();
    page._id = "22222222-2222-4222-8222-222222222222";
    page.showEpisodesOnStatusPage = true;

    getJestSpyOn(StatusPageService, "findBy").mockResolvedValue([
      page,
    ] as Array<StatusPage>);

    const pages: Array<StatusPage> =
      await StatusPageSubscriberService.getStatusPagesToSendNotification([
        new ObjectID("22222222-2222-4222-8222-222222222222"),
      ]);

    expect(pages).toEqual([page]);
    expect(pages[0]!.showEpisodesOnStatusPage).toBe(true);
  });
});
