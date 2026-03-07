export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0, info: 1, warn: 2, error: 3,
};

let minLevel: LogLevel = 'info';
let enabled = true;

export function setLogLevel(level: LogLevel): void {
  minLevel = level;
  enabled = true;
}

export function disableLogging(): void {
  enabled = false;
}

export function createLogger(prefix: string): Logger {
  function emit(level: LogLevel, msg: string) {
    if (!enabled) return;
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
    const fn = level === 'debug' ? console.debug
      : level === 'info' ? console.info
      : level === 'warn' ? console.warn
      : console.error;
    fn(`[${prefix}] ${msg}`);
  }
  return {
    debug: (msg) => emit('debug', msg),
    info: (msg) => emit('info', msg),
    warn: (msg) => emit('warn', msg),
    error: (msg) => emit('error', msg),
  };
}
