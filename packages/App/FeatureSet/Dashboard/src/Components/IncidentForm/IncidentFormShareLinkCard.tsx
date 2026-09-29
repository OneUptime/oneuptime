import IncidentFormCopy from "./IncidentFormCopy";
import { getIncidentFormShareLink } from "./IncidentFormShareLink";
import IncidentForm from "Common/Models/DatabaseModels/IncidentForm";
import URL from "Common/Types/API/URL";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import ResetObjectID from "Common/UI/Components/ResetObjectID/ResetObjectID";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, { FunctionComponent, ReactElement, useState } from "react";
import useAsyncEffect from "use-async-effect";

/*
 * An incident form's link, on the form's page: the link itself, copying it,
 * opening the form the way a reporter sees it, and Reset Link, which gives
 * the form a new key so the old link stops working.
 *
 * The card is ResetObjectID's own, since resetting is an update of the
 * form's shareKey column like any other key reset: a viewer who may not
 * update the form sees the button locked and told why, and can still copy
 * and open the link - everybody who can read a form can share it.
 *
 * Reading the link is the card's own request (the key and Enabled), not the
 * page's: the page asks it to look again, through `refresher`, after the
 * form was turned on or off elsewhere on the page.
 */

export interface ComponentProps {
  modelId: ObjectID;
  refresher?: boolean | undefined;
}

// The two actions next to the link look alike: they are equally safe.
const LINK_ACTION_CLASS_NAME: string =
  "inline-flex items-center justify-center gap-1 rounded-md border border-gray-200 bg-gray-100 px-2.5 py-1.5 text-sm text-gray-600 hover:bg-gray-200";

const IncidentFormShareLinkCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

  const [shareKey, setShareKey] = useState<ObjectID | null>(null);
  const [isEnabled, setIsEnabled] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const load: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");

    try {
      const form: IncidentForm | null = await ModelAPI.getItem<IncidentForm>({
        modelType: IncidentForm,
        id: props.modelId,
        select: {
          shareKey: true,
          isEnabled: true,
        },
      });

      if (form && form.shareKey) {
        setShareKey(new ObjectID(form.shareKey.toString()));
        // The column defaults to on, so only an explicit false is off.
        setIsEnabled(form.isEnabled !== false);
      } else {
        setShareKey(null);
        setError(IncidentFormCopy.shareLinkNotFound);
      }
    } catch (err) {
      setShareKey(null);
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useAsyncEffect(async () => {
    await load();
  }, [props.modelId.toString(), props.refresher]);

  /*
   * Until there is a link to show, there is nothing to copy, open or reset:
   * the card says what it is for and why it is empty, with no button.
   */
  if (isLoading || error || !shareKey) {
    return (
      <Card
        title={IncidentFormCopy.shareLinkTitle}
        description={IncidentFormCopy.shareLinkDescription}
      >
        {isLoading ? (
          <ComponentLoader />
        ) : (
          <ErrorMessage message={error || IncidentFormCopy.shareLinkNotFound} />
        )}
      </Card>
    );
  }

  const link: URL = getIncidentFormShareLink(shareKey);
  const linkText: string = link.toString();

  return (
    <ResetObjectID<IncidentForm>
      modelType={IncidentForm}
      fieldName="shareKey"
      modelId={props.modelId}
      title={IncidentFormCopy.shareLinkTitle}
      description={IncidentFormCopy.shareLinkDescription}
      buttonTitle={IncidentFormCopy.resetLink}
      confirmTitle={IncidentFormCopy.resetLink}
      confirmDescription={IncidentFormCopy.resetLinkConfirmation}
      confirmButtonText={IncidentFormCopy.resetLink}
      resultTitle={IncidentFormCopy.newLinkTitle}
      resultDescription={IncidentFormCopy.newLinkDescription}
      onUpdateComplete={(newShareKey: ObjectID) => {
        setShareKey(newShareKey);
      }}
    >
      <div className="space-y-4" data-testid="incident-form-share-link-card">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <code
            className="block min-w-0 flex-1 select-all break-all rounded-md border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-sm text-gray-900"
            data-testid="incident-form-share-link"
          >
            {linkText}
          </code>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <CopyTextButton
              textToBeCopied={linkText}
              label={
                translateString(IncidentFormCopy.copyLink) ||
                IncidentFormCopy.copyLink
              }
              copiedLabel={translateString("Copied!") || "Copied!"}
              title={
                translateString(IncidentFormCopy.copyLink) ||
                IncidentFormCopy.copyLink
              }
              size="md"
              variant="soft"
            />
            <Link
              to={link}
              openInNewTab={true}
              className={LINK_ACTION_CLASS_NAME}
              id="incident-form-open-form"
            >
              <Icon icon={IconProp.ExternalLink} className="h-4 w-4" />
              <span>
                {translateString(IncidentFormCopy.openForm) ||
                  IncidentFormCopy.openForm}
              </span>
            </Link>
          </div>
        </div>

        {isEnabled ? (
          <></>
        ) : (
          <Alert
            type={AlertType.WARNING}
            title={IncidentFormCopy.formTurnedOff}
            dataTestId="incident-form-share-link-turned-off"
          />
        )}
      </div>
    </ResetObjectID>
  );
};

export default IncidentFormShareLinkCard;
