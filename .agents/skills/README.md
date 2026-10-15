# Project skills

Each skill lives in `.agents/skills/<name>/` (read by Codex) and is symlinked into `.claude/skills/<name>` (read by Claude Code):

```bash
ln -s ../../.agents/skills/<name> .claude/skills/<name>
```

| Skill | Use |
|---|---|
| `update-chest-db` | any change to the chest database |
| `release` | cutting a version: only on an explicit request to release |

## Trigger evals

`<name>/evals/trigger-evals.json` holds realistic queries labelled `should_trigger`. They check that the skill's `description` makes the agent load it, and that it isn't loaded for near-miss requests. They are run with Anthropic's skill-creator (`scripts/run_loop.py`), with three precautions:

- **Isolation.** Run from a temporary worktree whose `.claude/skills/` lacks the skill under test (`git worktree add --detach <dir> main && rm <dir>/.claude/skills/<name>`). Otherwise the real skill competes with the test copy, and calls to it count as misses.
- **One worker.** Use `--num-workers 1`. Each worker drops its own copy of the skill into `.claude/commands/`; parallel copies compete, and recall drops to about 0%.
- **The skill-creator directory goes on `PYTHONPATH`;** the cwd is the worktree. Pass absolute `--eval-set` and `--skill-path`.

```bash
cd <worktree> && PYTHONPATH=<skill-creator dir> python3 -m scripts.run_loop \
  --eval-set <abs>/evals/trigger-evals.json --skill-path <abs>/.agents/skills/<name> \
  --model <session model id> --runs-per-query 1 --max-iterations 3 --num-workers 1 --report none
```

Last result (2026-10-15): both skills scored 100% on all 20 queries, train and held-out, with their current descriptions.
