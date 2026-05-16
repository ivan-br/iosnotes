type ErrorListener = (error: Error) => void;
type RuntimeGlobal = typeof globalThis & {
  ErrorUtils?: {
    setGlobalHandler: (handler: (error: unknown, isFatal?: boolean) => void) => void;
  };
};

const listeners = new Set<ErrorListener>();
let currentError: Error | null = null;
let isInstalled = false;

export function installGlobalErrorHandler() {
  const runtimeGlobal = globalThis as RuntimeGlobal;

  if (isInstalled || typeof runtimeGlobal.ErrorUtils === 'undefined') {
    return;
  }

  isInstalled = true;
  runtimeGlobal.ErrorUtils.setGlobalHandler((errorValue: unknown) => {
    reportError(toError(errorValue));
  });
}

export function getCurrentError(): Error | null {
  return currentError;
}

export function reportError(error: Error) {
  currentError = error;
  listeners.forEach((listener) => listener(error));
}

export function clearError() {
  currentError = null;
}

export function subscribeToErrors(listener: ErrorListener) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }

  if (typeof value === 'string') {
    return new Error(value);
  }

  try {
    return new Error(JSON.stringify(value));
  } catch {
    return new Error('Unknown JavaScript error');
  }
}
