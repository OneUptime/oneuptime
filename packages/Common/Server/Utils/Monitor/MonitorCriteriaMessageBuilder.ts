import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import DataToProcess from "./DataToProcess";
import { CriteriaFilter } from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteriaExpectationBuilder from "./MonitorCriteriaExpectationBuilder";
import MonitorCriteriaObservationBuilder from "./MonitorCriteriaObservationBuilder";
import EvaluationSentenceMemo from "./EvaluationSentenceMemo";
import {
  EvaluationSentence,
  englishOfEvaluationSentence,
  translatableSentence,
} from "../../../Types/Monitor/EvaluationSentence";

/*
 * A filter's message, and the sentence it was filled from when it was
 * filled from one (EvaluationSentence): the evaluation summary stores both,
 * the English for every reader without a translation and the sentence for
 * the Dashboard to word in each reader's language.
 */
export interface CriteriaFilterText {
  message: string;
  sentence?: EvaluationSentence | undefined;
}

export default class MonitorCriteriaMessageBuilder {
  public static buildCriteriaFilterMessage(input: {
    monitor: Monitor;
    criteriaFilter: CriteriaFilter;
    dataToProcess: DataToProcess;
    monitorStep: MonitorStep;
    didMeetCriteria: boolean;
    matchMessage: string | null;
  }): string {
    return MonitorCriteriaMessageBuilder.buildCriteriaFilterText(input).message;
  }

  /*
   * What buildCriteriaFilterMessage says, with the sentence it is filled
   * from: a finding a checker wrote from a sentence is found under its
   * English (EvaluationSentenceMemo); what this builder writes, it writes as
   * one. A message written as text alone - a window still filling, a
   * forecast - has no sentence and reads as stored.
   */
  public static buildCriteriaFilterText(input: {
    monitor: Monitor;
    criteriaFilter: CriteriaFilter;
    dataToProcess: DataToProcess;
    monitorStep: MonitorStep;
    didMeetCriteria: boolean;
    matchMessage: string | null;
  }): CriteriaFilterText {
    if (input.matchMessage) {
      return MonitorCriteriaMessageBuilder.asWritten(input.matchMessage);
    }

    if (input.didMeetCriteria) {
      return MonitorCriteriaMessageBuilder.fromSentence(
        translatableSentence("{{description}} condition met.", {
          description:
            MonitorCriteriaExpectationBuilder.getCriteriaFilterDescriptionSentence(
              input.criteriaFilter,
            ),
        }),
      );
    }

    /*
     * An "All Values" metric criteria whose data points all meet the
     * condition, waiting for them to cover the time range: say how far it
     * has got - "Waiting for 15 minutes of data: 2 of 15 minutes so far" -
     * which is the answer to "why did nothing fire?".
     */
    const windowWaitMessage: string | undefined =
      input.criteriaFilter.metricCriteriaContext?.windowWait?.message;

    if (windowWaitMessage) {
      return MonitorCriteriaMessageBuilder.asWritten(windowWaitMessage);
    }

    /*
     * A forecast criteria that did not match says where the metric is
     * headed against the threshold it needs - "Disk Used (%) is forecast to
     * be 72% in 7 days ..." - or why it could not be forecast yet.
     */
    const forecastMessage: string | undefined =
      input.criteriaFilter.metricCriteriaContext?.forecast?.message;

    if (forecastMessage) {
      return MonitorCriteriaMessageBuilder.asWritten(forecastMessage);
    }

    const failure: CriteriaFilterText | null =
      MonitorCriteriaMessageBuilder.buildCriteriaFilterFailureText({
        monitor: input.monitor,
        criteriaFilter: input.criteriaFilter,
        dataToProcess: input.dataToProcess,
        monitorStep: input.monitorStep,
      });

    if (failure) {
      return failure;
    }

    return MonitorCriteriaMessageBuilder.fromSentence(
      translatableSentence("{{description}} condition was not met.", {
        description:
          MonitorCriteriaExpectationBuilder.getCriteriaFilterDescriptionSentence(
            input.criteriaFilter,
          ),
      }),
    );
  }

  // A text another helper wrote: with its sentence, when it wrote one.
  private static asWritten(message: string): CriteriaFilterText {
    const sentence: EvaluationSentence | undefined =
      EvaluationSentenceMemo.find(message);

    return sentence ? { message: message, sentence: sentence } : { message };
  }

  private static fromSentence(
    sentence: EvaluationSentence,
  ): CriteriaFilterText {
    return {
      message: englishOfEvaluationSentence(sentence),
      sentence: sentence,
    };
  }

  private static buildCriteriaFilterFailureText(input: {
    monitor: Monitor;
    criteriaFilter: CriteriaFilter;
    dataToProcess: DataToProcess;
    monitorStep: MonitorStep;
  }): CriteriaFilterText | null {
    /*
     * Resolve the metric's display unit (undefined for non-metric criteria)
     * so the threshold in the expectation clause reads in the same unit as
     * the observed value — "recorded latest 0.06 sec (expected to be greater
     * than 5 sec)" rather than the unitless "0.06 (expected ... 5)".
     */
    const metricDisplay: {
      unit: string | undefined;
      metricName: string | undefined;
    } = MonitorCriteriaObservationBuilder.getMetricValueDisplayContext({
      criteriaFilter: input.criteriaFilter,
      dataToProcess: input.dataToProcess,
      monitorStep: input.monitorStep,
    });

    const expectation: EvaluationSentence | null =
      MonitorCriteriaExpectationBuilder.describeCriteriaExpectationSentence(
        input.criteriaFilter,
        {
          ...metricDisplay,
          monitorType: input.monitor.monitorType,
        },
      );

    const observation: string | null =
      MonitorCriteriaObservationBuilder.describeFilterObservation({
        monitor: input.monitor,
        criteriaFilter: input.criteriaFilter,
        dataToProcess: input.dataToProcess,
        monitorStep: input.monitorStep,
      });

    if (observation) {
      /*
       * The observation is the checker's text; its sentence, when it wrote
       * it from one, is found under it. Without one, the message is the
       * English text alone - a sentence never holds an English clause.
       */
      const observationSentence: EvaluationSentence | undefined =
        EvaluationSentenceMemo.find(observation);

      if (expectation) {
        const message: string = `${observation} (expected ${englishOfEvaluationSentence(expectation)}).`;

        return observationSentence
          ? {
              message: message,
              sentence: translatableSentence(
                "{{observation}} (expected {{expectation}}).",
                {
                  observation: observationSentence,
                  expectation: expectation,
                },
              ),
            }
          : { message: message };
      }

      const message: string = `${observation}; configured filter was not met.`;

      return observationSentence
        ? {
            message: message,
            sentence: translatableSentence(
              "{{observation}}; configured filter was not met.",
              { observation: observationSentence },
            ),
          }
        : { message: message };
    }

    if (expectation) {
      /*
       * Both halves of this sentence quote the same threshold, so both
       * must render it the same way — otherwise it reads "Metric Value
       * greater than 1000000000 did not satisfy the configured condition
       * (expected to be greater than 1 GB)".
       */
      return MonitorCriteriaMessageBuilder.fromSentence(
        translatableSentence(
          "{{description}} did not satisfy the configured condition ({{expectation}}).",
          {
            description:
              MonitorCriteriaExpectationBuilder.getCriteriaFilterDescriptionSentence(
                input.criteriaFilter,
                metricDisplay,
              ),
            expectation: expectation,
          },
        ),
      );
    }

    return null;
  }
}
