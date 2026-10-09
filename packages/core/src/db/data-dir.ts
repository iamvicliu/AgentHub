import { homedir } from 'node:os'
import { join } from 'node:path'

/** AgentHub's data folder. */
export const DEFAULT_DATA_DIR = join(homedir(), '.agenthub')

export const DB_FILE_NAME = 'agenthub.db'
