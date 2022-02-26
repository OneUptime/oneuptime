import { spawn } from 'child_process'
import fs from 'fs'
import Path from 'path'
import fetch from 'node-fetch-commonjs'
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
import { v4: uuidv4 } from 'uuid'
import ApiService from '../utils/apiService'
import ErrorService from '../utils/errorService'
// @ts-expect-error ts-migrate(2614) FIXME: Module '"../utils/config"' has no exported member ... Remove this comment to see the full error message
import { serverUrl } from '../utils/config'
// @ts-expect-error ts-migrate(2614) FIXME: Module '"../utils/fsHandlers"' has no exported mem... Remove this comment to see the full error message
import { deleteFile } from '../utils/fsHandlers'

export default {
    // @ts-expect-error ts-migrate(7031) FIXME: Binding element 'monitor' implicitly has an 'any' ... Remove this comment to see the full error message
    run: async function({ monitor }) {
        try {
            if (
                monitor &&
                monitor.type &&
                monitor.type === 'kubernetes' &&
                monitor.kubernetesConfig
            ) {
                const configurationFile = monitor.kubernetesConfig;
                const updatedConfigName = `${uuidv4()}${configurationFile}`;
                const configPath = Path.resolve(
                    process.cwd(),
                    updatedConfigName
                );
                const namespace = monitor.kubernetesNamespace || 'default';

                await fetch(`${serverUrl}/file/${configurationFile}`).then(
                    res => {
                        const dest = fs.createWriteStream(configPath);
                        // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
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
                                    loadStatefulsetOutput(
                                        configPath,
                                        namespace
                                    ),
                                ]);

                                if (
                                    podOutput &&
                                    jobOutput &&
                                    deploymentOutput &&
                                    statefulsetOutput
                                ) {
                                    // handle pod output
                                    // @ts-expect-error ts-migrate(7034) FIXME: Variable 'healthyPods' implicitly has type 'any[]'... Remove this comment to see the full error message
                                    const healthyPods = [],
                                        // @ts-expect-error ts-migrate(7034) FIXME: Variable 'healthyPodData' implicitly has type 'any... Remove this comment to see the full error message
                                        healthyPodData = [],
                                        // @ts-expect-error ts-migrate(7034) FIXME: Variable 'unhealthyPods' implicitly has type 'any[... Remove this comment to see the full error message
                                        unhealthyPods = [],
                                        // @ts-expect-error ts-migrate(7034) FIXME: Variable 'unhealthyPodData' implicitly has type 'a... Remove this comment to see the full error message
                                        unhealthyPodData = [],
                                        // @ts-expect-error ts-migrate(7034) FIXME: Variable 'allPods' implicitly has type 'any[]' in ... Remove this comment to see the full error message
                                        allPods = [],
                                        // @ts-expect-error ts-migrate(7034) FIXME: Variable 'allPodData' implicitly has type 'any[]' ... Remove this comment to see the full error message
                                        allPodData = [];
                                    let runningPods = 0,
                                        completedPods = 0,
                                        failedPods = 0;
                                    // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                                    podOutput.items.forEach(item => {
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
                                                    item.metadata
                                                        .creationTimestamp,
                                                podRestart:
                                                    item.status &&
                                                    item.status
                                                        .containerStatuses &&
                                                    item.status
                                                        .containerStatuses[0]
                                                        ? item.status
                                                              .containerStatuses[0]
                                                              .restartCount
                                                        : 0,
                                                podResourceVersion:
                                                    item.metadata
                                                        .resourceVersion,
                                                podUid: item.metadata.uid,
                                                podSelfLink:
                                                    item.metadata.selfLink,
                                                podConditions:
                                                    item.status.conditions,
                                                podContainerStatuses:
                                                    item.status
                                                        .containerStatuses,
                                                podContainers:
                                                    item.spec.containers,
                                            });
                                            unhealthyPodData.push({
                                                podName: item.metadata.name,
                                                podNamespace:
                                                    item.metadata.namespace,
                                                podStatus: item.status.phase,
                                                podCreationTimestamp:
                                                    item.metadata
                                                        .creationTimestamp,
                                                podRestart:
                                                    item.status &&
                                                    item.status
                                                        .containerStatuses &&
                                                    item.status
                                                        .containerStatuses[0]
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
                                                    item.metadata
                                                        .creationTimestamp,
                                                podRestart:
                                                    item.status &&
                                                    item.status
                                                        .containerStatuses &&
                                                    item.status
                                                        .containerStatuses[0]
                                                        ? item.status
                                                              .containerStatuses[0]
                                                              .restartCount
                                                        : 0,
                                                podResourceVersion:
                                                    item.metadata
                                                        .resourceVersion,
                                                podUid: item.metadata.uid,
                                                podSelfLink:
                                                    item.metadata.selfLink,
                                                podConditions:
                                                    item.status.conditions,
                                                podContainerStatuses:
                                                    item.status
                                                        .containerStatuses,
                                                podContainers:
                                                    item.spec.containers,
                                            });
                                            healthyPodData.push({
                                                podName: item.metadata.name,
                                                podNamespace:
                                                    item.metadata.namespace,
                                                podStatus: item.status.phase,
                                                podCreationTimestamp:
                                                    item.metadata
                                                        .creationTimestamp,
                                                podRestart:
                                                    item.status &&
                                                    item.status
                                                        .containerStatuses &&
                                                    item.status
                                                        .containerStatuses[0]
                                                        ? item.status
                                                              .containerStatuses[0]
                                                              .restartCount
                                                        : 0,
                                            });
                                            if (item.status.phase === 'Running')
                                                ++runningPods;
                                            if (
                                                item.status.phase ===
                                                'Succeeded'
                                            )
                                                ++completedPods;
                                        }

                                        allPods.push({
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
                                        allPodData.push({
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
                                    });
                                    const podData = {
                                        podStat: {
                                            healthy: healthyPods.length,
                                            unhealthy: unhealthyPods.length,
                                            runningPods,
                                            completedPods,
                                            failedPods,
                                            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                                            totalPods: podOutput.items.length,
                                        },
                                        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'healthyPods' implicitly has an 'any[]' t... Remove this comment to see the full error message
                                        healthyPods,
                                        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'unhealthyPods' implicitly has an 'any[]'... Remove this comment to see the full error message
                                        unhealthyPods,
                                        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'allPods' implicitly has an 'any[]' type.
                                        allPods,
                                        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'healthyPodData' implicitly has an 'any[]... Remove this comment to see the full error message
                                        healthyPodData,
                                        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'unhealthyPodData' implicitly has an 'any... Remove this comment to see the full error message
                                        unhealthyPodData,
                                        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'allPodData' implicitly has an 'any[]' ty... Remove this comment to see the full error message
                                        allPodData,
                                    };

                                    // handle job output
                                    // @ts-expect-error ts-migrate(7034) FIXME: Variable 'runningJobs' implicitly has type 'any[]'... Remove this comment to see the full error message
                                    const runningJobs = [],
                                        // @ts-expect-error ts-migrate(7034) FIXME: Variable 'succeededJobs' implicitly has type 'any[... Remove this comment to see the full error message
                                        succeededJobs = [],
                                        // @ts-expect-error ts-migrate(7034) FIXME: Variable 'failedJobs' implicitly has type 'any[]' ... Remove this comment to see the full error message
                                        failedJobs = [],
                                        // @ts-expect-error ts-migrate(7034) FIXME: Variable 'runningJobData' implicitly has type 'any... Remove this comment to see the full error message
                                        runningJobData = [],
                                        // @ts-expect-error ts-migrate(7034) FIXME: Variable 'succeededJobData' implicitly has type 'a... Remove this comment to see the full error message
                                        succeededJobData = [],
                                        // @ts-expect-error ts-migrate(7034) FIXME: Variable 'failedJobData' implicitly has type 'any[... Remove this comment to see the full error message
                                        failedJobData = [];
                                    // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                                    jobOutput.items.forEach(item => {
                                        /**
                                         * https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.20/#job-v1-batch
                                         */
                                        if (
                                            item.status &&
                                            item.status.active > 0
                                        ) {
                                            runningJobs.push({
                                                jobName: item.metadata.name,
                                                jobNamespace:
                                                    item.metadata.namespace,
                                                jobStatus: 'running',
                                                jobCreationTimestamp:
                                                    item.metadata
                                                        .creationTimestamp,
                                                jobResourceVersion:
                                                    item.metadata
                                                        .resourceVersion,
                                                jobUid: item.metadata.uid,
                                                jobSelfLink:
                                                    item.metadata.selfLink,
                                                jobConditions:
                                                    item.status.conditions,
                                            });
                                            runningJobData.push({
                                                jobName: item.metadata.name,
                                                jobNamespace:
                                                    item.metadata.namespace,
                                                jobStatus: 'running',
                                                jobCreationTimestamp:
                                                    item.metadata
                                                        .creationTimestamp,
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
                                                    item.metadata
                                                        .creationTimestamp,
                                                jobResourceVersion:
                                                    item.metadata
                                                        .resourceVersion,
                                                jobUid: item.metadata.uid,
                                                jobSelfLink:
                                                    item.metadata.selfLink,
                                                jobConditions:
                                                    item.status.conditions,
                                            });
                                            succeededJobData.push({
                                                jobName: item.metadata.name,
                                                jobNamespace:
                                                    item.metadata.namespace,
                                                jobStatus: 'succeeded',
                                                jobCreationTimestamp:
                                                    item.metadata
                                                        .creationTimestamp,
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
                                                    item.metadata
                                                        .creationTimestamp,
                                                jobResourceVersion:
                                                    item.metadata
                                                        .resourceVersion,
                                                jobUid: item.metadata.uid,
                                                jobSelfLink:
                                                    item.metadata.selfLink,
                                                jobConditions:
                                                    item.status.conditions,
                                            });
                                            failedJobData.push({
                                                jobName: item.metadata.name,
                                                jobNamespace:
                                                    item.metadata.namespace,
                                                jobStatus: 'failed',
                                                jobCreationTimestamp:
                                                    item.metadata
                                                        .creationTimestamp,
                                            });
                                        } else {
                                            failedJobs.push({
                                                jobName: item.metadata.name,
                                                jobNamespace:
                                                    item.metadata.namespace,
                                                jobStatus: 'failed',
                                                jobCreationTimestamp:
                                                    item.metadata
                                                        .creationTimestamp,
                                                jobResourceVersion:
                                                    item.metadata
                                                        .resourceVersion,
                                                jobUid: item.metadata.uid,
                                                jobSelfLink:
                                                    item.metadata.selfLink,
                                                jobConditions:
                                                    item.status.conditions,
                                            });
                                            failedJobData.push({
                                                jobName: item.metadata.name,
                                                jobNamespace:
                                                    item.metadata.namespace,
                                                jobStatus: 'failed',
                                                jobCreationTimestamp:
                                                    item.metadata
                                                        .creationTimestamp,
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
                                        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'runningJobs' implicitly has an 'any[]' t... Remove this comment to see the full error message
                                        runningJobs,
                                        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'succeededJobs' implicitly has an 'any[]'... Remove this comment to see the full error message
                                        succeededJobs,
                                        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'failedJobs' implicitly has an 'any[]' ty... Remove this comment to see the full error message
                                        failedJobs,
                                        allJobs: [
                                            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'runningJobs' implicitly has an 'any[]' t... Remove this comment to see the full error message
                                            ...runningJobs,
                                            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'succeededJobs' implicitly has an 'any[]'... Remove this comment to see the full error message
                                            ...succeededJobs,
                                            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'failedJobs' implicitly has an 'any[]' ty... Remove this comment to see the full error message
                                            ...failedJobs,
                                        ],
                                        allJobData: [
                                            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'runningJobData' implicitly has an 'any[]... Remove this comment to see the full error message
                                            ...runningJobData,
                                            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'succeededJobData' implicitly has an 'any... Remove this comment to see the full error message
                                            ...succeededJobData,
                                            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'failedJobData' implicitly has an 'any[]'... Remove this comment to see the full error message
                                            ...failedJobData,
                                        ],
                                        healthyJobs: [
                                            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'runningJobs' implicitly has an 'any[]' t... Remove this comment to see the full error message
                                            ...runningJobs,
                                            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'succeededJobs' implicitly has an 'any[]'... Remove this comment to see the full error message
                                            ...succeededJobs,
                                        ],
                                        healthyJobData: [
                                            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'runningJobData' implicitly has an 'any[]... Remove this comment to see the full error message
                                            ...runningJobData,
                                            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'succeededJobData' implicitly has an 'any... Remove this comment to see the full error message
                                            ...succeededJobData,
                                        ],
                                        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'failedJobs' implicitly has an 'any[]' ty... Remove this comment to see the full error message
                                        unhealthyJobs: [...failedJobs],
                                        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'failedJobData' implicitly has an 'any[]'... Remove this comment to see the full error message
                                        unhealthyJobData: [...failedJobData],
                                    };

                                    // handle services output
                                    const serviceData = {
                                        runningServices:
                                            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                                            serviceOutput.items.length,
                                    };

                                    // handle deployment output
                                    let desiredDeployment = 0,
                                        readyDeployment = 0;
                                    // @ts-expect-error ts-migrate(7034) FIXME: Variable 'unhealthyDeployments' implicitly has typ... Remove this comment to see the full error message
                                    const unhealthyDeployments = [],
                                        // @ts-expect-error ts-migrate(7034) FIXME: Variable 'healthyDeployments' implicitly has type ... Remove this comment to see the full error message
                                        healthyDeployments = [],
                                        // @ts-expect-error ts-migrate(7034) FIXME: Variable 'allDeployments' implicitly has type 'any... Remove this comment to see the full error message
                                        allDeployments = [],
                                        // @ts-expect-error ts-migrate(7034) FIXME: Variable 'unhealthyDeploymentData' implicitly has ... Remove this comment to see the full error message
                                        unhealthyDeploymentData = [],
                                        // @ts-expect-error ts-migrate(7034) FIXME: Variable 'healthyDeploymentData' implicitly has ty... Remove this comment to see the full error message
                                        healthyDeploymentData = [],
                                        // @ts-expect-error ts-migrate(7034) FIXME: Variable 'allDeploymentData' implicitly has type '... Remove this comment to see the full error message
                                        allDeploymentData = [];
                                    // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                                    deploymentOutput.items.forEach(item => {
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
                                    });
                                    const deploymentData = {
                                        desiredDeployment,
                                        readyDeployment,
                                        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'healthyDeployments' implicitly has an 'a... Remove this comment to see the full error message
                                        healthyDeployments,
                                        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'unhealthyDeployments' implicitly has an ... Remove this comment to see the full error message
                                        unhealthyDeployments,
                                        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'allDeployments' implicitly has an 'any[]... Remove this comment to see the full error message
                                        allDeployments,
                                        healthy: healthyDeployments.length,
                                        unhealthy: unhealthyDeployments.length,
                                        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'healthyDeploymentData' implicitly has an... Remove this comment to see the full error message
                                        healthyDeploymentData,
                                        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'unhealthyDeploymentData' implicitly has ... Remove this comment to see the full error message
                                        unhealthyDeploymentData,
                                        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'allDeploymentData' implicitly has an 'an... Remove this comment to see the full error message
                                        allDeploymentData,
                                    };

                                    // handle statefulset output
                                    let desiredStatefulsets = 0,
                                        readyStatefulsets = 0;
                                    // @ts-expect-error ts-migrate(7034) FIXME: Variable 'healthyStatefulsets' implicitly has type... Remove this comment to see the full error message
                                    const healthyStatefulsets = [],
                                        // @ts-expect-error ts-migrate(7034) FIXME: Variable 'unhealthyStatefulsets' implicitly has ty... Remove this comment to see the full error message
                                        unhealthyStatefulsets = [],
                                        // @ts-expect-error ts-migrate(7034) FIXME: Variable 'allStatefulset' implicitly has type 'any... Remove this comment to see the full error message
                                        allStatefulset = [],
                                        // @ts-expect-error ts-migrate(7034) FIXME: Variable 'healthyStatefulsetData' implicitly has t... Remove this comment to see the full error message
                                        healthyStatefulsetData = [],
                                        // @ts-expect-error ts-migrate(7034) FIXME: Variable 'unhealthyStatefulsetData' implicitly has... Remove this comment to see the full error message
                                        unhealthyStatefulsetData = [],
                                        // @ts-expect-error ts-migrate(7034) FIXME: Variable 'allStatefulsetData' implicitly has type ... Remove this comment to see the full error message
                                        allStatefulsetData = [];
                                    // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                                    statefulsetOutput.items.forEach(item => {
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
                                    });
                                    const statefulsetData = {
                                        readyStatefulsets,
                                        desiredStatefulsets,
                                        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'healthyStatefulsets' implicitly has an '... Remove this comment to see the full error message
                                        healthyStatefulsets,
                                        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'unhealthyStatefulsets' implicitly has an... Remove this comment to see the full error message
                                        unhealthyStatefulsets,
                                        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'allStatefulset' implicitly has an 'any[]... Remove this comment to see the full error message
                                        allStatefulset,
                                        healthy: healthyStatefulsets.length,
                                        unhealthy: unhealthyStatefulsets.length,
                                        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'healthyStatefulsetData' implicitly has a... Remove this comment to see the full error message
                                        healthyStatefulsetData,
                                        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'unhealthyStatefulsetData' implicitly has... Remove this comment to see the full error message
                                        unhealthyStatefulsetData,
                                        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'allStatefulsetData' implicitly has an 'a... Remove this comment to see the full error message
                                        allStatefulsetData,
                                    };

                                    const data = {
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

// @ts-expect-error ts-migrate(7006) FIXME: Parameter 'configPath' implicitly has an 'any' typ... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(7006) FIXME: Parameter 'configPath' implicitly has an 'any' typ... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(7006) FIXME: Parameter 'configPath' implicitly has an 'any' typ... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(7006) FIXME: Parameter 'configPath' implicitly has an 'any' typ... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(7006) FIXME: Parameter 'configPath' implicitly has an 'any' typ... Remove this comment to see the full error message
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
