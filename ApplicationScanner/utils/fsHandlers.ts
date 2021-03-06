import fs from 'fs';
import Path from 'path';
import { promisify } from 'util';
const readdir: $TSFixMe = promisify(fs.readdir);
const rmdir: $TSFixMe = promisify(fs.rmdir);
const unlink: $TSFixMe = promisify(fs.unlink);

/**
 * @description a promise based utility to read content of a file
 * @param {string} filePath path to file
 */
function readFileContent(filePath: $TSFixMe): void {
    return new Promise((resolve: Function, reject: Function) => {
        if (fs.existsSync(filePath)) {
            fs.readFile(
                filePath,
                { encoding: 'utf8' },
                (error: $TSFixMe, data: $TSFixMe): void => {
                    if (error) {
                        reject(error);
                    }
                    resolve(data);
                }
            );
        }
    });
}

/**
 * @description an asynchronous function to handle deleting a file
 * @param {string} file path to file
 */
async function deleteFile(file: $TSFixMe): void {
    if (fs.existsSync(file)) {
        await unlink(file);
    }
}

/**
 * @description a promise based utility to handle deleting a folder and it's content
 * @param {string} dir directory with or without file
 */
async function deleteFolderRecursive(dir: $TSFixMe): void {
    if (fs.existsSync(dir)) {
        const entries: $TSFixMe = await readdir(dir, { withFileTypes: true });
        await Promise.all(
            entries.map((entry: $TSFixMe) => {
                const fullPath: $TSFixMe = Path.join(dir, entry.name);
                return entry.isDirectory()
                    ? deleteFolderRecursive(fullPath)
                    : unlink(fullPath);
            })
        );
        await rmdir(dir); // Finally remove now empty directory
    }
}

export default {
    readFileContent,
    deleteFile,
    deleteFolderRecursive,
};
