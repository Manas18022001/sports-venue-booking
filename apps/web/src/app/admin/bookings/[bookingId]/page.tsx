import { BookingDetails } from "../../../../components/bookings";
export const metadata = { title: "Manage booking" };
export default async function AdminBookingPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = await params;
  return <BookingDetails id={bookingId} admin />;
}
