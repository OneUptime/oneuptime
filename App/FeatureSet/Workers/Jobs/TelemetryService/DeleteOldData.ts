import RunCron from '../../Utils/Cron';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import OneUptimeDate from 'Common/Types/Date';
import { EVERY_HOUR, EVERY_MINUTE } from 'Common/Utils/CronTime';
import { IsDevelopment } from 'CommonServer/EnvironmentConfig';
import LogService from 'CommonServer/Services/LogService';
import SpanService from 'CommonServer/Services/SpanService';
import TelemetryServiceService from 'CommonServer/Services/TelemetryServiceService';
import QueryHelper from 'CommonServer/Types/AnalyticsDatabase/QueryHelper';
import TelemetryService from 'Model/Models/TelemetryService';

RunCron(
    'TelemetryService:DeleteOldData',
    {
        schedule: IsDevelopment ? EVERY_MINUTE : EVERY_HOUR,
        runOnStartup: false,
    },
    async () => {
        // get a list of all the telemetry services.

        const telemetryService: Array<TelemetryService> =
            await TelemetryServiceService.findBy({
                query: {},
                limit: LIMIT_MAX,
                skip: 0,
                select: {
                    retainTelemetryDataForDays: true,
                    projectId: true,
                    _id: true,
                },
                props: {
                    isRoot: true,
                },
            });

        for (const service of telemetryService) {
            let dataRententionDays: number | undefined =
                service.retainTelemetryDataForDays;

            if (!dataRententionDays) {
                dataRententionDays = 15; // default to 15 days.
            }

            // delete logs

            await LogService.deleteBy({
                query: {
                    createdAt: QueryHelper.lessThan(
                        OneUptimeDate.getSomeDaysAgo(dataRententionDays)
                    ),
                    serviceId: service.id,
                    projectId: service.projectId,
                },
                props: {
                    isRoot: true,
                },
            });

            // delete spans

            await SpanService.deleteBy({
                query: {
                    createdAt: QueryHelper.lessThan(
                        OneUptimeDate.getSomeDaysAgo(dataRententionDays)
                    ),
                    serviceId: service.id,
                    projectId: service.projectId,
                },
                props: {
                    isRoot: true,
                },
            });

            // TOOD: delete metrics.
        }
    }
);
