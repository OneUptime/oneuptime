# Measuring OneUptime AI

When you change OneUptime AI — its persona, its prompt, its tools, or the model it runs on — these tools tell you
whether investigations got better or worse. Run them before and after the change, and compare.

| Tool                                   | What it answers                                                                                 | What it needs                                |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `npm run ai-benchmark`                 | Does the investigation find a fault we planted, and cite the evidence for it?                   | A model key. No database, no project.        |
| `npm run ai-eval -- --replay`          | On real incidents and alerts, does the changed AI find the root cause people wrote?             | A database with recordings, and a model key. |
| `npm run ai-eval`                      | How did past runs score, from what was recorded? (No model is called.)                          | A database.                                  |
| **Project Settings → AI → AI Results** | What came of the AI's work in production: pages avoided, fixes verified, root causes confirmed. | Nothing: it is a page in the product.        |

All three commands read their model key from the environment only: `AI_EVAL_LLM_API_KEY` for the model under test and
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
  _not recorded_ rather than inventing an answer.

Recording is best effort: a recording that cannot be saved never fails the investigation.

## The benchmark: planted faults with known causes

```
npm run ai-benchmark -- --list
AI_EVAL_LLM_API_KEY=... npm run ai-benchmark -- --llm-type=Anthropic --model=claude-opus-5-5
```

Each scenario is a made-up incident with a cause we planted: its context (written the way the product writes it), and
scripted answers for the tools an investigation would call. These are the fault's own evidence, plus distractors that
point somewhere plausible but wrong: a deploy flagged SUSPECT that changed nothing that matters, a noisy but harmless
error, a dependency that is fine. The benchmark runs the real investigation loop over it, with today's persona, tools
and limits, and scores the answer:

- **found the cause**: the answer's _Most likely root cause_ holds the scenario's required words or, with a judge
  (`--judge-llm-type`), the judge grades it MATCH against the planted root cause;
- **cited the key evidence**: the answer cites (`[C1]`, …) a tool result the scenario marks as the fault's own
  evidence;
- a scenario **passes** when it does both. The report also says which distractor an answer blamed, if any.

Options: `--scenario=<id>[,<id>]`, `--persona-file=<path>` (a draft persona to try in place of the code's), and
`--fail-under=<n>` (exit 1 when fewer than `n` scenarios pass, for a CI job). Every answer and score is written to
`./ai-benchmark-results.json`. A scenario is one investigation (up to 40 model calls), plus one judge call.

### Adding a scenario

1. Write `packages/Common/Server/Utils/AI/Eval/Benchmark/Scenarios/<Name>.ts`. Copy an existing one: they show the
   context's format, the tool rows, and how `whenArguments` picks the answer to a call.
2. Add it to `BenchmarkScenarios.ts`.
3. Run the benchmark's tests (`packages/Common/Tests/Server/Utils/AI/Eval/Benchmark`). They hold every scenario to
   the rules: real tool and argument names, no response hidden behind an earlier one, at least two pieces of key
   evidence, services and changes that exist in the scenario, a context that reads as the product writes it (the
   impact section from the SLOs `query_slos` answers with, the recent changes from their numbers), and words a right
   answer passes with and a wrong one does not.

Make a scenario hard in the ways real incidents are: a SUSPECT deploy that is not the cause, the cause only in a log
line or a trace, the change that matters listed but not flagged. Never copy a real project's data into a scenario.

## The replay: real incidents, the data they saw

```
AI_EVAL_LLM_API_KEY=... npm run ai-eval -- --replay --llm-type=Anthropic --model=claude-opus-5-5
```

The replay takes the most recent recorded investigations (20 by default, `--limit=<n>`, one project with
`--project=<id>`), and skips those whose incident or alert has no root cause written yet: there is nothing to grade
against. For each of the others, it builds today's prompt around the recorded context, runs the model you name, and
answers each tool call from the recording: never from live data, which has moved on by then. A call the original run
never made is answered _not recorded_; the report counts those, since the more a case has, the less its grade says.
One judge (the model under test, unless `--judge-llm-type` names another) then grades the original analysis and the
replay's against the written root cause, with the production grader's prompt, and the report says how many cases got
better, stayed the same, or got worse. To try a persona before it is in the code, pass `--persona-file=<path>`, as
with the benchmark.

The replay sends the recorded tool results — a project's telemetry — to the model you name. Run it only where that is
allowed: on your own installation's data, with a provider you may send it to.

`npm run ai-eval` reaches the Postgres the dev stack publishes (`localhost:DATABASE_PUBLISHED_PORT`, 5400 unless
`config.env` moves it), never runs migrations, and writes every case to `./eval-replays.json` (the score mode writes
`./eval-corpus.json`).

## Where the code is

- `packages/Common/Server/Utils/AI/Eval/`: the recorder (`InvestigationRecorder`), the replay
  (`ReplayInvestigation`, `RecordedToolAnswers`, `ReplayCorpus`, `ReplayRunner`), the judge (`EvalJudge`), the
  model a run is pinned to (`PinnedModel`), the command line (`EvalCommandLine`), and the benchmark (`Benchmark/`).
- `Scripts/AI/RunInvestigationEval.ts` and `Scripts/AI/RunInvestigationBenchmark.ts`: the two commands.
- `packages/Common/Server/Utils/AI/Outcomes/` and `POST /ai-activity/outcomes`: what the AI Results page counts.
