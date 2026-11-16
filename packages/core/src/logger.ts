/** Minimal structured logger. Never pass secrets or raw source text as `data`. */
export interface Logger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

export const silentLogger: Logger = {
  info() {},
  warn() {},
  error() {},
};

export const consoleLogger: Logger = {
  info: (message, data) => console.info(`[crypt-kit] ${message}`, data ?? ''),
  warn: (message, data) => console.warn(`[crypt-kit] ${message}`, data ?? ''),
  error: (message, data) => console.error(`[crypt-kit] ${message}`, data ?? ''),
};

/** Turns an unknown thrown value into a short, loggable message. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error';
}
