import { describe, expect, test } from "@jest/globals";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import Link from "../../../Types/Link";
import { nameRecordInTrail } from "../../../UI/Components/Page/RecordNameInTrail";

/*
 * nameRecordInTrail hands a record's name to the crumb that stands for the
 * record - the one whose address ends at the record's id - so a record's
 * pages read "Project > Monitors > Website: acme.com > Criteria" rather than
 * "> View Monitor >", above the page and in the browser tab.
 */

const PROJECT_ID: string = "65f00000000000000000aaaa";
const MONITOR_ID: string = "65f00000000000000000bbbb";

function trailOnCriteria(): Array<Link> {
  return [
    { title: "Project", to: new Route(`/dashboard/${PROJECT_ID}`) },
    { title: "Monitors", to: new Route(`/dashboard/${PROJECT_ID}/monitors`) },
    {
      title: "View Monitor",
      to: new Route(`/dashboard/${PROJECT_ID}/monitors/${MONITOR_ID}`),
    },
    {
      title: "Criteria",
      to: new Route(`/dashboard/${PROJECT_ID}/monitors/${MONITOR_ID}/criteria`),
    },
  ];
}

function namesIn(trail: Array<Link> | undefined): Array<string | undefined> {
  return (trail || []).map((link: Link): string | undefined => {
    return link.recordName;
  });
}

describe("the crumb that stands for the record is named", () => {
  test("on a page below the record", () => {
    const named: Array<Link> | undefined = nameRecordInTrail({
      links: trailOnCriteria(),
      recordId: MONITOR_ID,
      recordName: "Website: acme.com",
    });

    expect(namesIn(named)).toEqual([
      undefined,
      undefined,
      "Website: acme.com",
      undefined,
    ]);
  });

  test("on the record's own page, the last crumb", () => {
    const named: Array<Link> | undefined = nameRecordInTrail({
      links: trailOnCriteria().slice(0, 3),
      recordId: MONITOR_ID,
      recordName: "Website: acme.com",
    });

    expect(namesIn(named)).toEqual([undefined, undefined, "Website: acme.com"]);
  });

  test("its title stays the page's own name, for whatever names the page", () => {
    const named: Array<Link> = nameRecordInTrail({
      links: trailOnCriteria(),
      recordId: MONITOR_ID,
      recordName: "Website: acme.com",
    })!;

    expect(
      named.map((link: Link): string => {
        return link.title;
      }),
    ).toEqual(["Project", "Monitors", "View Monitor", "Criteria"]);
    expect(named[2]!.to.toString()).toBe(
      `/dashboard/${PROJECT_ID}/monitors/${MONITOR_ID}`,
    );
  });

  test("the name is kept as typed, spaces and all", () => {
    const named: Array<Link> | undefined = nameRecordInTrail({
      links: trailOnCriteria(),
      recordId: MONITOR_ID,
      recordName: "  Checkout API (EU) ",
    });

    expect(named![2]!.recordName).toBe("  Checkout API (EU) ");
  });

  test.each([
    ["a trailing slash", `/dashboard/${PROJECT_ID}/monitors/${MONITOR_ID}/`],
    ["a query string", `/dashboard/${PROJECT_ID}/monitors/${MONITOR_ID}?tab=1`],
    ["a fragment", `/dashboard/${PROJECT_ID}/monitors/${MONITOR_ID}#top`],
    [
      "upper case",
      `/dashboard/${PROJECT_ID}/monitors/${MONITOR_ID.toUpperCase()}`,
    ],
  ])(
    "an address with %s still stands for the record",
    (_case: string, to: string) => {
      const named: Array<Link> | undefined = nameRecordInTrail({
        links: [
          {
            title: "Monitors",
            to: new Route(`/dashboard/${PROJECT_ID}/monitors`),
          },
          { title: "View Monitor", to: new Route(to) },
        ],
        recordId: MONITOR_ID,
        recordName: "Website: acme.com",
      });

      expect(namesIn(named)).toEqual([undefined, "Website: acme.com"]);
    },
  );

  test("a crumb whose address is a full URL is read by its path", () => {
    const named: Array<Link> | undefined = nameRecordInTrail({
      links: [
        {
          title: "View Monitor",
          to: URL.fromString(
            `https://oneuptime.example.com/dashboard/${PROJECT_ID}/monitors/${MONITOR_ID}`,
          ),
        },
      ],
      recordId: MONITOR_ID,
      recordName: "Website: acme.com",
    });

    expect(namesIn(named)).toEqual(["Website: acme.com"]);
  });

  test("the trail handed in is left as it was", () => {
    const trail: Array<Link> = trailOnCriteria();
    const before: string = JSON.stringify(namesIn(trail));

    nameRecordInTrail({
      links: trail,
      recordId: MONITOR_ID,
      recordName: "Website: acme.com",
    });

    expect(JSON.stringify(namesIn(trail))).toBe(before);
    expect(trail[2]!.recordName).toBeUndefined();
  });
});

describe("a trail with nothing to name is handed back as it is", () => {
  test.each([
    ["the name is not known yet", undefined],
    ["the name could not be read", null],
    ["the name is empty", ""],
    ["the name is only spaces", "   "],
  ])("when %s", (_case: string, recordName: string | null | undefined) => {
    const trail: Array<Link> = trailOnCriteria();

    expect(
      nameRecordInTrail({ links: trail, recordId: MONITOR_ID, recordName }),
    ).toBe(trail);
  });

  test("when no crumb ends at the record", () => {
    const trail: Array<Link> = [
      { title: "Project", to: new Route(`/dashboard/${PROJECT_ID}`) },
      {
        title: "View On-Call Policy",
        to: new Route(`/dashboard/${PROJECT_ID}/on-call-duty/policies`),
      },
      {
        title: "Escalation Rules",
        to: new Route(
          `/dashboard/${PROJECT_ID}/on-call-duty/policies/${MONITOR_ID}/escalation`,
        ),
      },
    ];

    const named: Array<Link> | undefined = nameRecordInTrail({
      links: trail,
      recordId: MONITOR_ID,
      recordName: "Primary on-call",
    });

    expect(named).toBe(trail);
  });

  test("when the id only appears inside an address, never at its end", () => {
    const trail: Array<Link> = trailOnCriteria().slice(3);

    expect(
      nameRecordInTrail({
        links: trail,
        recordId: MONITOR_ID,
        recordName: "Website: acme.com",
      }),
    ).toBe(trail);
  });

  test("when another record's id is at the end", () => {
    const trail: Array<Link> = trailOnCriteria();

    expect(
      nameRecordInTrail({
        links: trail,
        recordId: "65f00000000000000000cccc",
        recordName: "Website: acme.com",
      }),
    ).toBe(trail);
  });

  test("when there is no trail, or no id", () => {
    expect(
      nameRecordInTrail({
        links: undefined,
        recordId: MONITOR_ID,
        recordName: "Website: acme.com",
      }),
    ).toBeUndefined();

    const empty: Array<Link> = [];
    expect(
      nameRecordInTrail({
        links: empty,
        recordId: MONITOR_ID,
        recordName: "Website: acme.com",
      }),
    ).toBe(empty);

    const trail: Array<Link> = trailOnCriteria();
    expect(
      nameRecordInTrail({
        links: trail,
        recordId: "",
        recordName: "Website: acme.com",
      }),
    ).toBe(trail);
  });
});
