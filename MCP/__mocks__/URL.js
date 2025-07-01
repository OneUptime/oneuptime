module.exports = class MockURL {
  constructor(protocol, hostname, route) {
    this.protocol = protocol;
    this.hostname = typeof hostname === 'string' ? { toString: () => hostname } : hostname;
  }
  
  toString() {
    return `${this.protocol}://${this.hostname.toString()}`;
  }
  
  static fromString(url) {
    return {
      protocol: "https://",
      hostname: { toString: () => "test.oneuptime.com" },
      toString: () => url,
    };
  }
  
  static getDatabaseTransformer() {
    return {
      to: (value) => value?.toString(),
      from: (value) => value,
    };
  }
};
