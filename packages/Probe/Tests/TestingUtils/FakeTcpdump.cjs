/*
 * A stand-in for tcpdump, for the packet capture runner's tests: run as
 *
 *   node FakeTcpdump.cjs <mode> <tcpdump's arguments...>
 *
 * (the runner's CaptureCommand puts the script and the mode before the
 * arguments it builds). It writes a pcap file to standard output the way
 * `tcpdump -w - -U` does - the global header, then each packet as it is
 * "captured" - and its messages to standard error in tcpdump's words, so
 * every way a real capture ends can be run without root, an interface or
 * tcpdump itself:
 *
 *   stream        packets every 20 ms until SIGINT, then "N packets captured"
 *   count         exactly the -c packets, then exits 0 (the packet limit)
 *   burst         1500-byte packets as fast as it can until SIGINT
 *   die           3 packets, then stops with an error of its own
 *   ignoresigint  packets until SIGKILL: SIGINT is ignored
 *   permission    refuses to open the interface
 *   nodevice      the interface does not exist
 *   badfilter     the filter does not compile
 *   silentfail    exits 1 with nothing to say
 *   version       answers --version as tcpdump 4.99.3 does
 *   noversion     answers --version with nothing, exit 1
 *   novline       answers --version with something else, exit 0
 *
 * A mode written "count@/some/file.json" first writes the arguments it was
 * started with to that file, as JSON. (Not an environment variable: a jest
 * test's process.env is its own copy, which a child never sees.)
 */
const fs = require("fs");

const [mode, argsFile] = (process.argv[2] || "").split("@");
const args = process.argv.slice(3);

if (argsFile) {
  fs.writeFileSync(argsFile, JSON.stringify(args));
}

function argumentAfter(flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

const interfaceName = argumentAfter("-i") || "any";
let packets = 0;

function header() {
  const buffer = Buffer.alloc(24);
  buffer.writeUInt32LE(0xa1b2c3d4, 0);
  buffer.writeUInt16LE(2, 4);
  buffer.writeUInt16LE(4, 6);
  buffer.writeUInt32LE(262144, 16);
  buffer.writeUInt32LE(interfaceName === "any" ? 113 : 1, 20);
  return buffer;
}

function packet(length) {
  const buffer = Buffer.alloc(16 + length);
  buffer.writeUInt32LE(1760000000 + packets, 0);
  buffer.writeUInt32LE(length, 8);
  buffer.writeUInt32LE(length, 12);
  buffer.fill(packets & 0xff, 16);
  packets++;
  return buffer;
}

function listening() {
  process.stderr.write(
    `tcpdump: listening on ${interfaceName}, link-type EN10MB (Ethernet), snapshot length 262144 bytes\n`,
  );
}

function finish(exitCode) {
  process.stderr.write(
    `${packets} packets captured\n${packets} packets received by filter\n0 packets dropped by kernel\n`,
  );
  process.stdout.write(Buffer.alloc(0), () => {
    process.exit(exitCode);
  });
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

switch (mode) {
  case "version":
    process.stdout.write("tcpdump version 4.99.3\nlibpcap version 1.10.3\n");
    process.exit(0);
    break;
  case "noversion":
    process.exit(1);
    break;
  case "novline":
    process.stdout.write("usage: tcpdump [-AbdDefhHIJKlLnNOpqStuUvxX#]\n");
    process.exit(0);
    break;
  case "permission":
    fail(
      `tcpdump: ${interfaceName}: You don't have permission to perform this capture on that device\n(socket: Operation not permitted)`,
    );
    break;
  case "nodevice":
    fail(
      `tcpdump: ${interfaceName}: No such device exists\n(No such device exists)`,
    );
    break;
  case "badfilter":
    fail("tcpdump: syntax error in filter expression: syntax error");
    break;
  case "silentfail":
    process.exit(1);
    break;
  case "count": {
    listening();
    const count = Number(argumentAfter("-c") || "1");
    const chunks = [header()];
    for (let index = 0; index < count; index++) {
      chunks.push(packet(60));
    }
    process.stdout.write(Buffer.concat(chunks), () => {
      finish(0);
    });
    break;
  }
  case "die": {
    listening();
    process.stdout.write(
      Buffer.concat([header(), packet(60), packet(60), packet(60)]),
      () => {
        process.stderr.write("tcpdump: pcap_loop: The interface disappeared\n");
        finish(1);
      },
    );
    break;
  }
  case "stream": {
    listening();
    process.stdout.write(header());
    const timer = setInterval(() => {
      process.stdout.write(packet(60));
    }, 20);
    process.on("SIGINT", () => {
      clearInterval(timer);
      finish(0);
    });
    break;
  }
  case "burst": {
    listening();
    process.stdout.write(header());
    let isStopped = false;
    const write = () => {
      while (!isStopped) {
        if (!process.stdout.write(packet(1500))) {
          process.stdout.once("drain", write);
          return;
        }
      }
    };
    process.on("SIGINT", () => {
      isStopped = true;
      finish(0);
    });
    write();
    break;
  }
  case "ignoresigint": {
    listening();
    process.stdout.write(header());
    process.on("SIGINT", () => {
      // tcpdump wedged: it does not stop.
    });
    setInterval(() => {
      process.stdout.write(packet(60));
    }, 20);
    break;
  }
  default:
    fail(`FakeTcpdump: unknown mode "${mode}"`);
}
