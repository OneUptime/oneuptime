import logger from "../Logger";
import OneUptimeDate from "../../../Types/Date";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import DataToProcess from "./DataToProcess";
import {
	CheckOn,
	CriteriaFilter,
} from "../../../Types/Monitor/CriteriaFilter";
import { JSONObject } from "../../../Types/JSON";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import ServerMonitorResponse, {
	ServerProcess,
} from "../../../Types/Monitor/ServerMonitor/ServerMonitorResponse";
import IncomingMonitorRequest from "../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import BasicInfrastructureMetrics from "../../../Types/Infrastructure/BasicMetrics";
import Typeof from "../../../Types/Typeof";
import SslMonitorResponse from "../../../Types/Monitor/SSLMonitor/SslMonitorResponse";
import SyntheticMonitorResponse from "../../../Types/Monitor/SyntheticMonitors/SyntheticMonitorResponse";
import CustomCodeMonitorResponse from "../../../Types/Monitor/CustomCodeMonitor/CustomCodeMonitorResponse";
import LogMonitorResponse from "../../../Types/Monitor/LogMonitor/LogMonitorResponse";
import TraceMonitorResponse from "../../../Types/Monitor/TraceMonitor/TraceMonitorResponse";
import MonitorCriteriaMessageFormatter from "./MonitorCriteriaMessageFormatter";
import MonitorCriteriaDataExtractor from "./MonitorCriteriaDataExtractor";
import MonitorCriteriaExpectationBuilder from "./MonitorCriteriaExpectationBuilder";

export default class MonitorCriteriaObservationBuilder {
	public static describeFilterObservation(input: {
		monitor: Monitor;
		criteriaFilter: CriteriaFilter;
		dataToProcess: DataToProcess;
		monitorStep: MonitorStep;
	}): string | null {
		const { criteriaFilter } = input;

		switch (criteriaFilter.checkOn) {
			case CheckOn.ResponseTime:
				return MonitorCriteriaObservationBuilder.describeResponseTimeObservation(
					input,
				);
			case CheckOn.ResponseStatusCode:
				return MonitorCriteriaObservationBuilder.describeResponseStatusCodeObservation(
					input,
				);
			case CheckOn.ResponseHeader:
				return MonitorCriteriaObservationBuilder.describeResponseHeaderObservation(
					input,
				);
			case CheckOn.ResponseHeaderValue:
				return MonitorCriteriaObservationBuilder.describeResponseHeaderValueObservation(
					input,
				);
			case CheckOn.ResponseBody:
				return MonitorCriteriaObservationBuilder.describeResponseBodyObservation(
					input,
				);
			case CheckOn.IsOnline:
				return MonitorCriteriaObservationBuilder.describeIsOnlineObservation(
					input,
				);
			case CheckOn.IsRequestTimeout:
				return MonitorCriteriaObservationBuilder.describeIsTimeoutObservation(
					input,
				);
			case CheckOn.IncomingRequest:
				return MonitorCriteriaObservationBuilder.describeIncomingRequestObservation(
					input,
				);
			case CheckOn.RequestBody:
				return MonitorCriteriaObservationBuilder.describeRequestBodyObservation(
					input,
				);
			case CheckOn.RequestHeader:
				return MonitorCriteriaObservationBuilder.describeRequestHeaderObservation(
					input,
				);
			case CheckOn.RequestHeaderValue:
				return MonitorCriteriaObservationBuilder.describeRequestHeaderValueObservation(
					input,
				);
			case CheckOn.JavaScriptExpression:
				return MonitorCriteriaObservationBuilder.describeJavaScriptExpressionObservation(
					input,
				);
			case CheckOn.CPUUsagePercent:
				return MonitorCriteriaObservationBuilder.describeCpuUsageObservation(input);
			case CheckOn.MemoryUsagePercent:
				return MonitorCriteriaObservationBuilder.describeMemoryUsageObservation(
					input,
				);
			case CheckOn.DiskUsagePercent:
				return MonitorCriteriaObservationBuilder.describeDiskUsageObservation(
					input,
				);
			case CheckOn.ServerProcessName:
				return MonitorCriteriaObservationBuilder.describeServerProcessNameObservation(
					input,
				);
			case CheckOn.ServerProcessPID:
				return MonitorCriteriaObservationBuilder.describeServerProcessPidObservation(
					input,
				);
			case CheckOn.ServerProcessCommand:
				return MonitorCriteriaObservationBuilder.describeServerProcessCommandObservation(
					input,
				);
			case CheckOn.ExpiresInHours:
				return MonitorCriteriaObservationBuilder.describeCertificateExpiresInHoursObservation(
					input,
				);
			case CheckOn.ExpiresInDays:
				return MonitorCriteriaObservationBuilder.describeCertificateExpiresInDaysObservation(
					input,
				);
			case CheckOn.IsSelfSignedCertificate:
				return MonitorCriteriaObservationBuilder.describeIsSelfSignedObservation(
					input,
				);
			case CheckOn.IsExpiredCertificate:
				return MonitorCriteriaObservationBuilder.describeIsExpiredObservation(
					input,
				);
			case CheckOn.IsValidCertificate:
				return MonitorCriteriaObservationBuilder.describeIsValidObservation(input);
			case CheckOn.IsNotAValidCertificate:
				return MonitorCriteriaObservationBuilder.describeIsInvalidObservation(
					input,
				);
			case CheckOn.ResultValue:
				return MonitorCriteriaObservationBuilder.describeResultValueObservation(
					input,
				);
			case CheckOn.Error:
				return MonitorCriteriaObservationBuilder.describeErrorObservation(input);
			case CheckOn.ExecutionTime:
				return MonitorCriteriaObservationBuilder.describeExecutionTimeObservation(
					input,
				);
			case CheckOn.ScreenSizeType:
				return MonitorCriteriaObservationBuilder.describeScreenSizeObservation(
					input,
				);
			case CheckOn.BrowserType:
				return MonitorCriteriaObservationBuilder.describeBrowserObservation(input);
			case CheckOn.LogCount:
				return MonitorCriteriaObservationBuilder.describeLogCountObservation(input);
			case CheckOn.SpanCount:
				return MonitorCriteriaObservationBuilder.describeSpanCountObservation(input);
			case CheckOn.MetricValue:
				return MonitorCriteriaObservationBuilder.describeMetricValueObservation(
					input,
				);
			default:
				return null;
		}
	}

	private static describeResponseTimeObservation(input: {
		criteriaFilter: CriteriaFilter;
		dataToProcess: DataToProcess;
	}): string | null {
		const probeResponse: ProbeMonitorResponse | null =
			MonitorCriteriaDataExtractor.getProbeMonitorResponse(
				input.dataToProcess,
			);

		if (!probeResponse) {
			return null;
		}

		const responseTime: number | undefined =
			probeResponse.responseTimeInMs ?? undefined;

		if (responseTime === undefined || responseTime === null) {
			return "Response time metric was not recorded";
		}

		const formatted: string | null =
			MonitorCriteriaMessageFormatter.formatNumber(responseTime, {
				maximumFractionDigits: 2,
			});

		const evaluationWindow: string | null =
			MonitorCriteriaExpectationBuilder.getEvaluationWindowDescription(
				input.criteriaFilter,
			);

		let message: string = `Response Time (in ms) was ${formatted ?? responseTime} ms`;

		if (evaluationWindow) {
			message += ` ${evaluationWindow}`;
		}

		return message;
	}

	private static describeResponseStatusCodeObservation(input: {
		dataToProcess: DataToProcess;
	}): string | null {
		const probeResponse: ProbeMonitorResponse | null =
			MonitorCriteriaDataExtractor.getProbeMonitorResponse(
				input.dataToProcess,
			);

		if (!probeResponse) {
			return null;
		}

		if (probeResponse.responseCode === undefined) {
			return "Response status code was not recorded";
		}

		return `Response Status Code was ${probeResponse.responseCode}.`;
	}

	private static describeResponseHeaderObservation(input: {
		dataToProcess: DataToProcess;
	}): string | null {
		const probeResponse: ProbeMonitorResponse | null =
			MonitorCriteriaDataExtractor.getProbeMonitorResponse(
				input.dataToProcess,
			);

		if (!probeResponse) {
			return null;
		}

		const headers: Array<string> = Object.keys(
			probeResponse.responseHeaders || {},
		).map((header: string) => {
			return header.toLowerCase();
		});

		if (!headers.length) {
			return "Response headers were empty.";
		}

		return `Response headers present: ${MonitorCriteriaMessageFormatter.formatList(headers)}.`;
	}

	private static describeResponseHeaderValueObservation(input: {
		dataToProcess: DataToProcess;
	}): string | null {
		const probeResponse: ProbeMonitorResponse | null =
			MonitorCriteriaDataExtractor.getProbeMonitorResponse(
				input.dataToProcess,
			);

		if (!probeResponse) {
			return null;
		}

		const headerValues: Array<string> = Object.values(
			probeResponse.responseHeaders || {},
		).map((value: string) => {
			return value.toLowerCase();
		});

		if (!headerValues.length) {
			return "Response header values were empty.";
		}

		return `Response header values: ${MonitorCriteriaMessageFormatter.formatList(headerValues)}.`;
	}

	private static describeResponseBodyObservation(input: {
		dataToProcess: DataToProcess;
	}): string | null {
		const probeResponse: ProbeMonitorResponse | null =
			MonitorCriteriaDataExtractor.getProbeMonitorResponse(
				input.dataToProcess,
			);

		if (!probeResponse) {
			return null;
		}

		if (!probeResponse.responseBody) {
			return "Response body was empty.";
		}

		let bodyAsString: string;

		if (typeof probeResponse.responseBody === Typeof.Object) {
			try {
				bodyAsString = JSON.stringify(probeResponse.responseBody);
			} catch (err) {
				logger.error(err);
				bodyAsString = "[object]";
			}
		} else {
			bodyAsString = probeResponse.responseBody as string;
		}

		return `Response body sample: ${MonitorCriteriaMessageFormatter.formatSnippet(bodyAsString)}.`;
	}

	private static describeIsOnlineObservation(input: {
		criteriaFilter: CriteriaFilter;
		dataToProcess: DataToProcess;
	}): string | null {
		const probeResponse: ProbeMonitorResponse | null =
			MonitorCriteriaDataExtractor.getProbeMonitorResponse(
				input.dataToProcess,
			);

		if (probeResponse && probeResponse.isOnline !== undefined) {
			return `Monitor reported ${
				probeResponse.isOnline ? "online" : "offline"
			} status at ${OneUptimeDate.getDateAsLocalFormattedString(
				probeResponse.monitoredAt,
			)}.`;
		}

		const serverResponse: ServerMonitorResponse | null =
			MonitorCriteriaDataExtractor.getServerMonitorResponse(
				input.dataToProcess,
			);

		if (serverResponse) {
			const lastHeartbeat: Date = serverResponse.requestReceivedAt;
			const timeNow: Date =
				serverResponse.timeNow || OneUptimeDate.getCurrentDate();
			const minutesSinceHeartbeat: number =
				OneUptimeDate.getDifferenceInMinutes(lastHeartbeat, timeNow);

			const formattedMinutes: string | null =
				MonitorCriteriaMessageFormatter.formatNumber(minutesSinceHeartbeat, {
					maximumFractionDigits: 2,
				});

			return `Server heartbeat last received ${
				formattedMinutes ?? minutesSinceHeartbeat
			} minutes ago.`;
		}

		return null;
	}

	private static describeIsTimeoutObservation(input: {
		dataToProcess: DataToProcess;
	}): string | null {
		const probeResponse: ProbeMonitorResponse | null =
			MonitorCriteriaDataExtractor.getProbeMonitorResponse(
				input.dataToProcess,
			);

		if (probeResponse && probeResponse.isTimeout !== undefined) {
			return probeResponse.isTimeout
				? "Request timed out."
				: "Request completed before timeout.";
		}

		return "Timeout information was unavailable.";
	}

	private static describeIncomingRequestObservation(input: {
		criteriaFilter: CriteriaFilter;
		dataToProcess: DataToProcess;
	}): string | null {
		const incomingRequest: IncomingMonitorRequest | null =
			MonitorCriteriaDataExtractor.getIncomingMonitorRequest(
				input.dataToProcess,
			);

		if (!incomingRequest) {
			return null;
		}

		const lastHeartbeat: Date = incomingRequest.incomingRequestReceivedAt;
		const checkedAt: Date =
			incomingRequest.checkedAt || OneUptimeDate.getCurrentDate();

		const minutesSinceHeartbeat: number =
			OneUptimeDate.getDifferenceInMinutes(lastHeartbeat, checkedAt);

		const formattedMinutes: string | null =
			MonitorCriteriaMessageFormatter.formatNumber(minutesSinceHeartbeat, {
				maximumFractionDigits: 2,
			});

		return `Last incoming request was ${
			formattedMinutes ?? minutesSinceHeartbeat
		} minutes ago (checked at ${OneUptimeDate.getDateAsLocalFormattedString(
			checkedAt,
		)}).`;
	}

	private static describeRequestBodyObservation(input: {
		dataToProcess: DataToProcess;
	}): string | null {
		const incomingRequest: IncomingMonitorRequest | null =
			MonitorCriteriaDataExtractor.getIncomingMonitorRequest(
				input.dataToProcess,
			);

		if (!incomingRequest) {
			return null;
		}

		const requestBody: string | JSONObject | undefined =
			incomingRequest.requestBody;

		if (!requestBody) {
			return "Request body was empty.";
		}

		let requestBodyAsString: string;

		if (typeof requestBody === Typeof.Object) {
			try {
				requestBodyAsString = JSON.stringify(requestBody);
			} catch (err) {
				logger.error(err);
				requestBodyAsString = "[object]";
			}
		} else {
			requestBodyAsString = requestBody as string;
		}

		return `Request body sample: ${MonitorCriteriaMessageFormatter.formatSnippet(requestBodyAsString)}.`;
	}

	private static describeRequestHeaderObservation(input: {
		dataToProcess: DataToProcess;
	}): string | null {
		const incomingRequest: IncomingMonitorRequest | null =
			MonitorCriteriaDataExtractor.getIncomingMonitorRequest(
				input.dataToProcess,
			);

		if (!incomingRequest) {
			return null;
		}

		const headers: Array<string> = Object.keys(
			incomingRequest.requestHeaders || {},
		).map((header: string) => {
			return header.toLowerCase();
		});

		if (!headers.length) {
			return "Request headers were empty.";
		}

		return `Request headers present: ${MonitorCriteriaMessageFormatter.formatList(headers)}.`;
	}

	private static describeRequestHeaderValueObservation(input: {
		dataToProcess: DataToProcess;
	}): string | null {
		const incomingRequest: IncomingMonitorRequest | null =
			MonitorCriteriaDataExtractor.getIncomingMonitorRequest(
				input.dataToProcess,
			);

		if (!incomingRequest) {
			return null;
		}

		const headerValues: Array<string> = Object.values(
			incomingRequest.requestHeaders || {},
		).map((value: string) => {
			return value.toLowerCase();
		});

		if (!headerValues.length) {
			return "Request header values were empty.";
		}

		return `Request header values: ${MonitorCriteriaMessageFormatter.formatList(headerValues)}.`;
	}

	private static describeJavaScriptExpressionObservation(input: {
		criteriaFilter: CriteriaFilter;
	}): string | null {
		if (!input.criteriaFilter.value) {
			return "JavaScript expression evaluated to false.";
		}

		return `JavaScript expression "${input.criteriaFilter.value}" evaluated to false.`;
	}

	private static describeCpuUsageObservation(input: {
		dataToProcess: DataToProcess;
	}): string | null {
		const serverResponse: ServerMonitorResponse | null =
			MonitorCriteriaDataExtractor.getServerMonitorResponse(
				input.dataToProcess,
			);

		if (!serverResponse) {
			return null;
		}

		const cpuMetrics: BasicInfrastructureMetrics | undefined =
			serverResponse.basicInfrastructureMetrics;

		if (!cpuMetrics || !cpuMetrics.cpuMetrics) {
			return "CPU usage metrics were unavailable.";
		}

		const cpuPercent: string | null =
			MonitorCriteriaMessageFormatter.formatPercentage(
				cpuMetrics.cpuMetrics.percentUsed,
			);

		const coreInfo: string = cpuMetrics.cpuMetrics.cores
			? ` across ${cpuMetrics.cpuMetrics.cores} core${
					cpuMetrics.cpuMetrics.cores > 1 ? "s" : ""
				}`
			: "";

		return `CPU Usage (in %) was ${cpuPercent ?? "unavailable"}${coreInfo}.`;
	}

	private static describeMemoryUsageObservation(input: {
		dataToProcess: DataToProcess;
	}): string | null {
		const serverResponse: ServerMonitorResponse | null =
			MonitorCriteriaDataExtractor.getServerMonitorResponse(
				input.dataToProcess,
			);

		if (!serverResponse) {
			return null;
		}

		const memoryMetrics: BasicInfrastructureMetrics | undefined =
			serverResponse.basicInfrastructureMetrics;

		if (!memoryMetrics || !memoryMetrics.memoryMetrics) {
			return "Memory usage metrics were unavailable.";
		}

		const percentUsed: string | null =
			MonitorCriteriaMessageFormatter.formatPercentage(
				memoryMetrics.memoryMetrics.percentUsed,
			);

		const used: string | null = MonitorCriteriaMessageFormatter.formatBytes(
			memoryMetrics.memoryMetrics.used,
		);
		const total: string | null = MonitorCriteriaMessageFormatter.formatBytes(
			memoryMetrics.memoryMetrics.total,
		);

		return `Memory Usage (in %) was ${percentUsed ?? "unavailable"} (${used ?? "?"} used of ${total ?? "?"}).`;
	}

	private static describeDiskUsageObservation(input: {
		criteriaFilter: CriteriaFilter;
		dataToProcess: DataToProcess;
	}): string | null {
		const serverResponse: ServerMonitorResponse | null =
			MonitorCriteriaDataExtractor.getServerMonitorResponse(
				input.dataToProcess,
			);

		if (!serverResponse) {
			return null;
		}

		const diskPath: string =
			input.criteriaFilter.serverMonitorOptions?.diskPath || "/";

		const diskMetric: BasicInfrastructureMetrics | undefined =
			serverResponse.basicInfrastructureMetrics;

		if (!diskMetric || !diskMetric.diskMetrics?.length) {
			return `Disk metrics for path ${diskPath} were unavailable.`;
		}

		const matchedDisk = diskMetric.diskMetrics.find((disk) => {
			return disk.diskPath.trim().toLowerCase() === diskPath.trim().toLowerCase();
		});

		if (!matchedDisk) {
			return `Disk metrics did not include path ${diskPath}.`;
		}

		const percentUsedValue: number | null =
			MonitorCriteriaMessageFormatter.computeDiskUsagePercent(matchedDisk);
		const percentUsed: string | null =
			MonitorCriteriaMessageFormatter.formatPercentage(
				percentUsedValue ?? undefined,
			);

		const used: string | null = MonitorCriteriaMessageFormatter.formatBytes(
			matchedDisk.used,
		);
		const total: string | null = MonitorCriteriaMessageFormatter.formatBytes(
			matchedDisk.total,
		);
		const free: string | null = MonitorCriteriaMessageFormatter.formatBytes(
			matchedDisk.free,
		);

		return `Disk Usage (in %) on disk ${diskPath} was ${
			percentUsed ?? "unavailable"
		} (${used ?? "?"} used of ${total ?? "?"}, free ${free ?? "?"}).`;
	}

	private static describeServerProcessNameObservation(input: {
		criteriaFilter: CriteriaFilter;
		dataToProcess: DataToProcess;
	}): string | null {
		const serverResponse: ServerMonitorResponse | null =
			MonitorCriteriaDataExtractor.getServerMonitorResponse(
				input.dataToProcess,
			);

		if (!serverResponse) {
			return null;
		}

		const thresholdName: string =
			(input.criteriaFilter.value ?? "").toString().trim().toLowerCase();

		const processes: Array<ServerProcess> = serverResponse.processes || [];

		const matchingProcesses: Array<ServerProcess> = processes.filter(
			(process: ServerProcess) => {
				return process.name.trim().toLowerCase() === thresholdName;
			},
		);

		if (matchingProcesses.length > 0) {
			const summary: string = matchingProcesses
				.map((process: ServerProcess) => {
					return `${process.name} (pid ${process.pid})`;
				})
				.join(", ");

			return `Process ${input.criteriaFilter.value} is running (${summary}).`;
		}

		const processSummary: string | null =
			MonitorCriteriaMessageFormatter.describeProcesses(processes);

		if (processSummary) {
			return `Process ${input.criteriaFilter.value} was not running. Active processes: ${processSummary}.`;
		}

		return `Process ${input.criteriaFilter.value} was not running.`;
	}

	private static describeServerProcessPidObservation(input: {
		criteriaFilter: CriteriaFilter;
		dataToProcess: DataToProcess;
	}): string | null {
		const serverResponse: ServerMonitorResponse | null =
			MonitorCriteriaDataExtractor.getServerMonitorResponse(
				input.dataToProcess,
			);

		if (!serverResponse) {
			return null;
		}

		const thresholdPid: string =
			(input.criteriaFilter.value ?? "").toString().trim().toLowerCase();

		const processes: Array<ServerProcess> = serverResponse.processes || [];

		const matchingProcesses: Array<ServerProcess> = processes.filter(
			(process: ServerProcess) => {
				return process.pid.toString().trim().toLowerCase() === thresholdPid;
			},
		);

		if (matchingProcesses.length > 0) {
			const summary: string = matchingProcesses
				.map((process: ServerProcess) => {
					return `${process.name} (pid ${process.pid})`;
				})
				.join(", ");

			return `Process with PID ${input.criteriaFilter.value} is running (${summary}).`;
		}

		const processSummary: string | null =
			MonitorCriteriaMessageFormatter.describeProcesses(processes);

		if (processSummary) {
			return `Process with PID ${input.criteriaFilter.value} was not running. Active processes: ${processSummary}.`;
		}

		return `Process with PID ${input.criteriaFilter.value} was not running.`;
	}

	private static describeServerProcessCommandObservation(input: {
		criteriaFilter: CriteriaFilter;
		dataToProcess: DataToProcess;
	}): string | null {
		const serverResponse: ServerMonitorResponse | null =
			MonitorCriteriaDataExtractor.getServerMonitorResponse(
				input.dataToProcess,
			);

		if (!serverResponse) {
			return null;
		}

		const thresholdCommand: string =
			(input.criteriaFilter.value ?? "").toString().trim().toLowerCase();

		const processes: Array<ServerProcess> = serverResponse.processes || [];

		const matchingProcesses: Array<ServerProcess> = processes.filter(
			(process: ServerProcess) => {
				return process.command.trim().toLowerCase() === thresholdCommand;
			},
		);

		if (matchingProcesses.length > 0) {
			const summary: string = matchingProcesses
				.map((process: ServerProcess) => {
					return `${process.command} (pid ${process.pid})`;
				})
				.join(", ");

			return `Process with command ${input.criteriaFilter.value} is running (${summary}).`;
		}

		const processSummary: string | null =
			MonitorCriteriaMessageFormatter.describeProcesses(processes);

		if (processSummary) {
			return `Process with command ${input.criteriaFilter.value} was not running. Active processes: ${processSummary}.`;
		}

		return `Process with command ${input.criteriaFilter.value} was not running.`;
	}

	private static describeCertificateExpiresInHoursObservation(input: {
		dataToProcess: DataToProcess;
	}): string | null {
		const sslResponse: SslMonitorResponse | null =
			MonitorCriteriaDataExtractor.getSslResponse(input.dataToProcess);

		if (!sslResponse || !sslResponse.expiresAt) {
			return "SSL certificate expiration time was unavailable.";
		}

		const hoursRemaining: number = OneUptimeDate.getHoursBetweenTwoDates(
			OneUptimeDate.getCurrentDate(),
			sslResponse.expiresAt,
		);

		const formattedHours: string | null =
			MonitorCriteriaMessageFormatter.formatNumber(hoursRemaining, {
				maximumFractionDigits: 2,
			});

		return `SSL certificate expires at ${
			OneUptimeDate.getDateAsLocalFormattedString(sslResponse.expiresAt)
		} (${formattedHours ?? hoursRemaining} hours remaining).`;
	}

	private static describeCertificateExpiresInDaysObservation(input: {
		dataToProcess: DataToProcess;
	}): string | null {
		const sslResponse: SslMonitorResponse | null =
			MonitorCriteriaDataExtractor.getSslResponse(input.dataToProcess);

		if (!sslResponse || !sslResponse.expiresAt) {
			return "SSL certificate expiration time was unavailable.";
		}

		const daysRemaining: number = OneUptimeDate.getDaysBetweenTwoDates(
			OneUptimeDate.getCurrentDate(),
			sslResponse.expiresAt,
		);

		const formattedDays: string | null =
			MonitorCriteriaMessageFormatter.formatNumber(daysRemaining, {
				maximumFractionDigits: 2,
			});

		return `SSL certificate expires at ${
			OneUptimeDate.getDateAsLocalFormattedString(sslResponse.expiresAt)
		} (${formattedDays ?? daysRemaining} days remaining).`;
	}

	private static describeIsSelfSignedObservation(input: {
		dataToProcess: DataToProcess;
	}): string | null {
		const sslResponse: SslMonitorResponse | null =
			MonitorCriteriaDataExtractor.getSslResponse(input.dataToProcess);

		if (!sslResponse || sslResponse.isSelfSigned === undefined) {
			return "SSL certificate self-signed status was unavailable.";
		}

		return sslResponse.isSelfSigned
			? "SSL certificate is self signed."
			: "SSL certificate is not self signed.";
	}

	private static describeIsExpiredObservation(input: {
		dataToProcess: DataToProcess;
	}): string | null {
		const sslResponse: SslMonitorResponse | null =
			MonitorCriteriaDataExtractor.getSslResponse(input.dataToProcess);

		if (!sslResponse || !sslResponse.expiresAt) {
			return "SSL certificate expiration time was unavailable.";
		}

		const isExpired: boolean = OneUptimeDate.isBefore(
			sslResponse.expiresAt,
			OneUptimeDate.getCurrentDate(),
		);

		return isExpired
			? "SSL certificate is expired."
			: "SSL certificate is not expired.";
	}

	private static describeIsValidObservation(input: {
		dataToProcess: DataToProcess;
	}): string | null {
		const probeResponse: ProbeMonitorResponse | null =
			MonitorCriteriaDataExtractor.getProbeMonitorResponse(
				input.dataToProcess,
			);

		const sslResponse: SslMonitorResponse | undefined =
			probeResponse?.sslResponse;

		const isValid: boolean = Boolean(
			sslResponse &&
				probeResponse?.isOnline &&
				sslResponse.expiresAt &&
				!sslResponse.isSelfSigned &&
				OneUptimeDate.isAfter(
					sslResponse.expiresAt,
					OneUptimeDate.getCurrentDate(),
				),
		);

		if (!sslResponse) {
			return "SSL certificate details were unavailable.";
		}

		return isValid
			? "SSL certificate is valid."
			: "SSL certificate is not valid.";
	}

	private static describeIsInvalidObservation(input: {
		dataToProcess: DataToProcess;
	}): string | null {
		const probeResponse: ProbeMonitorResponse | null =
			MonitorCriteriaDataExtractor.getProbeMonitorResponse(
				input.dataToProcess,
			);

		const sslResponse: SslMonitorResponse | undefined =
			probeResponse?.sslResponse;

		const isInvalid: boolean =
			!sslResponse ||
			!probeResponse?.isOnline ||
			Boolean(
				sslResponse &&
					sslResponse.expiresAt &&
					(sslResponse.isSelfSigned ||
						OneUptimeDate.isBefore(
							sslResponse.expiresAt,
							OneUptimeDate.getCurrentDate(),
						)),
			);

		if (!sslResponse) {
			return "SSL certificate details were unavailable.";
		}

		return isInvalid
			? "SSL certificate is not valid."
			: "SSL certificate is valid.";
	}

	private static describeExecutionTimeObservation(input: {
		dataToProcess: DataToProcess;
	}): string | null {
		const syntheticResponses: Array<SyntheticMonitorResponse> =
			MonitorCriteriaDataExtractor.getSyntheticMonitorResponses(
				input.dataToProcess,
			);

		const executionTimes: Array<number> = syntheticResponses
			.map((response: SyntheticMonitorResponse) => {
				return response.executionTimeInMS;
			})
			.filter((value: number) => {
				return typeof value === "number" && !isNaN(value);
			});

		if (executionTimes.length > 0) {
			const summary: string | null =
				MonitorCriteriaMessageFormatter.summarizeNumericSeries(
					executionTimes,
				);

			if (summary) {
				return `Execution Time (in ms) recorded ${summary}.`;
			}
		}

		const customCodeResponse: CustomCodeMonitorResponse | null =
			MonitorCriteriaDataExtractor.getCustomCodeMonitorResponse(
				input.dataToProcess,
			);

		if (customCodeResponse) {
			const formatted: string | null =
				MonitorCriteriaMessageFormatter.formatNumber(
					customCodeResponse.executionTimeInMS,
					{ maximumFractionDigits: 2 },
				);

			return `Execution Time (in ms) was ${
				formatted ?? customCodeResponse.executionTimeInMS
			} ms.`;
		}

		return "Execution time was unavailable.";
	}

	private static describeResultValueObservation(input: {
		dataToProcess: DataToProcess;
	}): string | null {
		const syntheticResponses: Array<SyntheticMonitorResponse> =
			MonitorCriteriaDataExtractor.getSyntheticMonitorResponses(
				input.dataToProcess,
			);

		const resultValues: Array<string> = syntheticResponses
			.map((response: SyntheticMonitorResponse) => {
				return MonitorCriteriaMessageFormatter.formatResultValue(
					response.result,
				);
			})
			.filter((value: string) => {
				return value !== "undefined";
			});

		if (resultValues.length > 0) {
			const uniqueResults: Array<string> = Array.from(new Set(resultValues));

			return `Result Value samples: ${MonitorCriteriaMessageFormatter.formatList(uniqueResults)}.`;
		}

		const customCodeResponse: CustomCodeMonitorResponse | null =
			MonitorCriteriaDataExtractor.getCustomCodeMonitorResponse(
				input.dataToProcess,
			);

		if (customCodeResponse && customCodeResponse.result !== undefined) {
			const formatted: string = MonitorCriteriaMessageFormatter.formatResultValue(
				customCodeResponse.result,
			);

			return `Result Value was ${MonitorCriteriaMessageFormatter.formatSnippet(formatted)}.`;
		}

		return "Result value was unavailable.";
	}

	private static describeErrorObservation(input: {
		dataToProcess: DataToProcess;
	}): string | null {
		const syntheticResponses: Array<SyntheticMonitorResponse> =
			MonitorCriteriaDataExtractor.getSyntheticMonitorResponses(
				input.dataToProcess,
			);

		const errors: Array<string> = syntheticResponses
			.map((response: SyntheticMonitorResponse) => {
				return response.scriptError;
			})
			.filter((value: string | undefined): value is string => {
				return Boolean(value);
			})
			.map((error: string) => {
				return MonitorCriteriaMessageFormatter.formatSnippet(error, 80);
			});

		if (errors.length > 0) {
			return `Script errors: ${MonitorCriteriaMessageFormatter.formatList(errors)}.`;
		}

		const customCodeResponse: CustomCodeMonitorResponse | null =
			MonitorCriteriaDataExtractor.getCustomCodeMonitorResponse(
				input.dataToProcess,
			);

		if (customCodeResponse?.scriptError) {
			return `Script error: ${MonitorCriteriaMessageFormatter.formatSnippet(customCodeResponse.scriptError, 80)}.`;
		}

		if (customCodeResponse?.logMessages?.length) {
			return `Script log messages: ${MonitorCriteriaMessageFormatter.formatList(customCodeResponse.logMessages)}.`;
		}

		return "No script errors were reported.";
	}

	private static describeScreenSizeObservation(input: {
		dataToProcess: DataToProcess;
	}): string | null {
		const syntheticResponses: Array<SyntheticMonitorResponse> =
			MonitorCriteriaDataExtractor.getSyntheticMonitorResponses(
				input.dataToProcess,
			);

		if (!syntheticResponses.length) {
			return "Synthetic monitor results were unavailable.";
		}

		const screenSizes: Array<string> = Array.from(
			new Set(
				syntheticResponses.map((response: SyntheticMonitorResponse) => {
					return response.screenSizeType;
				}),
			),
		);

		return `Synthetic monitor screen sizes: ${MonitorCriteriaMessageFormatter.formatList(screenSizes)}.`;
	}

	private static describeBrowserObservation(input: {
		dataToProcess: DataToProcess;
	}): string | null {
		const syntheticResponses: Array<SyntheticMonitorResponse> =
			MonitorCriteriaDataExtractor.getSyntheticMonitorResponses(
				input.dataToProcess,
			);

		if (!syntheticResponses.length) {
			return "Synthetic monitor results were unavailable.";
		}

		const browsers: Array<string> = Array.from(
			new Set(
				syntheticResponses.map((response: SyntheticMonitorResponse) => {
					return response.browserType;
				}),
			),
		);

		return `Synthetic monitor browsers: ${MonitorCriteriaMessageFormatter.formatList(browsers)}.`;
	}

	private static describeLogCountObservation(input: {
		dataToProcess: DataToProcess;
	}): string | null {
		const logResponse: LogMonitorResponse | null =
			MonitorCriteriaDataExtractor.getLogMonitorResponse(input.dataToProcess);

		if (!logResponse) {
			return null;
		}

		return `Log count was ${logResponse.logCount}.`;
	}

	private static describeSpanCountObservation(input: {
		dataToProcess: DataToProcess;
	}): string | null {
		const traceResponse: TraceMonitorResponse | null =
			MonitorCriteriaDataExtractor.getTraceMonitorResponse(
				input.dataToProcess,
			);

		if (!traceResponse) {
			return null;
		}

		return `Span count was ${traceResponse.spanCount}.`;
	}

	private static describeMetricValueObservation(input: {
		criteriaFilter: CriteriaFilter;
		dataToProcess: DataToProcess;
		monitorStep: MonitorStep;
	}): string | null {
		const metricValues = MonitorCriteriaDataExtractor.extractMetricValues({
			criteriaFilter: input.criteriaFilter,
			dataToProcess: input.dataToProcess,
			monitorStep: input.monitorStep,
		});

		if (!metricValues) {
			return null;
		}

		if (!metricValues.values.length) {
			return `Metric Value${
				metricValues.alias ? ` (${metricValues.alias})` : ""
			} returned no data points.`;
		}

		const summary: string | null =
			MonitorCriteriaMessageFormatter.summarizeNumericSeries(
				metricValues.values,
			);

		if (!summary) {
			return null;
		}

		return `Metric Value${
			metricValues.alias ? ` (${metricValues.alias})` : ""
		} recorded ${summary}.`;
	}
}
