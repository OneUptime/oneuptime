import PageComponentProps from "../../PageComponentProps";
import DataObservabilityApi from "../../../Components/DataObservability/DataObservabilityApi";
import {
  DATABASE_AGENT_STATE_LABELS,
  getDatabaseAgentStateSentence,
} from "../../../Components/DataObservability/DatabaseAgentWords";
import {
  getDatabaseConnectionFields,
  readDatabaseConnection,
} from "../../../Components/DataObservability/DatabaseConnectionFields";
import {
  STORE_REFUSAL_SENTENCES,
  getDeleteImpactSentences,
  getRemoveImpactSentences,
} from "../../../Components/DataObservability/DatabaseRemovalWords";
import useDatabaseConnectionChoices, {
  DatabaseConnectionChoices,
} from "../../../Components/DataObservability/UseDatabaseConnectionChoices";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import { StoreViewOutletContext, useStoreView } from "./StoreViewContext";
import Route from "Common/Types/API/Route";
import {
  DataObservabilityAgentState,
  DataObservabilityCollector,
  DataObservabilityStoreConnection,
  DataObservabilityStoreSettings,
} from "Common/Types/DataObservability/DataObservabilityApiTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import Toast from "Common/UI/Utils/Toast";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";

/*
 * A DATABASE'S SETTINGS IN DATA OBSERVABILITY (#11147): everything a
 * person who connected a database here needs to keep it right, on the page
 * of the product they added it in.
 *
 *   - its name, which both products show;
 *   - how Data Observability reaches it, and Change Connection: a new
 *     login, another probe, or the Database Agent beside it (#11148);
 *   - Remove from Data Observability: it stops being read here and its
 *     tables leave, while Data Security keeps it;
 *   - Delete Database, last: from OneUptime, with what both products keep
 *     of it, said before it happens - and, while Data Security relies on
 *     it, only for someone who may delete Data Security's data stores.
 *
 * The server says what the reader may do (DataObservabilityStoreSettings),
 * so a button is never offered that would be refused.
 */

type Dialog = "details" | "connection" | "remove" | "delete" | null;

const StoreSettingsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const { dataStoreId, refresh }: StoreViewOutletContext = useStoreView();
  const [settings, setSettings] =
    useState<DataObservabilityStoreSettings | null>(null);
  const [error, setError] = useState<string>("");
  const [readCount, setReadCount] = useState<number>(0);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [isWorking, setIsWorking] = useState<boolean>(false);
  const [dialogError, setDialogError] = useState<string>("");

  useEffect(() => {
    let isCurrent: boolean = true;

    DataObservabilityApi.getStoreSettings(dataStoreId)
      .then((result: DataObservabilityStoreSettings): void => {
        if (isCurrent) {
          setSettings(result);
          setError("");
        }
      })
      .catch((err: unknown): void => {
        if (isCurrent) {
          setError(API.getFriendlyMessage(err));
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [dataStoreId, readCount]);

  const readAgain: () => void = useCallback((): void => {
    setReadCount((count: number): number => {
      return count + 1;
    });
  }, []);

  const close: () => void = (): void => {
    setDialog(null);
    setDialogError("");
  };

  // A change saved: this page and the layout above it (the name in the title) read it again.
  const afterChange: () => void = (): void => {
    close();
    readAgain();
    refresh();
    Toast.success(translator.translateText("Changes saved") || "");
  };

  const databasesRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.DATA_OBSERVABILITY_STORES] as Route,
  );

  if (error) {
    return <ErrorMessage message={error} onRefreshClick={readAgain} />;
  }

  if (!settings) {
    return <PageSkeleton />;
  }

  const run: (
    work: () => Promise<void>,
    afterwards: () => void,
  ) => Promise<void> = async (
    work: () => Promise<void>,
    afterwards: () => void,
  ): Promise<void> => {
    setDialogError("");
    setIsWorking(true);

    try {
      await work();
      afterwards();
    } catch (err) {
      setDialogError(API.getFriendlyMessage(err));
    }

    setIsWorking(false);
  };

  const connection: DataObservabilityStoreConnection = settings.connection;

  return (
    <div className="space-y-5">
      <Card
        title="Database Details"
        description="How this database is named in Data Observability and Data Security."
        buttons={
          settings.canEdit
            ? [
                {
                  title: "Edit Details",
                  buttonStyle: ButtonStyleType.NORMAL,
                  icon: IconProp.Edit,
                  onClick: () => {
                    setDialog("details");
                  },
                },
              ]
            : []
        }
      >
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-sm font-medium text-gray-500">
              {translator.translateText("Name")}
            </dt>
            <dd className="mt-1 text-sm text-gray-900">{settings.name}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-gray-500">
              {translator.translateText("Engine")}
            </dt>
            <dd className="mt-1 text-sm text-gray-900">{settings.kind}</dd>
          </div>
        </dl>
      </Card>

      <Card
        title="Connection"
        description="How Data Observability reaches this database. A saved login is never shown again."
        buttons={
          settings.canEdit
            ? [
                {
                  title: "Change Connection",
                  buttonStyle: ButtonStyleType.NORMAL,
                  icon: IconProp.Link,
                  onClick: () => {
                    setDialog("connection");
                  },
                },
              ]
            : []
        }
      >
        <ConnectionSummary connection={connection} translator={translator} />
      </Card>

      {settings.canRemove ? (
        <Card
          title="Remove from Data Observability"
          description="Stop reading this database and forget its tables, checks and history here. Data Security keeps it, with its connection."
          buttons={[
            {
              title: "Remove from Data Observability",
              buttonStyle: ButtonStyleType.DANGER_OUTLINE,
              icon: IconProp.Close,
              onClick: () => {
                setDialog("remove");
              },
            },
          ]}
        >
          <p className="text-sm text-gray-600">
            {translator.translateText(
              "To pause it and keep its history instead, use Stop Watching on its Overview.",
            )}
          </p>
        </Card>
      ) : (
        <></>
      )}

      {settings.canEdit ? (
        <Card
          title="Delete Database"
          description="Delete it from OneUptime, with what Data Observability and Data Security keep of it."
          buttons={[
            {
              title: "Delete Database",
              buttonStyle: ButtonStyleType.DANGER_OUTLINE,
              icon: IconProp.Trash,
              disabled: Boolean(settings.deleteRefusal),
              onClick: () => {
                setDialog("delete");
              },
            },
          ]}
        >
          {settings.deleteRefusal ? (
            <p
              className="text-sm text-gray-600"
              data-testid="data-observability-delete-refusal"
            >
              {translator.translateText(
                STORE_REFUSAL_SENTENCES[settings.deleteRefusal],
              )}
            </p>
          ) : (
            <ImpactList
              sentences={getDeleteImpactSentences(settings, translator)}
            />
          )}
        </Card>
      ) : (
        <></>
      )}

      {dialog === "details" ? (
        <BasicFormModal<JSONObject>
          title="Edit Database Details"
          name="Data Observability > Edit Database Details"
          submitButtonText="Save Changes"
          isSubmitting={isWorking}
          error={dialogError || undefined}
          onClose={close}
          formProps={{
            name: "Edit Database Details",
            initialValues: { name: settings.name },
            fields: [
              {
                field: { name: true },
                title: "Name",
                description:
                  "What your team calls this database. Data Security shows the same name.",
                placeholder: "Orders database",
                fieldType: FormFieldSchemaType.Text,
                required: true,
              },
            ],
          }}
          onSubmit={(values: FormValues<JSONObject>) => {
            void run(async (): Promise<void> => {
              await DataObservabilityApi.updateStore(dataStoreId, {
                name: String(values["name"] || ""),
              });
            }, afterChange);
          }}
        />
      ) : (
        <></>
      )}

      {dialog === "connection" ? (
        <ChangeConnectionModal
          settings={settings}
          isSaving={isWorking}
          error={dialogError}
          onClose={close}
          onSubmit={(values: FormValues<JSONObject>) => {
            void run(async (): Promise<void> => {
              const { collector, ...rest } = readDatabaseConnection(values);

              await DataObservabilityApi.updateStore(dataStoreId, {
                connection: { collector, ...rest },
              });
            }, afterChange);
          }}
        />
      ) : (
        <></>
      )}

      {dialog === "remove" ? (
        <ConfirmModal
          title={translator.translateTemplate(
            "Remove {{name}} from Data Observability?",
            { name: settings.name },
          )}
          description={
            <ImpactList
              lead={translator.translateTemplate(
                "Data Observability stops reading {{name}} and forgets what it kept of it.",
                { name: settings.name },
              )}
              sentences={getRemoveImpactSentences(settings, translator)}
            />
          }
          submitButtonText="Remove from Data Observability"
          submitButtonType={ButtonStyleType.DANGER}
          isLoading={isWorking}
          error={dialogError || undefined}
          errorWhatFailed="The database was not removed from Data Observability."
          onClose={close}
          onSubmit={() => {
            void run(
              async (): Promise<void> => {
                await DataObservabilityApi.removeStore(dataStoreId);
              },
              (): void => {
                Toast.success(
                  translator.translateTemplate(
                    "{{name}} removed from Data Observability",
                    { name: settings.name },
                  ),
                );
                Navigation.navigate(databasesRoute);
              },
            );
          }}
        />
      ) : (
        <></>
      )}

      {dialog === "delete" ? (
        <ConfirmModal
          title={translator.translateTemplate(
            "Are you sure you want to delete {{name}}?",
            { name: settings.name },
          )}
          description={
            <ImpactList
              lead={translator.translateTemplate(
                "This deletes {{name}} from OneUptime, and it cannot be undone. With it go:",
                { name: settings.name },
              )}
              sentences={getDeleteImpactSentences(settings, translator)}
            />
          }
          submitButtonText="Delete Database"
          submitButtonType={ButtonStyleType.DANGER}
          isLoading={isWorking}
          error={dialogError || undefined}
          errorWhatFailed="The database was not deleted."
          onClose={close}
          onSubmit={() => {
            void run(
              async (): Promise<void> => {
                await DataObservabilityApi.deleteStore(dataStoreId);
              },
              (): void => {
                Toast.success(
                  translator.translateTemplate("{{name}} deleted", {
                    name: settings.name,
                  }),
                );
                Navigation.navigate(databasesRoute);
              },
            );
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

// What one of the impact lists says: a lead, and a sentence a line.
const ImpactList: FunctionComponent<{
  lead?: string | undefined;
  sentences: Array<string>;
}> = (props: { lead?: string | undefined; sentences: Array<string> }): ReactElement => {
  return (
    <div className="space-y-2 text-sm text-gray-600">
      {props.lead ? <p>{props.lead}</p> : <></>}
      {props.sentences.length > 0 ? (
        <ul className="list-disc space-y-1 ps-5">
          {props.sentences.map((sentence: string): ReactElement => {
            return <li key={sentence}>{sentence}</li>;
          })}
        </ul>
      ) : (
        <></>
      )}
    </div>
  );
};

// How a database is reached, in words: never its connection string.
const ConnectionSummary: FunctionComponent<{
  connection: DataObservabilityStoreConnection;
  translator: Translator;
}> = (props: {
  connection: DataObservabilityStoreConnection;
  translator: Translator;
}): ReactElement => {
  const { connection, translator } = props;

  if (connection.collector === DataObservabilityCollector.DatabaseAgent) {
    const serverName: string =
      connection.databaseServer?.name || translator.translateText("its server") || "";
    const state: DataObservabilityAgentState =
      connection.agentState || DataObservabilityAgentState.NoAgent;
    const isReady: boolean = state === DataObservabilityAgentState.Ready;

    return (
      <div className="space-y-2 text-sm text-gray-700">
        <div className="flex flex-wrap items-center gap-2">
          <span>
            {translator.translateTemplate(
              "The Database Agent of {{server}} reads the database {{database}}",
              {
                server: serverName,
                database: connection.databaseName || "",
              },
            )}
          </span>
          <Pill
            text={DATABASE_AGENT_STATE_LABELS[state]}
            tone={isReady ? PillTone.Success : PillTone.Warning}
          />
        </div>
        <p className={isReady ? "text-gray-600" : "text-amber-700"}>
          {getDatabaseAgentStateSentence(state, serverName, translator)}
        </p>
      </div>
    );
  }

  if (connection.collector === DataObservabilityCollector.Probe) {
    return (
      <p className="text-sm text-gray-700">
        {translator.translateTemplate(
          "Probe {{probe}} connects, with the connection string in its environment variable {{variable}}.",
          {
            probe: connection.probe?.name || "",
            variable: connection.probeConnectionVariable || "",
          },
        )}
      </p>
    );
  }

  return (
    <p className="text-sm text-gray-700">
      {connection.hasConnectionString
        ? translator.translateText(
            "OneUptime connects, with the connection string saved on the store, encrypted.",
          )
        : translator.translateText(
            "OneUptime connects through the cloud connection that found it.",
          )}
    </p>
  );
};

/*
 * Change Connection: the three ways in, starting from the one in use, the
 * reason first when the reader may not change the connection Data Security
 * samples with - a Database Agent still leaves it as it is.
 */
const ChangeConnectionModal: FunctionComponent<{
  settings: DataObservabilityStoreSettings;
  isSaving: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (values: FormValues<JSONObject>) => void;
}> = (props: {
  settings: DataObservabilityStoreSettings;
  isSaving: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (values: FormValues<JSONObject>) => void;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const choices: DatabaseConnectionChoices = useDatabaseConnectionChoices();
  const connection: DataObservabilityStoreConnection =
    props.settings.connection;

  return (
    <BasicFormModal<JSONObject>
      title="Change Connection"
      description="How Data Observability reaches this database from now on. Its next collection uses it."
      name="Data Observability > Change Connection"
      beforeFormElement={
        props.settings.connectionRefusal ? (
          <Alert
            type={AlertType.INFO}
            title={STORE_REFUSAL_SENTENCES[props.settings.connectionRefusal]}
          />
        ) : undefined
      }
      submitButtonText="Save Connection"
      isLoading={choices.isLoading}
      isSubmitting={props.isSaving}
      error={props.error || undefined}
      onClose={props.onClose}
      formProps={{
        name: "Change Connection",
        initialValues: {
          collector: connection.collector,
          ...(connection.probe ? { probeId: connection.probe.id } : {}),
          ...(connection.probeConnectionVariable
            ? { probeConnectionVariable: connection.probeConnectionVariable }
            : {}),
          ...(connection.databaseServer
            ? { databaseServerId: connection.databaseServer.id }
            : {}),
          ...(connection.databaseName
            ? { databaseName: connection.databaseName }
            : {}),
        },
        fields: getDatabaseConnectionFields({
          probeOptions: choices.probeOptions,
          agentOptions: choices.agentOptions,
          hasSavedConnection: connection.hasConnectionString,
          translator,
        }),
      }}
      onSubmit={props.onSubmit}
    />
  );
};

export default StoreSettingsPage;
