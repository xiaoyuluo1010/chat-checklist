# chat-checklist

A Claude Code mod that helps record and track the workflow of each chat. It gives every chat its own **checklist of next steps**.

Claude writes and updates the list by itself while it works. You read it at a glance, tick things, reorder, and remove, without re-reading long replies to find out what comes next.

## Install

In Claude Code (2.1.275 or later):

```
/plugin install chat-checklist --marketplace xiaoyuluo1010/chat-checklist
```

Answer `y` to add the marketplace, then choose a scope. Restart the chat to load it.

If you only want to try it in one chat, copy this folder to `~/.claude/dev-mods/<session id>/chat-checklist/` and answer **Turn them on** when asked. A mod copied this way belongs to that one chat; each chat needs its own copy.

## Turn it on, per chat

Installing the mod changes nothing by itself. In a chat where you want a checklist, type:

```
/chat-checklist
```

That creates the chat's list and starts it. Chats where you do not do this stay untouched: no list, no band above the prompt, no messages. Typing the command again later opens the pane. Once on, a chat stays on across restarts and rewinds, even if its list is still empty: the command leaves a small marker file next to the list.

Lists are tied to the chat's session id, and reopening an old chat sometimes gives it a new id. The mod then finds the list the chat used last (from the chat's own history: the note naming the list, or Claude's own edits of the list file) and copies it over, so the list carries on. If it cannot (for example after the history was compacted), run the command again and Claude rebuilds the first list from the conversation (see below).

## What you see

**1. A one-line band above the prompt** (always visible)

```
○ Next: <the item we are on> · 3 left · open list ›
```

The ring is green, like the item in progress in the list. Right after `/chat-checklist`, before Claude has written anything, the band reads `○ Chat Checklist is on · waiting for the first step`.

Click `open list ›` to open the full list in a side pane, `close list ›` to close it. The pane never opens on its own, so it will not get in your way.

**2. The list pane**

| Look | Meaning |
|---|---|
| Blue tick `✔`, normal text | Done |
| Green ring `○`, **bold text** | In progress (what we are on now) |
| Gray ring `○`, gray text | Not started |
| Gray with a line through it | Set aside on purpose, kept for later |

Sub-steps use the same three marks. The desktop app, the editor and mobile draw them as small pictures (a filled blue circle with a white tick, a thick green ring, a thin gray ring); the terminal uses the text glyphs.

- Click a done or not-started title to expand its sub-steps and notes. The item in progress is always expanded.
- Hover an item to get `⧉ ✓ ▲ ▼ ✕` (copy, tick, move up, move down, remove). On a done item the tick is `↺`, which reopens it. Remove asks for confirmation.
- `⧉` copies the item with its sub-steps and notes as plain text; `⧉ Copy all` at the top copies the whole list. The pane's text cannot be selected with the mouse (the app draws it natively), so these are the way to copy.
- `↶ Undo` / `↷ Redo` at the top take back your own last clicks in the pane (tick, reopen, reorder, delete). Hover either one to see which, e.g. `Undo reorder`. When Claude edits the list, this history starts over, so an undo never rolls back Claude's work.
- The bottom label shows the chat's state: **Ongoing**, **Done**, **Parked**, **Archive**.

## Who edits what

| | You | Claude |
|---|---|---|
| Top-level items | tick, reorder, remove | add, reword, mark in progress or done |
| Sub-items and notes | read only | fully owns them |

Claude keeps the list current silently as part of normal work. What you change in the pane is passed to Claude, so it never plans from a stale list or puts your change back:

- With your next message, Claude gets a short note listing your changes and the list as it now stands. It says in one line that it saw them, and asks you to confirm if a change conflicts with its plan (for example you reopened a step, or removed one it depends on).
- If Claude tries to edit the list mid-reply after you changed it, that edit is refused once with the same note, so it re-reads and builds on your version.
- Changes you undo before Claude hears of them are not reported.
- Only edits made with the pane's buttons are tracked. If you edit the file by hand, tell Claude.

## The rules Claude follows

These are injected into the chat automatically (you do not need to paste anything). Short version:

- **A top-level item is a goal**, not a small action. Its concrete steps are sub-items.
- **Order follows dependency.** If a new request must happen first, it goes before the later step, not at the end.
- **States:** `[ ]` not started, `[~]` in progress (several allowed), `[x]` done, `[-]` set aside on purpose. A done item is never struck through.
- **Language:** items are written in the language you use in the chat.
- **Chat status:** when every item is done, Claude asks once whether to mark the chat *done* (finished for good), *park* (kept for possible new tasks) or *archive*. Adding a new task later returns the chat to Ongoing.
- **No history log.** The list is a plan, not a record. If your project already keeps handoff notes, the list only points to them.

Full text of the rules: `rulesOf` in `hooks/register.tsx`.

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
