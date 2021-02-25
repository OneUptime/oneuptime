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

                await fetch(`${serverUrl}/file/${configurationFile}`).then(
                    res => {
                        const dest = fs.createWriteStream(configPath);
                        res.body.pipe(dest);
                        // at this point, writing to the specified file is complete
                        res.body.on('end', async () => {
                            const [
                                podOutput,
                                jobOutput,
                                // eslint-disable-next-line no-unused-vars
                                serviceOutput,
                                deploymentOutput,
                                statefulsetOutput,
                            ] = await Promise.all([
                                loadPodOutput(configPath, namespace),
                                loadJobOutput(configPath, namespace),
                                loadServiceOutput(configPath, namespace),
                                loadDeploymentOutput(configPath, namespace),
                                loadStatefulsetOutput(configPath, namespace),
                            ]);

                            // remove the config file
                            await deleteFile(configPath);

                            if (
                                podOutput &&
                                jobOutput &&
                                // serviceOutput &&
                                deploymentOutput &&
                                statefulsetOutput
                            ) {
                                // handle pod output
                                const healthyPods = [],
                                    unhealthyPods = [];
                                let pendingPods = 0,
                                    runningPods = 0,
                                    completedPods = 0,
                                    failedPods = 0;
                                podOutput.items.forEach(item => {
                                    /**
                                     *  https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.20/#podstatus-v1-core
                                     */
                                    if (
                                        item.status.phase !== 'Running' &&
                                        item.status.phase !== 'Pending' &&
                                        item.status.phase !== 'Succeeded'
                                    ) {
                                        unhealthyPods.push({
                                            podName: item.metadata.name,
                                            podStatus: item.status.phase,
                                            podRestart:
                                                item.status &&
                                                item.status.containerStatuses &&
                                                item.status.containerStatuses[0]
                                                    ? item.status
                                                          .containerStatuses[0]
                                                          .restartCount
                                                    : 0,
                                        });
                                        failedPods += 1;
                                    } else {
                                        healthyPods.push({
                                            podName: item.metadata.name,
                                            podStatus: item.status.phase,
                                            podRestart:
                                                item.status &&
                                                item.status.containerStatuses &&
                                                item.status.containerStatuses[0]
                                                    ? item.status
                                                          .containerStatuses[0]
                                                          .restartCount
                                                    : 0,
                                        });
                                        if (item.status.phase === 'Pending')
                                            ++pendingPods;
                                        if (item.status.phase === 'Running')
                                            ++runningPods;
                                        if (item.status.phase === 'Succeeded')
                                            ++completedPods;
                                    }
                                });
                                const podData = {
                                    podStat: {
                                        healthy: healthyPods.length,
                                        unhealthy: unhealthyPods.length,
                                        pendingPods,
                                        runningPods,
                                        completedPods,
                                        failedPods,
                                        totalPods: podOutput.items.length,
                                    },
                                    healthyPods,
                                    unhealthyPods,
                                    allPods: [...healthyPods, ...unhealthyPods],
                                };

                                // handle job output
                                const runningJobs = [],
                                    succeededJobs = [],
                                    failedJobs = [];
                                jobOutput.items.forEach(item => {
                                    /**
                                     * https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.20/#job-v1-batch
                                     */
                                    if (item.status && item.status.active > 0) {
                                        runningJobs.push({
                                            jobName: item.metadata.name,
                                            jobStatus: 'running',
                                        });
                                    } else if (
                                        item.status &&
                                        item.status.succeeded > 0
                                    ) {
                                        succeededJobs.push({
                                            jobName: item.metadata.name,
                                            jobStatus: 'succeeded',
                                        });
                                    } else if (
                                        item.status &&
                                        item.status.failed > 0
                                    ) {
                                        failedJobs.push({
                                            jobName: item.metadata.name,
                                            jobStatus: 'failed',
                                        });
                                    } else {
                                        failedJobs.push({
                                            jobName: item.metadata.name,
                                            jobStatus: 'failed',
                                        });
                                    }
                                });
                                const jobData = {
                                    jobStat: {
                                        runningJobs: runningJobs.length,
                                        succeededJobs: succeededJobs.length,
                                        failedJobs: failedJobs.length,
                                        totalJobs:
                                            runningJobs.length +
                                            succeededJobs.length +
                                            failedJobs.length,
                                        healthy:
                                            runningJobs.length +
                                            succeededJobs.length,
                                        unhealthy: failedJobs.length,
                                    },
                                    runningJobs,
                                    succeededJobs,
                                    failedJobs,
                                    allJobs: [
                                        ...runningJobs,
                                        ...succeededJobs,
                                        ...failedJobs,
                                    ],
                                };

                                // handle services output
                                // const serviceData = {
                                //     runningServices: serviceOutput.items.length,
                                // };

                                // handle deployment output
                                let desiredDeployment = 0,
                                    readyDeployment = 0;
                                const unhealthyDeployments = [],
                                    healthyDeployments = [],
                                    allDeployments = [];
                                deploymentOutput.items.forEach(item => {
                                    if (item.status.readyReplicas) {
                                        readyDeployment +=
                                            item.status.readyReplicas;
                                    } else {
                                        readyDeployment += 0;
                                    }
                                    desiredDeployment += item.status.replicas;

                                    if (
                                        item.status.readyReplicas !==
                                        item.status.replicas
                                    ) {
                                        unhealthyDeployments.push({
                                            deploymentName: item.metadata.name,
                                            readyDeployment:
                                                item.status.readyReplicas || 0,
                                            desiredDeployment:
                                                item.status.replicas,
                                        });
                                    } else {
                                        healthyDeployments.push({
                                            deploymentName: item.metadata.name,
                                            readyDeployment:
                                                item.status.readyReplicas,
                                            desiredDeployment:
                                                item.status.replicas,
                                        });
                                    }

                                    allDeployments.push({
                                        deploymentName: item.metadata.name,
                                        readyDeployment:
                                            item.status.readyReplicas || 0,
                                        desiredDeployment: item.status.replicas,
                                    });
                                });
                                const deploymentData = {
                                    desiredDeployment,
                                    readyDeployment,
                                    healthyDeployments,
                                    unhealthyDeployments,
                                    allDeployments,
                                    healthy: healthyDeployments.length,
                                    unhealthy: unhealthyDeployments.length,
                                };

                                // handle statefulset output
                                let desiredStatefulsets = 0,
                                    readyStatefulsets = 0;
                                const healthyStatefulsets = [],
                                    unhealthyStatefulsets = [],
                                    allStatefulset = [];
                                statefulsetOutput.items.forEach(item => {
                                    if (item.status.readyReplicas) {
                                        readyStatefulsets +=
                                            item.status.readyReplicas;
                                    } else {
                                        readyStatefulsets += 0;
                                    }
                                    desiredStatefulsets += item.status.replicas;

                                    if (
                                        item.status.readyReplicas !==
                                        item.status.replicas
                                    ) {
                                        unhealthyStatefulsets.push({
                                            statefulsetName: item.metadata.name,
                                            readyStatefulsets:
                                                item.status.readyReplicas || 0,
                                            desiredStatefulsets:
                                                item.status.replicas,
                                        });
                                    } else {
                                        healthyStatefulsets.push({
                                            statefulsetName: item.metadata.name,
                                            readyStatefulsets:
                                                item.status.readyReplicas,
                                            desiredStatefulsets:
                                                item.status.replicas,
                                        });
                                    }

                                    allStatefulset.push({
                                        statefulsetName: item.metadata.name,
                                        readyStatefulsets:
                                            item.status.readyReplicas || 0,
                                        desiredStatefulsets:
                                            item.status.replicas,
                                    });
                                });
                                const statefulsetData = {
                                    readyStatefulsets,
                                    desiredStatefulsets,
                                    healthyStatefulsets,
                                    unhealthyStatefulsets,
                                    allStatefulset,
                                    healthy: healthyStatefulsets.length,
                                    unhealthy: unhealthyStatefulsets.length,
                                };

                                const data = {
                                    podData,
                                    jobData,
                                    // serviceData,
                                    deploymentData,
                                    statefulsetData,
                                };
                                console.log('******* monitor ********', monitor.name);
                                console.log('******* output data *********', JSON.stringify(data, null, 4));
                                await ApiService.ping(monitor._id, {
                                    monitor,
                                    kubernetesData: data,
                                    type: monitor.type,
                                });
                            }
                        });
                        dest.on('error', async error => {
                            await deleteFile(configPath);
                            throw error;
                        });
                    }
                );
            }
        } catch (error) {
            ErrorService.log('kubernetesMonitors.run', error);
            throw error;
        }
    },
};

function loadPodOutput(configPath, namespace) {
    return new Promise(resolve => {
        let podOutput = '';
        const podCommand = `kubectl get pods -o json --kubeconfig ${configPath} --namespace ${namespace}`;

        const podCommandOutput = spawn(podCommand, {
            cwd: process.cwd(),
            shell: true,
        });
        podCommandOutput.stdout.on('data', data => {
            const strData = data.toString();
            podOutput += strData;
        });
        podCommandOutput.on('close', () => {
            if (podOutput) {
                podOutput = JSON.parse(podOutput);
            }

            resolve(podOutput);
        });
    });
}

function loadJobOutput(configPath, namespace) {
    return new Promise(resolve => {
        let jobOutput = '';
        const jobCommand = `kubectl get jobs -o json --kubeconfig ${configPath} --namespace ${namespace}`;

        const jobCommandOutput = spawn(jobCommand, {
            cwd: process.cwd(),
            shell: true,
        });
        jobCommandOutput.stdout.on('data', data => {
            const strData = data.toString();
            jobOutput += strData;
        });
        jobCommandOutput.on('close', () => {
            if (jobOutput) {
                jobOutput = JSON.parse(jobOutput);
            }

            resolve(jobOutput);
        });
    });
}

function loadServiceOutput(configPath, namespace) {
    return new Promise(resolve => {
        let serviceOutput = '';
        const serviceCommand = `kubectl get services -o json --kubeconfig ${configPath} --namespace ${namespace}`;

        const serviceCommandOutput = spawn(serviceCommand, {
            cwd: process.cwd(),
            shell: true,
        });
        serviceCommandOutput.stdout.on('data', data => {
            const strData = data.toString();
            serviceOutput += strData;
        });
        serviceCommandOutput.on('close', () => {
            if (serviceOutput) {
                serviceOutput = JSON.parse(serviceOutput);
            }

            resolve(serviceOutput);
        });
    });
}

function loadDeploymentOutput(configPath, namespace) {
    return new Promise(resolve => {
        let deploymentOutput = '';
        const deploymentCommand = `kubectl get deployments -o json --kubeconfig ${configPath} --namespace ${namespace}`;

        const deploymentCommandOutput = spawn(deploymentCommand, {
            cwd: process.cwd(),
            shell: true,
        });
        deploymentCommandOutput.stdout.on('data', data => {
            const strData = data.toString();
            deploymentOutput += strData;
        });
        deploymentCommandOutput.on('close', () => {
            if (deploymentOutput) {
                deploymentOutput = JSON.parse(deploymentOutput);
            }

            resolve(deploymentOutput);
        });
    });
}

function loadStatefulsetOutput(configPath, namespace) {
    return new Promise(resolve => {
        let statefulsetOutput = '';
        const statefulsetCommand = `kubectl get statefulsets -o json --kubeconfig ${configPath} --namespace ${namespace}`;

        const statefulsetCommandOutput = spawn(statefulsetCommand, {
            cwd: process.cwd(),
            shell: true,
        });
        statefulsetCommandOutput.stdout.on('data', data => {
            const strData = data.toString();
            statefulsetOutput += strData;
        });
        statefulsetCommandOutput.on('close', () => {
            if (statefulsetOutput) {
                statefulsetOutput = JSON.parse(statefulsetOutput);
            }

            resolve(statefulsetOutput);
        });
    });
}
