import { afterEach, describe, expect, jest, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentStatusPageScope from "../../../../Server/Utils/StatusPage/IncidentStatusPageScope";
import ObjectID from "../../../../Types/ObjectID";
import {
  OPENSTACK_REACH_HEADING,
  removeOpenStackReachFromDescription,
} from "../../../../Types/OpenStack/OpenStackBlastRadius";

/*
 * WHAT A FAILURE REACHES IS NEVER SHOWN OUTSIDE THE TEAM.
 *
 * An incident's description names every project on a host, for whoever is working on it. A status page and
 * its subscribers read that column too, and one customer's name on another's page is the failure this is
 * here to stop. Every public read of incidents comes through IncidentStatusPageScope, and each subscriber
 * job takes it out where it reads the row.
 */
const REPO: string = path.join(__dirname, "..", "..", "..", "..", "..", "..");
const DESCRIPTION: string = `An enabled nova-compute has stopped reporting.\n\n${OPENSTACK_REACH_HEADING}\n\n**What this affects:** 3 instances in 2 projects.\n\n- ou-payments: 2 instances\n- ou-research: 1 instance`;

describe("what a status page reads of an incident", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function reads(description: string | undefined): void {
    const incident: Incident = new Incident();
    incident._id = ObjectID.generate().toString();
    incident.description = description as string;
    jest.spyOn(IncidentService, "findBy").mockResolvedValue([incident]);
  }

  test("keeps what the template said and none of who it reaches", async () => {
    reads(DESCRIPTION);

    const shown: Array<Incident> =
      await IncidentStatusPageScope.findIncidentsForStatusPage({
        statusPage: {
          _id: ObjectID.generate().toString(),
          onlyShowScopedIncidents: false,
        },
        query: {},
        select: { description: true },
        limit: 10,
        props: { isRoot: true },
      });

    expect(shown[0]!.description).toBe(
      "An enabled nova-compute has stopped reporting.",
    );
    expect(JSON.stringify(shown)).not.toContain("ou-payments");
    expect(JSON.stringify(shown)).not.toContain("ou-research");
  });

  test("an incident with no description reads as it did", async () => {
    reads(undefined);

    const shown: Array<Incident> =
      await IncidentStatusPageScope.findIncidentsForStatusPage({
        statusPage: {
          _id: ObjectID.generate().toString(),
          onlyShowScopedIncidents: false,
        },
        query: {},
        select: { title: true },
        limit: 10,
        props: { isRoot: true },
      });

    expect(shown[0]!.description).toBeUndefined();
  });

  test("what isn't OpenStack's reads exactly as it was written", () => {
    expect(removeOpenStackReachFromDescription("**Bold** and\n\n- a list")).toBe(
      "**Bold** and\n\n- a list",
    );
  });
});

describe("what a status page's subscribers are sent", () => {
  /*
   * The jobs build their messages from the row they read, in many places, so they take it out once, where
   * they read it: read from the source, because a new read of a description without it is what this is
   * here to catch.
   */
  test.each([
    "packages/App/FeatureSet/Workers/Jobs/Incident/SendNotificationToSubscribers.ts",
    "packages/App/FeatureSet/Workers/Jobs/IncidentStateTimeline/SendNotificationToSubscribers.ts",
  ])("%s takes it out before anything is built", (file: string) => {
    const source: string = fs.readFileSync(path.join(REPO, file), "utf8");

    expect(source).toContain(
      "incident.description = removeOpenStackReachFromDescription(",
    );
  });

  test("and so does the email builder they share, and its preview", () => {
    const source: string = fs.readFileSync(
      path.join(
        REPO,
        "packages/Common/Server/Utils/StatusPage/SubscriberIncidentEmailBuilder.ts",
      ),
      "utf8",
    );

    expect(source).toContain("removeOpenStackReachFromDescription(");
  });
});
