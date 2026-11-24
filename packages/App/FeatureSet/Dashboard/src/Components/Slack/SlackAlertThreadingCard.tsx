import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import Exception from "Common/Types/Exception/Exception";
import { JSONObject } from "Common/Types/JSON";
import Permission from "Common/Types/Permission";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Loader from "Common/UI/Components/Loader/Loader";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "Common/UI/Utils/PermissionGate";
import Toast, { CHANGES_SAVED } from "Common/UI/Utils/Toast";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

const TITLE: string = translationKey("Slack Alert Threads");
const DESCRIPTION: string = translationKey(
  "Post updates for alerts and alert episodes in Slack threads and update the original message when their state changes.",
);
const CAN_EDIT: string = translationKey(
  "Only a project owner or admin can change Slack alert threading.",
);

const SlackAlertThreadingCard: FunctionComponent = (): ReactElement => {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState<string>("");
  const [saving, setSaving] = useState<boolean>(false);
  const translator: Translator = useTranslator();
  const canEdit: boolean = PermissionGate.checkPermissions(
    [Permission.ProjectOwner, Permission.ProjectAdmin],
    { sentence: CAN_EDIT },
  ).isAllowed;

  useEffect(() => {
    let active: boolean = true;
    const load: () => Promise<void> = async () => {
      try {
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.get<JSONObject>({
            url: URL.fromURL(APP_API_URL).addRoute("/slack/alert-threading"),
            headers: ModelAPI.getCommonHeaders(),
          });
        if (response instanceof HTTPErrorResponse) {
          throw response;
        }
        if (active) {
          setEnabled(response.data?.["enabled"] === true);
        }
      } catch (err) {
        if (active) {
          setError(API.getFriendlyErrorMessage(err as Exception));
        }
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, []);

  const save: (value: boolean) => Promise<void> = async (value: boolean) => {
    setSaving(true);
    setError("");
    setEnabled(value);
    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.put<JSONObject>({
          url: URL.fromURL(APP_API_URL).addRoute("/slack/alert-threading"),
          data: { enabled: value },
          headers: ModelAPI.getCommonHeaders(),
        });
      if (response instanceof HTTPErrorResponse) {
        throw response;
      }
      Toast.success(translator.translateText(CHANGES_SAVED) || CHANGES_SAVED);
    } catch (err) {
      setEnabled(enabled);
      setError(API.getFriendlyErrorMessage(err as Exception));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title={TITLE} description={DESCRIPTION}>
      <>
        {enabled === null && !error && <Loader />}
        {enabled !== null && (
          <Toggle
            title={TITLE}
            value={enabled}
            disabled={saving || !canEdit}
            tooltip={canEdit ? undefined : CAN_EDIT}
            onChange={(value: boolean) => {
              void save(value);
            }}
          />
        )}
        {error && <ErrorMessage message={error} />}
      </>
    </Card>
  );
};

export default SlackAlertThreadingCard;
