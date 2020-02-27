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
    'http://localhost:3003/login',
    'http://localhost:3003/register',
    'http://localhost:3003/forgot-password',
    'http://localhost:3003/user-verify/resend',
    'http://localhost:3003/change-password/wrongtoken',
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
        score.bestPractices < 80 ||
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
