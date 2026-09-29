/*
 * Models an ee/ directory from a different release: it loads, but it does not
 * implement this build's EnterpriseServerModule contract.
 */
export default {
  name: "not-oneuptime-enterprise",
  version: "",
  init: async (): Promise<void> => {
    return undefined;
  },
};
