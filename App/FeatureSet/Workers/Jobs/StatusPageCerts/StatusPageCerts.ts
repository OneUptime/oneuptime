import { EVERY_FIFTEEN_MINUTE } from 'Common/Utils/CronTime';
import RunCron from '../../Utils/Cron';
import { IsDevelopment } from 'CommonServer/EnvironmentConfig';
import StatusPageDomainService from 'CommonServer/Services/StatusPageDomainService';
import logger from 'CommonServer/Utils/Logger';

RunCron(
    'StatusPageCerts:RenewCerts',
    {
        schedule: IsDevelopment ? EVERY_FIFTEEN_MINUTE : EVERY_FIFTEEN_MINUTE,
        runOnStartup: true,
    },
    async () => {
        logger.info('Renewing Certs...');
        await StatusPageDomainService.renewCertsWhichAreExpiringSoon();
        logger.info('Renew Completed...');
    }
);

RunCron(
    'StatusPageCerts:CheckSslProvisioningStatus',
    {
        schedule: IsDevelopment ? EVERY_FIFTEEN_MINUTE : EVERY_FIFTEEN_MINUTE,
        runOnStartup: true,
    },
    async () => {
        await StatusPageDomainService.updateSslProvisioningStatusForAllDomains();
    }
);

RunCron(
    'StatusPageCerts:OrderSSL',
    {
        schedule: IsDevelopment ? EVERY_FIFTEEN_MINUTE : EVERY_FIFTEEN_MINUTE,
        runOnStartup: true,
    },
    async () => {
        await StatusPageDomainService.orderSSLForDomainsWhichAreNotOrderedYet();
    }
);

RunCron(
    'StatusPageCerts:VerifyCnameWhoseCnameisNotVerified',
    {
        schedule: IsDevelopment ? EVERY_FIFTEEN_MINUTE : EVERY_FIFTEEN_MINUTE,
        runOnStartup: true,
    },
    async () => {
        await StatusPageDomainService.verifyCnameWhoseCnameisNotVerified();
    }
);
