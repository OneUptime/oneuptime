import Protocol from '../../Types/API/Protocol';

describe('Protocol', () => {
    test('Protocol.HTTPS should be https://', () => {
        expect(Protocol.HTTPS).toBe('https://');
    });
    test('Protocol.HTTP should be https://', () => {
        expect(Protocol.HTTP).toBe('http://');
    });
    test('Protocol.WS should be ws://', () => {
        expect(Protocol.WS).toBe('ws://');
    });
    test('Protocol.WSS should be ws://', () => {
        expect(Protocol.WSS).toBe('wss://');
    });
    test('Protocol.MONGO_DB should be mongodb://', () => {
        expect(Protocol.MONGO_DB).toBe('mongodb://');
    });
});
