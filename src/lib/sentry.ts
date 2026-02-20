import * as Sentry from "@sentry/react";

export function initSentry() {
  const sentryDsn = import.meta.env.VITE_SENTRY_DSN;

  if (!sentryDsn) {
    console.warn("Sentry DSN not configured. Error monitoring is disabled.");
    return;
  }

  Sentry.init({
    dsn: sentryDsn,
    environment: import.meta.env.MODE,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],
    tracesSampleRate: 1.0,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    beforeSend(event) {
      if (event.exception) {
        console.error("Error captured by Sentry:", event.exception);
      }
      return event;
    },
  });
}

export { Sentry };
