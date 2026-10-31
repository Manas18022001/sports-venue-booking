import { Spinner } from "../components/ui";
export default function Loading() {
  return (
    <div className="page-loader">
      <Spinner label="Getting things ready" />
    </div>
  );
}
