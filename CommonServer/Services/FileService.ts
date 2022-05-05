import ObjectID from 'Common/Types/ObjectID';
class FileService {
    public async getFileById(_fileId: ObjectID): Promise<void> {
        /*
         * const gfs: Collection = await Database.getFileClient();
         * const file: Document | null = await gfs.findOne({ _id: fileId });
         */
        /*
         * if (!file) {
         *     throw new BadDataException('File not found');
         * }
         */
        // return file;
    }

    public async deleteFileById(_fileId: ObjectID): Promise<void> {
        /*
         * const gfs: Collection = await Database.getFileClient();
         * await gfs.deleteOne({ _id: fileId });
         */
    }
}

export default FileService;
