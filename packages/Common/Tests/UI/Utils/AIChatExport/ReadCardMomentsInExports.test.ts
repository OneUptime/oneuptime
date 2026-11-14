/** @timezone Europe/Berlin */

import { describe, expect, test } from "@jest/globals";
import WidgetBuilder from "../../../../Server/Utils/AI/Toolbox/WidgetBuilder";
import { getOnCallScheduleCardWords } from "../../../../Server/Utils/AI/Toolbox/ReadCardWords";
import {
  AIChatCitationTargetType,
  AIChatWidget,
} from "../../../../Types/AI/AIChatTypes";
import { ResourceCardFact } from "../../../../Types/AI/ResourceCardFacts";
import { getExportedResourceCardFacts } from "../../../../UI/Utils/AIChatExport/ChatWidgetData";
import { widgetToMarkdown } from "../../../../UI/Utils/AIChatExport/ChatWidgetMarkdown";

/*
 * A READ'S CARD'S MOMENTS IN THE EXPORTS (issue #7202).
 *
 * An on-call schedule's card says when the shift on call now started, when
 * it hands off and when the next one starts. The chat writes each in the
 * reader's language and time zone; the card stores them as ISO text for
 * the exports, and the PDF printed "2026-10-26T13:00:00.000Z" as it was.
 * Both exports write them as they write their own dates now - English, in
 * the reader's time zone - and any other fact as stored.
 *
 * This file runs in Berlin (the docblock above): 13:00 UTC on Oct 26 2026,
 * the day after the clocks went back, is 14:00 there.
 */

const STARTED: Date = new Date("2026-10-26T13:00:00.000Z");
const HANDS_OFF: Date = new Date("2026-11-02T13:00:00.000Z");

function scheduleCard(): AIChatWidget {
  return {
    ...WidgetBuilder.resourceCard({
      title: "On-call schedule 'Payments weekly rotation'",
      heading: "Payments weekly rotation",
      words: getOnCallScheduleCardWords({
        onCallNow: "Ana Souza",
        rosterStartAt: STARTED,
        rosterHandoffAt: HANDS_OFF,
        nextUp: "Jonas Müller",
      }),
      link: { type: AIChatCitationTargetType.OnCallPolicies },
    }),
    id: "W1",
  };
}

const EXPORTED: Array<ResourceCardFact> = [
  { label: "On call since", value: "Oct 26 2026, 14:00 CET" },
  { label: "Hands off at", value: "Nov 02 2026, 14:00 CET" },
  { label: "Next up", value: "Jonas Müller" },
];

describe("a read's card's moments in the exports", () => {
  test("this file runs in Berlin", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(
      "Europe/Berlin",
    );
    expect(STARTED.getTimezoneOffset()).toBe(-60);
  });

  test("the card stores each moment as ISO text, for the exports to write", () => {
    expect(scheduleCard().data.fields).toEqual([
      { label: "On call since", value: "2026-10-26T13:00:00.000Z" },
      { label: "Hands off at", value: "2026-11-02T13:00:00.000Z" },
      { label: "Next up", value: "Jonas Müller" },
    ]);
  });

  test("each moment written as the export writes its dates, in the reader's time zone; the rest as stored", () => {
    expect(getExportedResourceCardFacts(scheduleCard())).toEqual(EXPORTED);
  });

  test("the Markdown export writes them so too, never as ISO text", () => {
    const markdown: string = widgetToMarkdown(scheduleCard());

    expect(markdown).toContain("- **On call since:** Oct 26 2026, 14:00 CET");
    expect(markdown).toContain("- **Hands off at:** Nov 02 2026, 14:00 CET");
    expect(markdown).toContain("- **Next up:** Jonas Müller");
    expect(markdown).not.toContain("T13:00");
  });

  /*
   * A stored card is read as untrusted: a fact is a moment only where the
   * card's own words say so and its stored English is that moment.
   */
  test("a card saved before cards had words prints its facts as stored", () => {
    const widget: AIChatWidget = scheduleCard();
    delete widget.data.words;

    expect(getExportedResourceCardFacts(widget)).toEqual(
      scheduleCard().data.fields,
    );
  });

  test("words whose facts do not line up with the stored ones: as stored", () => {
    const widget: AIChatWidget = scheduleCard();
    widget.data.fields = widget.data.fields!.slice(1);

    expect(getExportedResourceCardFacts(widget)).toEqual(widget.data.fields);
  });

  test("a stored value that is not its moment's ISO text: as stored", () => {
    const widget: AIChatWidget = scheduleCard();
    widget.data.fields![0] = {
      label: "On call since",
      value: "yesterday afternoon",
    };

    expect(getExportedResourceCardFacts(widget)[0]).toEqual({
      label: "On call since",
      value: "yesterday afternoon",
    });
    expect(getExportedResourceCardFacts(widget)[1]).toEqual(EXPORTED[1]);
  });

  test("words that are not ours: as stored", () => {
    const widget: AIChatWidget = scheduleCard();
    // Its moments as they were, under a kind the Dashboard has no words for.
    widget.data.words = { ...widget.data.words, kind: { term: "made up" } };

    expect(getExportedResourceCardFacts(widget)).toEqual(
      scheduleCard().data.fields,
    );
  });
});
