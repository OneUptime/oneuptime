declare module "whois-json" {
  function whoisJson(domain: string, options?: object): Promise<any>;
  export default whoisJson;
}
