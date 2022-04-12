import BadDataException from 'Common/Types/Exception/BadDataException';
import Database from '../Infrastructure/Database';
import ObjectID from 'Common/Types/ObjectID';
class FileService {
    async getFileById(fileId: ObjectID): void {
        const gfs = await Database.getFileClient();
        const file = await gfs.findOne({ _id: fileId });

        if (!file) {
            throw new BadDataException('File not found');
        }

        return file;
    }

    async deleteFileById(fileId: ObjectID): void {
        const gfs = await Database.getFileClient();
        await gfs.deleteOne({ _id: fileId });
    }
}

export default FileService;
