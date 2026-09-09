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
} from "@testing-library/react";
import React, { ReactElement } from "react";
import MonitorLabelRule from "../../../Models/DatabaseModels/MonitorLabelRule";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Card from "../../../UI/Components/Card/Card";
import ImportLabelRulesModal from "../../../UI/Components/LabelRule/ImportLabelRulesModal";
import LabelRuleTable from "../../../UI/Components/LabelRule/LabelRuleTable";
import { ComponentProps as ModelTableProps } from "../../../UI/Components/ModelTable/ModelTable";
import LabelRuleImportExport, {
  LabelRuleImportItem,
  LabelRuleImportPreview,
  LabelRuleImportResult,
} from "../../../UI/Utils/LabelRuleImportExport";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ModelImportExportUtil from "../../../UI/Utils/ModelImportExport";
import PermissionGate, {
  ModelAction,
  PermissionCheckableModel,
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * Keep the real dialog, controls, card, and workflow. The transfer utility is
 * the network boundary: its separate suites exercise JSON validation,
 * reference resolution, pagination, and creation. The table stand-in exposes
 * the wrapper's public props without fetching unrelated table data.
 */
const tablePropsMock: ReturnType<
  typeof jest.fn<(props: ModelTableProps<MonitorLabelRule>) => void>
> = jest.fn<(props: ModelTableProps<MonitorLabelRule>) => void>();

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: ModelTableProps<MonitorLabelRule>): ReactElement => {
      tablePropsMock(props);
      return (
        <div>
          <Card {...props.cardProps} />
          <output data-testid="table-refresh">{props.refreshToggle}</output>
        </div>
      );
    },
  };
});

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

const projectId: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const otherProjectId: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const fileText: string = JSON.stringify({
  resourceType: "MonitorLabelRule",
  items: [{ name: "Production monitors" }],
});

function makePreview(count: number = 1): LabelRuleImportPreview {
  return {
    projectId: projectId.toString(),
    sourceResourceType: "MonitorLabelRule",
    destinationResourceType: "MonitorLabelRule",
    mappings: [],
    items: Array.from({ length: count }, (_value: unknown, index: number) => {
      return {
        index: index + 1,
        name: `Production rule ${index + 1}`,
        description: `Match the production environment ${index + 1}`,
        isEnabled: index % 2 === 0,
        labels: ["Production", "Critical"],
        json: {
          name: `Production rule ${index + 1}`,
          description: `Match the production environment ${index + 1}`,
          isEnabled: index % 2 === 0,
          monitorNamePattern: "prod-*",
          projectId: projectId.toString(),
        },
        displayJson: {
          monitorNamePattern: "prod-*",
          labelsToAdd: ["Production", "Critical"],
        },
        portableJson: {
          name: `Production rule ${index + 1}`,
          description: `Match the production environment ${index + 1}`,
          isEnabled: index % 2 === 0,
          monitorNamePattern: "prod-*",
          labelsToAdd: ["Production", "Critical"],
        },
      };
    }),
  };
}

function makeResult(
  successCount: number,
  failedCount: number = 0,
): LabelRuleImportResult {
  const retryPreview: LabelRuleImportPreview = makePreview(
    successCount + failedCount,
  );
  retryPreview.items = retryPreview.items.slice(successCount);
  return {
    successCount,
    failures: retryPreview.items.map((item: LabelRuleImportItem) => {
      return {
        index: item.index,
        itemName: item.name,
        errorMessage: "The server could not save this rule.",
      };
    }),
    retryPreview,
  };
}

function renderModal(
  onImportComplete: (result: LabelRuleImportResult) => void = jest.fn(),
  onClose: () => void = jest.fn(),
): void {
  render(
    <ImportLabelRulesModal
      modelType={MonitorLabelRule}
      projectId={projectId}
      onClose={onClose}
      onImportComplete={onImportComplete}
    />,
  );
}

function renderTable(
  overrides: Partial<ModelTableProps<MonitorLabelRule>> = {},
): void {
  render(
    <LabelRuleTable
      modelType={MonitorLabelRule}
      id="monitor-label-rules"
      name="Monitor Label Rules"
      columns={[]}
      filters={[]}
      isCreateable={true}
      isDeleteable={true}
      cardProps={{ title: "Monitor Label Rules" }}
      {...overrides}
    />,
  );
}

function enterJSON(text: string = fileText): void {
  fireEvent.change(screen.getByLabelText("JSON"), {
    target: { value: text },
  });
}

async function validateJSON(text: string = fileText): Promise<void> {
  enterJSON(text);
  fireEvent.click(screen.getByRole("button", { name: "Validate and preview" }));
  await screen.findByRole("heading", { name: "Preview import" });
}

async function openImport(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "Import JSON" }));
  await screen.findByLabelText("JSON");
}

function lastTableProps(): ModelTableProps<MonitorLabelRule> {
  return tablePropsMock.mock.calls[tablePropsMock.mock.calls.length - 1]![0];
}

beforeEach(() => {
  tablePropsMock.mockClear();
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(projectId);
  jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
  jest.spyOn(LabelRuleImportExport, "preview").mockResolvedValue(makePreview());
  jest
    .spyOn(LabelRuleImportExport, "importPreview")
    .mockResolvedValue(makeResult(1));
  jest.spyOn(LabelRuleImportExport, "exportAll").mockResolvedValue({
    resourceType: "MonitorLabelRule",
    items: [{ name: "Exported rule" }],
  });
  jest
    .spyOn(ModelImportExportUtil, "downloadJSONFile")
    .mockImplementation((): void => {});
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("label rule import review", () => {
  test("requires JSON and a successful preview before offering creation", () => {
    renderModal();

    expect(screen.getByLabelText("Upload JSON file")).toHaveAttribute(
      "type",
      "file",
    );
    expect(screen.getByLabelText("JSON")).toHaveValue("");
    expect(
      screen.getByRole("button", { name: "Validate and preview" }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: /^Import \d/ }),
    ).not.toBeInTheDocument();
    expect(LabelRuleImportExport.importPreview).not.toHaveBeenCalled();
  });

  test.each([
    "This file is not valid JSON.",
    "Rule 2 has an unsupported field: incidentSeverityId.",
    'The label "Production" does not exist in this project.',
    "Rule 1 must have a name.",
  ])(
    "shows validation failure without creating any rules: %s",
    async (message: string) => {
      jest
        .mocked(LabelRuleImportExport.preview)
        .mockRejectedValue(new Error(message));
      renderModal();

      enterJSON("{invalid or incompatible rules}");
      fireEvent.click(
        screen.getByRole("button", { name: "Validate and preview" }),
      );

      await screen.findByText(message);
      expect(LabelRuleImportExport.importPreview).not.toHaveBeenCalled();
      expect(
        screen.queryByRole("heading", { name: "Preview import" }),
      ).not.toBeInTheDocument();
      expect(screen.getByLabelText("JSON")).toHaveValue(
        "{invalid or incompatible rules}",
      );
    },
  );

  test("passes pasted content, resource type, and destination project to validation", async () => {
    renderModal();
    await validateJSON();

    expect(LabelRuleImportExport.preview).toHaveBeenCalledWith({
      modelType: MonitorLabelRule,
      projectId,
      fileText,
      modelAPI: undefined,
    });
    expect(screen.getByText("Production rule 1")).toBeInTheDocument();
    expect(
      screen.getByText("Match the production environment 1"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Production, Critical/)).toBeInTheDocument();
    expect(LabelRuleImportExport.importPreview).not.toHaveBeenCalled();
  });

  test("makes a cross-resource field mapping visible before import", async () => {
    jest.mocked(LabelRuleImportExport.preview).mockResolvedValue({
      ...makePreview(),
      sourceResourceType: "IncidentLabelRule",
      mappings: ["incidentTitlePattern → monitorNamePattern"],
    });
    renderModal();
    await validateJSON();

    expect(
      screen.getByText("incidentTitlePattern → monitorNamePattern"),
    ).toBeInTheDocument();
    expect(LabelRuleImportExport.importPreview).not.toHaveBeenCalled();
  });

  test("pages through every reviewed rule and shows readable conditions", async () => {
    jest
      .mocked(LabelRuleImportExport.preview)
      .mockResolvedValue(makePreview(45));
    renderModal();
    await validateJSON();

    expect(screen.getByText("Production rule 1")).toBeInTheDocument();
    expect(screen.getByText("Production rule 20")).toBeInTheDocument();
    expect(screen.queryByText("Production rule 21")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();

    const details: HTMLElement | null = screen
      .getAllByText("View conditions and actions")[0]!
      .closest("details");
    expect(details).toHaveTextContent('"monitorNamePattern": "prod-*"');
    expect(details).toHaveTextContent('"Production"');
    expect(details).not.toHaveTextContent(projectId.toString());

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Production rule 21")).toBeInTheDocument();
    expect(screen.getByText("Production rule 40")).toBeInTheDocument();
    expect(screen.queryByText("Production rule 1")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Production rule 45")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Import 45 rules" }),
    ).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(screen.getByText("Production rule 21")).toBeInTheDocument();
    expect(LabelRuleImportExport.importPreview).not.toHaveBeenCalled();
  });

  test("uploads JSON through the labelled file input before validating", async () => {
    renderModal();
    const file: File = new File([fileText], "label-rules.json", {
      type: "application/json",
    });
    fireEvent.change(screen.getByLabelText("Upload JSON file"), {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(screen.getByLabelText("JSON")).toHaveValue(fileText);
    });
    expect(LabelRuleImportExport.preview).not.toHaveBeenCalled();
    expect(LabelRuleImportExport.importPreview).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Validate and preview" }),
    );
    await screen.findByRole("heading", { name: "Preview import" });
    expect(LabelRuleImportExport.preview).toHaveBeenCalledWith(
      expect.objectContaining({ fileText }),
    );
  });

  test("keeps uploaded content editable and validates the edited version", async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText("Upload JSON file"), {
      target: {
        files: [new File([fileText], "label-rules.json")],
      },
    });
    await waitFor(() => {
      expect(screen.getByLabelText("JSON")).toHaveValue(fileText);
    });

    const editedText: string = JSON.stringify({ items: [{ name: "Edited" }] });
    await validateJSON(editedText);
    expect(LabelRuleImportExport.preview).toHaveBeenCalledWith(
      expect.objectContaining({ fileText: editedText }),
    );
  });

  test("rejects oversized files before reading them or validating", async () => {
    renderModal();
    jest.spyOn(FileReader.prototype, "readAsText");
    const file: File = new File([fileText], "too-large.json");
    Object.defineProperty(file, "size", { value: 10 * 1024 * 1024 + 1 });
    fireEvent.change(screen.getByLabelText("Upload JSON file"), {
      target: { files: [file] },
    });

    await screen.findByText("Choose a JSON file smaller than 10 MB.");
    expect(FileReader.prototype.readAsText).not.toHaveBeenCalled();
    expect(LabelRuleImportExport.preview).not.toHaveBeenCalled();
    expect(LabelRuleImportExport.importPreview).not.toHaveBeenCalled();
    expect(screen.getByLabelText("JSON")).toBeEnabled();
  });

  test("reports file read errors and restores the JSON editor", async () => {
    jest.spyOn(FileReader.prototype, "readAsText").mockImplementation(function (
      this: FileReader,
    ): void {
      this.onerror?.call(
        this,
        new ProgressEvent("error") as ProgressEvent<FileReader>,
      );
    });
    renderModal();
    fireEvent.change(screen.getByLabelText("Upload JSON file"), {
      target: { files: [new File([fileText], "unreadable.json")] },
    });

    await screen.findByText(
      "Could not read the selected file. Please try again.",
    );
    expect(screen.getByLabelText("JSON")).toBeEnabled();
    expect(LabelRuleImportExport.importPreview).not.toHaveBeenCalled();
  });

  test("an oversized replacement file cancels the earlier upload and unlocks editing", async () => {
    const readers: Array<FileReader> = [];
    jest.spyOn(FileReader.prototype, "readAsText").mockImplementation(function (
      this: FileReader,
    ): void {
      readers.push(this);
    });
    renderModal();
    fireEvent.change(screen.getByLabelText("Upload JSON file"), {
      target: { files: [new File([fileText], "still-reading.json")] },
    });
    expect(screen.getByLabelText("JSON")).toBeDisabled();

    const oversizedFile: File = new File([fileText], "too-large.json");
    Object.defineProperty(oversizedFile, "size", {
      value: 10 * 1024 * 1024 + 1,
    });
    fireEvent.change(screen.getByLabelText("Upload JSON file"), {
      target: { files: [oversizedFile] },
    });
    await screen.findByText("Choose a JSON file smaller than 10 MB.");
    expect(screen.getByLabelText("JSON")).toBeEnabled();

    const firstReader: FileReader = readers[0]!;
    Object.defineProperty(firstReader, "result", { value: fileText });
    act(() => {
      firstReader.onload?.call(
        firstReader,
        new ProgressEvent("load") as ProgressEvent<FileReader>,
      );
    });
    expect(screen.getByLabelText("JSON")).toHaveValue("");
  });

  test("blocks duplicate validation and editing while reference lookups are pending", async () => {
    let finishValidation: (
      preview: LabelRuleImportPreview,
    ) => void = (): void => {};
    const pending: Promise<LabelRuleImportPreview> = new Promise(
      (resolve: (value: LabelRuleImportPreview) => void) => {
        finishValidation = resolve;
      },
    );
    jest.mocked(LabelRuleImportExport.preview).mockReturnValue(pending);
    renderModal();
    enterJSON();
    const validateButton: HTMLElement = screen.getByRole("button", {
      name: "Validate and preview",
    });
    act(() => {
      fireEvent.click(validateButton);
      fireEvent.click(validateButton);
    });

    expect(LabelRuleImportExport.preview).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("JSON")).toBeDisabled();
    expect(screen.getByLabelText("Upload JSON file")).toBeDisabled();
    expect(LabelRuleImportExport.importPreview).not.toHaveBeenCalled();
    await act(async () => {
      finishValidation(makePreview());
      await pending;
    });
    expect(
      screen.getByRole("heading", { name: "Preview import" }),
    ).toBeInTheDocument();
  });

  test("invalidates the reviewed version when returning to edit JSON", async () => {
    renderModal();
    await validateJSON();
    fireEvent.click(screen.getByRole("button", { name: "Edit JSON" }));

    expect(screen.getByLabelText("JSON")).toHaveValue(fileText);
    expect(
      screen.queryByRole("button", { name: /^Import \d/ }),
    ).not.toBeInTheDocument();

    jest
      .mocked(LabelRuleImportExport.preview)
      .mockRejectedValueOnce(new Error("The edited rule is invalid."));
    enterJSON("broken edited rules");
    fireEvent.click(
      screen.getByRole("button", { name: "Validate and preview" }),
    );

    await screen.findByText("The edited rule is invalid.");
    expect(LabelRuleImportExport.importPreview).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: /^Import \d/ }),
    ).not.toBeInTheDocument();
  });

  test("imports exactly the reviewed payload after explicit confirmation", async () => {
    const preview: LabelRuleImportPreview = makePreview(2);
    const result: LabelRuleImportResult = makeResult(2);
    const onImportComplete: ReturnType<
      typeof jest.fn<(value: LabelRuleImportResult) => void>
    > = jest.fn<(value: LabelRuleImportResult) => void>();
    jest.mocked(LabelRuleImportExport.preview).mockResolvedValue(preview);
    jest.mocked(LabelRuleImportExport.importPreview).mockResolvedValue(result);
    renderModal(onImportComplete);
    await validateJSON();

    expect(onImportComplete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Import 2 rules" }));

    await waitFor(() => {
      expect(onImportComplete).toHaveBeenCalledWith(result);
    });
    expect(LabelRuleImportExport.importPreview).toHaveBeenCalledTimes(1);
    expect(LabelRuleImportExport.importPreview).toHaveBeenCalledWith({
      preview,
      modelType: MonitorLabelRule,
      modelAPI: undefined,
      onProgress: expect.any(Function),
    });
  });

  test("blocks duplicate submissions while the import is pending", async () => {
    let finishImport: (result: LabelRuleImportResult) => void = (): void => {};
    const pending: Promise<LabelRuleImportResult> = new Promise(
      (resolve: (value: LabelRuleImportResult) => void) => {
        finishImport = resolve;
      },
    );
    jest.mocked(LabelRuleImportExport.importPreview).mockReturnValue(pending);
    const onImportComplete: ReturnType<
      typeof jest.fn<(value: LabelRuleImportResult) => void>
    > = jest.fn<(value: LabelRuleImportResult) => void>();
    renderModal(onImportComplete);
    await validateJSON();

    const submit: HTMLElement = screen.getByRole("button", {
      name: /^Import 1 rule/,
    });
    act(() => {
      fireEvent.click(submit);
      fireEvent.click(submit);
    });
    expect(LabelRuleImportExport.importPreview).toHaveBeenCalledTimes(1);
    expect(onImportComplete).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("JSON")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Edit JSON" }),
    ).not.toBeInTheDocument();
    act(() => {
      jest
        .mocked(LabelRuleImportExport.importPreview)
        .mock.calls[0]![0].onProgress?.(1, 1);
    });
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "100",
    );

    await act(async () => {
      finishImport(makeResult(1));
      await pending;
    });
    expect(onImportComplete).toHaveBeenCalledTimes(1);
  });

  test("rechecks create permission after review and blocks a revoked grant", async () => {
    renderModal();
    await validateJSON();
    jest.mocked(PermissionGate.check).mockReturnValue({
      isAllowed: false,
      disabledReason: "Create permission is required.",
    });
    fireEvent.click(screen.getByRole("button", { name: "Import 1 rule" }));

    await screen.findByText("Create permission is required.");
    expect(LabelRuleImportExport.importPreview).not.toHaveBeenCalled();
  });

  test("does not import a reviewed file into a newly selected project", async () => {
    renderModal();
    await validateJSON();
    jest
      .mocked(ProjectUtil.getCurrentProjectId)
      .mockReturnValue(otherProjectId);
    fireEvent.click(screen.getByRole("button", { name: "Import 1 rule" }));

    await screen.findByText(
      "The selected project changed. Close this dialog and import again in the destination project.",
    );
    expect(LabelRuleImportExport.importPreview).not.toHaveBeenCalled();
  });

  test("retains the preview and reports a failure before import can start", async () => {
    const onImportComplete: ReturnType<
      typeof jest.fn<(value: LabelRuleImportResult) => void>
    > = jest.fn<(value: LabelRuleImportResult) => void>();
    jest
      .mocked(LabelRuleImportExport.importPreview)
      .mockRejectedValue(new Error("Preview destination does not match."));
    renderModal(onImportComplete);
    await validateJSON();
    fireEvent.click(screen.getByRole("button", { name: "Import 1 rule" }));

    await screen.findByText("Preview destination does not match.");
    expect(
      screen.getByRole("heading", { name: "Preview import" }),
    ).toBeInTheDocument();
    expect(onImportComplete).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Edit JSON" })).toBeEnabled();
  });

  test("reports partial failure and offers only failed rules for download", async () => {
    const result: LabelRuleImportResult = makeResult(1, 1);
    jest
      .mocked(LabelRuleImportExport.preview)
      .mockResolvedValue(makePreview(2));
    jest.mocked(LabelRuleImportExport.importPreview).mockResolvedValue(result);
    renderModal();
    await validateJSON();
    fireEvent.click(screen.getByRole("button", { name: "Import 2 rules" }));

    await screen.findByText("The server could not save this rule.", {
      exact: false,
    });
    expect(
      screen.queryByRole("button", { name: /^Import \d/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Retry/i }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Download failed rules" }),
    );
    expect(ModelImportExportUtil.downloadJSONFile).toHaveBeenCalledTimes(1);
    const download: { filename: string; content: string } = jest.mocked(
      ModelImportExportUtil.downloadJSONFile,
    ).mock.calls[0]![0];
    expect(JSON.parse(download.content).items).toEqual([
      result.retryPreview.items[0]!.portableJson,
    ]);
    expect(download.content).not.toContain("Production rule 1");
    expect(LabelRuleImportExport.importPreview).toHaveBeenCalledTimes(1);
  });
});

describe("label rule table import and export", () => {
  test("preserves existing card content, actions, and table configuration", () => {
    const onExistingAction: ReturnType<typeof jest.fn<() => void>> =
      jest.fn<() => void>();
    const tableOptions: Partial<ModelTableProps<MonitorLabelRule>> = {
      refreshToggle: "parent-refresh",
      query: { name: "Filtered rule" },
      initialItemsOnPage: 5,
      isEditable: true,
      isViewable: true,
      enableJsonImportExport: true,
      cardProps: {
        title: "Custom title",
        description: "Existing description",
        buttons: [
          {
            title: "Run Rules",
            icon: IconProp.Play,
            onClick: onExistingAction,
          },
          <span key="help">Existing custom control</span>,
        ],
      },
      actionButtons: [],
      bulkActions: { buttons: [] },
    };
    renderTable(tableOptions);

    expect(screen.getByText("Custom title")).toBeInTheDocument();
    expect(screen.getByText("Existing description")).toBeInTheDocument();
    expect(screen.getByText("Existing custom control")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Run Rules" }));
    expect(onExistingAction).toHaveBeenCalledTimes(1);
    expect(lastTableProps()).toMatchObject({
      query: tableOptions.query,
      initialItemsOnPage: 5,
      isEditable: true,
      isViewable: true,
      enableJsonImportExport: false,
      actionButtons: tableOptions.actionButtons,
      bulkActions: tableOptions.bulkActions,
    });
    expect(lastTableProps().refreshToggle).toContain("parent-refresh");
    expect(tableOptions.cardProps?.buttons).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Export JSON" })).toHaveLength(
      1,
    );
    expect(screen.getAllByRole("button", { name: "Import JSON" })).toHaveLength(
      1,
    );
  });

  test("allows a read-only user to export while disabling import", async () => {
    jest
      .mocked(PermissionGate.check)
      .mockImplementation(
        (
          _model: PermissionCheckableModel,
          action: ModelAction,
        ): PermissionGateResult => {
          return action === ModelAction.Read
            ? { isAllowed: true }
            : {
                isAllowed: false,
                disabledReason: "Create permission is required.",
              };
        },
      );
    renderTable();

    expect(screen.getByRole("button", { name: "Export JSON" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Import JSON" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Import JSON" }));
    expect(screen.queryByLabelText("JSON")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Export JSON" }));
    await waitFor(() => {
      expect(LabelRuleImportExport.exportAll).toHaveBeenCalledTimes(1);
    });
    expect(LabelRuleImportExport.importPreview).not.toHaveBeenCalled();
  });

  test("disables export without read permission", () => {
    jest
      .mocked(PermissionGate.check)
      .mockImplementation(
        (
          _model: PermissionCheckableModel,
          action: ModelAction,
        ): PermissionGateResult => {
          return action === ModelAction.Read
            ? {
                isAllowed: false,
                disabledReason: "Read permission is required.",
              }
            : { isAllowed: true };
        },
      );
    renderTable();

    expect(screen.getByRole("button", { name: "Export JSON" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Export JSON" }));
    expect(LabelRuleImportExport.exportAll).not.toHaveBeenCalled();
  });

  test("hides permission-gated actions while the permission snapshot loads", () => {
    jest.mocked(PermissionGate.check).mockReturnValue({ isAllowed: false });
    renderTable();

    expect(
      screen.queryByRole("button", { name: "Export JSON" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Import JSON" }),
    ).not.toBeInTheDocument();
  });

  test("exports every project rule without forwarding visible filters or pagination", async () => {
    const envelope: JSONObject = {
      resourceType: "MonitorLabelRule",
      items: [{ name: "Page one" }, { name: "Another page and filter" }],
    };
    jest.mocked(LabelRuleImportExport.exportAll).mockResolvedValue(envelope);
    renderTable({
      query: { name: "Page one" },
      initialItemsOnPage: 1,
      modelAPI: ModelAPI,
    });
    fireEvent.click(screen.getByRole("button", { name: "Export JSON" }));

    await waitFor(() => {
      expect(ModelImportExportUtil.downloadJSONFile).toHaveBeenCalledWith({
        filename: expect.stringMatching(/\.json$/),
        content: JSON.stringify(envelope, null, 2),
      });
    });
    expect(LabelRuleImportExport.exportAll).toHaveBeenCalledWith({
      projectId,
      modelType: MonitorLabelRule,
      modelAPI: ModelAPI,
    });
  });

  test("reports export failure and lets the user try again", async () => {
    jest
      .mocked(LabelRuleImportExport.exportAll)
      .mockRejectedValueOnce(new Error("Could not load all label rules."));
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: "Export JSON" }));

    await screen.findByText("Could not load all label rules.");
    expect(ModelImportExportUtil.downloadJSONFile).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Export JSON" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Export JSON" }));
    await waitFor(() => {
      expect(ModelImportExportUtil.downloadJSONFile).toHaveBeenCalledTimes(1);
    });
  });

  test("downloads once when export is clicked repeatedly during a pending fetch", async () => {
    let finishExport: (envelope: JSONObject) => void = (): void => {};
    const pending: Promise<JSONObject> = new Promise(
      (resolve: (value: JSONObject) => void) => {
        finishExport = resolve;
      },
    );
    jest.mocked(LabelRuleImportExport.exportAll).mockReturnValue(pending);
    renderTable();
    const exportButton: HTMLElement = screen.getByRole("button", {
      name: "Export JSON",
    });
    act(() => {
      fireEvent.click(exportButton);
      fireEvent.click(exportButton);
    });

    expect(LabelRuleImportExport.exportAll).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Export JSON" })).toBeDisabled();
    await act(async () => {
      finishExport({ resourceType: "MonitorLabelRule", items: [] });
      await pending;
    });
    expect(ModelImportExportUtil.downloadJSONFile).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Export JSON" })).toBeEnabled();
  });

  test.each(["Import JSON", "Export JSON"])(
    "requires a selected project for %s",
    async (buttonTitle: string) => {
      jest.mocked(ProjectUtil.getCurrentProjectId).mockReturnValue(null);
      renderTable();
      fireEvent.click(screen.getByRole("button", { name: buttonTitle }));

      await screen.findByText(/Select a project before/);
      expect(screen.queryByLabelText("JSON")).not.toBeInTheDocument();
      expect(LabelRuleImportExport.exportAll).not.toHaveBeenCalled();
      expect(LabelRuleImportExport.importPreview).not.toHaveBeenCalled();
    },
  );

  test("blocks validation if the selected project changed after opening the dialog", async () => {
    renderTable();
    await openImport();
    jest
      .mocked(ProjectUtil.getCurrentProjectId)
      .mockReturnValue(otherProjectId);
    enterJSON();
    fireEvent.click(
      screen.getByRole("button", { name: "Validate and preview" }),
    );

    await screen.findByText(
      "The selected project changed. Close this dialog and import again in the destination project.",
    );
    expect(LabelRuleImportExport.preview).not.toHaveBeenCalled();
    expect(LabelRuleImportExport.importPreview).not.toHaveBeenCalled();
  });

  test.each([
    [0, 0],
    [0, 1],
    [1, 0],
  ])(
    "refreshes after attempted writes, including unknown outcomes (%i successes, %i failures)",
    async (successCount: number, failedCount: number) => {
      jest
        .mocked(LabelRuleImportExport.importPreview)
        .mockResolvedValue(makeResult(successCount, failedCount));
      renderTable({ refreshToggle: "external-refresh" });
      const initialRefresh: string | undefined = lastTableProps().refreshToggle;
      await openImport();
      await validateJSON();
      fireEvent.click(screen.getByRole("button", { name: /^Import 1 rule/ }));

      await screen.findByRole("heading", { name: /Import complete/i });
      // A failed response may follow a committed write. Reload the rules so
      // the user can check whether an apparently failed row was saved.
      if (successCount + failedCount > 0) {
        expect(lastTableProps().refreshToggle).not.toBe(initialRefresh);
      } else {
        expect(lastTableProps().refreshToggle).toBe(initialRefresh);
      }
      expect(lastTableProps().refreshToggle).toContain("external-refresh");
    },
  );
});
