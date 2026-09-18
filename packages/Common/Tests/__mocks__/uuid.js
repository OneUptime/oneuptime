// Mock for uuid package with unique and valid UUID values
let v1Counter = 0;
let v4Counter = 0;

// Generate a valid UUID by padding counter to create proper hex segments
function padHex(num, length) {
  return num.toString(16).padStart(length, "0").slice(-length);
}

module.exports = {
  v1: jest.fn(() => {
    v1Counter++;
    // Generate valid v1 UUID format: xxxxxxxx-xxxx-1xxx-xxxx-xxxxxxxxxxxx
    const p1 = padHex(v1Counter, 8);
    const p2 = padHex(v1Counter * 2, 4);
    const p3 = "1" + padHex(v1Counter * 3, 3);
    const p4 = padHex(0x8000 + (v1Counter % 0x3fff), 4);
    const p5 = padHex(v1Counter, 12);
    return `${p1}-${p2}-${p3}-${p4}-${p5}`;
  }),
  v4: jest.fn(() => {
    v4Counter++;
    // Generate valid v4 UUID format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    const p1 = padHex(v4Counter + 0x10000000, 8);
    const p2 = padHex(v4Counter * 2, 4);
    const p3 = "4" + padHex(v4Counter * 3, 3);
    const p4 = padHex(0x8000 + (v4Counter % 0x3fff), 4);
    const p5 = padHex(v4Counter + 0x100000000000, 12);
    return `${p1}-${p2}-${p3}-${p4}-${p5}`;
  }),
};
