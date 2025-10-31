import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import Dictionary from "Common/Types/Dictionary";
import BadDataException from "Common/Types/Exception/BadDataException";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";
import Footer from "Common/UI/Components/Footer/Footer";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import EditionLabel from "Common/UI/Components/EditionLabel/EditionLabel";
import { HOST, HTTP_PROTOCOL } from "Common/UI/Config";
import React from "react";

const DashboardFooter: () => JSX.Element = () => {
  const [showAboutModal, setShowAboutModal] = React.useState<boolean>(false);
  const [isAboutModalLoading, setIsAboutModalLoading] =
    React.useState<boolean>(false);
  const [versionText, setVersionText] = React.useState<Dictionary<string>>({});

  const fetchVersions: PromiseVoidFunction = async (): Promise<void> => {
    setIsAboutModalLoading(true);

    try {
      const verText: Dictionary<string> = {};
      const apps: Array<{
        name: string;
        path: string;
      }> = [
        {
          name: "API",
          path: "/api",
        },
        {
          name: "Dashboard",
          path: "/dashboard",
        },
      ];

      for (const app of apps) {
        const version: JSONObject = await fetchAppVersion(app.path);
        verText[app.name] =
          `${app.name}: ${version["version"]} (${version["commit"]})`;
      }

      setVersionText(verText);
    } catch (err) {
      setVersionText({
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
        className="bg-white px-8"
        copyright="HackerBay, Inc."
        links={[
          {
            content: <EditionLabel />, 
          },
          {
            title: "Help and Support",
            to: URL.fromString("https://oneuptime.com/support"),
          },
          {
            title: "Legal",
            to: URL.fromString("https://oneuptime.com/legal"),
          },
          {
            title: "Version",
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
            <div>
              {Object.keys(versionText).map((key: string, i: number) => {
                return <div key={i}>{versionText[key]}</div>;
              })}
            </div>
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
