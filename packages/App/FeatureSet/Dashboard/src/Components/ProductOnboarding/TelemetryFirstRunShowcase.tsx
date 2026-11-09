import React, { FunctionComponent, ReactElement, useState } from "react";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import IconProp from "Common/Types/Icon/IconProp";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Service from "Common/Models/DatabaseModels/Service";
import TelemetryIngestionKey from "Common/Models/DatabaseModels/TelemetryIngestionKey";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import ProjectUtil from "Common/UI/Utils/Project";
import PageMap from "../../Utils/PageMap";
import useFirstRecordWatch, {
  FirstRecordWatch,
} from "../Infrastructure/UseFirstRecordWatch";
import ResourceConnectionWatch from "../ResourceOnboarding/ResourceConnectionWatch";
import { RESOURCE_CONNECTION_STEP_TITLE } from "../ResourceOnboarding/ResourceOnboarding";
import TelemetryDocumentation, {
  TelemetryType,
} from "../Telemetry/Documentation";
import { ProductKey } from "./ProductOnboarding";
import ProductShowcase, { getProductStartButton } from "./ProductShowcase";

/*
 * A telemetry product's explanation (Logs, Traces, Metrics, Exceptions,
 * Profiles, and Topology, which is drawn from traces) over its explorer,
 * while the project has never received telemetry: no service has reported.
 * Its button is the first step, "Send your first logs": the setup guide in
 * a dialog, which waits for the data to arrive - the first service that
 * reports - and links to it. Once one has, the page is the explorer alone.
 *
 * The explorer stays under it: nothing is hidden on the strength of this
 * check, and a project whose services have reported never sees it. A
 * failed check shows nothing.
 */

export interface TelemetryFirstRun {
  telemetryType: TelemetryType;
  // English: the button and the dialog's title, the showcase's first step.
  startText: string;
  // A service's page for that telemetry, and the link to it.
  viewPage: PageMap;
  viewText: string;
}

export const TELEMETRY_FIRST_RUNS: Record<
  | ProductKey.Logs
  | ProductKey.Traces
  | ProductKey.Metrics
  | ProductKey.Exceptions
  | ProductKey.Profiles
  | ProductKey.Topology,
  TelemetryFirstRun
> = {
  [ProductKey.Logs]: {
    telemetryType: "logs",
    startText: translationKey("Send your first logs"),
    viewPage: PageMap.SERVICE_VIEW_LOGS,
    viewText: translationKey("View logs"),
  },
  [ProductKey.Traces]: {
    telemetryType: "traces",
    startText: translationKey("Send your first traces"),
    viewPage: PageMap.SERVICE_VIEW_TRACES,
    viewText: translationKey("View traces"),
  },
  [ProductKey.Metrics]: {
    telemetryType: "metrics",
    startText: translationKey("Send your first metrics"),
    viewPage: PageMap.SERVICE_VIEW_METRICS,
    viewText: translationKey("View metrics"),
  },
  [ProductKey.Exceptions]: {
    telemetryType: "exceptions",
    startText: translationKey("Send your first exceptions"),
    viewPage: PageMap.SERVICE_VIEW_EXCEPTIONS,
    viewText: translationKey("View exceptions"),
  },
  [ProductKey.Profiles]: {
    telemetryType: "profiles",
    startText: translationKey("Send your first profiles"),
    viewPage: PageMap.SERVICE_VIEW_PROFILES,
    viewText: translationKey("View profiles"),
  },
  [ProductKey.Topology]: {
    telemetryType: "traces",
    startText: translationKey("Send your first traces"),
    viewPage: PageMap.SERVICE_VIEW_TRACES,
    viewText: translationKey("View traces"),
  },
};

export type TelemetryProductKey = keyof typeof TELEMETRY_FIRST_RUNS;

export const TELEMETRY_SETUP_DIALOG_TEST_ID: string = "telemetry-setup-dialog";

export interface SetupModalProps {
  firstRun: TelemetryFirstRun;
  onClose: () => void;
  onConnected?: (() => void) | undefined;
}

// The setup guide, and the step that waits for the first data.
export const TelemetrySetupModal: FunctionComponent<SetupModalProps> = (
  props: SetupModalProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <Modal
      title={props.firstRun.startText}
      modalWidth={ModalWidth.Large}
      onClose={props.onClose}
      closeButtonText="Done"
    >
      <div data-testid={TELEMETRY_SETUP_DIALOG_TEST_ID}>
        <TelemetryDocumentation
          telemetryType={props.firstRun.telemetryType}
          isBare={true}
        />
        <div className="mt-6">
          <h3 className="mb-2 text-sm font-semibold text-gray-900">
            {translator.translateText(RESOURCE_CONNECTION_STEP_TITLE)}
          </h3>
          <ResourceConnectionWatch
            modelType={Service}
            viewPage={props.firstRun.viewPage}
            viewText={props.firstRun.viewText}
            onConnected={() => {
              props.onConnected?.();
            }}
          />
        </div>
      </div>
    </Modal>
  );
};

export interface ComponentProps {
  product: TelemetryProductKey;
}

const TelemetryFirstRunShowcase: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const firstRun: TelemetryFirstRun = TELEMETRY_FIRST_RUNS[props.product];
  const [isSetupOpen, setIsSetupOpen] = useState<boolean>(false);
  // Services that have reported: any telemetry at all.
  const watch: FirstRecordWatch = useFirstRecordWatch({
    modelType: Service,
    query: {
      projectId: ProjectUtil.getCurrentProjectId()!,
      lastSeenAt: new NotNull(),
    },
  });

  return (
    <>
      {watch.count === 0 && (
        <ProductShowcase
          product={props.product}
          startButton={getProductStartButton({
            modelType: TelemetryIngestionKey,
            button: {
              title: firstRun.startText,
              icon: IconProp.Book,
              onClick: () => {
                setIsSetupOpen(true);
              },
            },
          })}
        />
      )}
      {isSetupOpen && (
        <TelemetrySetupModal
          firstRun={firstRun}
          onClose={() => {
            setIsSetupOpen(false);
          }}
          onConnected={() => {
            watch.onRecordCreated();
          }}
        />
      )}
    </>
  );
};

export default TelemetryFirstRunShowcase;
