# Measuring OneUptime AI

When you change OneUptime AI — its persona, its prompt, its tools, or the model it runs on — these tools tell you
whether investigations and Ask AI's answers got better or worse. Run them before and after the change, and compare.

| Tool                                   | What it answers                                                                                 | What it needs                                |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `npm run ai-benchmark`                 | Does the investigation find a fault we planted, and cite the evidence for it?                   | A model key. No database, no project.        |
| `npm run ai-eval -- --replay`          | On real incidents and alerts, does the changed AI find the root cause people wrote?             | A database with recordings, and a model key. |
| `npm run ai-eval`                      | How did past runs score, from what was recorded? (No model is called.)                          | A database.                                  |
| `npm run benchmark` in packages/Runner | Does the Code agent fix customer-shaped tasks, and how many rounds, tools, tokens and minutes?  | A model key. No database, no project.        |
| `npm run ask-ai-eval`                  | Does Ask AI propose the right setup plan, and answer a how-do-I from the right docs page?       | A model key. No database, no project.        |
| `npm run ai-data-security-eval`        | Does each of Data Security's AI features answer its fixed cases right, from what it is sent?    | A model key. No database, no project.        |
| **Project Settings → AI → AI Results** | What came of the AI's work in production: pages avoided, fixes verified, root causes confirmed. | Nothing: it is a page in the product.        |

Every command here reads its model key from the environment only: `AI_EVAL_LLM_API_KEY` for the model under test and
`AI_EVAL_JUDGE_API_KEY` for a judge. They refuse `--api-key` and the like, which would stay in the shell's history
and show in the process list. They call the model you name directly: no project is billed, and nothing is written to
the database.

## What is recorded

Every incident and alert investigation keeps a recording (`AIRunRecording`) once it completes: the context it started
from, and every tool call it made with the text the tool returned. The text is what the model was shown, so it was
already redacted and cut to size by the toolbox. A recording is:

- **readable only by the server**: the table has no API and no page, and no user can read or write a row;
- **kept for 30 days** (`INVESTIGATION_RECORDING_RETENTION_IN_DAYS`), and deleted with its run or its project;
- **capped**: 300 tool calls, 100,000 characters of one result, 1,000,000 characters of results in all
  (`Types/AI/InvestigationRecording.ts`). A call past the caps is kept without its text, and a replay counts it as
  _not recorded_ rather than inventing an answer;
- **marked when it was read for its readers**: `readForItsReaders` in its inputs says the run's tools read only what
  everyone who may see the incident or alert may read. Recordings made before runs read for their readers lack it:
  they hold what the whole project held, so nothing shown to a record's readers may be replayed from them.

Recording is best effort: a recording that cannot be saved never fails the investigation.

## The benchmark: planted faults with known causes

```
npm run ai-benchmark -- --list
AI_EVAL_LLM_API_KEY=... npm run ai-benchmark -- --llm-type=Anthropic --model=claude-opus-5-5
AI_EVAL_LLM_API_KEY=... npm run ai-benchmark -- --llm-type=Anthropic --model=claude-opus-5-5 --repeat=3
```

Each scenario is a made-up incident or alert with a cause we planted: its context (written the way the product writes
it), and scripted answers for the tools an investigation would call, each written as the real tool writes it, with the
notes it puts before its rows. These are the fault's own evidence, plus distractors that point somewhere plausible but
wrong: a deploy flagged SUSPECT that changed nothing that matters, a noisy but harmless error, a dependency that is
fine, a past incident whose fix does not apply this time. The benchmark runs the real investigation loop over it, with
today's persona, tools and limits, and scores the answer:

- **found the cause**: the answer's _Most likely root cause_ holds the scenario's required words or, with a judge
  (`--judge-llm-type`), the judge grades it MATCH against the planted root cause;
- **cited the key evidence**: the answer cites (`[C1]`, …) a tool result the scenario marks as the fault's own
  evidence;
- a scenario **passes** when it does both. The report also says which distractor an answer blamed, if any.

Some scenarios plant no cause the evidence can name. There the right answer is the one the persona asks for: say
plainly that the cause could not be determined, and list what was checked. Such an answer passes when its root cause
says it could not tell (in words such as "inconclusive" or "could not determine") and cites what it checked. With a
judge, the judge reads it as production's confidence classifier reads an investigation, and INCONCLUSIVE passes it. A
confident answer fails, whatever it names. A planted wrong cause the root cause names is reported but does not fail
the answer, since an honest one often rules the distractors out right there; a judge tells that from a hedged guess.

A model's answers vary from run to run, so one run of a scenario can pass or fail with no change at all.
`--repeat=<k>` (up to 10) runs each scenario `k` times: the report gives each scenario's pass rate, and a scenario
passes when more than half its runs pass.

Options: `--scenario=<id>[,<id>]`, `--repeat=<k>`, `--persona-file=<path>` (a draft persona to try in place of the
code's), `--fail-under=<n>` or `--fail-under=<p>%` (exit 1 when fewer than `n` scenarios pass, or fewer than `p`% of
them, for a CI job), and `--report-markdown=<path>` (add the report, in Markdown, to the end of a file, such as a CI
job's summary). Every answer and score, with the summary, is written to `./ai-benchmark-results.json`. A scenario's
run is one investigation (up to 40 model calls), plus one judge call.

### In CI

The AI Benchmark workflow (`.github/workflows/ai-benchmark.yml`) runs the benchmark with `claude-opus-5-5`:

- on a pull request that changes the investigation itself: its persona and prompt (`AIInvestigationEngine.ts`), the
  loop (`Chat/`), how the toolbox offers tools and writes their results (`Toolbox/Index.ts`, `Serializer.ts`,
  `ToolTypes.ts`), how an answer is read, the LLM client, the benchmark, or the workflow. A change to one tool's own
  file does not run it: some thirty pull requests a week make one, mostly to a tool an investigation never calls;
- nightly on main;
- by hand (**Run workflow**), with how many runs a scenario gets and which scenarios run.

It reads the model's key from the repository secret `AI_EVAL_LLM_API_KEY`. Without it (not set, or a pull request
from a fork, which GitHub hands no secrets) the job says so in its summary and passes, having run nothing. The pass
table goes to the job's summary and every answer to the `ai-benchmark-results` artifact. The job fails when fewer than
`AI_BENCHMARK_FAIL_UNDER` of the scenarios pass, but the check is not required: a red run warns the reviewer and blocks
no merge. Raise the threshold to a little below the pass count the runs settle at.

### Adding a scenario

1. Write `packages/Common/Server/Utils/AI/Eval/Benchmark/Scenarios/<Name>.ts`. Copy an existing one: they show the
   context's format, the tool rows, and how `whenArguments` picks the answer to a call. An alert's scenario says
   `subjectKind: BenchmarkSubjectKind.Alert` and opens with `# Alert`; a scenario whose evidence names no cause says
   `kind: BenchmarkExpectationKind.Inconclusive` and holds `[INCONCLUSIVE_WORDS]` as its words.
2. Add it to `BenchmarkScenarios.ts`, and its key evidence to the reviewed list in `BenchmarkOracle.test.ts`.
3. Run the benchmark's tests (`packages/Common/Tests/Server/Utils/AI/Eval/Benchmark`). They hold every scenario to
   the rules: real tool and argument names, no response hidden behind an earlier one, at least two pieces of key
   evidence, services and changes that exist in the scenario, a context that reads as the product writes it (the
   incident's or alert's summary, past cases, the impact section from the SLOs `query_slos` answers with, the recent
   changes from their numbers), tool answers with the notes the real tool writes, and words a right answer passes with
   and a wrong one does not.

Make a scenario hard in the ways real incidents are: a SUSPECT deploy that is not the cause, the cause only in a log
line or a trace, the change that matters listed but not flagged, a past incident that looks the same and is not.
Never copy a real project's data into a scenario.

## The replay: real incidents, the data they saw

```
AI_EVAL_LLM_API_KEY=... npm run ai-eval -- --replay --llm-type=Anthropic --model=claude-opus-5-5
```

The replay takes the most recent recorded investigations (20 by default, `--limit=<n>`, one project with
`--project=<id>`), and skips those whose incident or alert has no root cause written yet: there is nothing to grade
against. A root cause that is still what OneUptime wrote when it opened the record, such as the criteria a monitor
matched (`**Created because the following criteria was met**`), counts as none: graded against it, a right analysis
reads as a miss. Responders write one as they resolve an incident or alert (**Add the root cause** in the Resolve
dialog), or on its **Root Cause** page. For each of the others, it builds today's prompt around the recorded context,
runs the model you name, and answers each tool call from the recording: never from live data, which has moved on by
then. A call the original run never made is answered _not recorded_; the report counts those, since the more a case
has, the less its grade says. One judge (the model under test, unless `--judge-llm-type` names another) then grades
the original analysis and the replay's against the written root cause, with the production grader's prompt, and the
report says how many cases got better, stayed the same, or got worse. To try a persona before it is in the code, pass
`--persona-file=<path>`, as with the benchmark.

The replay sends the recorded tool results — a project's telemetry — to the model you name. Run it only where that is
allowed: on your own installation's data, with a provider you may send it to.

## Can the automatic grade be trusted?

When an incident or alert resolves with a root cause people wrote, the production grader (`InvestigationGrader`)
grades its investigation MATCH, PARTIAL or MISMATCH against it, and **AI Results** counts that grade when no responder
judged the investigation. It grades only the root cause people wrote: the one written under **Add the root cause** as
the record was resolved or, on a record a person created, the one it holds; never a monitor's criteria.

`npm run ai-eval` (the score mode) says how far to trust it: of the runs a responder confirmed or rejected and the
grader graded, how often the two agree (MATCH with confirmed, MISMATCH with rejected), for incidents and alerts apart,
with how many it graded too generously (MATCH, but rejected) or too strictly (MISMATCH, but confirmed). PARTIAL is
counted apart. Under 20 runs judged both ways the report says the number is too few to rely on. Alert investigations
are graded since alerts ask for a root cause as they resolve: run it once alerts have such runs, before relying on
their grade.

`npm run ai-eval` reaches the Postgres the dev stack publishes (`localhost:DATABASE_PUBLISHED_PORT`, 5400 unless
`config.env` moves it), never runs migrations, and writes every case to `./eval-replays.json` (the score mode writes
`./eval-corpus.json`).

## The Code agent benchmark: customer-shaped tasks with checks

```
cd packages/Runner
npm run benchmark -- --list
AI_EVAL_LLM_API_KEY=... npm run benchmark -- --llm-type=Anthropic --model=claude-opus-5-5
```

The benchmark runs the real in-house Code agent (`InHouseCodeAgent`) - its prompt, its tools, its loop and its
limits - with the model you name, on tasks shaped like the work customers hand Code, each in a repository of its own:

| Task                        | What it is                                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------------- |
| `discount-bug-in-long-file` | An exception's stack trace into a 2,000-line file, whose cause is a function far from the line. |
| `failing-slug-tests`        | CI is red on two cases of a helper; the fix belongs in the code, never in the test.            |
| `rename-across-files`       | An API renamed a field, and four pages and emails across the repository still read the old one. |
| `slow-suite-retry-bug`      | The suite takes about two and a half minutes, longer than a command gets unless it asks.       |

Each task's check runs after the agent, from outside the repository, so the agent can neither read nor change it: a
hidden test of the fix, the repository's own tests, and that a test the task says to keep was kept. It writes one row a
task - the check passed or failed; how the run ended (its answer, a loop stop, its time limit, or an error); its model
calls; its tool calls by tool; its tokens; and its time - prints them as a Markdown table, and writes them all, with the
agent's summary and what a failed check said, to `./code-agent-benchmark-results.json`.

The model is called directly, through the server the benchmark stands in for: every call is held to what the OneUptime
server holds a run to (its time limit, the answer it may still give past it, the time limit per command, the model's
context window), and nothing is billed but the model's own provider. The agent's commands run on the machine that runs
the benchmark, in a temporary copy of the task's repository, as they run on a Runner of your own: run it in a container
or in CI.

Options: `--task=<id>[,<id>]`, `--time-limit=<minutes>` (each task's, 30 by default), `--command-time-limit=<minutes>`
(the most one command may run, 10 by default), `--fail-under=<n>`, `--keep-repositories` (to read what the agent left)
and `--require-key`. Without `AI_EVAL_LLM_API_KEY` it skips and exits 0, unless `--require-key` asks it to fail; a model
you run yourself (`--llm-type=Ollama` or `OpenAICompatible`, with `--base-url`) needs no key.

The **Code Agent Benchmark** workflow (`.github/workflows/code-agent-benchmark.yml`) runs it by hand and weekly, and puts
the table in the run's summary. It runs only once a maintainer adds the model's key as the
`CODE_AGENT_BENCHMARK_LLM_API_KEY` secret; the weekly run's model can be set in the `CODE_AGENT_BENCHMARK_LLM_TYPE` and
`CODE_AGENT_BENCHMARK_MODEL` variables. Without the secret, every run skips at its first step.

### Adding a task

1. Add it to `packages/Runner/Benchmark/CodeAgentBenchmarkTasks.ts`: its repository's files, the prompt as Code or an
   exception's **Fix with AI** would put it, a check, and `solve`, the fix a person would make.
2. Run its tests (`packages/Runner/Tests/Benchmark`). They hold every task's check to failing on the repository as the
   task finds it and passing once `solve` made the fix.

## Ask AI: setup requests and how-do-I questions

`npm run ask-ai-eval` asks a real model what people ask Ask AI, through Ask AI's own chat turn (`ChatAgentRunner`, in
**Ask to act**): today's prompt, tools and limits. It grades each answer against two lists:

- **Setup requests** (`packages/Common/Tests/Server/Utils/AI/AskAiSetupRequests.ts`, #7246). Each request is asked in
  the project it names: one that pages nobody yet, one that pages people already, one with a monitor of example.com,
  or one on the Free plan with its status page (`AskAiEvalProject`). It passes when the plan the model proposed in one
  answer, for one approval card, is the request's. The plan must use the same setup tools, with the arguments the list
  names present and not contradicted (other arguments the schema takes are allowed). It fails if the model proposes
  anything for a request no setup action answers, proposes `set_up_paging` in a project that pages people already,
  asks a question in place of a plan, or asks for a phone number.
- **How-do-I questions** (`packages/App/Tests/FeatureSet/Docs/AskAiHowDoIQuestions.ts`, #7066): the English ones,
  the German and Persian ones, three the docs do not cover, and ten asked on a page (#7062, #7065), each with the
  context that page sends: a status page, a monitor, an on-call policy, Home, a settings page, On-Call, Status Pages
  and Create Monitor. A question passes when the answer cites the docs page that answers it (or another the list
  names) and, when it is done on a Dashboard page, ends with that page's **Go to** button. Asked on a record, the
  button must open that record's own page, such as this status page's **Custom Domains**. A question the docs do not
  cover passes when the answer says "The docs do not cover this."

Nothing reads a database and no action runs: the setup actions' checks before the card read the project from the
eval, the docs tools read the docs in this repository, and a plan stops at its card (`AskAiEvalTurn`).

```bash
export AI_EVAL_LLM_API_KEY=...
npm run ask-ai-eval -- --llm-type=Anthropic --model=claude-opus-5-5
npm run ask-ai-eval -- --list                        # every case, with its id
npm run ask-ai-eval -- --suite=setup --repeat=3 --llm-type=Anthropic --model=claude-opus-5-5
npm run ask-ai-eval -- --case=setup-1,how-do-i-12 --llm-type=Anthropic --model=claude-opus-5-5
```

`--suite=setup|how-do-i` asks one list. `--case` asks only the cases it names. `--repeat`, `--fail-under` and
`--report-markdown` work as they do for the benchmark. A case passes when more than half its runs pass. Every answer
and grade goes to `ask-ai-eval-results.json`, and the report says what each case proposed or cited and why it failed.
Without `AI_EVAL_LLM_API_KEY`, for a provider that needs one, it says so and exits 0, having called nothing.

The Ask AI Eval workflow (`.github/workflows/ask-ai-eval.yml`) runs it by hand only (**Run workflow**), with the same
repository secret as the AI Benchmark. Its job summary is the Markdown report, ready to post on an issue. A request
the model keeps failing becomes a prompt fix (`SETUP_SECTION` in `Chat/ObservabilityChatPrompt.ts`) or a new entry.

### Adding a case

Add the request or the question to its list. A setup request asked in a new kind of project needs that project in
`AskAiEvalProject`. `AskAiEvalTurn.test.ts` asks every setup request of a model that proposes the expected plan,
offline, and fails if a check before the card reads anything the eval does not answer.

## Data Security: every AI feature on fixed cases

`npm run ai-data-security-eval` runs every OneUptime AI feature of Data Security (#10365) on made-up cases
(`packages/Common/Server/Utils/AI/Eval/DataSecurity/DataSecurityEvalCases.ts`), with the model you name. Each case's
input is built by the feature's own builder, `DataSecurityAiInput`, so a change to a prompt is measured as it ships.
Each answer is scored by words a check reads, never by a judge:

| Feature         | A case passes when                                                                                                    |
| --------------- | --------------------------------------------------------------------------------------------------------------------- |
| Explain with AI | The explanation says each fact the case names, and none of the words a right answer never says, such as what a planted instruction in a store's name asked for. |
| Field suggestions | The answer, read as the product reads it, gives at least 75% of the fields the type the case expects, or none.     |
| Fix with AI     | Handed the request Fix with AI gives the coding agent, with the files it names, the model's changed files match what the fix needs and nothing it must not. This measures the request; the Code agent benchmark measures the agent's loop. |
| Ask AI          | Handed the rows its Data Security tools read, the answer names what the case names.                                    |

```
npm run ai-data-security-eval -- --list
AI_EVAL_LLM_API_KEY=... npm run ai-data-security-eval -- --llm-type=Anthropic --model=claude-opus-5-5
AI_EVAL_LLM_API_KEY=... npm run ai-data-security-eval -- --llm-type=Anthropic --model=claude-opus-5-5 --feature=SuggestFieldTypes --repeat=3
```

A feature's score is the share of its cases that pass; with `--repeat`, a case passes when more than half its runs
pass. `--enforce-thresholds` exits 1 when a feature scores under its threshold (`DATA_SECURITY_EVAL_THRESHOLDS` in
`DataSecurityEval.ts`). Options: `--feature=<id>[,<id>]` (`ExplainIssue`, `FixIssue`, `SuggestFieldTypes`, `AskAi`),
`--case=<id>[,<id>]`, `--changed-files=<path>` (only the features the files listed in it change), `--repeat=<k>` and
`--report-markdown=<path>`. Every answer and score goes to `./ai-data-security-eval-results.json`.

The **Data Security AI Eval** workflow (`.github/workflows/data-security-ai-eval.yml`) runs it with `claude-opus-5-5`:

- on a pull request that changes a Data Security AI feature's prompt, the builder, the eval or the workflow, and then
  only the features the pull request changes;
- nightly on main, and by hand (**Run workflow**), with which features or cases and how many runs a case gets;
- on the release branch before a release (`RELEASING.md`), where every feature must meet its threshold.

It reads the model's key from the repository secret `AI_EVAL_LLM_API_KEY`, as the AI Benchmark does, and without it
says so and passes, having run nothing. The scores go to the job's summary and every answer to the
`data-security-ai-eval-results` artifact.

### Adding a case, or a feature

A new AI feature of Data Security is listed in `Types/DataSecurity/DataSecurityAiFeatures.ts` first. Its cases go in
`DataSecurityEvalCases.ts`, its input is built in `buildEvalCall` with the feature's builder, its answer scored in
`scoreAnswer`, and its threshold set in `DATA_SECURITY_EVAL_THRESHOLDS`. The eval's tests
(`packages/Common/Tests/Server/Utils/AI/Eval/DataSecurity`) fail until every feature has two cases, each a right
answer passes and a wrong one fails, and each fix's checks fail on the code as the case finds it and pass on the fix
a person would make.

Cases are made up. Never copy a customer's store, field or code into one. When people approve or dismiss OneUptime
AI's proposals (#10364), the verdict is kept as a label with OneUptime's catalog values only
(`DataSecurityEvalLabels`): the feature, the check, the built-in data types, the kinds of store and location. Read the
labels for the kinds of proposals people dismiss most, and write cases of that shape.

## Where the code is

- `packages/Common/Server/Utils/AI/Eval/`: the recorder (`InvestigationRecorder`), the replay
  (`ReplayInvestigation`, `RecordedToolAnswers`, `ReplayCorpus`, `ReplayRunner`), the judge (`EvalJudge`), the
  model a run is pinned to (`PinnedModel`), the command line (`EvalCommandLine`), and the benchmark (`Benchmark/`).
- `Scripts/AI/RunInvestigationEval.ts` and `Scripts/AI/RunInvestigationBenchmark.ts`: the two commands.
- `packages/Common/Server/Utils/AI/Eval/AskAi/` and `packages/App/scripts/ask-ai-eval.ts`: the Ask AI eval, its
  projects (`AskAiEvalProject`), the turn it asks (`AskAiEvalTurn`), its grades (`AskAiEvalGrades`) and its report
  (`AskAiEvalReport`).
- `packages/Runner/Benchmark/` and `packages/Runner/Scripts/RunCodeAgentBenchmark.ts`: the Code agent benchmark, its
  tasks (`CodeAgentBenchmarkTasks`), the server it stands in for (`CodeAgentBenchmarkServer`) and its command line.
- `packages/Common/Server/Utils/AI/Eval/DataSecurity/` and `Scripts/AI/RunDataSecurityEval.ts`: the Data Security
  eval, its cases (`DataSecurityEvalCases`), its scoring (`DataSecurityEval`), its command line, its report and its
  labels.
- `packages/Common/Server/Utils/AI/Outcomes/` and `POST /ai-activity/outcomes`: what the AI Results page counts.
