import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import TelemetryUtil from "../Telemetry/Telemetry";
import MetricService from "../../Services/MetricService";
import DataToProcess from "./DataToProcess";
import { MetricPointType, ServiceType } from "../../../Models/AnalyticsModels/Metric";
import MetricType from "../../../Models/DatabaseModels/MetricType";
import BasicInfrastructureMetrics from "../../../Types/Infrastructure/BasicMetrics";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import MonitorMetricType from "../../../Types/Monitor/MonitorMetricType";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import ServerMonitorResponse from "../../../Types/Monitor/ServerMonitor/ServerMonitorResponse";
import SyntheticMonitorResponse from "../../../Types/Monitor/SyntheticMonitors/SyntheticMonitorResponse";
import { CheckOn } from "../../../Types/Monitor/CriteriaFilter";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";

export default class MonitorMetricUtil {
	private static buildMonitorMetricAttributes(data: {
		monitorId: ObjectID;
		projectId: ObjectID;
		monitorName?: string | undefined;
		probeName?: string | undefined;
		extraAttributes?: JSONObject;
	}): JSONObject {
		const attributes: JSONObject = {
			monitorId: data.monitorId.toString(),
			projectId: data.projectId.toString(),
		};

		if (data.extraAttributes) {
			Object.assign(attributes, data.extraAttributes);
		}

		if (data.monitorName) {
			attributes["monitorName"] = data.monitorName;
		}

		if (data.probeName) {
			attributes["probeName"] = data.probeName;
		}

		return attributes;
	}

	private static buildMonitorMetricRow(data: {
		projectId: ObjectID;
		monitorId: ObjectID;
		metricName: string;
		value: number | null | undefined;
		attributes: JSONObject;
		metricPointType?: MetricPointType;
	}): JSONObject {
		const ingestionDate: Date = OneUptimeDate.getCurrentDate();
		const ingestionTimestamp: string =
			OneUptimeDate.toClickhouseDateTime(ingestionDate);
		const timeUnixNano: string =
			OneUptimeDate.toUnixNano(ingestionDate).toString();

		const attributes: JSONObject = { ...data.attributes };
		const attributeKeys: Array<string> =
			TelemetryUtil.getAttributeKeys(attributes);

		return {
			_id: ObjectID.generate().toString(),
			createdAt: ingestionTimestamp,
			updatedAt: ingestionTimestamp,
			projectId: data.projectId.toString(),
			serviceId: data.monitorId.toString(),
			serviceType: ServiceType.Monitor,
			name: data.metricName,
			aggregationTemporality: null,
			metricPointType: data.metricPointType || MetricPointType.Sum,
			time: ingestionTimestamp,
			startTime: null,
			timeUnixNano: timeUnixNano,
			startTimeUnixNano: null,
			attributes: attributes,
			attributeKeys: attributeKeys,
			isMonotonic: null,
			count: null,
			sum: null,
			min: null,
			max: null,
			bucketCounts: [],
			explicitBounds: [],
			value: data.value ?? null,
		} as JSONObject;
	}

	@CaptureSpan()
	public static async saveMonitorMetrics(data: {
		monitorId: ObjectID;
		projectId: ObjectID;
		dataToProcess: DataToProcess;
		probeName: string | undefined;
		monitorName: string | undefined;
	}): Promise<void> {
		if (!data.monitorId) {
			return;
		}

		if (!data.projectId) {
			return;
		}

		if (!data.dataToProcess) {
			return;
		}

		const metricRows: Array<JSONObject> = [];

		/*
		 * Metric name to serviceId map
		 * example: "cpu.usage" -> [serviceId1, serviceId2]
		 * since these are monitor metrics. They dont belong to any service so we can keep the array empty.
		 */
		const metricNameServiceNameMap: Dictionary<MetricType> = {};

		if (
			(data.dataToProcess as ServerMonitorResponse).basicInfrastructureMetrics
		) {
			// store cpu, memory, disk metrics.

			if ((data.dataToProcess as ServerMonitorResponse).requestReceivedAt) {
				let isOnline: boolean = true;

				const differenceInMinutes: number =
					OneUptimeDate.getDifferenceInMinutes(
						(data.dataToProcess as ServerMonitorResponse).requestReceivedAt,
						OneUptimeDate.getCurrentDate(),
					);

				if (differenceInMinutes > 2) {
					isOnline = false;
				}

				const attributes: JSONObject = this.buildMonitorMetricAttributes({
					monitorId: data.monitorId,
					projectId: data.projectId,
					monitorName: data.monitorName,
					probeName: data.probeName,
				});

				const metricRow: JSONObject = this.buildMonitorMetricRow({
					projectId: data.projectId,
					monitorId: data.monitorId,
					metricName: MonitorMetricType.IsOnline,
					value: isOnline ? 1 : 0,
					attributes: attributes,
					metricPointType: MetricPointType.Sum,
				});

				metricRows.push(metricRow);

				// add MetricType
				const metricType: MetricType = new MetricType();
				metricType.name = MonitorMetricType.IsOnline;
				metricType.description = CheckOn.IsOnline + " status for monitor";
				metricType.unit = "";

				// add to map
				metricNameServiceNameMap[MonitorMetricType.IsOnline] = metricType;
			}

			const basicMetrics: BasicInfrastructureMetrics | undefined = (
				data.dataToProcess as ServerMonitorResponse
			).basicInfrastructureMetrics;

			if (!basicMetrics) {
				return;
			}

			if (basicMetrics.cpuMetrics) {
				const attributes: JSONObject = this.buildMonitorMetricAttributes({
					monitorId: data.monitorId,
					projectId: data.projectId,
					monitorName: data.monitorName,
					probeName: data.probeName,
				});

				const metricRow: JSONObject = this.buildMonitorMetricRow({
					projectId: data.projectId,
					monitorId: data.monitorId,
					metricName: MonitorMetricType.CPUUsagePercent,
					value: basicMetrics.cpuMetrics.percentUsed ?? null,
					attributes: attributes,
					metricPointType: MetricPointType.Sum,
				});

				metricRows.push(metricRow);

				const metricType: MetricType = new MetricType();
				metricType.name = MonitorMetricType.CPUUsagePercent;
				metricType.description = CheckOn.CPUUsagePercent + " of Server/VM";
				metricType.unit = "%";

				metricNameServiceNameMap[MonitorMetricType.CPUUsagePercent] =
					metricType;
			}

			if (basicMetrics.memoryMetrics) {
				const attributes: JSONObject = this.buildMonitorMetricAttributes({
					monitorId: data.monitorId,
					projectId: data.projectId,
					monitorName: data.monitorName,
					probeName: data.probeName,
				});

				const metricRow: JSONObject = this.buildMonitorMetricRow({
					projectId: data.projectId,
					monitorId: data.monitorId,
					metricName: MonitorMetricType.MemoryUsagePercent,
					value: basicMetrics.memoryMetrics.percentUsed ?? null,
					attributes: attributes,
					metricPointType: MetricPointType.Sum,
				});

				metricRows.push(metricRow);

				const metricType: MetricType = new MetricType();
				metricType.name = MonitorMetricType.MemoryUsagePercent;
				metricType.description = CheckOn.MemoryUsagePercent + " of Server/VM";
				metricType.unit = "%";

				metricNameServiceNameMap[MonitorMetricType.MemoryUsagePercent] =
					metricType;
			}

			if (basicMetrics.diskMetrics && basicMetrics.diskMetrics.length > 0) {
				for (const diskMetric of basicMetrics.diskMetrics) {
					const extraAttributes: JSONObject = {};

					if (diskMetric.diskPath) {
						extraAttributes["diskPath"] = diskMetric.diskPath;
					}

					const attributes: JSONObject = this.buildMonitorMetricAttributes({
						monitorId: data.monitorId,
						projectId: data.projectId,
						monitorName: data.monitorName,
						probeName: data.probeName,
						extraAttributes: extraAttributes,
					});

					const metricRow: JSONObject = this.buildMonitorMetricRow({
						projectId: data.projectId,
						monitorId: data.monitorId,
						metricName: MonitorMetricType.DiskUsagePercent,
						value: diskMetric.percentUsed ?? null,
						attributes: attributes,
						metricPointType: MetricPointType.Sum,
					});

					metricRows.push(metricRow);

					const metricType: MetricType = new MetricType();
					metricType.name = MonitorMetricType.DiskUsagePercent;
					metricType.description = CheckOn.DiskUsagePercent + " of Server/VM";
					metricType.unit = "%";

					metricNameServiceNameMap[MonitorMetricType.DiskUsagePercent] =
						metricType;
				}
			}
		}

		if (
			(data.dataToProcess as ProbeMonitorResponse).customCodeMonitorResponse
				?.executionTimeInMS
		) {
			const extraAttributes: JSONObject = {
				probeId: (
					data.dataToProcess as ProbeMonitorResponse
				).probeId.toString(),
			};

			const attributes: JSONObject = this.buildMonitorMetricAttributes({
				monitorId: data.monitorId,
				projectId: data.projectId,
				extraAttributes: extraAttributes,
			});

			const metricRow: JSONObject = this.buildMonitorMetricRow({
				projectId: data.projectId,
				monitorId: data.monitorId,
				metricName: MonitorMetricType.ExecutionTime,
				value:
					(data.dataToProcess as ProbeMonitorResponse).customCodeMonitorResponse
						?.executionTimeInMS ?? null,
				attributes: attributes,
				metricPointType: MetricPointType.Sum,
			});

			metricRows.push(metricRow);

			const metricType: MetricType = new MetricType();
			metricType.name = MonitorMetricType.ExecutionTime;
			metricType.description = CheckOn.ExecutionTime + " of this monitor";
			metricType.unit = "ms";

			metricNameServiceNameMap[MonitorMetricType.ExecutionTime] = metricType;
		}

		if (
			(data.dataToProcess as ProbeMonitorResponse) &&
			(data.dataToProcess as ProbeMonitorResponse).syntheticMonitorResponse &&
			(
				(data.dataToProcess as ProbeMonitorResponse).syntheticMonitorResponse ||
				[]
			).length > 0
		) {
			const syntheticResponses: Array<SyntheticMonitorResponse> =
				(data.dataToProcess as ProbeMonitorResponse).syntheticMonitorResponse ||
				[];

			for (const syntheticMonitorResponse of syntheticResponses) {
				const extraAttributes: JSONObject = {
					probeId: (
						data.dataToProcess as ProbeMonitorResponse
					).probeId.toString(),
				};

				if (syntheticMonitorResponse.browserType) {
					extraAttributes["browserType"] = syntheticMonitorResponse.browserType;
				}

				if (syntheticMonitorResponse.screenSizeType) {
					extraAttributes["screenSizeType"] =
						syntheticMonitorResponse.screenSizeType;
				}

				const attributes: JSONObject = this.buildMonitorMetricAttributes({
					monitorId: data.monitorId,
					projectId: data.projectId,
					monitorName: data.monitorName,
					probeName: data.probeName,
					extraAttributes: extraAttributes,
				});

				const metricRow: JSONObject = this.buildMonitorMetricRow({
					projectId: data.projectId,
					monitorId: data.monitorId,
					metricName: MonitorMetricType.ExecutionTime,
					value: syntheticMonitorResponse.executionTimeInMS ?? null,
					attributes: attributes,
					metricPointType: MetricPointType.Sum,
				});

				metricRows.push(metricRow);

				const metricType: MetricType = new MetricType();
				metricType.name = MonitorMetricType.ExecutionTime;
				metricType.description = CheckOn.ExecutionTime + " of this monitor";
				metricType.unit = "ms";

				metricNameServiceNameMap[MonitorMetricType.ExecutionTime] = metricType;
			}
		}

		if ((data.dataToProcess as ProbeMonitorResponse).responseTimeInMs) {
			const extraAttributes: JSONObject = {
				probeId: (
					data.dataToProcess as ProbeMonitorResponse
				).probeId.toString(),
			};

			const attributes: JSONObject = this.buildMonitorMetricAttributes({
				monitorId: data.monitorId,
				projectId: data.projectId,
				monitorName: data.monitorName,
				probeName: data.probeName,
				extraAttributes: extraAttributes,
			});

			const metricRow: JSONObject = this.buildMonitorMetricRow({
				projectId: data.projectId,
				monitorId: data.monitorId,
				metricName: MonitorMetricType.ResponseTime,
				value:
					(data.dataToProcess as ProbeMonitorResponse).responseTimeInMs ?? null,
				attributes: attributes,
				metricPointType: MetricPointType.Sum,
			});

			metricRows.push(metricRow);

			const metricType: MetricType = new MetricType();
			metricType.name = MonitorMetricType.ResponseTime;
			metricType.description = CheckOn.ResponseTime + " of this monitor";
			metricType.unit = "ms";

			metricNameServiceNameMap[MonitorMetricType.ResponseTime] = metricType;
		}

		if ((data.dataToProcess as ProbeMonitorResponse).isOnline !== undefined) {
			const extraAttributes: JSONObject = {
				probeId: (
					data.dataToProcess as ProbeMonitorResponse
				).probeId.toString(),
			};

			const attributes: JSONObject = this.buildMonitorMetricAttributes({
				monitorId: data.monitorId,
				projectId: data.projectId,
				monitorName: data.monitorName,
				probeName: data.probeName,
				extraAttributes: extraAttributes,
			});

			const metricRow: JSONObject = this.buildMonitorMetricRow({
				projectId: data.projectId,
				monitorId: data.monitorId,
				metricName: MonitorMetricType.IsOnline,
				value: (data.dataToProcess as ProbeMonitorResponse).isOnline ? 1 : 0,
				attributes: attributes,
				metricPointType: MetricPointType.Sum,
			});

			metricRows.push(metricRow);

			const metricType: MetricType = new MetricType();
			metricType.name = MonitorMetricType.IsOnline;
			metricType.description = CheckOn.IsOnline + " status for monitor";
			metricType.unit = "";

			metricNameServiceNameMap[MonitorMetricType.IsOnline] = metricType;
		}

		if ((data.dataToProcess as ProbeMonitorResponse).responseCode) {
			const extraAttributes: JSONObject = {
				probeId: (
					data.dataToProcess as ProbeMonitorResponse
				).probeId.toString(),
			};

			const attributes: JSONObject = this.buildMonitorMetricAttributes({
				monitorId: data.monitorId,
				projectId: data.projectId,
				monitorName: data.monitorName,
				probeName: data.probeName,
				extraAttributes: extraAttributes,
			});

			const metricRow: JSONObject = this.buildMonitorMetricRow({
				projectId: data.projectId,
				monitorId: data.monitorId,
				metricName: MonitorMetricType.ResponseStatusCode,
				value:
					(data.dataToProcess as ProbeMonitorResponse).responseCode ?? null,
				attributes: attributes,
				metricPointType: MetricPointType.Sum,
			});

			metricRows.push(metricRow);

			const metricType: MetricType = new MetricType();
			metricType.name = MonitorMetricType.ResponseStatusCode;
			metricType.description = CheckOn.ResponseStatusCode +
				" for this monitor";
			metricType.unit = "Status Code";

			metricNameServiceNameMap[MonitorMetricType.ResponseStatusCode] =
				metricType;
		}

		if (metricRows.length > 0) {
			await MetricService.insertJsonRows(metricRows);
		}

		// index metrics
		TelemetryUtil.indexMetricNameServiceNameMap({
			projectId: data.projectId,
			metricNameServiceNameMap: metricNameServiceNameMap,
		}).catch((err: Error) => {
			logger.error(err);
		});
	}
}
