const { createConfig, build, watch } = require('Common/UI/esbuild-config');

const config = createConfig({
  serviceName: 'PublicDashboard',
  publicPath: '/public-dashboard/dist/',
});

if (process.argv.includes('--watch')) {
  watch(config, 'PublicDashboard');
} else {
  build(config, 'PublicDashboard');
}
