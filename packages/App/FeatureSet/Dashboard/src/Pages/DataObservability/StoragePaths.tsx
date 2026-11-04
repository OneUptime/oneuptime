import PageComponentProps from "../PageComponentProps";
import DataObservabilityApi from "../../Components/DataObservability/DataObservabilityApi";
import WatchedTablesCost from "../../Components/DataObservability/WatchedTablesCost";
import OneUptimeDate from "Common/Types/Date";
import { DataObservabilityStoragePathStore } from "Common/Types/DataObservability/DataObservabilityApiTypes";
import { readWatchedPaths } from "Common/Types/DataObservability/StoragePaths";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import API from "Common/UI/Utils/API/API";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * The buckets a cloud connection found, and which of their paths are watched
 * like tables (Types/DataObservability/StoragePaths): a path's newest object is
 * its last change, its objects its rows. Only names, sizes and times are read.
 * A store is Data Security's record, so this goes through Data Observability's
 * own routes, as the Databases page does.
 */
const DataObservabilityStoragePathsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [stores, setStores] = useState<
    Array<DataObservabilityStoragePathStore>
  >([]);
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [readCount, setReadCount] = useState<number>(0);
  const [editing, setEditing] =
    useState<DataObservabilityStoragePathStore | null>(null);
  const [saveError, setSaveError] = useState<string>("");
  const [isSaving, setIsSaving] = useState<boolean>(false);

  useEffect(() => {
    let isCurrent: boolean = true;

    DataObservabilityApi.getStoragePaths()
      .then((found: Array<DataObservabilityStoragePathStore>): void => {
        if (isCurrent) {
          setStores(found);
          setError("");
        }
      })
      .catch((err: unknown): void => {
        if (isCurrent) {
          setError(API.getFriendlyMessage(err));
        }
      })
      .finally((): void => {
        if (isCurrent) {
          setIsLoading(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [readCount]);

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  return (
    <>
      <Card
        title="Storage Paths"
        description="Name the paths of a bucket that matter, and each is watched like a table: late, shrinking or empty, it alerts. Only names, sizes and times are read, never an object."
      >
        <div className="space-y-4 px-6 pb-6">
          <WatchedTablesCost />
          {stores.length === 0 ? (
            <p className="text-sm text-gray-500">
              {translator.translateText(
                "No bucket found yet. Connect a cloud account, and its buckets show up here within a day.",
              )}
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {stores.map(
                (store: DataObservabilityStoragePathStore): ReactElement => {
                  const paths: Array<string> = readWatchedPaths(
                    store.watchedPaths,
                  );

                  return (
                    <li
                      key={store.dataStoreId}
                      className="flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="truncate font-medium text-gray-900">
                          {store.name}
                        </div>
                        <div className="text-xs text-gray-500">
                          {store.kind}
                          {store.collectedAt
                            ? ` · ${translator.translateTemplate(
                                "Last collected {{time}}",
                                {
                                  time: OneUptimeDate.fromNow(
                                    OneUptimeDate.fromString(store.collectedAt),
                                  ),
                                },
                              )}`
                            : ""}
                        </div>
                        {paths.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {paths.map((path: string): ReactElement => {
                              return (
                                <code
                                  key={path}
                                  className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700"
                                >
                                  {path}
                                </code>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="text-xs text-gray-500">
                            {translator.translateText("No paths watched")}
                          </div>
                        )}
                        {store.message ? (
                          <p
                            className={`whitespace-pre-line text-xs ${
                              store.status === "Failed"
                                ? "text-red-600"
                                : "text-amber-700"
                            }`}
                          >
                            {store.message}
                          </p>
                        ) : (
                          <></>
                        )}
                      </div>
                      <div className="shrink-0">
                        <Button
                          title="Edit Paths"
                          buttonStyle={ButtonStyleType.NORMAL}
                          icon={IconProp.Edit}
                          onClick={() => {
                            setSaveError("");
                            setEditing(store);
                          }}
                        />
                      </div>
                    </li>
                  );
                },
              )}
            </ul>
          )}
        </div>
      </Card>

      {editing ? (
        <BasicFormModal<JSONObject>
          title={editing.name}
          description="One path per line. On an Azure storage account, start each with its container's name."
          name="Data Observability > Storage Paths"
          submitButtonText="Save"
          isSubmitting={isSaving}
          error={saveError || undefined}
          onClose={() => {
            setEditing(null);
          }}
          formProps={{
            name: "Storage Paths",
            initialValues: { watchedPaths: editing.watchedPaths },
            fields: [
              {
                field: { watchedPaths: true },
                title: "Watched Paths",
                placeholder: "exports/orders/\nevents/2026/",
                fieldType: FormFieldSchemaType.LongText,
                required: false,
              },
            ],
          }}
          onSubmit={async (values: FormValues<JSONObject>) => {
            setSaveError("");
            setIsSaving(true);

            try {
              await DataObservabilityApi.saveStoragePaths(
                new ObjectID(editing.dataStoreId),
                String(values["watchedPaths"] || ""),
              );
              setEditing(null);
              setReadCount((count: number): number => {
                return count + 1;
              });
            } catch (err) {
              setSaveError(API.getFriendlyMessage(err));
            }

            setIsSaving(false);
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default DataObservabilityStoragePathsPage;
