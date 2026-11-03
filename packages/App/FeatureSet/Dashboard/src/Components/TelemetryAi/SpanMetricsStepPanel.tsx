import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import { getReadingDirection } from "Common/Types/ReadingDirection";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { DOCS_URL } from "Common/UI/Config";
import {
  getSentenceLanguage,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
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
  SPAN_METRICS_STEP_NAMES,
  SPAN_METRICS_STEP_TEST_IDS,
} from "./SpanMetricsStepCopy";

/*
 * "Without changing code" on a Missing Metrics or Missing Request Metrics
 * finding: the OpenTelemetry Collector's span metrics step, which records
 * the service's request metrics from the traces it already sends - the way
 * past the finding that changes no code, beside Fix with AI, which adds them
 * in the code. A calm panel in the finding's rail, one sentence and one
 * button - as wide as a phone, as Fix with AI's is; the collector's lines
 * open in a dialog, in the numbered steps
 * every "get this connected" guide in the product uses, with what a service
 * that sends straight to OneUptime does first. Nothing is read or saved:
 * the step is the same for every service (Common/Utils/Metrics/
 * SpanMetricsCollectorStep).
 */

const LINK_CLASS_NAME: string =
  "inline-flex items-center gap-1 font-medium text-indigo-600 hover:text-indigo-500 hover:underline";

/*
 * A name from the collector's lines inside a sentence - spanmetrics, otlp,
 * traces.span.metrics.calls - drawn as the code it is, as a code task's
 * steps draw a file's name (CodeTaskSteps).
 */
export const SPAN_METRICS_STEP_NAME_CLASS_NAME: string =
  "rounded bg-gray-100 px-1 py-0.5 font-mono text-xs text-gray-700";

/*
 * A step's sentence in the reader's language, with the collector's names in
 * it drawn as code and never translated (TranslatedSentence): drawn as
 * SetupGuideSteps draws a step's description, and read the way the sentence
 * came out - an English sentence a locale lacks reads left to right on a
 * Persian page, as a description by most of its letters does there.
 */
const StepSentence: FunctionComponent<{
  template: string;
  names: Readonly<Record<string, string>>;
  dataTestId: string;
}> = (props: {
  template: string;
  names: Readonly<Record<string, string>>;
  dataTestId: string;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const slots: Record<string, ReactElement> = {};

  for (const [slot, name] of Object.entries(props.names)) {
    slots[slot] = (
      <code className={SPAN_METRICS_STEP_NAME_CLASS_NAME}>{name}</code>
    );
  }

  return (
    <p
      dir={getReadingDirection(getSentenceLanguage(translator, props.template))}
      className="mb-3 mt-0.5 text-sm leading-relaxed text-gray-500"
      data-testid={props.dataTestId}
    >
      <TranslatedSentence template={props.template} slots={slots} />
    </p>
  );
};

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
        <div className="flex flex-col items-stretch md:items-start">
          <Button
            title={SPAN_METRICS_STEP_COPY.showStep}
            /*
             * The lines of a config file, not code: the panel's whole point
             * is that no code changes, and a </> said otherwise.
             */
            icon={IconProp.DocumentText}
            buttonStyle={ButtonStyleType.OUTLINE}
            buttonSize={ButtonSize.Small}
            dataTestId={SPAN_METRICS_STEP_TEST_IDS.show}
            // The panel's own edge, not the shared Button's row margin.
            className="md:!ml-0"
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
          /*
           * A dialog to read and copy from. Its first link opens the docs in
           * a new tab, and a dialog that started on it - the Enter that
           * opened it, held a moment too long - would open them, its focus
           * ring on a link the reader never asked for: it starts on itself,
           * and Tab reaches the links and the copy button.
           */
          isInitialFocusOnDialog={true}
          onClose={() => {
            setIsShown(false);
          }}
        >
          <div
            className="space-y-6"
            data-testid={SPAN_METRICS_STEP_TEST_IDS.modal}
          >
            {/*
             * What a service that sends straight to OneUptime needs first,
             * before the steps it is the prerequisite of. A div, not a p:
             * the Icon draws a div of its own.
             */}
            <div
              className="flex items-start gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600"
              data-testid={SPAN_METRICS_STEP_TEST_IDS.noCollector}
            >
              <Icon
                icon={IconProp.Info}
                className="mt-0.5 h-4 w-4 flex-none text-gray-400"
              />
              <span>
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
              </span>
            </div>

            <SetupGuideSteps
              steps={[
                {
                  title:
                    translator.translateText(
                      SPAN_METRICS_STEP_COPY.addStepTitle,
                    ) || SPAN_METRICS_STEP_COPY.addStepTitle,
                  content: (
                    <>
                      <StepSentence
                        template={SPAN_METRICS_STEP_COPY.addStepDescription}
                        names={SPAN_METRICS_STEP_NAMES.addStep}
                        dataTestId={SPAN_METRICS_STEP_TEST_IDS.addSentence}
                      />
                      {/* Code reads left to right in every language. */}
                      <div
                        dir="ltr"
                        data-testid={SPAN_METRICS_STEP_TEST_IDS.code}
                      >
                        <CodeBlock
                          code={SPAN_METRICS_COLLECTOR_STEP}
                          language="yaml"
                        />
                      </div>
                    </>
                  ),
                },
                {
                  title:
                    translator.translateText(
                      SPAN_METRICS_STEP_COPY.restartTitle,
                    ) || SPAN_METRICS_STEP_COPY.restartTitle,
                  content: (
                    <StepSentence
                      template={SPAN_METRICS_STEP_COPY.restartDescription}
                      names={SPAN_METRICS_STEP_NAMES.restart}
                      dataTestId={SPAN_METRICS_STEP_TEST_IDS.restartSentence}
                    />
                  ),
                },
              ]}
            />

            <div className="border-t border-gray-100 pt-4 text-sm">
              <div>
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
              </div>
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
