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
const apiService_1 = __importDefault(require("../Utils/apiService"));
const fs_1 = __importDefault(require("fs"));
const node_ssh_1 = require("node-ssh");
const node_fetch_commonjs_1 = __importDefault(require("node-fetch-commonjs"));
const Config_1 = require("../Config");
exports.default = {
    run: ({ monitor }) => __awaiter(void 0, void 0, void 0, function* () {
        if (monitor &&
            monitor.type &&
            monitor.agentlessConfig &&
            typeof monitor.agentlessConfig === 'object') {
            const { host, port, username, authentication, password, identityFile, } = monitor.agentlessConfig;
            const ssh = new node_ssh_1.NodeSSH();
            const config = {
                host,
                port,
                username,
            };
            if (authentication === 'password') {
                config.password = password;
            }
            else {
                yield (0, node_fetch_commonjs_1.default)(`${Config_1.serverUrl}/file/${identityFile}`).then((res) => {
                    return new Promise((resolve, reject) => {
                        const dest = fs_1.default.createWriteStream(`./${identityFile}`);
                        res.body.pipe(dest);
                        res.body.on('end', () => {
                            setTimeout(() => {
                                config.privateKey = fs_1.default.readFileSync(`./${identityFile}`, 'utf8');
                                resolve();
                            }, 1000);
                        });
                        dest.on('error', reject);
                    });
                });
                fs_1.default.unlinkSync(`./${identityFile}`);
            }
            ssh.connect(config).then(() => __awaiter(void 0, void 0, void 0, function* () {
                let os;
                try {
                    const { stdout: osLine, stderr } = yield ssh.execCommand('uname -a');
                    if (stderr) {
                        throw stderr;
                    }
                    os = osLine.split(' ')[0];
                }
                catch (e) {
                    const { stdout: osLine } = yield ssh.execCommand('wmic os get name');
                    os = osLine.split(' ')[1];
                }
                const serverData = yield execCommands(ssh, os);
                ssh.dispose();
                yield apiService_1.default.ping(monitor._id, {
                    monitor,
                    serverData,
                    type: monitor.type,
                });
            }));
        }
    }),
};
const execCommands = (exec, os) => __awaiter(void 0, void 0, void 0, function* () {
    const isSSH = exec instanceof node_ssh_1.NodeSSH;
    // TODO: complete commands and make platform specific
    let cpuLoad, avgCpuLoad, cpuCores, memoryUsed, totalMemory, swapUsed, storageUsed, totalStorage, storageUsage, mainTemp, maxTemp;
    if (os === 'Linux') {
        const { stdout: load } = yield (isSSH
            ? exec.execCommand(Config_1.COMMAND.linux.load)
            : exec(Config_1.COMMAND.linux.load));
        const { stdout: cpu } = yield (isSSH
            ? exec.execCommand(Config_1.COMMAND.linux.cpu)
            : exec(Config_1.COMMAND.linux.cpu));
        const { stdout: mem } = yield (isSSH
            ? exec.execCommand(Config_1.COMMAND.linux.mem)
            : exec(Config_1.COMMAND.linux.mem));
        const { stdout: disk } = yield (isSSH
            ? exec.execCommand(Config_1.COMMAND.linux.disk)
            : exec(Config_1.COMMAND.linux.disk));
        const { stdout: temp } = yield (isSSH
            ? exec.execCommand(Config_1.COMMAND.linux.temp)
            : exec(Config_1.COMMAND.linux.temp));
        const loadLines = load
            .replace(/\t|:|,|-/gi, '')
            .trim()
            .split('\n')
            .map((line) => {
            const words = line
                .replace(/\s+/g, ' ')
                .trim()
                .split(' ');
            return words;
        });
        const cpuLines = cpu
            .replace(/\t|:/gi, '')
            .trim()
            .split('\n')
            .map((line) => {
            return line.replace(/\s+/g, ' ').trim();
        });
        const memLines = mem
            .replace(/\t|:/gi, '')
            .trim()
            .split('\n')
            .map((line) => {
            const words = line
                .replace(/\s+/g, ' ')
                .trim()
                .split(' ');
            return words[words.length - 2];
        });
        const diskLines = disk
            .replace(/\t|:|M|G|%/gi, '')
            .trim()
            .split('\n')
            .map((line) => {
            const words = line
                .replace(/\s+/g, ' ')
                .trim()
                .split(' ');
            return {
                storageUsed: words[2],
                totalStorage: words[1],
                storageUsage: words[4],
            };
        })
            .reduce((disks, disk) => {
            return {
                storageUsed: disks.storageUsed + disk.storageUsed,
                totalStorage: disks.totalStorage + disk.totalStorage,
                storageUsage: disks.storageUsage + disk.storageUsage,
            };
        });
        const tempLines = temp
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
    }
    else if (os === 'Darwin') {
        const { stdout: load } = yield (isSSH
            ? exec.execCommand(Config_1.COMMAND.darwin.load)
            : exec(Config_1.COMMAND.darwin.load));
        const { stdout: cpu } = yield (isSSH
            ? exec.execCommand(Config_1.COMMAND.darwin.cpu)
            : exec(Config_1.COMMAND.darwin.cpu));
        const { stdout: usedMem } = yield (isSSH
            ? exec.execCommand(Config_1.COMMAND.darwin.mem.used)
            : exec(Config_1.COMMAND.darwin.mem.used));
        const { stdout: totalMem } = yield (isSSH
            ? exec.execCommand(Config_1.COMMAND.darwin.mem.total)
            : exec(Config_1.COMMAND.darwin.mem.total));
        const { stdout: swapMem } = yield (isSSH
            ? exec.execCommand(Config_1.COMMAND.darwin.mem.swap)
            : exec(Config_1.COMMAND.darwin.mem.swap));
        const { stdout: disk } = yield (isSSH
            ? exec.execCommand(Config_1.COMMAND.darwin.disk)
            : exec(Config_1.COMMAND.darwin.disk));
        const { stdout: temp } = yield (isSSH
            ? exec.execCommand(Config_1.COMMAND.darwin.temp)
            : exec(Config_1.COMMAND.darwin.temp));
        const loadLines = load
            .replace(/\t|:|,|-|%/gi, '')
            .trim()
            .split('\n')
            .map((line) => {
            const words = line
                .replace(/\s+/g, ' ')
                .trim()
                .split(' ');
            return words;
        });
        const memLines = usedMem
            .replace(/\t|:|M|G|\(|\)/gi, '')
            .replace(/\s+/g, ' ')
            .trim()
            .split(' ');
        const swapLines = swapMem
            .replace(/\t|:|M|G|\(|\)|=/gi, '')
            .replace(/\s+/g, ' ')
            .trim()
            .split(' ');
        const diskLines = disk
            .replace(/\t|:|Mi|Gi|%/gi, '')
            .trim()
            .split('\n')
            .map((line) => {
            const words = line
                .replace(/\s+/g, ' ')
                .trim()
                .split(' ');
            return {
                storageUsed: words[2],
                totalStorage: words[1],
                storageUsage: words[4],
            };
        })
            .reduce((disks, disk) => {
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
    }
    else if (os === 'Windows') {
        const { stdout: load } = yield (isSSH
            ? exec.execCommand(Config_1.COMMAND.win.load)
            : exec(Config_1.COMMAND.win.load));
        const { stdout: cpu } = yield (isSSH
            ? exec.execCommand(Config_1.COMMAND.win.cpu)
            : exec(Config_1.COMMAND.win.cpu));
        const { stdout: freeMem } = yield (isSSH
            ? exec.execCommand(Config_1.COMMAND.win.mem.free)
            : exec(Config_1.COMMAND.win.mem.free));
        const { stdout: totalMem } = yield (isSSH
            ? exec.execCommand(Config_1.COMMAND.win.mem.total)
            : exec(Config_1.COMMAND.win.mem.total));
        const { stdout: totalSwapMem } = yield (isSSH
            ? exec.execCommand(Config_1.COMMAND.win.mem.totalSwap)
            : exec(Config_1.COMMAND.win.mem.totalSwap));
        const { stdout: freeSwapMem } = yield (isSSH
            ? exec.execCommand(Config_1.COMMAND.win.mem.freeSwap)
            : exec(Config_1.COMMAND.win.mem.freeSwap));
        const { stdout: freeDisk } = yield (isSSH
            ? exec.execCommand(Config_1.COMMAND.win.disk.free)
            : exec(Config_1.COMMAND.win.disk.free));
        const { stdout: totalDisk } = yield (isSSH
            ? exec.execCommand(Config_1.COMMAND.win.disk.total)
            : exec(Config_1.COMMAND.win.disk.total));
        const { stdout: temp } = yield (isSSH
            ? exec.execCommand(Config_1.COMMAND.win.temp)
            : exec(Config_1.COMMAND.win.temp));
        const loadLines = load.replace(/\s+/g, ' ').trim().split(' ');
        const cpuLines = cpu.replace(/\s+/g, ' ').trim().split(' ');
        const freeMemLines = freeMem
            .replace(/\s+/g, ' ')
            .trim()
            .split(' ');
        const totalMemLines = totalMem
            .replace(/\s+/g, ' ')
            .trim()
            .split(' ');
        const totalSwapMemLines = totalSwapMem
            .replace(/\s+/g, ' ')
            .trim()
            .split(' ');
        const freeSwapMemLines = freeSwapMem
            .replace(/\s+/g, ' ')
            .trim()
            .split(' ');
        const freeDiskLines = freeDisk
            .replace(/\s+/g, ' ')
            .trim()
            .split(' ');
        const totalDiskLines = totalDisk
            .replace(/\s+/g, ' ')
            .trim()
            .split(' ');
        const tempLines = temp.replace(/\s+/g, ' ').trim().split(' ');
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
});
