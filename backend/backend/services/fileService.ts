export default {
    findOneBy: async function(query: $TSFixMe) {
        const gfs = await Grid(mongoose.connection.db, mongoose.mongo);
        gfs.collection('uploads');
        if (!query) {
            query = {};
        }
        // query.deleted = false;
        const file = await gfs.files.findOne(query);
        if (!file) {
            const error = new Error('File is not found.');
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }
        return file;
    },
    deleteOneBy: async function(query: $TSFixMe) {
        const gfs = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
            bucketName: 'uploads',
        });
        const files = await this.findOneBy(query);
        const id = files && files._id ? files._id : null;
        if (id) {
            const obj_id = new mongoose.Types.ObjectId(id);
            await gfs.delete(obj_id);
            return 'file deleted successfully';
        } else {
            const error = new Error('Id is required.');
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }
    },
};

import mongoose from '../config/db'
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'grid... Remove this comment to see the full error message
import Grid from 'gridfs-stream'
