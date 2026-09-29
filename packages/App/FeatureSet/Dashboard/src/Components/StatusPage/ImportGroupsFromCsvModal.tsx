import {
  ExistingStatusPageGroup,
  ParsedStatusPageGroupRow,
  STATUS_PAGE_GROUP_CSV_COLUMNS,
  STATUS_PAGE_GROUP_CSV_EXAMPLE,
  StatusPageGroupCsvError,
  StatusPageGroupCsvParseResult,
  parseStatusPageGroupCsv,
} from "../../Utils/StatusPageGroupCsv";
import {
  CreateStatusPageGroupFunction,
  StatusPageGroupCreateResult,
  StatusPageGroupImportProgress,
  StatusPageGroupImportRowResult,
  StatusPageGroupImportSummary,
  runStatusPageGroupImport,
} from "../../Utils/StatusPageGroupImportRunner";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import StatusPageGroup from "Common/Models/DatabaseModels/StatusPageGroup";
import StatusPageGroupTreeUtil from "Common/Utils/StatusPage/GroupTree";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { PromiseVoidFunction, VoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import StatusPageGroupViewMode from "Common/Types/StatusPage/StatusPageGroupViewMode";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ProgressBar, {
  ProgressBarSize,
} from "Common/UI/Components/ProgressBar/ProgressBar";
import TextArea from "Common/UI/Components/TextArea/TextArea";
import API from "Common/UI/Utils/API/API";
import downloadFile from "Common/UI/Utils/DownloadFile";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import React, {
  FunctionComponent,
  ReactElement,
  useRef,
  useState,
} from "react";

/*
 * Bulk CSV import for Status Page Groups, reached from the ⋯ menu on the
 * Groups table — the same place every other table in the product hides its
 * bulk actions.
 *
 * Parsing and dependency planning live in the react-free
 * Utils/StatusPageGroupCsv module, and the sequential create loop in
 * Utils/StatusPageGroupImportRunner; this component only wires them to a
 * textarea, a file input, and the ModelAPI.
 *
 * Groups nest, so the file may name a parent it also creates. The groups
 * already on the page are fetched at import time (not when the modal opens)
 * so a group added from the table a moment ago is still a usable parent, and
 * so their depths are current for the nesting-limit check.
 */

export interface ComponentProps {
  statusPageId: ObjectID;
  projectId: ObjectID;
  onClose: () => void;
  /*
   * Fired once, after a run that created at least one group, so the table
   * behind the modal can refetch while the modal stays open on its results.
   */
  onImportComplete: () => void;
}

const ImportGroupsFromCsvModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [csvText, setCsvText] = useState<string>("");
  const [parseResult, setParseResult] =
    useState<StatusPageGroupCsvParseResult | null>(null);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [hasImported, setHasImported] = useState<boolean>(false);
  const [importedCount, setImportedCount] = useState<number>(0);
  const [importTotal, setImportTotal] = useState<number>(0);
  const [rowResults, setRowResults] = useState<
    Array<StatusPageGroupImportRowResult>
  >([]);
  const [importError, setImportError] = useState<string>("");

  const fileInputRef: React.MutableRefObject<HTMLInputElement | null> =
    useRef<HTMLInputElement | null>(null);

  type HandleFileChangeFunction = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => void;

  const handleFileChange: HandleFileChangeFunction = (
    event: React.ChangeEvent<HTMLInputElement>,
  ): void => {
    const file: File | undefined = event.target.files?.[0];
    if (!file) {
      return;
    }
    const reader: FileReader = new FileReader();
    reader.onload = () => {
      const text: string = (reader.result as string) || "";
      setCsvText(text);
      setParseResult(parseStatusPageGroupCsv(text));
      setRowResults([]);
      setImportError("");
      setHasImported(false);
    };
    reader.readAsText(file);
    // Allow re-choosing the same file later.
    event.target.value = "";
  };

  const previewCsv: VoidFunction = (): void => {
    setParseResult(parseStatusPageGroupCsv(csvText));
    setRowResults([]);
    setImportError("");
    setHasImported(false);
  };

  /*
   * One group, one POST. The runner decides the order and hands over the
   * parent's id; everything here is the mapping onto the model plus turning
   * an API rejection into a message the results table can show.
   *
   * `order` is deliberately never written: StatusPageGroupService assigns the
   * next one on create, so an imported group lands at the bottom of the page
   * in file order instead of shuffling the groups that were already there.
   */
  const createGroup: CreateStatusPageGroupFunction = async (
    row: ParsedStatusPageGroupRow,
    parentStatusPageGroupId: string | undefined,
  ): Promise<StatusPageGroupCreateResult> => {
    try {
      const group: StatusPageGroup = new StatusPageGroup();
      group.projectId = props.projectId;
      group.statusPageId = props.statusPageId;
      group.name = row.name;

      if (parentStatusPageGroupId) {
        group.parentStatusPageGroupId = new ObjectID(parentStatusPageGroupId);
      }

      if (row.description !== "") {
        group.description = row.description;
      }

      /*
       * Blank cells are left off the model entirely rather than sent as a
       * value — the column default is what the create form would have used,
       * and an import must not decide a toggle the author never mentioned.
       */
      if (row.isExpandedByDefault !== undefined) {
        group.isExpandedByDefault = row.isExpandedByDefault;
      }

      if (row.showCurrentStatus !== undefined) {
        group.showCurrentStatus = row.showCurrentStatus;
      }

      if (row.showUptimePercent !== undefined) {
        group.showUptimePercent = row.showUptimePercent;
      }

      if (row.uptimePercentPrecision !== undefined) {
        group.uptimePercentPrecision = row.uptimePercentPrecision;
      }

      if (row.viewMode !== undefined) {
        group.viewMode = row.viewMode;
      }

      if (row.viewMode === StatusPageGroupViewMode.Grid) {
        if (row.rowAxisLabel !== "") {
          group.rowAxisLabel = row.rowAxisLabel;
        }
        if (row.rowAxisValues !== "") {
          group.rowAxisValues = row.rowAxisValues;
        }
        if (row.columnAxisLabel !== "") {
          group.columnAxisLabel = row.columnAxisLabel;
        }
        if (row.columnAxisValues !== "") {
          group.columnAxisValues = row.columnAxisValues;
        }
      }

      const response: HTTPResponse<
        JSONObject | JSONArray | StatusPageGroup | Array<StatusPageGroup>
      > = await ModelAPI.create<StatusPageGroup>({
        model: group,
        modelType: StatusPageGroup,
      });

      const created: StatusPageGroup = response.data as StatusPageGroup;

      return {
        created: true,
        statusPageGroupId: created._id?.toString() || created.id?.toString(),
      };
    } catch (err) {
      return { created: false, errorMessage: API.getFriendlyMessage(err) };
    }
  };

  const importGroups: PromiseVoidFunction = async (): Promise<void> => {
    if (!parseResult || parseResult.rows.length === 0) {
      return;
    }

    setIsImporting(true);
    setImportError("");
    setRowResults([]);
    setImportedCount(0);

    try {
      /*
       * The groups already on this status page: they can be parents of
       * imported rows, rows that collide with them are skipped, and their
       * depth decides whether a child would breach the nesting limit.
       */
      const existing: ListResult<StatusPageGroup> =
        await ModelAPI.getList<StatusPageGroup>({
          modelType: StatusPageGroup,
          query: {
            statusPageId: props.statusPageId,
            projectId: props.projectId,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            name: true,
            parentStatusPageGroupId: true,
          },
          sort: {
            order: SortOrder.Ascending,
          },
        });

      const existingGroups: Array<ExistingStatusPageGroup> = existing.data
        .filter((group: StatusPageGroup) => {
          return Boolean(group._id && group.name);
        })
        .map((group: StatusPageGroup): ExistingStatusPageGroup => {
          return {
            id: group._id!.toString(),
            name: group.name!,
            depth: StatusPageGroupTreeUtil.getDepth({
              statusPageGroup: group,
              statusPageGroups: existing.data,
            }),
          };
        });

      const summary: StatusPageGroupImportSummary =
        await runStatusPageGroupImport({
          rows: parseResult.rows,
          existingGroups: existingGroups,
          createGroup: createGroup,
          onProgress: (progress: StatusPageGroupImportProgress): void => {
            setRowResults(progress.results);
            setImportedCount(progress.createdCount);
            setImportTotal(progress.totalToCreate);
          },
        });

      setHasImported(true);

      /*
       * Per-row outcomes stay on the result table the modal keeps open;
       * only the parent needs telling that something was created.
       */
      if (summary.createdCount > 0) {
        props.onImportComplete();
      }
    } catch (err) {
      setImportError(API.getFriendlyMessage(err));
    }

    setIsImporting(false);
  };

  const rows: Array<ParsedStatusPageGroupRow> = parseResult?.rows || [];
  const parseErrors: Array<StatusPageGroupCsvError> = parseResult?.errors || [];

  const canImport: boolean = Boolean(
    parseResult && rows.length > 0 && parseErrors.length === 0,
  );

  /*
   * Once a run has finished the footer stops offering "Import" — re-pressing
   * it would replay the whole file against a status page that now contains
   * half of it. Editing the CSV or previewing again re-arms it.
   */
  const submitButtonText: string = hasImported
    ? "Done"
    : rows.length > 0
      ? `Import ${rows.length} Group${rows.length === 1 ? "" : "s"}`
      : "Import";

  type DescribeOptionsFunction = (row: ParsedStatusPageGroupRow) => string;

  /*
   * Only what the row actually says. A blank cell is the model's default, and
   * printing a guess at it here would tell the reader the file contains a
   * decision it does not.
   */
  const describeOptions: DescribeOptionsFunction = (
    row: ParsedStatusPageGroupRow,
  ): string => {
    const parts: Array<string> = [];

    if (row.isExpandedByDefault !== undefined) {
      parts.push(row.isExpandedByDefault ? "Expanded" : "Collapsed");
    }
    if (row.showCurrentStatus !== undefined) {
      parts.push(row.showCurrentStatus ? "Status shown" : "Status hidden");
    }
    if (row.showUptimePercent !== undefined) {
      parts.push(
        row.showUptimePercent
          ? `Uptime % (${row.uptimePercentPrecision})`
          : "No uptime %",
      );
    }

    return parts.join(", ");
  };

  return (
    <Modal
      title="Import Groups from CSV"
      description="Bulk-create the groups on this status page from a CSV file."
      modalWidth={ModalWidth.Large}
      onClose={() => {
        if (isImporting) {
          return;
        }
        props.onClose();
      }}
      closeButtonText={hasImported ? "Close" : "Cancel"}
      submitButtonText={submitButtonText}
      isLoading={isImporting}
      disableSubmitButton={isImporting || (!hasImported && !canImport)}
      onSubmit={() => {
        if (hasImported) {
          props.onClose();
          return;
        }

        importGroups().catch((err: Error) => {
          setImportError(API.getFriendlyMessage(err));
          setIsImporting(false);
        });
      }}
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-500">
          Columns: {STATUS_PAGE_GROUP_CSV_COLUMNS.join(", ")}. Only name is
          required — leave any other column blank to keep the default. Rows
          whose parentName is empty or already exists import first, then their
          children, so parents and children can live in the same file. Rows with
          an unresolvable parent are skipped and reported. The axis columns
          apply only when viewMode is {StatusPageGroupViewMode.Grid}; wrap their
          comma-separated lists in quotes.
        </p>

        <TextArea
          id="status-page-group-import-csv"
          value={csvText}
          placeholder={STATUS_PAGE_GROUP_CSV_EXAMPLE}
          onChange={(value: string) => {
            setCsvText(value);
            /*
             * The import runs off parseResult, not off this text, so a parse
             * the user has since edited away must not stay armed — otherwise
             * fixing a typo here and hitting Import would create the pre-edit
             * rows. Dropping it disables the button until they preview again.
             */
            setParseResult(null);
            setRowResults([]);
            setImportError("");
            setHasImported(false);
          }}
          disableSpellCheck={true}
        />

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv,text/plain"
            className="hidden"
            data-testid="status-page-group-import-file-input"
            onChange={handleFileChange}
          />
          <Button
            title="Choose CSV File"
            buttonStyle={ButtonStyleType.OUTLINE}
            disabled={isImporting}
            onClick={() => {
              fileInputRef.current?.click();
            }}
          />
          {/*
           * The same example the textarea shows as its placeholder, as a file
           * — a spreadsheet is where most of these files are actually built,
           * and re-typing twelve column names into one by hand is how a
           * header ends up misspelled.
           */}
          <Button
            title="Download CSV Template"
            buttonStyle={ButtonStyleType.OUTLINE}
            disabled={isImporting}
            onClick={() => {
              downloadFile({
                content: `${STATUS_PAGE_GROUP_CSV_EXAMPLE}\n`,
                filename: "status-page-groups-template.csv",
                mimeType: "text/csv;charset=utf-8;",
              });
            }}
          />
          <Button
            title="Preview Import"
            buttonStyle={ButtonStyleType.NORMAL}
            disabled={isImporting}
            isLoading={false}
            onClick={previewCsv}
          />
        </div>

        {isImporting && importTotal > 0 && (
          <ProgressBar
            count={importedCount}
            totalCount={importTotal}
            suffix="groups"
            size={ProgressBarSize.Small}
          />
        )}

        {importError && <p className="text-sm text-red-700">{importError}</p>}

        {parseErrors.length > 0 && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3">
            <p className="mb-1 text-sm font-medium text-red-800">
              Fix these problems before importing:
            </p>
            <ul className="list-disc space-y-0.5 pl-5">
              {parseErrors.map(
                (
                  error: StatusPageGroupCsvError,
                  index: number,
                ): ReactElement => {
                  return (
                    <li key={index} className="text-sm text-red-700">
                      {error.line > 0 ? `Line ${error.line}: ` : ""}
                      {error.message}
                    </li>
                  );
                },
              )}
            </ul>
          </div>
        )}

        {parseResult &&
          parseErrors.length === 0 &&
          rows.length > 0 &&
          rowResults.length === 0 && (
            <div className="overflow-x-auto">
              <p className="mb-2 text-sm text-gray-600">
                {rows.length} group{rows.length === 1 ? "" : "s"} ready to
                import.
              </p>
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead>
                  <tr className="text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    <th className="px-3 py-2">Line</th>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Parent</th>
                    <th className="px-3 py-2">Description</th>
                    <th className="px-3 py-2">View Mode</th>
                    <th className="px-3 py-2">Options</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((row: ParsedStatusPageGroupRow): ReactElement => {
                    return (
                      <tr key={row.line}>
                        <td className="px-3 py-2 text-gray-500">{row.line}</td>
                        <td className="px-3 py-2 font-medium text-gray-900">
                          {row.name}
                        </td>
                        <td className="px-3 py-2 text-gray-600">
                          {row.parentName || "Top level"}
                        </td>
                        <td className="px-3 py-2 text-gray-600">
                          {row.description || "—"}
                        </td>
                        <td className="px-3 py-2 text-gray-600">
                          {row.viewMode || "—"}
                        </td>
                        <td className="px-3 py-2 text-gray-600">
                          {describeOptions(row) || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

        {rowResults.length > 0 && (
          <div className="overflow-x-auto">
            <p className="mb-2 text-sm font-medium text-gray-700">
              Import results
            </p>
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead>
                <tr className="text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  <th className="px-3 py-2">Line</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Result</th>
                  <th className="px-3 py-2">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rowResults.map(
                  (
                    result: StatusPageGroupImportRowResult,
                    index: number,
                  ): ReactElement => {
                    return (
                      <tr key={index}>
                        <td className="px-3 py-2 text-gray-500">
                          {result.line}
                        </td>
                        <td className="px-3 py-2 font-medium text-gray-900">
                          {result.name}
                        </td>
                        <td className="px-3 py-2">
                          {result.status === "created" && (
                            <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                              Created
                            </span>
                          )}
                          {result.status === "failed" && (
                            <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                              Failed
                            </span>
                          )}
                          {result.status === "skipped" && (
                            <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                              Skipped
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-gray-600">
                          {result.message || "—"}
                        </td>
                      </tr>
                    );
                  },
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default ImportGroupsFromCsvModal;
