import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CodeType from "../../../Types/Code/CodeType";
import { JSONObject } from "../../../Types/JSON";
import API from "../../Utils/API/API";
import ModelAPI from "../../Utils/ModelAPI/ModelAPI";
import ModelImportExportUtil, {
  ImportFailure,
  ImportResult,
} from "../../Utils/ModelImportExport";
import Alert, { AlertType } from "../Alerts/Alert";
import { ButtonStyleType } from "../Button/Button";
import CodeEditor from "../CodeEditor/CodeEditor";
import Modal, { ModalWidth } from "../Modal/Modal";
import ProgressBar from "../ProgressBar/ProgressBar";
import React, { ReactElement, useState } from "react";

export interface ComponentProps<TBaseModel extends BaseModel> {
  modelType: { new (): TBaseModel };
  onClose: () => void;
  onImportComplete: (result: ImportResult) => void;
  modelAPI?: typeof ModelAPI | undefined;
}

enum ImportPhase {
  Edit = "Edit",
  Importing = "Importing",
  Done = "Done",
}

const ImportModelsModal: <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
) => ReactElement = <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
): ReactElement => {
  const model: TBaseModel = new props.modelType();
  const singularName: string = model.singularName || "Resource";
  const pluralName: string = model.pluralName || "Resources";

  const [phase, setPhase] = useState<ImportPhase>(ImportPhase.Edit);
  const [fileText, setFileText] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [completedCount, setCompletedCount] = useState<number>(0);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [result, setResult] = useState<ImportResult | null>(null);

  type OnFileSelectedFunction = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => void;

  const onFileSelected: OnFileSelectedFunction = (
    event: React.ChangeEvent<HTMLInputElement>,
  ): void => {
    const file: File | undefined = event.target.files?.[0];

    if (!file) {
      return;
    }

    const reader: FileReader = new FileReader();

    reader.onload = (): void => {
      setFileText((reader.result as string) || "");
      setError("");
    };

    reader.onerror = (): void => {
      setError("Could not read the selected file. Please try again.");
    };

    reader.readAsText(file);

    // allow re-selecting the same file after editing.
    event.target.value = "";
  };

  type StartImportFunction = () => Promise<void>;

  const startImport: StartImportFunction = async (): Promise<void> => {
    setError("");

    let itemJsons: Array<JSONObject> = [];

    try {
      itemJsons = ModelImportExportUtil.parseImportFileText({
        modelType: props.modelType,
        fileText: fileText,
      });
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      return;
    }

    setPhase(ImportPhase.Importing);
    setCompletedCount(0);
    setTotalCount(itemJsons.length);

    try {
      const importResult: ImportResult =
        await ModelImportExportUtil.importItems({
          modelType: props.modelType,
          itemJsons: itemJsons,
          modelAPI: props.modelAPI,
          onProgress: (completed: number, total: number) => {
            setCompletedCount(completed);
            setTotalCount(total);
          },
        });

      setResult(importResult);
      setPhase(ImportPhase.Done);
      props.onImportComplete(importResult);
    } catch (err) {
      // never trap the user in the importing phase - return to the editor.
      setError(API.getFriendlyMessage(err));
      setPhase(ImportPhase.Edit);
    }
  };

  if (phase === ImportPhase.Importing) {
    return (
      <Modal
        title={`Importing ${pluralName}`}
        description={`Please wait while your ${pluralName.toLowerCase()} are being imported.`}
        isBodyLoading={false}
        onSubmit={() => {}}
        disableSubmitButton={true}
        submitButtonText={"Importing..."}
      >
        <div className="mt-5 mb-5">
          <ProgressBar
            count={completedCount}
            totalCount={totalCount}
            suffix={pluralName}
          />
        </div>
      </Modal>
    );
  }

  if (phase === ImportPhase.Done && result) {
    return (
      <Modal
        title={`Import Complete`}
        onSubmit={() => {
          props.onClose();
        }}
        submitButtonText={"Close"}
        submitButtonStyleType={ButtonStyleType.NORMAL}
      >
        <div className="mt-5 mb-5 space-y-3">
          {result.successCount > 0 ? (
            <Alert
              type={AlertType.SUCCESS}
              strongTitle={`${result.successCount} ${
                result.successCount === 1 ? singularName : pluralName
              } imported successfully.`}
            />
          ) : (
            <></>
          )}

          {result.failures.length > 0 ? (
            <div>
              <Alert
                type={AlertType.DANGER}
                strongTitle={`${result.failures.length} ${
                  result.failures.length === 1 ? singularName : pluralName
                } could not be imported.`}
              />
              <ul className="mt-3 list-disc pl-5 text-sm text-gray-600">
                {result.failures.map(
                  (failure: ImportFailure, index: number) => {
                    return (
                      <li key={index} className="mt-1">
                        <span className="font-medium">{failure.itemName}</span>:{" "}
                        {failure.errorMessage}
                      </li>
                    );
                  },
                )}
              </ul>
            </div>
          ) : (
            <></>
          )}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title={`Import ${pluralName}`}
      description={`Upload a ${singularName.toLowerCase()} JSON export file, or paste its contents below. New ${pluralName.toLowerCase()} will be created in this project. Related resources (like owners, labels, or other linked resources) are not part of export files, and references to resources from another project may need to be re-selected after import.`}
      modalWidth={ModalWidth.Large}
      onClose={props.onClose}
      onSubmit={async () => {
        await startImport();
      }}
      disableSubmitButton={!fileText.trim()}
      submitButtonText={`Import`}
      error={error || undefined}
    >
      <div className="mt-5 mb-5">
        <label
          htmlFor="import-file-input"
          className="block text-sm font-medium text-gray-700"
        >
          Select export file
        </label>
        <input
          id="import-file-input"
          data-testid="import-file-input"
          type="file"
          accept=".json,application/json"
          onChange={onFileSelected}
          className="mt-2 block w-full text-sm text-gray-600 file:mr-4 file:rounded-md file:border-0 file:bg-indigo-50 file:py-2 file:px-4 file:text-sm file:font-semibold file:text-indigo-700 hover:file:bg-indigo-100"
        />

        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Or paste the export JSON
          </label>
          <CodeEditor
            type={CodeType.JSON}
            value={fileText}
            onChange={(value: string) => {
              setFileText(value);
              setError("");
            }}
            placeholder={`Paste your ${singularName.toLowerCase()} export JSON here.`}
          />
        </div>
      </div>
    </Modal>
  );
};

export default ImportModelsModal;
