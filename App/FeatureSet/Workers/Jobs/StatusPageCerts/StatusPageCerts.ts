import { EVERY_HOUR, EVERY_MINUTE } from 'Common/Utils/CronTime';
import RunCron from '../../Utils/Cron';
import { IsDevelopment } from 'CommonServer/EnvironmentConfig';
import StatusPageDomainService from 'CommonServer/Services/StatusPageDomainService';
import logger from 'CommonServer/Utils/Logger';

RunCron(
    'StatusPageCerts:RenewCerts',
    { schedule: IsDevelopment ? EVERY_MINUTE : EVERY_HOUR, runOnStartup: true },
    async () => {
        logger.info('Renewing Certs...');
        await StatusPageDomainService.renewCertsWhichAreExpiringSoon();
        logger.info('Renew Completed...');
    }
);

RunCron(
    'StatusPageCerts:OrderCerts',
    { schedule: IsDevelopment ? EVERY_MINUTE : EVERY_HOUR, runOnStartup: true },
    async () => {
        // Fetch all domains where certs are added to greenlock.
        await StatusPageDomainService.orderCertsForAllDomainsWithNoSSLProvisioned();
    }
);

RunCron(
    'StatusPageCerts:AddCerts',
    { schedule: IsDevelopment ? EVERY_MINUTE : EVERY_HOUR, runOnStartup: true },
    async () => {
        await StatusPageDomainService.addDomainsWhichAreNotAddedToGreenlock();
    }
);

RunCron(
    'StatusPageCerts:RemoveCerts',
    { schedule: IsDevelopment ? EVERY_MINUTE : EVERY_HOUR, runOnStartup: true },
    async () => {
        await StatusPageDomainService.cleanupAllDomainFromGreenlock();
    }
);

RunCron(
    'StatusPageCerts:CheckSslProvisioningStatus',
    { schedule: IsDevelopment ? EVERY_MINUTE : EVERY_HOUR, runOnStartup: true },
    async () => {
        await StatusPageDomainService.updateSslProvisioningStatusForAllDomains();
    }
);
