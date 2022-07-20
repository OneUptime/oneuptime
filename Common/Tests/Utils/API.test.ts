import Hostname from '../../Types/API/Hostname';
import Protocol from '../../Types/API/Protocol';
import API from '../../Utils/API';
describe('API methods', () => {
    test('get method should return response', () => {
        const api = new API(Protocol.HTTPS, Hostname.fromString('localhost'));
        api.get(api.baseRoute).then((response) => {
            expect(response).toBeDefined()
            expect(response.isSuccess).toEqual(true);
        });
    });

    test('post method should return response', () => {
        const api = new API(Protocol.HTTPS, Hostname.fromString('localhost'));
        api.post(api.baseRoute).then((response) => {
            expect(response).toBeDefined()
            expect(response.isSuccess).toEqual(true);
        });
    });

    test('put method should return response', () => {
        const api = new API(Protocol.HTTPS, Hostname.fromString('localhost'));
        api.put(api.baseRoute).then((response) => {
            expect(response).toBeDefined()
            expect(response.isSuccess).toEqual(true);
        });
    });

    test('delete method should return response', () => {
        const api = new API(Protocol.HTTPS, Hostname.fromString('localhost'));
        api.delete(api.baseRoute).then((response) => {
            expect(response).toBeDefined()
            expect(response.isSuccess).toEqual(true);
        });
    });
});
