import BadDataException from 'Common/Types/Exception/BadDataException';
import Database from '../Infrastructure/Database';
import ObjectID from 'Common/Types/ObjectID';
class FileService {
    public async getFileById(fileId: ObjectID): void {
        const gfs: $TSFixMe = await Database.getFileClient();
        const file: $TSFixMe = await gfs.findOne({ _id: fileId });

        if (!file) {
            throw new BadDataException('File not found');
        }

        return file;
    }

    public async deleteFileById(fileId: ObjectID): void {
        const gfs: $TSFixMe = await Database.getFileClient();
        await gfs.deleteOne({ _id: fileId });
    }
}

export default FileService;
