import AdminModelAPI from "../../../Utils/ModelAPI";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import DashboardSideMenu from "../SideMenu";
import Route from "Common/Types/API/Route";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import { Green, Red } from "Common/Types/BrandColors";
import OneUptimeDate from "Common/Types/Date";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import Banner from "Common/UI/Components/Banner/Banner";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Page from "Common/UI/Components/Page/Page";
import ProbeElement from "Common/UI/Components/Probe/Probe";
import Statusbubble from "Common/UI/Components/StatusBubble/StatusBubble";
import FieldType from "Common/UI/Components/Types/FieldType";
import Probe from "Common/Models/DatabaseModels/Probe";
import React, { FunctionComponent, ReactElement, useState } from "react";

const Settings: FunctionComponent = (): ReactElement => {
  const [showKeyModal, setShowKeyModal] = useState<boolean>(false);

  const [currentProbe, setCurrentProbe] = useState<Probe | null>(null);

  return (
    <Page
      title={"Admin Settings"}
      breadcrumbLinks={[
        {
          title: "Admin Dashboard",
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: "Settings",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS] as Route,
          ),
        },
        {
          title: "Global Probes",
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
        title="Need help with setting up Global Probes?"
        description="Here is a guide which will help you get set up"
        link={Route.fromString("/docs/probe/custom-probe")}
      />

      <ModelTable<Probe>
        modelType={Probe}
        id="probes-table"
        name="Settings > Global Probes"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        cardProps={{
          title: "Global Probes",
          description:
            "Global Probes help you monitor external resources from different locations around the world.",
        }}
        query={{
          projectId: new IsNull(),
          isGlobalProbe: true,
        }}
        modelAPI={AdminModelAPI}
        noItemsMessage={"No probes found."}
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
            required: true,
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
          },
        ]}
        selectMoreFields={{
          key: true,
          iconFileId: true,
        }}
        actionButtons={[
          {
            title: "Show ID and Key",
            buttonStyleType: ButtonStyleType.NORMAL,
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

            getElement: (item: Probe): ReactElement => {
              return <ProbeElement probe={item} />;
            },
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            type: FieldType.Text,
          },
          {
            field: {
              lastAlive: true,
            },
            title: "Status",
            type: FieldType.Text,
            getElement: (item: Probe): ReactElement => {
              if (
                item &&
                item["lastAlive"] &&
                OneUptimeDate.getNumberOfMinutesBetweenDates(
                  OneUptimeDate.fromString(item["lastAlive"]),
                  OneUptimeDate.getCurrentDate(),
                ) < 5
              ) {
                return (
                  <Statusbubble
                    text={"Connected"}
                    color={Green}
                    shouldAnimate={true}
                  />
                );
              }

              return (
                <Statusbubble
                  text={"Disconnected"}
                  color={Red}
                  shouldAnimate={false}
                />
              );
            },
          },
        ]}
      />

      {showKeyModal && currentProbe ? (
        <ConfirmModal
          title={`Probe Key`}
          description={
            <div>
              <span>Here is your probe key. Please keep this a secret.</span>
              <br />
              <br />
              <span>
                <b>Probe ID: </b> {currentProbe["_id"]?.toString()}
              </span>
              <br />
              <br />
              <span>
                <b>Probe Key: </b> {currentProbe["key"]?.toString()}
              </span>
            </div>
          }
          submitButtonText={"Close"}
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
