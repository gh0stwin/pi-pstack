#!/usr/bin/env bash
# Read-only worktree prune audit. Classifies every git worktree by size, merge
# state, uncommitted work, remote/PR state, and the most recent pi session that
# operated in it. Emits a table sorted by size with a suggested bucket. Never
# deletes anything; deletion stays a human-gated step in the playbook.
#
# Usage: worktree-audit.sh [repo-path]   (defaults to the current repo)
set -u

repo="${1:-$(git rev-parse --show-toplevel 2>/dev/null)}"
[ -z "$repo" ] && { echo "not in a git repo; pass a repo path" >&2; exit 1; }
cd "$repo" || exit 1

# Main worktree is the first entry; everything else is a candidate.
main_wt=$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')

# origin/main drives the merge check. Best-effort; stale is fine for a first pass.
git fetch origin main --quiet 2>/dev/null || echo "warn: could not fetch origin/main; merged column may be stale" >&2

# PR state by branch, fetched once. Empty if gh is unavailable.
prs=$(mktemp)
gh pr list --author "@me" --state all --limit 1000 \
	--json number,state,headRefName 2>/dev/null > "$prs" || echo "[]" > "$prs"

# pi session dir for this repo: <agent dir>/sessions/--<slugified-repo-path>--.
# PI_CODING_AGENT_DIR and PI_CODING_AGENT_SESSION_DIR mirror pi's own overrides.
agent_dir="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
session_dir="${PI_CODING_AGENT_SESSION_DIR:-$agent_dir/sessions}"
slugify() { printf '%s' "$1" | sed 's#^/##; s#/#-#g'; }
repo_sessions="$session_dir/--$(slugify "$main_wt")--"
now=$(date +%s)

# `stat` and `date` differ between GNU and BSD userlands; probe once.
if stat -c '%Y' . >/dev/null 2>&1; then
	stat_mtime() { stat -c '%Y %n' "$1"; }
else
	stat_mtime() { stat -f '%m %N' "$1"; }
fi
if date -d "@0" +%Y >/dev/null 2>&1; then
	date_from_epoch() { date -d "@$1" '+%Y-%m-%d'; }
else
	date_from_epoch() { date -r "$1" '+%Y-%m-%d'; }
fi

printf "SIZE\tAGE\tMERGED\tDIRTY\tREMOTE\tPR\tLAST_SESSION\tBUCKET\tWORKTREE\n"

git worktree list --porcelain | awk '/^worktree /{print $2}' | while read -r wt; do
	[ "$wt" = "$main_wt" ] && continue

	size=$(du -sh "$wt" 2>/dev/null | awk '{print $1}')
	size_kb=$(du -sk "$wt" 2>/dev/null | awk '{print $1}')
	head=$(git -C "$wt" rev-parse HEAD 2>/dev/null)
	head_ts=$(git -C "$wt" log -1 --format='%ct' HEAD 2>/dev/null || echo 0)
	age=$([ "$head_ts" -gt 0 ] 2>/dev/null && echo "$(( (now - head_ts) / 86400 ))d" || echo "?")

	# Squash-merged branches are not ancestors of main, so PR state is the
	# real signal; merge-base only catches fast-forward/rebase merges.
	git merge-base --is-ancestor "$head" origin/main 2>/dev/null && merged=YES || merged=no

	# Distinguish real WIP (tracked edits) from disposable untracked scratch.
	porcelain=$(git -C "$wt" status --porcelain 2>/dev/null)
	if [ -z "$porcelain" ]; then dirty=clean
	elif printf '%s\n' "$porcelain" | grep -qv '^??'; then
		dirty="wip:$(printf '%s\n' "$porcelain" | grep -cv '^??')"
	else dirty="scratch:$(printf '%s\n' "$porcelain" | grep -c '^??')"; fi

	branch=$(git -C "$wt" symbolic-ref --quiet --short HEAD 2>/dev/null || echo "")
	if [ -z "$branch" ]; then remote=detached
	elif git -C "$wt" show-ref --verify --quiet "refs/remotes/origin/$branch"; then
		[ "$(git -C "$wt" rev-parse "origin/$branch" 2>/dev/null)" = "$head" ] \
			&& remote=pushed \
			|| remote="ahead$(git -C "$wt" rev-list --count "origin/$branch..HEAD" 2>/dev/null)"
	else remote=no-remote; fi

	pr=$([ -n "$branch" ] && jq -r --arg b "$branch" \
		'.[] | select(.headRefName==$b) | "#\(.number)/\(.state)"' "$prs" 2>/dev/null | head -1)
	[ -z "$pr" ] && pr="-"

	# Most recent pi session that operated in this worktree. Match path
	# followed by "/" or a quote so glint-482 does not match glint-482-r37.
	# `-F` keeps the path literal: as a regex, a `.` in a path matches a
	# sibling worktree's sessions, and `(` makes the pattern invalid (rg's
	# suppressed error would silently report no session at all).
	# pi keys sessions by the session's own cwd, so a worktree's sessions live in
	# their own directory; the repo-level directory is searched too, because a
	# session started in the main checkout can operate on a sibling worktree.
	last="-"; last_ts=0
	wt_sessions="$session_dir/--$(slugify "$wt")--"
	search_dirs=""
	[ -d "$repo_sessions" ] && search_dirs="$repo_sessions"
	[ -d "$wt_sessions" ] && search_dirs="$search_dirs $wt_sessions"
	if [ -n "$search_dirs" ]; then
		# shellcheck disable=SC2086 # word splitting is how rg receives several paths
		f=$(rg -l -F -e "${wt}/" -e "${wt}\"" $search_dirs 2>/dev/null \
			| while IFS= read -r path; do stat_mtime "$path"; done | sort -rn | head -1)
		if [ -n "$f" ]; then last_ts=$(echo "$f" | awk '{print $1}')
			last=$(date_from_epoch "$last_ts" 2>/dev/null); fi
	fi
	recent=$([ "$last_ts" -gt 0 ] 2>/dev/null && [ $(( (now - last_ts) / 86400 )) -le 4 ] && echo yes || echo no)

	case "$dirty" in wip:*) bucket=hold-wip ;; *)
		case "$pr" in *OPEN*) bucket=hold-open-pr ;; *)
			if [ "$recent" = yes ]; then bucket=verify-recent-session
			elif [ "$merged" = YES ] || [ "$pr" != "-" ]; then bucket=safe
			else bucket=review; fi ;;
		esac ;;
	esac

	printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n" \
		"${size_kb:-0}" "$size" "$age" "$merged" "$dirty" "$remote" "$pr" "$last" "$bucket" "$wt"
done | sort -t$'\t' -k1,1 -rn | cut -f2-

rm -f "$prs"
