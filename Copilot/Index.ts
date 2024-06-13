import CodeRepositoryUtil, {
    CodeRepositoryResult,
} from './Utils/CodeRepository';
import InitUtil from './Utils/Init';
import ServiceRepositoryUtil from './Utils/ServiceRepository';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';
import Dictionary from 'Common/Types/Dictionary';
import { PromiseVoidFunction } from 'Common/Types/FunctionTypes';
import CodeRepositoryFile from 'CommonServer/Utils/CodeRepository/CodeRepositoryFile';
import logger from 'CommonServer/Utils/Logger';
import dotenv from 'dotenv';

dotenv.config();

logger.info('OneUptime Copilot is starting...');

const init: PromiseVoidFunction = async (): Promise<void> => {
    const codeRepositoryResult: CodeRepositoryResult = await InitUtil.init();

    for (const serviceRepository of codeRepositoryResult.servicesRepository) {
        const filesInService: Dictionary<CodeRepositoryFile> =
            await ServiceRepositoryUtil.getFilesInServiceDirectory({
                serviceRepository,
            });

        logger.info(
            `Files found in ${serviceRepository.serviceCatalog?.name}: ${
                Object.keys(filesInService).length
            }`
        );

        const branchName: string = 'test-branch-5';

        await CodeRepositoryUtil.createOrCheckoutBranch({
            serviceRepository: serviceRepository,
            branchName: branchName,
        });

        // test code from here.
        const file: CodeRepositoryFile | undefined =
            filesInService[Object.keys(filesInService)[0]!];

        await CodeRepositoryUtil.writeToFile({
            filePath: file!.filePath!,
            content: 'Hello World',
        });

        // commit the changes

        await CodeRepositoryUtil.addFilesToGit({
            filePaths: [file!.filePath!],
        });

        await CodeRepositoryUtil.commitChanges({
            message: 'Test commit',
        });

        await CodeRepositoryUtil.pushChanges({
            branchName: branchName,
            serviceRepository: serviceRepository,
        });

        // create a pull request

        await CodeRepositoryUtil.createPullRequest({
            title: 'Test PR',
            body: 'Test PR body',
            branchName: branchName,
            serviceRepository: serviceRepository,
        });
    }
};

init()
    .then(() => {
        process.exit(0);
    })
    .catch(async (error: Error | HTTPErrorResponse) => {
        try {
            await CodeRepositoryUtil.discardChanges();

            // change back to main branch.
            await CodeRepositoryUtil.checkoutMainBranch();
        } catch (e) {
            // do nothing.
        }

        logger.error('Error in starting OneUptime Copilot: ');

        if (error instanceof HTTPErrorResponse) {
            logger.error(error.message);
        } else if (error instanceof Error) {
            logger.error(error.message);
        } else {
            logger.error(error);
        }

        process.exit(1);
    });
