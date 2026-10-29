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
  shape: 'undo-1',
})
const redo = atom({ plugin: 'chat-checklist', key: 'redo' } as const, [] as string[], {
  shape: 'redo-1',
})
const HISTORY = 30

// Clickable controls are light blue where the surface honours it.
const BLUE = '#6aa6e6'
// Not started or set aside: a light gray. Done and now use the normal text color.
const GRAY = '#a8a8a8'
// State glyphs: a blue tick for done, a green ring for what we are on, a gray ring for not started.
const DONE_BLUE = '#4a90d9'
const NOW_GREEN = '#4caf6e'

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

const toggleLines = (lines: string[], body: string): string[] | undefined => {
  const idx = findLine(lines, body)
  if (idx < 0) return undefined
  const out = [...lines]
  out[idx] = /\[[ ~]\]/.test(out[idx])
    ? out[idx].replace(/\[[ ~]\]/, '[x]')
    : out[idx].replace(/\[[xX]\]/, '[ ]')

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
    // A change made outside the list (Claude's edit) is one undo step too.
    if (cur) {
      await update($, undo, l => [...l, cur].slice(-HISTORY))
      await update($, redo, () => [])
    }
    await update($, text, () => src)
  }
}

async function stepUndo($: any): Promise<void> {
  const stack = await read($, undo)
  if (stack.length === 0) return
  const prev = stack[stack.length - 1]
  const file = await pathOf($)
  const cur = await $.fs.read(file)
  await $.fs.write(file, prev)
  await update($, undo, l => l.slice(0, -1))
  await update($, redo, l => [...l, cur].slice(-HISTORY))
  await update($, text, () => prev)
}

async function stepRedo($: any): Promise<void> {
  const stack = await read($, redo)
  if (stack.length === 0) return
  const next = stack[stack.length - 1]
  const file = await pathOf($)
  const cur = await $.fs.read(file)
  await $.fs.write(file, next)
  await update($, redo, l => l.slice(0, -1))
  await update($, undo, l => [...l, cur].slice(-HISTORY))
  await update($, text, () => next)
}

// Re-reads the file, applies one edit to its lines, writes it back.
async function edit($: any, change: (lines: string[]) => string[] | undefined): Promise<void> {
  const file = await pathOf($)
  const before = await $.fs.read(file)
  const out = change(before.split('\n'))
  if (!out) return
  const src = out.join('\n')
  await $.fs.write(file, src)
  await update($, undo, l => [...l, before].slice(-HISTORY))
  await update($, redo, () => [])
  await update($, text, () => src)
}

async function rulesOf($: any): Promise<string> {
  const file = await pathOf($)

  return [
    `Chat Checklist: this chat has a running next-step list at ${file}. The user reads it live in the Chat Checklist pane and in the line above the prompt, and you use it as your own working plan, so it is how they know what to do next without re-reading long replies.`,
    '- Purpose: this is the shared "what next" map for this chat, for the user to scan and for you to plan by. Build it around that purpose, not as a dump of every small action.',
    '- Granularity: a top-level item is the goal being worked on (e.g. "Redesign the report layout"). The specific adjustments under it are its sub-items. Small fixes one chat can just do do not get their own item.',
    '- Order by dependency: if a request must happen before a later step, insert it before that step (not at the end); keep related work together; re-think the whole order each time, do not just append.',
    '- Keep it current with Edit/Write, silently, as part of normal work. Re-read it before editing: the user may have reordered or deleted items themselves. Update it whenever the plan changes, a step finishes, or a new idea appears.',
    '- Starting mid-chat: if the list is empty (only the header) but this chat already holds work, build the first version once, silently, from what you know: the conversation so far, and the project\'s own notes such as a handoff, progress or TODO file. Read only small notes that are clearly relevant, do not scan the whole folder, and do not invent items you cannot support. Mark finished work `[x]`, current work `[~]`, and keep it short; if you are unsure what is done, say so in a detail line.',
    '- Item format, one line each: `- [ ] title` (open), `- [~] title` (in progress), `- [x] title` (done), `- [-] title` (set aside). Write item text in the language the user is using in the chat (mixed languages if they mix, one language if they use one; do not translate parts of a mixed sentence). A title is one short line to scan at a glance (about 40 Latin characters or 20 CJK characters).',
    '- Sub-items: indent two spaces under their parent (`  - [ ] adjust X`). They are the concrete steps of the goal and each has its own state, which you set yourself (the user does not tick them). Mark one `[x]` as soon as it is done; the first open sub-item of the current goal is shown bold as what we are on. Under an in-progress parent all sub-items and details are always shown, so write them out in full as needed (they are shown as bullets); under a done or not-started parent they are collapsed and the user clicks the title to open them. Sub-items have no move or delete controls, you own them.',
    '- How it looks: done = normal black, in progress = bold black, not started = light gray. Several things can be in progress at once: mark each one `[~]`. Use `[~]` for anything not finished yet, e.g. something the user asked about that you have not fully answered, or work started in parallel. With no `[~]` anywhere, the first open item is shown bold. Change `[~]` to `[x]` when it is really done. Only top-level items have a checkbox the user can click.',
    '- Strikethrough `[-]` is only for something the user says to leave for now but keep (maybe later, or archive): mark it `[-]`, it stays in the file in gray. Never strike something that is done. If you strike the current item it was not finished, so the next open item becomes current. Delete a line only when the user says to remove it from the plan, or when they click delete (that is their own click, you will see the line gone).',
    '- Optional detail lines go directly under an item, each as `  > text` (two spaces, `>`). Core details, the reason, what it follows from and leads to. Keep them to about 4 short lines for done or not-started items; for an in-progress item write as much as the work needs. Skip them for trivial steps.',
    '- If the project already keeps its own handoff or progress notes (for example a handoff file, a progress log or a TODO file), do not duplicate that context here: one line pointing to it is enough.',
    '- Final state of the chat: a line `status: done` (finished for good), `status: park` (nothing to do now, chat kept for possible new tasks; optional note after it, e.g. `status: park waiting for new data`) or `status: archive` right under the header comment. No line means ongoing. When every top-level item is done, ask the user once in chat whether to mark it done, park or archive, then write the line. If you add a new task while a status line exists, delete the status line (back to ongoing).',
    '- No history or long rationale in the list. Do not mention the file in chat unless asked. Respect what the user changed.',
  ].join('\n')
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

// A chat resumed under a new session id keeps its transcript, and with it the rules note
// a session appends at start, which names that session's list file. The newest such note
// names the list this chat used last; if it is not this session's own, copy it over.
const NOTE = /^Chat Checklist: this chat has a running next-step list at (\S+\.md)\./

async function inherit($: any): Promise<boolean> {
  const file = await pathOf($)
  const found = await $.session.messages()
  if (!Array.isArray(found)) return false
  for (let i = found.length - 1; i >= 0; i--) {
    const m = found[i]
    const hit = m.role === 'user' ? NOTE.exec((m.text ?? '').trim()) : null
    if (!hit) continue
    if (hit[1] === file) return false
    try {
      const src = await $.fs.read(hit[1])
      const marked = await $.fs.read(hit[1].replace(/\.md$/, '.on')).then(() => true, () => false)
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
    const up = tops.find(it => isLive(it.mark))
    if (e.props.hasSurvey) return next(e)
    // Turned on but no items yet: say so, so the person knows it is on.
    if (tops.length === 0) {
      if (!(await isOn($))) return next(e)
      const { Text } = $.ui.resolve(e)

      return (
        <Text>
          <Text bold color={NOW_GREEN}>○</Text>
          <Text color={GRAY}> Chat Checklist is on · waiting for the first step</Text>
        </Text>
      )
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    const open = tops.filter(it => isLive(it.mark)).length
    const isOpen = (await $.ui.panes()).some(pane => pane.id === PANE)
    const mark = STATE_MARK[markKey(open, parseStatus(src).state)]

    return (
      <Box>
        {up ? (
          <Text>
            <Text bold color={NOW_GREEN}>○</Text>
            <Text color={GRAY}> Next: {up.body} · {open} left · </Text>
          </Text>
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
    const { Box, Text, Button, Markdown } = $.ui.resolve(e)
    const src = await read($, text)
    const items = parse(src)
    const older = await read($, showOlder)
    const ask = await read($, pending)
    const open$ = await read($, expanded)
    const room = Math.max(12, (e.props.bodyColumns ?? 40) - 10)
    const canUndo = (await read($, undo)).length > 0
    const canRedo = (await read($, redo)).length > 0

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

    // Hover-only controls for one item: move up, move down, remove.
    const controls = (k: string, body: string) => (
      <Box display="none" hover={{ display: 'flex' }}>
        <Markdown
          key={k}
          dimColor
          text="[✓](https://chat-checklist.invalid/tick) [▲](https://chat-checklist.invalid/up) [▼](https://chat-checklist.invalid/down) [✕](https://chat-checklist.invalid/remove)"
          onLinkPress={link => {
            if (link.href.endsWith('/tick')) void edit($, lines => toggleLines(lines, body))
            else if (link.href.endsWith('/up')) void edit($, lines => moveLines(lines, body, -1))
            else if (link.href.endsWith('/down')) void edit($, lines => moveLines(lines, body, 1))
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
            await edit($, lines => removeLines(lines, body))
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
          <Markdown
            key="undo"
            dimColor={!canUndo}
            text={canUndo ? '[**↶ Undo**](https://chat-checklist.invalid/undo)' : '**↶ Undo**'}
            onLinkPress={() => void stepUndo($)}
          />
          <Markdown
            key="redo"
            dimColor={!canRedo}
            text={canRedo ? '[**↷ Redo**](https://chat-checklist.invalid/redo)' : '**↷ Redo**'}
            onLinkPress={() => void stepRedo($)}
          />
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
                <Box flexDirection="row" gap={1}>
                  {/* Plain text, not a button: the desktop app does not colour button text. Ticking is in the hover controls. */}
                  <Box marginLeft={1}>
                    {isDone ? (
                      <Text bold color={DONE_BLUE}>✔</Text>
                    ) : isBold ? (
                      <Text bold color={NOW_GREEN}>○</Text>
                    ) : (
                      <Text color={GRAY}>○</Text>
                    )}
                  </Box>
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
                  {!isDone && ask !== it.body && controls(`m${it.line}`, it.body)}
                </Box>
                {!isDone && ask === it.body && confirm(`${it.line}`, it.body, 3)}
                {isOpened && (isClipped || it.details.length > 0) && (
                  <Box flexDirection="column" marginLeft={5}>
                    {isClipped && !isBold && <Text color={isDone ? undefined : GRAY}>{it.body}</Text>}
                    {it.details.map(d => (
                      <Text color={isBold || isDone ? undefined : GRAY}>{d}</Text>
                    ))}
                  </Box>
                )}
                {isOpened &&
                  g.subs.map((sub, si) => (
                    <Box key={`s${sub.line}`} flexDirection="column" marginLeft={5 + Math.max(0, sub.indent - 2)}>
                      <Box flexDirection="row" gap={1}>
                        {sub.mark === 'done' ? (
                          <Text color={DONE_BLUE}>✔</Text>
                        ) : sub.mark === 'doing' || (isNow && !subDoing && si === firstOpenSub) ? (
                          <Text bold color={NOW_GREEN}>○</Text>
                        ) : (
                          <Text color={GRAY}>○</Text>
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
                      </Box>
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
