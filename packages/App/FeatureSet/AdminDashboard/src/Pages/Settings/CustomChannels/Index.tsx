import AdminModelAPI from "../../../Utils/ModelAPI";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import DashboardSideMenu from "../SideMenu";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import Banner from "Common/UI/Components/Banner/Banner";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Page from "Common/UI/Components/Page/Page";
import FieldType from "Common/UI/Components/Types/FieldType";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import CustomNotificationChannel from "Common/Models/DatabaseModels/CustomNotificationChannel";
import React, { FunctionComponent, ReactElement, useState } from "react";
import { useTranslation } from "react-i18next";

/*
 * CUSTOM CHANNELS: ways to reach people the server's admin adds
 * (CustomNotificationChannel). A name, a URL and a signing secret; each
 * on-call page goes to the URL as a signed JSON request, and people see the
 * channel by name in their notification methods and on-call rules, with
 * nothing to set up.
 *
 * What most admins need is in the form: the name, the URL, and the secret
 * their service checks requests with - made for them, shown so it can be
 * copied. Whether the channel pages everyone is on by default and waits under
 * More fields: an admin adding the company's own app wants everybody paged
 * through it, and one adding a channel only some people use can say so there.
 */

const advancedSection: FormFieldCollapsibleSection<CustomNotificationChannel> =
  getAdvancedFormSection<CustomNotificationChannel>();

// A new signing secret: 32 random bytes as 64 hex digits, made in the browser.
export const generateSigningSecret: () => string = (): string => {
  const bytes: Uint8Array = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);

  return Array.from(bytes)
    .map((byte: number): string => {
      return byte.toString(16).padStart(2, "0");
    })
    .join("");
};

const SettingsCustomChannels: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();

  // One secret per visit, so the form shows the value it will save.
  const [defaultSecret] = useState<string>(generateSigningSecret);
  const [testedChannel, setTestedChannel] =
    useState<CustomNotificationChannel | null>(null);
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [testMessage, setTestMessage] = useState<string>("");
  const [testError, setTestError] = useState<string>("");
  const [refreshToggle, setRefreshToggle] = useState<string>(
    OneUptimeDate.getCurrentDate().toString(),
  );

  const sendTest: (
    channel: CustomNotificationChannel,
  ) => Promise<void> = async (
    channel: CustomNotificationChannel,
  ): Promise<void> => {
    setTestedChannel(channel);
    setIsTesting(true);
    setTestMessage("");
    setTestError("");

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            "/custom-notification-channel/instance/test",
          ),
          data: {
            customNotificationChannelId: channel.id?.toString() || "",
          },
        });

      if (response instanceof HTTPErrorResponse || response.isFailure()) {
        setTestError(API.getFriendlyMessage(response));
      } else {
        const data: JSONObject = response.data as JSONObject;
        const message: string = (data["statusMessage"] as string) || "";

        if (data["ok"]) {
          setTestMessage(message);
        } else {
          setTestError(message);
        }
      }
    } catch (err) {
      setTestError(API.getFriendlyMessage(err));
    }

    setIsTesting(false);
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
          title: "Custom Channels",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS_CUSTOM_CHANNELS] as Route,
          ),
        },
      ]}
      sideMenu={<DashboardSideMenu />}
    >
      <Banner
        openInNewTab={true}
        title="What your service receives"
        description="Each page arrives as a JSON request signed with the channel's secret, with links your service calls to acknowledge, escalate or resolve it."
        link={Route.fromString(
          "/docs/self-hosted/custom-notification-channels",
        )}
        hideOnMobile={true}
      />

      <ModelTable<CustomNotificationChannel>
        userPreferencesKey={"admin-custom-notification-channels-table"}
        modelType={CustomNotificationChannel}
        modelAPI={AdminModelAPI}
        id="custom-notification-channels-table"
        name="Settings > Custom Channels"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        createVerb={"Add"}
        refreshToggle={refreshToggle}
        showRefreshButton={true}
        cardProps={{
          title: "Custom Channels",
          description:
            "Reach people through your own service, such as your company's app. Each on-call page goes to the channel's URL, and people see the channel by name in their notification methods and on-call rules, with nothing to set up.",
        }}
        noItemsMessage={
          "No custom channels yet. Add one to send on-call pages to your own service."
        }
        deleteConfirmationWarning={
          "Everyone's on-call rules that use this channel are deleted with it. To stop sending without changing anyone's rules, turn the channel off instead."
        }
        actionButtons={[
          {
            title: "Send test",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.Play,
            onClick: async (
              item: CustomNotificationChannel,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ) => {
              try {
                await sendTest(item);
                onCompleteAction();
              } catch (err) {
                onCompleteAction();
                onError(err as Error);
              }
            },
          },
        ]}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "CorpoApp",
            description:
              "What people see in their notification methods and on-call rules.",
            validation: {
              minLength: 1,
            },
          },
          {
            field: {
              webhookUrl: true,
            },
            title: "Webhook URL",
            fieldType: FormFieldSchemaType.URL,
            required: true,
            placeholder: "https://push.example.com/oneuptime",
            description:
              "OneUptime sends each page here as a JSON POST request. It can be on your private network.",
          },
          {
            field: {
              secret: true,
            },
            title: "Signing Secret",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            defaultValue: defaultSecret,
            description:
              "Your service checks the X-OneUptime-Signature header of every request with this secret. Copy it into your service; you can see it again by editing the channel.",
          },
          {
            field: {
              isEnabled: true,
            },
            title: "On",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            doNotShowWhenCreating: true,
            description:
              "Turn off to stop sending pages to this channel without removing it from anyone's on-call rules.",
          },
          {
            field: {
              pageEveryoneByDefault: true,
            },
            title: "Page everyone through this channel",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            defaultValue: true,
            collapsibleSection: advancedSection,
            description:
              "OneUptime adds this channel to everyone's on-call rules, including people who join later. Turn this off to let people add it to their rules themselves.",
          },
        ]}
        selectMoreFields={{
          secret: true,
        }}
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
              webhookUrl: true,
            },
            title: "Webhook URL",
            type: FieldType.Text,
            hideOnMobile: true,
          },
          {
            field: {
              isEnabled: true,
            },
            title: "On",
            type: FieldType.Boolean,
          },
          {
            field: {
              pageEveryoneByDefault: true,
            },
            title: "Pages Everyone",
            type: FieldType.Boolean,
            hideOnMobile: true,
          },
        ]}
      />

      {testedChannel ? (
        <ConfirmModal
          title={`Send test: ${testedChannel.name || "Custom channel"}`}
          error={testError}
          description={
            isTesting
              ? "Sending a test request…"
              : testMessage ||
                (testError ? "" : "Sending a test request to the channel.")
          }
          submitButtonText={"Close"}
          isLoading={isTesting}
          onSubmit={() => {
            setTestedChannel(null);
            setTestMessage("");
            setTestError("");
            setRefreshToggle(OneUptimeDate.getCurrentDate().toString());
          }}
        />
      ) : (
        <></>
      )}
    </Page>
  );
};

export default SettingsCustomChannels;
