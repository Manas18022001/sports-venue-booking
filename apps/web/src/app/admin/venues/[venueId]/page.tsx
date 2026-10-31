import { AdminVenue } from "../../../../components/admin";
export const metadata = { title: "Manage your venue" };
export default async function AdminVenuePage({
  params,
}: {
  params: Promise<{ venueId: string }>;
}) {
  const { venueId } = await params;
  return <AdminVenue id={venueId} />;
}
