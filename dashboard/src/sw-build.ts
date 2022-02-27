// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'work... Remove this comment to see the full error message
import workboxBuild from 'workbox-build';

// NOTE: This should be run *AFTER* all your assets are built
const buildSW = () => {
    // This will return a Promise
    return workboxBuild
        .injectManifest({
            swSrc: 'src/sw-template.js', // this is your sw template file
            swDest: 'build/service-worker.js', // this will be created in the build step
            globDirectory: 'build',
            globPatterns: ['**/*.{js,css,html,png}'],
        })
        .then(({ count, size }: $TSFixMe) => {
            // Optionally, log any warnings and details.
            return `${count} files will be precached, totaling ${size} bytes.`;
        })
        .catch((e: $TSFixMe) => {
            // eslint-disable-next-line no-console
            console.error(e);
        });
};
buildSW();
