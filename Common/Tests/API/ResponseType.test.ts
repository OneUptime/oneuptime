import ResponseType from '../../Types/API/ResponseType';
describe('ResponseType', () => {
    test('ResponsetType.CSV to be csv', () => {
        expect(ResponseType.CSV).toBe('csv');
    });
    test('ResponseType.HTML to be json', () => {
        expect(ResponseType.HTML).toBe('html');
    });
    test('ResponseType.HTML to be', () => {
        expect(ResponseType.JSON).toBe('json');
    });
});
