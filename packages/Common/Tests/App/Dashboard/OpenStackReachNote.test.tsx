import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import React from "react";
import OpenStackReachNote from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/OpenStackReachNote";
import {
  OpenStackChangeReach,
  OpenStackReachInstance,
  buildOpenStackChangeReach,
} from "../../../Utils/AiRemediation/Resource/OpenStackChangeReach";

/*
 * What a person reads under a change before they approve it: how many instances and projects
 * it touches, which, what state the host is in, and what it leaves behind. The words are the
 * cloud's, and a tenant names its own instances.
 */

const PAYMENTS: string = "9aee824c2f0c4d1e8a6b4f3e2d1c0b9a";
const RESEARCH: string = "d63a8b7c2f0c4d1e8a6b4f3e2d1c0b9a";

function instance(
  index: number,
  overrides: Partial<OpenStackReachInstance> = {},
): OpenStackReachInstance {
  return {
    id: `${index.toString(16).padStart(8, "0")}-ba74-40ba-a354-7ead413c5df6`,
    name: `web-${index}`,
    projectId: PAYMENTS,
    projectName: "ou-payments",
    host: "compute-01",
    status: "ACTIVE",
    ...overrides,
  };
}

function evacuation(
  overrides: Partial<Parameters<typeof buildOpenStackChangeReach>[0]> = {},
): OpenStackChangeReach {
  return buildOpenStackChangeReach({
    route: "server evacuate",
    kind: "changes",
    instances: [
      instance(1),
      instance(2, { projectId: RESEARCH, projectName: "ou-research" }),
    ],
    hosts: [
      {
        name: "compute-01",
        state: "down",
        status: "enabled",
        forcedDown: false,
        disabledReason: null,
      },
    ],
    projectNames: new Map<string, string>([
      [PAYMENTS, "ou-payments"],
      [RESEARCH, "ou-research"],
    ]),
    leftBehind: [],
    isComplete: true,
    problems: [],
    wouldBeRefused: null,
    ...overrides,
  });
}

describe("what a person reads before approving a change", () => {
  afterEach(() => {
    cleanup();
  });

  test("the counts, the projects with how many of each, and each instance", () => {
    render(<OpenStackReachNote reach={evacuation()} />);

    expect(screen.getByTestId("remediation-openstack-reach")).toHaveTextContent(
      "Instances it changes: 2. Projects they belong to: 2.",
    );

    const projects: HTMLElement = screen.getByTestId(
      "remediation-openstack-reach-projects",
    );

    expect(projects).toHaveTextContent("ou-payments (1)");
    expect(projects).toHaveTextContent("ou-research (1)");

    const instances: HTMLElement = screen.getByTestId(
      "remediation-openstack-reach-instances",
    );

    expect(within(instances).getByText("web-1")).toBeInTheDocument();
    expect(within(instances).getByText("web-2")).toBeInTheDocument();
    expect(instances).toHaveTextContent("on compute-01");
  });

  test("one instance in one project reads right", () => {
    render(
      <OpenStackReachNote reach={evacuation({ instances: [instance(1)] })} />,
    );

    expect(screen.getByTestId("remediation-openstack-reach")).toHaveTextContent(
      "Instances it changes: 1. Projects they belong to: 1.",
    );
  });

  test("what state the host is in, and a state nobody could read says so", () => {
    render(
      <OpenStackReachNote
        reach={evacuation({
          hosts: [
            {
              name: "compute-01",
              state: "down",
              status: "enabled",
              forcedDown: false,
              disabledReason: null,
            },
            {
              name: "compute-02",
              state: null,
              status: null,
              forcedDown: null,
              disabledReason: null,
            },
          ],
        })}
      />,
    );

    const hosts: Array<HTMLElement> = screen.getAllByTestId(
      "remediation-openstack-reach-host",
    );

    expect(hosts[0]).toHaveTextContent(
      "nova-compute on compute-01: down, enabled",
    );
    expect(hosts[1]).toHaveTextContent(
      "nova-compute on compute-02: not read, not read",
    );
  });

  test("what it leaves behind on that host", () => {
    render(
      <OpenStackReachNote
        reach={evacuation({
          leftBehind: [instance(7), instance(8), instance(9)],
        })}
      />,
    );

    expect(
      screen.getByTestId("remediation-openstack-reach-left-behind"),
    ).toHaveTextContent("This leaves 3 more on that host");
  });

  test("what it could not read in full says at least, and what stopped it", () => {
    render(
      <OpenStackReachNote
        reach={evacuation({
          isComplete: false,
          problems: ["Nova did not answer for one of them."],
        })}
      />,
    );

    const note: HTMLElement = screen.getByTestId("remediation-openstack-reach");

    expect(note).toHaveTextContent(
      "Instances it changes: at least 2. Projects they belong to: at least 2.",
    );
    expect(note).toHaveTextContent("Nova did not answer for one of them.");
  });

  test("a change that moves no instance says so, and what the host holds", () => {
    render(
      <OpenStackReachNote
        reach={evacuation({ route: "compute service set", kind: "on-host" })}
      />,
    );

    expect(screen.getByTestId("remediation-openstack-reach")).toHaveTextContent(
      "It changes no instance. Instances on the host: 2.",
    );
    expect(
      screen.queryByTestId("remediation-openstack-reach-instances"),
    ).toBeNull();
  });

  test("past ten, the rest fold behind a count, and none is lost", () => {
    const instances: Array<OpenStackReachInstance> = Array.from(
      { length: 14 },
      (_value: unknown, index: number): OpenStackReachInstance => {
        return instance(index + 1);
      },
    );

    render(<OpenStackReachNote reach={evacuation({ instances })} />);

    const list: HTMLElement = screen.getByTestId(
      "remediation-openstack-reach-instances",
    );

    expect(list).toHaveTextContent("4 more");

    for (const row of instances) {
      expect(within(list).getByText(row.name as string)).toBeInTheDocument();
    }
  });

  test("a name a tenant chose is shown as text, whatever it says", () => {
    render(
      <OpenStackReachNote
        reach={evacuation({
          instances: [instance(1, { name: "<img src=x onerror=alert(1)>" })],
        })}
      />,
    );

    expect(
      screen.getByText("<img src=x onerror=alert(1)>"),
    ).toBeInTheDocument();
    expect(document.querySelector("img[src='x']")).toBeNull();
  });
});
