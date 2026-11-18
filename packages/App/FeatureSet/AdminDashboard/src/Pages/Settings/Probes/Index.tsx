import AdminModelAPI from "../../../Utils/ModelAPI";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import DashboardSideMenu from "../SideMenu";
import Route from "Common/Types/API/Route";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import GlobalProbeStatusElement from "../../../Components/Probe/GlobalProbeStatus";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import { ActionButtonPlacement } from "Common/UI/Components/ActionButton/ActionButtonSchema";
import Banner from "Common/UI/Components/Banner/Banner";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Page from "Common/UI/Components/Page/Page";
import ProbeElement from "Common/UI/Components/Probe/Probe";
import FieldType from "Common/UI/Components/Types/FieldType";
import Probe from "Common/Models/DatabaseModels/Probe";
import React, { FunctionComponent, ReactElement, useState } from "react";
import { useTranslation } from "react-i18next";
import { drawsItsOwnLines } from "Common/UI/Components/Table/ColumnLineText";

const Settings: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
  const [showKeyModal, setShowKeyModal] = useState<boolean>(false);

  const [currentProbe, setCurrentProbe] = useState<Probe | null>(null);

  return (
    <Page
      title={t("pages.settings.title")}
      isTitleTranslated={true}
      breadcrumbLinks={[
        {
          title: t("breadcrumbs.adminDashboard"),
          isTitleTranslated: true,
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: t("breadcrumbs.settings"),
          isTitleTranslated: true,
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS] as Route,
          ),
        },
        {
          title: t("breadcrumbs.globalProbes"),
          isTitleTranslated: true,
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS_PROBES] as Route,
          ),
        },
      ]}
      sideMenu={<DashboardSideMenu />}
    >
      {/* Project Settings View  */}

      <Banner
        openInNewTab={true}
        title={t("pages.settings.probes.bannerTitle")}
        description={t("pages.settings.probes.bannerGuide")}
        link={Route.fromString("/docs/probe/custom-probe")}
        hideOnMobile={true}
      />

      <ModelTable<Probe>
        userPreferencesKey={"admin-probes-table"}
        modelType={Probe}
        id="probes-table"
        name="Settings > Global Probes"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        cardProps={{
          title: t("pages.settings.probes.cardTitle"),
          description: t("pages.settings.probes.cardDescription"),
        }}
        query={{
          projectId: new IsNull(),
          isGlobalProbe: true,
        }}
        modelAPI={AdminModelAPI}
        noItemsMessage={t("pages.settings.probes.emptyMessage")}
        showRefreshButton={true}
        onBeforeCreate={(item: Probe) => {
          item.isGlobalProbe = true;
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
            placeholder: "internal-probe",
            validation: {
              minLength: 2,
            },
          },

          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "This probe is to monitor all the internal services.",
          },

          {
            field: {
              iconFile: true,
            },
            title: "Probe Logo",
            fieldType: FormFieldSchemaType.ImageFile,
            required: false,
            placeholder: "Upload logo",
            // The column's description only said "Probe Icon".
            hideColumnDescription: true,
          },
        ]}
        selectMoreFields={{
          key: true,
          iconFileId: true,
          // Whether it is behind (GlobalProbeStatus).
          checksLateSince: true,
          checksLastLateAt: true,
          devicePollsLateSince: true,
          devicePollsLastLateAt: true,
        }}
        actionButtons={[
          {
            title: t("pages.settings.probes.showIdKey"),
            icon: IconProp.Key,
            buttonStyleType: ButtonStyleType.NORMAL,
            // Reveals the ID and key for copying - a utility, never the row button.
            placement: ActionButtonPlacement.MoreMenu,
            onClick: async (
              item: Probe,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ) => {
              try {
                setCurrentProbe(item);
                setShowKeyModal(true);

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
          {
            field: {
              description: true,
            },
            title: "Description",
            type: FieldType.LongText,
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,

            // A mark beside the name: the name reads its own way, the cell the page's.
            getLineText: drawsItsOwnLines,
            getElement: (item: Probe): ReactElement => {
              return <ProbeElement probe={item} />;
            },
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            type: FieldType.LongText,
            hideOnMobile: true,
          },
          {
            field: {
              lastAlive: true,
            },
            title: "Status",
            type: FieldType.Text,

            // As OneUptime Health shows it: Connected, Behind (#9488) or Disconnected.
            getElement: (item: Probe): ReactElement => {
              return <GlobalProbeStatusElement probe={item} />;
            },
          },
        ]}
      />

      {showKeyModal && currentProbe ? (
        <ConfirmModal
          title={t("pages.settings.probes.keyModalTitle")}
          isTitleTranslated={true}
          description={
            <div>
              <span>{t("pages.settings.probes.keyModalSecret")}</span>
              <br />
              <br />
              <span>
                <b>{t("pages.settings.probes.probeIdLabel")} </b>{" "}
                {currentProbe["_id"]?.toString()}
              </span>
              <br />
              <br />
              <span>
                <b>{t("pages.settings.probes.probeKeyLabel")} </b>{" "}
                {currentProbe["key"]?.toString()}
              </span>
            </div>
          }
          submitButtonText={t("common.close")}
          submitButtonType={ButtonStyleType.NORMAL}
          onSubmit={async () => {
            setShowKeyModal(false);
          }}
        />
      ) : (
        <></>
      )}
    </Page>
  );
};

export default Settings;
