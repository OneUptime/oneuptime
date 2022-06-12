import EncryptionAlgorithm from '../../Types/EncryptionAlgorithm';

describe('enum EncryptionAlgorithm', () => {
    test('EncryptionAlgorithm.SHA256 should be SHA-256', () => {
        expect(EncryptionAlgorithm.SHA256).toEqual('SHA-256');
    });
});
