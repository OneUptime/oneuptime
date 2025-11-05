import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import DataToProcess from "./DataToProcess";
import { CriteriaFilter } from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteriaExpectationBuilder from "./MonitorCriteriaExpectationBuilder";
import MonitorCriteriaObservationBuilder from "./MonitorCriteriaObservationBuilder";

export default class MonitorCriteriaMessageBuilder {
	public static buildCriteriaFilterMessage(input: {
		monitor: Monitor;
		criteriaFilter: CriteriaFilter;
		dataToProcess: DataToProcess;
		monitorStep: MonitorStep;
		didMeetCriteria: boolean;
		matchMessage: string | null;
	}): string {
		if (input.matchMessage) {
			return input.matchMessage;
		}

		if (input.didMeetCriteria) {
			const description: string =
				MonitorCriteriaExpectationBuilder.getCriteriaFilterDescription(
					input.criteriaFilter,
				);

			return `${description} condition met.`;
		}

		const failureMessage: string | null =
			MonitorCriteriaMessageBuilder.buildCriteriaFilterFailureMessage({
				monitor: input.monitor,
				criteriaFilter: input.criteriaFilter,
				dataToProcess: input.dataToProcess,
				monitorStep: input.monitorStep,
			});

		if (failureMessage) {
			return failureMessage;
		}

		const description: string =
			MonitorCriteriaExpectationBuilder.getCriteriaFilterDescription(
				input.criteriaFilter,
			);

		return `${description} condition was not met.`;
	}

	private static buildCriteriaFilterFailureMessage(input: {
		monitor: Monitor;
		criteriaFilter: CriteriaFilter;
		dataToProcess: DataToProcess;
		monitorStep: MonitorStep;
	}): string | null {
		const expectation: string | null =
			MonitorCriteriaExpectationBuilder.describeCriteriaExpectation(
				input.criteriaFilter,
			);

		const observation: string | null =
			MonitorCriteriaObservationBuilder.describeFilterObservation({
				monitor: input.monitor,
				criteriaFilter: input.criteriaFilter,
				dataToProcess: input.dataToProcess,
				monitorStep: input.monitorStep,
			});

		if (observation) {
			if (expectation) {
				return `${observation} (expected ${expectation}).`;
			}

			return `${observation}; configured filter was not met.`;
		}

		if (expectation) {
			const description: string =
				MonitorCriteriaExpectationBuilder.getCriteriaFilterDescription(
					input.criteriaFilter,
				);

			return `${description} did not satisfy the configured condition (${expectation}).`;
		}

		return null;
	}
}
