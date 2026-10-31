import Link from "next/link";
import { EmptyState } from "../components/ui";
export default function NotFound() {
  return (
    <main className="container section">
      <EmptyState
        title="This one’s out of bounds"
        action={
          <Link className="button" href="/">
            Back to venues
          </Link>
        }
      >
        We couldn’t find that page. There’s still a good game waiting for you.
      </EmptyState>
    </main>
  );
}
