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

describe("the front ends", () => {
  const sites: Array<BadgeTextSite> = readAllBadgeTextSites();

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
