import AdminModelAPI from "../../../Utils/ModelAPI";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import DashboardSideMenu from "../SideMenu";
import Route from "Common/Types/API/Route";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import { Gray500, Green, Red } from "Common/Types/BrandColors";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import RunnerLiveStatus, {
  getRunnerLiveStatus,
} from "Common/Types/Runner/RunnerLiveStatus";
import { getGlobalRunnerDockerCommand } from "Common/Types/Runner/RunnerContainer";
import { ActionButtonPlacement } from "Common/UI/Components/ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Page from "Common/UI/Components/Page/Page";
import Statusbubble from "Common/UI/Components/StatusBubble/StatusBubble";
import FieldType from "Common/UI/Components/Types/FieldType";
import { HOST, HTTP_PROTOCOL } from "Common/UI/Config";
import Runner from "Common/Models/DatabaseModels/Runner";
import React, { FunctionComponent, ReactElement, useState } from "react";
import { useTranslation } from "react-i18next";

/*
 * Settings -> Runbooks -> Global Runners: the Runners OneUptime runs for
 * every project, which only a master admin creates. A global Runner is the
 * ordinary Runner image started with the id and key this page shows (Show ID
 * and Key gives the whole command); the server tells it that it is global,
 * and from then on it runs the JavaScript steps of every project that uses
 * global Runners - each in a sandbox of its own that reaches the internet
 * only - and the AI code fixes of the repositories that work on a global
 * Runner, never running a repository's own commands. Every project lists
 * these on its own Runners page.
 */
const Settings: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
  const [currentRunner, setCurrentRunner] = useState<Runner | null>(null);

  const renderStatus: (item: Runner) => ReactElement = (
    item: Runner,
  ): ReactElement => {
    const status: RunnerLiveStatus = getRunnerLiveStatus(item.lastAlive);

    if (status === RunnerLiveStatus.Connected) {
      return (
        <Statusbubble
          text={t("common.connected")}
          color={Green}
          shouldAnimate={true}
        />
      );
    }

    // Grey for a Runner nobody has started yet: it has not failed at anything.
    if (status === RunnerLiveStatus.NeverConnected) {
      return (
        <Statusbubble
          text={t("pages.settings.globalRunners.neverConnected")}
          color={Gray500}
          shouldAnimate={false}
        />
      );
    }

    return (
      <Statusbubble
        text={t("common.disconnected")}
        color={Red}
        shouldAnimate={false}
      />
    );
  };

  return (
    <Page
      title={t("pages.settings.title")}
      breadcrumbLinks={[
        {
          title: t("breadcrumbs.adminDashboard"),
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: t("breadcrumbs.settings"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS] as Route,
          ),
        },
        {
          title: t("breadcrumbs.globalRunners"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS_GLOBAL_RUNNERS] as Route,
          ),
        },
      ]}
      sideMenu={<DashboardSideMenu />}
    >
      <ModelTable<Runner>
        userPreferencesKey={"admin-global-runners-table"}
        modelType={Runner}
        id="global-runners-table"
        name="Settings > Global Runners"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        cardProps={{
          title: t("pages.settings.globalRunners.cardTitle"),
          description: t("pages.settings.globalRunners.cardDescription"),
        }}
        documentationLink={Route.fromString(
          "/docs/runbooks/agents#global-runners",
        )}
        query={{
          projectId: new IsNull(),
          isGlobalRunner: true,
        }}
        modelAPI={AdminModelAPI}
        noItemsMessage={t("pages.settings.globalRunners.noItems")}
        showRefreshButton={true}
        onBeforeCreate={(item: Runner) => {
          item.isGlobalRunner = true;
          return Promise.resolve(item);
        }}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "global-runner-eu",
            validation: {
              minLength: 2,
            },
            /*
             * The column's description is about a project's Runners (the
             * reserved kubernetes-agent/ names); the title and placeholder
             * say what this is.
             */
            hideColumnDescription: true,
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Runs JavaScript steps for every project.",
            // The column only said "Optional description for this agent".
            hideColumnDescription: true,
          },
        ]}
        selectMoreFields={{
          key: true,
          lastAlive: true,
        }}
        actionButtons={[
          {
            title: t("pages.settings.globalRunners.showIdKey"),
            icon: IconProp.Key,
            buttonStyleType: ButtonStyleType.NORMAL,
            // Reveals the ID, key and command for copying - a utility, never the row button.
            placement: ActionButtonPlacement.MoreMenu,
            onClick: async (
              item: Runner,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ) => {
              try {
                setCurrentRunner(item);
                onCompleteAction();
              } catch (err) {
                onCompleteAction();
                onError(err as Error);
              }
            },
          },
        ]}
        filters={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              description: true,
            },
            noValueMessage: "-",
            title: "Description",
            type: FieldType.LongText,
            hideOnMobile: true,
          },
          {
            field: {
              lastAlive: true,
            },
            title: "Status",
            type: FieldType.Element,
            disableSort: true,
            getElement: renderStatus,
          },
        ]}
      />

      {/*
       * As wide as a project's Runner setup dialog (ModalWidth.Medium), so
       * the command's lines are read and copied whole rather than cut off
       * behind its copy button.
       */}
      {currentRunner ? (
        <Modal
          title={t("pages.settings.globalRunners.keyModalTitle")}
          modalWidth={ModalWidth.Medium}
          closeButtonText={t("common.close")}
          onClose={() => {
            setCurrentRunner(null);
          }}
        >
          <div
            className="space-y-4 text-sm text-gray-600"
            data-testid="global-runner-key-details"
          >
            <p>{t("pages.settings.globalRunners.keyModalDescription")}</p>
            <p>
              <b className="text-gray-900">
                {t("pages.settings.globalRunners.runnerIdLabel")}
              </b>{" "}
              <span className="font-mono">{currentRunner._id?.toString()}</span>
            </p>
            <p>
              <b className="text-gray-900">
                {t("pages.settings.globalRunners.runnerKeyLabel")}
              </b>{" "}
              <span className="font-mono">{currentRunner.key?.toString()}</span>
            </p>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                {t("pages.settings.globalRunners.commandLabel")}
              </p>
              <CodeBlock
                language="bash"
                code={getGlobalRunnerDockerCommand({
                  runnerId: currentRunner._id?.toString() || "",
                  runnerKey: currentRunner.key?.toString() || "",
                  oneuptimeUrl: `${HTTP_PROTOCOL}${HOST}`,
                })}
              />
            </div>
          </div>
        </Modal>
      ) : (
        <></>
      )}
    </Page>
  );
};

export default Settings;
