import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import { DOCS_URL } from "Common/UI/Config";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  SEND_THROUGH_COLLECTOR_DOCS_PATH,
  SPAN_METRICS_COLLECTOR_STEP,
  SPAN_METRICS_DOCS_PATH,
} from "Common/Utils/Metrics/SpanMetricsCollectorStep";
import React, { FunctionComponent, ReactElement, useState } from "react";
import InsightPanel from "../AIInsights/InsightPanel";
import SetupGuideSteps from "../SetupGuide/SetupGuideSteps";
import {
  SPAN_METRICS_STEP_COPY,
  SPAN_METRICS_STEP_TEST_IDS,
} from "./SpanMetricsStepCopy";

/*
 * "Without changing code" on a Missing Metrics or Missing Request Metrics
 * finding: the OpenTelemetry Collector's span metrics step, which records
 * the service's request metrics from the traces it already sends - the way
 * past the finding that changes no code, beside Fix with AI, which adds them
 * in the code. A calm panel in the finding's rail, one sentence and one
 * button; the collector's lines open in a dialog, in the numbered steps
 * every "get this connected" guide in the product uses, with what a service
 * that sends straight to OneUptime does first. Nothing is read or saved:
 * the step is the same for every service (Common/Utils/Metrics/
 * SpanMetricsCollectorStep).
 */

const LINK_CLASS_NAME: string =
  "inline-flex items-center gap-1 font-medium text-indigo-600 hover:text-indigo-500 hover:underline";

const SpanMetricsStepPanel: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [isShown, setIsShown] = useState<boolean>(false);

  return (
    <div data-testid={SPAN_METRICS_STEP_TEST_IDS.panel}>
      <InsightPanel
        title={SPAN_METRICS_STEP_COPY.panelTitle}
        description={SPAN_METRICS_STEP_COPY.panelDescription}
        icon={IconProp.AdjustmentHorizontal}
      >
        <div className="space-y-3">
          <p className="text-sm leading-relaxed text-gray-700">
            {translator.translateText(SPAN_METRICS_STEP_COPY.panelBody)}
          </p>
          <Button
            title={SPAN_METRICS_STEP_COPY.showStep}
            icon={IconProp.Code}
            buttonStyle={ButtonStyleType.OUTLINE}
            buttonSize={ButtonSize.Small}
            dataTestId={SPAN_METRICS_STEP_TEST_IDS.show}
            // Its words on one line, never squeezed beside nothing.
            className="whitespace-nowrap md:!ml-0"
            onClick={() => {
              setIsShown(true);
            }}
          />
        </div>
      </InsightPanel>

      {isShown ? (
        <Modal
          title={SPAN_METRICS_STEP_COPY.modalTitle}
          description={SPAN_METRICS_STEP_COPY.modalDescription}
          modalWidth={ModalWidth.Medium}
          closeButtonText={SPAN_METRICS_STEP_COPY.close}
          onClose={() => {
            setIsShown(false);
          }}
        >
          <div
            className="space-y-6"
            data-testid={SPAN_METRICS_STEP_TEST_IDS.modal}
          >
            <SetupGuideSteps
              steps={[
                {
                  title: translator.translateText(
                    SPAN_METRICS_STEP_COPY.addStepTitle,
                  ),
                  description: translator.translateText(
                    SPAN_METRICS_STEP_COPY.addStepDescription,
                  ),
                  content: (
                    // Code reads left to right in every language.
                    <div dir="ltr" data-testid={SPAN_METRICS_STEP_TEST_IDS.code}>
                      <CodeBlock
                        code={SPAN_METRICS_COLLECTOR_STEP}
                        language="yaml"
                      />
                    </div>
                  ),
                },
                {
                  title: translator.translateText(
                    SPAN_METRICS_STEP_COPY.restartTitle,
                  ),
                  description: translator.translateText(
                    SPAN_METRICS_STEP_COPY.restartDescription,
                  ),
                  content: <></>,
                },
              ]}
            />

            <div className="space-y-2 border-t border-gray-100 pt-4 text-sm text-gray-600">
              <p>
                {translator.translateText(SPAN_METRICS_STEP_COPY.noCollector)}{" "}
                <Link
                  className={LINK_CLASS_NAME}
                  openInNewTab={true}
                  to={URL.fromString(
                    `${DOCS_URL.toString()}${SEND_THROUGH_COLLECTOR_DOCS_PATH}`,
                  )}
                  dataTestId={SPAN_METRICS_STEP_TEST_IDS.collectorDocs}
                >
                  {translator.translateText(
                    SPAN_METRICS_STEP_COPY.noCollectorLink,
                  )}
                </Link>
              </p>
              <p>
                <Link
                  className={LINK_CLASS_NAME}
                  openInNewTab={true}
                  to={URL.fromString(
                    `${DOCS_URL.toString()}${SPAN_METRICS_DOCS_PATH}`,
                  )}
                  dataTestId={SPAN_METRICS_STEP_TEST_IDS.docs}
                >
                  <>
                    <Icon icon={IconProp.Book} className="h-4 w-4" />
                    <span>
                      {translator.translateText(
                        SPAN_METRICS_STEP_COPY.learnMore,
                      )}
                    </span>
                  </>
                </Link>
              </p>
            </div>
          </div>
        </Modal>
      ) : (
        <></>
      )}
    </div>
  );
};

export default SpanMetricsStepPanel;
