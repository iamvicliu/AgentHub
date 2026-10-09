import { describe, expect, it } from 'vite-plus/test'

import { customTerminalArgs, validateCustomTerminal } from './customTerminal.js'

const terminal = {
  id: 'custom:test',
  name: 'Test',
  executable: '/Applications/My Terminal.app',
  args: ['-e', 'sh', '-c', '{command}', '{cwd}'],
}
describe('custom terminal configuration', () => {
  it('substitutes placeholders without splitting whitespace or interpreting embedded placeholders', () => {
    expect(customTerminalArgs(terminal, "echo 'hello {cwd}'", '/tmp/My Project')).toEqual([
      '-e',
      'sh',
      '-c',
      "echo 'hello {cwd}'",
      '/tmp/My Project',
    ])
  })
  it('requires an absolute path, argument array and command placeholder', () => {
    expect(() => validateCustomTerminal({ ...terminal, executable: 'tern' })).toThrow()
    expect(() => validateCustomTerminal({ ...terminal, args: ['-e'] })).toThrow()
    expect(() => validateCustomTerminal({ ...terminal, args: ['{command}\0'] })).toThrow()
  })
})
