// via https://github.com/prisma/prisma/issues/6329#issuecomment-816954832

import { Prisma } from "@prisma/client";

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_MIN_BACKOFF = 5;
const DEFAILT_MAX_BACKOFF = 30;

type BackoffOptions = {
  min?: number;
  max?: number;
}

type RetryOptions = {
  maxRetries?: number;
  backoff?:
    | boolean
    | BackoffOptions;
};

const sleep = (min: number, max: number) => {
  const ms = Math.floor(Math.random() * (max - min + 1) + min);
  return new Promise((resolve) => setTimeout(resolve, ms));
};

export class PrismaRetryError extends Error {
  constructor() {
    super()
    this.name = 'PrismaRetryError';
  }
}

export const Retry = (options?: RetryOptions): Prisma.Middleware => {
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const backoff = options?.backoff ?? true;
  const minBackoff = (options?.backoff as BackoffOptions | undefined)?.min ?? DEFAULT_MIN_BACKOFF;
  const maxBackoff = (options?.backoff as BackoffOptions | undefined)?.max ?? DEFAILT_MAX_BACKOFF;
  if (minBackoff > maxBackoff) {
    throw new Error('Minimum backoff must be less than maximum backoff')
  }

  return async (params, next) => {
    let retries = 0;
    do {
      try {
        console.log('middleware retries', retries)
        const result = await next(params);
        return result;
      } catch (err) {
        console.log('middleware error', err)
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P1017"
        ) {
          retries += 1;
          if (backoff) {
            await sleep(minBackoff, maxBackoff)
          }
          continue;
        }
        throw err;
      }
    } while (retries < maxRetries);
    throw new PrismaRetryError()
  };
};