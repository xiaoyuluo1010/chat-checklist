import { expect, mock, test } from 'claude-code/testing'

const HOME = '/home/u'
const dir = `${HOME}/.claude/chat-checklists`
const LIST = '# Chat Checklist\n<!-- header -->\n- [x] Load the data\n- [~] Fix the batch effect\n'
const note = (id: string) => `Chat Checklist: this chat has a running next-step list at ${dir}/${id}.md. The user reads it live.`
const said = (role: 'user' | 'assistant', text: string) => ({ role, text, toolUses: [] })

// Wires the engine beneath the mod: a session id, its transcript and a small file system.
function world(on: any, id: string, messages: unknown[], files: Record<string, string>) {
  const writes: Record<string, string> = {}
  mock.env(on, { HOME })
  on('session.id', () => ({ value: id }))
  on('session.messages', () => ({ value: messages }))
  on('command.register', () => ({ value: { command: 'chat-checklist' } }))
  on('clock.every', () => ({ value: undefined }))
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
    expect((await band.find({ type: 'Text', text: /Next: Fix the batch effect/ }))?.text).toContain('2 left')
    await band.unmount()
  }
})
