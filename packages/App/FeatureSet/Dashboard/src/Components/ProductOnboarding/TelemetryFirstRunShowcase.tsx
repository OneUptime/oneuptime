import React, {
  Fragment,
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  ReactNode,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import ActivationMilestone from "Common/Types/Analytics/ActivationMilestone";
import IconProp from "Common/Types/Icon/IconProp";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ProjectMilestone from "Common/Models/DatabaseModels/ProjectMilestone";
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
import {
  getFirstDataMilestonesOfProducts,
  getProductsSetUpByGuide,
} from "../Telemetry/TelemetryGuideProducts";
import {
  TelemetryFirstRunHost,
  TelemetryFirstRunHostContext,
} from "../Telemetry/TelemetryFirstRunHost";
import { ProductKey } from "./ProductOnboarding";
import ProductShowcase, { getProductStartButton } from "./ProductShowcase";
import { ShowcaseAddButton } from "../ResourceShowcase/ResourceShowcaseCard";

/*
 * A telemetry product's explanation (Logs, Traces, Metrics, Exceptions,
 * Profiles, and Topology, which is drawn from traces) over its explorer,
 * until the project's first data of the product's own signal arrives: its
 * first-data mark (#6534, #6897), the activation milestone the server keeps
 * once ClickHouse took the project's first logs, traces, metrics,
 * exceptions or profiles - the mark the products menu's "Not set up" reads
 * too (PRODUCT_USAGE_MILESTONES). So a project that sends traces and no
 * logs still meets the Logs explanation, and one whose logs name no service
 * does not. Its button is the first step, "Send your first logs": the setup
 * guide in a dialog, which waits for the data to arrive - the first service
 * that reports, the first data of the key the guide's snippets carry
 * (#7754), or the project's first data of the signal, whichever key sent it
 * (#7888) - and links to it. Once it has, the page is the explorer alone,
 * read again as the dialog closes.
 *
 * The mark is asked for again every few seconds while it is missing
 * (useFirstRecordWatch), so data that arrives while the page is open -
 * with no dialog open, sent from a terminal or by a shipper set up
 * elsewhere - takes the explanation away and reads the explorer again: the
 * first logs show without a reload (#7755).
 *
 * Logs, Traces and Metrics offer the guided setup "Send logs, metrics and
 * traces, then get alerted" first (#7142, their ProductOnboarding's
 * guidedSetup): the same guide and wait, then the monitors that alert on
 * the service. The dialog stays beside it, plain, for the data alone: two
 * jobs, a button each.
 *
 * The explorer stays under it: nothing is hidden on the strength of this
 * check, and a project whose services have reported never sees it. A
 * failed check shows nothing.
 *
 * Telemetry that names no service (a host's syslog) reports no service, so
 * a page that hands its explorer in as children shows the explanation only
 * once the explorer, too, is empty - its first steps are drawn - and drops
 * it when the explorer draws data (TelemetryFirstRunHost). The first steps
 * then leave the setup guide to the explanation's button. Topology, which
 * has no such list, goes by the check alone.
 */

export interface TelemetryFirstRun {
  telemetryType: TelemetryType;
  // English: the button and the dialog's title, the showcase's first step.
  startText: string;
  // A service's page for that telemetry, and the link to it.
  viewPage: PageMap;
  viewText: string;
  // The product's explorer: where data that names no service shows.
  dataPage: PageMap;
  /*
   * The first-data mark of the signal the page draws: until it is kept, the
   * page explains itself. The mark of the product in the products menu
   * (PRODUCT_USAGE_MILESTONES), which a test holds them to.
   */
  firstDataMilestone: ActivationMilestone;
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
    dataPage: PageMap.LOGS,
    firstDataMilestone: ActivationMilestone.FirstLogsReceived,
  },
  [ProductKey.Traces]: {
    telemetryType: "traces",
    startText: translationKey("Send your first traces"),
    viewPage: PageMap.SERVICE_VIEW_TRACES,
    viewText: translationKey("View traces"),
    dataPage: PageMap.TRACES,
    firstDataMilestone: ActivationMilestone.FirstTracesReceived,
  },
  [ProductKey.Metrics]: {
    telemetryType: "metrics",
    startText: translationKey("Send your first metrics"),
    viewPage: PageMap.SERVICE_VIEW_METRICS,
    viewText: translationKey("View metrics"),
    dataPage: PageMap.METRICS,
    firstDataMilestone: ActivationMilestone.FirstMetricsReceived,
  },
  [ProductKey.Exceptions]: {
    telemetryType: "exceptions",
    startText: translationKey("Send your first exceptions"),
    viewPage: PageMap.SERVICE_VIEW_EXCEPTIONS,
    viewText: translationKey("View exceptions"),
    dataPage: PageMap.EXCEPTIONS,
    firstDataMilestone: ActivationMilestone.FirstExceptionsReceived,
  },
  [ProductKey.Profiles]: {
    telemetryType: "profiles",
    startText: translationKey("Send your first profiles"),
    viewPage: PageMap.SERVICE_VIEW_PROFILES,
    viewText: translationKey("View profiles"),
    dataPage: PageMap.PROFILES,
    firstDataMilestone: ActivationMilestone.FirstProfilesReceived,
  },
  // The map of services is drawn from their traces.
  [ProductKey.Topology]: {
    telemetryType: "traces",
    startText: translationKey("Send your first traces"),
    viewPage: PageMap.SERVICE_VIEW_TRACES,
    viewText: translationKey("View traces"),
    dataPage: PageMap.TRACES,
    firstDataMilestone: ActivationMilestone.FirstTracesReceived,
  },
};

export type TelemetryProductKey = keyof typeof TELEMETRY_FIRST_RUNS;

export const TELEMETRY_SETUP_DIALOG_TEST_ID: string = "telemetry-setup-dialog";

/*
 * Under the dialog's title: the guide is long, and the step that waits for
 * the data - and links to it - is its last.
 */
export const TELEMETRY_SETUP_DESCRIPTION: string = translationKey(
  "Follow the steps below. The last one waits for the first data to arrive.",
);

export interface SetupModalProps {
  firstRun: TelemetryFirstRun;
  onClose: () => void;
  /*
   * The first data arrived: a service reported, the key sent its first, or
   * the project's first data of the signal was kept.
   */
  onConnected?: (() => void) | undefined;
}

// The setup guide, and the step that waits for the first data.
export const TelemetrySetupModal: FunctionComponent<SetupModalProps> = (
  props: SetupModalProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  // The key the guide's snippets carry, which the last step watches too.
  const [ingestionKey, setIngestionKey] =
    useState<TelemetryIngestionKey | null>(null);
  const products: Array<ProductKey> = getProductsSetUpByGuide({
    telemetryType: props.firstRun.telemetryType,
  });

  return (
    <Modal
      title={props.firstRun.startText}
      description={TELEMETRY_SETUP_DESCRIPTION}
      modalWidth={ModalWidth.Large}
      onClose={props.onClose}
      closeButtonText="Done"
    >
      <div data-testid={TELEMETRY_SETUP_DIALOG_TEST_ID}>
        <TelemetryDocumentation
          telemetryType={props.firstRun.telemetryType}
          isBare={true}
          onSelectedKeyChange={setIngestionKey}
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
            ingestionKey={ingestionKey}
            dataPage={props.firstRun.dataPage}
            products={products}
            /*
             * The project's first data of the guide's signal, whichever key
             * sent it: a key that already sends traces finishes the logs
             * guide with its first logs (#7888).
             */
            firstDataMilestones={getFirstDataMilestonesOfProducts(products)}
            onDataArrived={() => {
              props.onConnected?.();
            }}
            /*
             * Its link may be to the explorer this dialog was opened over,
             * which a link to the page it is on would leave covered.
             */
            onView={props.onClose}
          />
        </div>
      </div>
    </Modal>
  );
};

export interface ComponentProps {
  product: TelemetryProductKey;
  // The product's explorer, drawn under the explanation.
  children?: ReactNode | undefined;
}

const TelemetryFirstRunShowcase: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const firstRun: TelemetryFirstRun = TELEMETRY_FIRST_RUNS[props.product];
  const [isSetupOpen, setIsSetupOpen] = useState<boolean>(false);
  /*
   * What the explorer under it has drawn: its first steps (kept while it
   * loads again, so the explanation does not blink), and data.
   */
  const [hasFirstSteps, setHasFirstSteps] = useState<boolean>(false);
  const [hasData, setHasData] = useState<boolean>(false);
  /*
   * The explorer under the dialog read the project before its first data
   * arrived. Once the dialog has seen it arrive, closing the dialog draws
   * the explorer afresh, so the data is in it without a reload.
   */
  const hasFirstDataRef: MutableRefObject<boolean> = useRef<boolean>(false);
  const [explorerReads, setExplorerReads] = useState<number>(0);

  const readExplorerAgain: () => void = (): void => {
    setExplorerReads((value: number): number => {
      return value + 1;
    });
  };

  /*
   * The project's first data of this page's signal: its mark, asked for
   * again every few seconds while it is missing. One that arrives while
   * the page is open reads the explorer again - at once, or as the setup
   * dialog over it closes - unless the explorer has drawn data already.
   */
  const watch: FirstRecordWatch = useFirstRecordWatch({
    modelType: ProjectMilestone,
    query: {
      projectId: ProjectUtil.getCurrentProjectId()!,
      milestone: firstRun.firstDataMilestone,
    },
    onFirstRecord: (): void => {
      if (hasData) {
        return;
      }

      if (isSetupOpen) {
        hasFirstDataRef.current = true;
        return;
      }

      readExplorerAgain();
    },
  });

  const startButton: ShowcaseAddButton | undefined = getProductStartButton({
    modelType: TelemetryIngestionKey,
    button: {
      title: firstRun.startText,
      icon: IconProp.Book,
      onClick: () => {
        setIsSetupOpen(true);
      },
    },
  });
  const waitsForExplorer: boolean = props.children !== undefined;
  const isShown: boolean =
    watch.count === 0 && (!waitsForExplorer || (hasFirstSteps && !hasData));
  const offersSetup: boolean = isShown && startButton !== undefined;

  const onFirstStepsShown: () => void = useCallback((): void => {
    setHasFirstSteps(true);
  }, []);
  const onDataShown: () => void = useCallback((): void => {
    setHasData(true);
  }, []);
  const host: TelemetryFirstRunHost = useMemo((): TelemetryFirstRunHost => {
    return { onFirstStepsShown, onDataShown, offersSetup };
  }, [onFirstStepsShown, onDataShown, offersSetup]);

  const closeSetup: () => void = (): void => {
    setIsSetupOpen(false);

    if (hasFirstDataRef.current) {
      hasFirstDataRef.current = false;
      readExplorerAgain();
    }
  };

  return (
    <TelemetryFirstRunHostContext.Provider value={host}>
      {isShown && (
        <ProductShowcase product={props.product} startButton={startButton} />
      )}
      <Fragment key={explorerReads}>{props.children}</Fragment>
      {isSetupOpen && (
        <TelemetrySetupModal
          firstRun={firstRun}
          onClose={closeSetup}
          onConnected={() => {
            hasFirstDataRef.current = true;
            watch.onRecordCreated();
          }}
        />
      )}
    </TelemetryFirstRunHostContext.Provider>
  );
};

export default TelemetryFirstRunShowcase;
