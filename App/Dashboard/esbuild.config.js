const { createConfig, build, watch } = require('Common/UI/esbuild-config');

const config = createConfig({
  serviceName: 'Dashboard',
  publicPath: '/dashboard/dist/',
});

if (process.argv.includes('--watch')) {
  watch(config, 'Dashboard');
} else {
  build(config, 'Dashboard');
}
