import IPType from '../../../Types/IP/IPType';

describe('IPType', () => {
    test('should have a type of IPv4', () => {
        expect(IPType.IPv4).toBe('IPv4');
    });

    test('should have a type of IPv6', () => {
        expect(IPType.IPv6).toBe('IPv6');
    });
});
