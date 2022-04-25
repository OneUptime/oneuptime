"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const child_process_1 = require("child_process");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const node_fetch_commonjs_1 = __importDefault(require("node-fetch-commonjs"));
const uuid_1 = require("uuid");
const apiService_1 = __importDefault(require("../Utils/apiService"));
const Config_1 = require("../Config");
const fsHandlers_1 = require("../Utils/fsHandlers");
exports.default = {
    run: function ({ monitor }) {
        return __awaiter(this, void 0, void 0, function* () {
            if (monitor &&
                monitor.type &&
                monitor.type === 'kubernetes' &&
                monitor.kubernetesConfig) {
                const configurationFile = monitor.kubernetesConfig;
                const updatedConfigName = `${(0, uuid_1.v4)()}${configurationFile}`;
                const configPath = path_1.default.resolve(process.cwd(), updatedConfigName);
                const namespace = monitor.kubernetesNamespace || 'default';
                yield (0, node_fetch_commonjs_1.default)(`${Config_1.serverUrl}/file/${configurationFile}`).then((res) => {
                    const dest = fs_1.default.createWriteStream(configPath);
                    res.body.pipe(dest);
                    // At this point, writing to the specified file is complete
                    dest.on('finish', () => __awaiter(this, void 0, void 0, function* () {
                        if (fs_1.default.existsSync(configPath)) {
                            const [podOutput, jobOutput, serviceOutput, deploymentOutput, statefulsetOutput,] = yield Promise.all([
                                loadPodOutput(configPath, namespace),
                                loadJobOutput(configPath, namespace),
                                loadServiceOutput(configPath, namespace),
                                loadDeploymentOutput(configPath, namespace),
                                loadStatefulsetOutput(configPath, namespace),
                            ]);
                            if (podOutput &&
                                jobOutput &&
                                deploymentOutput &&
                                statefulsetOutput) {
                                // Handle pod output
                                const healthyPods = [], healthyPodData = [], unhealthyPods = [], unhealthyPodData = [], allPods = [], allPodData = [];
                                let runningPods = 0, completedPods = 0, failedPods = 0;
                                podOutput.items.forEach((item) => {
                                    /**
                                     *  https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.20/#podstatus-v1-core
                                     */
                                    if (item.status.phase !== 'Running' &&
                                        item.status.phase !== 'Succeeded') {
                                        unhealthyPods.push({
                                            podName: item.metadata.name,
                                            podNamespace: item.metadata.namespace,
                                            podStatus: item.status.phase,
                                            podCreationTimestamp: item.metadata.creationTimestamp,
                                            podRestart: item.status &&
                                                item.status.containerStatuses &&
                                                item.status.containerStatuses[0]
                                                ? item.status
                                                    .containerStatuses[0]
                                                    .restartCount
                                                : 0,
                                            podResourceVersion: item.metadata.resourceVersion,
                                            podUid: item.metadata.uid,
                                            podSelfLink: item.metadata.selfLink,
                                            podConditions: item.status.conditions,
                                            podContainerStatuses: item.status.containerStatuses,
                                            podContainers: item.spec.containers,
                                        });
                                        unhealthyPodData.push({
                                            podName: item.metadata.name,
                                            podNamespace: item.metadata.namespace,
                                            podStatus: item.status.phase,
                                            podCreationTimestamp: item.metadata.creationTimestamp,
                                            podRestart: item.status &&
                                                item.status.containerStatuses &&
                                                item.status.containerStatuses[0]
                                                ? item.status
                                                    .containerStatuses[0]
                                                    .restartCount
                                                : 0,
                                        });
                                        failedPods += 1;
                                    }
                                    else {
                                        healthyPods.push({
                                            podName: item.metadata.name,
                                            podNamespace: item.metadata.namespace,
                                            podStatus: item.status.phase,
                                            podCreationTimestamp: item.metadata.creationTimestamp,
                                            podRestart: item.status &&
                                                item.status.containerStatuses &&
                                                item.status.containerStatuses[0]
                                                ? item.status
                                                    .containerStatuses[0]
                                                    .restartCount
                                                : 0,
                                            podResourceVersion: item.metadata.resourceVersion,
                                            podUid: item.metadata.uid,
                                            podSelfLink: item.metadata.selfLink,
                                            podConditions: item.status.conditions,
                                            podContainerStatuses: item.status.containerStatuses,
                                            podContainers: item.spec.containers,
                                        });
                                        healthyPodData.push({
                                            podName: item.metadata.name,
                                            podNamespace: item.metadata.namespace,
                                            podStatus: item.status.phase,
                                            podCreationTimestamp: item.metadata.creationTimestamp,
                                            podRestart: item.status &&
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
                                        podCreationTimestamp: item.metadata.creationTimestamp,
                                        podRestart: item.status &&
                                            item.status.containerStatuses &&
                                            item.status.containerStatuses[0]
                                            ? item.status
                                                .containerStatuses[0]
                                                .restartCount
                                            : 0,
                                        podResourceVersion: item.metadata.resourceVersion,
                                        podUid: item.metadata.uid,
                                        podSelfLink: item.metadata.selfLink,
                                        podConditions: item.status.conditions,
                                        podContainerStatuses: item.status.containerStatuses,
                                        podContainers: item.spec.containers,
                                    });
                                    allPodData.push({
                                        podName: item.metadata.name,
                                        podNamespace: item.metadata.namespace,
                                        podStatus: item.status.phase,
                                        podCreationTimestamp: item.metadata.creationTimestamp,
                                        podRestart: item.status &&
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
                                        totalPods: podOutput.items.length,
                                    },
                                    healthyPods,
                                    unhealthyPods,
                                    allPods,
                                    healthyPodData,
                                    unhealthyPodData,
                                    allPodData,
                                };
                                // Handle job output
                                const runningJobs = [], succeededJobs = [], failedJobs = [], runningJobData = [], succeededJobData = [], failedJobData = [];
                                jobOutput.items.forEach((item) => {
                                    /**
                                     * https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.20/#job-v1-batch
                                     */
                                    if (item.status && item.status.active > 0) {
                                        runningJobs.push({
                                            jobName: item.metadata.name,
                                            jobNamespace: item.metadata.namespace,
                                            jobStatus: 'running',
                                            jobCreationTimestamp: item.metadata.creationTimestamp,
                                            jobResourceVersion: item.metadata.resourceVersion,
                                            jobUid: item.metadata.uid,
                                            jobSelfLink: item.metadata.selfLink,
                                            jobConditions: item.status.conditions,
                                        });
                                        runningJobData.push({
                                            jobName: item.metadata.name,
                                            jobNamespace: item.metadata.namespace,
                                            jobStatus: 'running',
                                            jobCreationTimestamp: item.metadata.creationTimestamp,
                                        });
                                    }
                                    else if (item.status &&
                                        item.status.succeeded > 0) {
                                        succeededJobs.push({
                                            jobName: item.metadata.name,
                                            jobNamespace: item.metadata.namespace,
                                            jobStatus: 'succeeded',
                                            jobCreationTimestamp: item.metadata.creationTimestamp,
                                            jobResourceVersion: item.metadata.resourceVersion,
                                            jobUid: item.metadata.uid,
                                            jobSelfLink: item.metadata.selfLink,
                                            jobConditions: item.status.conditions,
                                        });
                                        succeededJobData.push({
                                            jobName: item.metadata.name,
                                            jobNamespace: item.metadata.namespace,
                                            jobStatus: 'succeeded',
                                            jobCreationTimestamp: item.metadata.creationTimestamp,
                                        });
                                    }
                                    else if (item.status &&
                                        item.status.failed > 0) {
                                        failedJobs.push({
                                            jobName: item.metadata.name,
                                            jobNamespace: item.metadata.namespace,
                                            jobStatus: 'failed',
                                            jobCreationTimestamp: item.metadata.creationTimestamp,
                                            jobResourceVersion: item.metadata.resourceVersion,
                                            jobUid: item.metadata.uid,
                                            jobSelfLink: item.metadata.selfLink,
                                            jobConditions: item.status.conditions,
                                        });
                                        failedJobData.push({
                                            jobName: item.metadata.name,
                                            jobNamespace: item.metadata.namespace,
                                            jobStatus: 'failed',
                                            jobCreationTimestamp: item.metadata.creationTimestamp,
                                        });
                                    }
                                    else {
                                        failedJobs.push({
                                            jobName: item.metadata.name,
                                            jobNamespace: item.metadata.namespace,
                                            jobStatus: 'failed',
                                            jobCreationTimestamp: item.metadata.creationTimestamp,
                                            jobResourceVersion: item.metadata.resourceVersion,
                                            jobUid: item.metadata.uid,
                                            jobSelfLink: item.metadata.selfLink,
                                            jobConditions: item.status.conditions,
                                        });
                                        failedJobData.push({
                                            jobName: item.metadata.name,
                                            jobNamespace: item.metadata.namespace,
                                            jobStatus: 'failed',
                                            jobCreationTimestamp: item.metadata.creationTimestamp,
                                        });
                                    }
                                });
                                const jobData = {
                                    jobStat: {
                                        runningJobs: runningJobs.length,
                                        succeededJobs: succeededJobs.length,
                                        failedJobs: failedJobs.length,
                                        totalJobs: runningJobs.length +
                                            succeededJobs.length +
                                            failedJobs.length,
                                        healthy: runningJobs.length +
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
                                // Handle services output
                                const serviceData = {
                                    runningServices: serviceOutput.items.length,
                                };
                                // Handle deployment output
                                let desiredDeployment = 0, readyDeployment = 0;
                                const unhealthyDeployments = [], healthyDeployments = [], allDeployments = [], unhealthyDeploymentData = [], healthyDeploymentData = [], allDeploymentData = [];
                                deploymentOutput.items.forEach((item) => {
                                    if (item.status.readyReplicas) {
                                        readyDeployment +=
                                            item.status.readyReplicas;
                                    }
                                    else {
                                        readyDeployment += 0;
                                    }
                                    desiredDeployment +=
                                        item.status.replicas;
                                    if (item.status.readyReplicas !==
                                        item.status.replicas) {
                                        unhealthyDeployments.push({
                                            deploymentName: item.metadata.name,
                                            deploymentNamespace: item.metadata.namespace,
                                            deploymentCreationTimestamp: item.metadata
                                                .creationTimestamp,
                                            readyDeployment: item.status.readyReplicas ||
                                                0,
                                            desiredDeployment: item.status.replicas,
                                            deploymentResourceVersion: item.metadata
                                                .resourceVersion,
                                            deploymentUid: item.metadata.uid,
                                            deploymentSelfLink: item.metadata.selfLink,
                                            deploymentConditions: item.status.conditions,
                                        });
                                        unhealthyDeploymentData.push({
                                            deploymentName: item.metadata.name,
                                            deploymentNamespace: item.metadata.namespace,
                                            deploymentCreationTimestamp: item.metadata
                                                .creationTimestamp,
                                            readyDeployment: item.status.readyReplicas ||
                                                0,
                                            desiredDeployment: item.status.replicas,
                                        });
                                    }
                                    else {
                                        healthyDeployments.push({
                                            deploymentName: item.metadata.name,
                                            deploymentNamespace: item.metadata.namespace,
                                            deploymentCreationTimestamp: item.metadata
                                                .creationTimestamp,
                                            readyDeployment: item.status.readyReplicas,
                                            desiredDeployment: item.status.replicas,
                                            deploymentResourceVersion: item.metadata
                                                .resourceVersion,
                                            deploymentUid: item.metadata.uid,
                                            deploymentSelfLink: item.metadata.selfLink,
                                            deploymentConditions: item.status.conditions,
                                        });
                                        healthyDeploymentData.push({
                                            deploymentName: item.metadata.name,
                                            deploymentNamespace: item.metadata.namespace,
                                            deploymentCreationTimestamp: item.metadata
                                                .creationTimestamp,
                                            readyDeployment: item.status.readyReplicas,
                                            desiredDeployment: item.status.replicas,
                                        });
                                    }
                                    allDeployments.push({
                                        deploymentName: item.metadata.name,
                                        deploymentNamespace: item.metadata.namespace,
                                        deploymentCreationTimestamp: item.metadata.creationTimestamp,
                                        readyDeployment: item.status.readyReplicas || 0,
                                        desiredDeployment: item.status.replicas,
                                        deploymentResourceVersion: item.metadata.resourceVersion,
                                        deploymentUid: item.metadata.uid,
                                        deploymentSelfLink: item.metadata.selfLink,
                                        deploymentConditions: item.status.conditions,
                                    });
                                    allDeploymentData.push({
                                        deploymentName: item.metadata.name,
                                        deploymentNamespace: item.metadata.namespace,
                                        deploymentCreationTimestamp: item.metadata.creationTimestamp,
                                        readyDeployment: item.status.readyReplicas || 0,
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
                                    healthyDeploymentData,
                                    unhealthyDeploymentData,
                                    allDeploymentData,
                                };
                                // Handle statefulset output
                                let desiredStatefulsets = 0, readyStatefulsets = 0;
                                const healthyStatefulsets = [], unhealthyStatefulsets = [], allStatefulset = [], healthyStatefulsetData = [], unhealthyStatefulsetData = [], allStatefulsetData = [];
                                statefulsetOutput.items.forEach((item) => {
                                    if (item.status.readyReplicas) {
                                        readyStatefulsets +=
                                            item.status.readyReplicas;
                                    }
                                    else {
                                        readyStatefulsets += 0;
                                    }
                                    desiredStatefulsets +=
                                        item.status.replicas;
                                    if (item.status.readyReplicas !==
                                        item.status.replicas) {
                                        unhealthyStatefulsets.push({
                                            statefulsetName: item.metadata.name,
                                            statefulsetNamespace: item.metadata.namespace,
                                            statefulsetCreationTimestamp: item.metadata
                                                .creationTimestamp,
                                            readyStatefulsets: item.status.readyReplicas ||
                                                0,
                                            desiredStatefulsets: item.status.replicas,
                                            statefulsetResourceVersion: item.metadata
                                                .resourceVersion,
                                            statefulsetUid: item.metadata.uid,
                                            statefulsetSelfLink: item.metadata.selfLink,
                                        });
                                        unhealthyStatefulsetData.push({
                                            statefulsetName: item.metadata.name,
                                            statefulsetNamespace: item.metadata.namespace,
                                            statefulsetCreationTimestamp: item.metadata
                                                .creationTimestamp,
                                            readyStatefulsets: item.status.readyReplicas ||
                                                0,
                                            desiredStatefulsets: item.status.replicas,
                                        });
                                    }
                                    else {
                                        healthyStatefulsets.push({
                                            statefulsetName: item.metadata.name,
                                            statefulsetNamespace: item.metadata.namespace,
                                            statefulsetCreationTimestamp: item.metadata
                                                .creationTimestamp,
                                            readyStatefulsets: item.status.readyReplicas,
                                            desiredStatefulsets: item.status.replicas,
                                            statefulsetResourceVersion: item.metadata
                                                .resourceVersion,
                                            statefulsetUid: item.metadata.uid,
                                            statefulsetSelfLink: item.metadata.selfLink,
                                        });
                                        healthyStatefulsetData.push({
                                            statefulsetName: item.metadata.name,
                                            statefulsetNamespace: item.metadata.namespace,
                                            statefulsetCreationTimestamp: item.metadata
                                                .creationTimestamp,
                                            readyStatefulsets: item.status.readyReplicas,
                                            desiredStatefulsets: item.status.replicas,
                                        });
                                    }
                                    allStatefulset.push({
                                        statefulsetName: item.metadata.name,
                                        statefulsetNamespace: item.metadata.namespace,
                                        statefulsetCreationTimestamp: item.metadata.creationTimestamp,
                                        readyStatefulsets: item.status.readyReplicas || 0,
                                        desiredStatefulsets: item.status.replicas,
                                        statefulsetResourceVersion: item.metadata.resourceVersion,
                                        statefulsetUid: item.metadata.uid,
                                        statefulsetSelfLink: item.metadata.selfLink,
                                    });
                                    allStatefulsetData.push({
                                        statefulsetName: item.metadata.name,
                                        statefulsetNamespace: item.metadata.namespace,
                                        statefulsetCreationTimestamp: item.metadata.creationTimestamp,
                                        readyStatefulsets: item.status.readyReplicas || 0,
                                        desiredStatefulsets: item.status.replicas,
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
                                    healthyStatefulsetData,
                                    unhealthyStatefulsetData,
                                    allStatefulsetData,
                                };
                                const data = {
                                    podData,
                                    jobData,
                                    serviceData,
                                    deploymentData,
                                    statefulsetData,
                                };
                                yield apiService_1.default.ping(monitor._id, {
                                    monitor,
                                    kubernetesData: data,
                                    type: monitor.type,
                                });
                                // Remove the config file
                                yield (0, fsHandlers_1.deleteFile)(configPath);
                            }
                        }
                        // Remove the config file
                        yield (0, fsHandlers_1.deleteFile)(configPath);
                    }));
                    dest.on('error', (error) => __awaiter(this, void 0, void 0, function* () {
                        yield (0, fsHandlers_1.deleteFile)(configPath);
                        throw error;
                    }));
                });
            }
        });
    },
};
function loadPodOutput(configPath, namespace) {
    return new Promise((resolve) => {
        let podOutput = '';
        const podCommand = `kubectl get pods -o json --kubeconfig ${configPath} --namespace ${namespace}`;
        const podCommandOutput = (0, child_process_1.spawn)(podCommand, {
            cwd: process.cwd(),
            shell: true,
        });
        podCommandOutput.stdout.on('data', (data) => {
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
    return new Promise((resolve) => {
        let jobOutput = '';
        const jobCommand = `kubectl get jobs -o json --kubeconfig ${configPath} --namespace ${namespace}`;
        const jobCommandOutput = (0, child_process_1.spawn)(jobCommand, {
            cwd: process.cwd(),
            shell: true,
        });
        jobCommandOutput.stdout.on('data', (data) => {
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
    return new Promise((resolve) => {
        let serviceOutput = '';
        const serviceCommand = `kubectl get services -o json --kubeconfig ${configPath} --namespace ${namespace}`;
        const serviceCommandOutput = (0, child_process_1.spawn)(serviceCommand, {
            cwd: process.cwd(),
            shell: true,
        });
        serviceCommandOutput.stdout.on('data', (data) => {
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
    return new Promise((resolve) => {
        let deploymentOutput = '';
        const deploymentCommand = `kubectl get deployments -o json --kubeconfig ${configPath} --namespace ${namespace}`;
        const deploymentCommandOutput = (0, child_process_1.spawn)(deploymentCommand, {
            cwd: process.cwd(),
            shell: true,
        });
        deploymentCommandOutput.stdout.on('data', (data) => {
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
    return new Promise((resolve) => {
        let statefulsetOutput = '';
        const statefulsetCommand = `kubectl get statefulsets -o json --kubeconfig ${configPath} --namespace ${namespace}`;
        const statefulsetCommandOutput = (0, child_process_1.spawn)(statefulsetCommand, {
            cwd: process.cwd(),
            shell: true,
        });
        statefulsetCommandOutput.stdout.on('data', (data) => {
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
