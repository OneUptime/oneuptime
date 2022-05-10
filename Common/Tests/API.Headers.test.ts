import Headers from '../Types/API/Headers';
import Faker from './TestingUtils/Faker';
describe('Headers', () => {
    test('should compile', () => {
        const apiKey: string = Faker.random16Numbers();
        const headers: Headers = {
            accept: 'application/json',
            'x-api-key': apiKey,
        };
        expect(headers['accept']).toBe('application/json');
        expect(headers['x-api-key']).toEqual(apiKey);
        expect(headers['undefined']).toBe(undefined);
    });
});
