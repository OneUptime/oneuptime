import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import OpenStackCloudCheck from "Common/Models/DatabaseModels/OpenStackCloudCheck";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import OpenStackPartNotice from "../Part/OpenStackPartNotice";
import { OpenStackApiCheckFormModal } from "./OpenStackCheckFormModals";
import {
  OPENSTACK_API_CHECK_STATEMENT,
  OPENSTACK_CHECK_TONE_CLASS_NAMES,
  OpenStackApiServiceRow,
  OpenStackCertificateRow,
  OpenStackTokenSummary,
  getOpenStackApiServiceRows,
  getOpenStackCertificateRows,
  getOpenStackTokenSummary,
  isOpenStackApiCheckOneClick,
} from "./OpenStackChecksView";

/*
 * Is the cloud's front door open: can a user get a token, does each service in the catalog answer,
 * and how long have its certificates got. On a cloud a probe already collects this is one click.
 * Every row is what the probe last met, in its words.
 */

export interface ComponentProps {
  openStackCloudId: ObjectID;
  cloud: OpenStackCloud;
  check: OpenStackCloudCheck | null;
  canEdit: boolean;
  onChanged: () => void;
}

export const OpenStackCheckPill: FunctionComponent<{
  className: string;
  text: string;
}> = (props: { className: string; text: string }): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <span
      className={`inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-xs font-medium ${props.className}`}
    >
      {translator.translateText(props.text)}
    </span>
  );
};

function getDaysLeftText(daysLeft: number, translator: Translator): string {
  if (daysLeft < 0) {
    return translator.translateText("Expired") as string;
  }

  return daysLeft === 1
    ? (translator.translateText("1 day left") as string)
    : (translator.translateTemplate("{{days}} days left", {
        days: String(daysLeft),
      }) as string);
}

const OpenStackApiChecksCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isFormOpen, setIsFormOpen] = useState<boolean>(false);
  const [isConfirmingOff, setIsConfirmingOff] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string>("");

  const isOn: boolean = props.check?.isApiCheckEnabled === true;
  const isOneClick: boolean = isOpenStackApiCheckOneClick(props.cloud);
  const isLifecycleOn: boolean = props.check?.isLifecycleCheckEnabled === true;

  const save: (data: JSONObject, after: () => void) => void = (
    data: JSONObject,
    after: () => void,
  ): void => {
    setIsSaving(true);
    setSaveError("");

    const write: Promise<unknown> = props.check?.id
      ? ModelAPI.updateById({
          modelType: OpenStackCloudCheck,
          id: props.check.id,
          data: data,
        })
      : ModelAPI.create({
          model: Object.assign(new OpenStackCloudCheck(), data, {
            openStackCloudId: props.openStackCloudId,
          }),
          modelType: OpenStackCloudCheck,
        });

    write
      .then(() => {
        after();
        props.onChanged();
      })
      .catch((err: Error) => {
        setSaveError(API.getFriendlyErrorMessage(err));
      })
      .finally(() => {
        setIsSaving(false);
      });
  };

  const buttons: Array<CardButtonSchema> = [];

  if (props.canEdit && isOn) {
    buttons.push({
      title: "Turn Off",
      buttonStyle: ButtonStyleType.OUTLINE,
      icon: IconProp.Close,
      onClick: () => {
        setSaveError("");
        setIsConfirmingOff(true);
      },
    });
    buttons.push({
      title: "Edit",
      buttonStyle: ButtonStyleType.NORMAL,
      icon: IconProp.Edit,
      onClick: () => {
        setIsFormOpen(true);
      },
    });
  }

  if (props.canEdit && !isOn) {
    buttons.push({
      title: "Turn On API Checks",
      buttonStyle: ButtonStyleType.NORMAL,
      icon: IconProp.Play,
      isLoading: isSaving,
      onClick: () => {
        if (isOneClick) {
          save({ isApiCheckEnabled: true }, () => {});
          return;
        }

        setIsFormOpen(true);
      },
    });
  }

  const token: OpenStackTokenSummary | null = getOpenStackTokenSummary(
    props.check?.apiCheckResult,
  );
  const services: Array<OpenStackApiServiceRow> = getOpenStackApiServiceRows(
    props.check?.apiCheckResult,
  );
  const certificates: Array<OpenStackCertificateRow> =
    getOpenStackCertificateRows({
      result: props.check?.apiCheckResult,
      now: OneUptimeDate.getCurrentDate(),
    });
  const warnings: Array<string> = props.check?.apiCheckResult?.warnings || [];

  return (
    <Fragment>
      <Card
        title="API Checks"
        description={
          isOn
            ? "A probe outside the cloud asks for a token, reads each service once, and reads each public certificate."
            : "Is the cloud's front door open, from where your users are?"
        }
        buttons={buttons}
      >
        <div className="space-y-4 text-sm" data-testid="openstack-api-checks">
          {saveError ? <ErrorMessage message={saveError} /> : <></>}

          {!isOn ? (
            <div data-testid="openstack-api-checks-off" className="space-y-2">
              <p className="text-gray-700">
                {translator.translateText(OPENSTACK_API_CHECK_STATEMENT)}
              </p>
              <p className="text-gray-500">
                {translator.translateText(
                  isOneClick
                    ? "It uses the probe and the credential this cloud is already collected with."
                    : "Tell it where Keystone is, which probe to use, and how to log in. A read-only credential will do.",
                )}
              </p>
            </div>
          ) : (
            <></>
          )}

          {isOn && props.check?.checkError ? (
            <OpenStackPartNotice
              testId="openstack-api-checks-error"
              tone="warning"
            >
              {/* The server's own sentence, kept as it is. */}
              <span>{props.check.checkError}</span>
            </OpenStackPartNotice>
          ) : (
            <></>
          )}

          {isOn && !props.check?.lastApiCheckAt ? (
            <p
              className="text-gray-500"
              data-testid="openstack-api-checks-waiting"
            >
              {translator.translateText(
                "Waiting for the probe's first report. It asks for work every few seconds.",
              )}
            </p>
          ) : (
            <></>
          )}

          {isOn && props.check?.lastApiCheckAt ? (
            <p
              className="text-gray-500"
              data-testid="openstack-api-checks-last-run"
            >
              {translator.translateTemplate("Last checked {{time}}.", {
                time: OneUptimeDate.fromNow(props.check.lastApiCheckAt),
              })}
            </p>
          ) : (
            <></>
          )}

          {isOn && token ? (
            <div
              className="flex flex-wrap items-start gap-2"
              data-testid="openstack-api-checks-token"
            >
              <OpenStackCheckPill
                className={OPENSTACK_CHECK_TONE_CLASS_NAMES[token.tone]}
                text={token.tone === "good" ? "Passed" : "Failing"}
              />
              <div className="min-w-0 break-words text-gray-700">
                {token.durationText
                  ? translator.translateTemplate(
                      "Keystone issued a token in {{duration}}",
                      { duration: token.durationText },
                    )
                  : translator.translateText(token.text || "")}
                {token.message ? (
                  <div className="text-gray-500">{token.message}</div>
                ) : (
                  <></>
                )}
              </div>
            </div>
          ) : (
            <></>
          )}

          {isOn && services.length > 0 ? (
            <div>
              <div className="mb-1 font-medium text-gray-900">
                {translator.translateText("Services")}
              </div>
              <ul
                className="divide-y divide-gray-100"
                data-testid="openstack-api-checks-services"
              >
                {services.map(
                  (service: OpenStackApiServiceRow): ReactElement => {
                    return (
                      <li
                        key={service.id}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
                      >
                        <OpenStackCheckPill
                          className={
                            OPENSTACK_CHECK_TONE_CLASS_NAMES[service.tone]
                          }
                          text={service.outcomeText}
                        />
                        <span className="font-medium text-gray-900">
                          {service.service}
                        </span>
                        <span className="text-gray-500">
                          {service.regionName}
                        </span>
                        <code className="break-all text-xs text-gray-500">
                          {service.read}
                        </code>
                        <span className="ml-auto text-gray-500">
                          {service.status ? `${service.status} · ` : ""}
                          {service.durationText}
                        </span>
                        {service.message ? (
                          <div className="w-full break-words text-gray-500">
                            {service.message}
                          </div>
                        ) : (
                          <></>
                        )}
                      </li>
                    );
                  },
                )}
              </ul>
            </div>
          ) : (
            <></>
          )}

          {isOn && certificates.length > 0 ? (
            <div>
              <div className="mb-1 font-medium text-gray-900">
                {translator.translateText("Certificates")}
              </div>
              <ul
                className="divide-y divide-gray-100"
                data-testid="openstack-api-checks-certificates"
              >
                {certificates.map(
                  (certificate: OpenStackCertificateRow): ReactElement => {
                    return (
                      <li
                        key={certificate.id}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
                      >
                        <span
                          className={`inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-xs font-medium ${OPENSTACK_CHECK_TONE_CLASS_NAMES[certificate.tone]}`}
                        >
                          {getDaysLeftText(certificate.daysLeft, translator)}
                        </span>
                        <span className="break-all font-medium text-gray-900">
                          {certificate.address}
                        </span>
                        <span className="text-gray-500">
                          {certificate.serves}
                        </span>
                        <span className="ml-auto text-gray-500">
                          {certificate.validTo}
                        </span>
                      </li>
                    );
                  },
                )}
              </ul>
            </div>
          ) : (
            <></>
          )}

          {isOn && warnings.length > 0 ? (
            <ul
              className="list-disc space-y-1 pl-5 text-gray-500"
              data-testid="openstack-api-checks-warnings"
            >
              {warnings.map((warning: string): ReactElement => {
                return (
                  <li key={warning} className="break-words">
                    {warning}
                  </li>
                );
              })}
            </ul>
          ) : (
            <></>
          )}
        </div>
      </Card>

      {isFormOpen ? (
        <OpenStackApiCheckFormModal
          openStackCloudId={props.openStackCloudId}
          cloud={props.cloud}
          saved={props.check}
          onClose={() => {
            setIsFormOpen(false);
          }}
          onSuccess={() => {
            setIsFormOpen(false);
            props.onChanged();
          }}
        />
      ) : (
        <></>
      )}

      {isConfirmingOff ? (
        <ConfirmModal
          title="Turn Off API Checks"
          description={
            isLifecycleOn
              ? "The lifecycle check goes off with them, as its results travel with these. A probe clears up anything a run left, then their credential is deleted."
              : "A probe stops checking this cloud, and any credential saved for these checks is deleted."
          }
          submitButtonText="Turn Off API Checks"
          submitButtonType={ButtonStyleType.DANGER}
          isLoading={isSaving}
          error={saveError || undefined}
          onClose={() => {
            setIsConfirmingOff(false);
          }}
          onSubmit={() => {
            save({ isApiCheckEnabled: false }, () => {
              setIsConfirmingOff(false);
            });
          }}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default OpenStackApiChecksCard;
