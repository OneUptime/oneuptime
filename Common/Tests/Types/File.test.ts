import type { File } from '../../Types/File';

describe('interface File', () => {
    test('should have name and contentType property', () => {
        const file: File = {
            name: 'file',
            contentType: 'text/html',
        };
        expect(file.name).toEqual('file');
        expect(file.contentType).toEqual('text/html');
    });
    test('name and contentType property should be mutable', () => {
        const file: File = {
            name: 'file',
            contentType: 'text/html',
        };
        file.name = 'updatedFile';
        file.contentType = 'Text/html';
        expect(file.name).toEqual('updatedFile');
        expect(file.contentType).toEqual('Text/html');
    });
});
