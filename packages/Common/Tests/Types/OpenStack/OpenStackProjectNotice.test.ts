import { describe, expect, test } from "@jest/globals";
import {
  OPENSTACK_BLAST_RADIUS_PROJECT_LIMIT,
  OpenStackBlastRadius,
  buildOpenStackBlastRadius,
  getEmptyOpenStackBlastRadius,
} from "../../../Types/OpenStack/OpenStackBlastRadius";
import {
  OpenStackProjectNoticeChannel,
  OpenStackProjectNoticeDecision,
  OpenStackProjectNoticeRecipient,
  OpenStackProjectNotTold,
  OpenStackProjectNotToldReason,
  OpenStackProjectTold,
  countOpenStackProjectsNotTold,
  decideOpenStackProjectNotices,
  getOpenStackNoticeChannel,
  getOpenStackNoticePartKey,
  getOpenStackNoticeRecipient,
  isOpenStackProjectNoticeArmed,
} from "../../../Types/OpenStack/OpenStackProjectNotice";
import { OpenStackResourceKind } from "../../../Types/OpenStack/OpenStackResourceKind";

/*
 * WHO IS TOLD, ON THE AWKWARD ROWS.
 *
 * Telling the wrong person is worse than telling nobody, so this is the table of who is and who isn't,
 * with several projects on and off. The preview, the page and the send all read this one answer.
 */

const SEEN: Date = new Date("2026-11-05T10:00:00.000Z");

function armed(
  id: string,
  projectId: string,
  email: string = `${id}@example.com`,
): OpenStackProjectNoticeRecipient {
  return {
    id,
    openStackProjectId: projectId,
    email,
    isEnabled: true,
    previewSeenAt: SEEN,
    previewedRecipient: `email:${email.toLowerCase()}`,
  };
}

function off(id: string, projectId: string): OpenStackProjectNoticeRecipient {
  return { id, openStackProjectId: projectId, email: `${id}@example.com` };
}

function radiusOf(
  byProject: Array<{ projectId: string | null; count: number }>,
  names: Record<string, string> = {},
): OpenStackBlastRadius {
  return buildOpenStackBlastRadius({
    counts: [{ count: "instanceCount", byProject }],
    projectNames: names,
    includeEveryProject: true,
  });
}

function toldTo(decision: OpenStackProjectNoticeDecision): Array<string> {
  return decision.told
    .map((told: OpenStackProjectTold): string => {
      return `${told.project.projectId}:${told.notice.id}`;
    })
    .sort();
}

function reasonOf(
  decision: OpenStackProjectNoticeDecision,
  projectId: string,
): OpenStackProjectNotToldReason | undefined {
  return decision.notTold.find((project: OpenStackProjectNotTold): boolean => {
    return project.projectId === projectId;
  })?.reason;
}

describe("a notice is armed only once an operator has seen who it tells", () => {
  test.each<[string, OpenStackProjectNoticeRecipient, boolean]>([
    ["never turned on", off("a", "p"), false],
    ["turned on, having seen this recipient", armed("a", "p"), true],
    [
      "the email's case means nothing to a mail server",
      {
        ...armed("a", "p"),
        email: "A@Example.COM",
        previewedRecipient: "email:a@example.com",
      },
      true,
    ],
    [
      "the address changed after it was seen",
      { ...armed("a", "p"), email: "someone-else@example.com" },
      false,
    ],
    [
      "on, and the preview was never seen",
      { ...armed("a", "p"), previewSeenAt: null },
      false,
    ],
    [
      "on, and no record of what was seen",
      { ...armed("a", "p"), previewedRecipient: null },
      false,
    ],
    [
      "both an email and a webhook is not one recipient",
      { ...armed("a", "p"), webhookUrl: "https://example.com/hook" },
      false,
    ],
    [
      "neither is no recipient",
      {
        id: "a",
        openStackProjectId: "p",
        isEnabled: true,
        previewSeenAt: SEEN,
      },
      false,
    ],
    [
      "a webhook, seen",
      {
        id: "a",
        openStackProjectId: "p",
        webhookUrl: "https://example.com/Hook",
        isEnabled: true,
        previewSeenAt: SEEN,
        previewedRecipient: "webhook:https://example.com/Hook",
      },
      true,
    ],
    [
      "a webhook whose path's case changed is another address",
      {
        id: "a",
        openStackProjectId: "p",
        webhookUrl: "https://example.com/hook",
        isEnabled: true,
        previewSeenAt: SEEN,
        previewedRecipient: "webhook:https://example.com/Hook",
      },
      false,
    ],
  ])("%s", (
    _name: string,
    notice: OpenStackProjectNoticeRecipient,
    expected: boolean,
  ) => {
    expect(isOpenStackProjectNoticeArmed(notice)).toBe(expected);
  });

  test("the channel is whichever of the two it holds, and neither when both", () => {
    expect(getOpenStackNoticeChannel({ email: "a@example.com" })).toBe(
      OpenStackProjectNoticeChannel.Email,
    );
    expect(
      getOpenStackNoticeChannel({ webhookUrl: "https://example.com" }),
    ).toBe(OpenStackProjectNoticeChannel.Webhook);
    expect(
      getOpenStackNoticeChannel({
        email: "a@example.com",
        webhookUrl: "https://example.com",
      }),
    ).toBeNull();
    expect(getOpenStackNoticeRecipient({})).toBeNull();
  });
});

describe("who a failure tells", () => {
  const PAYMENTS: string = "11111111111111111111111111111111";
  const RESEARCH: string = "22222222222222222222222222222222";
  const WEB: string = "33333333333333333333333333333333";

  const RADIUS: OpenStackBlastRadius = radiusOf(
    [
      { projectId: PAYMENTS, count: 3 },
      { projectId: RESEARCH, count: 1 },
      { projectId: WEB, count: 2 },
    ],
    { [PAYMENTS]: "ou-payments", [RESEARCH]: "ou-research", [WEB]: "ou-web" },
  );
  const EVERYONE: Set<string> = new Set([PAYMENTS, RESEARCH, WEB]);

  test("nobody at all, with no notice anywhere", () => {
    const decision: OpenStackProjectNoticeDecision =
      decideOpenStackProjectNotices({
        radius: RADIUS,
        notices: [],
        existingProjectIds: EVERYONE,
      });

    expect(decision.told).toEqual([]);
    expect(
      decision.notTold.map((project: OpenStackProjectNotTold) => {
        return project.reason;
      }),
    ).toEqual([
      OpenStackProjectNotToldReason.NoRecipient,
      OpenStackProjectNotToldReason.NoRecipient,
      OpenStackProjectNotToldReason.NoRecipient,
    ]);
  });

  test("three projects on the host, one turned on: only that one is told", () => {
    const decision: OpenStackProjectNoticeDecision =
      decideOpenStackProjectNotices({
        radius: RADIUS,
        notices: [armed("n1", PAYMENTS), off("n2", RESEARCH)],
        existingProjectIds: EVERYONE,
      });

    expect(toldTo(decision)).toEqual([`${PAYMENTS}:n1`]);
    expect(decision.told[0]!.project.instanceCount).toBe(3);
    expect(reasonOf(decision, RESEARCH)).toBe(
      OpenStackProjectNotToldReason.NoticesOff,
    );
    expect(reasonOf(decision, WEB)).toBe(
      OpenStackProjectNotToldReason.NoRecipient,
    );
  });

  test("a project turned off stays untold while the others are told", () => {
    const decision: OpenStackProjectNoticeDecision =
      decideOpenStackProjectNotices({
        radius: RADIUS,
        notices: [
          armed("n1", PAYMENTS),
          armed("n2", RESEARCH),
          { ...armed("n3", WEB), isEnabled: false },
        ],
        existingProjectIds: EVERYONE,
      });

    expect(toldTo(decision)).toEqual([`${PAYMENTS}:n1`, `${RESEARCH}:n2`]);
    expect(reasonOf(decision, WEB)).toBe(
      OpenStackProjectNotToldReason.NoticesOff,
    );
  });

  test("a project on none of the host is never told, however on its notice is", () => {
    const elsewhere: string = "44444444444444444444444444444444";
    const decision: OpenStackProjectNoticeDecision =
      decideOpenStackProjectNotices({
        radius: RADIUS,
        notices: [armed("n1", elsewhere)],
        existingProjectIds: new Set([...EVERYONE, elsewhere]),
      });

    expect(decision.told).toEqual([]);
    expect(reasonOf(decision, elsewhere)).toBeUndefined();
  });

  test("a recipient changed since its preview is not told, and the row says why", () => {
    const decision: OpenStackProjectNoticeDecision =
      decideOpenStackProjectNotices({
        radius: RADIUS,
        notices: [{ ...armed("n1", PAYMENTS), email: "new@example.com" }],
        existingProjectIds: EVERYONE,
      });

    expect(decision.told).toEqual([]);
    expect(reasonOf(decision, PAYMENTS)).toBe(
      OpenStackProjectNotToldReason.NotPreviewed,
    );
  });

  test("two recipients of one project are both told, and one address once", () => {
    const decision: OpenStackProjectNoticeDecision =
      decideOpenStackProjectNotices({
        radius: RADIUS,
        notices: [
          armed("n1", PAYMENTS, "ops@example.com"),
          armed("n2", PAYMENTS, "OPS@example.com"),
          armed("n3", PAYMENTS, "lead@example.com"),
        ],
        existingProjectIds: EVERYONE,
      });

    expect(toldTo(decision)).toEqual([`${PAYMENTS}:n1`, `${PAYMENTS}:n3`]);
  });

  test("an instance with no project is counted and tells nobody", () => {
    const decision: OpenStackProjectNoticeDecision =
      decideOpenStackProjectNotices({
        radius: radiusOf(
          [
            { projectId: null, count: 2 },
            { projectId: PAYMENTS, count: 3 },
          ],
          { [PAYMENTS]: "ou-payments" },
        ),
        notices: [armed("n1", PAYMENTS)],
        existingProjectIds: EVERYONE,
      });

    expect(toldTo(decision)).toEqual([`${PAYMENTS}:n1`]);
    expect(decision.ofNoProject).toEqual({ instanceCount: 2 });
  });

  test("only instances with no project: nobody, and an operator can see why", () => {
    const decision: OpenStackProjectNoticeDecision =
      decideOpenStackProjectNotices({
        radius: radiusOf([{ projectId: null, count: 4 }]),
        notices: [armed("n1", PAYMENTS)],
        existingProjectIds: EVERYONE,
      });

    expect(decision.told).toEqual([]);
    expect(decision.notTold).toEqual([]);
    expect(decision.ofNoProject).toEqual({ instanceCount: 4 });
  });

  test("a project that was deleted tells nobody, even with leftovers on the host", () => {
    const decision: OpenStackProjectNoticeDecision =
      decideOpenStackProjectNotices({
        radius: radiusOf([
          { projectId: PAYMENTS, count: 3 },
          { projectId: RESEARCH, count: 1 },
        ]),
        notices: [armed("n1", PAYMENTS), armed("n2", RESEARCH)],
        existingProjectIds: new Set([RESEARCH]),
      });

    expect(toldTo(decision)).toEqual([`${RESEARCH}:n2`]);
    expect(reasonOf(decision, PAYMENTS)).toBe(
      OpenStackProjectNotToldReason.ProjectGone,
    );
  });

  test("an ID that begins another's is not that project", () => {
    const decision: OpenStackProjectNoticeDecision =
      decideOpenStackProjectNotices({
        radius: radiusOf([{ projectId: `${PAYMENTS}0`, count: 3 }]),
        notices: [armed("n1", PAYMENTS)],
        existingProjectIds: new Set([PAYMENTS, `${PAYMENTS}0`]),
      });

    expect(decision.told).toEqual([]);
    expect(reasonOf(decision, `${PAYMENTS}0`)).toBe(
      OpenStackProjectNotToldReason.NoRecipient,
    );
  });

  test("a part that affects 500 projects tells only the ones turned on, past what a description names", () => {
    const byProject: Array<{ projectId: string; count: number }> = [];
    const names: Record<string, string> = {};

    for (let index: number = 0; index < 500; index++) {
      const id: string = `project-${String(index).padStart(3, "0")}`;
      // The least affected come last, so the one turned on is past the cap.
      byProject.push({ projectId: id, count: 500 - index });
      names[id] = `Project ${index}`;
    }

    const radius: OpenStackBlastRadius = radiusOf(byProject, names);
    const sixtieth: string = "project-060";
    const last: string = "project-499";

    expect(radius.projects).toHaveLength(OPENSTACK_BLAST_RADIUS_PROJECT_LIMIT);
    expect(radius.projectCount).toBe(500);
    expect(
      radius.projects.some((project: { projectId: string }): boolean => {
        return project.projectId === sixtieth;
      }),
    ).toBe(false);

    const decision: OpenStackProjectNoticeDecision =
      decideOpenStackProjectNotices({
        radius,
        notices: [
          armed("n60", sixtieth),
          armed("n499", last),
          off("off", "project-010"),
        ],
        existingProjectIds: new Set(Object.keys(names)),
      });

    expect(toldTo(decision)).toEqual([`${sixtieth}:n60`, `${last}:n499`]);
    // Each with what it holds itself, past the cap too.
    expect(
      decision.told.find((told: OpenStackProjectTold): boolean => {
        return told.project.projectId === sixtieth;
      })?.project.instanceCount,
    ).toBe(440);
    expect(decision.notTold).toHaveLength(498);
    expect(countOpenStackProjectsNotTold(decision.notTold)).toEqual(
      expect.arrayContaining([
        { reason: OpenStackProjectNotToldReason.NoRecipient, count: 497 },
        { reason: OpenStackProjectNotToldReason.NoticesOff, count: 1 },
      ]),
    );
  });

  test("a reach nothing can read tells nobody on a guess", () => {
    const decision: OpenStackProjectNoticeDecision =
      decideOpenStackProjectNotices({
        radius: getEmptyOpenStackBlastRadius(false),
        notices: [armed("n1", PAYMENTS)],
        existingProjectIds: EVERYONE,
      });

    expect(decision.told).toEqual([]);
    expect(decision.isReachKnown).toBe(false);
  });

  test("no reach read at all tells nobody", () => {
    const decision: OpenStackProjectNoticeDecision =
      decideOpenStackProjectNotices({
        radius: null,
        notices: [armed("n1", PAYMENTS)],
        existingProjectIds: EVERYONE,
      });

    expect(decision.told).toEqual([]);
    expect(decision.isReachKnown).toBe(false);
  });

  test("a part a project owns tells that project, whatever its radius can say", () => {
    const decision: OpenStackProjectNoticeDecision =
      decideOpenStackProjectNotices({
        radius: getEmptyOpenStackBlastRadius(false),
        ownerProjectId: PAYMENTS,
        notices: [armed("n1", PAYMENTS), armed("n2", RESEARCH)],
        existingProjectIds: EVERYONE,
      });

    expect(toldTo(decision)).toEqual([`${PAYMENTS}:n1`]);
    expect(decision.told[0]!.project.instanceCount).toBe(0);
    expect(decision.isReachKnown).toBe(true);
  });

  test("the part's owner and what is on it are one project, told once", () => {
    const decision: OpenStackProjectNoticeDecision =
      decideOpenStackProjectNotices({
        radius: radiusOf([{ projectId: PAYMENTS, count: 2 }]),
        ownerProjectId: PAYMENTS,
        notices: [armed("n1", PAYMENTS)],
        existingProjectIds: EVERYONE,
      });

    expect(toldTo(decision)).toEqual([`${PAYMENTS}:n1`]);
    expect(decision.told[0]!.project.instanceCount).toBe(2);
  });
});

describe("what makes two incidents one failure to whoever is told", () => {
  test("a nova-compute and its hypervisor are the same machine, however they are spelt", () => {
    const service: string = getOpenStackNoticePartKey({
      kind: OpenStackResourceKind.Service,
      name: "nova-compute",
      externalId: "RegionOne/compute/compute-01/nova-compute",
      regionName: "RegionOne",
    });
    const hypervisor: string = getOpenStackNoticePartKey({
      kind: OpenStackResourceKind.Hypervisor,
      name: "compute-01.example.internal",
      externalId: "RegionOne/compute-01.example.internal",
      regionName: "RegionOne",
    });

    expect(service).toBe(hypervisor);
  });

  test("the same host name in another region is another machine", () => {
    expect(
      getOpenStackNoticePartKey({
        kind: OpenStackResourceKind.Hypervisor,
        name: "compute-01",
        regionName: "RegionOne",
      }),
    ).not.toBe(
      getOpenStackNoticePartKey({
        kind: OpenStackResourceKind.Hypervisor,
        name: "compute-01",
        regionName: "RegionTwo",
      }),
    );
  });

  test("a scheduler on that machine is another part", () => {
    expect(
      getOpenStackNoticePartKey({
        kind: OpenStackResourceKind.Service,
        name: "nova-scheduler",
        externalId: "RegionOne/compute/compute-01/nova-scheduler",
        regionName: "RegionOne",
      }),
    ).not.toBe(
      getOpenStackNoticePartKey({
        kind: OpenStackResourceKind.Hypervisor,
        name: "compute-01",
        regionName: "RegionOne",
      }),
    );
  });
});
