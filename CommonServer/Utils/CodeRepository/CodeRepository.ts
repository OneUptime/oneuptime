import Execute from '../Execute';
import LocalFile from '../LocalFile';
import CodeRepositoryFile from './CodeRepositoryFile';
import Dictionary from 'Common/Types/Dictionary';

export default class CodeRepositoryUtil {
    public static async getGitCommitHashForFile(data: {
        repoPath: string;
        filePath: string;
    }): Promise<string> {
        if (!data.filePath.startsWith('/')) {
            data.filePath = '/' + data.filePath;
        }

        if (!data.repoPath.startsWith('/')) {
            data.repoPath = '/' + data.repoPath;
        }

        const { repoPath, filePath } = data;

        return await Execute.executeCommand(
            `cd ${repoPath} && git log -1 --pretty=format:"%H" ".${filePath}"`
        );
    }

    public static async getFilesInDirectory(data: {
        directoryPath: string;
        repoPath: string;
    }): Promise<{
        files: Dictionary<CodeRepositoryFile>;
        subDirectories: Array<string>;
    }> {
        if (!data.directoryPath.startsWith('/')) {
            data.directoryPath = '/' + data.directoryPath;
        }

        if (!data.repoPath.startsWith('/')) {
            data.repoPath = '/' + data.repoPath;
        }

        const { directoryPath, repoPath } = data;

        let totalPath: string = `${repoPath}/${directoryPath}`;

        totalPath = LocalFile.sanitizeFilePath(totalPath); // clean up the path

        const files: Dictionary<CodeRepositoryFile> = {};
        const output: string = await Execute.executeCommand(`ls ${totalPath}`);

        const fileNames: Array<string> = output.split('\n');

        const subDirectories: Array<string> = [];

        for (const fileName of fileNames) {
            if (fileName === '') {
                continue;
            }

            const filePath: string = LocalFile.sanitizeFilePath(
                `${directoryPath}/${fileName}`
            );

            const isDirectory: boolean = (
                await Execute.executeCommand(
                    `file "${LocalFile.sanitizeFilePath(
                        `${totalPath}/${fileName}`
                    )}"`
                )
            ).includes('directory');

            if (isDirectory) {
                subDirectories.push(
                    LocalFile.sanitizeFilePath(`${directoryPath}/${fileName}`)
                );
                continue;
            }

            const gitCommitHash: string = await this.getGitCommitHashForFile({
                filePath,
                repoPath,
            });

            const fileExtension: string = fileName.split('.').pop() || '';
            files[filePath] = {
                filePath: LocalFile.sanitizeFilePath(
                    `${directoryPath}/${fileName}`
                ),
                gitCommitHash,
                fileExtension,
                fileName,
            };
        }

        return {
            files,
            subDirectories: subDirectories,
        };
    }

    public static async getFilesInDirectoryRecursive(data: {
        repoPath: string;
        directoryPath: string;
    }): Promise<Dictionary<CodeRepositoryFile>> {
        let files: Dictionary<CodeRepositoryFile> = {};

        const { files: filesInDirectory, subDirectories } =
            await this.getFilesInDirectory({
                directoryPath: data.directoryPath,
                repoPath: data.repoPath,
            });

        files = {
            ...files,
            ...filesInDirectory,
        };

        for (const subDirectory of subDirectories) {
            files = {
                ...files,
                ...(await this.getFilesInDirectoryRecursive({
                    repoPath: data.repoPath,
                    directoryPath: subDirectory,
                })),
            };
        }

        return files;
    }
}
