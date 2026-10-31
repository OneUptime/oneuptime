import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it, and DatabaseService - the base class
 * of the service below - imports it.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/Logger");

import CloudAccountFeedService from "../../../Server/Services/CloudAccountFeedService";
import CloudAccountFeed, {
  CloudAccountFeedEventType,
} from "../../../Models/DatabaseModels/CloudAccountFeed";
import { Blue500, Yellow500 } from "../../../Types/BrandColors";
import ObjectID from "../../../Types/ObjectID";

/*
 * How an entry of a cloud account's feed is written: by OneUptime, as
 * root (the table lets nobody else write it), with what it is about, who
 * did it, when, and a colour - and never so that writing it could fail
 * the registration, reset or settings change it describes.
 */

const ACCOUNT_ID: ObjectID = new ObjectID(
  "7c000000-0000-4000-8000-000000000001",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "7c000000-0000-4000-8000-000000000002",
);
const USER_ID: ObjectID = new ObjectID("7c000000-0000-4000-8000-000000000003");

interface CreateCall {
  data: CloudAccountFeed;
  props: Record<string, unknown>;
}

describe("CloudAccountFeedService.createCloudAccountFeedItem", () => {
  let created: Array<CreateCall> = [];

  beforeEach(() => {
    jest.restoreAllMocks();
    created = [];
    jest
      .spyOn(CloudAccountFeedService, "create")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementation((createBy: any): Promise<CloudAccountFeed> => {
        created.push(createBy as CreateCall);
        return Promise.resolve(createBy.data as CloudAccountFeed);
      });
  });

  test("writes the entry as OneUptime, with its account, project, event, colour, words and person", async () => {
    await CloudAccountFeedService.createCloudAccountFeedItem({
      cloudAccountId: ACCOUNT_ID,
      projectId: PROJECT_ID,
      cloudAccountFeedEventType: CloudAccountFeedEventType.CloudAccountUpdated,
      displayColor: Yellow500,
      feedInfoInMarkdown: "Ada changed what OneUptime AI may do",
      moreInformationInMarkdown: "**Changed by**: Ada",
      userId: USER_ID,
    });

    expect(created).toHaveLength(1);
    expect(created[0]!.props).toEqual({ isRoot: true });

    const item: CloudAccountFeed = created[0]!.data;

    expect(item).toBeInstanceOf(CloudAccountFeed);
    expect(item.cloudAccountId).toBe(ACCOUNT_ID);
    expect(item.projectId).toBe(PROJECT_ID);
    expect(item.cloudAccountFeedEventType).toBe(
      CloudAccountFeedEventType.CloudAccountUpdated,
    );
    expect(item.displayColor).toBe(Yellow500);
    expect(item.feedInfoInMarkdown).toBe(
      "Ada changed what OneUptime AI may do",
    );
    expect(item.moreInformationInMarkdown).toBe("**Changed by**: Ada");
    expect(item.userId).toBe(USER_ID);
  });

  test("stamps when it was posted, and keeps a time it is given", async () => {
    await CloudAccountFeedService.createCloudAccountFeedItem({
      cloudAccountId: ACCOUNT_ID,
      projectId: PROJECT_ID,
      cloudAccountFeedEventType: CloudAccountFeedEventType.CloudAccountCreated,
      feedInfoInMarkdown: "found",
    });

    expect(created[0]!.data.postedAt).toBeInstanceOf(Date);

    const postedAt: Date = new Date("2026-10-30T08:00:00.000Z");

    await CloudAccountFeedService.createCloudAccountFeedItem({
      cloudAccountId: ACCOUNT_ID,
      projectId: PROJECT_ID,
      cloudAccountFeedEventType: CloudAccountFeedEventType.CloudAccountCreated,
      feedInfoInMarkdown: "found",
      postedAt,
    });

    expect(created[1]!.data.postedAt).toBe(postedAt);
  });

  test("an entry without a colour is blue, without a person names none, without more words has none", async () => {
    await CloudAccountFeedService.createCloudAccountFeedItem({
      cloudAccountId: ACCOUNT_ID,
      projectId: PROJECT_ID,
      cloudAccountFeedEventType: CloudAccountFeedEventType.CloudAccountUpdated,
      feedInfoInMarkdown: "The Cloud AI agent was reset.",
    });

    const item: CloudAccountFeed = created[0]!.data;

    expect(item.displayColor).toBe(Blue500);
    expect(item.userId).toBeUndefined();
    expect(item.moreInformationInMarkdown).toBeUndefined();
  });

  test.each([
    ["cloudAccountId", { cloudAccountId: undefined }],
    ["projectId", { projectId: undefined }],
    ["feedInfoInMarkdown", { feedInfoInMarkdown: "" }],
    ["cloudAccountFeedEventType", { cloudAccountFeedEventType: undefined }],
  ])(
    "writes nothing, and does not throw, when %s is missing",
    async (_name: string, override: Record<string, unknown>) => {
      await expect(
        CloudAccountFeedService.createCloudAccountFeedItem({
          cloudAccountId: ACCOUNT_ID,
          projectId: PROJECT_ID,
          cloudAccountFeedEventType:
            CloudAccountFeedEventType.CloudAccountUpdated,
          feedInfoInMarkdown: "x",
          ...override,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any),
      ).resolves.toBeUndefined();

      expect(created).toHaveLength(0);
    },
  );

  test("a write that fails is logged and swallowed: the thing it describes already happened", async () => {
    jest
      .spyOn(CloudAccountFeedService, "create")
      .mockImplementation((): Promise<CloudAccountFeed> => {
        return Promise.reject(new Error("postgres is down"));
      });

    await expect(
      CloudAccountFeedService.createCloudAccountFeedItem({
        cloudAccountId: ACCOUNT_ID,
        projectId: PROJECT_ID,
        cloudAccountFeedEventType:
          CloudAccountFeedEventType.CloudAccountUpdated,
        feedInfoInMarkdown: "x",
      }),
    ).resolves.toBeUndefined();
  });
});
