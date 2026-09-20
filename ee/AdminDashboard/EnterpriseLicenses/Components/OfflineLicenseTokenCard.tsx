import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import downloadFile from "Common/UI/Utils/DownloadFile";
import React, { FunctionComponent, ReactElement, useState } from "react";
import { useTranslation } from "react-i18next";

/*
 * "Download offline license token" on the license view: for a customer
 * installation that cannot reach oneuptime.com. The license server signs an
 * EdDSA license bound to the installation's instance id
 * (POST /enterprise-license/:id/offline-token, master admins only) and the
 * browser saves it as a text file the customer pastes into their Admin
 * Dashboard. The token is never kept in page state or shown on screen.
 *
 * When the server has no EdDSA signing key its build trusts, the request is
 * answered 400 with the reason, shown in the dialog.
 */

export interface OfflineLicenseToken {
  token: string;
  instanceId: string;
  expiresAt: string;
}

interface OfflineTokenFormValues {
  instanceId: string;
}

const FILENAME_UNSAFE_CHARACTERS: RegExp = /[^a-zA-Z0-9-_]+/g;

const EDGE_DASHES: RegExp = /^-+|-+$/g;

export const getOfflineLicenseTokenRoute: (licenseId: ObjectID) => URL = (
  licenseId: ObjectID,
): URL => {
  return URL.fromString(APP_API_URL.toString()).addRoute(
    `/enterprise-license/${licenseId.toString()}/offline-token`,
  );
};

export const getOfflineLicenseTokenFilename: (data: {
  companyName: string | undefined;
  instanceId: string;
}) => string = (data: {
  companyName: string | undefined;
  instanceId: string;
}): string => {
  const company: string =
    (data.companyName || "")
      .replace(FILENAME_UNSAFE_CHARACTERS, "-")
      .replace(EDGE_DASHES, "")
      .toLowerCase()
      .substring(0, 40) || "license";

  return `oneuptime-enterprise-license-${company}-${data.instanceId}.txt`;
};

export const requestOfflineLicenseToken: (data: {
  licenseId: ObjectID;
  instanceId: string;
}) => Promise<OfflineLicenseToken> = async (data: {
  licenseId: ObjectID;
  instanceId: string;
}): Promise<OfflineLicenseToken> => {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: getOfflineLicenseTokenRoute(data.licenseId),
      data: {
        instanceId: data.instanceId,
      },
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  const token: unknown = response.data?.["token"];

  if (typeof token !== "string" || token.length === 0) {
    throw new Error("The license server did not return a license token.");
  }

  return {
    token,
    instanceId: String(response.data?.["instanceId"] || data.instanceId),
    expiresAt: String(response.data?.["expiresAt"] || ""),
  };
};

export interface ComponentProps {
  licenseId: ObjectID;
  companyName?: string | undefined;
}

const OfflineLicenseTokenCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { t } = useTranslation();

  const [showModal, setShowModal] = useState<boolean>(false);
  const [isIssuing, setIsIssuing] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [issuedForInstanceId, setIssuedForInstanceId] = useState<string>("");

  const issueToken: (values: OfflineTokenFormValues) => Promise<void> = async (
    values: OfflineTokenFormValues,
  ): Promise<void> => {
    setIsIssuing(true);
    setError("");

    try {
      const issued: OfflineLicenseToken = await requestOfflineLicenseToken({
        licenseId: props.licenseId,
        instanceId: (values.instanceId || "").toString().trim(),
      });

      downloadFile({
        content: issued.token,
        filename: getOfflineLicenseTokenFilename({
          companyName: props.companyName,
          instanceId: issued.instanceId,
        }),
        mimeType: "text/plain;charset=utf-8;",
      });

      setIssuedForInstanceId(issued.instanceId);
      setShowModal(false);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsIssuing(false);
    }
  };

  return (
    <Card
      title={t("pages.enterpriseLicenseView.offlineTokenCardTitle")}
      description={t("pages.enterpriseLicenseView.offlineTokenCardDescription")}
      buttons={[
        {
          title: t("pages.enterpriseLicenseView.offlineTokenButton"),
          buttonStyle: ButtonStyleType.NORMAL,
          icon: IconProp.Download,
          onClick: () => {
            setError("");
            setShowModal(true);
          },
        },
      ]}
    >
      <>
        {issuedForInstanceId ? (
          <div
            className="text-sm text-gray-600"
            data-testid="offline-license-token-issued"
          >
            {t("pages.enterpriseLicenseView.offlineTokenIssued", {
              instanceId: issuedForInstanceId,
            })}
          </div>
        ) : (
          <></>
        )}

        {showModal ? (
          <BasicFormModal<OfflineTokenFormValues>
            title={t("pages.enterpriseLicenseView.offlineTokenModalTitle")}
            description={t(
              "pages.enterpriseLicenseView.offlineTokenModalDescription",
            )}
            isLoading={isIssuing}
            submitButtonText={t(
              "pages.enterpriseLicenseView.offlineTokenSubmitButton",
            )}
            onClose={() => {
              setShowModal(false);
              setError("");
            }}
            onSubmit={(values: OfflineTokenFormValues) => {
              issueToken(values).catch((err: Error) => {
                setError(API.getFriendlyMessage(err));
              });
            }}
            formProps={{
              id: "offline-license-token-form",
              name: "Offline License Token",
              error: error,
              initialValues: {
                instanceId: "",
              },
              fields: [
                {
                  field: {
                    instanceId: true,
                  },
                  title: "Instance ID",
                  description:
                    "The instance ID of the customer's OneUptime installation. The token works only on that installation.",
                  required: true,
                  fieldType: FormFieldSchemaType.Text,
                  placeholder: "00000000-0000-0000-0000-000000000000",
                  disableSpellCheck: true,
                },
              ],
            }}
          />
        ) : (
          <></>
        )}
      </>
    </Card>
  );
};

export default OfflineLicenseTokenCard;
