const { createConfig, build, watch } = require('Common/UI/esbuild-config');

const config = createConfig({
  serviceName: 'AdminDashboard',
  publicPath: '/admin/dist/',
});

if (process.argv.includes('--watch')) {
  watch(config, 'AdminDashboard');
} else {
  build(config, 'AdminDashboard');
}
