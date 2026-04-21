import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import BadDataException from "Common/Types/Exception/BadDataException";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import { JSONObject } from "Common/Types/JSON";
import IconProp from "Common/Types/Icon/IconProp";
import API from "Common/Utils/API";
import Footer from "Common/UI/Components/Footer/Footer";
import Icon from "Common/UI/Components/Icon/Icon";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import EditionLabel from "Common/UI/Components/EditionLabel/EditionLabel";
import { HOST, HTTP_PROTOCOL } from "Common/UI/Config";
import React from "react";

interface VersionInfo {
  version?: string;
  commit?: string;
  error?: string;
}

const DashboardFooter: () => JSX.Element = () => {
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
        error: "Version data is not available: " + (err as Error).message,
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
    throw new BadDataException("Version data is not available");
  };

  return (
    <>
      <Footer
        className="bg-gray-50/50 border-t border-gray-100 px-8"
        copyright="HackerBay, Inc."
        links={[
          {
            content: <EditionLabel />,
          },
          {
            title: (
              <span className="inline-flex items-center gap-1.5 text-gray-400 hover:text-gray-500">
                <Icon icon={IconProp.Help} className="h-3.5 w-3.5" />
                Help and Support
              </span>
            ),
            to: URL.fromString("https://oneuptime.com/support"),
            openInNewTab: true,
          },
          {
            title: (
              <span className="inline-flex items-center gap-1.5 text-gray-400 hover:text-gray-500">
                <Icon icon={IconProp.ShieldCheck} className="h-3.5 w-3.5" />
                Legal
              </span>
            ),
            to: URL.fromString("https://oneuptime.com/legal"),
            openInNewTab: true,
          },
          {
            title: (
              <span className="inline-flex items-center gap-1.5 text-gray-400 hover:text-gray-500">
                <Icon icon={IconProp.Info} className="h-3.5 w-3.5" />
                Version
              </span>
            ),
            onClick: async () => {
              setShowAboutModal(true);
              await fetchVersions();
            },
          },
        ]}
      />

      {showAboutModal ? (
        <ConfirmModal
          title={`OneUptime Version`}
          description={
            versionInfo.error ? (
              <div className="text-sm text-red-600">{versionInfo.error}</div>
            ) : (
              <div className="rounded-lg border border-gray-100 bg-gray-50/50 divide-y divide-gray-100">
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                    Version
                  </span>
                  <span className="font-mono text-sm text-gray-900">
                    {versionInfo.version || "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                    Commit
                  </span>
                  <span className="font-mono text-sm text-gray-900">
                    {versionInfo.commit || "—"}
                  </span>
                </div>
              </div>
            )
          }
          isLoading={isAboutModalLoading}
          submitButtonText={"Close"}
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
