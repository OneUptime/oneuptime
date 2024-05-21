import ObjectID from 'Common/Types/ObjectID';
import PositiveNumber from 'Common/Types/PositiveNumber';
import logger from 'CommonServer/Utils/Logger';
import ScreenSizeType from 'Common/Types/Monitor/SyntheticMonitors/ScreenSizeType';
import BrowserType from 'Common/Types/Monitor/SyntheticMonitors/BrowserType';
import SyntheticMonitorResponse from 'Common/Types/Monitor/SyntheticMonitors/SyntheticMonitorResponse';
import VMRunner from 'CommonServer/Utils/VM/VMRunner';
import ReturnResult from 'Common/Types/IsolatedVM/ReturnResult';


export interface SyntheticMonitorOptions {
    monitorId?: ObjectID | undefined;
    screenSizeTypes?: Array<ScreenSizeType> | undefined;
    browserType?: Array<BrowserType> | undefined;
    script: string;
}

export default class SyntheticMonitor {
    public static async execute(
        options?: SyntheticMonitorOptions
    ): Promise<SyntheticMonitorResponse | null> {

        if (!options) {
            // this should never happen
            options = {
                script: ''
            };
        }

        logger.info(
            `Running Synthetic Monitor: ${options?.monitorId?.toString()} `
        );

        const scriptResult: SyntheticMonitorResponse = {
            logMessages: [],
            scriptError: undefined,
            result: undefined,
            screenshots: [],
            executionTimeInMS: new PositiveNumber(0),
        }

        try {
            let result: ReturnResult | null = null;

            try {

                let startTime: [number, number] = process.hrtime();

                result = await VMRunner.runCodeInSandbox({
                    code: options.script,
                    options: {
                        timeout: 120000, // 2 minutes
                        args: {},
                        includePlaywrightModule: true
                    },
                });

                const endTime: [number, number] = process.hrtime(startTime);

                const executionTimeInMS: PositiveNumber = new PositiveNumber(
                    (endTime[0] * 1000000000 + endTime[1]) / 1000000
                );


                scriptResult.executionTimeInMS = executionTimeInMS;

                scriptResult.logMessages = result.logMessages;

                scriptResult.screenshots = result.returnValue?.screenshots || [];

                scriptResult.result = result.returnValue.data;

                
            } catch (err) {
                logger.error(err);
                scriptResult.scriptError = (err as Error)?.message || (err as Error).toString();
            }

            return scriptResult;


        } catch (err: unknown) {
            logger.error(err);
            scriptResult.scriptError = (err as Error)?.message || (err as Error).toString();

        }

        return scriptResult;
    }
}
