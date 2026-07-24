import PageComponentProps from "../PageComponentProps";
import {
  ParsedSiteRow,
  SITE_CSV_COLUMNS,
  SiteCsvError,
  SiteCsvParseResult,
  SiteImportPlan,
  SkippedSiteRow,
  parseSiteCsv,
  planSiteImport,
} from "../../Utils/NetworkSiteCsv";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import TextArea from "Common/UI/Components/TextArea/TextArea";
import { ToastType } from "Common/UI/Components/Toast/Toast";
import { ShowToastNotification } from "Common/UI/Components/Toast/ToastInit";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useRef,
  useState,
} from "react";

/*
 * Client-side CSV import for Network Sites (precedent: the discovered-
 * device import loop on Pages/NetworkDevice/Discovery.tsx). Parsing and
 * dependency planning live in the react-free Utils/NetworkSiteCsv module;
 * this page only wires them to a textarea/file input and a sequential
 * ModelAPI.create loop that creates parents before their children.
 */

interface RowResult {
  line: number;
  name: string;
  status: "created" | "failed" | "skipped";
  message: string;
}

const EXAMPLE_CSV: string = [
  "name,siteType,parentName,address,latitude,longitude",
  "Franchise East,Region,,,,",
  '"Springfield Market",Market,Franchise East,,,',
  '"Unit 1042","Unit","Springfield Market","742 Evergreen Terrace, Springfield, IL",39.7817,-89.6501',
].join("\n");

const NetworkSiteImport: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [csvText, setCsvText] = useState<string>("");
  const [parseResult, setParseResult] = useState<SiteCsvParseResult | null>(
    null,
  );
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [importedCount, setImportedCount] = useState<number>(0);
  const [importTotal, setImportTotal] = useState<number>(0);
  const [rowResults, setRowResults] = useState<Array<RowResult>>([]);
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
      setParseResult(parseSiteCsv(text));
      setRowResults([]);
      setImportError("");
    };
    reader.readAsText(file);
    // Allow re-choosing the same file later.
    event.target.value = "";
  };

  const previewCsv: VoidFunction = (): void => {
    setParseResult(parseSiteCsv(csvText));
    setRowResults([]);
    setImportError("");
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
       * Resolve names of sites that already exist — they can be parents
       * of imported rows, and rows that collide with them are skipped.
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

      const siteIdByName: Map<string, string> = new Map<string, string>();
      for (const site of existingSites.data) {
        if (site.name && site._id) {
          siteIdByName.set(site.name, site._id.toString());
        }
      }

      const plan: SiteImportPlan = planSiteImport(
        parseResult.rows,
        Array.from(siteIdByName.keys()),
      );

      const results: Array<RowResult> = [];
      for (const skipped of plan.skipped as Array<SkippedSiteRow>) {
        results.push({
          line: skipped.row.line,
          name: skipped.row.name,
          status: "skipped",
          message: skipped.reason,
        });
      }

      const totalToCreate: number = plan.batches.reduce(
        (sum: number, batch: Array<ParsedSiteRow>) => {
          return sum + batch.length;
        },
        0,
      );
      setImportTotal(totalToCreate);
      setRowResults([...results]);

      let successCount: number = 0;
      let failureCount: number = 0;

      /*
       * Batches are in dependency order: parents created by an earlier
       * batch are in siteIdByName by the time their children import.
       */
      for (const batch of plan.batches) {
        for (const row of batch) {
          try {
            const site: NetworkSite = new NetworkSite();
            site.projectId = ProjectUtil.getCurrentProjectId()!;
            site.name = row.name;
            site.siteType = row.siteType;

            if (row.parentName !== "") {
              const parentId: string | undefined = siteIdByName.get(
                row.parentName,
              );
              if (!parentId) {
                // Parent row failed to import — skip its children too.
                results.push({
                  line: row.line,
                  name: row.name,
                  status: "skipped",
                  message: `Parent site "${row.parentName}" could not be created.`,
                });
                setRowResults([...results]);
                continue;
              }
              site.parentSiteId = new ObjectID(parentId);
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
            const createdId: string | undefined =
              created._id?.toString() || created.id?.toString();
            if (createdId) {
              siteIdByName.set(row.name, createdId);
            }

            successCount++;
            results.push({
              line: row.line,
              name: row.name,
              status: "created",
              message: "",
            });
          } catch (err) {
            failureCount++;
            results.push({
              line: row.line,
              name: row.name,
              status: "failed",
              message: API.getFriendlyMessage(err),
            });
          }

          setImportedCount(successCount);
          setRowResults([...results]);
        }
      }

      if (successCount > 0) {
        ShowToastNotification({
          title: "Sites Imported",
          description: `${successCount} network site${
            successCount === 1 ? "" : "s"
          } imported successfully.`,
          type: ToastType.SUCCESS,
        });
      }

      if (failureCount > 0 || plan.skipped.length > 0) {
        ShowToastNotification({
          title: "Some Sites Could Not Be Imported",
          description: `${failureCount + plan.skipped.length} row${
            failureCount + plan.skipped.length === 1 ? "" : "s"
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

  return (
    <Fragment>
      <Card
        title="Import Sites from CSV"
        description={`Bulk-create your site hierarchy. Columns: ${SITE_CSV_COLUMNS.join(
          ", ",
        )}. Rows whose parentName is empty or already exists import first, then their children — parents and children can live in the same file. Rows with an unresolvable parent are skipped and reported.`}
      >
        <div className="space-y-4">
          <TextArea
            id="network-site-import-csv"
            value={csvText}
            placeholder={EXAMPLE_CSV}
            onChange={(value: string) => {
              setCsvText(value);
              /*
               * The import runs off parseResult, not off this text, so a
               * parse the user has since edited away must not stay armed —
               * otherwise fixing a typo here and hitting Import would
               * create the pre-edit rows. Dropping it disables the button
               * until they preview again.
               */
              setParseResult(null);
              setRowResults([]);
              setImportError("");
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
              onClick={() => {
                fileInputRef.current?.click();
              }}
            />
            <Button
              title="Preview Import"
              buttonStyle={ButtonStyleType.NORMAL}
              isLoading={false}
              onClick={previewCsv}
            />
            <Button
              title={
                rows.length > 0
                  ? `Import ${rows.length} Site${rows.length === 1 ? "" : "s"}`
                  : "Import"
              }
              buttonStyle={ButtonStyleType.PRIMARY}
              disabled={
                isImporting ||
                !parseResult ||
                rows.length === 0 ||
                parseErrors.length > 0
              }
              isLoading={isImporting}
              onClick={() => {
                importSites().catch((err: Error) => {
                  setImportError(API.getFriendlyMessage(err));
                  setIsImporting(false);
                });
              }}
            />
          </div>

          {isImporting && importTotal > 0 && (
            <p className="text-sm text-gray-600">
              Imported {importedCount} of {importTotal} sites…
            </p>
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

          {parseResult && parseErrors.length === 0 && rows.length > 0 && (
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
                    (result: RowResult, index: number): ReactElement => {
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
      </Card>
    </Fragment>
  );
};

export default NetworkSiteImport;
