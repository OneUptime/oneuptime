import workboxBuild from 'workbox-build';

// NOTE: This should be run *AFTER* all your assets are built
const buildSW: Function = (): void => {
    // This will return a Promise
    return workboxBuild
        .injectManifest({
            swSrc: 'src/sw-template.js', // This is your sw template file
            swDest: 'build/service-worker.js', // This will be created in the build step
            globDirectory: 'build',
            globPatterns: ['**/*.{js,css,html,png}'],
        })
        .then(({ count, size }: $TSFixMe) => {
            // Optionally, log any warnings and details.
            return `${count} files will be precached, totaling ${size} bytes.`;
        })
        .catch((e: $TSFixMe) => {
            //eslint-disable-next-line no-console
            console.error(e);
        });
};
buildSW();
