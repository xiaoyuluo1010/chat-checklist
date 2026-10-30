# chat-checklist

A Claude Code mod that helps record and track the workflow of each chat. It gives every chat its own **checklist of next steps**.

Think of it as the notebook beside your keyboard: one page you and Claude check every turn to see where the work stands and what comes next. A chat is linear, but what you bring to it is scattered, like a brainstorm: new ideas, additions to old ones, reminders. Claude gathers them into this one plan and keeps it current while it works. You read it at a glance and tick, reorder or remove things yourself. It holds reminders, not records: long details stay in your project's own files.

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
○ Ongoing: <the item we are on> · 3 left · open list ›
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
- Hover an item or a sub-step to get `⧉ ✓ ▲ ▼ ✕` (copy, tick, move up, move down, remove). On a done one the tick is `↺`, which reopens it. A sub-step moves only within its item. Remove asks for confirmation.
- `⧉` copies the item with its sub-steps and notes as plain text; `⧉ Copy all` at the top copies the whole list. The pane's text cannot be selected with the mouse (the app draws it natively), so these are the way to copy.
- `↶ Undo` / `↷ Redo` at the top take back your own last clicks, for the moment you regret one. Hover either to see which, e.g. `Undo move`. Once Claude edits the list, this history is cleared, so an undo never rolls back Claude's work; for anything older, just tell Claude what to put back.
- The bottom label shows the chat's state: **Ongoing**, **Done**, **Parked**, **Archive**.

## Who edits what

**Let Claude keep the list; you read it and steer.** The list is meant to run itself:

1. Tell Claude in the chat: new ideas, changes, "drop that", "do this first". Claude files them in the right place.
2. For quick fixes the pane has a few one-click actions: copy, tick, move, remove.
3. About 8 seconds after you click, Claude picks up your intent and confirms it, or asks if it conflicts with the plan.

Your change is your decision, and Claude hears of it:

- About 8 seconds after you stop clicking, Claude gets the details in the background. If Claude was idle, one short line such as `📋 moved "Draft the figure" up` appears in the chat and Claude answers it: not by repeating what you did, but by reacting to it (what it means for the plan, or a question when your intent is unclear).
- If Claude is mid-reply, the note goes into that reply instead.
- If a change conflicts with the plan (you reopened a step, removed one it depends on, ticked off something unfinished), Claude asks before acting on it. It never puts your change back.
- Changes you undo before Claude hears of them are not reported.
- Only edits made with the pane's buttons are tracked. If you edit the file by hand, tell Claude.

## The rules Claude follows

These are injected into the chat automatically (you do not need to paste anything). Short version:

- **Triage everything new you say:** do now (placed where it belongs in the order), part of an existing step (a sub-step or a note under it), later (after the current work), or keep but not do (set aside at once). Chit-chat changes nothing.
- **Settings and cautions become notes:** "use v2", "exclude C10", "check the units" is written under the step it affects, even as one word, so it is there when that step comes.
- **True every turn:** what is done is ticked, what is being worked on is marked, duplicates are folded, stale items struck. Nothing done may still look open.
- **Short:** one-line titles, one to three short notes; no history, no rationale. Long details stay in the project's own files.
- **States:** `[ ]` not started, `[~]` in progress (several allowed), `[x]` done, `[-]` set aside on purpose.
- **Language:** items are written in the language you use in the chat.
- **Chat status:** when every item is done, Claude asks once whether to mark the chat *done*, *park* or *archive*. A new task returns it to Ongoing.

Cost: the rules (about 700 tokens) are added once per chat, and again after the chat is compacted. Each of your messages carries a one-line reminder (about 100 tokens) listing the open items, so Claude checks the list against what is true before it finishes its reply.

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

The mod is meant to stay small and mostly automatic. Before adding a button for something, consider asking Claude to do it instead: editing an item's text, adding notes or restructuring the list are all one sentence in the chat. Add a control only for an action you do often and that is faster as one click.


```
claude plugin validate .
claude plugin test .
```

Tests live in `hooks/register.test.tsx`.

## License

Apache License 2.0. See `LICENSE` and `NOTICE`.
