import ApiService from '../Utils/apiService';

import fs from 'fs';
import { NodeSSH } from 'node-ssh';
import fetch from 'node-fetch-commonjs';

import { COMMAND, serverUrl } from '../Config';

export default {
    run: async ({ monitor }: $TSFixMe) => {
        if (
            monitor &&
            monitor.type &&
            monitor.agentlessConfig &&
            typeof monitor.agentlessConfig === 'object'
        ) {
            const {
                host,
                port,
                username,
                authentication,
                password,
                identityFile,
            } = monitor.agentlessConfig;
            const ssh: $TSFixMe = new NodeSSH();

            const config: $TSFixMe = {
                host,
                port,
                username,
            };

            if (authentication === 'password') {
                config.password = password;
            } else {
                await fetch(`${serverUrl}/file/${identityFile}`).then(
                    (res: $TSFixMe) =>
                        new Promise((resolve: Function, reject: Function) => {
                            const dest: $TSFixMe = fs.createWriteStream(
                                `./${identityFile}`
                            );

                            res.body.pipe(dest);

                            res.body.on('end', () => {
                                setTimeout(() => {
                                    config.privateKey = fs.readFileSync(
                                        `./${identityFile}`,
                                        'utf8'
                                    );

                                    resolve();
                                }, 1000);
                            });
                            dest.on('error', reject);
                        })
                );
                fs.unlinkSync(`./${identityFile}`);
            }

            ssh.connect(config).then(async (): void => {
                let os: $TSFixMe;
                try {
                    const { stdout: osLine, stderr } = await ssh.execCommand(
                        'uname -a'
                    );

                    if (stderr) {
                        throw stderr;
                    }

                    os = osLine.split(' ')[0];
                } catch (e) {
                    const { stdout: osLine } = await ssh.execCommand(
                        'wmic os get name'
                    );

                    os = osLine.split(' ')[1];
                }

                const serverData: $TSFixMe = await execCommands(ssh, os);

                ssh.dispose();

                await ApiService.ping(monitor._id, {
                    monitor,
                    serverData,
                    type: monitor.type,
                });
            });
        }
    },
};

const execCommands: Function = async (exec: $TSFixMe, os: $TSFixMe): void => {
    const isSSH: $TSFixMe = exec instanceof NodeSSH;

    // TODO: complete commands and make platform specific
    let cpuLoad: $TSFixMe,
        avgCpuLoad: $TSFixMe,
        cpuCores: $TSFixMe,
        memoryUsed: $TSFixMe,
        totalMemory: $TSFixMe,
        swapUsed: $TSFixMe,
        storageUsed: $TSFixMe,
        totalStorage: $TSFixMe,
        storageUsage: $TSFixMe,
        mainTemp: $TSFixMe,
        maxTemp: $TSFixMe;

    if (os === 'Linux') {
        const { stdout: load } = await (isSSH
            ? exec.execCommand(COMMAND.linux.load)
            : exec(COMMAND.linux.load));
        const { stdout: cpu } = await (isSSH
            ? exec.execCommand(COMMAND.linux.cpu)
            : exec(COMMAND.linux.cpu));
        const { stdout: mem } = await (isSSH
            ? exec.execCommand(COMMAND.linux.mem)
            : exec(COMMAND.linux.mem));
        const { stdout: disk } = await (isSSH
            ? exec.execCommand(COMMAND.linux.disk)
            : exec(COMMAND.linux.disk));
        const { stdout: temp } = await (isSSH
            ? exec.execCommand(COMMAND.linux.temp)
            : exec(COMMAND.linux.temp));

        const loadLines: $TSFixMe = load
            .replace(/\t|:|,|-/gi, '')
            .trim()
            .split('\n')
            .map((line: $TSFixMe) => {
                const words: $TSFixMe = line
                    .replace(/\s+/g, ' ')
                    .trim()
                    .split(' ');
                return words;
            });
        const cpuLines: $TSFixMe = cpu
            .replace(/\t|:/gi, '')
            .trim()
            .split('\n')
            .map((line: $TSFixMe) => line.replace(/\s+/g, ' ').trim());
        const memLines: $TSFixMe = mem
            .replace(/\t|:/gi, '')
            .trim()
            .split('\n')
            .map((line: $TSFixMe) => {
                const words: $TSFixMe = line
                    .replace(/\s+/g, ' ')
                    .trim()
                    .split(' ');
                return words[words.length - 2];
            });
        const diskLines: $TSFixMe = disk
            .replace(/\t|:|M|G|%/gi, '')
            .trim()
            .split('\n')
            .map((line: $TSFixMe) => {
                const words: $TSFixMe = line
                    .replace(/\s+/g, ' ')
                    .trim()
                    .split(' ');
                return {
                    storageUsed: words[2],
                    totalStorage: words[1],
                    storageUsage: words[4],
                };
            })
            .reduce((disks: $TSFixMe, disk: $TSFixMe) => {
                return {
                    storageUsed: disks.storageUsed + disk.storageUsed,
                    totalStorage: disks.totalStorage + disk.totalStorage,
                    storageUsage: disks.storageUsage + disk.storageUsage,
                };
            });
        const tempLines: $TSFixMe = temp
            .replace(/\t|:|\+|°|C/gi, '')
            .replace(/\s+/g, ' ')
            .trim()
            .split(' ');

        cpuLoad = loadLines[3][1];
        avgCpuLoad = loadLines[2][10];
        cpuCores = cpuLines.length / 2;
        memoryUsed = (parseFloat(memLines[0]) - parseFloat(memLines[1])) * 1024;
        totalMemory = memLines[0] * 1024;
        swapUsed = (parseFloat(memLines[4]) - parseFloat(memLines[5])) * 1024;
        storageUsed = diskLines.storageUsed * 1024 * 1024 * 1024;
        totalStorage = diskLines.totalStorage * 1024 * 1024 * 1024;
        storageUsage = diskLines.storageUsage;
        mainTemp = tempLines[1];
        maxTemp = tempLines[1];
    } else if (os === 'Darwin') {
        const { stdout: load } = await (isSSH
            ? exec.execCommand(COMMAND.darwin.load)
            : exec(COMMAND.darwin.load));
        const { stdout: cpu } = await (isSSH
            ? exec.execCommand(COMMAND.darwin.cpu)
            : exec(COMMAND.darwin.cpu));
        const { stdout: usedMem } = await (isSSH
            ? exec.execCommand(COMMAND.darwin.mem.used)
            : exec(COMMAND.darwin.mem.used));
        const { stdout: totalMem } = await (isSSH
            ? exec.execCommand(COMMAND.darwin.mem.total)
            : exec(COMMAND.darwin.mem.total));
        const { stdout: swapMem } = await (isSSH
            ? exec.execCommand(COMMAND.darwin.mem.swap)
            : exec(COMMAND.darwin.mem.swap));
        const { stdout: disk } = await (isSSH
            ? exec.execCommand(COMMAND.darwin.disk)
            : exec(COMMAND.darwin.disk));
        const { stdout: temp } = await (isSSH
            ? exec.execCommand(COMMAND.darwin.temp)
            : exec(COMMAND.darwin.temp));

        const loadLines: $TSFixMe = load
            .replace(/\t|:|,|-|%/gi, '')
            .trim()
            .split('\n')
            .map((line: $TSFixMe) => {
                const words: $TSFixMe = line
                    .replace(/\s+/g, ' ')
                    .trim()
                    .split(' ');
                return words;
            });
        const memLines: $TSFixMe = usedMem
            .replace(/\t|:|M|G|\(|\)/gi, '')
            .replace(/\s+/g, ' ')
            .trim()
            .split(' ');
        const swapLines: $TSFixMe = swapMem
            .replace(/\t|:|M|G|\(|\)|=/gi, '')
            .replace(/\s+/g, ' ')
            .trim()
            .split(' ');
        const diskLines: $TSFixMe = disk
            .replace(/\t|:|Mi|Gi|%/gi, '')
            .trim()
            .split('\n')
            .map((line: $TSFixMe) => {
                const words: $TSFixMe = line
                    .replace(/\s+/g, ' ')
                    .trim()
                    .split(' ');
                return {
                    storageUsed: words[2],
                    totalStorage: words[1],
                    storageUsage: words[4],
                };
            })
            .reduce((disks: $TSFixMe, disk: $TSFixMe) => {
                return {
                    storageUsed: disks.storageUsed + disk.storageUsed,
                    totalStorage: disks.totalStorage + disk.totalStorage,
                    storageUsage: disks.storageUsage + disk.storageUsage,
                };
            });

        cpuLoad = loadLines[1][2];
        avgCpuLoad = loadLines[0][3];
        cpuCores = cpu.replace('\n', '');
        memoryUsed =
            (parseFloat(memLines[1]) - parseFloat(memLines[3])) * 1024 * 1024;
        totalMemory = totalMem.replace('\n', '');
        swapUsed = swapLines[3] * 1024 * 1024;
        storageUsed = diskLines.storageUsed * 1024 * 1024 * 1024;
        totalStorage = diskLines.totalStorage * 1024 * 1024 * 1024;
        storageUsage = diskLines.storageUsage;
        mainTemp = temp.replace('\n', '');
        maxTemp = temp.replace('\n', '');
    } else if (os === 'Windows') {
        const { stdout: load } = await (isSSH
            ? exec.execCommand(COMMAND.win.load)
            : exec(COMMAND.win.load));
        const { stdout: cpu } = await (isSSH
            ? exec.execCommand(COMMAND.win.cpu)
            : exec(COMMAND.win.cpu));
        const { stdout: freeMem } = await (isSSH
            ? exec.execCommand(COMMAND.win.mem.free)
            : exec(COMMAND.win.mem.free));
        const { stdout: totalMem } = await (isSSH
            ? exec.execCommand(COMMAND.win.mem.total)
            : exec(COMMAND.win.mem.total));
        const { stdout: totalSwapMem } = await (isSSH
            ? exec.execCommand(COMMAND.win.mem.totalSwap)
            : exec(COMMAND.win.mem.totalSwap));
        const { stdout: freeSwapMem } = await (isSSH
            ? exec.execCommand(COMMAND.win.mem.freeSwap)
            : exec(COMMAND.win.mem.freeSwap));
        const { stdout: freeDisk } = await (isSSH
            ? exec.execCommand(COMMAND.win.disk.free)
            : exec(COMMAND.win.disk.free));
        const { stdout: totalDisk } = await (isSSH
            ? exec.execCommand(COMMAND.win.disk.total)
            : exec(COMMAND.win.disk.total));
        const { stdout: temp } = await (isSSH
            ? exec.execCommand(COMMAND.win.temp)
            : exec(COMMAND.win.temp));

        const loadLines: $TSFixMe = load.replace(/\s+/g, ' ').trim().split(' ');
        const cpuLines: $TSFixMe = cpu.replace(/\s+/g, ' ').trim().split(' ');
        const freeMemLines: $TSFixMe = freeMem
            .replace(/\s+/g, ' ')
            .trim()
            .split(' ');
        const totalMemLines: $TSFixMe = totalMem
            .replace(/\s+/g, ' ')
            .trim()
            .split(' ');
        const totalSwapMemLines: $TSFixMe = totalSwapMem
            .replace(/\s+/g, ' ')
            .trim()
            .split(' ');
        const freeSwapMemLines: $TSFixMe = freeSwapMem
            .replace(/\s+/g, ' ')
            .trim()
            .split(' ');
        const freeDiskLines: $TSFixMe = freeDisk
            .replace(/\s+/g, ' ')
            .trim()
            .split(' ');
        const totalDiskLines: $TSFixMe = totalDisk
            .replace(/\s+/g, ' ')
            .trim()
            .split(' ');
        const tempLines: $TSFixMe = temp.replace(/\s+/g, ' ').trim().split(' ');

        cpuLoad = loadLines[1];
        avgCpuLoad = loadLines[1];
        cpuCores = cpuLines[1];
        memoryUsed =
            parseFloat(totalMemLines[1]) - parseFloat(freeMemLines[1]) * 1024;
        totalMemory = totalMemLines[1];
        swapUsed =
            parseFloat(totalSwapMemLines[1]) - parseFloat(freeSwapMemLines[1]);
        storageUsed =
            parseFloat(totalDiskLines[1]) - parseFloat(freeDiskLines[1]);
        totalStorage = totalDiskLines[1];
        storageUsage = (storageUsed / parseFloat(totalDiskLines[1])) * 100;
        mainTemp = tempLines[1];
        maxTemp = tempLines[1];
    }

    return {
        cpuLoad,
        avgCpuLoad,
        cpuCores,
        memoryUsed,
        totalMemory,
        swapUsed,
        storageUsed,
        totalStorage,
        storageUsage,
        mainTemp,
        maxTemp,
    };
};
