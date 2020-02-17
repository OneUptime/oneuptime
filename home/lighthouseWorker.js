const lighthouse = require('lighthouse');
const chromeLauncher = require('chrome-launcher');
const ora = require('ora');

function launchChromeAndRunLighthouse(url, flags = {}, config = null) {
	return chromeLauncher.launch(flags).then(chrome => {
		flags.port = chrome.port;
		return lighthouse(url, flags, config).then(results => {
			return chrome.kill().then(() => results)
		});
	});
}

const flags = {chromeFlags: ['--headless'], emulatedFormFactor: 'desktop'};

process.on('message', function (data) {
	if (data.mobile) flags.emulatedFormFactor = 'mobile';
	const scores = {};
	const spinner = ora(`Running lighthouse on ${data.url}`).start();
	spinner.color = 'green';
	launchChromeAndRunLighthouse(data.url, flags).then(results => {
		results.artifacts = 'ignore';
		results.reportGroups = 'ignore';
		results.timing = 'ignore';
		results.userAgent = 'ignore';
		results.lighthouseVersion = 'ignore';
		results.runWarnings = 'runWarnings';
		results.report = 'ignore';
		results.runtimeConfig = 'ignore';
	
		results.lhr.userAgent = 'ignore';
		results.lhr.environment = 'ignore';
		results.lhr.configSettings = 'ignore';
		results.lhr.metrics = 'ignore';
		results.lhr.audits = 'ignore';
		results.lhr.categoryGroups = 'ignore';
		
		scores.performance = Math.ceil(results.lhr.categories.performance.score * 100);
		scores.accessibility = Math.ceil(results.lhr.categories.accessibility.score * 100);
		scores.bestPractices = Math.ceil(results.lhr.categories['best-practices'].score * 100);
		scores.seo = Math.ceil(results.lhr.categories.seo.score * 100);
		if (scores.performance < 80 || scores.accessibility < 80 || scores.bestPractices < 80 || scores.seo < 80) {
			spinner.fail();
		} else {
			spinner.succeed();
		}
		process.send(scores);
		return scores;
	})
	.catch(err => {
		/* eslint-disable no-console */
		console.log(err)
		process.exit(1);
	});
});
