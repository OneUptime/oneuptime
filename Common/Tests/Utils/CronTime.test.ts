import {
    EVERY_MINUTE,
    EVERY_DAY,
    EVERY_HOUR,
    EVERY_FIVE_MINUTE,
    EVERY_FIVE_SECONDS,
    EVERY_WEEK,
} from '../../Utils/CronTime';

describe('CronTime', () => {
    test('should return every minute', () => {
        expect(EVERY_MINUTE).toEqual('* * * * *');
    });

    test('should return every day', () => {
        expect(EVERY_DAY).toEqual('0 8 * * *');
    });

    test('should return every hour', () => {
        expect(EVERY_HOUR).toEqual('1 * * * *');
    });

    test('should return every five minute', () => {
        expect(EVERY_FIVE_MINUTE).toEqual('*/5 * * * *');
    });

    test('should return every five seconds', () => {
        expect(EVERY_FIVE_SECONDS).toEqual('*/5 * * * * *');
    });

    test('should return every week', () => {
        expect(EVERY_WEEK).toEqual('0 0 * * 0');
    });
});
