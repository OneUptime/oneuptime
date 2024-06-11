import Execute from '../Execute';
import CodeRepositoryFile from './CodeRepositoryFile';

export default class CodeRepositoryUtil {
    public static async getGitCommitHashForFile(data: {
        repoPath: string, 
        filePath: string
    }
    ): Promise<string> {

        const { repoPath, filePath } = data;

        return await Execute.executeCommand(
            `cd ${repoPath} && git log -1 --pretty=format:"%H" "${filePath}"`
        );
    }

    public static async getFilesInDirectory(data: {
        directoryPath: string,
        repoPath: string
    }): Promise<{
        files: Array<CodeRepositoryFile>;
        subDirectories: Array<string>;
    }> {

        const { directoryPath, repoPath } = data;

        const files: Array<CodeRepositoryFile> = [];
        const output: string = await Execute.executeCommand(
            `ls ${directoryPath}`
        );

        const fileNames: Array<string> = output.split('\n');

        const subDirectories: Array<string> = [];

        for (const fileName of fileNames) {
            if (fileName === '') {
                continue;
            }

            const isDirectory: boolean = (
                await Execute.executeCommand(
                    `file ${directoryPath}/${fileName}`
                )
            ).includes('directory');

            if (isDirectory) {
                subDirectories.push(`${directoryPath}/${fileName}`);
                continue;
            }

            const filePath: string = `${directoryPath}/${fileName}`;
            const gitCommitHash: string = await this.getGitCommitHashForFile({
                filePath,
                repoPath 
        });
            const fileExtension: string = fileName.split('.').pop() || '';
            files.push({
                filePath,
                gitCommitHash,
                fileExtension,
                fileName,
            });
        }

        return {
            files,
            subDirectories: subDirectories,
        };
    }

    public static async getFilesInDirectoryRecursive(data: {
        repoPath: string,
        directoryPath: string
    }): Promise<Array<CodeRepositoryFile>> {
        const files: Array<CodeRepositoryFile> = [];

        const { files: filesInDirectory, subDirectories } =
            await this.getFilesInDirectory({
                directoryPath: data.directoryPath,
                repoPath: data.repoPath
            });
        files.push(...filesInDirectory);

        for (const subDirectory of subDirectories) {
            files.push(
                ...(await this.getFilesInDirectoryRecursive({
                    repoPath: data.repoPath,
                    directoryPath: subDirectory
                }))
            );
        }

        return files;
    }
}
