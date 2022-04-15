import { spawn } from 'child_process';
import fs from 'fs';
import Path from 'path';
import fetch from 'node-fetch-commonjs';

import { v4 as uuidv4 } from 'uuid';
import ApiService from '../Utils/apiService';

import { serverUrl } from '../Config';

import { deleteFile } from '../Utils/fsHandlers';

export default {
    run: async function ({ monitor }): void {
        if (
            monitor &&
            monitor.type &&
            monitor.type === 'kubernetes' &&
            monitor.kubernetesConfig
        ) {
            const configurationFile: $TSFixMe = monitor.kubernetesConfig;
            const updatedConfigName: string = `${uuidv4()}${configurationFile}`;
            const configPath: $TSFixMe = Path.resolve(
                process.cwd(),
                updatedConfigName
            );
            const namespace: $TSFixMe =
                monitor.kubernetesNamespace || 'default';

            await fetch(`${serverUrl}/file/${configurationFile}`).then(
                (res: $TSFixMe) => {
                    const dest: $TSFixMe = fs.createWriteStream(configPath);

                    res.body.pipe(dest);
                    // at this point, writing to the specified file is complete
                    dest.on('finish', async () => {
                        if (fs.existsSync(configPath)) {
                            const [
                                podOutput,
                                jobOutput,
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

                            if (
                                podOutput &&
                                jobOutput &&
                                deploymentOutput &&
                                statefulsetOutput
                            ) {
                                // handle pod output

                                const healthyPods: $TSFixMe = [],
                                    healthyPodData: $TSFixMe = [],
                                    unhealthyPods: $TSFixMe = [],
                                    unhealthyPodData: $TSFixMe = [],
                                    allPods: $TSFixMe = [],
                                    allPodData: $TSFixMe = [];
                                let runningPods: $TSFixMe = 0,
                                    completedPods: $TSFixMe = 0,
                                    failedPods: $TSFixMe = 0;

                                podOutput.items.forEach((item: $TSFixMe) => {
                                    /**
                                     *  https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.20/#podstatus-v1-core
                                     */
                                    if (
                                        item.status.phase !== 'Running' &&
                                        item.status.phase !== 'Succeeded'
                                    ) {
                                        unhealthyPods.push({
                                            podName: item.metadata.name,
                                            podNamespace:
                                                item.metadata.namespace,
                                            podStatus: item.status.phase,
                                            podCreationTimestamp:
                                                item.metadata.creationTimestamp,
                                            podRestart:
                                                item.status &&
                                                item.status.containerStatuses &&
                                                item.status.containerStatuses[0]
                                                    ? item.status
                                                          .containerStatuses[0]
                                                          .restartCount
                                                    : 0,
                                            podResourceVersion:
                                                item.metadata.resourceVersion,
                                            podUid: item.metadata.uid,
                                            podSelfLink: item.metadata.selfLink,
                                            podConditions:
                                                item.status.conditions,
                                            podContainerStatuses:
                                                item.status.containerStatuses,
                                            podContainers: item.spec.containers,
                                        });
                                        unhealthyPodData.push({
                                            podName: item.metadata.name,
                                            podNamespace:
                                                item.metadata.namespace,
                                            podStatus: item.status.phase,
                                            podCreationTimestamp:
                                                item.metadata.creationTimestamp,
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
                                            podNamespace:
                                                item.metadata.namespace,
                                            podStatus: item.status.phase,
                                            podCreationTimestamp:
                                                item.metadata.creationTimestamp,
                                            podRestart:
                                                item.status &&
                                                item.status.containerStatuses &&
                                                item.status.containerStatuses[0]
                                                    ? item.status
                                                          .containerStatuses[0]
                                                          .restartCount
                                                    : 0,
                                            podResourceVersion:
                                                item.metadata.resourceVersion,
                                            podUid: item.metadata.uid,
                                            podSelfLink: item.metadata.selfLink,
                                            podConditions:
                                                item.status.conditions,
                                            podContainerStatuses:
                                                item.status.containerStatuses,
                                            podContainers: item.spec.containers,
                                        });
                                        healthyPodData.push({
                                            podName: item.metadata.name,
                                            podNamespace:
                                                item.metadata.namespace,
                                            podStatus: item.status.phase,
                                            podCreationTimestamp:
                                                item.metadata.creationTimestamp,
                                            podRestart:
                                                item.status &&
                                                item.status.containerStatuses &&
                                                item.status.containerStatuses[0]
                                                    ? item.status
                                                          .containerStatuses[0]
                                                          .restartCount
                                                    : 0,
                                        });
                                        if (item.status.phase === 'Running') {
                                            ++runningPods;
                                        }
                                        if (item.status.phase === 'Succeeded') {
                                            ++completedPods;
                                        }
                                    }

                                    allPods.push({
                                        podName: item.metadata.name,
                                        podNamespace: item.metadata.namespace,
                                        podStatus: item.status.phase,
                                        podCreationTimestamp:
                                            item.metadata.creationTimestamp,
                                        podRestart:
                                            item.status &&
                                            item.status.containerStatuses &&
                                            item.status.containerStatuses[0]
                                                ? item.status
                                                      .containerStatuses[0]
                                                      .restartCount
                                                : 0,
                                        podResourceVersion:
                                            item.metadata.resourceVersion,
                                        podUid: item.metadata.uid,
                                        podSelfLink: item.metadata.selfLink,
                                        podConditions: item.status.conditions,
                                        podContainerStatuses:
                                            item.status.containerStatuses,
                                        podContainers: item.spec.containers,
                                    });
                                    allPodData.push({
                                        podName: item.metadata.name,
                                        podNamespace: item.metadata.namespace,
                                        podStatus: item.status.phase,
                                        podCreationTimestamp:
                                            item.metadata.creationTimestamp,
                                        podRestart:
                                            item.status &&
                                            item.status.containerStatuses &&
                                            item.status.containerStatuses[0]
                                                ? item.status
                                                      .containerStatuses[0]
                                                      .restartCount
                                                : 0,
                                    });
                                });
                                const podData: $TSFixMe = {
                                    podStat: {
                                        healthy: healthyPods.length,
                                        unhealthy: unhealthyPods.length,
                                        runningPods,
                                        completedPods,
                                        failedPods,

                                        totalPods: podOutput.items.length,
                                    },

                                    healthyPods,

                                    unhealthyPods,

                                    allPods,

                                    healthyPodData,

                                    unhealthyPodData,

                                    allPodData,
                                };

                                // handle job output

                                const runningJobs: $TSFixMe = [],
                                    succeededJobs: $TSFixMe = [],
                                    failedJobs: $TSFixMe = [],
                                    runningJobData: $TSFixMe = [],
                                    succeededJobData: $TSFixMe = [],
                                    failedJobData: $TSFixMe = [];

                                jobOutput.items.forEach((item: $TSFixMe) => {
                                    /**
                                     * https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.20/#job-v1-batch
                                     */
                                    if (item.status && item.status.active > 0) {
                                        runningJobs.push({
                                            jobName: item.metadata.name,
                                            jobNamespace:
                                                item.metadata.namespace,
                                            jobStatus: 'running',
                                            jobCreationTimestamp:
                                                item.metadata.creationTimestamp,
                                            jobResourceVersion:
                                                item.metadata.resourceVersion,
                                            jobUid: item.metadata.uid,
                                            jobSelfLink: item.metadata.selfLink,
                                            jobConditions:
                                                item.status.conditions,
                                        });
                                        runningJobData.push({
                                            jobName: item.metadata.name,
                                            jobNamespace:
                                                item.metadata.namespace,
                                            jobStatus: 'running',
                                            jobCreationTimestamp:
                                                item.metadata.creationTimestamp,
                                        });
                                    } else if (
                                        item.status &&
                                        item.status.succeeded > 0
                                    ) {
                                        succeededJobs.push({
                                            jobName: item.metadata.name,
                                            jobNamespace:
                                                item.metadata.namespace,
                                            jobStatus: 'succeeded',
                                            jobCreationTimestamp:
                                                item.metadata.creationTimestamp,
                                            jobResourceVersion:
                                                item.metadata.resourceVersion,
                                            jobUid: item.metadata.uid,
                                            jobSelfLink: item.metadata.selfLink,
                                            jobConditions:
                                                item.status.conditions,
                                        });
                                        succeededJobData.push({
                                            jobName: item.metadata.name,
                                            jobNamespace:
                                                item.metadata.namespace,
                                            jobStatus: 'succeeded',
                                            jobCreationTimestamp:
                                                item.metadata.creationTimestamp,
                                        });
                                    } else if (
                                        item.status &&
                                        item.status.failed > 0
                                    ) {
                                        failedJobs.push({
                                            jobName: item.metadata.name,
                                            jobNamespace:
                                                item.metadata.namespace,
                                            jobStatus: 'failed',
                                            jobCreationTimestamp:
                                                item.metadata.creationTimestamp,
                                            jobResourceVersion:
                                                item.metadata.resourceVersion,
                                            jobUid: item.metadata.uid,
                                            jobSelfLink: item.metadata.selfLink,
                                            jobConditions:
                                                item.status.conditions,
                                        });
                                        failedJobData.push({
                                            jobName: item.metadata.name,
                                            jobNamespace:
                                                item.metadata.namespace,
                                            jobStatus: 'failed',
                                            jobCreationTimestamp:
                                                item.metadata.creationTimestamp,
                                        });
                                    } else {
                                        failedJobs.push({
                                            jobName: item.metadata.name,
                                            jobNamespace:
                                                item.metadata.namespace,
                                            jobStatus: 'failed',
                                            jobCreationTimestamp:
                                                item.metadata.creationTimestamp,
                                            jobResourceVersion:
                                                item.metadata.resourceVersion,
                                            jobUid: item.metadata.uid,
                                            jobSelfLink: item.metadata.selfLink,
                                            jobConditions:
                                                item.status.conditions,
                                        });
                                        failedJobData.push({
                                            jobName: item.metadata.name,
                                            jobNamespace:
                                                item.metadata.namespace,
                                            jobStatus: 'failed',
                                            jobCreationTimestamp:
                                                item.metadata.creationTimestamp,
                                        });
                                    }
                                });
                                const jobData: $TSFixMe = {
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
                                    allJobData: [
                                        ...runningJobData,

                                        ...succeededJobData,

                                        ...failedJobData,
                                    ],
                                    healthyJobs: [
                                        ...runningJobs,
                                        ...succeededJobs,
                                    ],
                                    healthyJobData: [
                                        ...runningJobData,

                                        ...succeededJobData,
                                    ],

                                    unhealthyJobs: [...failedJobs],

                                    unhealthyJobData: [...failedJobData],
                                };

                                // handle services output
                                const serviceData: $TSFixMe = {
                                    runningServices: serviceOutput.items.length,
                                };

                                // handle deployment output
                                let desiredDeployment: $TSFixMe = 0,
                                    readyDeployment: $TSFixMe = 0;

                                const unhealthyDeployments: $TSFixMe = [],
                                    healthyDeployments: $TSFixMe = [],
                                    allDeployments: $TSFixMe = [],
                                    unhealthyDeploymentData: $TSFixMe = [],
                                    healthyDeploymentData: $TSFixMe = [],
                                    allDeploymentData: $TSFixMe = [];

                                deploymentOutput.items.forEach(
                                    (item: $TSFixMe) => {
                                        if (item.status.readyReplicas) {
                                            readyDeployment +=
                                                item.status.readyReplicas;
                                        } else {
                                            readyDeployment += 0;
                                        }
                                        desiredDeployment +=
                                            item.status.replicas;

                                        if (
                                            item.status.readyReplicas !==
                                            item.status.replicas
                                        ) {
                                            unhealthyDeployments.push({
                                                deploymentName:
                                                    item.metadata.name,
                                                deploymentNamespace:
                                                    item.metadata.namespace,
                                                deploymentCreationTimestamp:
                                                    item.metadata
                                                        .creationTimestamp,
                                                readyDeployment:
                                                    item.status.readyReplicas ||
                                                    0,
                                                desiredDeployment:
                                                    item.status.replicas,
                                                deploymentResourceVersion:
                                                    item.metadata
                                                        .resourceVersion,
                                                deploymentUid:
                                                    item.metadata.uid,
                                                deploymentSelfLink:
                                                    item.metadata.selfLink,
                                                deploymentConditions:
                                                    item.status.conditions,
                                            });
                                            unhealthyDeploymentData.push({
                                                deploymentName:
                                                    item.metadata.name,
                                                deploymentNamespace:
                                                    item.metadata.namespace,
                                                deploymentCreationTimestamp:
                                                    item.metadata
                                                        .creationTimestamp,
                                                readyDeployment:
                                                    item.status.readyReplicas ||
                                                    0,
                                                desiredDeployment:
                                                    item.status.replicas,
                                            });
                                        } else {
                                            healthyDeployments.push({
                                                deploymentName:
                                                    item.metadata.name,
                                                deploymentNamespace:
                                                    item.metadata.namespace,
                                                deploymentCreationTimestamp:
                                                    item.metadata
                                                        .creationTimestamp,
                                                readyDeployment:
                                                    item.status.readyReplicas,
                                                desiredDeployment:
                                                    item.status.replicas,
                                                deploymentResourceVersion:
                                                    item.metadata
                                                        .resourceVersion,
                                                deploymentUid:
                                                    item.metadata.uid,
                                                deploymentSelfLink:
                                                    item.metadata.selfLink,
                                                deploymentConditions:
                                                    item.status.conditions,
                                            });
                                            healthyDeploymentData.push({
                                                deploymentName:
                                                    item.metadata.name,
                                                deploymentNamespace:
                                                    item.metadata.namespace,
                                                deploymentCreationTimestamp:
                                                    item.metadata
                                                        .creationTimestamp,
                                                readyDeployment:
                                                    item.status.readyReplicas,
                                                desiredDeployment:
                                                    item.status.replicas,
                                            });
                                        }

                                        allDeployments.push({
                                            deploymentName: item.metadata.name,
                                            deploymentNamespace:
                                                item.metadata.namespace,
                                            deploymentCreationTimestamp:
                                                item.metadata.creationTimestamp,
                                            readyDeployment:
                                                item.status.readyReplicas || 0,
                                            desiredDeployment:
                                                item.status.replicas,
                                            deploymentResourceVersion:
                                                item.metadata.resourceVersion,
                                            deploymentUid: item.metadata.uid,
                                            deploymentSelfLink:
                                                item.metadata.selfLink,
                                            deploymentConditions:
                                                item.status.conditions,
                                        });
                                        allDeploymentData.push({
                                            deploymentName: item.metadata.name,
                                            deploymentNamespace:
                                                item.metadata.namespace,
                                            deploymentCreationTimestamp:
                                                item.metadata.creationTimestamp,
                                            readyDeployment:
                                                item.status.readyReplicas || 0,
                                            desiredDeployment:
                                                item.status.replicas,
                                        });
                                    }
                                );
                                const deploymentData: $TSFixMe = {
                                    desiredDeployment,
                                    readyDeployment,

                                    healthyDeployments,

                                    unhealthyDeployments,

                                    allDeployments,
                                    healthy: healthyDeployments.length,
                                    unhealthy: unhealthyDeployments.length,

                                    healthyDeploymentData,

                                    unhealthyDeploymentData,

                                    allDeploymentData,
                                };

                                // handle statefulset output
                                let desiredStatefulsets: $TSFixMe = 0,
                                    readyStatefulsets = 0;

                                const healthyStatefulsets: $TSFixMe = [],
                                    unhealthyStatefulsets = [],
                                    allStatefulset = [],
                                    healthyStatefulsetData = [],
                                    unhealthyStatefulsetData = [],
                                    allStatefulsetData = [];

                                statefulsetOutput.items.forEach(
                                    (item: $TSFixMe) => {
                                        if (item.status.readyReplicas) {
                                            readyStatefulsets +=
                                                item.status.readyReplicas;
                                        } else {
                                            readyStatefulsets += 0;
                                        }
                                        desiredStatefulsets +=
                                            item.status.replicas;

                                        if (
                                            item.status.readyReplicas !==
                                            item.status.replicas
                                        ) {
                                            unhealthyStatefulsets.push({
                                                statefulsetName:
                                                    item.metadata.name,
                                                statefulsetNamespace:
                                                    item.metadata.namespace,
                                                statefulsetCreationTimestamp:
                                                    item.metadata
                                                        .creationTimestamp,
                                                readyStatefulsets:
                                                    item.status.readyReplicas ||
                                                    0,
                                                desiredStatefulsets:
                                                    item.status.replicas,
                                                statefulsetResourceVersion:
                                                    item.metadata
                                                        .resourceVersion,
                                                statefulsetUid:
                                                    item.metadata.uid,
                                                statefulsetSelfLink:
                                                    item.metadata.selfLink,
                                            });
                                            unhealthyStatefulsetData.push({
                                                statefulsetName:
                                                    item.metadata.name,
                                                statefulsetNamespace:
                                                    item.metadata.namespace,
                                                statefulsetCreationTimestamp:
                                                    item.metadata
                                                        .creationTimestamp,
                                                readyStatefulsets:
                                                    item.status.readyReplicas ||
                                                    0,
                                                desiredStatefulsets:
                                                    item.status.replicas,
                                            });
                                        } else {
                                            healthyStatefulsets.push({
                                                statefulsetName:
                                                    item.metadata.name,
                                                statefulsetNamespace:
                                                    item.metadata.namespace,
                                                statefulsetCreationTimestamp:
                                                    item.metadata
                                                        .creationTimestamp,
                                                readyStatefulsets:
                                                    item.status.readyReplicas,
                                                desiredStatefulsets:
                                                    item.status.replicas,
                                                statefulsetResourceVersion:
                                                    item.metadata
                                                        .resourceVersion,
                                                statefulsetUid:
                                                    item.metadata.uid,
                                                statefulsetSelfLink:
                                                    item.metadata.selfLink,
                                            });
                                            healthyStatefulsetData.push({
                                                statefulsetName:
                                                    item.metadata.name,
                                                statefulsetNamespace:
                                                    item.metadata.namespace,
                                                statefulsetCreationTimestamp:
                                                    item.metadata
                                                        .creationTimestamp,
                                                readyStatefulsets:
                                                    item.status.readyReplicas,
                                                desiredStatefulsets:
                                                    item.status.replicas,
                                            });
                                        }

                                        allStatefulset.push({
                                            statefulsetName: item.metadata.name,
                                            statefulsetNamespace:
                                                item.metadata.namespace,
                                            statefulsetCreationTimestamp:
                                                item.metadata.creationTimestamp,
                                            readyStatefulsets:
                                                item.status.readyReplicas || 0,
                                            desiredStatefulsets:
                                                item.status.replicas,
                                            statefulsetResourceVersion:
                                                item.metadata.resourceVersion,
                                            statefulsetUid: item.metadata.uid,
                                            statefulsetSelfLink:
                                                item.metadata.selfLink,
                                        });
                                        allStatefulsetData.push({
                                            statefulsetName: item.metadata.name,
                                            statefulsetNamespace:
                                                item.metadata.namespace,
                                            statefulsetCreationTimestamp:
                                                item.metadata.creationTimestamp,
                                            readyStatefulsets:
                                                item.status.readyReplicas || 0,
                                            desiredStatefulsets:
                                                item.status.replicas,
                                        });
                                    }
                                );
                                const statefulsetData: $TSFixMe = {
                                    readyStatefulsets,
                                    desiredStatefulsets,

                                    healthyStatefulsets,

                                    unhealthyStatefulsets,

                                    allStatefulset,
                                    healthy: healthyStatefulsets.length,
                                    unhealthy: unhealthyStatefulsets.length,

                                    healthyStatefulsetData,

                                    unhealthyStatefulsetData,

                                    allStatefulsetData,
                                };

                                const data: $TSFixMe = {
                                    podData,
                                    jobData,
                                    serviceData,
                                    deploymentData,
                                    statefulsetData,
                                };

                                await ApiService.ping(monitor._id, {
                                    monitor,
                                    kubernetesData: data,
                                    type: monitor.type,
                                });

                                // remove the config file
                                await deleteFile(configPath);
                            }
                        }

                        // remove the config file
                        await deleteFile(configPath);
                    });

                    dest.on('error', async (error: Error) => {
                        await deleteFile(configPath);
                        throw error;
                    });
                }
            );
        }
    },
};

function loadPodOutput(configPath, namespace): void {
    return new Promise((resolve: $TSFixMe) => {
        let podOutput: $TSFixMe = '';
        const podCommand: string = `kubectl get pods -o json --kubeconfig ${configPath} --namespace ${namespace}`;

        const podCommandOutput: $TSFixMe = spawn(podCommand, {
            cwd: process.cwd(),
            shell: true,
        });
        podCommandOutput.stdout.on('data', (data: $TSFixMe) => {
            const strData: $TSFixMe = data.toString();
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

function loadJobOutput(configPath, namespace): void {
    return new Promise((resolve: $TSFixMe) => {
        let jobOutput: $TSFixMe = '';
        const jobCommand: string = `kubectl get jobs -o json --kubeconfig ${configPath} --namespace ${namespace}`;

        const jobCommandOutput: $TSFixMe = spawn(jobCommand, {
            cwd: process.cwd(),
            shell: true,
        });
        jobCommandOutput.stdout.on('data', (data: $TSFixMe) => {
            const strData: $TSFixMe = data.toString();
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

function loadServiceOutput(configPath, namespace): void {
    return new Promise((resolve: $TSFixMe) => {
        let serviceOutput: $TSFixMe = '';
        const serviceCommand: string = `kubectl get services -o json --kubeconfig ${configPath} --namespace ${namespace}`;

        const serviceCommandOutput: $TSFixMe = spawn(serviceCommand, {
            cwd: process.cwd(),
            shell: true,
        });
        serviceCommandOutput.stdout.on('data', (data: $TSFixMe) => {
            const strData: $TSFixMe = data.toString();
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

function loadDeploymentOutput(configPath, namespace): void {
    return new Promise((resolve: $TSFixMe) => {
        let deploymentOutput: $TSFixMe = '';
        const deploymentCommand: string = `kubectl get deployments -o json --kubeconfig ${configPath} --namespace ${namespace}`;

        const deploymentCommandOutput: $TSFixMe = spawn(deploymentCommand, {
            cwd: process.cwd(),
            shell: true,
        });
        deploymentCommandOutput.stdout.on('data', (data: $TSFixMe) => {
            const strData: $TSFixMe = data.toString();
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

function loadStatefulsetOutput(configPath, namespace): void {
    return new Promise((resolve: $TSFixMe) => {
        let statefulsetOutput: $TSFixMe = '';
        const statefulsetCommand: string = `kubectl get statefulsets -o json --kubeconfig ${configPath} --namespace ${namespace}`;

        const statefulsetCommandOutput: $TSFixMe = spawn(statefulsetCommand, {
            cwd: process.cwd(),
            shell: true,
        });
        statefulsetCommandOutput.stdout.on('data', (data: $TSFixMe) => {
            const strData: $TSFixMe = data.toString();
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
