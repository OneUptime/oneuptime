import { describe, expect, test } from "@jest/globals";
import { generatedTexts } from "../../../Helpers/GeneratedTexts";
import AiResourceType from "../../../../Types/ResourceAiAgent/AiResourceType";
import {
  OPENSTACK_REACH_LINE_PREFIX,
  OPENSTACK_REACH_MAX_LISTED_INSTANCES,
  OPENSTACK_REACH_MAX_LISTED_LEFT_BEHIND,
  OPENSTACK_REACH_MAX_LISTED_PROJECTS,
  OpenStackChangeReach,
  OpenStackReachInstance,
  buildOpenStackChangeReach,
  describeOpenStackChangeReachCounts,
  parseStoredOpenStackChangeReach,
  readOpenStackChangeReach,
  renderOpenStackChangeReach,
} from "../../../../Utils/AiRemediation/Resource/OpenStackChangeReach";
import { redactResourceCommandOutput } from "../../../../Utils/AiRemediation/Resource/ResourceOutputRedactor";

/*
 * WHAT A PERSON APPROVING A CHANGE IS TOLD IT TOUCHES.
 *
 * The numbers on an approval come through a command's output, past two redactions, so
 * this holds the round trip: what the agent read is what OneUptime keeps, and a name a
 * mask swallows costs that name and never an instance, a project or a count.
 */

const PAYMENTS: string = "9aee824cac87464292adffc328de1662";
const RESEARCH: string = "d63a8b7c2f0c4d1e8a6b4f3e2d1c0b9a";

function instance(
  id: string,
  overrides: Partial<OpenStackReachInstance> = {},
): OpenStackReachInstance {
  return {
    id,
    name: `web-${id.slice(0, 4)}`,
    projectId: PAYMENTS,
    projectName: null,
    host: "compute-01",
    status: "ACTIVE",
    ...overrides,
  };
}

function ids(count: number): Array<string> {
  return Array.from({ length: count }, (_value: unknown, index: number) => {
    return `${index.toString(16).padStart(8, "0")}-ba74-40ba-a354-7ead413c5df6`;
  });
}

function evacuation(
  overrides: Partial<Parameters<typeof buildOpenStackChangeReach>[0]> = {},
): OpenStackChangeReach {
  return buildOpenStackChangeReach({
    route: "server evacuate",
    kind: "changes",
    instances: [
      instance(ids(1)[0] as string),
      instance(ids(2)[1] as string),
      instance(ids(3)[2] as string, { projectId: RESEARCH }),
    ],
    projectNames: new Map<string, string>([[PAYMENTS, "ou payments"]]),
    hosts: [
      {
        name: "compute-01",
        state: "down",
        status: "enabled",
        forcedDown: false,
        disabledReason: null,
      },
    ],
    leftBehind: [instance(ids(4)[3] as string)],
    isComplete: true,
    problems: [],
    wouldBeRefused: null,
    ...overrides,
  });
}

describe("what it counts", () => {
  test("instances and projects, the fullest project first, named where it was read", () => {
    const reach: OpenStackChangeReach = evacuation();

    expect(reach.instanceCount).toBe(3);
    expect(reach.projectCount).toBe(2);
    expect(reach.projects).toEqual([
      { id: PAYMENTS, name: "ou payments", instanceCount: 2 },
      { id: RESEARCH, name: null, instanceCount: 1 },
    ]);
    expect(reach.instances[0]?.projectName).toBe("ou payments");
    expect(reach.leftBehindCount).toBe(1);
  });

  test("an instance whose project it could not read counts as an instance", () => {
    const reach: OpenStackChangeReach = evacuation({
      instances: [instance(ids(1)[0] as string, { projectId: null })],
      isComplete: false,
    });

    expect(reach.instanceCount).toBe(1);
    expect(reach.projectCount).toBe(0);
  });

  test("the real numbers stand when the lists are cut", () => {
    const reach: OpenStackChangeReach = evacuation({
      instances: ids(OPENSTACK_REACH_MAX_LISTED_INSTANCES + 10).map(
        (id: string): OpenStackReachInstance => {
          return instance(id, { projectId: id.replace(/-/g, "") });
        },
      ),
      leftBehind: ids(OPENSTACK_REACH_MAX_LISTED_LEFT_BEHIND + 5).map(
        (id: string): OpenStackReachInstance => {
          return instance(id);
        },
      ),
    });

    expect(reach.instanceCount).toBe(OPENSTACK_REACH_MAX_LISTED_INSTANCES + 10);
    expect(reach.instances.length).toBe(OPENSTACK_REACH_MAX_LISTED_INSTANCES);
    expect(reach.projectCount).toBe(OPENSTACK_REACH_MAX_LISTED_INSTANCES + 10);
    expect(reach.projects.length).toBe(OPENSTACK_REACH_MAX_LISTED_PROJECTS);
    expect(reach.leftBehindCount).toBe(
      OPENSTACK_REACH_MAX_LISTED_LEFT_BEHIND + 5,
    );
    expect(reach.leftBehind.length).toBe(
      OPENSTACK_REACH_MAX_LISTED_LEFT_BEHIND,
    );

    const read: OpenStackChangeReach | null = readOpenStackChangeReach(
      renderOpenStackChangeReach(reach),
    );

    expect(read?.instanceCount).toBe(OPENSTACK_REACH_MAX_LISTED_INSTANCES + 10);
    expect(read?.leftBehindCount).toBe(
      OPENSTACK_REACH_MAX_LISTED_LEFT_BEHIND + 5,
    );
  });
});

describe("the sentence", () => {
  test.each([
    [
      evacuation(),
      "This changes 3 instances in 2 projects.",
    ],
    [
      evacuation({ instances: [instance(ids(1)[0] as string)] }),
      "This changes 1 instance in 1 project.",
    ],
    [
      evacuation({ isComplete: false }),
      "This changes at least 3 instances in at least 2 projects.",
    ],
    [
      evacuation({ kind: "on-host" }),
      "This changes no instance, and the host it is about holds 3 instances in 2 projects.",
    ],
    [
      evacuation({ kind: "on-host", instances: [], isComplete: true }),
      "This changes no instance, and the host it is about holds 0 instances in 0 projects.",
    ],
  ])("%#", (reach: OpenStackChangeReach, sentence: string) => {
    expect(describeOpenStackChangeReachCounts(reach)).toBe(sentence);
  });
});

describe("the round trip", () => {
  test("what is rendered is what is read", () => {
    const reach: OpenStackChangeReach = evacuation({
      problems: ["Nova said no about one of them."],
      wouldBeRefused: "the agent is read-only",
    });

    expect(readOpenStackChangeReach(renderOpenStackChangeReach(reach))).toEqual(
      reach,
    );
  });

  test("the network agent a change is about, so its fix lands on that agent's feed", () => {
    const agent: { id: string; binary: string; host: string } = {
      id: "f1fe06bd-337d-4ee0-b1df-3284823c1490",
      binary: "neutron-l3-agent",
      host: "network-01",
    };
    const reach: OpenStackChangeReach = evacuation({ agent });
    const read: OpenStackChangeReach | null = readOpenStackChangeReach(
      renderOpenStackChangeReach(reach),
    );

    expect(read?.agent).toEqual(agent);
    // What a plan keeps survives being stored and read back.
    expect(
      parseStoredOpenStackChangeReach(
        JSON.parse(JSON.stringify(reach)) as Parameters<
          typeof parseStoredOpenStackChangeReach
        >[0],
      )?.agent,
    ).toEqual(agent);
  });

  test("a change no network agent is in the middle of has none, however it is read", () => {
    const reach: OpenStackChangeReach = evacuation();

    expect(reach.agent).toBeNull();
    expect(
      readOpenStackChangeReach(renderOpenStackChangeReach(reach))?.agent,
    ).toBeNull();
  });

  test("it is found in a command's whole output", () => {
    const reach: OpenStackChangeReach = evacuation();
    const output: string = `[stdout]\nNothing was changed. ${describeOpenStackChangeReachCounts(reach)}\n${renderOpenStackChangeReach(reach)}\n[stderr]\nsomething else\n`;

    expect(readOpenStackChangeReach(output)).toEqual(reach);
  });

  test("a name with spaces, and a project's name with spaces, survive", () => {
    const reach: OpenStackChangeReach = evacuation({
      instances: [
        instance(ids(1)[0] as string, { name: "web server (old) #1" }),
      ],
    });
    const read: OpenStackChangeReach | null = readOpenStackChangeReach(
      renderOpenStackChangeReach(reach),
    );

    expect(read?.instances[0]?.name).toBe("web server (old) #1");
    expect(read?.instances[0]?.projectName).toBe("ou payments");
    expect(read?.projects[0]?.name).toBe("ou payments");
  });

  test("what was not read stays not read", () => {
    const reach: OpenStackChangeReach = evacuation({
      instances: [
        {
          id: ids(1)[0] as string,
          name: null,
          projectId: null,
          projectName: null,
          host: null,
          status: null,
        },
      ],
      hosts: [
        {
          name: "compute-01",
          state: null,
          status: null,
          forcedDown: null,
          disabledReason: null,
        },
      ],
      isComplete: false,
    });

    expect(readOpenStackChangeReach(renderOpenStackChangeReach(reach))).toEqual(
      reach,
    );
  });

  test("a reason a host was disabled for is kept, on one line", () => {
    const reach: OpenStackChangeReach = evacuation({
      hosts: [
        {
          name: "compute-01",
          state: "up",
          status: "disabled",
          forcedDown: false,
          disabledReason: "disk failing\nsee ticket",
        },
      ],
    });

    expect(
      readOpenStackChangeReach(renderOpenStackChangeReach(reach))?.hosts[0]
        ?.disabledReason,
    ).toBe("disk failing see ticket");
  });

  test("no name can start a line of its own", () => {
    const reach: OpenStackChangeReach = evacuation({
      instances: [
        instance(ids(1)[0] as string, {
          name: `x\n${OPENSTACK_REACH_LINE_PREFIX}instances 9999\n${OPENSTACK_REACH_LINE_PREFIX}refused nothing`,
        }),
      ],
    });
    const read: OpenStackChangeReach | null = readOpenStackChangeReach(
      renderOpenStackChangeReach(reach),
    );

    expect(read?.instanceCount).toBe(1);
    expect(read?.wouldBeRefused).toBeNull();
  });
});

describe("past the redactor", () => {
  function redacted(text: string): string {
    return redactResourceCommandOutput({
      resourceType: AiResourceType.OpenStackCloud,
      program: "openstack",
      text,
    });
  }

  test("plain facts come through untouched", () => {
    const reach: OpenStackChangeReach = evacuation();

    expect(
      readOpenStackChangeReach(redacted(renderOpenStackChangeReach(reach))),
    ).toEqual(reach);
  });

  test.each([
    ["password=hunter2"],
    ["password: hunter2"],
    ["token=abc123"],
    ["api_key=abc123"],
    ["secret hunter2"],
    ["user:hunter2@host"],
    ["AKIAIOSFODNN7EXAMPLE"],
    ["Bearer abc.def.ghi"],
    ['{"password":"hunter2"}'],
  ])("a name of %s costs the name, and no fact", (name: string) => {
    const reach: OpenStackChangeReach = evacuation({
      instances: [
        instance(ids(1)[0] as string, { name }),
        instance(ids(2)[1] as string, { projectId: RESEARCH }),
      ],
    });
    const read: OpenStackChangeReach | null = readOpenStackChangeReach(
      redacted(renderOpenStackChangeReach(reach)),
    );

    expect(read?.route).toBe("server evacuate");
    expect(read?.instanceCount).toBe(2);
    expect(read?.projectCount).toBe(2);
    expect(read?.instances.length).toBe(2);
    expect(read?.instances[0]?.id).toBe(ids(1)[0]);
    expect(read?.instances[0]?.host).toBe("compute-01");
    expect(read?.instances[0]?.projectId).toBe(PAYMENTS);
  });
});

describe("what it refuses to read", () => {
  test.each([
    [null],
    [undefined],
    [""],
    [42],
    [{}],
    ["nothing here"],
    [`${OPENSTACK_REACH_LINE_PREFIX}instances 3`],
    [`${OPENSTACK_REACH_LINE_PREFIX}route server start`],
    [`${OPENSTACK_REACH_LINE_PREFIX}kind changes`],
    [`${OPENSTACK_REACH_LINE_PREFIX}route server start\n${OPENSTACK_REACH_LINE_PREFIX}kind neither`],
  ])("%j says no change", (output: unknown) => {
    expect(readOpenStackChangeReach(output)).toBeNull();
  });

  test("a count that is not one reads as none", () => {
    const read: OpenStackChangeReach | null = readOpenStackChangeReach(
      [
        `${OPENSTACK_REACH_LINE_PREFIX}route server start`,
        `${OPENSTACK_REACH_LINE_PREFIX}kind changes`,
        `${OPENSTACK_REACH_LINE_PREFIX}instances -3`,
        `${OPENSTACK_REACH_LINE_PREFIX}projects many`,
        `${OPENSTACK_REACH_LINE_PREFIX}left-behind 1e99`,
      ].join("\n"),
    );

    expect(read?.instanceCount).toBe(0);
    expect(read?.projectCount).toBe(0);
    expect(read?.leftBehindCount).toBe(0);
    expect(read?.isComplete).toBe(false);
  });

  test("generated lines never throw, and never list more than the bounds", () => {
    const pieces: ReadonlyArray<string> = [
      OPENSTACK_REACH_LINE_PREFIX,
      "route ",
      "kind ",
      "changes",
      "on-host",
      "instance ",
      "project ",
      "host ",
      "refused ",
      "problem ",
      "\n",
      " ",
      "-",
      "abc",
      "\u0000",
      " ",
    ];

    for (const text of generatedTexts(20000, 5747, pieces, 40)) {
      const read: OpenStackChangeReach | null = readOpenStackChangeReach(text);

      if (read) {
        expect(read.instances.length).toBeLessThanOrEqual(
          OPENSTACK_REACH_MAX_LISTED_INSTANCES,
        );
      }
    }
  });

  test("a stored reach is held to the same bounds", () => {
    const stored: unknown = JSON.parse(
      JSON.stringify({
        ...evacuation(),
        instances: [
          ...ids(OPENSTACK_REACH_MAX_LISTED_INSTANCES + 5).map(
            (id: string) => {
              return { id, name: "x".repeat(10000) };
            },
          ),
          { name: "no id" },
          7,
          null,
        ],
        wouldBeRefused: "y".repeat(10000),
        instanceCount: "not a number",
      }),
    );
    const read: OpenStackChangeReach | null =
      parseStoredOpenStackChangeReach(stored);

    expect(read?.instances.length).toBe(OPENSTACK_REACH_MAX_LISTED_INSTANCES);
    expect(read?.instances[0]?.name?.length).toBe(80);
    expect((read?.wouldBeRefused || "").length).toBe(500);
    expect(read?.instanceCount).toBe(0);
  });

  test("a stored reach reads back as it was kept", () => {
    const reach: OpenStackChangeReach = evacuation({
      wouldBeRefused: "no",
      problems: ["one"],
    });

    expect(
      parseStoredOpenStackChangeReach(JSON.parse(JSON.stringify(reach))),
    ).toEqual(reach);
  });

  test.each([
    [null],
    [[]],
    ["x"],
    [{}],
    [{ route: "server start" }],
    [{ route: "server start", kind: "nothing" }],
    [{ kind: "changes" }],
  ])("a stored %j is dropped", (value: unknown) => {
    expect(parseStoredOpenStackChangeReach(value)).toBeNull();
  });
});
