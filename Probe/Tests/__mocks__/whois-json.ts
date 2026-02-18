// Mock for whois-json ESM module (not parseable by Jest)
const whoisJson = async (_domain: string): Promise<Record<string, unknown>> => {
  return {};
};

export default whoisJson;
