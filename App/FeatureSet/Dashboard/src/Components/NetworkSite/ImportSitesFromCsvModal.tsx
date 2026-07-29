import {
  NetworkSiteTypeOption,
  ParsedSiteRow,
  SITE_CSV_COLUMNS,
  SiteCsvError,
  SiteCsvParseResult,
  parseSiteCsv,
} from "../../Utils/NetworkSiteCsv";
import {
  CreateSiteFunction,
  SiteCreateResult,
  SiteImportProgress,
  SiteImportRowResult,
  SiteImportSummary,
  runSiteImport,
} from "../../Utils/NetworkSiteImportRunner";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import NetworkSiteType from "Common/Models/DatabaseModels/NetworkSiteType";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { PromiseVoidFunction, VoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ProgressBar, {
  ProgressBarSize,
} from "Common/UI/Components/ProgressBar/ProgressBar";
import TextArea from "Common/UI/Components/TextArea/TextArea";
import { ToastType } from "Common/UI/Components/Toast/Toast";
import { ShowToastNotification } from "Common/UI/Components/Toast/ToastInit";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * Bulk CSV import for Network Sites, reached from the ⋯ menu on the Sites
 * table — the same place every other table in the product hides its bulk
 * actions. It used to be a standalone page under Discovery & Import, which
 * put the one thing that creates sites in a different corner of the product
 * from the table that lists them.
 *
 * Parsing and dependency planning live in the react-free
 * Utils/NetworkSiteCsv module, and the sequential create loop in
 * Utils/NetworkSiteImportRunner; this component only wires them to a
 * textarea, a file input, and the ModelAPI.
 *
 * Site types are per-project NetworkSiteType rows, so the parser cannot know
 * the valid siteType values by itself: the project's types are fetched once
 * when the modal opens and handed to every parse, which resolves each cell to
 * a networkSiteTypeId. Parsing is synchronous, so the fetch has to finish
 * before the body is usable at all — hence the modal-level body loader.
 */

/*
 * The example uses the default seeded type names. A project that renamed
 * them still gets the right list from the hint below the textarea, which is
 * built from its own configured types.
 */
const EXAMPLE_CSV: string = [
  "name,siteType,parentName,address,latitude,longitude",
  "Franchise East,Region,,,,",
  '"Springfield Market",Market,Franchise East,,,',
  '"Unit 1042","Unit","Springfield Market","742 Evergreen Terrace, Springfield, IL",39.7817,-89.6501',
].join("\n");

export interface ComponentProps {
  onClose: () => void;
  /*
   * Fired once, after a run that created at least one site, so the table and
   * the summary/hierarchy above it can refetch while the modal stays open on
   * its results.
   */
  onImportComplete: () => void;
}

const ImportSitesFromCsvModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [csvText, setCsvText] = useState<string>("");
  const [parseResult, setParseResult] = useState<SiteCsvParseResult | null>(
    null,
  );
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [hasImported, setHasImported] = useState<boolean>(false);
  const [importedCount, setImportedCount] = useState<number>(0);
  const [importTotal, setImportTotal] = useState<number>(0);
  const [rowResults, setRowResults] = useState<Array<SiteImportRowResult>>([]);
  const [importError, setImportError] = useState<string>("");

  const [siteTypes, setSiteTypes] = useState<Array<NetworkSiteTypeOption>>([]);
  const [isLoadingSiteTypes, setIsLoadingSiteTypes] = useState<boolean>(true);
  const [siteTypesError, setSiteTypesError] = useState<string>("");

  const fileInputRef: React.MutableRefObject<HTMLInputElement | null> =
    useRef<HTMLInputElement | null>(null);

  /*
   * The project's configured site types, in hierarchy order — the order the
   * "Valid values" list in a parse error reads best in, and the order the
   * settings page shows them in.
   */
  const fetchSiteTypes: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoadingSiteTypes(true);
    try {
      const result: ListResult<NetworkSiteType> =
        await ModelAPI.getList<NetworkSiteType>({
          modelType: NetworkSiteType,
          query: {},
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            name: true,
          },
          sort: {
            order: SortOrder.Ascending,
            name: SortOrder.Ascending,
          },
        });

      setSiteTypes(
        result.data
          .filter((siteType: NetworkSiteType) => {
            return Boolean(siteType._id && siteType.name);
          })
          .map((siteType: NetworkSiteType): NetworkSiteTypeOption => {
            return {
              id: siteType._id!.toString(),
              name: siteType.name!,
            };
          }),
      );
      setSiteTypesError("");
    } catch (err) {
      setSiteTypesError(API.getFriendlyMessage(err));
    }
    setIsLoadingSiteTypes(false);
  };

  useEffect(() => {
    fetchSiteTypes().catch((err: Error) => {
      setSiteTypesError(API.getFriendlyMessage(err));
      setIsLoadingSiteTypes(false);
    });
  }, []);

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
      setParseResult(parseSiteCsv(text, siteTypes));
      setRowResults([]);
      setImportError("");
      setHasImported(false);
    };
    reader.readAsText(file);
    // Allow re-choosing the same file later.
    event.target.value = "";
  };

  const previewCsv: VoidFunction = (): void => {
    setParseResult(parseSiteCsv(csvText, siteTypes));
    setRowResults([]);
    setImportError("");
    setHasImported(false);
  };

  /*
   * One site, one POST. The runner decides the order and hands over the
   * parent's id; everything here is the mapping onto the model plus turning
   * an API rejection into a message the results table can show.
   */
  const createSite: CreateSiteFunction = async (
    row: ParsedSiteRow,
    parentSiteId: string | undefined,
  ): Promise<SiteCreateResult> => {
    try {
      const site: NetworkSite = new NetworkSite();
      site.projectId = ProjectUtil.getCurrentProjectId()!;
      site.name = row.name;
      /*
       * The parser already resolved the CSV cell against the project's
       * configured types, so this id is always a real NetworkSiteType row.
       * The deprecated inline siteType string is deliberately not written —
       * new sites carry their type only by relation.
       */
      site.networkSiteTypeId = new ObjectID(row.networkSiteTypeId);

      if (parentSiteId) {
        site.parentSiteId = new ObjectID(parentSiteId);
      }

      if (row.address !== "") {
        site.address = row.address;
      }

      if (row.latitude !== undefined && row.longitude !== undefined) {
        site.latitude = row.latitude;
        site.longitude = row.longitude;
      }

      const response: HTTPResponse<
        JSONObject | JSONArray | NetworkSite | Array<NetworkSite>
      > = await ModelAPI.create<NetworkSite>({
        model: site,
        modelType: NetworkSite,
      });

      const created: NetworkSite = response.data as NetworkSite;

      return {
        created: true,
        siteId: created._id?.toString() || created.id?.toString(),
      };
    } catch (err) {
      return { created: false, errorMessage: API.getFriendlyMessage(err) };
    }
  };

  const importSites: PromiseVoidFunction = async (): Promise<void> => {
    if (!parseResult || parseResult.rows.length === 0) {
      return;
    }

    setIsImporting(true);
    setImportError("");
    setRowResults([]);
    setImportedCount(0);

    try {
      /*
       * Resolve names of sites that already exist — they can be parents of
       * imported rows, and rows that collide with them are skipped.
       */
      const existingSites: ListResult<NetworkSite> =
        await ModelAPI.getList<NetworkSite>({
          modelType: NetworkSite,
          query: {},
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            name: true,
          },
          sort: {
            name: SortOrder.Ascending,
          },
        });

      const existingSiteIdByName: Map<string, string> = new Map<
        string,
        string
      >();
      for (const site of existingSites.data) {
        if (site.name && site._id) {
          existingSiteIdByName.set(site.name, site._id.toString());
        }
      }

      const summary: SiteImportSummary = await runSiteImport({
        rows: parseResult.rows,
        existingSiteIdByName: existingSiteIdByName,
        createSite: createSite,
        onProgress: (progress: SiteImportProgress): void => {
          setRowResults(progress.results);
          setImportedCount(progress.createdCount);
          setImportTotal(progress.totalToCreate);
        },
      });

      setHasImported(true);

      if (summary.createdCount > 0) {
        ShowToastNotification({
          title: "Sites Imported",
          description: `${summary.createdCount} network site${
            summary.createdCount === 1 ? "" : "s"
          } imported successfully.`,
          type: ToastType.SUCCESS,
        });

        props.onImportComplete();
      }

      const notCreatedCount: number =
        summary.failedCount + summary.skippedCount;

      if (notCreatedCount > 0) {
        ShowToastNotification({
          title: "Some Sites Could Not Be Imported",
          description: `${notCreatedCount} row${
            notCreatedCount === 1 ? "" : "s"
          } failed or were skipped.`,
          type: ToastType.DANGER,
        });
      }
    } catch (err) {
      setImportError(API.getFriendlyMessage(err));
    }

    setIsImporting(false);
  };

  const rows: Array<ParsedSiteRow> = parseResult?.rows || [];
  const parseErrors: Array<SiteCsvError> = parseResult?.errors || [];

  const siteTypeNames: string = siteTypes
    .map((siteType: NetworkSiteTypeOption) => {
      return siteType.name;
    })
    .join(", ");

  const canImport: boolean = Boolean(
    parseResult && rows.length > 0 && parseErrors.length === 0,
  );

  /*
   * Once a run has finished the footer stops offering "Import" — re-pressing
   * it would replay the whole file against a project that now contains half
   * of it. Editing the CSV or previewing again re-arms it.
   */
  const submitButtonText: string = hasImported
    ? "Done"
    : rows.length > 0
      ? `Import ${rows.length} Site${rows.length === 1 ? "" : "s"}`
      : "Import";

  return (
    <Modal
      title="Import Sites from CSV"
      description="Bulk-create your site hierarchy from a CSV file."
      modalWidth={ModalWidth.Large}
      isBodyLoading={isLoadingSiteTypes}
      error={siteTypesError || undefined}
      onClose={() => {
        if (isImporting) {
          return;
        }
        props.onClose();
      }}
      closeButtonText={hasImported ? "Close" : "Cancel"}
      submitButtonText={submitButtonText}
      isLoading={isImporting}
      disableSubmitButton={
        Boolean(siteTypesError) || isImporting || (!hasImported && !canImport)
      }
      onSubmit={() => {
        if (hasImported) {
          props.onClose();
          return;
        }

        importSites().catch((err: Error) => {
          setImportError(API.getFriendlyMessage(err));
          setIsImporting(false);
        });
      }}
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-500">
          Columns: {SITE_CSV_COLUMNS.join(", ")}. siteType must be one of this
          project&apos;s configured site types
          {siteTypeNames ? ` (${siteTypeNames})` : ""}. Rows whose parentName is
          empty or already exists import first, then their children — parents
          and children can live in the same file. Rows with an unresolvable
          parent are skipped and reported.
        </p>

        <TextArea
          id="network-site-import-csv"
          value={csvText}
          placeholder={EXAMPLE_CSV}
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
            data-testid="network-site-import-file-input"
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
            suffix="sites"
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
                (error: SiteCsvError, index: number): ReactElement => {
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
                {rows.length} site{rows.length === 1 ? "" : "s"} ready to
                import.
              </p>
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead>
                  <tr className="text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    <th className="px-3 py-2">Line</th>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Site Type</th>
                    <th className="px-3 py-2">Parent</th>
                    <th className="px-3 py-2">Address</th>
                    <th className="px-3 py-2">Coordinates</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((row: ParsedSiteRow): ReactElement => {
                    return (
                      <tr key={row.line}>
                        <td className="px-3 py-2 text-gray-500">{row.line}</td>
                        <td className="px-3 py-2 font-medium text-gray-900">
                          {row.name}
                        </td>
                        <td className="px-3 py-2 text-gray-600">
                          {row.siteType}
                        </td>
                        <td className="px-3 py-2 text-gray-600">
                          {row.parentName || "—"}
                        </td>
                        <td className="px-3 py-2 text-gray-600">
                          {row.address || "—"}
                        </td>
                        <td className="px-3 py-2 text-gray-600">
                          {row.latitude !== undefined &&
                          row.longitude !== undefined
                            ? `${row.latitude}, ${row.longitude}`
                            : "—"}
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
                    result: SiteImportRowResult,
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

export default ImportSitesFromCsvModal;
