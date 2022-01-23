
module.exports = {
    findOneBy: async function(query) {
        const gfs = await Grid(mongoose.connection.db, mongoose.mongo);
        gfs.collection('uploads');
        if (!query) {
            query = {};
        }
        // query.deleted = false;
        const file = await gfs.files.findOne(query);
        if (!file) {
            const error = new Error('File is not found.');
            error.code = 400;
            throw error;
        }
        return file;
    },
    deleteOneBy: async function(query) {
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
            error.code = 400;
            throw error;
        }
    },
};

const mongoose = require('../config/db');
const Grid = require('gridfs-stream');
