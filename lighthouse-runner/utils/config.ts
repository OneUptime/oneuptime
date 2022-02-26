// @ts-expect-error ts-migrate(2732) FIXME: Cannot find module '../package.json'. Consider usi... Remove this comment to see the full error message
import packageJson from '../package.json'

const COMMAND = {
    linux: {
        load: "top -b -n 2 | egrep --color 'load average|%Cpu'",
        cpu: "egrep --color 'processor|cores' /proc/cpuinfo",
        mem: "egrep --color 'Mem|Swap' /proc/meminfo",
        disk: "df -h | egrep --color '/dev/xvda1|/dev/sda7|/dev/nvme0n1p1'",
        temp: "sensors | egrep --color 'CPU'",
    },
    darwin: {
        load: "top -l 1 | egrep --color 'Load Avg|CPU usage'",
        cpu: 'sysctl -n machdep.cpu.core_count',
        mem: {
            used: "top -l 1 | egrep --color 'PhysMem'",
            total: 'sysctl -n hw.memsize',
            swap: 'sysctl -n vm.swapusage',
        },
        disk: "df -h | egrep --color '/dev/disk1s2'",
        temp: 'sysctl -n machdep.xcpm.cpu_thermal_level',
    },
    win: {
        load: 'wmic cpu get loadpercentage',
        cpu: 'wmic cpu get numberofcores',
        mem: {
            free: 'wmic os get freephysicalmemory',
            total: 'wmic computersystem get totalphysicalmemory',
            totalSwap: 'wmic os get totalvirtualmemorySize',
            freeSwap: 'wmic os get freevirtualmemory',
        },
        disk: {
            total: 'wmic logicaldisk get size',
            free: 'wmic logicaldisk get freespace',
        },
        temp: 'wmic computersystem get thermalstate',
    },
};

export default {
    COMMAND,
    serverUrl: process.env['SERVER_URL'],
    clusterKey: process.env['CLUSTER_KEY'],
    lighthouseVersion: packageJson.version,
};
