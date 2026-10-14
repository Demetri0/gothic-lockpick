---
name: release
description: Use when the user explicitly asks to cut a release of Gothic Lockpick — "make a release", "release 1.7.0", "bump the version and tag it", "prepare the release notes for the next version".
---

# Releasing Gothic Lockpick

## First: is this a release request?

Act only on a **direct, unambiguous request** to release ("cut 1.7.0", "make a release"). If the user asked a question instead — "did you tag it?", "is it released?", "what version are we on?" — answer it from `git describe --tags`, `git log`, `package.json` and CHANGELOG, offer a release if one is due, and take no actions. Once the user has asked for a release, do steps 0–4 without further questions; **pushing (step 5) deploys the site and always needs a separate go-ahead.**

## What a release is

- An annotated tag `vX.Y.Z` on the commit `main` points to after the release: the merge commit when the work came through a branch, otherwise the release commit.
- A CHANGELOG section `## [X.Y.Z] - YYYY-MM-DD` ([Keep a Changelog](https://keepachangelog.com/en/1.1.0/)).
- English release notes `docs/releases/vX.Y.Z.md`, the text the user pastes into a GitHub release (or `gh release create`, if `gh` is installed).
- Pushing `main` deploys GitHub Pages (`.github/workflows/static.yml`).

## Choose the version (semver)

- patch: fixes only.
- minor: new user-visible features or data (new locks count), backward compatible.
- major: breaks a shared link format (`?lock=`), the config codecs, or removes a feature.

## Steps

0. **Check.**
   - Current branch, and a clean `git status`.
   - `git describe --tags`; whether `vX.Y.Z` already exists (never reuse a tag).
   - `git fetch` (network), then whether `main` is behind `origin/main`.
   - Then run `npx playwright test`, plus `npm run test:corpus` if solver logic, move rules, DB-entry conversion or `chests.json` changed since the last tag. Stop on any failure.
   - If the work is already merged, skip the merge in step 2.
1. **Release commit**, on the branch if there is one, otherwise on `main`:
   - `npm version X.Y.Z --no-git-tag-version`. This updates `package.json` **and** `package-lock.json`.
   - In `CHANGELOG.md`, rename `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD` (today), and insert a fresh empty `## [Unreleased]` above it.
   - Write `docs/releases/vX.Y.Z.md`: players first, then a "For contributors" list. Include only changes that are in this release. Every claim about DB data is hedged (third-party data of unknown accuracy; see the `update-chest-db` skill).
   - Stage those four files by name and run `git commit -m "chore(release): X.Y.Z"`.
2. **Merge** (branch only). `git merge` can't read a message from stdin, so write it to a file and run `git checkout main && git merge --no-ff -F <file> <branch>`. Title: `Merge: <summary> (X.Y.Z)`; the body says what changed for users.
3. **Tag:** `git tag -a vX.Y.Z -F <file>`. The first line is `X.Y.Z — <summary>`, then a short paragraph (mirror `git show v1.5.0`).
4. **Report** what was done and show the release-notes text verbatim.
5. **Push, only after the user's go-ahead:** `git push origin main vX.Y.Z`.
   - Run it with a 600000 ms timeout or in the background. pre-push tests each pushed ref tip in a temporary worktree (plus the corpus when needed), and a failure aborts the push.
   - If a push is interrupted, run `git worktree prune`.
   - Then delete the merged branch locally (`git branch -d`), and on the remote too if it was pushed.
6. **After the push**, ask the user to confirm the Pages workflow run is green.

## Never

- Retag or rewrite anything already pushed. Fix forward with a new commit or a patch release.
- Release from a dirty tree or with failing tests.
