import { VenueDetail } from "../../../components/venue-detail";
export const metadata = { title: "Find your time to play" };
export default async function VenuePage({
  params,
}: {
  params: Promise<{ venueId: string }>;
}) {
  const { venueId } = await params;
  return <VenueDetail id={venueId} />;
}
