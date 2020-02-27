/* eslint-disable */
const workboxBuild = require('workbox-build');

// NOTE: This should be run *AFTER* all your assets are built
const buildSW = () => {
    // This will return a Promise
    return workboxBuild
        .injectManifest({
            swSrc: 'src/sw-template.js', // this is your sw template file
            swDest: 'build/service-workr.js', // this will be created in the build step
            globDirectory: 'build',
            globPatterns: ['**/*.{js,css,html,png}'],
        })
        .then(({ count, size }) => {
            // Optionally, log any warnings and details.
            return `${count} files will be precached, totaling ${size} bytes.`;
        });
};
buildSW();
