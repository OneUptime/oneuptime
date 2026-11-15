// UX rule: Docs/ux/README.md#names
import { describe, expect, test } from "@jest/globals";
import AllModelTypes from "../../Models/DatabaseModels/Index";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ScheduledMaintenanceFeed from "../../Models/DatabaseModels/ScheduledMaintenanceFeed";
import Permission, {
  PermissionGroup,
  PermissionHelper,
  PermissionProps,
} from "../../Types/Permission";

/*
 * A FEED'S PERMISSIONS ARE CALLED "... FEED", AS THE FEED THEY GUARD IS (OneUptime issue #8451).
 *
 * The maintenance event feed's two permissions were "Create Scheduled Maintenance Log" and
 * "Read Scheduled Maintenance Log", where every other feed's say "Feed" ("Create Incident Feed",
 * "Read Alert Feed", "Read Monitor Feed") and the model they guard is "Scheduled Maintenance
 * Feed". So a search of the permission picker for "feed" found every feed but that one, and the
 * refusal a member got named "Scheduled Maintenance Feed" while the permission that let them in
 * was called a log. Their enum values stay: they are stored in teams', keys' and roles' rows.
 */

type ModelType = new () => BaseModel;

const MODELS: Array<BaseModel> = (AllModelTypes as Array<ModelType>).map(
  (Model: ModelType): BaseModel => {
    return new Model();
  },
);

function propsOf(permission: Permission): PermissionProps {
  const props: PermissionProps | undefined =
    PermissionHelper.getAllPermissionProps().find(
      (candidate: PermissionProps): boolean => {
        return candidate.permission === permission;
      },
    );

  expect(props).toBeDefined();

  return props!;
}

// A permission for a feed's entries: Create, Edit or Read, then the feed's name.
const FEED_PERMISSION: RegExp = /^(Create|Edit|Read)\w+Feed$/;

/*
 * The feed models: the ones whose create or read list names a feed permission of their own
 * (IncidentFeed: Permission.CreateIncidentFeed and Permission.ReadIncidentFeed).
 */
const FEED_MODELS: Array<BaseModel> = MODELS.filter(
  (model: BaseModel): boolean => {
    return [
      ...(model.createRecordPermissions || []),
      ...(model.readRecordPermissions || []),
    ].some((permission: Permission): boolean => {
      return FEED_PERMISSION.test(permission);
    });
  },
);

describe("a feed's permissions are named after the feed", () => {
  test("there are feeds to read, the maintenance event feed among them", () => {
    expect(FEED_MODELS.length).toBeGreaterThan(10);
    expect(
      FEED_MODELS.some((model: BaseModel): boolean => {
        return model instanceof ScheduledMaintenanceFeed;
      }),
    ).toBe(true);
  });

  test("every feed permission a feed model checks is titled '... Feed'", () => {
    const misnamed: Array<string> = [];

    for (const model of FEED_MODELS) {
      for (const permission of [
        ...(model.createRecordPermissions || []),
        ...(model.readRecordPermissions || []),
      ]) {
        if (!FEED_PERMISSION.test(permission)) {
          continue;
        }

        const title: string = propsOf(permission).title;

        if (!title.endsWith(" Feed")) {
          misnamed.push(`${model.tableName}: ${permission} is "${title}"`);
        }
      }
    }

    expect(misnamed).toEqual([]);
  });

  test("every Create, Edit or Read ... Feed permission, offered or retired, is titled '... Feed'", () => {
    const misnamed: Array<string> = PermissionHelper.getAllPermissionProps()
      .filter((props: PermissionProps): boolean => {
        return FEED_PERMISSION.test(props.permission);
      })
      .filter((props: PermissionProps): boolean => {
        return !props.title.endsWith(" Feed");
      })
      .map((props: PermissionProps): string => {
        return `${props.permission}: "${props.title}"`;
      });

    expect(misnamed).toEqual([]);
  });

  test("no permission is called a log of a scheduled maintenance any more", () => {
    for (const props of PermissionHelper.getAllPermissionProps()) {
      expect({
        permission: props.permission,
        title: props.title,
      }).not.toEqual({
        permission: props.permission,
        title: expect.stringMatching(/Scheduled Maintenance Log/),
      });
      // The typo the old description had.
      expect(props.description).not.toMatch(/\ban scheduled\b/i);
    }
  });
});

describe("the maintenance event feed's permissions", () => {
  const FEED: ScheduledMaintenanceFeed = new ScheduledMaintenanceFeed();

  test.each([
    [Permission.CreateScheduledMaintenanceFeed, "Create"],
    [Permission.ReadScheduledMaintenanceFeed, "Read"],
    [Permission.EditScheduledMaintenanceFeed, "Edit"],
  ])(
    "%s is titled after the model it guards, as a refusal names it",
    (permission: Permission, verb: string) => {
      expect(FEED.singularName).toBe("Scheduled Maintenance Feed");
      expect(propsOf(permission).title).toBe(`${verb} ${FEED.singularName}`);
      expect(propsOf(permission).group).toBe(
        PermissionGroup.ScheduledMaintenance,
      );
    },
  );

  test("the enum values are the ones stored in teams', keys' and roles' rows", () => {
    expect(Permission.CreateScheduledMaintenanceFeed).toBe(
      "CreateScheduledMaintenanceFeed",
    );
    expect(Permission.ReadScheduledMaintenanceFeed).toBe(
      "ReadScheduledMaintenanceFeed",
    );
    expect(Permission.EditScheduledMaintenanceFeed).toBe(
      "EditScheduledMaintenanceFeed",
    );
  });

  test("the model checks the two that are offered, and the retired one grants nothing", () => {
    expect(FEED.createRecordPermissions).toContain(
      Permission.CreateScheduledMaintenanceFeed,
    );
    expect(FEED.readRecordPermissions).toContain(
      Permission.ReadScheduledMaintenanceFeed,
    );
    expect(FEED.updateRecordPermissions || []).toEqual([]);

    expect(propsOf(Permission.CreateScheduledMaintenanceFeed)).toMatchObject({
      isAssignableToTenant: true,
    });
    expect(propsOf(Permission.ReadScheduledMaintenanceFeed)).toMatchObject({
      isAssignableToTenant: true,
    });
    expect(propsOf(Permission.EditScheduledMaintenanceFeed)).toMatchObject({
      isAssignableToTenant: false,
      description: expect.stringMatching(/^Grants nothing:/),
    });
  });

  test.each([
    Permission.CreateScheduledMaintenanceFeed,
    Permission.ReadScheduledMaintenanceFeed,
  ])(
    "%s says what it reaches in the glossary's words, and keeps the old name findable",
    (permission: Permission) => {
      const description: string = propsOf(permission).description;

      expect(description).toContain("the feed of a maintenance event");
      // The picker's search reads descriptions: "log" and the old title still find it.
      expect(description.toLowerCase()).toContain("log");
      expect(description).toContain("Scheduled Maintenance Log");
      // The glossary's retired name is never said.
      expect(description).not.toMatch(/Scheduled Maintenance Event/);
    },
  );
});
