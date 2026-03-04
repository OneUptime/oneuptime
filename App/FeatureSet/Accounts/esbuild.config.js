const { createConfig, build, watch } = require('Common/UI/esbuild-config');

const config = createConfig({
  serviceName: 'Accounts',
  publicPath: '/accounts/dist/',
});

if (process.argv.includes('--watch')) {
  watch(config, 'Accounts');
} else {
  build(config, 'Accounts');
}
