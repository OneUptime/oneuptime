import {
    CheckOn,
    CriteriaFilter,
    FilterType,
} from 'Common/Types/Monitor/CriteriaFilter';
import OneUptimeDate from 'Common/Types/Date';
import ProbeMonitorResponse from 'Common/Types/Probe/ProbeMonitorResponse';
import CompareCriteria from './CompareCriteria';
import DataToProcess from '../DataToProcess';
import SslMonitorResponse from 'Common/Types/Monitor/SSLMonitor/SslMonitorResponse';

export default class ServerMonitorCriteria {
    public static async isMonitorInstanceCriteriaFilterMet(input: {
        dataToProcess: DataToProcess;
        criteriaFilter: CriteriaFilter;
    }): Promise<string | null> {
        // Server Monitoring Checks

        let threshold: number | string | undefined | null =
            input.criteriaFilter.value;

        const dataToProcess: ProbeMonitorResponse =
            input.dataToProcess as ProbeMonitorResponse;

        const sslResponse: SslMonitorResponse | undefined =
            dataToProcess.sslResponse;

        if (input.criteriaFilter.checkOn === CheckOn.IsValidCertificate) {
            const isValidCertificate =
                sslResponse &&
                sslResponse.expiresAt &&
                !sslResponse.isSelfSigned &&
                OneUptimeDate.isAfter(
                    sslResponse.expiresAt,
                    OneUptimeDate.getCurrentDate()
                );
            const isTrue = input.criteriaFilter.filterType === FilterType.True;

            if (isValidCertificate && isTrue) {
                return 'SSL certificate is valid';
            }
            return 'SSL certificate is not valid';
        }

        if (input.criteriaFilter.checkOn === CheckOn.IsSelfSignedCertificate) {
            const isSelfSigned = sslResponse && sslResponse.isSelfSigned;
            const isTrue = input.criteriaFilter.filterType === FilterType.True;

            if (isSelfSigned && isTrue) {
                return 'SSL Certificate is self signed';
            }
            return 'SSL Certificate is not self signed';
        }

        if (input.criteriaFilter.checkOn === CheckOn.IsExpiredCertificate) {
            const isExpired =
                sslResponse &&
                sslResponse.expiresAt &&
                OneUptimeDate.isBefore(
                    sslResponse.expiresAt,
                    OneUptimeDate.getCurrentDate()
                );
            const isTrue = input.criteriaFilter.filterType === FilterType.True;

            if (isExpired && isTrue) {
                return 'SSL certificate is expired';
            }
            return 'SSL certificate is not expired';
        }

        if (input.criteriaFilter.checkOn === CheckOn.IsNotAValidCertificate) {
            const isNotValid =
                sslResponse &&
                sslResponse.expiresAt &&
                (sslResponse.isSelfSigned ||
                    OneUptimeDate.isBefore(
                        sslResponse.expiresAt,
                        OneUptimeDate.getCurrentDate()
                    ));
            const isTrue = input.criteriaFilter.filterType === FilterType.True;

            if (isNotValid && isTrue) {
                return 'SSL certificate is not valid';
            }
            return 'SSL certificate is valid';
        }

        if (input.criteriaFilter.checkOn === CheckOn.ExpiresInHours) {
            threshold = CompareCriteria.convertThresholdToNumber(threshold);

            if (!threshold) {
                return null;
            }

            const expiresAt = sslResponse && sslResponse.expiresAt;
            const hours =
                expiresAt &&
                OneUptimeDate.getHoursBetweenTwoDates(
                    OneUptimeDate.getCurrentDate(),
                    expiresAt
                );

            if (hours === null || hours === undefined) {
                return null;
            }

            return CompareCriteria.compareCriteriaNumbers({
                value: hours,
                threshold: threshold as number,
                criteriaFilter: input.criteriaFilter,
            });
        }

        if (input.criteriaFilter.checkOn === CheckOn.ExpiresInDays) {
            threshold = CompareCriteria.convertThresholdToNumber(threshold);

            if (!threshold) {
                return null;
            }

            const expiresAt = sslResponse && sslResponse.expiresAt;
            const days =
                expiresAt &&
                OneUptimeDate.getDaysBetweenTwoDates(
                    OneUptimeDate.getCurrentDate(),
                    expiresAt
                );

            if (days === null || days === undefined) {
                return null;
            }

            return CompareCriteria.compareCriteriaNumbers({
                value: days,
                threshold: threshold as number,
                criteriaFilter: input.criteriaFilter,
            });
        }

        return null;
    }
}
