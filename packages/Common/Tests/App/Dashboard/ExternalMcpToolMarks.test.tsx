import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import ExternalMcpServerToolList from "../../../../App/FeatureSet/Dashboard/src/Components/ExternalMcpServer/ExternalMcpServerToolList";
import ExternalMcpServerToolsCard from "../../../../App/FeatureSet/Dashboard/src/Components/ExternalMcpServer/ExternalMcpServerToolsCard";
import MarkExternalMcpToolModal from "../../../../App/FeatureSet/Dashboard/src/Components/ExternalMcpServer/MarkExternalMcpToolModal";
import {
  EXTERNAL_MCP_TOOL_MARK_COPY,
  EXTERNAL_MCP_TOOL_MARK_REFUSALS,
  getExternalMcpToolMarkRefusalSentence,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ExternalMcpServer/ExternalMcpServerCopy";
import {
  ExternalMcpToolRow,
  EXTERNAL_MCP_TOOL_MARK_SELECT,
  countExternalMcpToolsServerMarksAsChange,
  countExternalMcpToolsToMark,
  getExternalMcpToolMarkGate,
  getExternalMcpToolRows,
  markExternalMcpToolReadOnly,
  readExternalMcpToolMarks,
  removeExternalMcpToolMark,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ExternalMcpServer/ExternalMcpToolMarks";
import ExternalMcpServer from "../../../Models/DatabaseModels/ExternalMcpServer";
import ExternalMcpToolReadOnlyMark from "../../../Models/DatabaseModels/ExternalMcpToolReadOnlyMark";
import UserModel from "../../../Models/DatabaseModels/User";
import ExternalMcpServerTransport from "../../../Types/AI/ExternalMcpServer/ExternalMcpServerTransport";
import { ExternalMcpServerTool } from "../../../Types/AI/ExternalMcpServer/ExternalMcpServerTool";
import {
  ExternalMcpToolMarkRefusalKind,
  ExternalMcpToolReadOnlyStatus,
} from "../../../Types/AI/ExternalMcpServer/ExternalMcpToolReadOnlyMark";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import Toast from "../../../UI/Utils/Toast";
import User from "../../../UI/Utils/User";
import type { Mock, SpyInstance } from "jest-mock";

/*
 * ISSUE #11081, ON THE SERVER'S PAGE: A PROJECT ADMIN MARKS A TOOL ITS
 * SERVER SAYS NOTHING ABOUT AS READ-ONLY.
 *
 * kAgent's tool server says nothing about any of its tools, so its page
 * listed 126 tools, every one "May change things", and OneUptime AI could
 * use none of them on its own. Now, for a Project Owner or Admin:
 *
 *   - a line over the list says how many tools the server says nothing
 *     about, and what marking one does - or, when the server marks all
 *     the others as changes (an mcp-go server's), that none can be;
 *   - each such tool has Mark as Read-Only, one tool at a time: there is
 *     no way to mark several;
 *   - the dialog says plainly what marking means before anything is saved:
 *     what the server says the tool does and what it takes, that OneUptime
 *     AI will then call it without asking anyone, that only someone who
 *     knows it only reads should mark it, that their name and the time are
 *     recorded, and that the mark stops applying when the server changes
 *     the tool;
 *   - a marked tool reads only, and says who marked it and when; a lapsed
 *     mark says the server changed the tool, and offers Mark Again; a
 *     tool that can never be marked says why.
 *
 * Anyone else sees each tool's status and who marked it, and no buttons.
 */

const PROJECT_ID: string = "11081000-0000-4000-8000-00000000d001";
const SERVER_ID: ObjectID = new ObjectID(
  "11081000-0000-4000-8000-00000000d002",
);

/*
 * ModelAPI.create and ModelAPI.getList are generic over the model, which a
 * spy's type cannot follow: their spies are typed by what the tests read.
 */
type CreateSpy = SpyInstance<
  (data: {
    model: ExternalMcpToolReadOnlyMark;
    modelType: unknown;
  }) => Promise<unknown>
>;
type GetListSpy = SpyInstance<(data: unknown) => Promise<unknown>>;

function spyOnCreate(): CreateSpy {
  return jest.spyOn(ModelAPI, "create") as unknown as CreateSpy;
}

function spyOnGetList(): GetListSpy {
  return jest.spyOn(ModelAPI, "getList") as unknown as GetListSpy;
}

const GET_RESOURCES_FINGERPRINT: string = "a".repeat(64);

function tools(): Array<ExternalMcpServerTool> {
  return [
    {
      name: "get_pod_status",
      description: "Reads a pod.",
      readsOnly: true,
      fingerprint: "1".repeat(64),
      argumentNames: ["pod"],
    },
    {
      name: "k8s_get_resources",
      description: "List Kubernetes resources with kubectl.",
      readsOnly: false,
      fingerprint: GET_RESOURCES_FINGERPRINT,
      argumentNames: ["resource_type", "namespace"],
    },
    {
      name: "k8s_get_events",
      description: "Get events from a Kubernetes namespace",
      readsOnly: false,
      fingerprint: "2".repeat(64),
      argumentNames: ["namespace"],
    },
    {
      name: "k8s_delete_resource",
      description: "Delete a Kubernetes resource",
      readsOnly: false,
      fingerprint: "3".repeat(64),
      markRefusal: {
        kind: ExternalMcpToolMarkRefusalKind.NameSaysItChanges,
        word: "delete",
      },
      argumentNames: ["resource_type"],
    },
    {
      name: "restart_deployment",
      description: "Restarts a deployment.",
      readsOnly: false,
      serverMarksAsChange: true,
      fingerprint: "4".repeat(64),
      argumentNames: ["deployment"],
    },
  ];
}

function markOf(data: {
  toolName: string;
  toolFingerprint: string;
  name?: string | undefined;
  createdAt?: Date | undefined;
}): ExternalMcpToolReadOnlyMark {
  const mark: ExternalMcpToolReadOnlyMark = new ExternalMcpToolReadOnlyMark(
    ObjectID.generate(),
  );
  mark.toolName = data.toolName;
  mark.toolFingerprint = data.toolFingerprint;
  mark.createdAt = data.createdAt || new Date("2026-11-27T10:00:00Z");

  if (data.name) {
    const user: UserModel = new UserModel();
    user.name = new Name(data.name);
    mark.createdByUser = user;
  }

  return mark;
}

function signedInAs(permissions: Array<Permission>): void {
  jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
  jest
    .spyOn(PermissionUtil, "getAllPermissions")
    .mockReturnValue(permissions as never);
  jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue({
    _type: "UserTenantAccessPermission",
    projectId: new ObjectID(PROJECT_ID),
    permissions: permissions.map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      } as UserPermission;
    }),
  } as unknown as UserTenantAccessPermission);
  jest.spyOn(PermissionUtil, "getGlobalPermissions").mockReturnValue(null);
}

function rowOf(
  rows: Array<ExternalMcpToolRow>,
  name: string,
): ExternalMcpToolRow {
  return rows.find((row: ExternalMcpToolRow): boolean => {
    return row.tool.name === name;
  })!;
}

function listItem(name: string): HTMLElement {
  const item: HTMLElement | undefined = screen
    .getAllByTestId("external-mcp-server-tool")
    .find((element: HTMLElement): boolean => {
      return within(element).queryByText(name) !== null;
    });

  if (!item) {
    throw new Error(`No row for ${name}.`);
  }

  return item;
}

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("each tool's row: its status, its mark, and whether it can be marked", () => {
  test("by the server's word, a mark that holds, one that lapsed, or nothing", () => {
    const rows: Array<ExternalMcpToolRow> = getExternalMcpToolRows({
      tools: tools(),
      marks: [
        markOf({
          toolName: "k8s_get_resources",
          toolFingerprint: GET_RESOURCES_FINGERPRINT,
        }),
        markOf({ toolName: "k8s_get_events", toolFingerprint: "9".repeat(64) }),
      ],
    });

    expect(
      rows.map((row: ExternalMcpToolRow): [string, string, boolean] => {
        return [row.tool.name, row.status, row.canBeMarked];
      }),
    ).toEqual([
      [
        "get_pod_status",
        ExternalMcpToolReadOnlyStatus.ServerMarksReadOnly,
        false,
      ],
      [
        "k8s_get_resources",
        ExternalMcpToolReadOnlyStatus.MarkedReadOnly,
        false,
      ],
      ["k8s_get_events", ExternalMcpToolReadOnlyStatus.MarkLapsed, true],
      [
        "k8s_delete_resource",
        ExternalMcpToolReadOnlyStatus.CannotBeMarked,
        false,
      ],
      [
        "restart_deployment",
        ExternalMcpToolReadOnlyStatus.ServerMarksChange,
        false,
      ],
    ]);
  });

  test("with no mark, the tool the server says nothing about is the one to mark", () => {
    const rows: Array<ExternalMcpToolRow> = getExternalMcpToolRows({
      tools: tools(),
    });

    expect(rowOf(rows, "k8s_get_resources").status).toBe(
      ExternalMcpToolReadOnlyStatus.NotMarked,
    );
    expect(countExternalMcpToolsToMark(rows)).toBe(2);
    expect(countExternalMcpToolsServerMarksAsChange(rows)).toBe(1);
  });

  test("of a tool's marks, the row keeps the one that holds, else the newest", () => {
    const older: ExternalMcpToolReadOnlyMark = markOf({
      toolName: "k8s_get_resources",
      toolFingerprint: GET_RESOURCES_FINGERPRINT,
      createdAt: new Date("2026-11-01T00:00:00Z"),
    });
    const newer: ExternalMcpToolReadOnlyMark = markOf({
      toolName: "k8s_get_resources",
      toolFingerprint: "8".repeat(64),
      createdAt: new Date("2026-11-20T00:00:00Z"),
    });

    expect(
      rowOf(
        getExternalMcpToolRows({ tools: tools(), marks: [newer, older] }),
        "k8s_get_resources",
      ).mark,
    ).toBe(older);

    const lapsedOld: ExternalMcpToolReadOnlyMark = markOf({
      toolName: "k8s_get_events",
      toolFingerprint: "7".repeat(64),
      createdAt: new Date("2026-11-01T00:00:00Z"),
    });
    const lapsedNew: ExternalMcpToolReadOnlyMark = markOf({
      toolName: "k8s_get_events",
      toolFingerprint: "6".repeat(64),
      createdAt: new Date("2026-11-20T00:00:00Z"),
    });

    expect(
      rowOf(
        getExternalMcpToolRows({
          tools: tools(),
          marks: [lapsedOld, lapsedNew],
        }),
        "k8s_get_events",
      ).mark,
    ).toBe(lapsedNew);
  });

  test("a tool read before marks existed cannot be marked until it is read again", () => {
    const rows: Array<ExternalMcpToolRow> = getExternalMcpToolRows({
      tools: [{ name: "k8s_get_resources", readsOnly: false }],
    });

    expect(rows[0]!.canBeMarked).toBe(false);
  });

  test("a refusal is said in the reader's words, its value and argument named", () => {
    expect(
      getExternalMcpToolMarkRefusalSentence({
        kind: ExternalMcpToolMarkRefusalKind.ArgumentCanChange,
        word: "delete",
        argument: "operation",
      }),
    ).toEqual({
      template: EXTERNAL_MCP_TOOL_MARK_REFUSALS.argumentValueCanChange,
      values: { word: "delete", argument: "operation" },
    });
    expect(
      getExternalMcpToolMarkRefusalSentence({
        kind: ExternalMcpToolMarkRefusalKind.RunsWhatItIsGiven,
        word: "command",
      }).template,
    ).toBe(EXTERNAL_MCP_TOOL_MARK_REFUSALS.runsWhatItIsGiven);
  });
});

describe("who may mark, and how a mark is made and taken away", () => {
  test("a Project Owner or Admin may mark; a Member is told who may", () => {
    signedInAs([Permission.ProjectAdmin]);
    expect(getExternalMcpToolMarkGate().isAllowed).toBe(true);

    signedInAs([Permission.ProjectOwner]);
    expect(getExternalMcpToolMarkGate().isAllowed).toBe(true);

    signedInAs([Permission.ProjectMember]);
    const refused: { isAllowed: boolean; disabledReason?: string | undefined } =
      getExternalMcpToolMarkGate();
    expect(refused.isAllowed).toBe(false);
    expect(refused.disabledReason).toContain(
      EXTERNAL_MCP_TOOL_MARK_COPY.refusedSentence,
    );
  });

  test("marking sends the server and the tool, and nothing else: the definition is the server's to take", async () => {
    const create: CreateSpy = spyOnCreate().mockResolvedValue({} as never);

    await markExternalMcpToolReadOnly({
      externalMcpServerId: SERVER_ID,
      toolName: "k8s_get_resources",
    });

    expect(create).toHaveBeenCalledTimes(1);
    const sent: ExternalMcpToolReadOnlyMark = create.mock.calls[0]![0]
      .model as ExternalMcpToolReadOnlyMark;
    expect(create.mock.calls[0]![0].modelType).toBe(
      ExternalMcpToolReadOnlyMark,
    );
    expect(sent.externalMcpServerId?.toString()).toBe(SERVER_ID.toString());
    expect(sent.toolName).toBe("k8s_get_resources");
    expect(sent.toolFingerprint).toBeUndefined();
  });

  test("taking a mark away deletes that mark", async () => {
    const deleteItem: SpyInstance<typeof ModelAPI.deleteItem> = jest
      .spyOn(ModelAPI, "deleteItem")
      .mockResolvedValue(undefined as never);
    const markId: ObjectID = ObjectID.generate();

    await removeExternalMcpToolMark(markId);

    expect(deleteItem.mock.calls[0]![0]).toEqual({
      modelType: ExternalMcpToolReadOnlyMark,
      id: markId,
    });
  });

  test("a server's marks are read with who made each and when, newest first", async () => {
    const getList: GetListSpy = spyOnGetList().mockResolvedValue({
      data: [],
      count: 0,
      skip: 0,
      limit: 0,
    } as never);

    await readExternalMcpToolMarks(SERVER_ID);

    const request: Record<string, unknown> = getList.mock
      .calls[0]![0] as unknown as Record<string, unknown>;
    expect(request["modelType"]).toBe(ExternalMcpToolReadOnlyMark);
    expect(request["query"]).toEqual({ externalMcpServerId: SERVER_ID });
    expect(request["select"]).toEqual(EXTERNAL_MCP_TOOL_MARK_SELECT);
    expect(request["sort"]).toEqual({ createdAt: SortOrder.Descending });
  });
});

describe("the list of tools", () => {
  const MARKS: Array<ExternalMcpToolReadOnlyMark> = [
    markOf({
      toolName: "k8s_get_resources",
      toolFingerprint: GET_RESOURCES_FINGERPRINT,
      name: "Jane Doe",
    }),
    markOf({
      toolName: "k8s_get_events",
      toolFingerprint: "9".repeat(64),
      name: "Ravi Shah",
    }),
  ];

  test("for everyone: a marked tool reads only and says who marked it; a lapsed one may change things and says why", () => {
    render(<ExternalMcpServerToolList tools={tools()} marks={MARKS} />);

    const marked: HTMLElement = listItem("k8s_get_resources");
    expect(marked).toHaveAttribute("data-reads-only", "true");
    expect(marked).toHaveAttribute(
      "data-status",
      ExternalMcpToolReadOnlyStatus.MarkedReadOnly,
    );
    expect(marked).toHaveTextContent("Reads only");
    expect(
      within(marked).getByTestId("external-mcp-server-tool-mark"),
    ).toHaveTextContent("Marked read-only by Jane Doe on");

    const lapsed: HTMLElement = listItem("k8s_get_events");
    expect(lapsed).toHaveAttribute("data-reads-only", "false");
    expect(lapsed).toHaveTextContent("May change things");
    expect(
      within(lapsed).getByTestId("external-mcp-server-tool-mark-lapsed"),
    ).toHaveTextContent("Ravi Shah marked it read-only on");
    expect(
      within(lapsed).getByTestId("external-mcp-server-tool-mark-lapsed"),
    ).toHaveTextContent(
      "but the server has changed it since. It may change things until someone marks it again.",
    );

    expect(listItem("get_pod_status")).toHaveAttribute(
      "data-reads-only",
      "true",
    );
    expect(listItem("restart_deployment")).toHaveTextContent(
      "May change things",
    );
  });

  test("for everyone: no button, and no reason a tool cannot be marked - that is for whoever would mark it", () => {
    render(<ExternalMcpServerToolList tools={tools()} marks={MARKS} />);

    expect(
      screen.queryByTestId("external-mcp-server-tool-mark-button"),
    ).toBeNull();
    expect(
      screen.queryByTestId("external-mcp-server-tool-remove-mark-button"),
    ).toBeNull();
    expect(
      screen.queryByTestId("external-mcp-server-tool-mark-refused"),
    ).toBeNull();
  });

  test("a mark whose maker is gone still says when", () => {
    render(
      <ExternalMcpServerToolList
        tools={tools()}
        marks={[
          markOf({
            toolName: "k8s_get_resources",
            toolFingerprint: GET_RESOURCES_FINGERPRINT,
          }),
        ]}
      />,
    );

    expect(
      within(listItem("k8s_get_resources")).getByTestId(
        "external-mcp-server-tool-mark",
      ),
    ).toHaveTextContent(/^Marked read-only on /);
  });

  describe("for whoever may mark", () => {
    function renderForAdmin(
      onMark: (tool: ExternalMcpServerTool) => void = (): void => {},
      onRemoveMark: (row: ExternalMcpToolRow) => void = (): void => {},
    ): void {
      render(
        <ExternalMcpServerToolList
          tools={tools()}
          marks={MARKS}
          markActions={{ onMark, onRemoveMark }}
        />,
      );
    }

    test("Mark as Read-Only on a tool its server says nothing about, one tool at a time", () => {
      const onMark: Mock<(tool: ExternalMcpServerTool) => void> =
        jest.fn<(tool: ExternalMcpServerTool) => void>();
      render(
        <ExternalMcpServerToolList
          tools={tools()}
          markActions={{
            onMark,
            onRemoveMark: (): void => {},
          }}
        />,
      );

      const buttons: Array<HTMLElement> = screen.getAllByTestId(
        "external-mcp-server-tool-mark-button",
      );
      // k8s_get_resources and k8s_get_events: the two the server says nothing about.
      expect(buttons).toHaveLength(2);
      expect(buttons[0]).toHaveTextContent("Mark as Read-Only");

      fireEvent.click(
        within(listItem("k8s_get_resources")).getByTestId(
          "external-mcp-server-tool-mark-button",
        ),
      );

      expect(onMark).toHaveBeenCalledTimes(1);
      expect(onMark.mock.calls[0]![0].name).toBe("k8s_get_resources");
    });

    test("no button marks several: there is nothing like Mark All", () => {
      renderForAdmin();

      expect(screen.queryByText(/mark all/i)).toBeNull();
      expect(screen.queryByText(/select all/i)).toBeNull();
      expect(screen.queryByRole("checkbox")).toBeNull();
    });

    test("a lapsed mark: Mark Again, or take it away", () => {
      renderForAdmin();

      const lapsed: HTMLElement = listItem("k8s_get_events");
      expect(
        within(lapsed).getByTestId("external-mcp-server-tool-mark-button"),
      ).toHaveTextContent("Mark Again");
      expect(
        within(lapsed).getByTestId(
          "external-mcp-server-tool-remove-mark-button",
        ),
      ).toHaveTextContent("Remove Mark");
    });

    test("a marked tool: Remove Mark, which hands the row on", () => {
      const onRemoveMark: Mock<(row: ExternalMcpToolRow) => void> =
        jest.fn<(row: ExternalMcpToolRow) => void>();
      renderForAdmin((): void => {}, onRemoveMark);

      const marked: HTMLElement = listItem("k8s_get_resources");
      expect(
        within(marked).queryByTestId("external-mcp-server-tool-mark-button"),
      ).toBeNull();

      fireEvent.click(
        within(marked).getByTestId(
          "external-mcp-server-tool-remove-mark-button",
        ),
      );

      const row: ExternalMcpToolRow = onRemoveMark.mock.calls[0]![0];
      expect(row.tool.name).toBe("k8s_get_resources");
      expect(row.mark).toBe(MARKS[0]);
    });

    test("a tool that can never be marked says why, and has no button", () => {
      renderForAdmin();

      const refused: HTMLElement = listItem("k8s_delete_resource");
      expect(
        within(refused).getByTestId("external-mcp-server-tool-mark-refused"),
      ).toHaveTextContent(
        "Can't be marked read-only: “delete” in its name says it changes things.",
      );
      expect(
        within(refused).queryByTestId("external-mcp-server-tool-mark-button"),
      ).toBeNull();
    });

    test("tools the server marks either way have no button", () => {
      renderForAdmin();

      for (const name of ["get_pod_status", "restart_deployment"]) {
        expect(
          within(listItem(name)).queryByTestId(
            "external-mcp-server-tool-mark-button",
          ),
        ).toBeNull();
      }
    });

    test("while a mark is taken away, its row's buttons wait", () => {
      render(
        <ExternalMcpServerToolList
          tools={tools()}
          marks={MARKS}
          markActions={{
            onMark: (): void => {},
            onRemoveMark: (): void => {},
            busyToolName: "k8s_get_events",
          }}
        />,
      );

      expect(
        within(listItem("k8s_get_events")).getByTestId(
          "external-mcp-server-tool-mark-button",
        ),
      ).toBeDisabled();
    });
  });
});

describe("the dialog that marks a tool", () => {
  const TOOL: ExternalMcpServerTool = tools()[1]!;

  function renderDialog(
    onMarked: () => void = (): void => {},
    onClose: () => void = (): void => {},
    tool: ExternalMcpServerTool = TOOL,
  ): void {
    render(
      <MarkExternalMcpToolModal
        externalMcpServerId={SERVER_ID}
        tool={tool}
        onMarked={onMarked}
        onClose={onClose}
      />,
    );
  }

  test("says plainly what marking means before anything is saved", () => {
    const create: CreateSpy = spyOnCreate();
    renderDialog();

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Mark k8s_get_resources as read-only?",
    );
    expect(
      screen.getByTestId("mark-external-mcp-tool-description"),
    ).toHaveTextContent("List Kubernetes resources with kubectl.");
    expect(
      screen.getByTestId("mark-external-mcp-tool-arguments"),
    ).toHaveTextContent("Its arguments: resource_type, namespace");
    expect(
      screen.getByTestId("mark-external-mcp-tool-meaning"),
    ).toHaveTextContent(
      "OneUptime AI will then call it without asking anyone: in investigations, in fixes, in Slack and Microsoft Teams, and at once in Ask AI.",
    );
    expect(
      screen.getByTestId("mark-external-mcp-tool-warning"),
    ).toHaveTextContent(
      "Mark it only if you know it only reads. If it can change something, OneUptime AI could change it with no one asking.",
    );
    expect(
      screen.getByTestId("mark-external-mcp-tool-recorded"),
    ).toHaveTextContent(
      "Your name and the time are recorded. If the server changes this tool, the mark stops applying until someone marks it again.",
    );
    expect(create).not.toHaveBeenCalled();
  });

  test("its one button marks the tool, says so, and the card shows it", async () => {
    const create: CreateSpy = spyOnCreate().mockResolvedValue({} as never);
    const toast: SpyInstance<typeof Toast.success> = jest
      .spyOn(Toast, "success")
      .mockReturnValue("toast-1");
    const onMarked: Mock<() => void> = jest.fn<() => void>();
    renderDialog(onMarked);

    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(
      (create.mock.calls[0]![0].model as ExternalMcpToolReadOnlyMark).toolName,
    ).toBe("k8s_get_resources");
    expect(toast).toHaveBeenCalledWith("k8s_get_resources marked read-only");
    expect(onMarked).toHaveBeenCalledTimes(1);
  });

  test("a refused mark says what failed in the dialog, and nothing is marked", async () => {
    jest
      .spyOn(ModelAPI, "create")
      .mockRejectedValue(
        new Error(
          "k8s_get_resources cannot be marked read-only: its server marks it as one that may change something.",
        ),
      );
    const onMarked: Mock<() => void> = jest.fn<() => void>();
    renderDialog(onMarked);

    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    });

    // The server's own words: why this tool cannot be marked.
    await waitFor(() => {
      expect(
        within(screen.getByTestId("modal")).getByRole("alert"),
      ).toHaveTextContent(
        "k8s_get_resources cannot be marked read-only: its server marks it as one that may change something.",
      );
    });
    expect(onMarked).not.toHaveBeenCalled();
    // The dialog stays, to be read or closed.
    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Mark k8s_get_resources as read-only?",
    );
  });

  test("Cancel leaves everything as it was", () => {
    const create: CreateSpy = spyOnCreate();
    const onClose: Mock<() => void> = jest.fn<() => void>();
    renderDialog((): void => {}, onClose);

    fireEvent.click(screen.getByTestId("modal-footer-close-button"));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
  });

  test("a tool with no description says the server gives none; one with no arguments lists none", () => {
    renderDialog(
      (): void => {},
      (): void => {},
      {
        name: "datetime_get_current_time",
        readsOnly: false,
        argumentNames: [],
      },
    );

    expect(
      screen.getByTestId("mark-external-mcp-tool-description"),
    ).toHaveTextContent("The server gives no description.");
    expect(screen.queryByTestId("mark-external-mcp-tool-arguments")).toBeNull();
  });
});

describe("the server's Tools card", () => {
  let marks: Array<ExternalMcpToolReadOnlyMark>;
  let serverTools: Array<ExternalMcpServerTool>;
  let getList: GetListSpy;

  beforeEach(() => {
    marks = [];
    serverTools = tools();

    jest.spyOn(ModelAPI, "getItem").mockImplementation((async () => {
      return Object.assign(new ExternalMcpServer(SERVER_ID), {
        isEnabled: true,
        lastConnectedAt: new Date(),
        lastCheckedAt: new Date(),
        transport: ExternalMcpServerTransport.StreamableHttp,
        serverName: "kagent-tools-server",
        tools: serverTools,
      });
    }) as never);
    getList = spyOnGetList().mockImplementation((async () => {
      return { data: marks, count: marks.length, skip: 0, limit: 0 };
    }) as never);
    jest.spyOn(Toast, "success").mockReturnValue("toast-1");
  });

  async function renderCard(): Promise<void> {
    await act(async () => {
      render(<ExternalMcpServerToolsCard serverId={SERVER_ID} />);
    });

    await waitFor(() => {
      expect(
        screen.getAllByTestId("external-mcp-server-tool").length,
      ).toBeGreaterThan(0);
    });
  }

  test("a Project Admin is told how many tools the server says nothing about, and what marking one does", async () => {
    signedInAs([Permission.ProjectAdmin]);
    await renderCard();

    expect(
      screen.getByTestId("external-mcp-server-tool-mark-hint"),
    ).toHaveTextContent(
      "The server doesn't say whether 2 tools only read. Mark the ones you know only read, and OneUptime AI can use them without asking.",
    );
    expect(
      screen.getAllByTestId("external-mcp-server-tool-mark-button"),
    ).toHaveLength(2);
  });

  test("marking goes through the dialog, and the card then shows who marked it", async () => {
    signedInAs([Permission.ProjectAdmin]);
    const create: CreateSpy = spyOnCreate().mockImplementation((async () => {
      marks = [
        markOf({
          toolName: "k8s_get_resources",
          toolFingerprint: GET_RESOURCES_FINGERPRINT,
          name: "Jane Doe",
        }),
      ];
      return {};
    }) as never);
    await renderCard();

    await act(async () => {
      fireEvent.click(
        within(listItem("k8s_get_resources")).getByTestId(
          "external-mcp-server-tool-mark-button",
        ),
      );
    });

    // Nothing is saved before the dialog's own button.
    expect(create).not.toHaveBeenCalled();
    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Mark k8s_get_resources as read-only?",
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    });

    await waitFor(() => {
      expect(listItem("k8s_get_resources")).toHaveAttribute(
        "data-reads-only",
        "true",
      );
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(listItem("k8s_get_resources")).toHaveTextContent(
      "Marked read-only by Jane Doe on",
    );
    // The marks were read again, so the card shows what the server keeps.
    expect(getList.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(
      screen.getByTestId("external-mcp-server-tool-mark-hint"),
    ).toHaveTextContent("The server doesn't say whether 1 tool only reads.");
  });

  test("Remove Mark takes the mark away at once, says so, and the tool may change things again", async () => {
    signedInAs([Permission.ProjectOwner]);
    marks = [
      markOf({
        toolName: "k8s_get_resources",
        toolFingerprint: GET_RESOURCES_FINGERPRINT,
        name: "Jane Doe",
      }),
    ];
    const markId: ObjectID = marks[0]!.id!;
    const deleteItem: SpyInstance<typeof ModelAPI.deleteItem> = jest
      .spyOn(ModelAPI, "deleteItem")
      .mockImplementation((async () => {
        marks = [];
      }) as never);
    const toast: SpyInstance<typeof Toast.success> = jest
      .spyOn(Toast, "success")
      .mockReturnValue("toast-2");
    await renderCard();

    await act(async () => {
      fireEvent.click(
        within(listItem("k8s_get_resources")).getByTestId(
          "external-mcp-server-tool-remove-mark-button",
        ),
      );
    });

    await waitFor(() => {
      expect(listItem("k8s_get_resources")).toHaveAttribute(
        "data-reads-only",
        "false",
      );
    });
    expect(deleteItem.mock.calls[0]![0].id.toString()).toBe(markId.toString());
    expect(toast).toHaveBeenCalledWith("Mark removed from k8s_get_resources");
  });

  test("a Member sees each tool's status and who marked it, and no hint and no button", async () => {
    signedInAs([Permission.ProjectMember]);
    marks = [
      markOf({
        toolName: "k8s_get_resources",
        toolFingerprint: GET_RESOURCES_FINGERPRINT,
        name: "Jane Doe",
      }),
    ];
    await renderCard();

    expect(listItem("k8s_get_resources")).toHaveTextContent(
      "Marked read-only by Jane Doe on",
    );
    expect(
      screen.queryByTestId("external-mcp-server-tool-mark-hint"),
    ).toBeNull();
    expect(
      screen.queryByTestId("external-mcp-server-tool-mark-button"),
    ).toBeNull();
    expect(
      screen.queryByTestId("external-mcp-server-tool-remove-mark-button"),
    ).toBeNull();
  });

  test("a server that marks every other tool as a change (mcp-go's, kAgent 0.2's): none can be marked, and the card says so", async () => {
    signedInAs([Permission.ProjectAdmin]);
    serverTools = [
      {
        name: "k8s_get_resources",
        readsOnly: false,
        serverMarksAsChange: true,
        fingerprint: GET_RESOURCES_FINGERPRINT,
      },
      {
        name: "k8s_delete_resource",
        readsOnly: false,
        serverMarksAsChange: true,
        fingerprint: "3".repeat(64),
      },
    ];
    await renderCard();

    expect(
      screen.getByTestId("external-mcp-server-tool-mark-none"),
    ).toHaveTextContent(
      "The server marks its other tools as ones that may change things, so they can't be marked read-only.",
    );
    expect(
      screen.queryByTestId("external-mcp-server-tool-mark-button"),
    ).toBeNull();
  });

  test("marks that cannot be read show the card's error, never a tool as one it is not", async () => {
    signedInAs([Permission.ProjectAdmin]);
    getList.mockRejectedValue(new Error("Request failed with status 500."));

    await act(async () => {
      render(<ExternalMcpServerToolsCard serverId={SERVER_ID} />);
    });

    await waitFor(() => {
      expect(screen.queryAllByTestId("external-mcp-server-tool")).toHaveLength(
        0,
      );
    });
    expect(
      screen.queryByTestId("external-mcp-server-tool-mark-button"),
    ).toBeNull();
  });
});
