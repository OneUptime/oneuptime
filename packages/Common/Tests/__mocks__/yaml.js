// Mock for yaml package
module.exports = {
  parse: jest.fn((str) => {
    return {};
  }),
  stringify: jest.fn((obj) => {
    return "";
  }),
  parseDocument: jest.fn(),
  parseAllDocuments: jest.fn(),
};
