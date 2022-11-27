import { EVERY_HOUR, EVERY_MINUTE } from '../../Utils/CronTime';
import RunCron from '../../Utils/Cron';
import { IsDevelopment } from 'CommonServer/Config';
import StatusPageDomain from 'Model/Models/StatusPageDomain';
import StatusPageDomainService from 'CommonServer/Services/StatusPageDomainService';
import QueryHelper from 'CommonServer/Types/Database/QueryHelper';
import OneUptimeDate from 'Common/Types/Date';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import Greenlock from 'greenlock';
import HTTPChallenge from '../../Utils/Greenlock/HTTPChallenge';

var gl = Greenlock.create({
    configDir: './greenlock.d/',
    challenges: {
		'http-01': HTTPChallenge
    },
    // Staging for testing environments
    staging: IsDevelopment,

    // This should be the contact who receives critical bug and security notifications
    // Optionally, you may receive other (very few) updates, such as important new features
    maintainerEmail: 'tech@oneuptime.com',

    // for an RFC 8555 / RFC 7231 ACME client user agent
    packageAgent: "oneuptime/1.0.0"
});


RunCron('StatusPage:Certs', IsDevelopment ? EVERY_MINUTE : EVERY_HOUR, async () => { 
    // fetch all domains wiht expired certs. 

    const expiredDomains: Array<StatusPageDomain> = await StatusPageDomainService.findBy({
        query: {
            sslCertificateExpiresAt: QueryHelper.lessThan(OneUptimeDate.getCurrentDate()),
        },
        select: {
            _id: true,
            fullDomain: true
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
            isRoot: true,
        }
    });

    

    for (const domain of expiredDomains) {
        
    }
    
});