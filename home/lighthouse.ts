import { fork } from 'child_process'
const child = fork('./lighthouseWorker');
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'cli-... Remove this comment to see the full error message
import Table from 'cli-table'
import program from 'commander'

program
    // @ts-expect-error ts-migrate(2551) FIXME: Property 'option' does not exist on type 'typeof i... Remove this comment to see the full error message
    .option('-m, --mobile', 'Run lighthouse on mobile')
    .option('-w, --web', 'Run lighthouse on the web');
// @ts-expect-error ts-migrate(2339) FIXME: Property 'parse' does not exist on type 'typeof im... Remove this comment to see the full error message
program.parse(process.argv);

const table = new Table({
    head: ['url', 'performance', 'accessibility', 'best-practices', 'seo'],
    style: { head: ['green'] },
});
const sites = [
    'http://localhost:1444',
    'http://localhost:1444/pricing',
    'http://localhost:1444/support',
    'http://localhost:1444/customers',
    'http://localhost:1444/enterprise/overview',
    'http://localhost:1444/enterprise/resources',
    'http://localhost:1444/enterprise/demo',
    'http://localhost:1444/product/public-status-page',
    'http://localhost:1444/product/oncall-management',
    'http://localhost:1444/product/uptime-monitoring',
    'http://localhost:1444/legal/terms',
    'http://localhost:1444/legal/privacy',
    'http://localhost:1444/legal/gdpr',
    'http://localhost:1444/legal/ccpa',
    'http://localhost:1444/legal',
    'http://localhost:1444/legal/soc-2',
    'http://localhost:1444/legal/soc-3',
    'http://localhost:1444/legal/iso-27017',
    'http://localhost:1444/legal/iso-27018',
    'http://localhost:1444/legal/hipaa',
    'http://localhost:1444/legal/pci',
    'http://localhost:1444/legal/sla',
    'http://localhost:1444/legal/data-residency',
    'http://localhost:1444/legal/dmca',
    'http://localhost:1444/legal/subprocessors',
    'http://localhost:1444/legal/contact',
    'http://localhost:1444/compare/pingdom',
    'http://localhost:1444/compare/pagerduty',
    'http://localhost:1444/compare/statuspage.io',
];
let sitesIndex = 0;
let checksFailed = false;

child.on('message', function(score) {
    const scores = [
        sites[sitesIndex - 1],
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'performance' does not exist on type 'Ser... Remove this comment to see the full error message
        score.performance,
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'accessibility' does not exist on type 'S... Remove this comment to see the full error message
        score.accessibility,
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'bestPractices' does not exist on type 'S... Remove this comment to see the full error message
        score.bestPractices,
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'seo' does not exist on type 'Serializabl... Remove this comment to see the full error message
        score.seo,
    ];
    table.push(scores);
    if (
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'performance' does not exist on type 'Ser... Remove this comment to see the full error message
        score.performance < 50 ||
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'accessibility' does not exist on type 'S... Remove this comment to see the full error message
        score.accessibility < 70 ||
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'bestPractices' does not exist on type 'S... Remove this comment to see the full error message
        score.bestPractices < 70 ||
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'seo' does not exist on type 'Serializabl... Remove this comment to see the full error message
        score.seo < 80
    ) {
        checksFailed = true;
    }
    if (sitesIndex < sites.length) {
        pages();
    } else {
        process.stdout.write(table.toString());
        process.stdout.write('\n');
        if (checksFailed) {
            process.stderr.write(
                'Error: Some scores are below 80 please check table above.\n'
            );
            process.exit(1);
        }
        process.exit();
    }
});

function pages() {
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'mobile' does not exist on type 'typeof i... Remove this comment to see the full error message
    if (program.mobile) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'mobile' does not exist on type 'typeof i... Remove this comment to see the full error message
        child.send({ url: sites[sitesIndex], mobile: program.mobile });
    } else {
        child.send({ url: sites[sitesIndex], mobile: false });
    }
    sitesIndex++;
}
pages();
