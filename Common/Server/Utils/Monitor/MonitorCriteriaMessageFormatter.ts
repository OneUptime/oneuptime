import logger from "../Logger";
import BasicInfrastructureMetrics from "../../../Types/Infrastructure/BasicMetrics";
import Typeof from "../../../Types/Typeof";
import { ServerProcess } from "../../../Types/Monitor/ServerMonitor/ServerMonitorResponse";

export default class MonitorCriteriaMessageFormatter {
	public static formatNumber(
		value: number | null | undefined,
		options?: { maximumFractionDigits?: number },
	): string | null {
		if (value === null || value === undefined || isNaN(value)) {
			return null;
		}

		const fractionDigits: number =
			options?.maximumFractionDigits !== undefined
				? options.maximumFractionDigits
				: Math.abs(value) < 10
					? 2
					: Math.abs(value) < 100
						? 1
						: 0;

		return value.toFixed(fractionDigits);
	}

	public static formatPercentage(
		value: number | null | undefined,
	): string | null {
		const formatted: string | null = MonitorCriteriaMessageFormatter.formatNumber(
			value,
			{
				maximumFractionDigits:
					value !== null && value !== undefined && Math.abs(value) < 100 ? 1 : 0,
			},
		);

		if (!formatted) {
			return null;
		}

		return `${formatted}%`;
	}

	public static formatBytes(
		bytes: number | null | undefined,
	): string | null {
		if (bytes === null || bytes === undefined || isNaN(bytes)) {
			return null;
		}

		const units: Array<string> = ["B", "KB", "MB", "GB", "TB", "PB"];
		let value: number = bytes;
		let index: number = 0;

		while (value >= 1024 && index < units.length - 1) {
			value = value / 1024;
			index++;
		}

		const formatted: string | null = MonitorCriteriaMessageFormatter.formatNumber(
			value,
			{
				maximumFractionDigits: value >= 100 ? 0 : value >= 10 ? 1 : 2,
			},
		);

		if (!formatted) {
			return null;
		}

		return `${formatted} ${units[index]}`;
	}

	public static formatList(
		items: Array<string>,
		maxItems: number = 5,
	): string {
		if (!items.length) {
			return "";
		}

		const trimmedItems: Array<string> = items.slice(0, maxItems);
		const suffix: string =
			items.length > maxItems ? `, +${items.length - maxItems} more` : "";

		return `${trimmedItems.join(", ")} ${suffix}`.trim();
	}

	public static formatSnippet(text: string, maxLength: number = 120): string {
		const sanitized: string = text.replace(/\s+/g, " ").trim();

		if (sanitized.length <= maxLength) {
			return sanitized;
		}

		return `${sanitized.slice(0, maxLength)}…`;
	}

	public static describeProcesses(
		processes: Array<ServerProcess>,
	): string | null {
		if (!processes.length) {
			return null;
		}

		const processSummaries: Array<string> = processes.map(
			(process: ServerProcess) => {
				return `${process.name} (pid ${process.pid})`;
			},
		);

		return MonitorCriteriaMessageFormatter.formatList(processSummaries);
	}

	public static computeDiskUsagePercent(
		diskMetric: BasicInfrastructureMetrics["diskMetrics"][number],
	): number | null {
		if (!diskMetric) {
			return null;
		}

		if (
			diskMetric.percentUsed !== undefined &&
			diskMetric.percentUsed !== null &&
			!isNaN(diskMetric.percentUsed)
		) {
			return diskMetric.percentUsed;
		}

		if (
			diskMetric.percentFree !== undefined &&
			diskMetric.percentFree !== null &&
			!isNaN(diskMetric.percentFree)
		) {
			return 100 - diskMetric.percentFree;
		}

		if (diskMetric.total && diskMetric.used && diskMetric.total > 0) {
			return (diskMetric.used / diskMetric.total) * 100;
		}

		return null;
	}

	public static summarizeNumericSeries(values: Array<number>): string | null {
		if (!values.length) {
			return null;
		}

		const latest: number | undefined = values[values.length - 1];

		if (latest === undefined) {
			return null;
		}

		const latestFormatted: string | null =
			MonitorCriteriaMessageFormatter.formatNumber(latest, {
				maximumFractionDigits: 2,
			});

		let summary: string = `latest ${latestFormatted ?? latest}`;

		if (values.length > 1) {
			const min: number = Math.min(...values);
			const max: number = Math.max(...values);

			const minFormatted: string | null =
				MonitorCriteriaMessageFormatter.formatNumber(min, {
					maximumFractionDigits: 2,
				});
			const maxFormatted: string | null =
				MonitorCriteriaMessageFormatter.formatNumber(max, {
					maximumFractionDigits: 2,
				});

			summary += ` (min ${minFormatted ?? min}, max ${maxFormatted ?? max})`;
		}

		summary += ` across ${values.length} data point${
			values.length === 1 ? "" : "s"
		}`;

		return summary;
	}

	public static formatResultValue(value: unknown): string {
		if (value === null || value === undefined) {
			return "undefined";
		}

		if (typeof value === Typeof.Object) {
			try {
				return JSON.stringify(value);
			} catch (err) {
				logger.error(err);
				return "[object]";
			}
		}

		return value.toString();
	}
}
