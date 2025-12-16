// Mock for uuid package with unique values
let v1Counter = 0;
let v4Counter = 0;

module.exports = {
  v1: jest.fn(() => {
    v1Counter++;
    const hex = v1Counter.toString(16).padStart(12, "0");
    return `00000000-0000-0000-0000-${hex}`;
  }),
  v4: jest.fn(() => {
    v4Counter++;
    const hex = v4Counter.toString(16).padStart(12, "0");
    return `00000000-0000-4000-8000-${hex}`;
  }),
};
