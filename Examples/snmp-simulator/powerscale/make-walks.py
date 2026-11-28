"""Write the ISILON-MIB walks of a simulated four-node PowerScale cluster.

These are the walks the SNMP simulator replays for the Storage Array
Agent's PowerScale config (docker-compose.yml in this folder) and that the
recorded capture the tests read was taken from (record-capture.sh). No real
PowerScale was walked to make them: they are assembled, object by object,
from Dell's ISILON-MIB (the 2015 revision, which OneFS 9's documentation
still lists object for object) and the public captures of real clusters:

  - sysDescr and sysObjectID as LibreNMS's onefs_v8.snmprec and Datadog's
    isilon.snmprec record them (OneFS 8 answers with FreeBSD's
    1.3.6.1.4.1.12325.1.1.2.1.1);
  - the F710 chassis model string from LibreNMS's onefs.snmprec;
  - the /ifs total and one quota row (/ifs/data/pacs) from Checkmk's
    regression data, and a power supply's "230.0" volts;
  - drive statuses (HEALTHY, SMARTFAIL, DEAD, ...) as Datadog's capture and
    the MIB's own description list them, and the encodings of every index
    (a quota's 48-character domain id, a protocol's IMPLIED name).

The cluster subtree (1.3.6.1.4.1.12124.1) is identical on every node; the
node subtree (1.3.6.1.4.1.12124.2) and IF-MIB describe the node that
answers. Node 3 is offline: it has no walk, so nothing answers at its
address.

Usage, from this folder: python3 make-walks.py ../data
(writes ../data/powerscale-node-<n>/public.snmprec)
"""

import hashlib
import os
import sys

TAG_INTEGER = "2"
TAG_STRING = "4"
TAG_OID = "6"
TAG_COUNTER32 = "65"
TAG_GAUGE32 = "66"
TAG_TIMETICKS = "67"
TAG_COUNTER64 = "70"

ISILON = "1.3.6.1.4.1.12124"
CLUSTER = ISILON + ".1"
NODE = ISILON + ".2"

CLUSTER_NAME = "ps-prod"
ONEFS = "9.11.0.0"
F710_MODEL = "F710-1U-Dual-512GB-2x1GE-2x100GE QSFP+-300TB SSD"
TiB = 1024**4
GiB = 1024**3


def oid_key(oid):
    return [int(part) for part in oid.split(".")]


def implied_index(text):
    # IMPLIED string index: the characters' codes, no length.
    return ".".join(str(ord(c)) for c in text)


def string_index(text):
    # A DisplayString index without IMPLIED: its length first.
    return str(len(text)) + "." + implied_index(text)


def cluster_rows():
    rows = []

    def add(oid, tag, value):
        rows.append((oid, tag, str(value)))

    # clusterStatus
    add(CLUSTER + ".1.1.0", TAG_STRING, CLUSTER_NAME)
    add(CLUSTER + ".1.2.0", TAG_INTEGER, 1)  # attn
    add(CLUSTER + ".1.3.0", TAG_STRING, "0007430b7a2a6c0a8c5d1a0e9a5b5b6c7f8e")
    add(CLUSTER + ".1.4.0", TAG_INTEGER, 4)
    add(CLUSTER + ".1.5.0", TAG_STRING, "1,2,3,4")
    add(CLUSTER + ".1.6.0", TAG_STRING, "1,2,4")
    add(CLUSTER + ".1.7.0", TAG_STRING, "3")

    # clusterPerformance: /ifs throughput (bits per second), network, CPU
    add(CLUSTER + ".2.1.1.0", TAG_COUNTER64, 91840275324928)
    add(CLUSTER + ".2.1.2.0", TAG_COUNTER64, 1200000000)  # in: writes, 150 MB/s
    add(CLUSTER + ".2.1.3.0", TAG_COUNTER64, 287540138819584)
    add(CLUSTER + ".2.1.4.0", TAG_COUNTER64, 3600000000)  # out: reads, 450 MB/s
    add(CLUSTER + ".2.2.2.0", TAG_COUNTER64, 1320000000)
    add(CLUSTER + ".2.2.4.0", TAG_COUNTER64, 3840000000)
    add(CLUSTER + ".2.3.1.0", TAG_GAUGE32, 182)
    add(CLUSTER + ".2.3.2.0", TAG_GAUGE32, 0)
    add(CLUSTER + ".2.3.3.0", TAG_GAUGE32, 96)
    add(CLUSTER + ".2.3.4.0", TAG_GAUGE32, 21)
    add(CLUSTER + ".2.3.5.0", TAG_GAUGE32, 701)

    # ifsFilesystem: 560 TiB (Checkmk's recorded total), 72% no longer
    # available for writes, 2% of it the virtual hot spare reserve.
    total = 615553001652224
    available = 172354840462622
    free = 184666900495666
    used = total - free
    add(CLUSTER + ".3.1.0", TAG_COUNTER64, total)
    add(CLUSTER + ".3.2.0", TAG_COUNTER64, used)
    add(CLUSTER + ".3.3.0", TAG_COUNTER64, available)
    add(CLUSTER + ".3.4.0", TAG_COUNTER64, free)
    add(CLUSTER + ".3.10.0", TAG_INTEGER, 0)
    add(CLUSTER + ".3.11.0", TAG_INTEGER, 0)

    # quotaTable: (type, id, path, includes snapshots, hard, soft, advisory,
    # grace period, usage, usage with overhead, inodes, includes overhead).
    # A threshold of None is not defined (its value reads 0, its flag no).
    quotas = [
        (4, 0, "/ifs/data/home", 0, 10 * TiB, 9 * TiB, 8 * TiB, 604800,
         int(9.6 * TiB), int(11.9 * TiB), 48210334, 0),
        (4, 0, "/ifs/data/projects", 1, 50 * TiB, None, 40 * TiB, 0,
         21 * TiB, int(26.2 * TiB), 9120554, 0),
        # Checkmk's recorded row: a soft limit of 200 TiB and no hard limit.
        (4, 0, "/ifs/data/pacs", 0, None, 219902325555200, None, 1209600,
         3844608548041, 4805760685051, 1203392, 0),
        (1, 2001, "/ifs/data/home", 0, 500 * GiB, None, None, 0,
         498 * GiB, int(622.5 * GiB), 2210411, 0),
        (3, 3000, "/ifs/data/projects", 1, 20 * TiB, None, 16 * TiB, 0,
         1 * TiB, int(1.25 * TiB), 310558, 0),
        (4, 0, "/ifs/data/scratch", 0, None, None, None, 0,
         7 * TiB, int(8.75 * TiB), 66123987, 0),
        (0, 0, "/ifs/data/home", 0, 1 * TiB, None, None, 0, 0, 0, 0, 0),
    ]
    entry = CLUSTER + ".12.1.1"
    for quota in quotas:
        (qtype, qid, path, snaps, hard, soft, advisory, grace, usage,
         overhead, inodes, inc_overhead) = quota
        domain = hashlib.sha1(f"{qtype}|{qid}|{path}".encode()).hexdigest()
        domain = (domain + domain)[:48]
        index = string_index(domain)
        columns = [
            (2, TAG_INTEGER, qtype),
            (3, TAG_GAUGE32, qid),
            (4, TAG_INTEGER, snaps),
            (5, TAG_STRING, path),
            (6, TAG_INTEGER, 0 if hard is None else 1),
            (7, TAG_COUNTER64, hard or 0),
            (8, TAG_INTEGER, 0 if soft is None else 1),
            (9, TAG_COUNTER64, soft or 0),
            (10, TAG_INTEGER, 0 if advisory is None else 1),
            (11, TAG_COUNTER64, advisory or 0),
            (12, TAG_INTEGER, grace),
            (13, TAG_COUNTER64, usage),
            (14, TAG_COUNTER64, overhead),
            (15, TAG_COUNTER64, inodes),
            (16, TAG_INTEGER, inc_overhead),
        ]
        for column, tag, value in columns:
            add(f"{entry}.{column}.{index}", tag, value)
    return rows


# Per node: health (0 ok, 1 attn), protocol load and the drive statuses.
NODES = {
    1: {
        "health": 0,
        "ifs_in": 420000000,
        "ifs_out": 1300000000,
        "cpu_idle": 690,
        "serial": "JWXCK1000001",
        "drives": {},
        "protocols": {
            "nfs3": (88412093, 5210, 380000000, 1150000000, 120, 48210, 640, 910),
            "nfs4": (1203385, 140, 4000000, 18000000, 160, 21004, 910, 1200),
            "smb2": (40213377, 1630, 52000000, 310000000, 210, 98022, 2300, 4100),
            "hdfs": (0, 0, 0, 0, 0, 0, 0, 0),
            "http": (10224, 0, 0, 0, 0, 0, 0, 0),
            "nlm": (322941, 12, 0, 0, 40, 1020, 60, 80),
            "siq": (80020, 4, 64000000, 0, 300, 15020, 1100, 900),
        },
    },
    2: {
        "health": 1,
        "ifs_in": 380000000,
        "ifs_out": 1150000000,
        "cpu_idle": 612,
        "serial": "JWXCK1000002",
        # Bay 3 is being smartfailed: OneFS moves its data off before it is
        # replaced, and the node needs attention meanwhile.
        "drives": {3: "SMARTFAIL"},
        "protocols": {
            "nfs3": (80102944, 4780, 340000000, 1020000000, 130, 61022, 880, 1300),
            "nfs4": (1010344, 120, 3500000, 15000000, 170, 23011, 940, 1250),
            "smb2": (51028812, 2210, 61000000, 360000000, 230, 154022, 24800, 17000),
            "hdfs": (0, 0, 0, 0, 0, 0, 0, 0),
            "http": (8873, 0, 0, 0, 0, 0, 0, 0),
            "nlm": (290112, 10, 0, 0, 40, 980, 55, 70),
            "siq": (0, 0, 0, 0, 0, 0, 0, 0),
        },
    },
    4: {
        "health": 0,
        "ifs_in": 400000000,
        "ifs_out": 1150000000,
        "cpu_idle": 701,
        "serial": "JWXCK1000004",
        # Bay 10 holds no drive.
        "drives": {10: "EMPTY"},
        "protocols": {
            "nfs3": (79855201, 4650, 330000000, 990000000, 115, 45011, 610, 870),
            "nfs4": (998432, 110, 3200000, 14000000, 150, 19882, 870, 1150),
            "smb2": (38112455, 1510, 48000000, 290000000, 200, 90011, 2100, 3800),
            "hdfs": (0, 0, 0, 0, 0, 0, 0, 0),
            "http": (9012, 0, 0, 0, 0, 0, 0, 0),
            "nlm": (300221, 11, 0, 0, 40, 1001, 58, 75),
            "siq": (0, 0, 0, 0, 0, 0, 0, 0),
        },
    },
}

DRIVE_BYTES = 30720000000000  # 30.72 TB NVMe, ten to an F710: its 300TB SSD
DRIVE_MODEL = "KIOXIA KCM6XRUL30T7"
DRIVE_FIRMWARE = "0109"


def node_rows(lnn, node):
    rows = []

    def add(oid, tag, value):
        rows.append((oid, tag, str(value)))

    name = f"{CLUSTER_NAME}-{lnn}"
    add("1.3.6.1.2.1.1.1.0", TAG_STRING, f"{name} 4280738515 Isilon OneFS v{ONEFS}")
    add("1.3.6.1.2.1.1.2.0", TAG_OID, "1.3.6.1.4.1.12325.1.1.2.1.1")
    add("1.3.6.1.2.1.1.3.0", TAG_TIMETICKS, 1887720800 + lnn * 1000)
    add("1.3.6.1.2.1.1.5.0", TAG_STRING, name)

    # IF-MIB: the loopback, two front-end 100GbE ports (ext-1 up; ext-2 has
    # no cable, administratively up) and the two back-end ports.
    interfaces = [
        (1, "lo0", 24, 1, 1, 0),
        (2, "mce0", 6, 1, 1, 100000),
        (3, "mce1", 6, 1, 2, 100000),
        (4, "mce2", 6, 1, 1, 100000),
        (5, "mce3", 6, 1, 1, 100000),
    ]
    for if_index, if_name, if_type, admin, oper, speed in interfaces:
        add(f"1.3.6.1.2.1.2.2.1.1.{if_index}", TAG_INTEGER, if_index)
        add(f"1.3.6.1.2.1.2.2.1.2.{if_index}", TAG_STRING, if_name)
        add(f"1.3.6.1.2.1.2.2.1.3.{if_index}", TAG_INTEGER, if_type)
        add(f"1.3.6.1.2.1.2.2.1.7.{if_index}", TAG_INTEGER, admin)
        add(f"1.3.6.1.2.1.2.2.1.8.{if_index}", TAG_INTEGER, oper)
        add(f"1.3.6.1.2.1.31.1.1.1.1.{if_index}", TAG_STRING, if_name)
        add(f"1.3.6.1.2.1.31.1.1.1.15.{if_index}", TAG_GAUGE32, speed)

    rows.extend(cluster_rows())

    # nodeStatus
    add(NODE + ".1.1.0", TAG_STRING, name)
    add(NODE + ".1.2.0", TAG_INTEGER, node["health"])
    add(NODE + ".1.3.0", TAG_INTEGER, 0)  # storage
    add(NODE + ".1.4.0", TAG_INTEGER, 0)  # not read-only

    # nodePerformance: /ifs throughput through this node, network, CPU
    add(NODE + ".2.1.1.0", TAG_COUNTER64, 30613425108309 + lnn)
    add(NODE + ".2.1.2.0", TAG_COUNTER64, node["ifs_in"])
    add(NODE + ".2.1.3.0", TAG_COUNTER64, 95846712939861 + lnn)
    add(NODE + ".2.1.4.0", TAG_COUNTER64, node["ifs_out"])
    add(NODE + ".2.2.2.0", TAG_COUNTER64, node["ifs_in"] + 20000000)
    add(NODE + ".2.2.4.0", TAG_COUNTER64, node["ifs_out"] + 60000000)
    idle = node["cpu_idle"]
    add(NODE + ".2.3.1.0", TAG_GAUGE32, (1000 - idle) * 6 // 10)
    add(NODE + ".2.3.2.0", TAG_GAUGE32, 0)
    add(NODE + ".2.3.3.0", TAG_GAUGE32, (1000 - idle) * 3 // 10)
    add(NODE + ".2.3.4.0", TAG_GAUGE32, (1000 - idle) - (1000 - idle) * 9 // 10)
    add(NODE + ".2.3.5.0", TAG_GAUGE32, idle)

    # nodeProtocolPerfTable, indexed by the protocol's name (IMPLIED)
    entry = NODE + ".2.10.1"
    for protocol, values in node["protocols"].items():
        (op_count, ops, in_bits, out_bits, lat_min, lat_max, lat_avg, lat_std) = values
        index = implied_index(protocol)
        columns = [
            (1, TAG_STRING, protocol),
            (2, TAG_GAUGE32, op_count % 4294967296),
            (3, TAG_GAUGE32, ops),
            (4, TAG_GAUGE32, 0 if ops == 0 else 120),
            (5, TAG_GAUGE32, 0 if ops == 0 else 1048576),
            (6, TAG_GAUGE32, 0 if ops == 0 else 32768),
            (7, TAG_GAUGE32, 0 if ops == 0 else 65536),
            (8, TAG_COUNTER64, in_bits),
            (9, TAG_GAUGE32, 0 if ops == 0 else 96),
            (10, TAG_GAUGE32, 0 if ops == 0 else 1048576),
            (11, TAG_GAUGE32, 0 if ops == 0 else 65536),
            (12, TAG_GAUGE32, 0 if ops == 0 else 131072),
            (13, TAG_COUNTER64, out_bits),
            (14, TAG_GAUGE32, lat_min),
            (15, TAG_GAUGE32, lat_max),
            (16, TAG_GAUGE32, lat_avg),
            (17, TAG_GAUGE32, lat_std),
        ]
        for column, tag, value in columns:
            add(f"{entry}.{column}.{index}", tag, value)

    # diskPerfTable, by bay
    for bay in range(1, 11):
        status = node["drives"].get(bay, "HEALTHY")
        busy = status in ("HEALTHY", "SMARTFAIL")
        add(f"{NODE}.2.52.1.1.{bay}", TAG_INTEGER, bay)
        add(f"{NODE}.2.52.1.2.{bay}", TAG_STRING, "" if status == "EMPTY" else f"nvd{bay - 1}")
        add(f"{NODE}.2.52.1.3.{bay}", TAG_GAUGE32, 1840 + bay * 13 if busy else 0)
        add(f"{NODE}.2.52.1.4.{bay}", TAG_COUNTER64, 418000000 + bay * 1000000 if busy else 0)
        add(f"{NODE}.2.52.1.5.{bay}", TAG_COUNTER64, 1250000000 + bay * 1000000 if busy else 0)

    # chassisTable: the node's one chassis
    add(NODE + ".51.1.1.1", TAG_INTEGER, 1)
    add(NODE + ".51.1.2.1", TAG_STRING, "400-0118-01")
    add(NODE + ".51.1.3.1", TAG_STRING, node["serial"])
    add(NODE + ".51.1.4.1", TAG_STRING, F710_MODEL)
    add(NODE + ".51.1.5.1", TAG_INTEGER, 0)

    # diskTable, by bay
    for bay in range(1, 11):
        status = node["drives"].get(bay, "HEALTHY")
        empty = status == "EMPTY"
        add(f"{NODE}.52.1.1.{bay}", TAG_INTEGER, bay)
        add(f"{NODE}.52.1.2.{bay}", TAG_INTEGER, 0 if empty else bay - 1)
        add(f"{NODE}.52.1.3.{bay}", TAG_INTEGER, 1)
        add(f"{NODE}.52.1.4.{bay}", TAG_STRING, "" if empty else f"/dev/nvd{bay - 1}")
        add(f"{NODE}.52.1.5.{bay}", TAG_STRING, status)
        add(f"{NODE}.52.1.6.{bay}", TAG_STRING, "" if empty else DRIVE_MODEL)
        add(f"{NODE}.52.1.7.{bay}", TAG_STRING, "" if empty else f"X0Q0A0{lnn}{bay:02d}TJ7")
        add(f"{NODE}.52.1.8.{bay}", TAG_STRING, "" if empty else DRIVE_FIRMWARE)
        add(f"{NODE}.52.1.9.{bay}", TAG_COUNTER64, 0 if empty else DRIVE_BYTES)

    # fanTable
    fans = [(1, "FAN1", "Fan 1 speed", 9120), (2, "FAN2", "Fan 2 speed", 9180),
            (3, "FAN3", "Fan 3 speed", 9060), (4, "FAN4", "Fan 4 speed", 9240)]
    for number, fan_name, description, speed in fans:
        add(f"{NODE}.53.1.1.{number}", TAG_INTEGER, number)
        add(f"{NODE}.53.1.2.{number}", TAG_STRING, fan_name)
        add(f"{NODE}.53.1.3.{number}", TAG_STRING, description)
        add(f"{NODE}.53.1.4.{number}", TAG_INTEGER, speed + lnn * 10)

    # tempSensorTable: readings are strings in the MIB; a sensor without a
    # reading answers N/A.
    temps = [(1, "TEMP_FP", "Temp Front Panel", "22.0"),
             (2, "TEMP_CPU1", "Temp CPU 1", f"{50 + lnn}.0"),
             (3, "TEMP_CPU2", "Temp CPU 2", f"{48 + lnn}.0"),
             (4, "TEMP_PS1", "Temp Power Supply 1", "31.0"),
             (5, "TEMP_PS2", "Temp Power Supply 2", "N/A")]
    for number, sensor_name, description, value in temps:
        add(f"{NODE}.54.1.1.{number}", TAG_INTEGER, number)
        add(f"{NODE}.54.1.2.{number}", TAG_STRING, sensor_name)
        add(f"{NODE}.54.1.3.{number}", TAG_STRING, description)
        add(f"{NODE}.54.1.4.{number}", TAG_STRING, value)

    # powerSensorTable: volts or amps, as strings (Checkmk's recorded
    # "Power Supply 1 Input Voltage" reads 230.0).
    power = [(1, "PS1_VIN", "Power Supply 1 Input Voltage", "230.0"),
             (2, "PS2_VIN", "Power Supply 2 Input Voltage", "229.0"),
             (3, "PS1_IOUT", "Power Supply 1 Output Current", "11.5"),
             (4, "PS2_IOUT", "Power Supply 2 Output Current", "11.2")]
    for number, sensor_name, description, value in power:
        add(f"{NODE}.55.1.1.{number}", TAG_INTEGER, number)
        add(f"{NODE}.55.1.2.{number}", TAG_STRING, sensor_name)
        add(f"{NODE}.55.1.3.{number}", TAG_STRING, description)
        add(f"{NODE}.55.1.4.{number}", TAG_STRING, value)

    return rows


def main():
    out_dir = sys.argv[1]
    for lnn, node in NODES.items():
        rows = sorted(node_rows(lnn, node), key=lambda row: oid_key(row[0]))
        seen = set()
        for oid, _, _ in rows:
            if oid in seen:
                raise SystemExit(f"duplicate OID {oid} on node {lnn}")
            seen.add(oid)
        node_dir = os.path.join(out_dir, f"powerscale-node-{lnn}")
        os.makedirs(node_dir, exist_ok=True)
        with open(os.path.join(node_dir, "public.snmprec"), "w") as handle:
            for oid, tag, value in rows:
                handle.write(f"{oid}|{tag}|{value}\n")
        print(f"{node_dir}/public.snmprec: {len(rows)} rows")


if __name__ == "__main__":
    main()
