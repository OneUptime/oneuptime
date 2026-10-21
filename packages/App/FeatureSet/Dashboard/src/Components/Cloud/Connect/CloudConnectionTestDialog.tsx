import CloudConnection from "Common/Models/DatabaseModels/CloudConnection";
import {
  CloudConnectionDefinition,
  getCloudConnectionDefinition,
  getCloudConnectionReadIntervalInMinutes,
  READ_INTERVAL_FIELD_KEY,
} from "Common/Types/CloudConnection/CloudConnectionCatalog";
import { CloudConnectionTestResult } from "Common/Types/CloudConnection/CloudConnectionTest";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import { runCloudConnectionTest } from "./CloudConnectApi";
import {
  CloudConnectionTestAnswer,
  CloudConnectionTestRun,
  useCloudConnectionTest,
} from "./CloudConnectionTestPanel";

/*
 * A saved connection's Test, from its row in the list: a small read with
 * the stored settings, run as the dialog opens. The dialog is its answer -
 * what it found, or what to fix - with Test again beside Close.
 */

export interface ComponentProps {
  connection: CloudConnection;
  onClose: () => void;
}

const CloudConnectionTestDialog: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const definition: CloudConnectionDefinition | undefined =
    getCloudConnectionDefinition(props.connection.provider);
  const test: CloudConnectionTestRun = useCloudConnectionTest({
    startImmediately: Boolean(definition && props.connection.id),
    runTest: (): Promise<CloudConnectionTestResult> => {
      return runCloudConnectionTest({
        connectionId: props.connection.id!.toString(),
      });
    },
  });
  const isRunning: boolean = test.state.kind === "running";

  return (
    <Modal
      title={translator.translateTemplate("Test {{name}}", {
        name: props.connection.name || "",
      })}
      description="A small read with the saved settings. Nothing is imported or stored."
      modalWidth={ModalWidth.Medium}
      closeButtonText="Close"
      onClose={props.onClose}
      secondaryButton={
        definition
          ? {
              // Said once: while a test runs, the dialog says so above.
              title: translationKey("Test again"),
              dataTestId: "cloud-connection-test-button",
              disabled: isRunning,
              onClick: () => {
                void test.run();
              },
            }
          : undefined
      }
    >
      <div data-testid="cloud-connection-test-panel">
        {isRunning ? (
          <div
            role="status"
            data-testid="cloud-connection-test-running"
            className="flex items-center gap-2 rounded-lg bg-gray-50 p-4 text-sm text-gray-600 ring-1 ring-inset ring-gray-200"
          >
            <Icon icon={IconProp.Spinner} className="h-4 w-4 animate-spin" />
            <span>{translator.translateText("Testing…")}</span>
          </div>
        ) : (
          <></>
        )}

        {definition ? (
          <CloudConnectionTestAnswer
            definition={definition}
            state={test.state}
            readIntervalInMinutes={getCloudConnectionReadIntervalInMinutes(
              definition,
              props.connection.config?.[READ_INTERVAL_FIELD_KEY],
            )}
          />
        ) : (
          <></>
        )}
      </div>
    </Modal>
  );
};

export default CloudConnectionTestDialog;
