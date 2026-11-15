// UX rule: Docs/ux/README.md#in-every-language
import { describe, expect, test } from "@jest/globals";
import {
  BadgeTextSite,
  readAllBadgeTextSites,
  readBadgeTextSites,
} from "../../PillTextNames";

/*
 * A BADGE THAT DRAWS A NAME SAYS HOW THE NAME READS (#7780).
 *
 * A Pill or a StatusBubble looks its text up in the reader's language, as
 * it should for the product's words ("Active", "Paid"), and drew a name the
 * same way: a label named "Network" read "Red" on a Spanish page, a state
 * a project named "Open" the verb "Abrir", a severity renamed "Critical"
 * "Kritisch" in German. A badge whose text is a name now says how it
 * reads, with isUserContent:
 *
 *   - a record's name its owner gave - a label's, a monitor's - is drawn as
 *     written (true);
 *   - a state's, a severity's or a status's name reads by the one rule for
 *     them (Common/Utils/DefaultRecordNames.isRecordNameAsWritten):
 *     OneUptime's default names looked up, the project's own as written;
 *   - a name still to be decided on stays looked up, and says so (false).
 *
 * This reads every badge in the front ends (PillTextNames) and fails on one
 * that draws a name and does not say. RecordNamesReadAsWrittenInSpanish
 * draws the badges themselves.
 */

const FILE: string =
  "packages/App/FeatureSet/Dashboard/src/Components/Snippet/Snippet.tsx";

const IMPORTS: string = `
import Pill from "Common/UI/Components/Pill/Pill";
import Statusbubble from "Common/UI/Components/StatusBubble/StatusBubble";
`;

function sitesOf(body: string): Array<BadgeTextSite> {
  return readBadgeTextSites(FILE, `${IMPORTS}\n${body}`);
}

function onlySiteOf(body: string): BadgeTextSite {
  const sites: Array<BadgeTextSite> = sitesOf(body);

  expect(sites).toHaveLength(1);

  return sites[0]!;
}

describe("the reader", () => {
  test.each([
    ['<Pill text={state.name || "Unknown"} color={c} />'],
    ['<Pill text={item["currentState"]["name"] as string} color={c} />'],
    ['<Pill text={label.getColumnValue("name") as string} color={c} />'],
    ["<Pill text={record.severityName} color={c} />"],
    ["<Pill text={readName(item)} color={c} />"],
    ["<Statusbubble text={status?.name || 'Unknown'} color={c} />"],
    [
      "<Pill text={options.find((o: X) => { return o.id === id; })?.name as string} color={c} />",
    ],
  ])("finds the name %s draws", (element: string) => {
    const site: BadgeTextSite = onlySiteOf(`const x = (${element});`);

    expect(site.readsName).toBe(true);
    expect(site.isMarked).toBe(false);
  });

  test.each([
    ['<Pill text="Active" color={c} />'],
    ['<Pill text={isOn ? "On" : "Off"} color={c} />'],
    ['<Pill text={label.name ? "Labelled" : "Unlabelled"} color={c} />'],
    ["<Pill text={STATUS_LABELS[status]} color={c} />"],
    [
      '<Pill text={translator.translateTemplate("{{planName}} Plan", { planName: plan })} color={c} />',
    ],
  ])("passes the product's words in %s", (element: string) => {
    expect(onlySiteOf(`const x = (${element});`).readsName).toBe(false);
  });

  test("follows a variable to what it is set to", () => {
    const site: BadgeTextSite = onlySiteOf(`
      function Row(): ReactElement {
        const text: string = label.name || label.slug || "";
        return <Pill text={text} color={c} />;
      }
    `);

    expect(site.readsName).toBe(true);
  });

  test("reads a badge drawn from a spread object, and its mark", () => {
    const unmarked: BadgeTextSite = onlySiteOf(`
      function Row(): ReactElement {
        const pillProps: PillProps = { color: c, text: label.name || "" };
        return <Pill {...pillProps} />;
      }
    `);
    const marked: BadgeTextSite = onlySiteOf(`
      function Row(): ReactElement {
        const text: string = label.name || "";
        const pillProps: PillProps = { color: c, text, isUserContent: true };
        return <Pill {...pillProps} />;
      }
    `);

    expect(unmarked).toMatchObject({ readsName: true, isMarked: false });
    expect(marked).toMatchObject({ readsName: true, isMarked: true });
  });

  test("a badge that says how its name reads is marked, whichever way", () => {
    const sites: Array<BadgeTextSite> = sitesOf(`
      const a = (<Pill text={label.name} isUserContent={true} color={c} />);
      const b = (<Pill text={team.name} isUserContent={false} color={c} />);
      const d = (
        <Pill
          text={state.name || "Unknown"}
          isUserContent={isRecordNameAsWritten(StateListType.IncidentState, state.name)}
          color={c}
        />
      );
    `);

    expect(
      sites.map((site: BadgeTextSite): boolean => {
        return site.isMarked && site.readsName;
      }),
    ).toEqual([true, true, true]);
  });

  test("reads only the badges the file imports, under the name it imports them by", () => {
    const sites: Array<BadgeTextSite> = readBadgeTextSites(
      FILE,
      `
        import Badge from "../../../../../../Common/UI/Components/Pill/Pill";
        const a = (<Badge text={label.name} color={c} />);
        const b = (<Pill text={label.name} color={c} />);
      `,
    );

    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject({ badge: "Pill", readsName: true });
  });
});

/*
 * A BADGE GIVEN WORDS ALREADY IN THE READER'S LANGUAGE DRAWS THEM AS GIVEN
 * (#8067).
 *
 * A page that words a badge's text itself - t("..."), a template, a
 * plural, a helper handed the translator - hands it over in the reader's
 * language already, and the badge looked it up a second time: where a
 * translated word is also an English key it was swapped for that key's
 * translation. So a badge's text, and its hover tip, either goes over in
 * English for the badge to look up once, or says it is drawn as written
 * (isUserContent, isTooltipUserContent) - plainly, never only some of the
 * time - with every part of it in the reader's words.
 */
describe("the reader, for a badge's translated words (#8067)", () => {
  test.each([
    ['<Pill text={t("pages.settings.email.pillEnabled")} color={c} />'],
    ['<Pill text={translator.translateText("Connected")} color={c} />'],
    [
      '<Pill text={translator.translateTemplate("{{planName}} Plan", { planName: plan })} color={c} />',
    ],
    [
      "<Pill text={translator.translatePlural(OPEN_ALERTS, count)} color={c} />",
    ],
    ["<Pill text={formatOverdue(translator, seconds)} color={c} />"],
    ["<Statusbubble text={translateString(label) || label} color={c} />"],
    ['<Pill text={isOn ? t("common.on") : "Off"} color={c} />'],
  ])("finds the translated words %s draws", (element: string) => {
    const site: BadgeTextSite = onlySiteOf(`const x = (${element});`);

    expect(site.isTranslated).toBe(true);
    expect(site.isMarkedAsWritten).toBe(false);
  });

  test.each([
    ['<Pill text="Active" color={c} />'],
    ['<Pill text={isOn ? "On" : "Off"} color={c} />'],
    ["<Pill text={label.name} isUserContent={true} color={c} />"],
    ["<Pill text={STATUS_LABELS[status]} color={c} />"],
    // A lookup the badge's text is chosen by, not drawn.
    [
      '<Pill text={translator.hasTranslation(x) ? "Known" : "New"} color={c} />',
    ],
  ])("passes English and names in %s", (element: string) => {
    expect(onlySiteOf(`const x = (${element});`).isTranslated).toBe(false);
  });

  test("follows a variable to the lookup it is set with", () => {
    const site: BadgeTextSite = onlySiteOf(`
      function Row(): ReactElement {
        const toneText: string = translator.translateText(ALL_CONNECTED);
        return <Pill text={toneText} color={c} />;
      }
    `);

    expect(site.isTranslated).toBe(true);
  });

  test("is marked as written only when it says so plainly", () => {
    const sites: Array<BadgeTextSite> = sitesOf(`
      const a = (<Pill text={t("x")} isUserContent color={c} />);
      const b = (<Pill text={t("x")} isUserContent={true} color={c} />);
      const d = (<Pill text={t("x")} isUserContent={false} color={c} />);
      const e = (<Pill text={t("x")} isUserContent={isAsWritten} color={c} />);
      function Row(): ReactElement {
        const pillProps: PillProps = { color: c, text: t("y"), isUserContent: true };
        return <Pill {...pillProps} />;
      }
    `);

    expect(
      sites.map((site: BadgeTextSite): boolean => {
        return site.isMarkedAsWritten;
      }),
    ).toEqual([true, true, false, false, true]);
  });

  test("reads a badge's hover tip, from the badge or the object it is spread from, and its mark", () => {
    const sites: Array<BadgeTextSite> = sitesOf(`
      const a = (<Pill text="Live" tooltip={translator.translateText(TIP)} color={c} />);
      const b = (<Pill text="Live" tooltip={translator.translateText(TIP)} isTooltipUserContent={true} color={c} />);
      const d = (<Pill text="Live" tooltip={TIP} color={c} />);
      function Label(): ReactElement {
        const pillProps: PillProps = { color: c, text: label.name, isUserContent: true, tooltip: label.description, isTooltipUserContent: true };
        return <Pill {...pillProps} />;
      }
    `);

    expect(
      sites.map((site: BadgeTextSite) => {
        return [
          site.tooltip,
          site.isTooltipTranslated,
          site.isTooltipMarkedAsWritten,
        ];
      }),
    ).toEqual([
      ["translator.translateText(TIP)", true, false],
      ["translator.translateText(TIP)", true, true],
      ["TIP", false, false],
      ["label.description", false, true],
    ]);
  });

  test("finds an English word beside a translation, but not a lookup's own fallback", () => {
    const sites: Array<BadgeTextSite> = sitesOf(`
      const a = (<Pill text={row.ok ? "succeeded" : translator.translateTemplate("failed (exit {{code}})", { code })} isUserContent={true} color={c} />);
      const b = (<Pill text={translator.translateText("Sample") || "Sample"} isUserContent={true} color={c} />);
      const d = (<Pill text={\`\${translated} · \${suffix}\`} isUserContent={true} color={c} />);
      const e = (<Pill text={pct ? translator.translateTemplate("Sample {{pct}}%", { pct }) : "Sample"} isUserContent={true} color={c} />);
    `);

    expect(
      sites.map((site: BadgeTextSite): boolean => {
        return site.readsEnglish;
      }),
    ).toEqual([true, false, false, true]);
  });
});

describe("the front ends", () => {
  const sites: Array<BadgeTextSite> = readAllBadgeTextSites();

  // Where a badge is drawn, for a list of the ones that break a rule.
  const placeOf: (site: BadgeTextSite) => string = (
    site: BadgeTextSite,
  ): string => {
    return `${site.file}:${site.line} <${site.badge} text={${site.text}}>`;
  };

  test("draw dozens of badges given translated words, so the reader is reading them (#8067)", () => {
    expect(
      sites.filter((site: BadgeTextSite): boolean => {
        return site.isTranslated;
      }).length,
    ).toBeGreaterThan(40);
    expect(
      sites.filter((site: BadgeTextSite): boolean => {
        return site.tooltip !== "(none)";
      }).length,
    ).toBeGreaterThan(20);
  });

  test("every badge given translated words draws them as written, never looking them up again (#8067)", () => {
    expect(
      sites
        .filter((site: BadgeTextSite): boolean => {
          return site.isTranslated && !site.isMarkedAsWritten;
        })
        .map(placeOf),
    ).toEqual([]);
  });

  test("every badge given a translated hover tip draws it as written (#8067)", () => {
    expect(
      sites
        .filter((site: BadgeTextSite): boolean => {
          return site.isTooltipTranslated && !site.isTooltipMarkedAsWritten;
        })
        .map((site: BadgeTextSite): string => {
          return `${site.file}:${site.line} <${site.badge} tooltip={${site.tooltip}}>`;
        }),
    ).toEqual([]);
  });

  test("a badge drawn as written has none of its words left in English (#8067)", () => {
    expect(
      sites
        .filter((site: BadgeTextSite): boolean => {
          return (
            site.isTranslated && site.isMarkedAsWritten && site.readsEnglish
          );
        })
        .map(placeOf),
    ).toEqual([]);
  });

  test("draw hundreds of badges, so the reader is reading them", () => {
    expect(sites.length).toBeGreaterThan(500);
    expect(
      sites.filter((site: BadgeTextSite): boolean => {
        return site.readsName;
      }).length,
    ).toBeGreaterThan(50);
  });

  test("every badge that draws a name says how the name reads", () => {
    const unmarked: Array<string> = sites
      .filter((site: BadgeTextSite): boolean => {
        return site.readsName && !site.isMarked;
      })
      .map((site: BadgeTextSite): string => {
        return `${site.file}:${site.line} <${site.badge} text={${site.text}}>`;
      });

    expect(unmarked).toEqual([]);
  });
});
