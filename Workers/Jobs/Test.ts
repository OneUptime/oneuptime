import { IsDevelopment } from 'CommonServer/Config';
import RunCron from '../Utils/Cron';
import { EVERY_DAY, EVERY_MINUTE } from 'Common/Utils/CronTime';
import SMSService from 'CommonServer/Services/SMSService';
import Phone from 'Common/Types/Phone';
import ObjectID from 'Common/Types/ObjectID';

const number = 1;

RunCron(
    'TestWorker',
    { schedule: IsDevelopment ? EVERY_MINUTE : EVERY_DAY, runOnStartup: false },
    async () => {
        SMSService.sendSms(
            new Phone('+15853641376'),
            'Test message from worker' + number,
            {
                projectId: new ObjectID('e1308f0f-364d-4f2c-8565-0d01fc25f8fe'),
            }
        );
    }
);
