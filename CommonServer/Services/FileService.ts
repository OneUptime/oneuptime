import BadDataException from 'Common/Types/Exception/BadDataException';
import Database, { Collection, Document } from '../Infrastructure/Database';
import ObjectID from 'Common/Types/ObjectID';
class FileService {
    public async getFileById(fileId: ObjectID): Promise<Document> {
        const gfs: Collection = await Database.getFileClient();
        const file: Document | null = await gfs.findOne({ _id: fileId });

        if (!file) {
            throw new BadDataException('File not found');
        }

        return file;
    }

    public async deleteFileById(fileId: ObjectID): Promise<void> {
        const gfs: Collection = await Database.getFileClient();
        await gfs.deleteOne({ _id: fileId });
    }
}

export default FileService;
