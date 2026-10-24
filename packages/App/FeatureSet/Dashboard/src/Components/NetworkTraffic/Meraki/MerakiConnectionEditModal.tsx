import { runNetworkControllerTest } from "../NetworkTrafficUsageApi";
import MerakiTestResultPanel from "./MerakiTestResultPanel";
import {
  MerakiTemplate,
  drawMerakiTemplate,
  getMerakiIntervalOptions,
} from "./MerakiWords";
import NetworkControllerConnection from "Common/Models/DatabaseModels/NetworkControllerConnection";
import { JSONObject } from "Common/Types/JSON";
import {
  MerakiRegionDefinition,
  getMerakiRegionOrDefault,
} from "Common/Types/NetworkController/MerakiRegion";
import {
  NetworkControllerConfig,
  readNetworkControllerConfig,
} from "Common/Types/NetworkController/NetworkControllerConnectionSettings";
import { NetworkControllerTestResult } from "Common/Types/NetworkController/NetworkControllerConnectionTest";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * Edit a Meraki connection: its name, how often its uplinks are read, and a
 * new API key when the old one was revoked. Three rows, one page.
 *
 * The organization and the region are not here: where the reads got to is
 * that organization's, so another organization is a connection of its own.
 * The key is write-only - left empty, the stored one is kept.
 *
 * A new key is tested before it is saved, against the connection's own
 * organization and region (POST /network-controller-connection/test with
 * the connection's ID): one Meraki refuses is not saved - the dialog says
 * why, and the key stays in its field to be corrected - so a key change
 * never turns a working connection into a failing one a minute later.
 * Opened from a refused key's Update API key, the dialog starts in the
 * key's field.
 */

export interface ComponentProps {
  connection: NetworkControllerConnection;
  // Opened to replace a refused key: the key's field has the focus.
  focusKey?: boolean | undefined;
  onClose: () => void;
  onSaved: () => void;
}

const NAME_MAX_LENGTH: number = 50;

const MerakiConnectionEditModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const config: NetworkControllerConfig = readNetworkControllerConfig(
    props.connection.config,
  );
  const region: MerakiRegionDefinition = getMerakiRegionOrDefault(
    config.region,
  );
  const [name, setName] = useState<string>(props.connection.name || "");
  const [interval, setReadInterval] = useState<number>(
    config.readIntervalInMinutes,
  );
  const [apiKey, setApiKey] = useState<string>("");
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  // A new key's test that did not pass: shown, and nothing saved.
  const [keyTest, setKeyTest] = useState<NetworkControllerTestResult | null>(
    null,
  );

  /*
   * Opened to replace a refused key: the key's field has the focus. The
   * dialog puts it on its first field as it opens; this runs after it (a
   * parent's effect runs after its children's).
   */
  useEffect(() => {
    if (!props.focusKey) {
      return;
    }

    document.getElementById("meraki-edit-key")?.focus();
  }, []);

  const save: () => Promise<void> = async (): Promise<void> => {
    if (!props.connection.id) {
      return;
    }

    if (!name.trim()) {
      setError(translator.translateText("Enter a name.") || "");
      return;
    }

    setIsSaving(true);
    setError("");
    setKeyTest(null);

    const data: JSONObject = {
      name: name.trim().substring(0, NAME_MAX_LENGTH),
      config: { readIntervalInMinutes: interval },
    };

    if (apiKey.trim()) {
      const result: NetworkControllerTestResult =
        await runNetworkControllerTest({
          connectionId: props.connection.id.toString(),
          secrets: { apiKey: apiKey.trim() },
        });

      if (result.status === "fail") {
        setKeyTest(result);
        setIsSaving(false);
        return;
      }

      data["secrets"] = JSON.stringify({ apiKey: apiKey.trim() });
    }

    try {
      await ModelAPI.updateById<NetworkControllerConnection>({
        modelType: NetworkControllerConnection,
        id: props.connection.id,
        data: data,
      });

      props.onSaved();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      setIsSaving(false);
    }
  };

  return (
    <Modal
      title="Edit Meraki connection"
      description={translator.translateTemplate(
        "Reads {{organization}}. To read another organization, connect it as well.",
        {
          organization: config.organizationName || config.organizationId,
        },
      )}
      onClose={props.onClose}
      submitButtonText="Save Changes"
      onSubmit={() => {
        save().catch(() => {
          setIsSaving(false);
        });
      }}
      isLoading={isSaving}
      error={error || undefined}
      modalWidth={ModalWidth.Medium}
    >
      <div className="space-y-4" data-testid="meraki-edit">
        <div>
          <label
            htmlFor="meraki-edit-name"
            className="block text-sm font-medium text-gray-900"
          >
            {translator.translateText("Name")}
          </label>
          <div className="mt-1">
            <Input
              id="meraki-edit-name"
              value={name}
              onChange={(value: string) => {
                setName(value.substring(0, NAME_MAX_LENGTH));
              }}
              dataTestId="meraki-edit-name"
            />
          </div>
        </div>
        <div>
          <label
            htmlFor="meraki-edit-interval"
            className="block text-sm font-medium text-gray-900"
          >
            {translator.translateText("Read uplink usage")}
          </label>
          <select
            id="meraki-edit-interval"
            value={String(interval)}
            onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
              setReadInterval(Number(event.target.value));
            }}
            className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            data-testid="meraki-edit-interval"
          >
            {getMerakiIntervalOptions().map(
              (option: {
                value: number;
                words: MerakiTemplate;
              }): ReactElement => {
                return (
                  <option key={option.value} value={option.value}>
                    {drawMerakiTemplate(translator, option.words)}
                  </option>
                );
              },
            )}
          </select>
        </div>
        <div>
          <label
            htmlFor="meraki-edit-key"
            className="block text-sm font-medium text-gray-900"
          >
            {translator.translateText("New API key (Optional)")}
          </label>
          <div className="mt-1">
            <Input
              id="meraki-edit-key"
              type={InputType.PASSWORD}
              value={apiKey}
              onChange={(value: string) => {
                setApiKey(value);
                setKeyTest(null);
              }}
              placeholder={translator.translateText(
                "Leave empty to keep the key",
              )}
              dataTestId="meraki-edit-key"
            />
          </div>
          <p className="mt-1.5 text-xs text-gray-500">
            {translator.translateText(
              "The key is never shown again. Paste a new one only to replace it, for example after the old one was revoked.",
            )}
          </p>
        </div>
        {keyTest ? (
          <MerakiTestResultPanel
            result={keyTest}
            organizationName={config.organizationName}
            dashboardHost={region.dashboardHost}
          />
        ) : (
          <></>
        )}
      </div>
    </Modal>
  );
};

export default MerakiConnectionEditModal;
