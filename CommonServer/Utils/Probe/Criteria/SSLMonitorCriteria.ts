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
        let threshold: number | string | undefined | null =
            input.criteriaFilter.value;

        const dataToProcess: ProbeMonitorResponse =
            input.dataToProcess as ProbeMonitorResponse;

        const sslResponse: SslMonitorResponse | undefined =
            dataToProcess.sslResponse;

        if (input.criteriaFilter.checkOn === CheckOn.IsValidCertificate) {
            const isValidCertificate: boolean = Boolean(
                sslResponse &&
                    dataToProcess.isOnline &&
                    sslResponse.expiresAt &&
                    !sslResponse.isSelfSigned &&
                    OneUptimeDate.isAfter(
                        sslResponse.expiresAt,
                        OneUptimeDate.getCurrentDate()
                    )
            );

            const isTrue: boolean =
                input.criteriaFilter.filterType === FilterType.True;

            const isFalse: boolean =
                input.criteriaFilter.filterType === FilterType.False;

            if (isValidCertificate && isTrue) {
                return 'SSL certificate is valid.';
            }

            if (!isValidCertificate && isFalse) {
                return 'SSL certificate is not valid.';
            }
        }

        if (input.criteriaFilter.checkOn === CheckOn.IsSelfSignedCertificate) {
            const isSelfSigned: boolean = Boolean(
                sslResponse && sslResponse.isSelfSigned
            );
            const isTrue: boolean =
                input.criteriaFilter.filterType === FilterType.True;

            const isFalse: boolean =
                input.criteriaFilter.filterType === FilterType.False;

            if (isSelfSigned && isTrue) {
                return 'SSL Certificate is self signed.';
            }

            if (!isSelfSigned && isFalse) {
                return 'SSL Certificate is not self signed.';
            }
        }

        if (input.criteriaFilter.checkOn === CheckOn.IsExpiredCertificate) {
            const isExpired: boolean = Boolean(
                sslResponse &&
                    sslResponse.expiresAt &&
                    OneUptimeDate.isBefore(
                        sslResponse.expiresAt,
                        OneUptimeDate.getCurrentDate()
                    )
            );

            const isTrue: boolean =
                input.criteriaFilter.filterType === FilterType.True;

            const isFalse: boolean =
                input.criteriaFilter.filterType === FilterType.False;

            if (isExpired && isTrue) {
                return 'SSL certificate is expired.';
            }

            if (!isExpired && isFalse) {
                return 'SSL certificate is not expired.';
            }
        }

        if (input.criteriaFilter.checkOn === CheckOn.IsNotAValidCertificate) {
            const isNotValid: boolean =
                !sslResponse ||
                !dataToProcess.isOnline ||
                Boolean(
                    sslResponse &&
                        sslResponse.expiresAt &&
                        (sslResponse.isSelfSigned ||
                            OneUptimeDate.isBefore(
                                sslResponse.expiresAt,
                                OneUptimeDate.getCurrentDate()
                            ))
                );
            const isTrue: boolean =
                input.criteriaFilter.filterType === FilterType.True;

            const isFalse: boolean =
                input.criteriaFilter.filterType === FilterType.False;

            if (isNotValid && isTrue) {
                return 'SSL certificate is not valid.';
            }

            if (!isNotValid && isFalse) {
                return 'SSL certificate is valid.';
            }
        }

        if (input.criteriaFilter.checkOn === CheckOn.ExpiresInHours) {
            threshold = CompareCriteria.convertThresholdToNumber(threshold);

            if (!threshold) {
                return null;
            }

            const expiresAt: Date | undefined =
                sslResponse && sslResponse.expiresAt;
            const hours: number | undefined =
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

            const expiresAt: Date | undefined =
                sslResponse && sslResponse.expiresAt;
            const days: number | undefined =
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
