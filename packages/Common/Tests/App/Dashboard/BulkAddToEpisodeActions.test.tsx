import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { FunctionComponent, ReactElement } from "react";
import { MockFunction } from "../../MockType";

/*
 * "Add to Existing Episode" and "Add to New Episode" on the alerts and
 * incidents lists (useBulkAddToEpisodeActions). What is pinned here is what
 * a person would notice going wrong:
 *
 *   - gating: a viewer sees both actions locked, saying which permission is
 *     missing; a member can use them; a new episode also needs episode
 *     create;
 *   - the cap: above MAX_EPISODE_MEMBERS_PER_ADD both stay on the menu,
 *     locked, saying why;
 *   - one request for the whole selection, each row reading its own
 *     outcome: added, in the episode already (left as it was), or not added
 *     and why - and the result links to the episode;
 *   - a new episode is one create carrying every selected id.
 *
 * The two dialogs are stubbed to capture their props: the contract is what
 * they are handed and what their callbacks do. EpisodeMemberDialogs.test.tsx
 * covers the dialogs themselves.
 */

interface CapturedExistingProps {
  recordIds: Array<string>;
  onClose: () => void;
  onPick: (episode: Record<string, unknown>) => void;
  onCreateNewEpisodeInstead?: (() => void) | undefined;
}

interface CapturedNewProps {
  recordIds: Array<string>;
  onClose: () => void;
  onCreate: (values: { title: string; severityId: string | undefined }) => void;
}

let existingDialog: CapturedExistingProps | null = null;
let newDialog: CapturedNewProps | null = null;

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/EpisodeMembers/AddToExistingEpisodeModal",
  () => {
    return {
      __esModule: true,
      default: (props: CapturedExistingProps): React.ReactElement => {
        existingDialog = props;
        return <div data-testid="existing-dialog" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/EpisodeMembers/AddToNewEpisodeModal",
  () => {
    return {
      __esModule: true,
      default: (props: CapturedNewProps): React.ReactElement => {
        newDialog = props;
        return <div data-testid="new-dialog" />;
      },
    };
  },
);

import useBulkAddToEpisodeActions, {
  ADD_TO_EXISTING_EPISODE_ACTION_TITLE,
  ADD_TO_NEW_EPISODE_ACTION_TITLE,
  BulkAddToEpisodeActionsResult,
  EPISODE_MEMBERS_ADD_REASON_KEYS,
  getItemOutcome,
  getSelectedIds,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EpisodeMembers/BulkAddToEpisodeActions";
import {
  ALERT_EPISODE_MEMBER_KIND,
  EpisodeMemberKindConfig,
  INCIDENT_EPISODE_MEMBER_KIND,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EpisodeMembers/EpisodeMemberKinds";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import {
  BULK_ITEM_CHANGED,
  bulkItemUnchanged,
} from "../../../UI/Components/BulkUpdate/BulkActionRunner";
import {
  BulkActionButtonSchema,
  BulkActionFailed,
  BulkActionOnClickProps,
  BulkActionUnchanged,
  ProgressInfo,
} from "../../../UI/Components/BulkUpdate/BulkUpdateForm";
import Alert from "../../../Models/DatabaseModels/Alert";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import {
  ALERT_NOT_FOUND_REASON,
  ALREADY_IN_EPISODE_REASON,
  EpisodeMembersAddResult,
  INCIDENT_NOT_FOUND_REASON,
  MAX_EPISODE_MEMBERS_PER_ADD,
} from "../../../Types/Episode/EpisodeMembersAdd";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import UserUtil from "../../../UI/Utils/User";

const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const EPISODE_ID: string = "e1000000-0000-4000-8000-000000000012";

type IdFunction = (index: number) => string;

const id: IdFunction = (index: number): string => {
  return `a1000000-0000-4000-8000-${index.toString().padStart(12, "0")}`;
};

type MakeAlertsFunction = (count: number) => Array<Alert>;

const makeAlerts: MakeAlertsFunction = (count: number): Array<Alert> => {
  return Array.from({ length: count }, (_value: unknown, index: number) => {
    const alert: Alert = new Alert();
    alert._id = id(index + 1);
    alert.title = `Alert ${index + 1}`;
    return alert;
  });
};

let permissionsForTest: Array<Permission> = [];
let currentResult: BulkAddToEpisodeActionsResult<Alert> | null = null;

const Harness: FunctionComponent<{
  config: EpisodeMemberKindConfig;
}> = (props: { config: EpisodeMemberKindConfig }): ReactElement => {
  const result: BulkAddToEpisodeActionsResult<Alert> =
    useBulkAddToEpisodeActions<Alert>(props.config);
  currentResult = result;
  return <div>{result.modals}</div>;
};

function renderHarness(
  config: EpisodeMemberKindConfig = ALERT_EPISODE_MEMBER_KIND,
): void {
  render(<Harness config={config} />);
}

function actions(): Array<BulkActionButtonSchema<Alert>> {
  if (!currentResult) {
    throw new Error("The hook has not rendered.");
  }
  return currentResult.bulkActions;
}

// What the action bar shows for a selection: the actions isVisible accepts.
function visibleAction(
  title: string,
  items: Array<Alert>,
): BulkActionButtonSchema<Alert> {
  const visible: Array<BulkActionButtonSchema<Alert>> = actions().filter(
    (action: BulkActionButtonSchema<Alert>): boolean => {
      return (
        action.title === title &&
        (!action.isVisible || action.isVisible(items) !== false)
      );
    },
  );

  expect(visible).toHaveLength(1);
  return visible[0]!;
}

interface RunOutcome {
  changed: Array<string>;
  unchanged: Array<string>;
  failed: Array<string>;
  ended: boolean;
}

let outcome: RunOutcome;

function actionProps(items: Array<Alert>): BulkActionOnClickProps<Alert> {
  return {
    items: items,
    onProgressInfo: (info: ProgressInfo<Alert>): void => {
      outcome.changed = info.successItems.map((item: Alert): string => {
        return item.title || "";
      });
      outcome.unchanged = (info.unchanged || []).map(
        (entry: BulkActionUnchanged<Alert>): string => {
          return `${entry.item.title}: ${entry.reason}`;
        },
      );
      outcome.failed = info.failed.map(
        (entry: BulkActionFailed<Alert>): string => {
          return `${entry.item.title}: ${entry.failedMessage}`;
        },
      );
    },
    onBulkActionStart: (): void => {},
    onBulkActionEnd: (): void => {
      outcome.ended = true;
    },
  };
}

/*
 * zone.js reschedules the microtask React's act() uses to check that its
 * thenable was awaited; hooking then() up synchronously answers that check
 * in time (as BulkIncidentLinkActions.test.tsx does).
 */
function actAsync(body: () => Promise<void>): Promise<void> {
  const scope: PromiseLike<void> = act(body) as unknown as PromiseLike<void>;

  return new Promise<void>(
    (resolve: () => void, reject: (reason: unknown) => void): void => {
      scope.then(resolve, reject);
    },
  );
}

async function click(title: string, items: Array<Alert>): Promise<void> {
  await actAsync(async () => {
    await visibleAction(title, items).onClick(actionProps(items));
  });
}

// Waits for the run the dialog started to end.
async function settle(): Promise<void> {
  for (let i: number = 0; i < 20 && !outcome.ended; i++) {
    await actAsync(async () => {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    });
  }
}

let postSpy: MockFunction;
let createSpy: MockFunction;

describe("useBulkAddToEpisodeActions", () => {
  beforeEach(() => {
    existingDialog = null;
    newDialog = null;
    currentResult = null;
    outcome = { changed: [], unchanged: [], failed: [], ended: false };
    permissionsForTest = [Permission.ProjectMember];
    PermissionGate.clearPermissionPropsCache();

    jest.spyOn(PermissionUtil, "getAllPermissions").mockImplementation(() => {
      return permissionsForTest;
    });
    jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(false);
    jest
      .spyOn(ProjectUtil, "getCurrentProjectId")
      .mockReturnValue(new ObjectID(PROJECT_ID));
    jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});

    postSpy = jest.spyOn(API, "post") as unknown as MockFunction;
    createSpy = jest.spyOn(ModelAPI, "create") as unknown as MockFunction;
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  describe("who may use them", () => {
    test("a project member may use both", () => {
      renderHarness();
      const items: Array<Alert> = makeAlerts(2);

      expect(
        visibleAction(ADD_TO_EXISTING_EPISODE_ACTION_TITLE, items).disabled,
      ).toBeFalsy();
      expect(
        visibleAction(ADD_TO_NEW_EPISODE_ACTION_TITLE, items).disabled,
      ).toBeFalsy();
    });

    test("a viewer sees both locked, saying which permission is missing", () => {
      permissionsForTest = [Permission.Viewer];
      renderHarness();
      const items: Array<Alert> = makeAlerts(2);

      const existing: BulkActionButtonSchema<Alert> = visibleAction(
        ADD_TO_EXISTING_EPISODE_ACTION_TITLE,
        items,
      );
      const created: BulkActionButtonSchema<Alert> = visibleAction(
        ADD_TO_NEW_EPISODE_ACTION_TITLE,
        items,
      );

      expect(existing.disabled).toBe(true);
      expect(existing.tooltip).toContain(
        "You do not have permission to create this Alert Episode Member.",
      );
      expect(created.disabled).toBe(true);
      expect(created.tooltip).toContain(
        "You do not have permission to create this Alert Episode.",
      );
    });

    test("someone who may add to episodes but not create one may only add to an existing one", () => {
      permissionsForTest = [Permission.CreateAlertEpisodeMember];
      renderHarness();
      const items: Array<Alert> = makeAlerts(1);

      expect(
        visibleAction(ADD_TO_NEW_EPISODE_ACTION_TITLE, items).tooltip,
      ).toContain("You do not have permission to create this Alert Episode.");
    });

    test("incidents are gated on the incident episode models", () => {
      permissionsForTest = [Permission.Viewer];
      renderHarness(INCIDENT_EPISODE_MEMBER_KIND);
      const items: Array<Alert> = makeAlerts(1);

      expect(
        visibleAction(ADD_TO_EXISTING_EPISODE_ACTION_TITLE, items).tooltip,
      ).toContain(
        "You do not have permission to create this Incident Episode Member.",
      );
    });

    test("both stay on the menu, in this order, when locked", () => {
      permissionsForTest = [Permission.Viewer];
      renderHarness();

      expect(
        actions().map((action: BulkActionButtonSchema<Alert>): string => {
          return action.title;
        }),
      ).toEqual([
        ADD_TO_EXISTING_EPISODE_ACTION_TITLE,
        ADD_TO_NEW_EPISODE_ACTION_TITLE,
      ]);
    });
  });

  describe("the cap", () => {
    test("up to the cap both work; above it both are locked, saying why", () => {
      renderHarness();

      const atCap: Array<Alert> = makeAlerts(MAX_EPISODE_MEMBERS_PER_ADD);
      const overCap: Array<Alert> = makeAlerts(MAX_EPISODE_MEMBERS_PER_ADD + 1);

      for (const title of [
        ADD_TO_EXISTING_EPISODE_ACTION_TITLE,
        ADD_TO_NEW_EPISODE_ACTION_TITLE,
      ]) {
        expect(visibleAction(title, atCap).disabled).toBeFalsy();

        const locked: BulkActionButtonSchema<Alert> = visibleAction(
          title,
          overCap,
        );
        expect(locked.disabled).toBe(true);
        expect(locked.tooltip).toBe(
          "Select 100 or fewer to add them to an episode.",
        );
      }
    });
  });

  describe("adding to an existing episode", () => {
    test("opens the episode picker with the selection, each id once", async () => {
      renderHarness();
      const items: Array<Alert> = makeAlerts(2);

      await click(ADD_TO_EXISTING_EPISODE_ACTION_TITLE, [...items, items[0]!]);

      expect(screen.getByTestId("existing-dialog")).toBeInTheDocument();
      expect(existingDialog!.recordIds).toEqual([id(1), id(2)]);
      // A member may create one, so "Add to New Episode" is offered there.
      expect(existingDialog!.onCreateNewEpisodeInstead).toBeDefined();
    });

    test("is one request, and each row reads its own outcome from it", async () => {
      postSpy.mockResolvedValue(
        new HTTPResponse(
          200,
          {
            added: [id(1), id(3)],
            alreadyInEpisode: [id(2)],
            notAdded: [{ id: id(4), reason: ALERT_NOT_FOUND_REASON }],
          },
          {},
        ) as never,
      );

      renderHarness();
      const items: Array<Alert> = makeAlerts(4);

      await click(ADD_TO_EXISTING_EPISODE_ACTION_TITLE, items);
      await actAsync(async () => {
        existingDialog!.onPick({ id: EPISODE_ID, number: "AE-12" });
      });
      await settle();

      expect(postSpy).toHaveBeenCalledTimes(1);
      expect((postSpy.mock.calls[0]![0] as { data: unknown }).data).toEqual({
        alertEpisodeId: EPISODE_ID,
        alertIds: [id(1), id(2), id(3), id(4)],
      });

      expect(outcome).toEqual({
        changed: ["Alert 1", "Alert 3"],
        unchanged: [`Alert 2: ${ALREADY_IN_EPISODE_REASON}`],
        failed: [`Alert 4: ${ALERT_NOT_FOUND_REASON}`],
        ended: true,
      });

      // The dialog closed; the result links to the episode.
      expect(screen.queryByTestId("existing-dialog")).not.toBeInTheDocument();
    });

    test("the result links to the episode it added to", async () => {
      postSpy.mockResolvedValue(
        new HTTPResponse(
          200,
          { added: [id(1)], alreadyInEpisode: [], notAdded: [] },
          {},
        ) as never,
      );

      renderHarness();
      const items: Array<Alert> = makeAlerts(1);

      await click(ADD_TO_EXISTING_EPISODE_ACTION_TITLE, items);
      await actAsync(async () => {
        existingDialog!.onPick({ id: EPISODE_ID, number: "AE-12" });
      });
      await settle();

      const details: ReactElement | undefined = visibleAction(
        ADD_TO_EXISTING_EPISODE_ACTION_TITLE,
        items,
      ).resultDetails?.() as ReactElement | undefined;

      render(<div data-testid="details">{details}</div>);

      const link: HTMLElement = screen.getByRole("link", {
        name: /Open episode AE-12/,
      });
      const route: Route = RouteUtil.populateRouteParams(
        RouteMap[PageMap.ALERT_EPISODE_VIEW] as Route,
        { modelId: new ObjectID(EPISODE_ID) },
      );
      expect(link.getAttribute("href")).toBe(route.toString());
    });

    test("a refused request fails every row, with the server's words", async () => {
      postSpy.mockResolvedValue(
        new HTTPErrorResponse(
          400,
          {
            message:
              "The episode to add the alerts to does not exist in this project, or you do not have access to it.",
          },
          {},
        ) as never,
      );

      renderHarness();
      const items: Array<Alert> = makeAlerts(2);

      await click(ADD_TO_EXISTING_EPISODE_ACTION_TITLE, items);
      await actAsync(async () => {
        existingDialog!.onPick({ id: EPISODE_ID, number: "AE-12" });
      });
      await settle();

      expect(postSpy).toHaveBeenCalledTimes(1);
      expect(outcome.changed).toEqual([]);
      expect(outcome.failed).toEqual([
        "Alert 1: The episode to add the alerts to does not exist in this project, or you do not have access to it.",
        "Alert 2: The episode to add the alerts to does not exist in this project, or you do not have access to it.",
      ]);
    });

    test("closing the picker adds nothing", async () => {
      renderHarness();
      const items: Array<Alert> = makeAlerts(1);

      await click(ADD_TO_EXISTING_EPISODE_ACTION_TITLE, items);
      await actAsync(async () => {
        existingDialog!.onClose();
      });

      expect(screen.queryByTestId("existing-dialog")).not.toBeInTheDocument();
      expect(postSpy).not.toHaveBeenCalled();
    });

    test("with no episode to pick, the picker hands over to Add to New Episode", async () => {
      renderHarness();
      const items: Array<Alert> = makeAlerts(2);

      await click(ADD_TO_EXISTING_EPISODE_ACTION_TITLE, items);
      await actAsync(async () => {
        existingDialog!.onCreateNewEpisodeInstead!();
      });

      expect(screen.queryByTestId("existing-dialog")).not.toBeInTheDocument();
      expect(screen.getByTestId("new-dialog")).toBeInTheDocument();
      expect(newDialog!.recordIds).toEqual([id(1), id(2)]);
    });

    test("someone who may not create an episode is not offered one there", async () => {
      permissionsForTest = [
        Permission.CreateAlertEpisodeMember,
        Permission.ReadAlertEpisode,
      ];
      renderHarness();

      await click(ADD_TO_EXISTING_EPISODE_ACTION_TITLE, makeAlerts(1));

      expect(existingDialog!.onCreateNewEpisodeInstead).toBeUndefined();
    });
  });

  describe("adding to a new episode", () => {
    test("is one create carrying every selected id, and every row is added", async () => {
      createSpy.mockResolvedValue(
        new HTTPResponse(
          200,
          { _id: EPISODE_ID, episodeNumberWithPrefix: "AE-13" },
          {},
        ) as never,
      );

      renderHarness();
      const items: Array<Alert> = makeAlerts(3);

      await click(ADD_TO_NEW_EPISODE_ACTION_TITLE, items);
      expect(newDialog!.recordIds).toEqual([id(1), id(2), id(3)]);

      await actAsync(async () => {
        newDialog!.onCreate({
          title: "Checkout outage",
          severityId: id(50),
        });
      });
      await settle();

      expect(createSpy).toHaveBeenCalledTimes(1);
      const call: Record<string, any> = createSpy.mock.calls[0]![0] as Record<
        string,
        any
      >;
      expect(call["model"].title).toBe("Checkout outage");
      expect(call["model"].alertSeverityId.toString()).toBe(id(50));
      expect(call["miscDataProps"]).toEqual({
        alertIdsToAdd: [id(1), id(2), id(3)],
      });

      expect(outcome.changed).toEqual(["Alert 1", "Alert 2", "Alert 3"]);
      expect(outcome.failed).toEqual([]);

      const details: ReactElement | undefined = visibleAction(
        ADD_TO_NEW_EPISODE_ACTION_TITLE,
        items,
      ).resultDetails?.() as ReactElement | undefined;
      render(<div>{details}</div>);
      expect(
        screen.getByRole("link", { name: /Open episode AE-13/ }),
      ).toBeInTheDocument();
    });

    test("a refused create adds none, and says why for each", async () => {
      createSpy.mockRejectedValue(
        new HTTPErrorResponse(
          400,
          {
            message:
              "Some of the alerts to add to the episode do not exist in this project, or you do not have access to them.",
          },
          {},
        ) as never,
      );

      renderHarness();
      const items: Array<Alert> = makeAlerts(2);

      await click(ADD_TO_NEW_EPISODE_ACTION_TITLE, items);
      await actAsync(async () => {
        newDialog!.onCreate({
          title: "Checkout outage",
          severityId: undefined,
        });
      });
      await settle();

      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(outcome.changed).toEqual([]);
      expect(outcome.failed).toHaveLength(2);
      expect(outcome.failed[0]).toContain(
        "Some of the alerts to add to the episode do not exist",
      );

      // No episode exists, so there is none to open.
      expect(
        visibleAction(ADD_TO_NEW_EPISODE_ACTION_TITLE, items).resultDetails?.(),
      ).toBeUndefined();
    });
  });
});

describe("reading one row's outcome from the answer", () => {
  const result: EpisodeMembersAddResult = {
    added: [id(1)],
    alreadyInEpisode: [id(2)],
    notAdded: [{ id: id(3), reason: "Deleted a moment ago." }],
  };

  test("added, in already, or not added and why - whatever the id's case", () => {
    expect(
      getItemOutcome({
        id: id(1).toUpperCase(),
        result: result,
        config: ALERT_EPISODE_MEMBER_KIND,
      }),
    ).toEqual(BULK_ITEM_CHANGED);
    expect(
      getItemOutcome({
        id: id(2),
        result: result,
        config: ALERT_EPISODE_MEMBER_KIND,
      }),
    ).toEqual(bulkItemUnchanged(ALREADY_IN_EPISODE_REASON));
    expect(() => {
      getItemOutcome({
        id: id(3),
        result: result,
        config: ALERT_EPISODE_MEMBER_KIND,
      });
    }).toThrow("Deleted a moment ago.");
  });

  test("one the answer does not name is not added, in the words a missing one gets", () => {
    expect(() => {
      getItemOutcome({
        id: id(9),
        result: result,
        config: ALERT_EPISODE_MEMBER_KIND,
      });
    }).toThrow(ALERT_NOT_FOUND_REASON);
    expect(() => {
      getItemOutcome({
        id: id(9),
        result: result,
        config: INCIDENT_EPISODE_MEMBER_KIND,
      });
    }).toThrow(INCIDENT_NOT_FOUND_REASON);
  });

  test("the selection's ids, each once, in the order selected", () => {
    const alerts: Array<BaseModel> = makeAlerts(2);
    const noId: Alert = new Alert();

    expect(getSelectedIds([alerts[1]!, alerts[0]!, alerts[1]!, noId])).toEqual([
      id(2),
      id(1),
    ]);
  });

  test("the reasons the dashboard translates are the server's own words", () => {
    expect(EPISODE_MEMBERS_ADD_REASON_KEYS).toEqual([
      ALREADY_IN_EPISODE_REASON,
      ALERT_NOT_FOUND_REASON,
      INCIDENT_NOT_FOUND_REASON,
    ]);
  });
});
