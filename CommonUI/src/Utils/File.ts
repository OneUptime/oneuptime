import URL from 'Common/Types/API/URL';
import ObjectID from 'Common/Types/ObjectID';
import { FILE_URL } from '../Config';

export default class FileUtil {
    public static getFileURL(fileId: ObjectID): URL {
        return URL.fromString(FILE_URL.toString())
            .addRoute('/image')
            .addRoute(`/${fileId.toString()}`);
    }
}
