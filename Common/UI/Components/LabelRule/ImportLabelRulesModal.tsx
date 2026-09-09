import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ObjectID from "../../../Types/ObjectID";
import API from "../../Utils/API/API";
import LabelRuleImportExport, {
  LabelRuleImportItem,
  LabelRuleImportFailure,
  LabelRuleImportPreview,
  LabelRuleImportResult,
} from "../../Utils/LabelRuleImportExport";
import ModelAPI from "../../Utils/ModelAPI/ModelAPI";
import ModelImportExportUtil from "../../Utils/ModelImportExport";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "../../Utils/PermissionGate";
import ProjectUtil from "../../Utils/Project";
import Alert, { AlertType } from "../Alerts/Alert";
import Button, { ButtonStyleType } from "../Button/Button";
import Modal, { ModalWidth } from "../Modal/Modal";
import ProgressBar from "../ProgressBar/ProgressBar";
import React, { ReactElement, useRef, useState } from "react";

export interface ComponentProps<TBaseModel extends BaseModel> {
  modelType: { new (): TBaseModel };
  modelAPI?: typeof ModelAPI | undefined;
  projectId: ObjectID;
  onClose: () => void;
  onImportComplete: (result: LabelRuleImportResult) => void;
}

const PAGE_SIZE: number = 20;
const MAX_FILE_BYTES: number = 10 * 1024 * 1024;

const ImportLabelRulesModal: <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
) => ReactElement = <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
): ReactElement => {
  const model: TBaseModel = new props.modelType();
  const [fileText, setFileText] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [preview, setPreview] = useState<LabelRuleImportPreview | null>(null);
  const [result, setResult] = useState<LabelRuleImportResult | null>(null);
  const [isValidating, setIsValidating] = useState<boolean>(false);
  const [isReadingFile, setIsReadingFile] = useState<boolean>(false);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [completed, setCompleted] = useState<number>(0);
  const [page, setPage] = useState<number>(0);
  const busy: React.MutableRefObject<boolean> = useRef(false);
  const fileReadVersion: React.MutableRefObject<number> = useRef(0);

  const checkDestination: () => void = (): void => {
    if (
      ProjectUtil.getCurrentProjectId()?.toString() !==
      props.projectId.toString()
    ) {
      throw new Error(
        "The selected project changed. Close this dialog and import again in the destination project.",
      );
    }
    const gate: PermissionGateResult = PermissionGate.check(
      model,
      ModelAction.Create,
    );
    if (!gate.isAllowed) {
      throw new Error(
        gate.disabledReason ||
          "You do not have permission to create these label rules.",
      );
    }
  };

  const validate: () => Promise<void> = async (): Promise<void> => {
    if (busy.current) {
      return;
    }
    busy.current = true;
    setError("");
    setIsValidating(true);
    try {
      checkDestination();
      const validated: LabelRuleImportPreview =
        await LabelRuleImportExport.preview({
          modelType: props.modelType,
          modelAPI: props.modelAPI,
          projectId: props.projectId,
          fileText,
        });
      setPreview(validated);
      setPage(0);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      busy.current = false;
      setIsValidating(false);
    }
  };

  const startImport: () => Promise<void> = async (): Promise<void> => {
    if (!preview || busy.current || result) {
      return;
    }
    busy.current = true;
    setError("");
    try {
      checkDestination();
      setIsImporting(true);
      setCompleted(0);
      const imported: LabelRuleImportResult =
        await LabelRuleImportExport.importPreview({
          preview,
          modelType: props.modelType,
          modelAPI: props.modelAPI,
          onProgress: (count: number) => {
            setCompleted(count);
          },
        });
      setResult(imported);
      props.onImportComplete(imported);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      busy.current = false;
      setIsImporting(false);
    }
  };

  const onFileSelected: (event: React.ChangeEvent<HTMLInputElement>) => void = (
    event: React.ChangeEvent<HTMLInputElement>,
  ): void => {
    const file: File | undefined = event.target.files?.[0];
    event.target.value = "";
    if (!file || busy.current) {
      return;
    }
    fileReadVersion.current += 1;
    const version: number = fileReadVersion.current;
    setPreview(null);
    setFileText("");
    setError("");
    setIsReadingFile(false);
    if (file.size > MAX_FILE_BYTES) {
      setError("Choose a JSON file smaller than 10 MB.");
      return;
    }
    setIsReadingFile(true);
    const reader: FileReader = new FileReader();
    reader.onload = (): void => {
      if (version !== fileReadVersion.current) {
        return;
      }
      setFileText(String(reader.result || ""));
      setIsReadingFile(false);
    };
    reader.onerror = (): void => {
      if (version !== fileReadVersion.current) {
        return;
      }
      setError("Could not read the selected file. Please try again.");
      setIsReadingFile(false);
    };
    reader.readAsText(file);
  };

  if (result) {
    return (
      <Modal
        title="Import complete"
        modalWidth={ModalWidth.Large}
        onSubmit={props.onClose}
        onClose={props.onClose}
        submitButtonText="Close"
      >
        <div className="space-y-4 py-4">
          <Alert
            type={
              result.failures.length ? AlertType.WARNING : AlertType.SUCCESS
            }
            title={`${result.successCount} ${result.successCount === 1 ? "rule" : "rules"} imported successfully. ${result.failures.length} failed.`}
          />
          {result.failures.length > 0 && (
            <>
              <p className="text-sm text-gray-600">
                Download the failed rules to review and correct them before
                importing again. Successful rules are excluded. If a request
                timed out, check the rule list first; the server may have saved
                it.
              </p>
              <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-200 p-4">
                <ul className="space-y-2 text-sm text-gray-700">
                  {result.failures.map((failure: LabelRuleImportFailure) => {
                    return (
                      <li key={failure.index}>
                        <strong>
                          Row {failure.index}: {failure.itemName}
                        </strong>{" "}
                        — {failure.errorMessage}
                      </li>
                    );
                  })}
                </ul>
              </div>
              <Button
                title="Download failed rules"
                buttonStyle={ButtonStyleType.OUTLINE}
                onClick={() => {
                  ModelImportExportUtil.downloadJSONFile({
                    content: JSON.stringify(
                      LabelRuleImportExport.getRetryEnvelope(
                        result.retryPreview,
                      ),
                      null,
                      2,
                    ),
                    filename: "label-rules-failed.json",
                  });
                }}
              />
            </>
          )}
        </div>
      </Modal>
    );
  }

  if (isImporting && preview) {
    return (
      <Modal
        title="Importing label rules"
        submitButtonText="Importing..."
        disableSubmitButton={true}
        modalWidth={ModalWidth.Large}
      >
        <div className="py-6 space-y-4" aria-live="polite">
          <p className="text-sm text-gray-600">
            Keep this window open while the rules are created.
          </p>
          <ProgressBar
            count={completed}
            totalCount={preview.items.length}
            suffix="rules"
          />
        </div>
      </Modal>
    );
  }

  if (preview) {
    const pageCount: number = Math.ceil(preview.items.length / PAGE_SIZE);
    return (
      <Modal
        title="Preview import"
        description={`Create ${preview.items.length} ${model.pluralName?.toLowerCase()} in this project. Existing rules will be kept.`}
        modalWidth={ModalWidth.Large}
        onClose={props.onClose}
        onSubmit={startImport}
        submitButtonText={`Import ${preview.items.length} ${preview.items.length === 1 ? "rule" : "rules"}`}
        error={error || undefined}
        leftFooterElement={
          <Button
            title="Edit JSON"
            buttonStyle={ButtonStyleType.OUTLINE}
            onClick={() => {
              setPreview(null);
              setError("");
            }}
          />
        }
      >
        <div className="space-y-4 py-4">
          <Alert
            type={AlertType.SUCCESS}
            title="All rules validated. Referenced resources were found in this project."
          />
          {preview.mappings.length > 0 && (
            <div className="rounded-lg bg-gray-50 p-4 text-sm text-gray-700">
              <p className="font-medium">
                Conditions mapped to this resource type
              </p>
              <ul className="mt-2 list-disc pl-5">
                {preview.mappings.map((mapping: string) => {
                  return <li key={mapping}>{mapping}</li>;
                })}
              </ul>
            </div>
          )}
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-3">Rule</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Labels to add</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {preview.items
                  .slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
                  .map((item: LabelRuleImportItem) => {
                    return (
                      <tr key={item.index}>
                        <td className="px-4 py-3 align-top">
                          <div className="font-medium text-gray-900">
                            {item.name}
                          </div>
                          {item.description && (
                            <p className="mt-1 text-gray-500">
                              {item.description}
                            </p>
                          )}
                          <details className="mt-2 text-gray-500">
                            <summary className="cursor-pointer text-indigo-600">
                              View conditions and actions
                            </summary>
                            <pre className="mt-2 max-w-md overflow-auto whitespace-pre-wrap break-words rounded bg-gray-50 p-3 text-xs">
                              {JSON.stringify(item.displayJson, null, 2)}
                            </pre>
                          </details>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <span
                            className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${item.isEnabled ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-600"}`}
                          >
                            {item.isEnabled ? "Enabled" : "Disabled"}
                          </span>
                        </td>
                        <td className="px-4 py-3 align-top text-gray-600">
                          {item.labels.join(", ") || "None"}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between gap-3 text-sm text-gray-500">
            <span>
              {preview.items.length}{" "}
              {preview.items.length === 1 ? "rule" : "rules"} · Page {page + 1}{" "}
              of {pageCount}
            </span>
            {pageCount > 1 && (
              <div className="flex gap-2">
                <Button
                  title="Previous"
                  buttonStyle={ButtonStyleType.OUTLINE}
                  disabled={page === 0}
                  onClick={() => {
                    setPage(page - 1);
                  }}
                />
                <Button
                  title="Next"
                  buttonStyle={ButtonStyleType.OUTLINE}
                  disabled={page + 1 >= pageCount}
                  onClick={() => {
                    setPage(page + 1);
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title={`Import ${model.pluralName}`}
      description="Upload or paste a label rule JSON export. Review the validated rules before creating them in this project."
      modalWidth={ModalWidth.Large}
      onClose={isValidating ? undefined : props.onClose}
      onSubmit={validate}
      submitButtonText="Validate and preview"
      isLoading={isValidating}
      disableSubmitButton={!fileText.trim() || isValidating || isReadingFile}
      error={error || undefined}
    >
      <div className="space-y-5 py-4">
        <div className="rounded-lg bg-gray-50 p-4 text-sm text-gray-600">
          Labels, monitors, and severities are matched by exact name in the
          destination project. Create missing resources first. Conditions that
          cannot be used with this resource type must be corrected before
          importing.
        </div>
        <div>
          <label
            htmlFor="label-rule-import-file"
            className="block text-sm font-medium text-gray-700"
          >
            Upload JSON file
          </label>
          <input
            id="label-rule-import-file"
            data-testid="label-rule-import-file"
            type="file"
            accept=".json,application/json"
            disabled={isValidating}
            onChange={onFileSelected}
            className="mt-2 block w-full text-sm text-gray-500 file:mr-4 file:rounded-md file:border-0 file:bg-indigo-50 file:px-4 file:py-2 file:font-medium file:text-indigo-700"
          />
        </div>
        <div>
          <p className="mb-3 text-sm">
            <a
              href="/docs/configuration/label-rule-import-export"
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-600 hover:text-indigo-800"
            >
              JSON format and examples
            </a>
          </p>
          <label
            htmlFor="label-rule-import-json"
            className="mb-2 block text-sm font-medium text-gray-700"
          >
            JSON
          </label>
          <textarea
            id="label-rule-import-json"
            data-testid="label-rule-import-json"
            value={fileText}
            disabled={isValidating || isReadingFile}
            rows={12}
            spellCheck={false}
            placeholder="Paste your label rule JSON export here."
            className="block w-full rounded-lg border border-gray-300 p-3 font-mono text-xs text-gray-800 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
              setFileText(event.target.value);
              setError("");
            }}
          />
        </div>
      </div>
    </Modal>
  );
};

export default ImportLabelRulesModal;
