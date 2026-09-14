import { describe, expect, jest, test } from "@jest/globals";

/*
 * UserService drags in DatabaseService and, through it, PasswordHash - which
 * carries a pre-existing TS5.9 diagnostic that fails any suite whose require
 * graph reaches it. Nothing here needs the real lookup: the only thing under
 * test is which of the two "who created this" sentences gets chosen, and the
 * user's name is an input to that, not part of it.
 */
jest.mock("../../../../Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      getUserMarkdownString: (): Promise<string> => {
        return Promise.resolve("Jane Doe (jane@example.com)");
      },
    },
  };
});

import ResourceFeedUtil, {
  MEANINGFUL_UPDATE_COLUMNS,
  ResourceFeedMarkdown,
} from "../../../../Server/Utils/ResourceFeed/ResourceFeedUtil";
import ObjectID from "../../../../Types/ObjectID";

const PROJECT_ID: ObjectID = ObjectID.generate();
const USER_ID: ObjectID = ObjectID.generate();

describe("ResourceFeedUtil.getUpdatedColumnsWorthRecording", () => {
  test("ignores the columns ingest writes on every heartbeat", () => {
    /*
     * This is the whole reason the filter exists. A Kubernetes cluster, a
     * Docker host and a server each get a liveness write roughly once a
     * minute, forever. If any of these counted as a change, the feed would be
     * unreadable within an hour of installing the agent.
     */
    expect(
      ResourceFeedUtil.getUpdatedColumnsWorthRecording({
        lastSeenAt: new Date().toISOString(),
        otelCollectorStatus: "connected",
        agentVersion: "1.2.3",
        nodeCount: 12,
        podCount: 340,
        containersRunning: 8,
      }),
    ).toEqual([]);
  });

  test("keeps the columns a person would recognise as an edit", () => {
    expect(
      ResourceFeedUtil.getUpdatedColumnsWorthRecording({
        name: "prod-us-east",
        description: "Primary production cluster",
        lastSeenAt: new Date().toISOString(),
      }),
    ).toEqual(["name", "description"]);
  });

  test("a heartbeat that also renames the resource still records the rename", () => {
    expect(
      ResourceFeedUtil.getUpdatedColumnsWorthRecording({
        lastSeenAt: new Date().toISOString(),
        isArchived: true,
      }),
    ).toEqual(["isArchived"]);
  });

  test("an absent payload is not a change", () => {
    expect(ResourceFeedUtil.getUpdatedColumnsWorthRecording(undefined)).toEqual(
      [],
    );
    expect(ResourceFeedUtil.getUpdatedColumnsWorthRecording({})).toEqual([]);
  });

  test("the whitelist covers every column the dashboard can edit", () => {
    for (const column of [
      "name",
      "description",
      "labels",
      "isArchived",
      "retainTelemetryDataForDays",
      "telemetryRetentionConfig",
    ]) {
      expect(MEANINGFUL_UPDATE_COLUMNS).toContain(column);
    }
  });
});

describe("ResourceFeedUtil.isArchiveChange", () => {
  test("archiving and restoring are both archive changes", () => {
    expect(ResourceFeedUtil.isArchiveChange({ isArchived: true })).toBe(true);

    /*
     * Restoring sets isArchived to false. A truthiness check here would treat
     * a restore as an ordinary edit and never post the restore event.
     */
    expect(ResourceFeedUtil.isArchiveChange({ isArchived: false })).toBe(true);
  });

  test("an edit that leaves isArchived alone is not one", () => {
    expect(ResourceFeedUtil.isArchiveChange({ name: "new name" })).toBe(false);
    expect(ResourceFeedUtil.isArchiveChange(undefined)).toBe(false);
  });
});

describe("ResourceFeedUtil.getCreatedFeedMarkdown", () => {
  test("says who created it when a user did", async () => {
    const markdown: ResourceFeedMarkdown =
      await ResourceFeedUtil.getCreatedFeedMarkdown({
        resourceTypeName: "Kubernetes cluster",
        resourceMarkdownLink: "[Kubernetes Cluster prod](https://example.com)",
        projectId: PROJECT_ID,
        createdByUserId: USER_ID,
        identifierName: "Cluster identifier",
        identifierValue: "prod-us-east",
        description: "Primary production cluster",
      });

    expect(markdown.feedInfoInMarkdown).toContain(
      "[Kubernetes Cluster prod](https://example.com)",
    );
    expect(markdown.feedInfoInMarkdown).toContain("Jane Doe");
    expect(markdown.moreInformationInMarkdown).toContain(
      "**Automatically created from telemetry**: No.",
    );
    expect(markdown.moreInformationInMarkdown).toContain("Jane Doe");
    expect(markdown.moreInformationInMarkdown).toContain("`prod-us-east`");
    expect(markdown.moreInformationInMarkdown).toContain(
      "Primary production cluster",
    );
  });

  test("says telemetry created it when no user did", async () => {
    /*
     * Ingest creates these rows with root props and no acting user, which is
     * the entire signal. Getting this branch wrong would attribute an
     * auto-discovered cluster to nobody at all rather than explaining itself -
     * the exact question the feed page exists to answer.
     */
    const markdown: ResourceFeedMarkdown =
      await ResourceFeedUtil.getCreatedFeedMarkdown({
        resourceTypeName: "Docker host",
        resourceMarkdownLink: "[Docker Host node-1](https://example.com)",
        projectId: PROJECT_ID,
        createdByUserId: undefined,
        identifierName: "Host identifier",
        identifierValue: "node-1",
      });

    expect(markdown.feedInfoInMarkdown).toContain("automatically");
    expect(markdown.feedInfoInMarkdown).toContain(
      "[Docker Host node-1](https://example.com)",
    );
    expect(markdown.moreInformationInMarkdown).toContain(
      "**Automatically created from telemetry**: Yes.",
    );
    expect(markdown.moreInformationInMarkdown).toContain("No user.");
    expect(markdown.moreInformationInMarkdown).toContain("`node-1`");
  });

  test("omits the identifier and description lines when there are none", async () => {
    const markdown: ResourceFeedMarkdown =
      await ResourceFeedUtil.getCreatedFeedMarkdown({
        resourceTypeName: "Ceph cluster",
        resourceMarkdownLink: "[Ceph Cluster ceph-1](https://example.com)",
        projectId: PROJECT_ID,
      });

    expect(markdown.moreInformationInMarkdown).not.toContain("**Description**");
    expect(markdown.moreInformationInMarkdown).toContain(
      "**Automatically created from telemetry**: Yes.",
    );
  });
});

describe("ResourceFeedUtil.getUpdatedFeedMarkdown", () => {
  test("names the fields that changed", () => {
    const markdown: ResourceFeedMarkdown =
      ResourceFeedUtil.getUpdatedFeedMarkdown({
        resourceMarkdownLink: "[Host web-1](https://example.com)",
        columns: ["name", "labels"],
      });

    expect(markdown.feedInfoInMarkdown).toContain(
      "[Host web-1](https://example.com)",
    );
    expect(markdown.moreInformationInMarkdown).toContain("`name`");
    expect(markdown.moreInformationInMarkdown).toContain("`labels`");
  });
});
