import FormsCopy from "./FormsCopy";
import { getFormShareLink } from "./FormShareLink";
import Form from "Common/Models/DatabaseModels/Form";
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
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useRef,
  useState,
} from "react";
import useAsyncEffect from "use-async-effect";

/*
 * A form's link, on its Share page: the link itself, copying it, opening the
 * form the way the people it is shared with see it, and Reset Link, which
 * gives the form a new key so the old link stops working.
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

// What the card last read: the form it belongs to, its key and Enabled.
interface LoadedLink {
  formId: string;
  shareKey: ObjectID;
  isEnabled: boolean;
}

const FormShareLinkCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

  const [loaded, setLoaded] = useState<LoadedLink | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  /*
   * Reads are numbered so that only the latest one is shown: a slow answer
   * to an earlier read must not replace a newer one.
   */
  const latestReadRef: MutableRefObject<number> = useRef<number>(0);

  const load: PromiseVoidFunction = async (): Promise<void> => {
    const formId: string = props.modelId.toString();

    latestReadRef.current += 1;
    const read: number = latestReadRef.current;

    setIsLoading(true);
    setError("");

    let next: LoadedLink | null = null;
    let nextError: string = "";

    try {
      const form: Form | null = await ModelAPI.getItem<Form>({
        modelType: Form,
        id: props.modelId,
        select: {
          shareKey: true,
          isEnabled: true,
        },
      });

      if (form && form.shareKey) {
        next = {
          formId: formId,
          shareKey: new ObjectID(form.shareKey.toString()),
          // The column defaults to on, so only an explicit false is off.
          isEnabled: form.isEnabled !== false,
        };
      } else {
        nextError = FormsCopy.shareLinkNotFound;
      }
    } catch (err) {
      nextError = API.getFriendlyMessage(err);
    }

    if (read !== latestReadRef.current) {
      return;
    }

    setLoaded(next);
    setError(nextError);
    setIsLoading(false);
  };

  useAsyncEffect(async () => {
    await load();
  }, [props.modelId.toString(), props.refresher]);

  /*
   * Reading the same form again - after it was turned on or off elsewhere on
   * the page - keeps its link on screen meanwhile, so the card does not
   * blink. Another form's link is never shown for this one.
   */
  const shown: LoadedLink | null =
    loaded && loaded.formId === props.modelId.toString() ? loaded : null;

  /*
   * Until there is a link to show, there is nothing to copy, open or reset:
   * the card says what it is for and why it is empty, with no button.
   */
  if (!shown) {
    return (
      <Card
        title={FormsCopy.shareLinkTitle}
        description={FormsCopy.shareLinkDescription}
      >
        {isLoading ? (
          <ComponentLoader />
        ) : (
          <ErrorMessage message={error || FormsCopy.shareLinkNotFound} />
        )}
      </Card>
    );
  }

  const link: URL = getFormShareLink(shown.shareKey);
  const linkText: string = link.toString();

  return (
    <ResetObjectID<Form>
      modelType={Form}
      fieldName="shareKey"
      modelId={props.modelId}
      title={FormsCopy.shareLinkTitle}
      description={FormsCopy.shareLinkDescription}
      buttonTitle={FormsCopy.resetLink}
      confirmTitle={FormsCopy.resetLink}
      confirmDescription={FormsCopy.resetLinkConfirmation}
      confirmButtonText={FormsCopy.resetLink}
      resultTitle={FormsCopy.newLinkTitle}
      resultDescription={FormsCopy.newLinkDescription}
      onUpdateComplete={(newShareKey: ObjectID) => {
        // The server stores the key exactly as sent: no need to read it back.
        setLoaded({
          ...shown,
          shareKey: newShareKey,
        });
      }}
    >
      <div className="space-y-4" data-testid="form-share-link-card">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <code
            className="block min-w-0 flex-1 select-all break-all rounded-md border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-sm text-gray-900"
            data-testid="form-share-link"
          >
            {linkText}
          </code>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <CopyTextButton
              textToBeCopied={linkText}
              label={
                translateString(FormsCopy.copyLink) ||
                FormsCopy.copyLink
              }
              copiedLabel={translateString("Copied!") || "Copied!"}
              title={
                translateString(FormsCopy.copyLink) ||
                FormsCopy.copyLink
              }
              size="md"
              variant="soft"
            />
            <Link
              to={link}
              openInNewTab={true}
              className={LINK_ACTION_CLASS_NAME}
              id="form-open-form"
            >
              <Icon icon={IconProp.ExternalLink} className="h-4 w-4" />
              <span>
                {translateString(FormsCopy.openForm) ||
                  FormsCopy.openForm}
              </span>
            </Link>
          </div>
        </div>

        {shown.isEnabled ? (
          <></>
        ) : (
          <Alert
            type={AlertType.WARNING}
            title={FormsCopy.formTurnedOff}
            dataTestId="form-share-link-turned-off"
          />
        )}
      </div>
    </ResetObjectID>
  );
};

export default FormShareLinkCard;
