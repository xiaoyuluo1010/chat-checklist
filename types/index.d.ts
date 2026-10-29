declare module 'claude-code' {
  interface PluginState {
    'chat-checklist': {
      text: Shaped<string>
      showOlder: Shaped<boolean>
      expanded: Shaped<string[]>
      pending: Shaped<string>
      undo: Shaped<string[]>
      redo: Shaped<string[]>
      changes: Shaped<string[]>
      undoAct: Shaped<string[]>
      redoAct: Shaped<string[]>
      seen: Shaped<string>
    }
  }
}
export type ChecklistItem = { line: number; mark: 'open' | 'doing' | 'done' | 'dropped'; body: string; indent: number; details: string[] }
