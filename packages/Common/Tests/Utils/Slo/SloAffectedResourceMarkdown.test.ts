import {
  getSloAffectedResourceMarkdownLines,
  getSloDashboardUrl,
  SloAffectedResourceLinkSubject,
} from "../../../Utils/Slo/SloAffectedResourceMarkdown";
import URL from "../../../Types/API/URL";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * The SLO bullets under "Resources Affected" in an incident's or alert's
 * "created" feed item. The feed renders markdown without safe mode, so the
 * SLO name is the dangerous part: it must never be able to re-point the
 * link, render an image (a zero-click request to a third party every time
 * the feed is opened), restyle the sentence or break onto a new line.
 *
 * The callers read the record as root, so the helper also names only SLOs of
 * the record's own project. Otherwise a link to another project's SLO would
 * publish that SLO's name in this project's feed.
 */

const DASHBOARD_URL: URL = URL.fromString(
  "https://oneuptime.example/dashboard",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-aaaa-4aaa-8bbb-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-aaaa-4aaa-8bbb-000000000002",
);
const SLO_ID: string = "0193c0de-aaaa-4aaa-8bbb-0000000000f1";
const OTHER_SLO_ID: string = "0193c0de-aaaa-4aaa-8bbb-0000000000f2";

function sloLink(sloId: string): string {
  return `https://oneuptime.example/dashboard/${PROJECT_ID.toString()}/slos/${sloId}`;
}

// An SLO of the record's own project, as the relation select returns it.
function ownSlo(data: {
  _id?: string | undefined;
  name?: string | undefined;
}): SloAffectedResourceLinkSubject {
  return { ...data, projectId: PROJECT_ID };
}

describe("getSloDashboardUrl", () => {
  test("points at the SLO overview in the project", () => {
    expect(
      getSloDashboardUrl({
        dashboardUrl: DASHBOARD_URL,
        projectId: PROJECT_ID,
        sloId: SLO_ID,
      }).toString(),
    ).toBe(sloLink(SLO_ID));
  });

  test("accepts an ObjectID as well as a string id", () => {
    expect(
      getSloDashboardUrl({
        dashboardUrl: DASHBOARD_URL,
        projectId: PROJECT_ID,
        sloId: new ObjectID(SLO_ID),
      }).toString(),
    ).toBe(sloLink(SLO_ID));
  });

  test("leaves the caller's dashboard URL alone (URL.addRoute mutates)", () => {
    const dashboardUrl: URL = URL.fromString(
      "https://oneuptime.example/dashboard",
    );

    getSloDashboardUrl({
      dashboardUrl: dashboardUrl,
      projectId: PROJECT_ID,
      sloId: SLO_ID,
    });
    getSloDashboardUrl({
      dashboardUrl: dashboardUrl,
      projectId: PROJECT_ID,
      sloId: OTHER_SLO_ID,
    });

    expect(dashboardUrl.toString()).toBe("https://oneuptime.example/dashboard");
  });
});

describe("getSloAffectedResourceMarkdownLines", () => {
  test("one bullet per SLO, named the way every SLO feed names one", () => {
    expect(
      getSloAffectedResourceMarkdownLines({
        dashboardUrl: DASHBOARD_URL,
        projectId: PROJECT_ID,
        serviceLevelObjectives: [
          ownSlo({ _id: SLO_ID, name: "Checkout availability" }),
          ownSlo({ _id: OTHER_SLO_ID, name: "Search latency p95" }),
        ],
      }),
    ).toEqual([
      `- [SLO Checkout availability](${sloLink(SLO_ID)})`,
      `- [SLO Search latency p95](${sloLink(OTHER_SLO_ID)})`,
    ]);
  });

  test("every URL is built from a fresh copy, so bullets do not accumulate routes", () => {
    const lines: Array<string> = getSloAffectedResourceMarkdownLines({
      dashboardUrl: DASHBOARD_URL,
      projectId: PROJECT_ID,
      serviceLevelObjectives: [
        ownSlo({ _id: SLO_ID, name: "A" }),
        ownSlo({ _id: OTHER_SLO_ID, name: "B" }),
      ],
    });

    expect(lines[1]).toBe(`- [SLO B](${sloLink(OTHER_SLO_ID)})`);
    expect(DASHBOARD_URL.toString()).toBe(
      "https://oneuptime.example/dashboard",
    );
  });

  test("a name cannot re-point the link", () => {
    const [line]: Array<string> = getSloAffectedResourceMarkdownLines({
      dashboardUrl: DASHBOARD_URL,
      projectId: PROJECT_ID,
      serviceLevelObjectives: [
        ownSlo({ _id: SLO_ID, name: "Checkout](https://evil.example) x" }),
      ],
    });

    expect(line).toBe(
      `- [SLO Checkout\\]\\(https://evil.example\\) x](${sloLink(SLO_ID)})`,
    );
    expect(line).not.toContain("](https://evil.example)");
    // The only link destination left is the SLO's own.
    expect(line!.endsWith(`](${sloLink(SLO_ID)})`)).toBe(true);
  });

  test("a name cannot render an image, raw HTML or emphasis", () => {
    const [line]: Array<string> = getSloAffectedResourceMarkdownLines({
      dashboardUrl: DASHBOARD_URL,
      projectId: PROJECT_ID,
      serviceLevelObjectives: [
        ownSlo({
          _id: SLO_ID,
          name: "![pixel](https://tracker.example/p.gif) <img src=x> *loud* _x_",
        }),
      ],
    });

    expect(line).not.toContain("![");
    // Every `<` is backslash-escaped, which CommonMark renders as a literal `<`.
    expect(line).not.toMatch(/(^|[^\\])</);
    expect(line).toContain("\\!\\[pixel\\]");
    expect(line).toContain("\\<img src=x\\>");
    expect(line).toContain("\\*loud\\*");
    expect(line).toContain("\\_x\\_");
  });

  test("a name cannot start a new markdown block", () => {
    const [line]: Array<string> = getSloAffectedResourceMarkdownLines({
      dashboardUrl: DASHBOARD_URL,
      projectId: PROJECT_ID,
      serviceLevelObjectives: [
        ownSlo({ _id: SLO_ID, name: "Checkout\n# Pwned\r\n- injected bullet" }),
      ],
    });

    expect(line).not.toMatch(/[\r\n]/);
    expect(line).toBe(
      `- [SLO Checkout \\# Pwned \\- injected bullet](${sloLink(SLO_ID)})`,
    );
  });

  test("an SLO with no usable name is still linked, as 'SLO'", () => {
    expect(
      getSloAffectedResourceMarkdownLines({
        dashboardUrl: DASHBOARD_URL,
        projectId: PROJECT_ID,
        serviceLevelObjectives: [
          ownSlo({ _id: SLO_ID }),
          ownSlo({ _id: OTHER_SLO_ID, name: "   " }),
        ],
      }),
    ).toEqual([
      `- [SLO](${sloLink(SLO_ID)})`,
      `- [SLO](${sloLink(OTHER_SLO_ID)})`,
    ]);
  });

  test("an SLO without an id is skipped rather than printed as a dead link", () => {
    expect(
      getSloAffectedResourceMarkdownLines({
        dashboardUrl: DASHBOARD_URL,
        projectId: PROJECT_ID,
        serviceLevelObjectives: [
          ownSlo({ name: "Unsaved objective" }),
          ownSlo({ _id: SLO_ID, name: "Checkout availability" }),
        ],
      }),
    ).toEqual([`- [SLO Checkout availability](${sloLink(SLO_ID)})`]);
  });

  test("the same SLO twice is one bullet", () => {
    expect(
      getSloAffectedResourceMarkdownLines({
        dashboardUrl: DASHBOARD_URL,
        projectId: PROJECT_ID,
        serviceLevelObjectives: [
          ownSlo({ _id: SLO_ID, name: "Checkout availability" }),
          ownSlo({ _id: SLO_ID, name: "Checkout availability" }),
        ],
      }),
    ).toHaveLength(1);
  });

  test.each([[undefined], [null], [[]]])(
    "no SLOs (%p) is no bullets",
    (
      serviceLevelObjectives:
        | Array<SloAffectedResourceLinkSubject>
        | undefined
        | null,
    ) => {
      expect(
        getSloAffectedResourceMarkdownLines({
          dashboardUrl: DASHBOARD_URL,
          projectId: PROJECT_ID,
          serviceLevelObjectives: serviceLevelObjectives,
        }),
      ).toEqual([]);
    },
  );
});

describe("getSloAffectedResourceMarkdownLines names only the record's own project's SLOs", () => {
  test("another project's SLO is left out, name and link alike", () => {
    const lines: Array<string> = getSloAffectedResourceMarkdownLines({
      dashboardUrl: DASHBOARD_URL,
      projectId: PROJECT_ID,
      serviceLevelObjectives: [
        {
          _id: OTHER_SLO_ID,
          name: "Payments SLO of another project",
          projectId: OTHER_PROJECT_ID,
        },
        ownSlo({ _id: SLO_ID, name: "Checkout availability" }),
      ],
    });

    expect(lines).toEqual([
      `- [SLO Checkout availability](${sloLink(SLO_ID)})`,
    ]);
    expect(lines.join("\n")).not.toContain("Payments SLO of another project");
    expect(lines.join("\n")).not.toContain(OTHER_SLO_ID);
  });

  test("an SLO whose project was not read is left out, since it cannot be shown to belong", () => {
    expect(
      getSloAffectedResourceMarkdownLines({
        dashboardUrl: DASHBOARD_URL,
        projectId: PROJECT_ID,
        serviceLevelObjectives: [
          { _id: SLO_ID, name: "Checkout availability" },
          { _id: OTHER_SLO_ID, name: "Search latency", projectId: null },
        ],
      }),
    ).toEqual([]);
  });

  test("the project comparison accepts a string id in either case", () => {
    expect(
      getSloAffectedResourceMarkdownLines({
        dashboardUrl: DASHBOARD_URL,
        projectId: PROJECT_ID,
        serviceLevelObjectives: [
          {
            _id: SLO_ID,
            name: "Checkout availability",
            projectId: PROJECT_ID.toString().toUpperCase(),
          },
        ],
      }),
    ).toEqual([`- [SLO Checkout availability](${sloLink(SLO_ID)})`]);
  });

  test("a foreign copy of an id does not hide this project's SLO with the same id listed after it", () => {
    /*
     * A row cannot really hold one id twice. But if a foreign entry is
     * skipped it must not count as seen, or the de-duplication would swallow
     * the real bullet.
     */
    expect(
      getSloAffectedResourceMarkdownLines({
        dashboardUrl: DASHBOARD_URL,
        projectId: PROJECT_ID,
        serviceLevelObjectives: [
          { _id: SLO_ID, name: "Foreign", projectId: OTHER_PROJECT_ID },
          ownSlo({ _id: SLO_ID, name: "Checkout availability" }),
        ],
      }),
    ).toEqual([`- [SLO Checkout availability](${sloLink(SLO_ID)})`]);
  });
});
