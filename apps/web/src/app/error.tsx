"use client";
import { EmptyState } from "../components/ui";
export default function PageError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="container section">
      <EmptyState
        title="A quick pause in play"
        action={
          <button className="button" onClick={reset}>
            Try again
          </button>
        }
      >
        We couldn’t load this page. Please try again in a moment.
      </EmptyState>
    </main>
  );
}
