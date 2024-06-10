import { PromiseRejectErrorFunction } from 'Common/Types/FunctionTypes';
import { ExecException, exec } from 'node:child_process';

export default class Exec {
    public static exec(command: string): Promise<void> {
        return new Promise(
            (resolve: VoidFunction, reject: PromiseRejectErrorFunction) => {
                exec(`${command}`, (err: ExecException | null) => {
                    if (err) {
                        return reject(err);
                    }

                    return resolve();
                });
            }
        );
    }
}
