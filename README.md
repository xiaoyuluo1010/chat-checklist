# chat-checklist

A Claude Code mod that helps record and track the workflow of each chat. It gives every chat its own **checklist of next steps**.

Claude writes and updates the list by itself while it works. You read it at a glance, tick things, reorder, and remove, without re-reading long replies to find out what comes next.

## Turn it on, per chat

Installing the mod changes nothing by itself. In a chat where you want a checklist, type:

```
/chat-checklist
```

That creates the chat's list and starts it. Chats where you do not do this stay untouched: no list, no band above the prompt, no messages. Typing the command again later opens the pane. A list file with no items yet counts as off, so a chat you enabled but never used stays quiet after a restart.

Lists are tied to the chat's session id, and reopening an old chat sometimes gives it a new id. The mod then finds the list the chat used last (its file is named in the chat's own history) and copies it over, so the list carries on. If it cannot (for example after the history was compacted), run the command again and Claude rebuilds the first list from the conversation (see below).

## What you see

**1. A one-line band above the prompt** (always visible)

```
○ Next: <the item we are on> · 3 left · open list ›
```

Click `open list ›` to open the full list in a side pane, `close list ›` to close it. The pane never opens on its own, so it will not get in your way.

**2. The list pane**

| Look | Meaning |
|---|---|
| Normal black, `●` | Done |
| **Bold black** | In progress (what we are on now) |
| Light gray, `○` | Not started |
| Gray with a line through it | Set aside on purpose, kept for later |

- Click a done or not-started title to expand its sub-steps and notes. The item in progress is always expanded.
- Hover a not-yet-done item to get `▲ ▼ ✕` (move up, move down, remove). Remove asks for confirmation.
- Click the `○` checkbox on a top-level item to tick or untick it. Done items are locked from reordering and removal on purpose.
- `↶ Undo` / `↷ Redo` at the top step back and forward through your edits and Claude's edits (last 30).
- The bottom label shows the chat's state: **Ongoing**, **Done**, **Parked**, **Archive**.

## Who edits what

| | You | Claude |
|---|---|---|
| Top-level items | tick, reorder, remove | add, reword, mark in progress or done |
| Sub-items and notes | read only | fully owns them |

Claude keeps the list current silently as part of normal work. If you reorder or delete something, Claude re-reads the file before its next edit and respects your change.

## The rules Claude follows

These are injected into the chat automatically (you do not need to paste anything). Short version:

- **A top-level item is a goal**, not a small action. Its concrete steps are sub-items.
- **Order follows dependency.** If a new request must happen first, it goes before the later step, not at the end.
- **States:** `[ ]` not started, `[~]` in progress (several allowed), `[x]` done, `[-]` set aside on purpose. A done item is never struck through.
- **Language:** items are written in the language you use in the chat.
- **Chat status:** when every item is done, Claude asks once whether to mark the chat *done* (finished for good), *park* (kept for possible new tasks) or *archive*. Adding a new task later returns the chat to Ongoing.
- **No history log.** The list is a plan, not a record. If your project already keeps handoff notes, the list only points to them.

Full text of the rules: `rulesOf` in `hooks/register.tsx`.

## Install

In a Claude Code terminal session:

```
/plugin install chat-checklist --marketplace <owner>/<repo>
```

Answer `y` to add the marketplace, then choose a scope.

If you only want to try it in one chat, copy this folder to `~/.claude/dev-mods/<session id>/chat-checklist/` and answer **Turn them on** when asked. A mod copied this way belongs to that one chat; each chat needs its own copy.

## Adding it to a chat already in progress

Each chat you turn it on for gets its own, initially empty list. If the chat already holds work, Claude builds the first version once from the conversation so far and from small project notes it finds (a handoff, progress or TODO file). It does not scan your whole folder and does not invent items it cannot support. Check that first list and correct it; after that it is maintained as usual.

## Where the lists live

`~/.claude/chat-checklists/<session id>.md`, one plain Markdown file per chat. You can open and edit it yourself; the pane refreshes within about two seconds.

```markdown
# Chat Checklist
- [x] Load the data
- [~] Fix the batch effect
  - [x] Check PCA before correction
  - [ ] Rerun with batch as covariate
  > Batch 2 looks shifted on PC1
- [ ] Draft the figure
- [-] Try the second normalization (later)
```

## Limits

- The desktop app draws the band and pane in a fixed style: button text colour and font size cannot be changed, and items cannot be dragged (use `▲ ▼`).
- Lists are stored on the local machine and are not synced between computers.
- Tested on the Claude desktop app. The terminal and other surfaces draw the same list but have not been checked.
- Works with the Claude Code mod API as of version 2.1; later API changes may require updates.

## Author and credit

Created by xiaoyuluo1010 (first version October 2026). The original repository, its commit history and its release tags are the record of authorship. If you fork or adapt it, the license requires you to keep `NOTICE` and to mark any file you changed as changed.

## Development

```
claude plugin validate .
claude plugin test .
```

Tests live in `hooks/register.test.tsx`.

## License

Apache License 2.0. See `LICENSE` and `NOTICE`.
