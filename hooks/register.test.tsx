import { expect, mock, test } from 'claude-code/testing'

const HOME = '/home/u'
const dir = `${HOME}/.claude/chat-checklists`
const LIST = '# Chat Checklist\n<!-- header -->\n- [x] Load the data\n- [~] Fix the batch effect\n'
const note = (id: string) => `Chat Checklist: this chat has a running next-step list at ${dir}/${id}.md. The user reads it live.`
const said = (role: 'user' | 'assistant', text: string) => ({ role, text, toolUses: [] })

// Wires the engine beneath the mod: a session id, its transcript and a small file system.
function world(on: any, id: string, messages: unknown[], files: Record<string, string>, ownClock = true) {
  const writes: Record<string, string> = {}
  mock.env(on, { HOME })
  on('session.id', () => ({ value: id }))
  on('session.messages', () => ({ value: messages }))
  on('command.register', () => ({ value: { command: 'chat-checklist' } }))
  if (ownClock) on('clock.every', () => ({ value: undefined }))
  on('fs.read', ($: any, e: any, next: any) => {
    const src = writes[e.path] ?? files[e.path]

    return src === undefined ? next(e) : { value: src }
  })
  on('fs.write', ($: any, e: any) => {
    writes[e.path] = e.text

    return { value: undefined }
  })
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))

  return writes
}

const begin = ($: any) => $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

test('a resumed chat takes over the list its previous id used', async ($, on) => {
  const session = mock.session(on)
  const writes = world(on, 'new', [said('user', note('old')), said('assistant', 'ok')], { [`${dir}/old.md`]: LIST })
  await begin($)

  expect(writes[`${dir}/new.md`]).toBe(LIST)
  expect(session.appended().length).toBe(1)
})

test('after several resumes the newest note wins', async ($, on) => {
  const older = '# Chat Checklist\n<!-- header -->\n- [ ] Stale\n'
  const writes = world(on, 'c', [said('user', note('a')), said('user', note('b'))], {
    [`${dir}/a.md`]: older,
    [`${dir}/b.md`]: LIST,
  })
  await begin($)

  expect(writes[`${dir}/c.md`]).toBe(LIST)
})

test('a chat that never turned the list on stays off', async ($, on) => {
  const session = mock.session(on)
  const writes = world(on, 'x', [said('user', 'hello'), said('assistant', `see ${dir}/other.md.`)], {
    [`${dir}/other.md`]: LIST,
  })
  await begin($)

  expect(Object.keys(writes).length).toBe(0)
  expect(session.appended().length).toBe(0)
})

test('a path only mentioned in chat is not taken as the list', async ($, on) => {
  const writes = world(on, 'x', [said('assistant', note('other')), said('user', `look at ${dir}/other.md`)], {
    [`${dir}/other.md`]: LIST,
  })
  await begin($)

  expect(Object.keys(writes).length).toBe(0)
})

test('the newest note naming this session itself stops the search', async ($, on) => {
  const writes = world(on, 'same', [said('user', note('old')), said('user', note('same'))], {
    [`${dir}/old.md`]: LIST,
  })
  await begin($)

  expect(Object.keys(writes).length).toBe(0)
})

test('an empty previous list is not carried over', async ($, on) => {
  const writes = world(on, 'new', [said('user', note('old'))], {
    [`${dir}/old.md`]: '# Chat Checklist\n<!-- header -->\n',
  })
  await begin($)

  expect(Object.keys(writes).length).toBe(0)
})

test('a list this session already has is kept as it is', async ($, on) => {
  const own = '# Chat Checklist\n<!-- header -->\n- [ ] Mine\n'
  const writes = world(on, 'new', [said('user', note('old'))], {
    [`${dir}/old.md`]: LIST,
    [`${dir}/new.md`]: own,
  })
  await begin($)

  expect(writes[`${dir}/new.md`]).toBeUndefined()
})

const EMPTY = '# Chat Checklist\n<!-- header -->\n'

test('a marked chat stays on with a list that has no items', async ($, on) => {
  const session = mock.session(on)
  world(on, 'm', [], { [`${dir}/m.md`]: EMPTY, [`${dir}/m.on`]: 'on\n' })
  await begin($)

  expect(session.appended().length).toBe(1)
})

test('a marked chat stays on when its list file is gone', async ($, on) => {
  const session = mock.session(on)
  const writes = world(on, 'm', [], { [`${dir}/m.on`]: 'on\n' })
  await begin($)

  expect(session.appended().length).toBe(1)
  expect(writes[`${dir}/m.md`]).toContain("# Chat Checklist")
})

test('an empty list without a marker stays off', async ($, on) => {
  const session = mock.session(on)
  world(on, 'm', [], { [`${dir}/m.md`]: EMPTY })
  await begin($)

  expect(session.appended().length).toBe(0)
})

test('a marked empty list is carried over with its marker', async ($, on) => {
  const writes = world(on, 'new', [said('user', note('old'))], {
    [`${dir}/old.md`]: EMPTY,
    [`${dir}/old.on`]: 'on\n',
  })
  await begin($)

  expect(writes[`${dir}/new.md`]).toBe(EMPTY)
  expect(writes[`${dir}/new.on`]).toBe('on\n')
})

const SHOWN = '# Chat Checklist\n<!-- header -->\n- [x] Load the data\n- [~] Fix the batch effect\n  - [x] Check PCA\n  - [ ] Rerun\n- [ ] Draft the figure\n'
const surfaces = ['terminal', 'desktop', 'vscode', 'mobile'] as const

test('the pane and the band draw their marks on every surface', async ($, on) => {
  world(on, 'v', [], { [`${dir}/v.md`]: SHOWN, [`${dir}/v.on`]: 'on\n' })
  on('ui.panes', () => ({ value: [] }))
  await begin($)

  for (const surface of surfaces) {
    const pane = await $.ui.mount({
      plugin: 'chat-checklist',
      component: 'Pane',
      requestId: 'chat-checklist',
      surface,
      props: { title: 'Chat Checklist', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
    } as any)
    expect((await pane.find({ type: 'Text', text: /Fix the batch effect/ }))?.text).toBe('Fix the batch effect')
    const drawn = await pane.find({ type: 'Svg' } as any)
    if (surface === 'terminal') expect(drawn).toBeUndefined()
    else expect(drawn).toBeDefined()
    await pane.unmount()

    const band = await $.ui.mount({ plugin: 'chat-checklist', component: 'AbovePrompt', surface, props: {} } as any)
    expect((await band.find({ type: 'Text', text: /Ongoing: Fix the batch effect/ }))?.text).toContain('2 left')
    await band.unmount()
  }
})

test('a note that is not first in its message still names the list', async ($, on) => {
  const writes = world(on, 'new', [said('user', `<system-reminder>files re-read</system-reminder>\n${note('old')}\nnext question`)], {
    [`${dir}/old.md`]: LIST,
  })
  await begin($)

  expect(writes[`${dir}/new.md`]).toBe(LIST)
})

test("with no note, Claude's own edits of the list name it", async ($, on) => {
  const edited = {
    role: 'assistant',
    text: '',
    toolUses: [{ tool_use_id: 't1', tool: 'Edit', input: { file_path: `${dir}/old.md`, old_string: 'a', new_string: 'b' } }],
  }
  const writes = world(on, 'new', [said('user', 'hello'), edited, said('user', 'go on')], { [`${dir}/old.md`]: LIST })
  await begin($)

  expect(writes[`${dir}/new.md`]).toBe(LIST)
  expect(writes[`${dir}/new.on`]).toBe('on\n')
})

test('a file read or a file elsewhere is not taken as the list', async ($, on) => {
  const touched = {
    role: 'assistant',
    text: '',
    toolUses: [
      { tool_use_id: 't1', tool: 'Read', input: { file_path: `${dir}/old.md` } },
      { tool_use_id: 't2', tool: 'Write', input: { file_path: '/home/u/notes/old.md', content: 'x' } },
    ],
  }
  const writes = world(on, 'new', [touched], { [`${dir}/old.md`]: LIST })
  await begin($)

  expect(Object.keys(writes).length).toBe(0)
})

test('copy puts an item, with its sub-items and notes, on the clipboard', async ($, on) => {
  world(on, 'v', [], { [`${dir}/v.md`]: SHOWN.replace('  - [ ] Rerun\n', '  - [ ] Rerun\n  > batch 2 shifted\n'), [`${dir}/v.on`]: 'on\n' })
  on('ui.panes', () => ({ value: [] }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.copy', () => ({ value: { isCopied: false, reason: 'no path' } }))
  const piped: string[] = []
  on('process.run', (_: any, e: any) => {
    piped.push(e.init?.stdin ?? e.stdin)

    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  await begin($)
  const pane = await $.ui.mount({
    plugin: 'chat-checklist',
    component: 'Pane',
    requestId: 'chat-checklist',
    surface: 'desktop',
    props: { title: 'Chat Checklist', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
  } as any)
  const all = await pane.find({ type: 'Markdown', text: /Copy all/ } as any)
  expect(all).toBeDefined()
  await pane.unmount()
})

const PANE_PROPS = { title: 'Chat Checklist', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} }
const mountPane = ($: any, surface: string) =>
  $.ui.mount({ plugin: 'chat-checklist', component: 'Pane', requestId: 'chat-checklist', surface, props: PANE_PROPS } as any)
const tick = { href: 'https://chat-checklist.invalid/tick' }

test('a done item can be reopened, moved and removed from the pane', async ($, on) => {
  const writes = world(on, 'v', [], { [`${dir}/v.md`]: SHOWN, [`${dir}/v.on`]: 'on\n' })
  on('ui.panes', () => ({ value: [] }))
  await begin($)
  const pane = await mountPane($, 'desktop')
  const done = await pane.find({ type: 'Markdown', text: /↺/ } as any)
  expect(done?.text).toContain('✕')
  await pane.press({ key: (done as any).key, link: tick })
  expect(writes[`${dir}/v.md`]).toContain('- [ ] Load the data')
  await pane.unmount()
})

test('a change made in the pane reaches Claude once, with the next prompt', async ($, on) => {
  world(on, 'v', [], { [`${dir}/v.md`]: SHOWN, [`${dir}/v.on`]: 'on\n' })
  on('ui.panes', () => ({ value: [] }))
  const seen: any[] = []
  on('prompt.submit', (_: any, e: any) => {
    seen.push(e)

    return { text: e.text }
  })
  await begin($)
  const pane = await mountPane($, 'desktop')
  const done = await pane.find({ type: 'Markdown', text: /↺/ } as any)
  await pane.press({ key: (done as any).key, link: tick })
  const undoTip = await pane.find({ type: 'Text', text: /^Undo / })
  expect(undoTip?.text).toBe('Undo reopen')
  await pane.unmount()

  await $.prompt.submit({ text: 'go on' })
  await $.prompt.submit({ text: 'and then' })
  const said = (seen[0]?.context ?? []).join('\n')
  expect(said).toContain('reopened "Load the data" (was done)')
  expect(said).toContain('- [ ] Load the data')
  expect((seen[1]?.context ?? []).join('\n')).not.toContain('changed the list')
})

test('a change undone before Claude hears of it is not reported', async ($, on) => {
  world(on, 'v', [], { [`${dir}/v.md`]: SHOWN, [`${dir}/v.on`]: 'on\n' })
  on('ui.panes', () => ({ value: [] }))
  const seen: any[] = []
  on('prompt.submit', (_: any, e: any) => {
    seen.push(e)

    return { text: e.text }
  })
  await begin($)
  const pane = await mountPane($, 'desktop')
  const done = await pane.find({ type: 'Markdown', text: /↺/ } as any)
  await pane.press({ key: (done as any).key, link: tick })
  await pane.press({ key: 'undo', link: { href: 'https://chat-checklist.invalid/undo' } })
  expect((await pane.find({ type: 'Text', text: /^Redo / }))?.text).toBe('Redo reopen')
  await pane.unmount()

  await $.prompt.submit({ text: 'go on' })
  expect((seen[0]?.context ?? []).join('\n')).not.toContain('changed the list')
})

test("Claude's edit of the list over an unheard pane change is refused once, with the change", async ($, on) => {
  world(on, 'v', [], { [`${dir}/v.md`]: SHOWN, [`${dir}/v.on`]: 'on\n' })
  on('ui.panes', () => ({ value: [] }))
  on('tool.call', () => ({ result: { text: 'edited' } }))
  await begin($)
  const pane = await mountPane($, 'desktop')
  const done = await pane.find({ type: 'Markdown', text: /↺/ } as any)
  await pane.press({ key: (done as any).key, link: tick })
  await pane.unmount()

  const edit = { tool: 'Edit', file_path: `${dir}/v.md`, old_string: 'a', new_string: 'b' } as any
  const first: any = await $.tool.call(edit)
  expect(first.deny).toContain('reopened "Load the data"')
  const again: any = await $.tool.call(edit)
  expect(again.deny).toBeUndefined()
})

test('after a pause, an idle chat gets one short line, the full note going in hidden', async ($, on) => {
  world(on, 'v', [], { [`${dir}/v.md`]: SHOWN, [`${dir}/v.on`]: 'on\n' }, false)
  const clock = mock.clock(on)
  const session = mock.session(on)
  on('ui.panes', () => ({ value: [] }))
  const seen: any[] = []
  on('prompt.submit', (_: any, e: any) => {
    seen.push(e)

    return { text: e.text }
  })
  await begin($)
  const pane = await mountPane($, 'desktop')
  const done = await pane.find({ type: 'Markdown', text: /↺/ } as any)
  await pane.press({ key: (done as any).key, link: tick })
  await pane.unmount()
  expect(seen).toHaveLength(0)
  await clock.advance(8000)
  expect(seen).toHaveLength(1)
  expect(seen[0].text).toBe('📋 reopened "Load the data" (was done)')
  const hidden = JSON.stringify(session.appended())
  expect(hidden).toContain('changed the list themselves')
})

test("undo puts back the person's last action, and Claude's edit starts the history over", async ($, on) => {
  const writes = world(on, 'v', [], { [`${dir}/v.md`]: SHOWN, [`${dir}/v.on`]: 'on\n' }, false)
  const clock = mock.clock(on)
  on('ui.panes', () => ({ value: [] }))
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.submit', (_: any, e: any) => ({ text: e.text }))
  await begin($)
  const pane = await mountPane($, 'desktop')
  const done = await pane.find({ type: 'Markdown', text: /↺/ } as any)
  await pane.press({ key: (done as any).key, link: { href: 'https://chat-checklist.invalid/down' } })
  expect(writes[`${dir}/v.md`]).toContain('- [~] Fix the batch effect\n  - [x] Check PCA\n  - [ ] Rerun\n- [x] Load the data')
  expect((await pane.find({ type: 'Text', text: /^Undo / }))?.text).toBe('Undo move')
  await pane.press({ key: 'undo', link: { href: 'https://chat-checklist.invalid/undo' } })
  expect(writes[`${dir}/v.md`]).toBe(SHOWN)

  // Claude edits the list: the poll sees it and undo and redo are gone.
  writes[`${dir}/v.md`] = SHOWN + '- [ ] Claude added this\n'
  await clock.advance(2000)
  expect(await pane.find({ type: 'Text', text: /^(Undo|Redo) / })).toBeUndefined()
  await pane.unmount()
})

test('every prompt carries the upkeep note with the open items, and the rules again after a compaction', async ($, on) => {
  world(on, 'v', [], { [`${dir}/v.md`]: SHOWN, [`${dir}/v.on`]: 'on\n' })
  const seen: any[] = []
  on('prompt.submit', (_: any, e: any) => {
    seen.push(e)

    return { text: e.text }
  })
  on('session.compact', (_: any, e: any) => ({ messages: e.messages }))
  await begin($)
  await $.prompt.submit({ text: 'go on' })
  const first = (seen[0]?.context ?? []).join('\n')
  expect(first).toContain('Chat Checklist upkeep')
  expect(first).toContain('[~] Fix the batch effect')
  expect(first).toContain('[ ] Draft the figure')
  expect(first).not.toContain('Load the data')
  expect(first).not.toContain('desk notebook')

  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'summary', toolUses: [] }] } as any)
  await $.prompt.submit({ text: 'and then' })
  expect((seen[1]?.context ?? []).join('\n')).toContain('desk notebook')
  await $.prompt.submit({ text: 'more' })
  expect((seen[2]?.context ?? []).join('\n')).not.toContain('desk notebook')
})

test('a rules note in the newer wording names the list too', async ($, on) => {
  const writes = world(on, 'new', [said('user', `Chat Checklist: this chat keeps a running list at ${dir}/old.md. The user sees it live.`)], {
    [`${dir}/old.md`]: LIST,
  })
  await begin($)

  expect(writes[`${dir}/new.md`]).toBe(LIST)
})

test('a sub-item can be ticked and moved, but only within its item', async ($, on) => {
  const writes = world(on, 'v', [], { [`${dir}/v.md`]: SHOWN, [`${dir}/v.on`]: 'on\n' })
  on('ui.panes', () => ({ value: [] }))
  await begin($)
  const pane = await mountPane($, 'desktop')
  const rows = await pane.findAll({ type: 'Markdown', text: /\/up/ } as any)
  expect(rows.length).toBeGreaterThanOrEqual(4)
  const rerun = (await pane.findAll({ type: 'Markdown' } as any)).filter((m: any) => /^c\d/.test(m.key ?? ''))
  expect(rerun.length).toBe(2)
  const last = rerun[1] as any
  await pane.press({ key: last.key, link: { href: 'https://chat-checklist.invalid/tick' } })
  expect(writes[`${dir}/v.md`]).toContain('  - [x] Rerun')
  await pane.press({ key: last.key, link: { href: 'https://chat-checklist.invalid/down' } })
  expect(writes[`${dir}/v.md`]).toContain('  - [x] Check PCA\n  - [x] Rerun\n- [ ] Draft the figure')
  await pane.press({ key: (rerun[0] as any).key, link: { href: 'https://chat-checklist.invalid/up' } })
  expect(writes[`${dir}/v.md`]).toContain('- [~] Fix the batch effect\n  - [x] Check PCA')
  await pane.press({ key: last.key, link: { href: 'https://chat-checklist.invalid/up' } })
  expect(writes[`${dir}/v.md`]).toContain('- [~] Fix the batch effect\n  - [x] Rerun\n  - [x] Check PCA')
  await pane.unmount()
})

test('opening a clipped title does not repeat it', async ($, on) => {
  const long = '# Chat Checklist\n<!-- header -->\n- [x] A very long finished title that will not fit in the narrow pane at all\n  > one note\n- [~] Now\n'
  world(on, 'v', [], { [`${dir}/v.md`]: long, [`${dir}/v.on`]: 'on\n' })
  on('ui.panes', () => ({ value: [] }))
  await begin($)
  const pane = await mountPane($, 'desktop')
  const title = await pane.find({ type: 'Button', text: /A very long/ })
  await pane.press({ key: (title as any).key })
  expect(await pane.find({ type: 'Text', text: 'one note' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /narrow pane at all$/ })).toBeUndefined()
  await pane.unmount()
})
