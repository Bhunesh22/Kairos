import type { Metadata } from "next";
import { CalendarWorkspace } from "@/components/calendar/calendar-workspace";

export const metadata: Metadata = { title: "Calendar · Kairos" };

export default function CalendarPage() {
  return <CalendarWorkspace />;
}
