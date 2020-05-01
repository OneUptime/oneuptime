const { fork } = require('child_process');
const child = fork('./lighthouseWorker');
const Table = require('cli-table');
const program = require('commander');

program
    .option('-m, --mobile', 'Run lighthouse on mobile')
    .option('-w, --web', 'Run lighthouse on the web');
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
    'http://localhost:1444/product/status-page',
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
        score.performance,
        score.accessibility,
        score.bestPractices,
        score.seo,
    ];
    table.push(scores);
    if (
        score.performance < 50 ||
        score.accessibility < 80 ||
        score.bestPractices < 70 ||
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
    if (program.mobile) {
        child.send({ url: sites[sitesIndex], mobile: program.mobile });
    } else {
        child.send({ url: sites[sitesIndex], mobile: false });
    }
    sitesIndex++;
}
pages();
