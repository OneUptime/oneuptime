/*
 * Writes traffic.pcap: a small, invented traffic sample (documentation and
 * private addresses only) that real flow exporters (softflowd, pmacct)
 * read to produce the NetFlow / IPFIX / sFlow datagrams the probe tests
 * use as fixtures.
 */
const fs = require("fs");

const out = process.argv[2] || "traffic.pcap";

function checksum(buf) {
  let sum = 0;
  for (let i = 0; i < buf.length; i += 2) {
    sum += (buf[i] << 8) + (i + 1 < buf.length ? buf[i + 1] : 0);
  }
  while (sum >> 16) sum = (sum & 0xffff) + (sum >> 16);
  return ~sum & 0xffff;
}

function ipv4(src, dst, proto, payload, ttl = 64) {
  const h = Buffer.alloc(20);
  h[0] = 0x45;
  h[1] = 0;
  h.writeUInt16BE(20 + payload.length, 2);
  h.writeUInt16BE(0x1234, 4);
  h.writeUInt16BE(0x4000, 6);
  h[8] = ttl;
  h[9] = proto;
  src.split(".").forEach((o, i) => (h[12 + i] = Number(o)));
  dst.split(".").forEach((o, i) => (h[16 + i] = Number(o)));
  h.writeUInt16BE(checksum(h), 10);
  return Buffer.concat([h, payload]);
}

function ipv6Bytes(addr) {
  // Expand "::" forms.
  const [head, tail] = addr.split("::");
  const h = head ? head.split(":") : [];
  const t = tail !== undefined && tail ? tail.split(":") : [];
  const groups = [...h, ...Array(8 - h.length - t.length).fill("0"), ...t];
  const b = Buffer.alloc(16);
  groups.forEach((g, i) => b.writeUInt16BE(parseInt(g, 16), i * 2));
  return b;
}

function ipv6(src, dst, nextHeader, payload) {
  const h = Buffer.alloc(40);
  h.writeUInt32BE(0x60000000, 0);
  h.writeUInt16BE(payload.length, 4);
  h[6] = nextHeader;
  h[7] = 64;
  ipv6Bytes(src).copy(h, 8);
  ipv6Bytes(dst).copy(h, 24);
  return Buffer.concat([h, payload]);
}

function tcp(sport, dport, flags, dataLength) {
  const h = Buffer.alloc(20 + dataLength);
  h.writeUInt16BE(sport, 0);
  h.writeUInt16BE(dport, 2);
  h.writeUInt32BE(1000, 4);
  h.writeUInt32BE(2000, 8);
  h[12] = 0x50;
  h[13] = flags;
  h.writeUInt16BE(65535, 14);
  for (let i = 0; i < dataLength; i++) h[20 + i] = (i * 7) & 0xff;
  return h;
}

function udp(sport, dport, dataLength) {
  const h = Buffer.alloc(8 + dataLength);
  h.writeUInt16BE(sport, 0);
  h.writeUInt16BE(dport, 2);
  h.writeUInt16BE(8 + dataLength, 4);
  for (let i = 0; i < dataLength; i++) h[8 + i] = (i * 13) & 0xff;
  return h;
}

function icmpEcho(type, dataLength) {
  const h = Buffer.alloc(8 + dataLength);
  h[0] = type;
  h[1] = 0;
  h.writeUInt16BE(0x77, 4);
  h.writeUInt16BE(1, 6);
  h.writeUInt16BE(checksum(h), 2);
  return h;
}

const MAC_A = Buffer.from([0x02, 0x00, 0x00, 0x00, 0x00, 0x0a]);
const MAC_B = Buffer.from([0x02, 0x00, 0x00, 0x00, 0x00, 0x0b]);

function ether(payload, etherType, vlan) {
  if (vlan !== undefined) {
    const h = Buffer.alloc(18);
    MAC_B.copy(h, 0);
    MAC_A.copy(h, 6);
    h.writeUInt16BE(0x8100, 12);
    h.writeUInt16BE(vlan, 14);
    h.writeUInt16BE(etherType, 16);
    return Buffer.concat([h, payload]);
  }
  const h = Buffer.alloc(14);
  MAC_B.copy(h, 0);
  MAC_A.copy(h, 6);
  h.writeUInt16BE(etherType, 12);
  return Buffer.concat([h, payload]);
}

const packets = [];
let t = 1767225600; // 2026-01-01T00:00:00Z
let usec = 0;

function add(frame, stepUsec = 20000) {
  usec += stepUsec;
  while (usec >= 1000000) {
    usec -= 1000000;
    t += 1;
  }
  packets.push({ sec: t, usec: usec, frame });
}

// 1. HTTPS: 10.0.0.5:51000 <-> 198.51.100.20:443 (IPv4 TCP), a download.
add(ether(ipv4("10.0.0.5", "198.51.100.20", 6, tcp(51000, 443, 0x02, 0)), 0x0800));
add(ether(ipv4("198.51.100.20", "10.0.0.5", 6, tcp(443, 51000, 0x12, 0)), 0x0800));
add(ether(ipv4("10.0.0.5", "198.51.100.20", 6, tcp(51000, 443, 0x10, 0)), 0x0800));
for (let i = 0; i < 12; i++) {
  add(ether(ipv4("10.0.0.5", "198.51.100.20", 6, tcp(51000, 443, 0x18, 200)), 0x0800));
  add(ether(ipv4("198.51.100.20", "10.0.0.5", 6, tcp(443, 51000, 0x18, 1400)), 0x0800));
  add(ether(ipv4("198.51.100.20", "10.0.0.5", 6, tcp(443, 51000, 0x18, 1400)), 0x0800));
}

// 2. DNS: 10.0.0.5:53000 -> 10.0.0.53:53 and back (IPv4 UDP).
for (let i = 0; i < 3; i++) {
  add(ether(ipv4("10.0.0.5", "10.0.0.53", 17, udp(53000 + i, 53, 40)), 0x0800));
  add(ether(ipv4("10.0.0.53", "10.0.0.5", 17, udp(53, 53000 + i, 120)), 0x0800));
}

// 3. IPv6 HTTPS: 2001:db8:10::5:41000 <-> 2001:db8:20::443.
for (let i = 0; i < 6; i++) {
  add(ether(ipv6("2001:db8:10::5", "2001:db8:20::443", 6, tcp(41000, 443, 0x18, 300)), 0x86dd));
  add(ether(ipv6("2001:db8:20::443", "2001:db8:10::5", 6, tcp(443, 41000, 0x18, 1200)), 0x86dd));
}

// 4. ICMP echo: 10.0.0.5 -> 192.0.2.8.
for (let i = 0; i < 4; i++) {
  add(ether(ipv4("10.0.0.5", "192.0.2.8", 1, icmpEcho(8, 56)), 0x0800));
  add(ether(ipv4("192.0.2.8", "10.0.0.5", 1, icmpEcho(0, 56)), 0x0800));
}

// 5. A VLAN-tagged UDP stream: 10.0.10.7:5000 -> 10.0.20.8:5001 (VLAN 20).
for (let i = 0; i < 8; i++) {
  add(ether(ipv4("10.0.10.7", "10.0.20.8", 17, udp(5000, 5001, 900)), 0x0800, 20));
}

// 6. SSH: 10.0.0.9:52222 -> 10.0.0.1:22.
for (let i = 0; i < 5; i++) {
  add(ether(ipv4("10.0.0.9", "10.0.0.1", 6, tcp(52222, 22, 0x18, 64)), 0x0800));
  add(ether(ipv4("10.0.0.1", "10.0.0.9", 6, tcp(22, 52222, 0x18, 96)), 0x0800));
}

const globalHeader = Buffer.alloc(24);
globalHeader.writeUInt32LE(0xa1b2c3d4, 0);
globalHeader.writeUInt16LE(2, 4);
globalHeader.writeUInt16LE(4, 6);
globalHeader.writeUInt32LE(0, 8);
globalHeader.writeUInt32LE(0, 12);
globalHeader.writeUInt32LE(65535, 16);
globalHeader.writeUInt32LE(1, 20); // LINKTYPE_ETHERNET

const records = packets.map((p) => {
  const h = Buffer.alloc(16);
  h.writeUInt32LE(p.sec, 0);
  h.writeUInt32LE(p.usec, 4);
  h.writeUInt32LE(p.frame.length, 8);
  h.writeUInt32LE(p.frame.length, 12);
  return Buffer.concat([h, p.frame]);
});

fs.writeFileSync(out, Buffer.concat([globalHeader, ...records]));
console.log(`wrote ${packets.length} packets to ${out}`);
