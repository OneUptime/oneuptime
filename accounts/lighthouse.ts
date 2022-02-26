import { fork } from 'child_process'
const child = fork('./lighthouseWorker');
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'cli-... Remove this comment to see the full error message
import Table from 'cli-table'
import program from 'commander'

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
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'mobile' does not exist on type 'Commande... Remove this comment to see the full error message
    if (program.mobile) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'mobile' does not exist on type 'Commande... Remove this comment to see the full error message
        child.send({ url: sites[sitesIndex], mobile: program.mobile });
    } else {
        child.send({ url: sites[sitesIndex], mobile: false });
    }
    sitesIndex++;
}
pages();
