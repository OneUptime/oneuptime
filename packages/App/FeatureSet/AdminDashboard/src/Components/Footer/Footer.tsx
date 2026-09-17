import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import BadDataException from "Common/Types/Exception/BadDataException";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";
import Footer from "Common/UI/Components/Footer/Footer";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { HOST, HTTP_PROTOCOL } from "Common/UI/Config";
import React from "react";
import { useTranslation } from "react-i18next";
import LanguageSwitcher from "../LanguageSwitcher/LanguageSwitcher";

interface VersionInfo {
  version?: string;
  commit?: string;
  error?: string;
}

const DashboardFooter: () => JSX.Element = () => {
  const { t } = useTranslation();
  const [showAboutModal, setShowAboutModal] = React.useState<boolean>(false);
  const [isAboutModalLoading, setIsAboutModalLoading] =
    React.useState<boolean>(false);
  const [versionInfo, setVersionInfo] = React.useState<VersionInfo>({});

  const fetchVersions: PromiseVoidFunction = async (): Promise<void> => {
    setIsAboutModalLoading(true);

    try {
      const version: JSONObject = await fetchAppVersion("/api");
      setVersionInfo({
        version: version["version"] as string,
        commit: version["commit"] as string,
      });
    } catch (err) {
      setVersionInfo({
        error: `${t("footer.versionUnavailable")}: ${(err as Error).message}`,
      });
    }

    setIsAboutModalLoading(false);
  };

  const fetchAppVersion: (appName: string) => Promise<JSONObject> = async (
    appName: string,
  ): Promise<JSONObject> => {
    const response: HTTPResponse<JSONObject> = await API.get<JSONObject>({
      url: URL.fromString(`${HTTP_PROTOCOL}/${HOST}${appName}/version`),
    });

    if (response.data) {
      return response.data as JSONObject;
    }
    throw new BadDataException(t("footer.versionUnavailable"));
  };

  return (
    <>
      <Footer
        className="bg-white px-8"
        copyright={t("footer.copyright")}
        links={[
          {
            title: t("footer.helpSupport"),
            to: URL.fromString("https://oneuptime.com/support"),
          },
          {
            title: t("footer.legal"),
            to: URL.fromString("https://oneuptime.com/legal"),
          },
          {
            title: t("footer.version"),
            onClick: async () => {
              setShowAboutModal(true);
              await fetchVersions();
            },
          },
          {
            content: <LanguageSwitcher />,
          },
        ]}
      />

      {showAboutModal ? (
        <ConfirmModal
          title={t("footer.versionModalTitle")}
          description={
            versionInfo.error ? (
              <div className="text-sm text-red-600">{versionInfo.error}</div>
            ) : (
              <div className="rounded-lg border border-gray-100 bg-gray-50/50 divide-y divide-gray-100">
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                    {t("footer.versionLabel")}
                  </span>
                  <span className="font-mono text-sm text-gray-900">
                    {versionInfo.version || "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                    {t("footer.commitLabel")}
                  </span>
                  <span className="font-mono text-sm text-gray-900">
                    {versionInfo.commit || "—"}
                  </span>
                </div>
              </div>
            )
          }
          isLoading={isAboutModalLoading}
          submitButtonText={t("common.close")}
          onSubmit={() => {
            return setShowAboutModal(false);
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default DashboardFooter;
