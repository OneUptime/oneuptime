import Headers from '../../../Types/API/Headers';
import Faker from '../../../Utils/Faker';
describe('Headers', () => {
    test('should compile', () => {
        const apiKey: string = Faker.randomNumbers(16);
        const headers: Headers = {
            accept: 'application/json',
            'x-api-key': apiKey,
        };
        expect(headers['accept']).toBe('application/json');
        expect(headers['x-api-key']).toEqual(apiKey);
        expect(headers['undefined']).toBe(undefined);
    });
});
