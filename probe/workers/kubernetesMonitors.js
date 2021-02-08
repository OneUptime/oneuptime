const { spawn } = require('child_process');
const fs = require('fs');
const Path = require('path');
const fetch = require('node-fetch');
const ApiService = require('../utils/apiService');
const ErrorService = require('../utils/errorService');
const { serverUrl } = require('../utils/config');
const { deleteFile } = require('../utils/fsHandlers');

module.exports = {
    run: async function(monitor) {
        try {
            if (
                monitor &&
                monitor.type &&
                monitor.type === 'kubernetes' &&
                monitor.kubernetesConfig
            ) {
                const configurationFile = monitor.kubernetesConfig;
                const configPath = Path.resolve(
                    process.cwd(),
                    configurationFile
                );
                const namespace = monitor.kubernetesNamespace || 'default';

                let podOutput = '';
                await fetch(`${serverUrl}/file/${configurationFile}`).then(
                    res =>
                        new Promise((resolve, reject) => {
                            const dest = fs.createWriteStream(configPath);
                            res.body.pipe(dest);
                            // writing of the file content to the new destination is done
                            res.body.on('end', () => {
                                const scanCommand = `kubectl get pods -o json --kubeconfig ${configPath} --namespace ${namespace}`;
                                const output = spawn(scanCommand, {
                                    cwd: process.cwd(),
                                    shell: true,
                                });

                                output.on('error', async error => {
                                    await deleteFile(configPath);

                                    const errorMessage =
                                        'Scanning failed please check your kubernetes config';
                                    error.code = 400;
                                    error.message = errorMessage;
                                    reject(error);
                                });

                                output.stdout.on('data', data => {
                                    const strData = data.toString();
                                    podOutput += strData;
                                });

                                output.on('close', async () => {
                                    if (podOutput) {
                                        podOutput = JSON.parse(podOutput);
                                    }
                                    await deleteFile(configPath);
                                    resolve(podOutput);
                                });
                            });
                            dest.on('error', reject);
                        })
                );

                podOutput = podOutput.items.map(item => ({
                    podName: item.metadata.name,
                    podNamespace: item.metadata.namespace,
                    podStatus: item.status.phase,
                    podRestart: item.status.containerStatuses[0].restartCount,
                    podReady: item.status.containerStatuses[0].ready,
                }));

                /**
                 *  https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.20/#podstatus-v1-core
                 *  Pod Status can be:
                 *      - Pending
                 *      - Running
                 *      - Succeeded
                 *      - Failed
                 */
                // For now, let's only consider the case when the monitor is not running
                const podsWithError = [];
                podOutput.forEach(pod => {
                    if (
                        pod.podStatus !== 'Running' &&
                        pod.podStatus !== 'Pending' &&
                        pod.podStatus !== 'Succeeded'
                    ) {
                        // at this point it is considered that there's error/issue with the pod
                        podsWithError.push(pod);
                    }
                });

                const podResult = { podOutput, podsWithError };
                await ApiService.ping(monitor._id, {
                    monitor,
                    podResult,
                    type: monitor.type,
                });
            }
        } catch (error) {
            ErrorService.log('kubernetesMonitors.run', error);
            throw error;
        }
    },
};
