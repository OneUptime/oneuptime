import { IsDevelopment } from 'CommonServer/EnvironmentConfig';
import RunCron from '../../Utils/Cron';
import { EVERY_HOUR, EVERY_MINUTE } from 'Common/Utils/CronTime';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import TelemetryService from 'Model/Models/TelemetryService';
import TelemetryServiceService from 'CommonServer/Services/TelemetryServiceService';
import LogService from 'CommonServer/Services/LogService';
import QueryHelper from 'CommonServer/Types/AnalyticsDatabase/QueryHelper';
import OneUptimeDate from 'Common/Types/Date';
import SpanService from 'CommonServer/Services/SpanService';

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
                    _id: true,
                },
                props: {
                    isRoot: true,
                },
            });

        for (const service of telemetryService) {
            let dataRententionDays: number | undefined = service.retainTelemetryDataForDays;

            if (!dataRententionDays) {
                dataRententionDays = 15; // default to 15 days.
            }

            // delete logs

            await LogService.deleteBy({
                query: {
                    createdAt: QueryHelper.lessThan(
                        OneUptimeDate.getSomeDaysAgo(dataRententionDays)
                    ),
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
                },
                props: {
                    isRoot: true,
                },
            });

            // TOOD: delete metrics.
        }
    }
);
