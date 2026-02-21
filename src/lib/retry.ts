/**
 * Retry utility with exponential backoff for handling rate limits and transient errors
 */

interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number; // in ms
  maxDelay?: number; // in ms
  retryableErrors?: string[]; // error codes/messages to retry on
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10000,
  retryableErrors: ['429', 'rate', 'limit', 'timeout', 'network', 'ECONNRESET', 'ETIMEDOUT'],
};

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      
      // Check if error is retryable
      const errorMessage = error?.message?.toLowerCase() || '';
      const errorCode = error?.code?.toString() || '';
      const errorString = `${errorMessage} ${errorCode}`.toLowerCase();
      
      const isRetryable = opts.retryableErrors.some(
        retryable => errorString.includes(retryable.toLowerCase())
      );
      
      // Don't retry if not retryable or max retries reached
      if (!isRetryable || attempt === opts.maxRetries) {
        throw error;
      }
      
      // Calculate delay with exponential backoff + jitter
      const delay = Math.min(
        opts.baseDelay * Math.pow(2, attempt) + Math.random() * 1000,
        opts.maxDelay
      );
      
      console.log(`Retry attempt ${attempt + 1}/${opts.maxRetries} after ${Math.round(delay)}ms`);
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

export default withRetry;
