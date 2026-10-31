import { BookingDetails } from "../../../components/bookings";
export const metadata = { title: "Your booking" };
export default async function BookingPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = await params;
  return <BookingDetails id={bookingId} />;
}
