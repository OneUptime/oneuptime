import BaseModel from 'Common/Models/BaseModel';
import File from '../Models/File';

describe('File', () => {
    it('should be an instance of BaseModel', () => {
        const file: File = new File();
        expect(file).toBeInstanceOf(BaseModel);
    });
});
