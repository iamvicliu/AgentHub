export interface CustomTerminal {
  id: string
  name: string
  executable: string
  args: string[]
}

export function validateCustomTerminal(value: CustomTerminal): void {
  if (!value || !/^custom:[a-zA-Z0-9-]+$/.test(value.id)) throw new Error('Invalid terminal ID')
  if (!value.name?.trim() || !value.executable?.startsWith('/'))
    throw new Error('Name and absolute application path required')
  if (
    !Array.isArray(value.args) ||
    !value.args.every((arg) => typeof arg === 'string' && !arg.includes('\0'))
  )
    throw new Error('Arguments must be a string array')
  if (!value.args.some((arg) => arg.includes('{command}')))
    throw new Error('Arguments must include {command}')
  if (value.executable.includes('\0')) throw new Error('Invalid application path')
}

export function customTerminalArgs(value: CustomTerminal, command: string, cwd: string): string[] {
  validateCustomTerminal(value)
  // One replacement pass keeps placeholder-like text inside the command literal.
  return value.args.map((arg) =>
    arg.replace(/\{(command|cwd)\}/g, (_, key) => (key === 'command' ? command : cwd)),
  )
}
