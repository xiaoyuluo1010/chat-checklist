// chat-checklist: a per-chat checklist of next steps. Copyright 2026 xiaoyuluo1010. Licensed under the Apache License, Version 2.0 (see LICENSE and NOTICE).
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

const PANE = 'chat-checklist'
const TITLE = 'Chat Checklist'
const KEEP_DONE = 2
const POLL_MS = 2000

const text = atom({ plugin: 'chat-checklist', key: 'text' } as const, '', {
  shape: 'text-1',
})
const showOlder = atom({ plugin: 'chat-checklist', key: 'showOlder' } as const, false, {
  shape: 'older-1',
})
// Titles of the done / not-started items the person has opened.
const expanded = atom({ plugin: 'chat-checklist', key: 'expanded' } as const, [] as string[], {
  shape: 'expanded-2',
})
// The title of the item awaiting delete confirmation.
const pending = atom({ plugin: 'chat-checklist', key: 'pending' } as const, '', {
  shape: 'pending-1',
})

// Snapshots of the whole file for undo and redo, newest last.
const undo = atom({ plugin: 'chat-checklist', key: 'undo' } as const, [] as string[], {
  shape: 'undo-3',
})
const redo = atom({ plugin: 'chat-checklist', key: 'redo' } as const, [] as string[], {
  shape: 'redo-3',
})
const HISTORY = 30
// Undo and redo are the person's quick take-backs of their own pane actions: each step holds the
// action and the list as it was before it. Once Claude edits the list, a snapshot would also roll
// back Claude's edit, so the history starts over.
type Op = {
  act: 'tick' | 'reopen' | 'reorder' | 'delete'
  body: string
  dir?: -1 | 1 // a reorder's direction
  snap?: string // the list before the action (on redo: before the undo)
}

const readOp = (raw: string | undefined): Op | undefined => {
  try {
    return raw ? (JSON.parse(raw) as Op) : undefined
  } catch {
    return undefined
  }
}

// Puts the person's step on the undo stack; a new step clears redo.
async function pushUndo($: any, op: Op): Promise<void> {
  await update($, undo, l => [...l, JSON.stringify(op)].slice(-HISTORY))
  await update($, redo, () => [])
}

// What the person changed in the pane since Claude last heard, and the list as Claude last knew it.
const changes = atom({ plugin: 'chat-checklist', key: 'changes' } as const, [] as string[], {
  shape: 'changes-1',
})
const seen = atom({ plugin: 'chat-checklist', key: 'seen' } as const, '', {
  shape: 'seen-1',
})

// Clickable controls are light blue where the surface honours it.
const BLUE = '#6aa6e6'
// Not started or set aside: a light gray. Done and now use the normal text color.
const GRAY = '#a8a8a8'
// State glyphs: a blue tick for done, a green ring for what we are on, a gray ring for not started.
const DONE_BLUE = '#4a90d9'
const NOW_GREEN = '#4caf6e'
// The Undo / Redo hover board: half-clear white, a light edge, gray words.
const TIP_BG = 'rgba(255, 255, 255, 0.85)'
const TIP_EDGE = '#dddddd'
const TIP_TEXT = '#8a8a8a'

type Kind = 'done' | 'now' | 'open'

const MARK_SVG: Record<Kind, string> = {
  done: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill="${DONE_BLUE}"/><path d="M5.8 10.2l2.8 2.9 5.6-6" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  now: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><circle cx="10" cy="10" r="7.4" fill="none" stroke="${NOW_GREEN}" stroke-width="3.2"/></svg>`,
  open: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><circle cx="10" cy="10" r="7.6" fill="none" stroke="${GRAY}" stroke-width="2.2"/></svg>`,
}
const MARK_ALT: Record<Kind, string> = { done: 'done', now: 'in progress', open: 'not started' }

// The state mark as a small drawing where the surface has Svg (desktop, editor, mobile), else a glyph.
const markOf$ = (ui: any, kind: Kind, size: number) =>
  ui.Svg ? (
    <ui.Svg source={MARK_SVG[kind]} alt={MARK_ALT[kind]} width={size} height={size} />
  ) : kind === 'done' ? (
    <ui.Text bold color={DONE_BLUE}>✔</ui.Text>
  ) : kind === 'now' ? (
    <ui.Text bold color={NOW_GREEN}>○</ui.Text>
  ) : (
    <ui.Text color={GRAY}>○</ui.Text>
  )

const STATE_MARK = {
  active: { glyph: '○', color: '#4caf6e', label: 'Ongoing' },
  ask: { glyph: '◌', color: GRAY, label: 'Decide: done / park / archive?' },
  done: { glyph: '●', color: '#4a90d9', label: 'Done' },
  park: { glyph: '◐', color: '#d4a017', label: 'Parked' },
  archive: { glyph: '■', color: undefined, label: 'Archive' },
  new: { glyph: '⚑', color: GRAY, label: 'New tasks, status needs reset' },
} as const

type State = 'active' | 'done' | 'park' | 'archive'

const markKey = (left: number, state: State): keyof typeof STATE_MARK => {
  if (left > 0) return state === 'active' ? 'active' : 'new'

  return state === 'active' ? 'ask' : state
}

const HEADER =
  '# Chat Checklist\n<!-- Claude keeps this list; the user reads it in the Chat Checklist pane. Item: "- [ ] title" (open), "- [~] title" (in progress), "- [x] title" (done), "- [-] title" (set aside, kept, shown struck through). Two spaces of indent = a sub-item of the item above. Optional detail lines "  > text". Order = order to do. First open top-level item = what we are on. Final state: a line "status: done", "status: park" or "status: archive"; none = ongoing. -->\n'

const TASK = /^(\s*)- \[( |x|X|-|~)\]\s+(.*)$/
const DETAIL = /^\s+>\s?(.*)$/

type Mark = 'open' | 'doing' | 'done' | 'dropped'

const isLive = (m: Mark): boolean => m === 'open' || m === 'doing'

type Item = {
  line: number
  mark: Mark
  body: string
  indent: number
  details: string[]
}

const markOf = (c: string): Mark =>
  c === ' ' ? 'open' : c === '-' ? 'dropped' : c === '~' ? 'doing' : 'done'

const parse = (src: string): Item[] => {
  const lines = src.split('\n')
  const items: Item[] = []
  lines.forEach((raw, line) => {
    const m = TASK.exec(raw)
    if (!m) return
    const details: string[] = []
    for (let j = line + 1; j < lines.length; j++) {
      const d = DETAIL.exec(lines[j])
      if (!d) break
      details.push(d[1])
    }
    items.push({ line, mark: markOf(m[2]), body: m[3], indent: m[1].length, details })
  })

  return items
}

const MARK_WORD: Record<Mark, string> = { open: 'not started', doing: 'in progress', done: 'done', dropped: 'set aside' }
const quote = (b: string): string => `"${clip(b, 30)}"`

// What going from one version of the list to another does, in a few words: the item changes first,
// then moves and note edits. Used for the Undo and Redo labels and for the note to Claude.
function describe(from: string, to: string): string {
  const a = parse(from)
  const b = parse(to)
  const was = new Map(a.map(it => [it.body, it]))
  const now = new Map(b.map(it => [it.body, it]))
  const out: string[] = []
  for (const it of b) {
    const old = was.get(it.body)
    if (!old) out.push(`add ${quote(it.body)}`)
    else if (old.mark !== it.mark)
      out.push(it.mark === 'done' ? `tick ${quote(it.body)}` : `mark ${quote(it.body)} ${MARK_WORD[it.mark]}`)
    else if (old.details.join('\n') !== it.details.join('\n')) out.push(`change the notes of ${quote(it.body)}`)
  }
  for (const it of a) if (!now.has(it.body)) out.push(`remove ${quote(it.body)}`)
  if (out.length === 0) {
    const kept = a.filter(it => now.has(it.body))
    const moved = kept.filter(it => b.findIndex(x => x.body === it.body) !== kept.indexOf(it))
    if (moved.length > 0) out.push(`move ${quote(moved[0].body)}`)
  }
  if (out.length === 0) {
    const st = parseStatus(to).state
    if (st !== parseStatus(from).state) out.push(st === 'active' ? 'clear the chat status' : `set the chat status to ${st}`)
  }
  if (out.length === 0) return 'a formatting change'

  return out.length > 3 ? `${out.slice(0, 3).join('; ')}; and ${out.length - 3} more` : out.join('; ')
}

// "status: done", "status: park waiting for new data" or "status: archive"; absent means ongoing.
const STATUS = /^status:\s*(done|park|archive|active)\b\s*(.*)$/i

const parseStatus = (src: string): { state: State; note: string } => {
  for (const l of src.split('\n')) {
    const m = STATUS.exec(l.trim())
    if (m) return { state: m[1].toLowerCase() as State, note: m[2] }
  }

  return { state: 'active', note: '' }
}

const statusLines = (lines: string[], state: State): string[] => {
  const out = lines.filter(l => !STATUS.test(l.trim()))
  if (state === 'active') return out
  const at = out[1]?.startsWith('<!--') ? 2 : 1
  out.splice(at, 0, `status: ${state}`)

  return out
}

// CJK counts 2 cells; a Button title does not wrap, so it is cut to the pane width.
const cellWidth = (c: string): number =>
  /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(c) ? 2 : 1

const clip = (s: string, max: number): string => {
  let w = 0
  let out = ''
  for (const c of s) {
    w += cellWidth(c)
    if (w > max) return out.trimEnd() + '…'
    out += c
  }

  return s
}

const findLine = (lines: string[], body: string): number =>
  lines.findIndex(l => TASK.exec(l)?.[3] === body)

// One past the item's last line: its details, deeper sub-items and blank lines between.
const fullEnd = (lines: string[], idx: number): number => {
  const ind = TASK.exec(lines[idx])?.[1].length ?? 0
  let j = idx + 1
  while (j < lines.length) {
    const m = TASK.exec(lines[j])
    if ((m && m[1].length <= ind) || /^#/.test(lines[j])) break
    j++
  }
  while (j > idx + 1 && lines[j - 1].trim() === '') j--

  return j
}

// The nearest item at the same depth above (-1) or below (1), or -1.
const neighbor = (lines: string[], idx: number, dir: -1 | 1): number => {
  const ind = TASK.exec(lines[idx])?.[1].length ?? 0
  const from = dir < 0 ? idx - 1 : fullEnd(lines, idx)
  for (let j = from; j >= 0 && j < lines.length; j += dir) {
    const m = TASK.exec(lines[j])
    if (!m) continue
    if (m[1].length < ind) return -1
    if (m[1].length === ind) return j
  }

  return -1
}

const swapUp = (lines: string[], idx: number): string[] | undefined => {
  const nb = neighbor(lines, idx, -1)
  if (nb < 0) return undefined
  const end = fullEnd(lines, idx)

  return [
    ...lines.slice(0, nb),
    ...lines.slice(idx, end),
    ...lines.slice(nb, idx),
    ...lines.slice(end),
  ]
}

const setMark = (lines: string[], body: string, mark: string): string[] | undefined => {
  const idx = findLine(lines, body)
  if (idx < 0) return undefined
  const out = [...lines]
  out[idx] = out[idx].replace(/\[( |x|X|-|~)\]/, `[${mark}]`)

  return out
}

const removeLines = (lines: string[], body: string): string[] | undefined => {
  const idx = findLine(lines, body)
  if (idx < 0) return undefined

  return [...lines.slice(0, idx), ...lines.slice(fullEnd(lines, idx))]
}

const moveLines = (lines: string[], body: string, dir: -1 | 1): string[] | undefined => {
  const idx = findLine(lines, body)
  if (idx < 0) return undefined
  if (dir < 0) return swapUp(lines, idx)
  const nb = neighbor(lines, idx, 1)

  return nb < 0 ? undefined : swapUp(lines, nb)
}

async function pathOf($: any): Promise<string> {
  const id = await $.session.id()
  const home = (await $.env.get('HOME')) ?? '~'

  return `${home}/.claude/chat-checklists/${id}.md`
}

// A small marker beside the list, written only by /chat-checklist (or a carry-over). It keeps a chat
// on when the list file is rewound, deleted or still has no items; Claude never edits it.
async function onPathOf($: any): Promise<string> {
  return (await pathOf($)).replace(/\.md$/, '.on')
}

async function markOn($: any): Promise<void> {
  await $.fs.write(await onPathOf($), 'on\n')
}

// The desktop app may not take $.ui.copy yet; the mod runs on the person's own machine, so the
// system clipboard tool is the fallback.
async function copyText($: any, text: string): Promise<void> {
  let done = false
  try {
    done = (await $.ui.copy({ text }))?.isCopied === true
  } catch {}
  if (!done) {
    for (const argv of [['pbcopy'], ['wl-copy'], ['xclip', '-selection', 'clipboard']]) {
      try {
        const r = await $.process.run(argv, { stdin: text, timeoutMs: 3000 })
        if (r?.exitCode === 0) {
          done = true
          break
        }
      } catch {}
    }
  }
  await $.ui.toast(done ? 'Copied' : 'Could not copy').catch(() => {})
}

// One item as plain text: its title, its notes, then its sub-items with their notes.
function plainOf(lines: string[], body: string): string {
  const idx = findLine(lines, body)
  if (idx < 0) return body
  const base = TASK.exec(lines[idx])?.[1].length ?? 0
  const out: string[] = []
  for (const raw of lines.slice(idx, fullEnd(lines, idx))) {
    const t = TASK.exec(raw)
    const d = DETAIL.exec(raw)
    if (t) out.push(t[1].length === base ? t[3] : `${' '.repeat(t[1].length - base - 2)}- ${t[3]}`)
    else if (d) out.push(`${' '.repeat(Math.max(0, raw.search(/\S/) - base))}${d[1]}`)
  }

  return out.join('\n')
}

// The whole list as plain Markdown, without the file's header comment.
const plainAll = (src: string): string =>
  src
    .split('\n')
    .filter(l => !l.startsWith('<!--') && !l.startsWith('# '))
    .join('\n')
    .trim()

async function load($: any): Promise<void> {
  const file = await pathOf($)
  let src: string
  try {
    src = await $.fs.read(file)
  } catch {
    src = HEADER
    await $.fs.write(file, src)
  }
  const cur = await read($, text)
  if (cur !== src) {
    await update($, text, () => src)
    if (cur) {
      await update($, undo, () => [])
      await update($, redo, () => [])
    }
  }
}

// One pane edit of the person's, kept until Claude is told.
async function noteChange($: any, before: string, what: string): Promise<void> {
  if (!(await read($, seen))) await update($, seen, () => before)
  await update($, changes, l => [...l, what].slice(-HISTORY))
  tellSoon($)
}

// Claude hears of pane edits by itself once the person has paused. The full note goes in as a hidden
// row; while Claude is idle, a one-line message (the change itself) then starts a turn, so Claude
// can answer it. The long note never shows in the chat.
const SETTLE_MS = 8000
let settle: { cancel: () => void } | undefined
let busy = false

function tellSoon($: any): void {
  settle?.cancel()
  settle = $.clock.after(SETTLE_MS, () => void tell($).catch(() => {}))
}

async function tell($: any): Promise<void> {
  const log = await read($, changes)
  if (log.length === 0) return
  let now = ''
  try {
    now = await $.fs.read(await pathOf($))
  } catch {}
  if (now === (await read($, seen))) {
    await update($, changes, () => [])
    await update($, seen, () => '')

    return
  }
  const said = await takeChanges($)
  if (!said) return
  await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: said }] } })
  if (!busy) await $.prompt.submit({ text: clip(`📋 ${log.join('; ')}`, 120), asUser: true })
}

// The person's pane edits since Claude last heard, as a note for Claude, then cleared.
// Nothing when they undid their way back to the list Claude knew.
async function takeChanges($: any, brief = false): Promise<string | undefined> {
  const log = await read($, changes)
  if (log.length === 0) return undefined
  const base = await read($, seen)
  await update($, changes, () => [])
  await update($, seen, () => '')
  let now = ''
  try {
    now = await $.fs.read(await pathOf($))
  } catch {}
  if (now === base) return undefined

  return [
    'Chat Checklist: the user changed the list themselves in the pane since you last saw it:',
    ...log.map(l => `- ${l}`),
    ...(brief ? [`The list is at ${await pathOf($)}.`] : ['The list now:', plainAll(now) || '(empty)']),
    'Take this as their decision: plan from the list as it is now and never put back what they changed. Open your next words with one short line reacting to it, not restating it (they know what they did): what it means for the plan ("📋 So we start with X now."), or, when the reason is unclear, a question about it ("📋 X first: do you want to start on it now?"). When the change is all there is to answer, that line is the whole reply. If it conflicts with what you were doing or planned (they reopened, removed or reordered a step you depend on, or ticked off something you think is unfinished), ask them to confirm before acting on it.',
  ].join('\n')
}

// An action done, or taken back, on the list as it is now; undefined when its item is gone.
const forward = (op: Op, lines: string[]): string[] | undefined =>
  op.act === 'tick'
    ? setMark(lines, op.body, 'x')
    : op.act === 'reopen'
      ? setMark(lines, op.body, ' ')
      : op.act === 'reorder'
        ? moveLines(lines, op.body, op.dir ?? 1)
        : removeLines(lines, op.body)

// Takes one step off one stack, puts its list back, and moves the step to the other stack.
async function step($: any, isUndo: boolean): Promise<void> {
  const op = readOp((isUndo ? await read($, undo) : await read($, redo)).slice(-1)[0])
  if (isUndo) await update($, undo, l => l.slice(0, -1))
  else await update($, redo, l => l.slice(0, -1))
  if (!op?.snap) return
  const file = await pathOf($)
  const cur = await $.fs.read(file)
  const src = op.snap
  // The drawn text first, so the poll does not take this write for Claude's.
  await update($, text, () => src)
  await $.fs.write(file, src)
  await noteChange($, cur, `${isUndo ? 'undo' : 'redo'}: ${describe(cur, src)}`)
  const back = JSON.stringify({ ...op, snap: cur })
  if (isUndo) await update($, redo, l => [...l, back].slice(-HISTORY))
  else await update($, undo, l => [...l, back].slice(-HISTORY))
}

const stepUndo = ($: any) => step($, true)
const stepRedo = ($: any) => step($, false)

// Re-reads the file, applies one action of the person's, writes it back.
async function edit($: any, op: Op, what: string): Promise<void> {
  const file = await pathOf($)
  const before = await $.fs.read(file)
  const out = forward(op, before.split('\n'))
  if (!out) return
  const src = out.join('\n')
  if (src === before) return
  await update($, text, () => src)
  await $.fs.write(file, src)
  await noteChange($, before, what)
  await pushUndo($, { ...op, snap: before })
}

async function rulesOf($: any): Promise<string> {
  const file = await pathOf($)

  return [
    `Chat Checklist: this chat keeps a running list at ${file}. The user sees it live in a side pane and in one line above the prompt.`,
    '- What it is: the desk notebook of this chat, one page you and the user check every turn to see where the work stands and what comes next. It holds reminders, not records. Long details (protocols, logs, decisions, handoffs) live in the project\'s own files or notes; a note here may point to them in a few words.',
    '- The chat is linear but what the user brings is scattered, like a brainstorm: new ideas, additions to old ones, reminders. The list is the plan that gathers it all into one overview. You may talk about it in chat in a line (e.g. "Good point, I added it under step 3"), or ask where something goes when it is unclear.',
    '- Triage everything new the user says, every time: do now (put it where it belongs in the order, before the step it must precede); part of an existing step (a sub-item or a note under that step, not a new item); later (after the current work, ordered by dependency); an idea to keep but not do (add it as `[-]` at once). A setting, parameter or caution ("use v2", "exclude C10", "check the units") is a note under the step it affects, even one word, so it is there when that step comes. Chit-chat or a question answered in place changes nothing.',
    '- Keep it true every turn, silently, with Edit/Write: tick what got done (items and sub-items), mark what you are on `[~]` (several may be), fold duplicates, strike `[-]` what no longer applies, re-order when priorities change. Nothing done may still look open. Re-read the file before editing.',
    '- Keep it short: a title is one line (about 40 Latin or 20 CJK characters); notes one to three short lines; no history, no rationale. Write in the language the user uses.',
    '- Format: `- [ ] open`, `- [~] in progress`, `- [x] done`, `- [-] set aside (kept, struck through)`. Top-level items are goals; sub-items, indented two spaces, are their steps. Notes: `  > text` right under their item.',
    '- An empty list in a chat that already holds work: build a first version once from the conversation and small, clearly relevant project notes; do not invent items.',
    '- When every top-level item is done, ask once whether the chat is done, parked or archived, then write `status: done`, `status: park` (optional note after it) or `status: archive` under the header. A new item removes the line.',
    '- The user edits too (tick, reopen, move, remove, on items and sub-items; a sub-item moves only within its item). Their change is their decision: never put it back. A note tells you; open your next words with one short line reacting to it, not restating it: what it means for the plan, or a question about their intent when it is unclear ("📋 X first: start on it now?"); ask before acting on it if it conflicts with the plan. Delete lines only when they do or ask. Do not mention the file in chat unless asked.',
  ].join('\n')
}

// Compaction may fold the rules note into a summary, so the next prompt carries them again.
let rulesLost = false

// A one-line nudge with every prompt (about 100 tokens): the open top-level items, so Claude sees
// stale ones without reading the file, and the ask to triage and update before the turn ends.
const NUDGE_ITEMS = 8
async function nudgeOf($: any): Promise<string> {
  let src = ''
  try {
    src = await $.fs.read(await pathOf($))
  } catch {}
  const glyph: Record<Mark, string> = { open: '[ ]', doing: '[~]', done: '[x]', dropped: '[-]' }
  const live = parse(src).filter(it => it.indent === 0 && isLive(it.mark))
  const shown = live.slice(0, NUDGE_ITEMS).map(it => `${glyph[it.mark]} ${clip(it.body, 30)}`)
  if (live.length > NUDGE_ITEMS) shown.push(`+${live.length - NUDGE_ITEMS} more`)

  return `Chat Checklist upkeep: before this turn ends, if anything changed, update ${await pathOf($)}: triage what the user just said (now / into a step / later / set aside / a note on the step it affects), tick what got done, keep the order right. Open: ${shown.join(' · ') || 'none'}`
}

let registered = false
let running = false
let tries = 0

// The list is opt-in per chat: it runs where /chat-checklist left its marker, or where a list
// with items already exists. A header-only file with no marker (old auto-on versions) counts as off.
async function isOn($: any): Promise<boolean> {
  try {
    await $.fs.read(await onPathOf($))

    return true
  } catch {}
  try {
    return (await $.fs.read(await pathOf($))).split('\n').some((l: string) => TASK.test(l))
  } catch {
    return false
  }
}

// A chat resumed under a new session id keeps its transcript, and with it two traces of the
// list it used: the rules note a session appends at start (stored as a meta message, which the
// transcript rows may leave out, and not always first in its message), and Claude's own Edit and
// Write calls on the list file. The newest trace names the list this chat used last; if it is
// not this session's own, copy it over.
const NOTE = /Chat Checklist: this chat (?:has a running next-step list|keeps a running list) at (\S+\.md)\./g
const LIST_FILE = /\/\.claude\/chat-checklists\/[^/\s]+\.md$/

// The list file a message names, newest trace in it first.
function traceOf(m: any): string | undefined {
  if (m.role === 'assistant') {
    const uses = Array.isArray(m.toolUses) ? m.toolUses : []
    for (let k = uses.length - 1; k >= 0; k--) {
      const path = uses[k]?.input?.file_path
      if ((uses[k].tool === 'Edit' || uses[k].tool === 'Write') && typeof path === 'string' && LIST_FILE.test(path)) {
        return path
      }
    }

    return undefined
  }
  const hits = [...(m.text ?? '').matchAll(NOTE)]

  return hits.length > 0 ? hits[hits.length - 1][1] : undefined
}

async function inherit($: any): Promise<boolean> {
  const file = await pathOf($)
  const found = await $.session.messages()
  if (!Array.isArray(found)) return false
  for (let i = found.length - 1; i >= 0; i--) {
    const from = traceOf(found[i])
    if (!from) continue
    if (from === file) return false
    try {
      const src = await $.fs.read(from)
      const marked = await $.fs.read(from.replace(/\.md$/, '.on')).then(() => true, () => false)
      if (!marked && !src.split('\n').some((l: string) => TASK.test(l))) return false
      await $.fs.write(file, src)
      await markOn($)

      return true
    } catch {
      return false
    }
  }

  return false
}

async function start($: any): Promise<void> {
  if (running) return
  running = true
  await load($)
  $.clock.every(POLL_MS, () => load($).catch(() => {}))
  await $.session
    .append({ message: { type: 'user', content: [{ type: 'text', text: await rulesOf($) }] } })
    .catch(() => {})
}

async function ensure($: any): Promise<void> {
  if (!registered) {
    registered = true
    await $.command.register({
      name: 'chat-checklist',
      description: 'Turn on the Chat Checklist for this chat, or open its pane',
    })
  }
  if (running) return
  if (await isOn($)) return start($)
  // The transcript may not be read yet at start, so a few prompts try again.
  if (tries < 3) {
    tries += 1
    if (await inherit($).catch(() => false)) await start($)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await ensure($)

    return next(e)
  })

  // A mod loaded mid-session never sees session.start, so the next prompt starts it.
  on('prompt.submit', async ($, e, next) => {
    // A failure here must never hold up the person's prompt.
    await ensure($).catch(() => {})
    if (!running || e.command) return next(e)
    const add: string[] = []
    if (rulesLost) {
      rulesLost = false
      add.push(await rulesOf($))
    }
    const said = await takeChanges($).catch(() => undefined)
    if (said) add.push(said)
    add.push(await nudgeOf($).catch(() => ''))

    return next({ ...e, context: [...(e.context ?? []), ...add.filter(Boolean)] })
  })

  on('session.compact', async ($, e, next) => {
    const out = await next(e)
    if (running && !(out as any)?.skip) rulesLost = true

    return out
  })

  on('turn.start', async ($, e, next) => {
    if ((e as any).agentId === undefined) busy = true

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if ((e as any).agentId === undefined) busy = false

    return next(e)
  })

  // Claude editing the list with pane changes it has not heard of: refuse once, with the changes.
  on('tool.call', async ($, e, next) => {
    const path = (e as any).file_path
    if ((e.tool === 'Edit' || e.tool === 'Write') && running && path === (await pathOf($))) {
      const said = await takeChanges($).catch(() => undefined)
      if (said) return { deny: `${said}\nRead the list again, then make your edit on top of their version.` }
    }

    return next(e)
  })

  on('command.run', { command: 'chat-checklist' }, async $ => {
    if (await isOn($)) {
      await $.ui.open({ id: PANE, title: TITLE })

      return { text: `Chat Checklist pane opened. List file: ${await pathOf($)}` }
    }
    await $.fs.write(await pathOf($), HEADER)
    await markOn($)
    await start($)

    return { text: 'Chat Checklist is on for this chat. Claude will keep its list; the next step shows above the prompt.' }
  })

  // One line above the prompt: the item we are on, so no extra column is needed.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const src = await read($, text)
    const tops = parse(src).filter(it => it.indent === 0)
    const up = tops.find(it => it.mark === 'doing') ?? tops.find(it => isLive(it.mark))
    if (e.props.hasSurvey) return next(e)
    // Turned on but no items yet: say so, so the person knows it is on.
    if (tops.length === 0) {
      if (!(await isOn($))) return next(e)
      const ui = $.ui.resolve(e)
      const { Box, Text } = ui

      return (
        <Box flexDirection="row" alignItems="center" gap={1}>
          {markOf$(ui, 'now', 14)}
          <Text color={GRAY}>Chat Checklist is on · waiting for the first step</Text>
        </Box>
      )
    }

    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    const open = tops.filter(it => isLive(it.mark)).length
    const isOpen = (await $.ui.panes()).some(pane => pane.id === PANE)
    const mark = STATE_MARK[markKey(open, parseStatus(src).state)]

    return (
      <Box flexDirection="row" alignItems="center" gap={1}>
        {up ? markOf$(ui, 'now', 14) : null}
        {up ? (
          <Text color={GRAY}>Ongoing: {up.body} · {open} left ·</Text>
        ) : (
          <Text color={mark.color}>
            {mark.glyph} All done · {mark.label} ·{' '}
          </Text>
        )}
        <Button
          key="all"
          plain
          onPress={async () => {
            if (isOpen) await $.ui.close({ id: PANE })
            else await $.ui.open({ id: PANE, title: TITLE })
            $.ui.invalidate('ui.render')
          }}
        >
          <Text color={BLUE}>{isOpen ? 'close list' : 'open list'} ›</Text>
        </Button>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button, Markdown } = ui
    const src = await read($, text)
    const items = parse(src)
    const older = await read($, showOlder)

    const ask = await read($, pending)
    const open$ = await read($, expanded)
    const room = Math.max(12, (e.props.bodyColumns ?? 40) - 10)
    const canUndo = (await read($, undo)).length > 0
    const canRedo = (await read($, redo)).length > 0
    const ACT_WORD = { tick: 'tick', reopen: 'reopen', reorder: 'move', delete: 'delete' } as const
    const undoOp = readOp((await read($, undo)).slice(-1)[0])
    const redoOp = readOp((await read($, redo)).slice(-1)[0])
    const undoTip = undoOp ? ACT_WORD[undoOp.act] : 'change'
    const redoTip = redoOp ? ACT_WORD[redoOp.act] : 'change'

    // A label that floats under Undo or Redo while the pointer is on it, wide enough for one line.
    const tip = (said: string | undefined) =>
      said ? (
        <Box
          position="absolute"
          top={1}
          left={0}
          minWidth={said.length + 4}
          display="none"
          hover={{ display: 'flex' }}
          backgroundColor={TIP_BG}
          borderStyle="round"
          borderColor={TIP_EDGE}
          paddingX={1}
        >
          <Text color={TIP_TEXT} wrap="truncate">
            {said}
          </Text>
        </Box>
      ) : null

    // Top-level items, each with the sub-items indented under it.
    const groups: { top: Item; subs: Item[] }[] = []
    for (const it of items) {
      if (it.indent === 0 || groups.length === 0) groups.push({ top: it, subs: [] })
      else groups[groups.length - 1].subs.push(it)
    }

    const doneIdx = groups.map((g, i) => (g.top.mark === 'done' ? i : -1)).filter(i => i >= 0)
    const hidden = new Set(doneIdx.slice(0, Math.max(0, doneIdx.length - KEEP_DONE)))
    const nowIdx = groups.findIndex(g => isLive(g.top.mark))
    const left = groups.filter(g => isLive(g.top.mark)).length
    // Bold = being worked on: every [~] item, or, when none is marked, the first open one.
    const anyDoing = groups.some(g => g.top.mark === 'doing')
    const status = parseStatus(src)
    const stateMark = STATE_MARK[markKey(left, status.state)]

    // Hover-only controls for one item: copy, tick (or reopen a done one), move up, move down, remove.
    const controls = (k: string, body: string, isDone: boolean) => (
      <Box display="none" hover={{ display: 'flex' }}>
        <Markdown
          key={k}
          dimColor
          text={`[⧉](https://chat-checklist.invalid/copy) [${isDone ? '↺' : '✓'}](https://chat-checklist.invalid/tick) [▲](https://chat-checklist.invalid/up) [▼](https://chat-checklist.invalid/down) [✕](https://chat-checklist.invalid/remove)`}
          onLinkPress={link => {
            if (link.href.endsWith('/copy')) void copyText($, plainOf(src.split('\n'), body))
            else if (link.href.endsWith('/tick'))
              void edit($, { act: isDone ? 'reopen' : 'tick', body }, isDone ? `reopened "${body}" (was done)` : `marked "${body}" done`)
            else if (link.href.endsWith('/up')) void edit($, { act: 'reorder', body, dir: -1 }, `moved "${body}" up`)
            else if (link.href.endsWith('/down')) void edit($, { act: 'reorder', body, dir: 1 }, `moved "${body}" down`)
            else void update($, pending, () => body)
          }}
        />
      </Box>
    )

    // The second click that really deletes.
    const confirm = (k: string, body: string, margin: number) => (
      <Box flexDirection="row" gap={1} marginLeft={margin}>
        <Text>Remove this item?</Text>
        <Button
          key={`y${k}`}
          plain
          onPress={async () => {
            await edit($, { act: 'delete', body }, `removed "${body}" with its sub-items and notes`)
            await update($, pending, () => '')
          }}
        >
          <Text color={BLUE}>Confirm</Text>
        </Button>
        <Button key={`n${k}`} plain onPress={() => update($, pending, () => '')}>
          <Text color={BLUE}>Cancel</Text>
        </Button>
      </Box>
    )

    const dots = (
      <Box alignSelf="center">
        <Text dimColor>⋮</Text>
      </Box>
    )

    return (
      <Box flexDirection="column" rowGap={1}>
        <Box flexDirection="row" gap={1}>
          <Text dimColor>
            {left} open · {doneIdx.length} done
          </Text>
          <Box key="undoAt">
            <Markdown
              key="undo"
              dimColor={!canUndo}
              text={canUndo ? '[**↶ Undo**](https://chat-checklist.invalid/undo)' : '**↶ Undo**'}
              onLinkPress={() => void stepUndo($)}
            />
            {canUndo && tip(`Undo ${undoTip}`)}
          </Box>
          <Box key="redoAt">
            <Markdown
              key="redo"
              dimColor={!canRedo}
              text={canRedo ? '[**↷ Redo**](https://chat-checklist.invalid/redo)' : '**↷ Redo**'}
              onLinkPress={() => void stepRedo($)}
            />
            {canRedo && tip(`Redo ${redoTip}`)}
          </Box>
          {items.length > 0 && (
            <Markdown
              key="copyall"
              text="[**⧉ Copy all**](https://chat-checklist.invalid/copyall)"
              onLinkPress={() => void copyText($, plainAll(src))}
            />
          )}
        </Box>
        {hidden.size > 0 && (
          <Button key="older" plain onPress={() => update($, showOlder, v => !v)}>
            <Text color={BLUE}>
              {older ? '▾ hide' : '▸ show'} {hidden.size} earlier done
            </Text>
          </Button>
        )}
        {items.length === 0 && <Text dimColor>No items yet. Claude writes the next steps here.</Text>}
        {groups.map((g, gi) => {
          if (hidden.has(gi) && !older) return null
          const it = g.top
          const isNow = gi === nowIdx
          const isDone = it.mark === 'done'
          const isDropped = it.mark === 'dropped'
          const hasPrev = groups.slice(0, gi).some((_, j) => !hidden.has(j) || older)
          const hasNext = gi < groups.length - 1
          const isBold = it.mark === 'doing' || (!anyDoing && isNow)
          // In-progress items show everything; done and not-started ones open on a click.
          const isOpened = !isDropped && (isBold || open$.includes(it.body))
          const label = clip(it.body, room - (isDone ? 0 : 8))
          const isClipped = label !== it.body
          const toggleOpen = () =>
            update($, expanded, list =>
              list.includes(it.body) ? list.filter(b => b !== it.body) : [...list, it.body],
            )
          const subDoing = g.subs.some(s => s.mark === 'doing')
          const firstOpenSub = g.subs.findIndex(s => s.mark === 'open')

          return (
            <Box key={`w${it.line}`} flexDirection="column" rowGap={1}>
              {isNow && hasPrev && dots}
              <Box key={`r${it.line}`} flexDirection="column">
                <Box flexDirection="row" alignItems="center" gap={1}>
                  {/* A drawing, not a button: a Button holds only text. Ticking is in the hover controls. */}
                  <Box marginLeft={1}>{markOf$(ui, isDone ? 'done' : isBold ? 'now' : 'open', 16)}</Box>
                  <Box flexShrink={1}>
                    {isDropped ? (
                      <Text color={GRAY} strikethrough>
                        {it.body}
                      </Text>
                    ) : isBold ? (
                      <Text bold>{it.body}</Text>
                    ) : (
                      <Button key={`t${it.line}`} plain dimColor={!isDone} onPress={toggleOpen}>
                        {label}
                      </Button>
                    )}
                  </Box>
                  {ask !== it.body && controls(`m${it.line}`, it.body, isDone)}
                </Box>
                {ask === it.body && confirm(`${it.line}`, it.body, 3)}
                {isOpened && it.details.length > 0 && (
                  <Box flexDirection="column" marginLeft={5}>
                    {it.details.map(d => (
                      <Text color={isBold || isDone ? undefined : GRAY}>{d}</Text>
                    ))}
                  </Box>
                )}
                {isOpened &&
                  g.subs.map((sub, si) => (
                    <Box key={`s${sub.line}`} flexDirection="column" marginLeft={5 + Math.max(0, sub.indent - 2)}>
                      <Box flexDirection="row" alignItems="center" gap={1}>
                        {markOf$(
                          ui,
                          sub.mark === 'done'
                            ? 'done'
                            : sub.mark === 'doing' || (isNow && !subDoing && si === firstOpenSub)
                              ? 'now'
                              : 'open',
                          12,
                        )}
                        <Box flexShrink={1}>
                          {sub.mark === 'done' ? (
                            <Text>{sub.body}</Text>
                          ) : sub.mark === 'dropped' ? (
                            <Text color={GRAY} strikethrough>
                              {sub.body}
                            </Text>
                          ) : sub.mark === 'doing' || (isNow && !subDoing && si === firstOpenSub) ? (
                            <Text bold>{sub.body}</Text>
                          ) : (
                            <Text color={GRAY}>{sub.body}</Text>
                          )}
                        </Box>
                        {ask !== sub.body && controls(`c${sub.line}`, sub.body, sub.mark === 'done')}
                      </Box>
                      {ask === sub.body && confirm(`${sub.line}`, sub.body, 2)}
                    </Box>
                  ))}
              </Box>
              {isNow && hasNext && dots}
            </Box>
          )
        })}
        {items.length > 0 && (
          <Box alignSelf="center" marginTop={2}>
            <Text bold color={stateMark.color}>
              {stateMark.label}
              {status.note ? ` · ${status.note}` : ''}
            </Text>
          </Box>
        )}
      </Box>
    )
  })
}
